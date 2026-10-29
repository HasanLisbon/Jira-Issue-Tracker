import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const browserPath = [process.env.TRACKER_BROWSER,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((candidate) => candidate && existsSync(candidate));

test('connection profiles and task branch confirmation preserve query, timer ownership, consent and retry behavior', {
  skip: !browserPath && 'Set TRACKER_BROWSER to a local Chromium browser executable', timeout: 90000,
}, async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'jira-branch-browser-'));
  const fixture = {
    repositories: [{ id: 'test-root', name: 'Test repository', base: 'main', matches: [],
      branches: ['refs/heads/main', 'refs/heads/develop', 'refs/remotes/origin/develop'] }],
    creates: [], checks: 0, failCreate: false, failCheck: false, tasks: null, snapshots: [], searches: [],
    holdCreate: false, finishCreate: null, failConnections: false, requests: [], worklogs: [], failWorklog: false,
    connections: [
      { id: 'fixture', name: 'Test repository one', url: 'https://jira.invalid', query: 'project = TESTONE', commitMessageTemplate: '{issueKey}: {summary}' },
      { id: 'fixture-two', name: 'Test repository two', url: 'https://jira.invalid', query: 'project = TESTTWO', commitMessageTemplate: '{issueKey}: {summary}' },
    ],
  };
  const task = { id: '2', key: 'TEST-2', fields: {
    summary: 'Test child task', status: { name: 'Open' }, parent: { key: 'TEST-1' }, issuetype: { name: 'Sub-task' },
  } };
  const parent = { id: '1', key: 'TEST-1', fields: {
    summary: 'Test parent bug', status: { name: 'Open' }, issuetype: { name: 'Bug' },
  } };
  const dist = path.resolve('dist');
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/api/jira') {
        let body = '';
        for await (const chunk of request) body += chunk;
        const parameters = JSON.parse(body);
        fixture.requests.push(parameters);
        let result;
        switch (parameters.operation) {
          case 'connections':
            if (fixture.failConnections) throw new Error('Test connection refresh failed');
            result = fixture.connections; break;
          case 'myself': result = { name: 'fixture', displayName: 'Test User' }; break;
          case 'search': fixture.searches.push(parameters); result = fixture.tasks || [task]; break;
          case 'branchDiagnostics': fixture.snapshots.push(parameters.cards); result = {}; break;
          case 'issue': result = parameters.key === 'TEST-1' ? parent : task; break;
          case 'branches':
            fixture.checks++;
            assert.equal(parameters.key, 'TEST-1');
            if (fixture.failCheck) throw new Error('Test branch lookup failed');
            result = { suggestedName: 'bugfix/TEST-1-test-parent-bug', repositories: fixture.repositories }; break;
          case 'createBranch':
            fixture.creates.push(parameters);
            if (fixture.holdCreate) await new Promise((resolve) => { fixture.finishCreate = resolve; });
            if (fixture.failCreate) throw new Error('Test branch creation failed');
            result = { created: true }; break;
          case 'worklogs': result = fixture.worklogs; break;
          case 'worklog':
            if (fixture.failWorklog) throw new Error('Test worklog rejected');
            result = { id: String(fixture.worklogs.length + 1), author: { displayName: 'Test User' },
              started: parameters.started, timeSpent: parameters.duration, comment: parameters.body };
            fixture.worklogs.push(result); break;
          default: throw new Error(`Unexpected operation: ${parameters.operation}`);
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(result));
        return;
      }
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = path.resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
      assert.ok(file.startsWith(dist + path.sep));
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await readFile(file));
    } catch (failure) {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: failure.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserErrors = '';
  browser.stderr.on('data', (chunk) => { browserErrors = (browserErrors + chunk.toString()).slice(-8000); });
  let socket;
  try {
    const deadline = Date.now() + 20000;
    const portFile = path.join(profile, 'DevToolsActivePort');
    while (!existsSync(portFile)) {
      assert.ok(Date.now() < deadline, 'Browser debugging port must become ready');
      assert.equal(browser.exitCode, null, 'Browser must remain running');
      await delay(50);
    }
    const port = (await readFile(portFile, 'utf8')).split('\n')[0];
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let sequence = 0;
    const pending = new Map();
    const networkFailures = [];
    const networkRequests = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.requestWillBeSent') networkRequests.set(message.params.requestId, { url: message.params.request.url, body: message.params.request.postData, loader: message.params.loaderId, document: message.params.documentURL, timestamp: message.params.timestamp });
      if (message.method === 'Network.loadingFailed') networkFailures.push({ ...message.params, request: networkRequests.get(message.params.requestId) });
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); }
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = async (expression, timeout = 10000) => {
      const until = Date.now() + timeout;
      while (!await evaluate(`Boolean(${expression})`)) {
        if (Date.now() >= until) assert.fail(`UI condition timed out: ${expression}\n${await evaluate('JSON.stringify({url: location.href, state: document.readyState, text: document.body.innerText})')}\n${JSON.stringify(networkFailures)}\nFixture requests: ${JSON.stringify(fixture.requests.slice(-20))}\nBrowser stderr: ${browserErrors}`);
        await delay(50);
      }
    };
    const button = (text) => `[...document.querySelectorAll('button')].find(element => element.textContent.trim() === ${JSON.stringify(text)})`;
    const click = async (text) => {
      const point = await evaluate(`(() => { const element = ${button(text)}; if (!element || element.disabled) return null; const bounds = element.getBoundingClientRect(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: bounds.width, height: bounds.height }; })()`);
      assert.ok(point && point.width > 0 && point.height > 0 && point.x > 0 && point.x < 460 && point.y > 0 && point.y < 900, `Button must be visible and clickable: ${text}`);
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    };
    await command('Network.enable');
    await command('Emulation.setDeviceMetricsOverride', { width: 460, height: 900, deviceScaleFactor: 1, mobile: false });
    let scenario = 0;
    const load = async () => {
      await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?scenario=${++scenario}#test-session` });
      await wait(`location.search === ${JSON.stringify(`?scenario=${scenario}`)} && document.readyState === 'complete' && ${button('Start Task')} && !document.querySelector('[role="alert"]') && document.querySelector('[aria-label="Task branches"]')?.textContent !== 'Checking task branches...'`, fixture.repositories.length ? 10000 : 35000);
    };
    const open = async () => { await click('Start Task'); await wait('document.querySelector("dialog[open]")'); };
    const running = async () => { await wait(`${button('Pause')}`); assert.equal(await evaluate('document.querySelector("dialog[open]") !== null'), false); };

    const addedConnection = fixture.connections.pop();
    await load();
    await wait('document.querySelector(\'[aria-label="Task branches"]\')?.textContent === "No branch created"');
    const connectionSelector = 'select[aria-label="Configure Jira connections"]';
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(connectionSelector)}).options.length`), 1);
    assert.equal(fixture.searches.at(-1).query, 'project = TESTONE');
    await evaluate('(() => { const input = document.querySelector("#jira-query"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "project = TESTEDITED"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
    fixture.connections.push(addedConnection);
    await evaluate('document.querySelector(\'button[title="Refresh"]\').click()');
    await wait(`document.querySelector(${JSON.stringify(connectionSelector)}).options.length === 2 && !document.querySelector(${JSON.stringify(connectionSelector)}).disabled`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(connectionSelector)}).value`), 'fixture');
    assert.equal(await evaluate('document.querySelector("#jira-query").value'), 'project = TESTEDITED');
    assert.deepEqual(await evaluate(`[...document.querySelector(${JSON.stringify(connectionSelector)}).options].map(option => ({ value: option.value, text: option.text, title: option.title }))`), [
      { value: 'fixture', text: 'Test repository one', title: 'https://jira.invalid' },
      { value: 'fixture-two', text: 'Test repository two', title: 'https://jira.invalid' },
    ]);
    assert.equal(fixture.searches.at(-1).repositoryId, 'fixture');
    assert.equal(fixture.searches.at(-1).query, 'project = TESTEDITED');
    const searchesBeforeFailure = fixture.searches.length;
    fixture.failConnections = true;
    await evaluate('document.querySelector(\'button[title="Refresh"]\').click()');
    await wait(`document.querySelector('[role="alert"]')?.textContent.includes('Test connection refresh failed') && !document.querySelector(${JSON.stringify(connectionSelector)}).disabled`);
    assert.equal(fixture.searches.length, searchesBeforeFailure);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(connectionSelector)}).options.length`), 2);
    fixture.failConnections = false;
    await evaluate('document.querySelector(\'button[title="Refresh"]\').click()');
    await wait(`!document.querySelector('[role="alert"]') && !document.querySelector(${JSON.stringify(connectionSelector)}).disabled`);
    for (const [id, query] of [['fixture-two', 'project = TESTTWO'], ['fixture', 'project = TESTONE']]) {
      const before = fixture.searches.length;
      await evaluate(`(() => { const select = document.querySelector(${JSON.stringify(connectionSelector)}); select.value = ${JSON.stringify(id)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await wait(`document.querySelector(${JSON.stringify(connectionSelector)}).value === ${JSON.stringify(id)} && !document.querySelector(${JSON.stringify(connectionSelector)}).disabled && document.querySelector('[aria-label="Task branches"]')?.textContent === 'No branch created'`);
      assert.equal(fixture.searches.length, before + 1);
      assert.equal(fixture.searches.at(-1).repositoryId, id);
      assert.equal(fixture.searches.at(-1).query, query);
      assert.equal(await evaluate('document.querySelector("#jira-query").value'), query);
    }
    assert.equal(fixture.creates.length, 0, 'Loading a card must never create a branch');
    await open();
    assert.equal(fixture.creates.length, 0);
    assert.equal(await evaluate('document.querySelector("dialog input").value'), 'bugfix/TEST-1-test-parent-bug');
    const baseSelector = 'dialog select[aria-label="Base branch"]';
    assert.deepEqual(await evaluate(`[...document.querySelector(${JSON.stringify(baseSelector)}).options].map(option => ({ value: option.value, text: option.text }))`), [
      { value: 'HEAD', text: 'Current HEAD (main)' },
      { value: 'refs/heads/main', text: 'main' },
      { value: 'refs/heads/develop', text: 'develop' },
      { value: 'refs/remotes/origin/develop', text: 'origin/develop' },
    ]);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).value`), 'HEAD');
    await evaluate(`(() => { const select = document.querySelector(${JSON.stringify(baseSelector)}); select.value = 'refs/heads/develop'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).value`), 'refs/heads/develop');
    assert.ok(await evaluate('(() => { const bounds = document.querySelector("dialog").getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; })()'));
    await click('Cancel');
    await wait('!document.querySelector("dialog")');
    assert.equal(await evaluate(`${button('Pause')} !== undefined`), false);

    const savedBranches = fixture.repositories[0].branches;
    fixture.repositories[0].branches = [];
    await open();
    assert.deepEqual(await evaluate(`[...document.querySelector(${JSON.stringify(baseSelector)}).options].map(option => option.value)`), ['HEAD']);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).disabled`), false);
    await click('Cancel');
    await wait('!document.querySelector("dialog")');
    fixture.repositories[0].branches = savedBranches;

    fixture.repositories = [fixture.repositories[0], { id: 'second-root', name: 'Second repository', base: 'develop', matches: [],
      branches: ['refs/remotes/origin/release'] }];
    await open();
    assert.equal(await evaluate(`${button('Create branch & start timer')}.disabled`), true);
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).disabled`), true);
    await evaluate('(() => { const select = document.querySelector("dialog select"); select.value = "test-root"; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await evaluate(`(() => { const select = document.querySelector(${JSON.stringify(baseSelector)}); select.value = 'refs/heads/develop'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evaluate('(() => { const select = document.querySelector("dialog select"); select.value = "second-root"; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).value`), 'HEAD');
    assert.deepEqual(await evaluate(`[...document.querySelector(${JSON.stringify(baseSelector)}).options].map(option => option.value)`), ['HEAD', 'refs/remotes/origin/release']);
    await evaluate(`(() => { const select = document.querySelector(${JSON.stringify(baseSelector)}); select.value = 'refs/remotes/origin/release'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evaluate('(() => { const select = document.querySelector(\'dialog select[aria-label="Branch type"]\'); select.value = "feature"; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await wait('document.querySelector("dialog input").value.startsWith("feature/")');
    await evaluate('(() => { const input = document.querySelector("dialog input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "feature/TEST-1-my-edited-name"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
    fixture.failCreate = true;
    fixture.holdCreate = true;
    await click('Create branch & start timer');
    try {
      await wait('document.querySelector("dialog") && [...document.querySelectorAll("dialog select, dialog input, dialog button")].every(element => element.disabled)');
      assert.equal(await evaluate(`${button('Pause')} !== undefined`), false);
      assert.equal(typeof fixture.finishCreate, 'function');
    } finally {
      fixture.holdCreate = false;
      fixture.finishCreate?.();
      fixture.finishCreate = null;
    }
    await wait('document.querySelector("dialog [role=alert]")');
    assert.equal(fixture.creates.length, 1);
    assert.equal(await evaluate('document.querySelector("dialog input").value'), 'feature/TEST-1-my-edited-name');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).value`), 'refs/remotes/origin/release');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(baseSelector)}).disabled`), false);
    fixture.failCreate = false;
    await evaluate('(() => { const form = document.querySelector("dialog form"); form.requestSubmit(); form.requestSubmit(); })()');
    await running();
    assert.equal(fixture.creates.length, 2, 'Repeated confirmation must submit once');
    assert.equal(fixture.creates[1].name, 'feature/TEST-1-my-edited-name');
    assert.equal(fixture.creates[1].root, 'second-root');
    assert.equal(fixture.creates[1].key, 'TEST-1');
    assert.equal(fixture.creates[0].base, 'refs/remotes/origin/release');
    assert.equal(fixture.creates[1].base, 'refs/remotes/origin/release');
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify('select[aria-label="Select an issue"]')}).value`), 'TEST-2');
    await click('Issues');
    await wait('document.querySelector(\'[aria-label="Task branches"]\')?.textContent === "feature/TEST-1-my-edited-name"');
    assert.ok(await evaluate('(() => { const branch = document.querySelector(\'[aria-label="Task branches"]\'); const title = document.querySelector(\'[title="Click to view full issue details"]\'); const bounds = branch.getBoundingClientRect(); return branch.previousElementSibling === title && bounds.top >= title.getBoundingClientRect().bottom && bounds.left >= 0 && bounds.right <= innerWidth; })()'));

    fixture.repositories = [{ id: 'test-root', name: 'Test repository', base: 'main', matches: ['refs/remotes/origin/feature/TEST-1'], branches: [] }];
    await load();
    assert.equal(await evaluate('document.querySelector(\'[aria-label="Task branches"]\').textContent'), 'origin/feature/TEST-1');
    await wait('document.querySelector(\'[data-branch-issue="TEST-2"]\')?.textContent === "origin/feature/TEST-1"');
    const snapshotDeadline = Date.now() + 10000;
    while (!fixture.snapshots.some((cards) => cards.some((card) => card.issueKey === 'TEST-2'
      && card.branchKey === 'TEST-1' && card.rendered === 'origin/feature/TEST-1'
      && card.branches.state === 'ready' && card.branches.names[0] === 'origin/feature/TEST-1'))) {
      assert.ok(Date.now() < snapshotDeadline, 'Diagnostics must capture parent branch state and rendered child card text');
      await delay(50);
    }
    fixture.repositories[0].matches = [];
    await evaluate('document.querySelector(\'button[title="Refresh"]\').click()');
    await wait('document.querySelector(\'[aria-label="Task branches"]\')?.textContent === "No branch created"');
    const longBranch = `feature/TEST-1-${'long-name-'.repeat(20)}end`;
    fixture.repositories[0].matches = ['refs/remotes/origin/feature/TEST-1', `refs/heads/${longBranch}`];
    await evaluate('document.querySelector(\'button[title="Refresh"]\').click()');
    await wait(`document.querySelector('[aria-label="Task branches"]')?.textContent === ${JSON.stringify(`origin/feature/TEST-1, ${longBranch}`)}`);
    assert.ok(await evaluate('(() => { const branch = document.querySelector(\'[aria-label="Task branches"] span\').getBoundingClientRect(); const start = [...document.querySelectorAll("button")].find(element => element.textContent.trim() === "Start Task").getBoundingClientRect(); return branch.right <= innerWidth && start.right <= innerWidth && start.bottom <= innerHeight && start.top >= branch.bottom; })()'));
    const checkedBefore = fixture.checks;
    await evaluate(`(() => { const start = ${button('Start Task')}; start.click(); start.click(); })()`);
    await running();
    assert.equal(fixture.checks, checkedBefore + 1, 'Repeated task activation must check once');
    assert.equal(fixture.creates.length, 2);

    fixture.tasks = [task, { ...task, id: '3', key: 'TEST-3', fields: { ...task.fields, summary: 'Sibling task' } }];
    const beforeSiblings = fixture.checks;
    await load();
    await wait('document.querySelectorAll(\'[aria-label="Task branches"]\').length === 2 && [...document.querySelectorAll(\'[aria-label="Task branches"]\')].every(element => element.textContent.startsWith("origin/feature/TEST-1"))');
    assert.equal(fixture.checks, beforeSiblings + 1, 'Sibling cards must share the parent branch lookup');
    fixture.tasks = null;

    fixture.repositories = [];
    await load();
    assert.equal(await evaluate('document.querySelector(\'[aria-label="Task branches"]\').textContent'), 'No branch created', `${await evaluate('document.querySelector(\'[aria-label="Task branches"]\').title')} ${JSON.stringify(networkFailures)}`);
    await open();
    assert.equal(await evaluate(`${button('Create branch & start timer')} === undefined`), true);
    await click('Start timer only');
    await running();
    assert.equal(fixture.creates.length, 2);

    fixture.failCheck = true;
    await load();
    assert.equal(await evaluate('document.querySelector(\'[aria-label="Task branches"]\').textContent'), 'Branch lookup failed');
    assert.equal(await evaluate('document.querySelector(\'[aria-label="Task branches"]\').title'), 'Test branch lookup failed');
    await click('Start Task');
    await wait('document.querySelector("[role=alert]")?.textContent.includes("Test branch lookup failed")');
    assert.equal(await evaluate('document.querySelector("dialog") !== null'), false);
    assert.equal(await evaluate(`${button('Pause')} !== undefined`), false);
    fixture.failCheck = false;
    await evaluate('document.querySelector(\'button[title="Refresh"]\').click()');
    await wait('document.querySelector(\'[aria-label="Task branches"]\')?.textContent === "No branch created"', 35000);
    await command('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Stockholm' });
    await open();
    await click('Start timer only');
    await running();
    assert.ok(await evaluate('document.body.innerText.includes("Started (system local time)")'));
    for (const [input, offset] of [['2026-07-24T09:30', '+02:00'], ['2026-10-29T09:30', '+01:00']]) {
      await evaluate(`(() => {
        const started = document.querySelector('input[type="datetime-local"]');
        const duration = started.closest('form').querySelector('input:not([type])');
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setValue.call(started, ${JSON.stringify(input)});
        started.dispatchEvent(new Event('input', { bubbles: true }));
        setValue.call(duration, '1m');
        duration.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      fixture.failWorklog = true;
      const before = fixture.requests.filter(request => request.operation === 'worklog').length;
      await click('Submit Worklog');
      await wait('document.querySelector("[role=alert]")?.textContent.includes("Test worklog rejected")');
      assert.equal(await evaluate('document.querySelector("input[type=datetime-local]").value'), input);
      assert.equal(fixture.requests.filter(request => request.operation === 'worklog').length, before + 1);
      fixture.failWorklog = false;
      await click('Submit Worklog');
      await wait('document.querySelector("[role=status]")?.textContent === "Saved to Jira." && !document.querySelector("[role=alert]")');
      await wait(`document.body.innerText.includes(${JSON.stringify(input.replace('T', ' ') + ':00')})`);
      assert.equal(fixture.requests.filter(request => request.operation === 'worklog').length, before + 2);
      assert.equal(fixture.worklogs.at(-1).started, `${input}:00${offset}`);
      assert.equal(await evaluate('document.querySelector("input[type=datetime-local]").closest("form").querySelector("input:not([type])").value'), '');
    }
  } finally {
    socket?.close();
    if (browser.exitCode === null) {
      const exited = new Promise((resolve) => browser.once('exit', resolve));
      browser.kill();
      await exited;
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function findBrowser() {
  const candidates = [
    process.env.CHROME_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error('Chrome or Edge executable is required to capture screenshots');
  return found;
}

const currentUser = {
  name: 'alex.rivera',
  key: 'alex.rivera',
  displayName: 'Alex Rivera',
};

const issues = [
  {
    id: '101',
    key: 'ACME-101',
    fields: {
      summary: 'Implement OAuth2 PKCE token refresh flow for API Gateway',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' },
      priority: { name: 'High' },
      assignee: currentUser,
      reporter: { name: 'maya.chen', displayName: 'Maya Chen' },
      description:
        'Add automatic OAuth2 PKCE access token rotation with jittered backoff before expiry.\n\nAcceptance Criteria:\n- Refresh token 60s prior to expiration\n- Deduplicate concurrent refresh calls across worker threads\n- Emit structured telemetry metrics on token refresh latency',
      components: [{ name: 'Auth Service' }, { name: 'API Gateway' }],
      fixVersions: [{ name: '2026.2.0' }],
      labels: ['security', 'oauth2', 'backend'],
      timetracking: { originalEstimate: '6h', timeSpent: '2h 30m' },
      created: '2026-11-10T09:15:00.000+0100',
      updated: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      customfield_10020: [{ name: 'Sprint 24 - Auth & Perf', state: 'active' }],
      subtasks: [
        {
          id: '102',
          key: 'ACME-102',
          fields: {
            summary: 'Add PKCE code verifier and SHA-256 challenge generator',
            status: { name: 'Done', statusCategory: { key: 'done' } },
          },
        },
        {
          id: '103',
          key: 'ACME-103',
          fields: {
            summary: 'Wire concurrent refresh lock and retry interceptor',
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          },
        },
      ],
    },
  },
  {
    id: '104',
    key: 'ACME-104',
    fields: {
      summary: 'Fix race condition in WebSocket reconnect handler',
      status: { name: 'Open', statusCategory: { key: 'new' } },
      issuetype: { name: 'Bug' },
      priority: { name: 'Highest' },
      assignee: currentUser,
      reporter: { name: 'liam.patel', displayName: 'Liam Patel' },
      description:
        'When network connectivity drops briefly during an active subscription handshake, duplicate listener sockets can remain open.',
      components: [{ name: 'Realtime Sync' }],
      fixVersions: [{ name: '2026.2.0' }],
      labels: ['websocket', 'concurrency'],
      timetracking: { originalEstimate: '3h', timeSpent: '45m' },
      created: '2026-11-12T14:20:00.000+0100',
      updated: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
      customfield_10020: [{ name: 'Sprint 24 - Auth & Perf', state: 'active' }],
      subtasks: [],
    },
  },
  {
    id: '108',
    key: 'ACME-108',
    fields: {
      summary: 'Add Prometheus latency histograms for rate-limiter middleware',
      status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Task' },
      priority: { name: 'Medium' },
      assignee: currentUser,
      reporter: currentUser,
      description: 'Expose p50, p95, and p99 bucket histograms on /metrics for Redis token bucket evaluations.',
      components: [{ name: 'Observability' }],
      fixVersions: [{ name: '2026.2.0' }],
      labels: ['prometheus', 'metrics'],
      timetracking: { originalEstimate: '4h', timeSpent: '3h 15m' },
      created: '2026-11-11T11:00:00.000+0100',
      updated: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      customfield_10020: [{ name: 'Sprint 24 - Auth & Perf', state: 'active' }],
      subtasks: [],
    },
  },
];

const worklogsByKey = {
  'ACME-101': [
    {
      id: 'wl-1',
      author: currentUser,
      started: '2026-11-15T10:00:00.000+0100',
      timeSpent: '1h 30m',
      comment: 'Implemented PKCE verifier generator and unit test suite',
    },
    {
      id: 'wl-2',
      author: currentUser,
      started: '2026-11-15T14:15:00.000+0100',
      timeSpent: '1h',
      comment: 'Added single-flight lock around token refresh endpoint',
    },
  ],
};

const commentsByKey = {
  'ACME-101': [
    {
      id: 'c-1',
      author: { name: 'maya.chen', displayName: 'Maya Chen' },
      created: '2026-11-14T16:40:00.000+0100',
      body: 'Please make sure the refresh grace window is configurable via gateway.auth.refreshSkewSeconds.',
    },
    {
      id: 'c-2',
      author: currentUser,
      created: '2026-11-15T11:20:00.000+0100',
      body: 'Done! Defaulted to 60s with full override support in application.yml.',
    },
  ],
};

const transitions = [
  { id: '21', name: 'In Progress', to: { name: 'In Progress' } },
  { id: '31', name: 'In Review', to: { name: 'In Review' } },
  { id: '41', name: 'Done', to: { name: 'Done' } },
];

const futureStart = (minutesFromNow) => new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();

const meetings = [
  {
    id: 'mtg-standup-01',
    seriesKey: 'series-daily-standup',
    title: 'Daily Platform Engineering Standup',
    start: futureStart(25),
    end: futureStart(40),
    durationMinutes: 15,
    durationFormatted: '15m',
    organizer: 'Maya Chen',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/acme-standup-demo',
    isRecurring: true,
    isTeamsMeeting: true,
  },
  {
    id: 'mtg-arch-02',
    seriesKey: 'series-oauth-review',
    title: '[ACME-101] OAuth2 PKCE Security Architecture Review',
    start: futureStart(90),
    end: futureStart(135),
    durationMinutes: 45,
    durationFormatted: '45m',
    organizer: 'Alex Rivera',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/acme-oauth-review',
    isRecurring: false,
    isTeamsMeeting: true,
  },
  {
    id: 'mtg-retro-03',
    seriesKey: 'series-sprint-retro',
    title: 'Sprint 24 Telemetry & Rate-Limiter Sync',
    start: futureStart(210),
    end: futureStart(240),
    durationMinutes: 30,
    durationFormatted: '30m',
    organizer: 'Liam Patel',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/acme-retro-demo',
    isRecurring: true,
    isTeamsMeeting: true,
  },
];

const mappings = [
  {
    matchKey: 'series-daily-standup',
    matchType: 'series',
    issueKey: 'ACME-101',
    issueTitle: 'Implement OAuth2 PKCE token refresh flow for API Gateway',
    meetingTitle: 'Daily Platform Engineering Standup',
  },
  {
    matchKey: 'series-sprint-retro',
    matchType: 'series',
    issueKey: 'ACME-108',
    issueTitle: 'Add Prometheus latency histograms for rate-limiter middleware',
    meetingTitle: 'Sprint 24 Telemetry & Rate-Limiter Sync',
  },
];

const dist = resolve('dist');
const outDir = resolve('screenshots');
await mkdir(outDir, { recursive: true });

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/api/jira') {
    const body = JSON.parse(await new Promise((resolveBody) => {
      let text = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { text += chunk; });
      request.on('end', () => resolveBody(text || '{}'));
    }));

    const send = (payload, status = 200) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };

    if (body.operation === 'connections') {
      return send([
        {
          id: 'acme-cloud',
          name: 'Acme Cloud Platform',
          url: 'https://jira.acme.example',
          query: 'assignee = currentUser() AND sprint in openSprints() ORDER BY priority DESC',
          commitMessageTemplate: '{issueKey}: {summary}',
        },
      ]);
    }
    if (body.operation === 'myself') return send(currentUser);
    if (body.operation === 'search') return send(issues);
    if (body.operation === 'issue') {
      const found = issues.find((item) => item.key === body.key) || issues[0];
      return send(found);
    }
    if (body.operation === 'remotes') return send({ urls: ['https://github.com/acme-corp/api-gateway.git'] });
    if (body.operation === 'devBranches') {
      if (body.key === 'ACME-101') {
        return send([{ name: 'feature/ACME-101-oauth2-pkce-refresh', repositoryUrl: 'https://github.com/acme-corp/api-gateway.git' }]);
      }
      if (body.key === 'ACME-108') {
        return send([{ name: 'feature/ACME-108-prometheus-metrics', repositoryUrl: 'https://github.com/acme-corp/api-gateway.git' }]);
      }
      return send([]);
    }
    if (body.operation === 'branches') {
      const matches =
        body.key === 'ACME-101'
          ? ['refs/heads/feature/ACME-101-oauth2-pkce-refresh']
          : body.key === 'ACME-108'
            ? ['refs/heads/feature/ACME-108-prometheus-metrics']
            : [];
      return send({
        suggestedName: `bugfix/${body.key}-fix-websocket-reconnect-race`,
        repositories: [
          {
            id: 'repo-gateway',
            name: 'acme-api-gateway',
            base: 'main',
            matches,
            branches: ['refs/heads/main', 'refs/heads/develop', 'refs/remotes/origin/main'],
          },
        ],
      });
    }
    if (body.operation === 'worklogs') {
      return send(worklogsByKey[body.key] || []);
    }
    if (body.operation === 'comments') {
      return send(commentsByKey[body.key] || []);
    }
    if (body.operation === 'transitions') {
      return send({ transitions });
    }
    if (body.operation === 'teamsMeetings') {
      return send({
        configured: true,
        mode: 'ics',
        icsUrl: 'https://outlook.office365.com/owa/calendar/acme-demo/reachcalendar.ics',
        hasGraphToken: false,
        meetings,
        mappings,
      });
    }
    return send({ ok: true });
  }

  const file = resolve(dist, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
  if (!existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const content = await readFile(file);
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  response.end(content);
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const profile = await mkdtemp(join(tmpdir(), 'jira-screenshots-'));
const browser = spawn(
  findBrowser(),
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let socket;
try {
  const devtoolsUrl = await new Promise((resolveUrl, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out starting Chrome: ${output}`)), 10000);
    browser.stderr.setEncoding('utf8');
    browser.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    browser.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited (${code}): ${output}`));
    });
  });

  const debugPort = new URL(devtoolsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: resolveCommand, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveCommand(message.result);
    }
  });

  const command = (method, params = {}) =>
    new Promise((resolveCommand, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolveCommand, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };

  const wait = async (expression, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await delay(50);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };

  const capture = async (filename) => {
    await delay(250);
    const { data } = await command('Page.captureScreenshot', { format: 'png' });
    const filePath = join(outDir, filename);
    await writeFile(filePath, Buffer.from(data, 'base64'));
    console.log(`Saved ${filePath}`);
  };

  await command('Page.enable');
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 560,
    height: 880,
    deviceScaleFactor: 2,
    mobile: false,
  });

  // 1. Issues Tab
  await command('Page.navigate', { url: `http://127.0.0.1:${port}/#demo-session` });
  await wait('document.body.innerText.includes("ACME-101") && document.body.innerText.includes("ACME-104")');
  await wait('document.querySelector(\'[data-branch-issue="ACME-101"]\')?.textContent?.includes("feature/ACME-101")');
  await wait('document.querySelector(\'[data-branch-issue="ACME-104"]\')?.textContent?.includes("No branch created")');
  await capture('01-issues-tab.png');

  // 2. Create Branch Dialog (click Start on ACME-104 which has no existing branch)
  await evaluate(`(() => {
    const branchEl = document.querySelector('[data-branch-issue="ACME-104"]');
    const card = branchEl?.parentElement;
    const startBtn = [...(card?.querySelectorAll('button') || [])].find(b => b.textContent.trim().startsWith('Start'));
    startBtn?.click();
  })()`);
  await wait('document.querySelector("dialog")?.innerText.includes("Create a branch for this task?")');
  await capture('02-branch-dialog.png');

  // Close dialog
  await evaluate(`(() => {
    const cancel = [...document.querySelectorAll('dialog button')].find(b => b.textContent.trim() === 'Cancel');
    cancel?.click();
  })()`);
  await wait('!document.querySelector("dialog")');

  // 3. Details Tab (open ACME-101 details)
  await evaluate(`(() => {
    const branchEl = document.querySelector('[data-branch-issue="ACME-101"]');
    const card = branchEl?.parentElement;
    const title = card?.querySelector('[title="Click to view full issue details"]');
    title?.click();
  })()`);
  await wait('document.body.innerText.includes("Maya Chen") && document.body.innerText.includes("Track Time")');
  await capture('03-details-tab.png');

  // 4. Tracker Tab (start tracking on ACME-101 and advance timer display for a realistic screenshot)
  await evaluate(`(() => {
    const startBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Track Time'));
    startBtn?.click();
  })()`);
  await wait('document.body.innerText.includes("Stage Worklog") && document.body.innerText.includes("Implemented PKCE verifier")');
  await evaluate(`(() => {
    const durationInput = document.querySelector('input[type="datetime-local"]')?.closest('form')?.querySelector('input:not([type])');
    if (durationInput) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(durationInput, '1h 30m');
      durationInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const commentInput = document.querySelector('textarea');
    if (commentInput) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(commentInput, 'Completed OAuth2 PKCE refresh retry logic and integration tests');
      commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await delay(1200);
  await capture('04-tracker-tab.png');

  // Stage the Tracker worklog
  await evaluate(`(() => {
    const stageBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Stage Worklog'));
    stageBtn?.click();
  })()`);
  await delay(200);

  // 5. Meetings Tab (open Meetings tab showing synced Teams meetings & linked Jira tickets)
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Meetings'));
    tab?.click();
  })()`);
  await wait('document.body.innerText.includes("Daily Platform Engineering Standup") && document.body.innerText.includes("OAuth2 PKCE Security Architecture Review")');
  await capture('05-meetings-tab.png');

  // Stage two Teams meetings and capture the new Staged tab
  await evaluate(`(() => {
    const stageButtons = [...document.querySelectorAll('button')].filter(b => b.textContent.includes('Stage Meeting Time'));
    stageButtons[0]?.click();
    stageButtons[1]?.click();
  })()`);
  await delay(200);

  // 6. Staged Worklogs Tab
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Staged'));
    tab?.click();
  })()`);
  await wait('document.body.innerText.includes("Log All to Jira (3)") && document.body.innerText.includes("2h 30m")');
  await capture('06-staged-tab.png');
} finally {
  socket?.close();
  if (browser.exitCode === null) {
    const exited = new Promise((resolveExit) => browser.once('exit', resolveExit));
    browser.kill();
    await exited;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

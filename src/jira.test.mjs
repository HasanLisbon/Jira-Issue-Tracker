import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { mapIssue, cestInput, worklogStarted, jiraRequest, formatCommitMessage, resolveMeetingTicket } = await tsImport('./jira.ts', import.meta.url);
const { prepareTracking, branchNames, repositoryKey, belongsToRepository } = await tsImport('./branches.ts', import.meta.url);

test('normalizes web, https and ssh repository URLs to the same key', () => {
  const keys = ['https://git.test/projects/PROJ/repos/Repo/browse', 'https://git.test/scm/proj/repo.git',
    'ssh://git@git.test:7999/proj/repo.git', 'git@git.test:proj/repo.git'].map(repositoryKey);
  assert.deepEqual(keys.slice(1), ['proj/repo', 'proj/repo', 'proj/repo']);
  assert.equal(repositoryKey('https://git.test/projects/PROJ/repos/Repo'), 'proj/repo');
});

test('hides a task only when all its linked branches belong to other repositories', () => {
  const origins = ['https://git.test/scm/proj/repo.git'];
  assert.equal(belongsToRepository([], origins), true);
  assert.equal(belongsToRepository([{ name: 'a', repositoryUrl: 'https://git.test/scm/proj/other.git' }], origins), false);
  assert.equal(belongsToRepository([{ name: 'a', repositoryUrl: 'https://git.test/scm/proj/other.git' },
    { name: 'b', repositoryUrl: 'ssh://git@git.test:7999/proj/repo.git' }], origins), true);
  assert.equal(belongsToRepository([{ name: 'a', repositoryUrl: 'https://git.test/scm/x/y.git' }], []), true);
  assert.equal(belongsToRepository([{ name: 'a', repositoryUrl: 'https://git.test/scm/x/y.git' }], origins, ['feature/T-1']), true);
});

test('displays branch names without ref prefixes while keeping remote identity and removing duplicates', () => {
  assert.deepEqual(branchNames({ repositories: [] }), []);
  assert.deepEqual(branchNames({ repositories: [{ matches: ['refs/heads/feature/TEST-1'] }] }), ['feature/TEST-1']);
  assert.deepEqual(branchNames({ repositories: [
    { matches: ['refs/heads/feature/TEST-1', 'refs/remotes/origin/bugfix/TEST-1'] },
    { matches: ['refs/heads/feature/TEST-1'] },
  ] }), ['feature/TEST-1', 'origin/bugfix/TEST-1']);
});

test('checks the parent ticket branch but leaves subtask timer identity unchanged', async () => {
  const calls = [];
  const request = async (operation, parameters) => {
    calls.push({ operation, parameters });
    if (operation === 'issue') return parameters.key === 'TEST-2'
      ? { key: 'TEST-2', fields: { summary: 'Subtask', parent: { key: 'TEST-1' } } }
      : { key: 'TEST-1', fields: { summary: 'Parent bug', issuetype: { name: 'Bug' } } };
    return { suggestedName: 'bugfix/TEST-1-parent-bug', repositories: [{ id: 'root', matches: ['refs/heads/bugfix/TEST-1'] }] };
  };
  const plan = await prepareTracking('connection', 'TEST-2', request);
  assert.equal(plan.key, 'TEST-1');
  assert.equal(plan.suggestedName, 'bugfix/TEST-1-parent-bug');
  assert.deepEqual(calls, [
    { operation: 'issue', parameters: { repositoryId: 'connection', key: 'TEST-2' } },
    { operation: 'issue', parameters: { repositoryId: 'connection', key: 'TEST-1' } },
    { operation: 'branches', parameters: { key: 'TEST-1', type: 'Bug', summary: 'Parent bug' } },
  ]);
});

test('checks a standalone ticket without fetching a nonexistent parent or creating branches', async () => {
  const operations = [];
  const plan = await prepareTracking('connection', 'TEST-1', async (operation) => {
    operations.push(operation);
    return operation === 'issue'
      ? { key: 'TEST-1', fields: { summary: 'Task', issuetype: { name: 'Task' } } }
      : { suggestedName: 'feature/TEST-1-task', repositories: [] };
  });
  assert.deepEqual(operations, ['issue', 'branches']);
  assert.deepEqual(plan.repositories, []);
});

test('propagates parent and branch lookup failures instead of offering unverified creation', async () => {
  for (const failureAt of ['issue', 'branches']) {
    await assert.rejects(prepareTracking('connection', 'TEST-1', async (operation) => {
      if (operation === failureAt) throw new Error('Lookup failed');
      return { key: 'TEST-1', fields: { summary: 'Task' } };
    }), /Lookup failed/);
  }
});

test('formats commit messages with issue key and summary placeholders', () => {
  assert.equal(typeof formatCommitMessage, 'function');
  assert.equal(
    formatCommitMessage('{issueKey}: {summary} ({issueKey})', {
      key: 'TEST-1',
      title: 'Summary $&',
    }),
    'TEST-1: Summary $& (TEST-1)',
  );
  assert.equal(
    formatCommitMessage('No known token: {other}', {
      key: 'TEST-1',
      title: 'Summary',
    }),
    'No known token: {other}',
  );
});

test('maps Jira values without replacing workflow names with demo statuses', () => {
  const issue = mapIssue({ id: '1', key: 'TEST-1', fields: {
    summary: 'Real Jira issue', status: { name: 'Ready for verification' },
    priority: { name: 'Highest' }, assignee: { name: 'tester', displayName: 'Test User' },
    reporter: { name: 'reporter', displayName: 'Test Reporter' },
    timetracking: { originalEstimate: '4h', timeSpent: '1h' },
    parent: { key: 'TEST-2' }, description: '<script>not HTML</script>',
  } }, { name: 'tester' });
  assert.equal(issue.status, 'Ready for verification');
  assert.equal(issue.timeSpent, '1h');
  assert.equal(issue.estimate, '4h');
  assert.equal(issue.assignee.name, 'Test User');
  assert.equal(issue.assignee.isCurrentUser, true);
  assert.equal(issue.parentKey, 'TEST-2');
  assert.equal(issue.description, '<script>not HTML</script>');
  assert.deepEqual(issue.filterTags, ['assigned']);
});

test('maps empty, single and multiple subtasks including mixed completion', () => {
  for (const count of [0, 1, 3]) {
    const subtasks = Array.from({ length: count }, (_, index) => ({
      id: String(index), key: `TEST-${index + 2}`, fields: {
        summary: 'Subtask', status: { name: index === 0 ? 'Closed' : 'Open', statusCategory: { key: index === 0 ? 'done' : 'new' } },
      },
    }));
    const issue = mapIssue({ id: '1', key: 'TEST-1', fields: { summary: 'Parent', status: { name: 'Open' }, subtasks, assignee: null, reporter: null, description: null } });
    assert.equal(issue.subtasks.length, count);
    assert.equal(issue.assignee.name, '');
    assert.equal(issue.description, '');
    if (count) assert.equal(issue.progress.doneCount, 1);
    else assert.equal(issue.progress, undefined);
  }
});

test('maps discovered sprint fields in both Server representations', () => {
  const issue = mapIssue({ id: '1', key: 'TEST-1', fields: {
    summary: 'Issue', status: { name: 'Open' },
    customfield_123: [{ name: 'Active sprint', state: 'active' }],
    customfield_456: ['Sprint@123[id=1,name=Prior sprint,state=CLOSED]'],
  } });
  assert.equal(issue.sprintInfo, 'Active sprint, Prior sprint');
});

test('formats and submits worklogs using the system timezone at the entered date', () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const [timezone, input, offset] of [
      ['Europe/Stockholm', '2026-07-24T09:30', '+02:00'],
      ['Europe/Stockholm', '2026-10-29T09:30', '+01:00'],
      ['Europe/Stockholm', '2026-10-25T01:30', '+02:00'],
      ['Europe/Stockholm', '2026-10-25T03:30', '+01:00'],
      ['Asia/Kolkata', '2026-10-29T00:30', '+05:30'],
      ['America/New_York', '2026-10-29T23:30', '-04:00'],
      ['UTC', '2026-10-29T00:30', '+00:00'],
    ]) {
      process.env.TZ = timezone;
      assert.equal(cestInput(new Date(`${input}:00${offset}`)), input);
      assert.equal(worklogStarted(input), `${input}:00${offset}`);
    }
    process.env.TZ = 'Europe/Stockholm';
    for (const input of ['', 'invalid', '2026-02-30T09:30', '2026-03-29T02:30']) {
      assert.throws(() => worklogStarted(input));
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('sends Jira actions through the authenticated local bridge and propagates rejection', async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.window = { location: { hash: '#local-session' } };
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: '123' }), { status: 200 });
    };
    const result = await jiraRequest('comment', { repositoryId: 'configured', key: 'TEST-1', body: 'Reply', replyTo: '42' });
    assert.equal(result.id, '123');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/jira');
    assert.equal(requests[0].options.headers['X-Jira-Session'], 'local-session');
    assert.deepEqual(JSON.parse(requests[0].options.body), { operation: 'comment', repositoryId: 'configured', key: 'TEST-1', body: 'Reply', replyTo: '42' });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Denied' }), { status: 403 });
    await assert.rejects(jiraRequest('worklog'), /Denied/);
    globalThis.window.location.hash = '';
    await assert.rejects(jiraRequest('connections'), /bridge.unavailable/);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test('resolves meeting Jira tickets from instance mapping, recurring series mapping, and title keys', () => {
  const issues = [{ key: 'PROJ-10', title: 'Sprint Ceremony' }, { key: 'PROJ-99', title: 'Specific Review' }];
  const mappings = [
    { matchKey: 'daily standup', matchType: 'series', meetingTitle: 'Daily Standup', issueKey: 'PROJ-10', issueTitle: 'Fallback' },
    { matchKey: 'evt-override', matchType: 'instance', meetingTitle: 'Daily Standup', issueKey: 'PROJ-99', issueTitle: '' },
  ];

  const seriesResolved = resolveMeetingTicket(
    { id: 'evt-1', seriesKey: 'daily standup', title: 'Daily Standup' },
    mappings,
    issues,
  );
  assert.deepEqual(seriesResolved, {
    issueKey: 'PROJ-10',
    issueTitle: 'Sprint Ceremony',
    source: 'series',
    matchKey: 'daily standup',
    matchType: 'series',
  });

  const instanceResolved = resolveMeetingTicket(
    { id: 'evt-override', seriesKey: 'daily standup', title: 'Daily Standup' },
    mappings,
    issues,
  );
  assert.deepEqual(instanceResolved, {
    issueKey: 'PROJ-99',
    issueTitle: 'Specific Review',
    source: 'instance',
    matchKey: 'evt-override',
    matchType: 'instance',
  });

  const autoResolved = resolveMeetingTicket(
    { id: 'evt-2', seriesKey: 'refinement', title: '[PROJ-10] Backlog Refinement' },
    [],
    issues,
  );
  assert.equal(autoResolved.issueKey, 'PROJ-10');
  assert.equal(autoResolved.issueTitle, 'Sprint Ceremony');
  assert.equal(autoResolved.source, 'auto');

  const unlinked = resolveMeetingTicket(
    { id: 'evt-3', seriesKey: 'coffee', title: 'Team Coffee' },
    mappings,
    issues,
  );
  assert.equal(unlinked, null);
});

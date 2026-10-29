import type { JiraIssue, Subtask } from './types.ts';

export interface JiraConnection {
  id: string;
  name: string;
  url: string;
  query: string;
  commitMessageTemplate: string;
}

export interface JiraUser {
  name?: string;
  key?: string;
  displayName?: string;
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  created: string;
  body: string;
}

export interface JiraWorklog {
  id: string;
  author: JiraUser;
  started: string;
  timeSpent: string;
  comment?: string;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

interface NamedValue { name: string }
export interface RawIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: NamedValue & { statusCategory?: { key: string } };
    issuetype?: NamedValue;
    priority?: NamedValue;
    assignee?: JiraUser;
    reporter?: JiraUser;
    description?: string | null;
    components?: NamedValue[];
    fixVersions?: NamedValue[];
    timetracking?: { originalEstimate?: string; timeSpent?: string };
    subtasks?: RawIssue[];
    parent?: { key: string };
    labels?: string[];
    created?: string;
    updated?: string;
    resolution?: unknown;
    [key: string]: unknown;
  };
}

export async function jiraRequest<T>(operation: string, parameters: Record<string, unknown> = {}): Promise<T> {
  const session = window.location.hash.slice(1);
  if (!session) throw new Error('bridge.unavailable');
  const response = await fetch('/api/jira', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jira-Session': session },
    body: JSON.stringify({ ...parameters, operation }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Jira HTTP ${response.status}`);
  return result as T;
}

export function formatCommitMessage(
  template: string,
  issue: Pick<JiraIssue, 'key' | 'title'>,
): string {
  return template
    .replace(/\{issueKey\}/g, () => issue.key)
    .replace(/\{summary\}/g, () => issue.title);
}

export function initials(name: string): string {
  return name.split(/\s+/).map((part) => part[0] || '').slice(0, 2).join('').toUpperCase();
}

export function mapIssue(issue: RawIssue, currentUser?: JiraUser): JiraIssue {
  const fields = issue.fields;
  const name = fields.assignee?.displayName || '';
  const reporter = fields.reporter?.displayName || '';
  const type = fields.issuetype?.name.toLowerCase();
  const subtasks: Subtask[] = (fields.subtasks || []).map((subtask) => ({
    id: subtask.id, key: subtask.key, title: subtask.fields.summary,
    status: subtask.fields.status.name,
    done: subtask.fields.status.statusCategory?.key === 'done',
  }));
  const sprintNames = Object.entries(fields).filter(([key]) => key.startsWith('customfield_')).flatMap(([, value]) => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((sprint: unknown) => {
      if (typeof sprint === 'object' && sprint !== null && 'name' in sprint && 'state' in sprint) {
        return [String(sprint.name)];
      }
      if (typeof sprint === 'string' && sprint.includes('Sprint@')) {
        const match = sprint.match(/(?:\[|,)name=([^,\]]+)/);
        return match ? [match[1]] : [];
      }
      return [];
    });
  });
  const assigned = !!currentUser && !!fields.assignee
    && (fields.assignee.name === currentUser.name && !!currentUser.name || fields.assignee.key === currentUser.key && !!currentUser.key);
  const reported = !!currentUser && !!fields.reporter
    && (fields.reporter.name === currentUser.name && !!currentUser.name || fields.reporter.key === currentUser.key && !!currentUser.key);
  const doneCount = subtasks.filter((subtask) => subtask.done).length;
  return {
    id: issue.id, key: issue.key, title: fields.summary, status: fields.status.name,
    type: type === 'epic' || type === 'bug' || type === 'story' ? type : 'task',
    priority: fields.priority?.name.toUpperCase() || '',
    assignee: { name, initials: initials(name), color: 'bg-[#3B68FF]', isCurrentUser: assigned },
    reporter: { name: reporter, initials: initials(reporter) },
    description: fields.description || '',
    component: fields.components?.map((component) => component.name).join(', '),
    version: fields.fixVersions?.map((version) => version.name).join(', '),
    estimate: fields.timetracking?.originalEstimate || '', timeSpent: fields.timetracking?.timeSpent,
    labels: fields.labels, createdDate: fields.created, updatedDate: fields.updated,
    parentKey: fields.parent?.key, subtasks,
    sprintInfo: sprintNames.join(', '),
    progress: subtasks.length ? { doneCount, totalCount: subtasks.length, percent: Math.round(doneCount / subtasks.length * 100) } : undefined,
    filterTags: [
      ...(assigned ? ['assigned' as const] : []), ...(reported ? ['reported' as const] : []),
      ...(fields.updated && Date.parse(fields.updated) >= Date.now() - 7 * 86400000 ? ['recent' as const] : []),
      ...(sprintNames.length ? ['sprint' as const] : []),
    ],
  };
}

export function cestInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function worklogStarted(input: string): string {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime()) || cestInput(date) !== input) throw new Error('started.invalid');
  const offset = -date.getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
  return `${input}:00${offset < 0 ? '-' : '+'}${hours}:${minutes}`;
}

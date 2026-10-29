import { jiraRequest } from './jira.ts';
import type { RawIssue } from './jira.ts';

export interface BranchPlan {
  key: string;
  suggestedName: string;
  repositories: Array<{ id: string; name: string; base: string; branches: string[]; matches: string[] }>;
}

export type TaskBranches = { state: 'ready'; names: string[] } | { state: 'error'; message: string };

export function branchNames(plan: Pick<BranchPlan, 'repositories'>): string[] {
  return [...new Set(plan.repositories.flatMap((repository) => repository.matches
    .map((branch) => branch.replace(/^refs\/(heads|remotes)\//, ''))))];
}

// The IDE reports no git repositories until its VCS initialisation finishes; retry instead of caching "no branch".
export async function lookupBranches(
  request: () => Promise<Omit<BranchPlan, 'key'>>,
  isCancelled: () => boolean = () => false,
  attempts = 15,
  delayMs = 2000,
): Promise<Omit<BranchPlan, 'key'>> {
  for (let attempt = 1; ; attempt++) {
    const plan = await request();
    if (plan.repositories.length || attempt >= attempts || isCancelled()) return plan;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (isCancelled()) return plan;
  }
}

export function repositoryKey(url: string): string {
  const path = url.trim().replace(/^[a-z+]+:\/\/[^/]*/i, '').replace(/^[^@/]*@[^:/]+:/, '')
    .replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = path.split('/').filter(Boolean);
  const repos = parts.indexOf('repos');
  if (repos >= 2 && parts[repos - 2] === 'projects' && parts[repos + 1]) return `${parts[repos - 1]}/${parts[repos + 1]}`.toLowerCase();
  return parts.filter((part) => part !== 'scm').slice(-2).join('/').toLowerCase();
}

export interface DevBranch { name: string; repositoryUrl?: string }

export function belongsToRepository(linked: DevBranch[], originUrls: string[], localBranches: string[] = []): boolean {
  const origins = new Set(originUrls.map(repositoryKey).filter(Boolean));
  if (!origins.size || !linked.length || localBranches.length) return true;
  return linked.some((branch) => !branch.repositoryUrl || origins.has(repositoryKey(branch.repositoryUrl)));
}

export async function prepareTracking(
  repositoryId: string,
  key: string,
  request: typeof jiraRequest = jiraRequest,
): Promise<BranchPlan> {
  const task = await request<RawIssue>('issue', { repositoryId, key });
  const parent = task.fields.parent
    ? await request<RawIssue>('issue', { repositoryId, key: task.fields.parent.key }) : task;
  const result = await request<Omit<BranchPlan, 'key'>>('branches', {
    key: parent.key, type: parent.fields.issuetype?.name || 'task', summary: parent.fields.summary,
  });
  return { ...result, key: parent.key };
}

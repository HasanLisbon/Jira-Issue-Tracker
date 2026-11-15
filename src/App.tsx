/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { TopBar } from './TopBar.tsx';
import { IssuesScreen } from './IssuesScreen.tsx';
import { DetailsTab } from './DetailsTab.tsx';
import { TrackerTab } from './TrackerTab.tsx';
import { MeetingsTab } from './MeetingsTab.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { jiraRequest, mapIssue, evaluateMeetingTimerCollision, findCollidingMeetings } from './jira.ts';
import type { JiraConnection, JiraUser, RawIssue } from './jira.ts';
import type { ActiveTab, ActiveTimer, JiraIssue, Subtask, FilterKey, TeamsMeeting, TeamsMeetingsResponse, MeetingTimerPause } from './types.ts';
import { messages } from './messages.ts';
import { prepareTracking, branchNames, belongsToRepository, lookupBranches } from './branches.ts';
import type { BranchPlan, DevBranch, TaskBranches } from './branches.ts';
import { BranchDialog } from './BranchDialog.tsx';

export default function App() {
  const [connections, setConnections] = useState<JiraConnection[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey | 'all'>('all');
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [user, setUser] = useState<JiraUser>();
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [activeTab, setActiveTab] = useState<ActiveTab>('issues');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [writing, setWriting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer>({ issueKey: '', issueTitle: '', seconds: 0, isRunning: false });
  const [meetings, setMeetings] = useState<TeamsMeeting[]>([]);
  const [pausedByMeeting, setPausedByMeeting] = useState<MeetingTimerPause | null>(null);
  const dismissedMeetings = useRef<Set<string>>(new Set());
  const generation = useRef(0);
  const writeLock = useRef(false);
  const branchLock = useRef(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState('');
  const [branchFlow, setBranchFlow] = useState<{ issue: { key: string; title: string }; plan: BranchPlan } | null>(null);
  const [taskBranches, setTaskBranches] = useState<Record<string, TaskBranches>>({});
  const [linkedBranches, setLinkedBranches] = useState<Record<string, DevBranch[]>>({});
  const [originUrls, setOriginUrls] = useState<string[]>([]);
  const visibleIssues = issues.filter((issue) => {
    const key = issue.parentKey || issue.key;
    const local = taskBranches[key];
    return belongsToRepository(linkedBranches[key] || [], originUrls, local?.state === 'ready' ? local.names : []);
  });
  const interactionPending = writing || branchBusy || !!branchFlow;
  const connection = connections.find((candidate) => candidate.id === connectionId);
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId);

  const describeError = (failure: unknown) => {
    const text = failure instanceof Error ? failure.message : messages['request.failed'];
    return messages[text] || text;
  };

  async function loadConnections() {
    try {
      const loaded = await jiraRequest<JiraConnection[]>('connections');
      setConnections(loaded);
      if (!loaded.some((candidate) => candidate.id === connectionId)) {
        setConnectionId(loaded[0]?.id || '');
        setQuery(loaded[0]?.query || '');
      }
      setError('');
      return loaded;
    } catch (failure) {
      setError(describeError(failure));
    }
  }

  async function loadMeetingsBackground() {
    try {
      const response = await jiraRequest<TeamsMeetingsResponse>('teamsMeetings', { sync: true });
      setMeetings(response.meetings || []);
    } catch {
      // Teams sync is optional and should not block Jira issue loading
    }
  }

  useEffect(() => {
    void loadConnections();
    void loadMeetingsBackground();
  }, []);

  async function loadIssues(id = connectionId, jql = query, scope = filter) {
    if (!id) return;
    const requestGeneration = ++generation.current;
    setIsRefreshing(true);
    setError('');
    try {
      const currentUser = await jiraRequest<JiraUser>('myself', { repositoryId: id });
      const loaded = await jiraRequest<RawIssue[]>('search', { repositoryId: id, query: jql, filter: scope });
      if (generation.current !== requestGeneration) return;
      setUser(currentUser);
      setIssues(loaded.map((issue) => mapIssue(issue, currentUser)));
      setSelectedIssueId((previous) => loaded.some((issue) => issue.id === previous) ? previous : loaded[0]?.id || '');
      setRevision((previous) => previous + 1);
    } catch (failure) {
      if (generation.current === requestGeneration) setError(describeError(failure));
      throw failure;
    } finally {
      if (generation.current === requestGeneration) setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (connectionId) void loadIssues().catch(() => { });
    return () => { generation.current++; };
  }, [connectionId]);

  useEffect(() => {
    let cancelled = false;
    setTaskBranches({});
    setLinkedBranches({});
    void jiraRequest<{ urls: string[] }>('remotes').then((remotes) => {
      if (!cancelled) setOriginUrls(remotes.urls);
    }).catch(() => { if (!cancelled) setOriginUrls([]); });
    for (const key of new Set(issues.map((issue) => issue.parentKey || issue.key))) {
      void jiraRequest<DevBranch[]>('devBranches', { repositoryId: connectionId, key }).then((linked) => {
        if (!cancelled) setLinkedBranches((previous) => ({ ...previous, [key]: linked }));
      }).catch(() => { });
      void lookupBranches(() => jiraRequest<Omit<BranchPlan, 'key'>>('branches', {
        key, type: 'task', summary: '',
        issueKeys: issues.filter((issue) => (issue.parentKey || issue.key) === key).map((issue) => issue.key),
      }), () => cancelled).then((plan) => {
        if (!cancelled) setTaskBranches((previous) => previous[key] ? previous : {
          ...previous, [key]: { state: 'ready', names: branchNames(plan) },
        });
      }).catch((failure) => {
        if (!cancelled) setTaskBranches((previous) => previous[key] ? previous : {
          ...previous, [key]: { state: 'error', message: describeError(failure) },
        });
      });
    }
    return () => { cancelled = true; };
  }, [issues, connectionId]);

  useEffect(() => {
    if (!issues.length || issues.some((issue) => !taskBranches[issue.parentKey || issue.key])) return;
    const cards = issues.map((issue) => ({
      issueKey: issue.key, branchKey: issue.parentKey || issue.key,
      branches: taskBranches[issue.parentKey || issue.key],
      rendered: document.querySelector(`[data-branch-issue="${issue.key}"]`)?.textContent ?? null,
    }));
    void jiraRequest('branchDiagnostics', { cards }).catch((failure) => console.error('Branch diagnostics failed', failure));
  }, [issues, taskBranches]);

  useEffect(() => {
    if (!activeTimer.isRunning) return;
    const started = Date.now();
    const initialSeconds = activeTimer.seconds;
    const interval = window.setInterval(() => setActiveTimer((timer) => ({
      ...timer, seconds: initialSeconds + Math.floor((Date.now() - started) / 1000),
    })), 1000);
    return () => window.clearInterval(interval);
  }, [activeTimer.isRunning, activeTimer.issueKey]);

  useEffect(() => {
    if (!activeTimer.issueKey || (!activeTimer.isRunning && !pausedByMeeting)) return;
    const checkMeetingCollision = () => {
      const decision = evaluateMeetingTimerCollision(
        activeTimer,
        meetings,
        pausedByMeeting,
        Date.now(),
        dismissedMeetings.current,
      );
      if (decision.action === 'pause' && decision.pausedByMeeting) {
        setActiveTimer((timer) => ({ ...timer, isRunning: false }));
        setPausedByMeeting(decision.pausedByMeeting);
        setNotice(`${messages['meetings.timer.paused']} ${decision.pausedByMeeting.meetingTitle}`);
      } else if (decision.action === 'update-pause') {
        setPausedByMeeting(decision.pausedByMeeting);
      } else if (decision.action === 'resume') {
        const resumedTitle = pausedByMeeting?.meetingTitle || '';
        setPausedByMeeting(null);
        setActiveTimer((timer) => ({ ...timer, isRunning: true }));
        setNotice(`${messages['meetings.timer.resumed']} ${resumedTitle}`.trim());
      }
    };
    checkMeetingCollision();
    const interval = window.setInterval(checkMeetingCollision, 1000);
    return () => window.clearInterval(interval);
  }, [activeTimer.issueKey, activeTimer.isRunning, meetings, pausedByMeeting]);

  function selectConnection(id: string) {
    if (writeLock.current || branchLock.current || isRefreshing || activeTimer.seconds > 0 || activeTimer.isRunning) {
      setError(messages['timer.switch']);
      return;
    }
    generation.current++;
    setIssues([]);
    setFilter('all');
    setUser(undefined);
    setSelectedIssueId('');
    setPausedByMeeting(null);
    setActiveTimer({ issueKey: '', issueTitle: '', seconds: 0, isRunning: false });
    setQuery(connections.find((candidate) => candidate.id === id)?.query || '');
    setConnectionId(id);
  }

  function startTracking(issue: { key: string; title: string }, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (writeLock.current) return;
    if (activeTimer.issueKey !== issue.key && (activeTimer.seconds > 0 || activeTimer.isRunning)) {
      setError(messages['timer.switch']);
      return;
    }
    for (const colliding of findCollidingMeetings(meetings, Date.now())) {
      dismissedMeetings.current.add(colliding.id);
    }
    setPausedByMeeting(null);
    setActiveTimer((timer) => ({
      issueKey: issue.key, issueTitle: issue.title,
      seconds: timer.issueKey === issue.key ? timer.seconds : 0,
      isRunning: true, startedAt: timer.issueKey === issue.key && timer.startedAt ? timer.startedAt : new Date(),
    }));
    setActiveTab('tracker');
  }

  async function requestTracking(issue: { key: string; title: string }, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (writeLock.current || branchLock.current || isRefreshing) return;
    if (activeTimer.issueKey !== issue.key && (activeTimer.seconds > 0 || activeTimer.isRunning)) {
      setError(messages['timer.switch']);
      return;
    }
    branchLock.current = true;
    setBranchBusy(true);
    setBranchError('');
    setError('');
    setNotice('');
    try {
      const plan = await prepareTracking(connectionId, issue.key);
      setTaskBranches((previous) => ({ ...previous, [plan.key]: { state: 'ready', names: branchNames(plan) } }));
      if (plan.repositories.some((repository) => repository.matches.length > 0)) {
        startTracking(issue);
        setNotice(messages['branch.exists']);
        branchLock.current = false;
      } else {
        setBranchFlow({ issue, plan });
      }
    } catch (failure) {
      setError(describeError(failure));
      branchLock.current = false;
    } finally {
      setBranchBusy(false);
    }
  }

  async function confirmBranch(root: string, name: string, base: string) {
    if (!branchFlow || writeLock.current) return;
    writeLock.current = true;
    setBranchBusy(true);
    setBranchError('');
    try {
      const result = await jiraRequest<{ created: boolean }>('createBranch', { root, name, base, key: branchFlow.plan.key });
      if (result.created) {
        setTaskBranches((previous) => ({ ...previous, [branchFlow.plan.key]: { state: 'ready', names: [name] } }));
      } else {
        setIssues((previous) => [...previous]);
      }
      writeLock.current = false;
      startTracking(branchFlow.issue);
      setNotice(messages[result.created ? 'branch.created' : 'branch.already.exists']);
      setBranchFlow(null);
      branchLock.current = false;
    } catch (failure) {
      setBranchError(describeError(failure));
    } finally {
      writeLock.current = false;
      setBranchBusy(false);
    }
  }

  async function openIssue(key: string) {
    const requestGeneration = generation.current;
    try {
      const loaded = await jiraRequest<RawIssue>('issue', { repositoryId: connectionId, key });
      if (requestGeneration !== generation.current) return;
      const issue = mapIssue(loaded, user);
      setIssues((previous) => [...previous.filter((candidate) => candidate.id !== issue.id), issue]);
      setSelectedIssueId(issue.id);
      setActiveTab('details');
    } catch (failure) { setError(describeError(failure)); }
  }

  async function mutate(operation: string, parameters: Record<string, unknown>) {
    if (branchLock.current) throw new Error(messages['branch.pending']);
    if (writeLock.current) throw new Error(messages['worklog.pending']);
    writeLock.current = true;
    setWriting(true);
    setError('');
    setNotice('');
    try {
      await jiraRequest(operation, { ...parameters, repositoryId: connectionId });
      setNotice(messages.saved);
      setRevision((previous) => previous + 1);
      try {
        const key = String(parameters.key);
        const updated = await jiraRequest<RawIssue>('issue', { repositoryId: connectionId, key });
        setIssues((previous) => previous.map((issue) => issue.key === key ? mapIssue(updated, user) : issue));
      } catch (failure) {
        setNotice(messages['save.refresh.failed']);
        setError(describeError(failure));
      }
    } catch (failure) {
      setError(describeError(failure));
      throw failure;
    } finally {
      writeLock.current = false;
      setWriting(false);
    }
  }

  async function refresh() {
    if (writing || branchLock.current || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const loaded = await loadConnections();
      if (loaded?.some((candidate) => candidate.id === connectionId)) await loadIssues().catch(() => { });
      await loadMeetingsBackground();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-[#181A20] text-[#E1E4EA] overflow-hidden text-[12px]">
      <TopBar activeTab={activeTab} onTabChange={setActiveTab} onRefresh={refresh}
        isRefreshing={isRefreshing} onOpenSettings={() => setSettingsOpen(true)}
        connections={connections} connectionId={connectionId} onSelectConnection={selectConnection}
        hasActiveTimer={activeTimer.isRunning} user={user?.displayName || ''} disabled={interactionPending || isRefreshing} />
      {error && <div role="alert" className="p-3 text-[#FF5C5C] border-b border-[#2E3240]">{error}</div>}
      {notice && <div role="status" className="p-2 text-[#34C759] border-b border-[#2E3240]">{notice}</div>}
      {pausedByMeeting && !activeTimer.isRunning && (
        <div role="status" className="px-3 py-1.5 bg-[#2B2618] text-[#F5C451] border-b border-[#5C4E24] text-[11px]">
          {messages['meetings.timer.paused']} <span className="font-semibold">{pausedByMeeting.meetingTitle}</span> ({activeTimer.issueKey})
        </div>
      )}
      <form onSubmit={(event) => { event.preventDefault(); refresh(); }} className="flex items-center gap-2 p-2 bg-[#1E2028]">
        <label htmlFor="jira-query" className="text-[#7D8395] font-mono">{messages.query}</label>
        <input id="jira-query" value={query} onChange={(event) => setQuery(event.target.value)} disabled={interactionPending || isRefreshing}
          className="min-w-0 flex-1 bg-[#181A20] px-2 py-1 border border-[#2E3240] rounded" />
        <button disabled={!connection || interactionPending || isRefreshing || !query.trim()} className="px-2 py-1 bg-[#3B68FF] rounded disabled:opacity-40">{messages.search}</button>
      </form>
      {isRefreshing && <div role="status" className="px-3 py-2 text-[#7D8395]">{messages.loading}</div>}
      {branchBusy && !branchFlow && <div role="status" className="px-3 py-2 text-[#7D8395]">{messages['branch.checking']}</div>}
      {!connection && <button onClick={() => setSettingsOpen(true)} className="p-4 text-[#5384F7]">{messages['no.connection']}</button>}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {activeTab === 'issues' && <IssuesScreen issues={visibleIssues} selectedIssueId={selectedIssueId} taskBranches={taskBranches}
          activeFilter={filter} onFilterChange={(scope) => { if (!interactionPending && !isRefreshing) { setFilter(scope); void loadIssues(connectionId, query, scope).catch(() => { }); } }}
          onSelectIssue={(issue) => setSelectedIssueId(issue.id)} onOpenDetails={(issue) => { if (issue) void openIssue(issue.key); }}
          onStartTracking={requestTracking} activeTrackingKey={activeTimer.isRunning ? activeTimer.issueKey : undefined}
          onUpdateSubtaskDone={(id, event) => { event.stopPropagation(); const subtask = issues.flatMap((issue) => issue.subtasks || []).find((item) => item.id === id); if (subtask) void openIssue(subtask.key); }}
          onSelectSubtask={(subtask: Subtask) => { void openIssue(subtask.key); }} onStartSubtaskTimer={requestTracking}
          onLoadParentKey={(key) => { void openIssue(key); }} />}
        {activeTab === 'details' && (selectedIssue ? <DetailsTab key={`${connectionId}:${selectedIssue.id}`} issue={selectedIssue}
          onBackToIssues={() => setActiveTab('issues')} onStartTracking={requestTracking}
          repositoryId={connectionId} revision={revision} writing={interactionPending} onMutate={mutate}
          commitMessageTemplate={connection?.commitMessageTemplate ?? ''} />
          : <div className="p-4 text-[#7D8395]">{messages['no.issue']}</div>)}
          {activeTab === 'tracker' && <TrackerTab activeTimer={activeTimer} pausedByMeeting={pausedByMeeting} issues={issues} repositoryId={connectionId}
            revision={revision} writing={interactionPending} onSelectIssue={(issue) => { void requestTracking(issue); }}
            onToggleTimer={() => {
              if (interactionPending || !activeTimer.issueKey) return;
              if (activeTimer.isRunning) {
                setPausedByMeeting(null);
                setActiveTimer((timer) => ({ ...timer, isRunning: false }));
              } else {
                void requestTracking({ key: activeTimer.issueKey, title: activeTimer.issueTitle });
              }
            }}
            onResetTimer={() => {
              if (!interactionPending) {
                setPausedByMeeting(null);
                setActiveTimer((timer) => ({ ...timer, seconds: 0, isRunning: false, startedAt: undefined }));
              }
            }}
            onLogWork={async (key, duration, body, started) => {
              setPausedByMeeting(null);
              setActiveTimer((timer) => ({ ...timer, isRunning: false }));
              await mutate('worklog', { key, duration, body, started });
              setActiveTimer((timer) => ({ ...timer, seconds: 0, isRunning: false, startedAt: undefined }));
            }} />}
            {activeTab === 'meetings' && <MeetingsTab issues={issues} initialMeetings={meetings} onMeetingsChange={setMeetings} writing={interactionPending}
              onStartTracking={(issue, event) => { void requestTracking(issue, event); }}
              onOpenIssue={(key) => { void openIssue(key); }}
              onLogWork={async (key, duration, body, started) => {
                await mutate('worklog', { key, duration, body, started });
              }} />}
      </div>
      {branchFlow && <BranchDialog plan={branchFlow.plan} busy={branchBusy} error={branchError}
        onConfirm={(root, name, base) => { void confirmBranch(root, name, base); }}
        onCancel={() => { if (!writeLock.current) { setBranchFlow(null); branchLock.current = false; } }}
        onTimerOnly={() => {
          if (writeLock.current) return;
          startTracking(branchFlow.issue);
          setBranchFlow(null);
          branchLock.current = false;
        }} />}
      <SettingsModal isOpen={settingsOpen} onClose={() => { setSettingsOpen(false); void loadConnections(); }}
        onConfigure={async () => { try { await jiraRequest('configure'); } catch (failure) { setError(describeError(failure)); } }} />
    </div>
  );
}

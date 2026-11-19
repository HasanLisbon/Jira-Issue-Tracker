import React, { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, ClipboardPlus, History } from 'lucide-react';
import type { ActiveTimer, JiraIssue, MeetingTimerPause, StagedWorklog } from './types.ts';
import { cestInput, formatDuration, formatLocalDateTime, formatTimeSpent, parseDurationMinutes, worklogStarted, jiraRequest } from './jira.ts';
import type { JiraWorklog } from './jira.ts';
import { messages } from './messages.ts';

interface TrackerTabProps {
  activeTimer: ActiveTimer;
  pausedByMeeting?: MeetingTimerPause | null;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onStageWorklog: (entry: Omit<StagedWorklog, 'id'>) => void;
  issues: JiraIssue[];
  onSelectIssue: (issue: JiraIssue) => void;
  repositoryId: string;
  revision: number;
  writing: boolean;
  systemTimeZone?: string;
  jiraTimeZone?: string;
}

export const TrackerTab: React.FC<TrackerTabProps> = (props) => {
  const { activeTimer, systemTimeZone, jiraTimeZone } = props;
  const worklogTimeZone = jiraTimeZone || systemTimeZone;
  const [workComment, setWorkComment] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [started, setStarted] = useState(() => cestInput(activeTimer.startedAt || new Date(), systemTimeZone));
  const [worklogs, setWorklogs] = useState<JiraWorklog[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStarted(cestInput(activeTimer.startedAt || new Date(), systemTimeZone));
  }, [activeTimer.issueKey, activeTimer.startedAt, systemTimeZone]);

  useEffect(() => {
    let current = true;
    setWorklogs([]);
    if (!activeTimer.issueKey) return;
    setLoading(true);
    setError('');
    jiraRequest<JiraWorklog[]>('worklogs', { repositoryId: props.repositoryId, key: activeTimer.issueKey })
      .then((loaded) => { if (current) setWorklogs(loaded); })
      .catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : messages['request.failed']); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [props.repositoryId, activeTimer.issueKey, props.revision]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const timerMinutes = Math.floor(activeTimer.seconds / 60);
    const rawDuration = customTime.trim() || `${timerMinutes}m`;
    const parsedMinutes = parseDurationMinutes(rawDuration);
    if (!activeTimer.issueKey || parsedMinutes === null || !started) {
      setError(messages['duration.invalid']);
      return;
    }
    try {
      worklogStarted(started, worklogTimeZone);
    } catch (failure) {
      setError(failure instanceof Error ? messages[failure.message] || failure.message : messages['started.invalid']);
      return;
    }
    setError('');
    props.onStageWorklog({
      issueKey: activeTimer.issueKey,
      issueTitle: activeTimer.issueTitle,
      minutes: parsedMinutes,
      started,
      comment: workComment,
      source: 'tracker',
    });
    setCustomTime('');
    setWorkComment('');
  }

  const formatTime = (seconds: number) => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => part.toString().padStart(2, '0')).join(':');
  const disabled = props.writing;

  return (
    <div className="flex-1 overflow-y-auto p-4 bg-[#181A20] space-y-4">
      <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5 shadow-sm">
        <div className="flex items-center justify-between text-[11px] mb-1.5">
          <span className="text-[#5384F7] font-mono font-bold">{activeTimer.issueKey}</span>
          <span className={activeTimer.isRunning ? 'text-[#34C759]' : 'text-[#7D8395]'}>{activeTimer.issueTitle}</span>
        </div>
        <select aria-label={messages['select.issue']} value={activeTimer.issueKey} disabled={disabled}
          onChange={(event) => { const issue = props.issues.find((candidate) => candidate.key === event.target.value); if (issue) props.onSelectIssue(issue); }}
          className="w-full bg-[#181A20] text-[#C5CAD4] border border-[#2E3240] rounded px-2 py-1 text-[11px] font-mono">
          <option value="">{messages['select.issue']}</option>
          {!props.issues.some((issue) => issue.key === activeTimer.issueKey) && activeTimer.issueKey
            && <option value={activeTimer.issueKey}>{activeTimer.issueKey} - {activeTimer.issueTitle}</option>}
          {props.issues.map((issue) => <option key={issue.id} value={issue.key}>{issue.key} - {issue.title}</option>)}
        </select>
      </div>
      <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-5 flex flex-col items-center text-center">
        <div className="font-mono text-4xl font-semibold tracking-wider text-white tabular-nums mb-4">{formatTime(activeTimer.seconds)}</div>
        {props.pausedByMeeting && !activeTimer.isRunning && (
          <div role="status" className="mb-3 px-2.5 py-1.5 rounded bg-[#2B2618] border border-[#5C4E24] text-[#F5C451] text-[11px]">
            {messages['meetings.timer.paused']} <span className="font-semibold">{props.pausedByMeeting.meetingTitle}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button disabled={disabled || !activeTimer.issueKey} onClick={props.onToggleTimer} className="flex items-center gap-2 px-4 py-2 rounded bg-[#3B68FF] text-white disabled:opacity-40">
            {activeTimer.isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}{messages[activeTimer.isRunning ? 'timer.pause' : 'timer.start']}
          </button>
          <button disabled={disabled} onClick={props.onResetTimer} className="flex items-center gap-2 px-3 py-2 rounded border border-[#2E3240] text-[#7D8395]"><RotateCcw className="w-4 h-4" />{messages['timer.reset']}</button>
        </div>
      </div>
      <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5">
        <form onSubmit={submit} className="space-y-3">
          {error && <div role="alert" className="text-[#FF5C5C]">{error}</div>}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-mono text-[#7D8395]">{messages.duration}
              <input value={customTime} onChange={(event) => setCustomTime(event.target.value)} disabled={disabled}
                placeholder={formatDuration(Math.floor(activeTimer.seconds / 60))} className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2.5 py-1.5 rounded border border-[#2E3240]" />
            </label>
            <label className="text-[10px] font-mono text-[#7D8395]">{messages.started}
              <input type="datetime-local" required value={started} onChange={(event) => setStarted(event.target.value)} disabled={disabled}
                className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2 py-1.5 rounded border border-[#2E3240]" />
            </label>
          </div>
          <label className="block text-[10px] font-mono text-[#7D8395]">{messages['work.description']}
            <textarea rows={2} value={workComment} onChange={(event) => setWorkComment(event.target.value)} disabled={disabled}
              className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2.5 py-1.5 rounded border border-[#2E3240] resize-none" />
          </label>
          <button disabled={disabled || !activeTimer.issueKey} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#3B68FF] text-white font-medium disabled:opacity-40">
            <ClipboardPlus className="w-3 h-3" />{messages['work.submit']}
          </button>
        </form>
      </div>
      <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5 space-y-2">
        <div className="flex items-center gap-2 font-semibold"><History className="w-3.5 h-3.5 text-[#7D8395]" />{messages['work.history']}</div>
        {loading && <div role="status">{messages.loading}</div>}
        {!loading && !worklogs.length && <p className="text-[#7D8395]">{messages['work.empty']}</p>}
        {worklogs.map((log) => <div key={log.id} className="p-2 rounded bg-[#1C1E26] border border-[#2B2E3C] text-[11px]">
          <div className="flex justify-between gap-2"><span>{log.author.displayName}</span><span className="text-[#34C759] font-mono">{formatTimeSpent(log.timeSpent)}</span></div>
          <div className="text-[#7D8395]">{formatLocalDateTime(log.started, worklogTimeZone)}</div>
          <p className="whitespace-pre-wrap select-text">{log.comment}</p>
        </div>)}
      </div>
    </div>
  );
};

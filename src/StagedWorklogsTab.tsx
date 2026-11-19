import React, { useRef, useState } from 'react';
import { ClipboardList, Send, Trash2, Clock, Calendar, Timer } from 'lucide-react';
import type { StagedWorklog } from './types.ts';
import { formatDuration, parseDurationMinutes, worklogStarted } from './jira.ts';
import { messages } from './messages.ts';

interface StagedWorklogsTabProps {
  stagedWorklogs: StagedWorklog[];
  onUpdateStaged: (id: string, patch: Partial<Pick<StagedWorklog, 'minutes' | 'started' | 'comment'>>) => void;
  onRemoveStaged: (id: string) => void;
  onClearStaged: () => void;
  onLogWork: (key: string, duration: string, comment: string, started: string) => Promise<void>;
  writing: boolean;
  systemTimeZone?: string;
  jiraTimeZone?: string;
}

export const StagedWorklogsTab: React.FC<StagedWorklogsTabProps> = ({
  stagedWorklogs,
  onUpdateStaged,
  onRemoveStaged,
  onClearStaged,
  onLogWork,
  writing,
  systemTimeZone,
  jiraTimeZone,
}) => {
  const worklogTimeZone = jiraTimeZone || systemTimeZone;
  const [submittingId, setSubmittingId] = useState<string>('');
  const [submittingAll, setSubmittingAll] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const pending = useRef(false);

  const totalMinutes = stagedWorklogs.reduce((sum, entry) => sum + (Number.isFinite(entry.minutes) && entry.minutes > 0 ? entry.minutes : 0), 0);
  const disabled = writing || submittingAll || Boolean(submittingId);

  function resolvedMinutes(entry: StagedWorklog): number | null {
    if (Object.prototype.hasOwnProperty.call(durationDrafts, entry.id)) {
      return parseDurationMinutes(durationDrafts[entry.id]);
    }
    return Number.isInteger(entry.minutes) && entry.minutes > 0 ? entry.minutes : null;
  }

  function validateEntry(entry: StagedWorklog): { startedIso: string; minutes: number } {
    if (!entry.issueKey.trim()) throw new Error('request.invalid');
    const minutes = resolvedMinutes(entry);
    if (minutes === null) throw new Error('duration.invalid');
    return { startedIso: worklogStarted(entry.started, worklogTimeZone), minutes };
  }

  async function logSingle(entry: StagedWorklog) {
    if (pending.current) return;
    let validated: { startedIso: string; minutes: number };
    try {
      validated = validateEntry(entry);
    } catch (failure) {
      setError(failure instanceof Error ? messages[failure.message] || failure.message : messages['duration.invalid']);
      return;
    }
    pending.current = true;
    setSubmittingId(entry.id);
    setError('');
    try {
      await onLogWork(entry.issueKey, formatDuration(validated.minutes), entry.comment, validated.startedIso);
      onRemoveStaged(entry.id);
    } catch (failure) {
      setError(failure instanceof Error ? messages[failure.message] || failure.message : messages['worklog.failed']);
    } finally {
      pending.current = false;
      setSubmittingId('');
    }
  }

  async function logAll() {
    if (pending.current || !stagedWorklogs.length) return;
    const prepared: Array<{ entry: StagedWorklog; startedIso: string; minutes: number }> = [];
    for (const entry of stagedWorklogs) {
      try {
        const validated = validateEntry(entry);
        prepared.push({ entry, ...validated });
      } catch (failure) {
        const detail = failure instanceof Error ? messages[failure.message] || failure.message : messages['duration.invalid'];
        setError(`${entry.issueKey}: ${detail}`);
        return;
      }
    }

    pending.current = true;
    setSubmittingAll(true);
    setError('');
    try {
      for (let i = 0; i < prepared.length; i++) {
        const { entry, startedIso, minutes } = prepared[i];
        setProgressText(`${messages['staged.logging']} (${i + 1}/${prepared.length})`);
        await onLogWork(entry.issueKey, formatDuration(minutes), entry.comment, startedIso);
        onRemoveStaged(entry.id);
      }
    } catch (failure) {
      setError(failure instanceof Error ? messages[failure.message] || failure.message : messages['worklog.failed']);
    } finally {
      pending.current = false;
      setSubmittingAll(false);
      setProgressText('');
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-3.5 bg-[#181A20] space-y-3">
      <div className="flex items-center justify-between gap-2 bg-[#232630] border border-[#2E3240] rounded-lg px-3 py-2.5 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-4 h-4 text-[#5384F7] shrink-0" />
          <span className="font-semibold text-[12px]">{messages['staged.title']}</span>
          {stagedWorklogs.length > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#181A20] border border-[#2E3240] text-[#34C759] font-mono text-[10.5px]">
              <Clock className="w-2.5 h-2.5" />
              {formatDuration(totalMinutes)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {stagedWorklogs.length > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={onClearStaged}
              className="px-2 py-1 rounded border border-[#2E3240] text-[#7D8395] hover:text-[#FF5C5C] text-[11px] disabled:opacity-40"
            >
              {messages['staged.clear']}
            </button>
          )}
          <button
            type="button"
            disabled={disabled || !stagedWorklogs.length}
            onClick={() => { void logAll(); }}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#3B68FF] text-white text-[11px] font-medium hover:bg-[#4E76FF] disabled:opacity-40"
          >
            <Send className="w-3 h-3" />
            <span>{submittingAll ? progressText || messages['staged.logging'] : `${messages['staged.log.all']} (${stagedWorklogs.length})`}</span>
          </button>
        </div>
      </div>

      {error && <div role="alert" className="p-2.5 rounded bg-[#2B1F24] border border-[#5C2B33] text-[#FF5C5C] text-[11px]">{error}</div>}

      {!stagedWorklogs.length && (
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-5 text-center text-[#7D8395] text-[11.5px]">
          {messages['staged.empty']}
        </div>
      )}

      {stagedWorklogs.map((entry) => (
        <div key={entry.id} className="bg-[#232630] border border-[#2E3240] rounded-lg p-3 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#181A20] border border-[#2E3240] text-[#A8B0C3] text-[10px]">
                {entry.source === 'meeting' ? <Calendar className="w-2.5 h-2.5 text-[#9EA6FF]" /> : <Timer className="w-2.5 h-2.5 text-[#34C759]" />}
                {entry.source === 'meeting' ? messages['staged.source.meeting'] : messages['staged.source.tracker']}
              </span>
              <span className="font-mono font-bold text-[#5384F7] shrink-0">{entry.issueKey}</span>
              <span className="text-[#C5CAD4] truncate">{entry.issueTitle}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={disabled}
                onClick={() => { void logSingle(entry); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1E2B24] border border-[#2B5C3F] text-[#34C759] hover:bg-[#25382E] text-[10.5px] font-medium disabled:opacity-40"
              >
                <Send className="w-2.5 h-2.5" />
                {submittingId === entry.id ? '...' : messages['staged.log.one']}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemoveStaged(entry.id)}
                title={messages['staged.remove']}
                aria-label={`${messages['staged.remove']} ${entry.issueKey}`}
                className="p-1 rounded border border-[#2E3240] text-[#7D8395] hover:text-[#FF5C5C] disabled:opacity-40"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] font-mono text-[#7D8395]">
              {messages['staged.minutes.label']}
              <input
                type="text"
                value={Object.prototype.hasOwnProperty.call(durationDrafts, entry.id) ? durationDrafts[entry.id] : formatDuration(entry.minutes)}
                disabled={disabled}
                onChange={(event) => {
                  const raw = event.target.value;
                  setDurationDrafts((prev) => ({ ...prev, [entry.id]: raw }));
                  const parsed = parseDurationMinutes(raw);
                  if (parsed !== null) {
                    onUpdateStaged(entry.id, { minutes: parsed });
                  }
                }}
                onBlur={() => {
                  const raw = durationDrafts[entry.id];
                  if (raw !== undefined) {
                    const parsed = parseDurationMinutes(raw);
                    if (parsed !== null) {
                      onUpdateStaged(entry.id, { minutes: parsed });
                      setDurationDrafts((prev) => {
                        const next = { ...prev };
                        delete next[entry.id];
                        return next;
                      });
                    }
                  }
                }}
                className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] font-mono px-2.5 py-1 rounded border border-[#2E3240]"
              />
            </label>
            <label className="text-[10px] font-mono text-[#7D8395]">
              {messages.started}
              <input
                type="datetime-local"
                required
                value={entry.started}
                disabled={disabled}
                onChange={(event) => onUpdateStaged(entry.id, { started: event.target.value })}
                className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2 py-1 rounded border border-[#2E3240]"
              />
            </label>
          </div>

          <label className="block text-[10px] font-mono text-[#7D8395]">
            {messages['work.description']}
            <input
              type="text"
              value={entry.comment}
              disabled={disabled}
              onChange={(event) => onUpdateStaged(entry.id, { comment: event.target.value })}
              className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2.5 py-1.5 rounded border border-[#2E3240]"
            />
          </label>
        </div>
      ))}
    </div>
  );
};

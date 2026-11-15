import React, { useEffect, useState } from 'react';
import { Calendar, Clock, Link2, Unlink, Play, Send, RotateCw, SlidersHorizontal, Video, ExternalLink } from 'lucide-react';
import type { JiraIssue, TeamsMeeting, MeetingTicketMapping, TeamsMeetingsResponse } from './types.ts';
import { cestInput, jiraRequest, resolveMeetingTicket, worklogStarted } from './jira.ts';
import { messages } from './messages.ts';

interface MeetingsTabProps {
  issues: JiraIssue[];
  onStartTracking: (issue: { key: string; title: string }, event?: React.MouseEvent) => void;
  onLogWork: (key: string, duration: string, comment: string, started: string) => Promise<void>;
  onOpenIssue: (key: string) => void;
  writing: boolean;
}

export const MeetingsTab: React.FC<MeetingsTabProps> = (props) => {
  const [meetings, setMeetings] = useState<TeamsMeeting[]>([]);
  const [mappings, setMappings] = useState<MeetingTicketMapping[]>([]);
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<'ics' | 'graph'>('ics');
  const [icsUrl, setIcsUrl] = useState('');
  const [graphToken, setGraphToken] = useState('');
  const [hasGraphToken, setHasGraphToken] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selectedTickets, setSelectedTickets] = useState<Record<string, string>>({});
  const [customTickets, setCustomTickets] = useState<Record<string, string>>({});
  const [rememberSeries, setRememberSeries] = useState<Record<string, boolean>>({});
  const [busyMeetingId, setBusyMeetingId] = useState('');

  const describeError = (failure: unknown) => {
    const text = failure instanceof Error ? failure.message : messages['meetings.sync.failed'];
    return messages[text] || text;
  };

  async function syncMeetings(sync = true) {
    setSyncing(true);
    setError('');
    try {
      const response = await jiraRequest<TeamsMeetingsResponse>('teamsMeetings', { sync });
      setConfigured(response.configured);
      setMode(response.mode);
      setIcsUrl(response.icsUrl || '');
      setHasGraphToken(response.hasGraphToken);
      setMappings(response.mappings || []);
      setMeetings(response.meetings || []);
      if (!response.configured) {
        setShowConfig(true);
      }
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    void syncMeetings(true);
  }, []);

  async function saveConfig(event: React.FormEvent) {
    event.preventDefault();
    setSavingConfig(true);
    setError('');
    setNotice('');
    try {
      const response = await jiraRequest<TeamsMeetingsResponse>('saveTeamsConfig', {
        icsUrl: icsUrl.trim(),
        useGraph: mode === 'graph',
        graphToken: graphToken.trim(),
      });
      setConfigured(response.configured);
      setHasGraphToken(response.hasGraphToken);
      setGraphToken('');
      setShowConfig(false);
      setNotice(messages['meetings.config.saved']);
      await syncMeetings(true);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setSavingConfig(false);
    }
  }

  async function linkTicket(meeting: TeamsMeeting) {
    const chosenKey = (customTickets[meeting.id]?.trim() || selectedTickets[meeting.id] || '').trim().toUpperCase();
    if (!chosenKey) return;
    const matchedIssue = props.issues.find((item) => item.key.toUpperCase() === chosenKey);
    const applySeries = rememberSeries[meeting.id] ?? true;
    const matchType = applySeries ? 'series' : 'instance';
    const matchKey = applySeries ? (meeting.seriesKey || meeting.title.trim().toLowerCase()) : meeting.id;

    setBusyMeetingId(meeting.id);
    setError('');
    setNotice('');
    try {
      const updated = await jiraRequest<MeetingTicketMapping[]>('saveMeetingMapping', {
        matchKey,
        matchType,
        meetingTitle: meeting.title,
        issueKey: chosenKey,
        issueTitle: matchedIssue?.title || '',
      });
      setMappings(updated);
      setCustomTickets((prev) => ({ ...prev, [meeting.id]: '' }));
      setNotice(messages['meetings.ticket.saved']);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusyMeetingId('');
    }
  }

  async function unlinkTicket(meeting: TeamsMeeting, matchKey: string, matchType: 'series' | 'instance') {
    setBusyMeetingId(meeting.id);
    setError('');
    setNotice('');
    try {
      const updated = await jiraRequest<MeetingTicketMapping[]>('saveMeetingMapping', {
        matchKey,
        matchType,
        meetingTitle: meeting.title,
        issueKey: '',
        issueTitle: '',
      });
      setMappings(updated);
      setNotice(messages['meetings.ticket.unlinked']);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusyMeetingId('');
    }
  }

  async function logMeetingWork(meeting: TeamsMeeting, issueKey: string) {
    setBusyMeetingId(meeting.id);
    setError('');
    setNotice('');
    try {
      const startInput = cestInput(new Date(meeting.start));
      const startedIso = worklogStarted(startInput);
      await props.onLogWork(issueKey, meeting.durationFormatted, `Teams meeting: ${meeting.title}`, startedIso);
      setNotice(messages.saved);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusyMeetingId('');
    }
  }

  const formatMeetingTime = (startIso: string, endIso: string) => {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const datePart = start.toLocaleDateString('sv-SE', { weekday: 'short', month: 'short', day: 'numeric' });
    const startClock = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const endClock = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart} • ${startClock}–${endClock}`;
  };

  const disabled = props.writing || syncing || savingConfig;

  return (
    <div className="flex-1 overflow-y-auto p-3.5 bg-[#181A20] space-y-3">
      <div className="flex items-center justify-between gap-2 bg-[#232630] border border-[#2E3240] rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="w-4 h-4 text-[#5384F7] shrink-0" />
          <span className="font-semibold text-[12px] truncate">{messages['meetings.title']}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => { void syncMeetings(true); }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#3B68FF] text-white text-[11px] font-medium disabled:opacity-40"
          >
            <RotateCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {messages['meetings.sync']}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setShowConfig((prev) => !prev)}
            title={messages['meetings.configure']}
            className="flex items-center gap-1 px-2 py-1 rounded border border-[#2E3240] text-[#A8B0C3] hover:text-white text-[11px]"
          >
            <SlidersHorizontal className="w-3 h-3" />
            {messages['meetings.configure']}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="p-2.5 rounded bg-[#2B1F24] border border-[#5C2B33] text-[#FF5C5C] text-[11px]">{error}</div>}
      {notice && <div role="status" className="p-2 rounded bg-[#1E2B24] border border-[#2B5C3F] text-[#34C759] text-[11px]">{notice}</div>}

      {showConfig && (
        <form onSubmit={saveConfig} className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5 space-y-3">
          <div className="flex items-center gap-3 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="teams-mode"
                checked={mode === 'ics'}
                onChange={() => setMode('ics')}
                disabled={disabled}
              />
              <span>{messages['meetings.mode.ics']}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="teams-mode"
                checked={mode === 'graph'}
                onChange={() => setMode('graph')}
                disabled={disabled}
              />
              <span>{messages['meetings.mode.graph']}</span>
            </label>
          </div>

          {mode === 'ics' ? (
            <div className="space-y-1">
              <label className="block text-[10.5px] font-mono text-[#A8B0C3]">
                {messages['meetings.ics.url']}
                <input
                  value={icsUrl}
                  onChange={(event) => setIcsUrl(event.target.value)}
                  placeholder="https://outlook.office365.com/owa/calendar/.../reachcalendar.ics"
                  disabled={disabled}
                  className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2.5 py-1.5 rounded border border-[#2E3240] text-[11px]"
                />
              </label>
              <p className="text-[10px] text-[#7D8395]">{messages['meetings.ics.hint']}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="block text-[10.5px] font-mono text-[#A8B0C3]">
                {messages['meetings.graph.token']}
                <input
                  type="password"
                  value={graphToken}
                  onChange={(event) => setGraphToken(event.target.value)}
                  placeholder={hasGraphToken ? '••••••••••••••••' : 'eyJ0eXAiOiJKV1Qi...'}
                  disabled={disabled}
                  className="mt-1 w-full bg-[#181A20] text-[#E1E4EA] px-2.5 py-1.5 rounded border border-[#2E3240] text-[11px]"
                />
              </label>
              <p className="text-[10px] text-[#7D8395]">{messages['meetings.graph.hint']}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={disabled}
              className="px-3 py-1.5 rounded bg-[#3B68FF] text-white text-[11px] font-medium disabled:opacity-40"
            >
              {messages['meetings.save.config']}
            </button>
            <button
              type="button"
              onClick={() => setShowConfig(false)}
              className="px-2.5 py-1.5 rounded border border-[#2E3240] text-[#7D8395] text-[11px]"
            >
              {messages.cancel}
            </button>
          </div>
        </form>
      )}

      {syncing && <div role="status" className="text-[#7D8395] text-[11px] px-1">{messages['meetings.syncing']}</div>}

      {!syncing && !configured && (
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-4 text-[#A8B0C3] text-[11.5px]">
          {messages['meetings.not.configured']}
        </div>
      )}

      {!syncing && configured && !meetings.length && (
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-4 text-[#7D8395] text-[11.5px]">
          {messages['meetings.empty']}
        </div>
      )}

      {meetings.map((meeting) => {
        const resolved = resolveMeetingTicket(meeting, mappings, props.issues);
        const currentSelected = selectedTickets[meeting.id] ?? (resolved?.issueKey || '');
        const currentCustom = customTickets[meeting.id] ?? '';
        const isRememberSeries = rememberSeries[meeting.id] ?? true;
        const cardBusy = disabled || busyMeetingId === meeting.id;

        return (
          <div key={meeting.id} className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5 space-y-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {meeting.isTeamsMeeting && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#4B53BC]/30 text-[#9EA6FF] border border-[#4B53BC]/50 text-[10px] font-semibold">
                      <Video className="w-2.5 h-2.5" />
                      {messages['meetings.badge.teams']}
                    </span>
                  )}
                  <span className="font-semibold text-[12.5px] text-white break-words">{meeting.title}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#A8B0C3] font-mono">
                  <span>{formatMeetingTime(meeting.start, meeting.end)}</span>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#181A20] border border-[#2E3240] text-[#34C759]">
                    <Clock className="w-2.5 h-2.5" />
                    {meeting.durationFormatted}
                  </span>
                </div>
              </div>
              {meeting.joinUrl && (
                <a
                  href={meeting.joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#181A20] border border-[#2E3240] text-[#5384F7] hover:text-white text-[10.5px] shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  Join
                </a>
              )}
            </div>

            <div className="p-2.5 rounded bg-[#181A20] border border-[#2B2E3C] space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Link2 className="w-3.5 h-3.5 text-[#5384F7] shrink-0" />
                  <span className="text-[10.5px] font-mono text-[#7D8395]">{messages['meetings.ticket.label']}:</span>
                  {resolved ? (
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <button
                        type="button"
                        onClick={() => props.onOpenIssue(resolved.issueKey)}
                        className="font-mono font-bold text-[#5384F7] hover:underline text-[11.5px]"
                      >
                        {resolved.issueKey}
                      </button>
                      {resolved.issueTitle && (
                        <span className="text-[#C5CAD4] text-[11px] truncate max-w-48" title={resolved.issueTitle}>
                          {resolved.issueTitle}
                        </span>
                      )}
                      {resolved.source === 'series' && (
                        <span className="px-1.5 py-0.5 rounded bg-[#232630] border border-[#2E3240] text-[#7D8395] text-[9.5px] font-mono">
                          {messages['meetings.badge.recurring']}
                        </span>
                      )}
                      {resolved.source === 'auto' && (
                        <span className="px-1.5 py-0.5 rounded bg-[#232630] border border-[#2E3240] text-[#7D8395] text-[9.5px] font-mono">
                          {messages['meetings.badge.auto']}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[#7D8395] text-[11px] italic">{messages['meetings.ticket.none']}</span>
                  )}
                </div>

                {resolved && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={cardBusy}
                      onClick={(event) => props.onStartTracking({ key: resolved.issueKey, title: resolved.issueTitle || meeting.title }, event)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[#3B68FF] text-white text-[10.5px] font-medium disabled:opacity-40"
                    >
                      <Play className="w-2.5 h-2.5" />
                      {messages['meetings.action.start.timer']}
                    </button>
                    <button
                      type="button"
                      disabled={cardBusy}
                      onClick={() => { void logMeetingWork(meeting, resolved.issueKey); }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[#232630] border border-[#34C759]/50 text-[#34C759] hover:bg-[#34C759]/10 text-[10.5px] font-medium disabled:opacity-40"
                    >
                      <Send className="w-2.5 h-2.5" />
                      {messages['meetings.action.log.work']} ({meeting.durationFormatted})
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <select
                  aria-label={messages['meetings.ticket.select']}
                  value={currentSelected}
                  disabled={cardBusy}
                  onChange={(event) => {
                    setSelectedTickets((prev) => ({ ...prev, [meeting.id]: event.target.value }));
                    if (event.target.value) {
                      setCustomTickets((prev) => ({ ...prev, [meeting.id]: '' }));
                    }
                  }}
                  className="w-full bg-[#232630] text-[#C5CAD4] border border-[#2E3240] rounded px-2 py-1 text-[11px] font-mono"
                >
                  <option value="">{messages['meetings.ticket.select']}</option>
                  {props.issues.map((issue) => (
                    <option key={issue.id} value={issue.key}>
                      {issue.key} - {issue.title}
                    </option>
                  ))}
                </select>
                <input
                  value={currentCustom}
                  disabled={cardBusy}
                  onChange={(event) => setCustomTickets((prev) => ({ ...prev, [meeting.id]: event.target.value }))}
                  placeholder={messages['meetings.ticket.custom.placeholder']}
                  className="w-full bg-[#232630] text-[#E1E4EA] border border-[#2E3240] rounded px-2 py-1 text-[11px] font-mono"
                />
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                <label className="flex items-center gap-1.5 text-[10.5px] text-[#A8B0C3] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRememberSeries}
                    disabled={cardBusy}
                    onChange={(event) => setRememberSeries((prev) => ({ ...prev, [meeting.id]: event.target.checked }))}
                  />
                  <span>{messages['meetings.ticket.remember.series']}</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={cardBusy || !(currentCustom.trim() || currentSelected)}
                    onClick={() => { void linkTicket(meeting); }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#3B68FF] text-white text-[10.5px] font-medium disabled:opacity-40"
                  >
                    <Link2 className="w-3 h-3" />
                    {messages['meetings.ticket.save']}
                  </button>
                  {resolved && resolved.source !== 'auto' && (
                    <button
                      type="button"
                      disabled={cardBusy}
                      onClick={() => { void unlinkTicket(meeting, resolved.matchKey, resolved.matchType); }}
                      className="flex items-center gap-1 px-2 py-1 rounded border border-[#2E3240] text-[#7D8395] hover:text-[#FF5C5C] text-[10.5px]"
                    >
                      <Unlink className="w-3 h-3" />
                      {messages['meetings.ticket.unlink']}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

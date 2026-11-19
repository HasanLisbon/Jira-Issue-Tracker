import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  Copy,
  ExternalLink,
  Check,
  Flame,
  Bug,
  Bookmark,
  CheckCircle2,
  Clock,
  Play,
  User,
  Tag,
  Calendar,
  MessageSquare,
  Send,
  ArrowRight,
} from 'lucide-react';
import { JiraIssue } from './types.ts';
import { formatCommitMessage, formatLocalDateTime, formatTimeSpent, jiraRequest, initials } from './jira.ts';
import type { JiraComment, JiraTransition } from './jira.ts';
import { messages } from './messages.ts';

interface DetailsTabProps {
  issue: JiraIssue;
  commitMessageTemplate: string;
  systemTimeZone?: string;
  onBackToIssues: () => void;
  onStartTracking: (issue: JiraIssue) => void;
  repositoryId: string;
  revision: number;
  writing: boolean;
  onMutate: (operation: string, parameters: Record<string, unknown>) => Promise<void>;
}

export const DetailsTab: React.FC<DetailsTabProps> = ({
  issue,
  commitMessageTemplate,
  systemTimeZone,
  onBackToIssues,
  onStartTracking,
  repositoryId,
  revision,
  writing,
  onMutate,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [commitMessageCopyState, setCommitMessageCopyState] = useState<
    'idle' | 'copying' | 'copied' | 'failed'
  >('idle');
  const commitMessageCopyInProgress = useRef(false);
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<JiraComment[]>([]);
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [replyTo, setReplyTo] = useState<JiraComment>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    Promise.all([
      jiraRequest<JiraComment[]>('comments', { repositoryId, key: issue.key }),
      jiraRequest<{ transitions: JiraTransition[] }>('transitions', { repositoryId, key: issue.key }),
    ]).then(([loadedComments, workflow]) => {
      if (current) { setComments(loadedComments); setTransitions(workflow.transitions); }
    }).catch((failure: unknown) => {
      if (current) setError(failure instanceof Error ? failure.message : messages['request.failed']);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [repositoryId, issue.key, revision]);

  const handleCopyKey = () => {
    navigator.clipboard.writeText(issue.key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleCopyCommitMessage = async () => {
    if (commitMessageCopyInProgress.current) return;
    commitMessageCopyInProgress.current = true;
    setCommitMessageCopyState('copying');
    try {
      await navigator.clipboard.writeText(
        formatCommitMessage(commitMessageTemplate, issue),
      );
      setCommitMessageCopyState('copied');
    } catch {
      setCommitMessageCopyState('failed');
    } finally {
      commitMessageCopyInProgress.current = false;
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      await onMutate('comment', { key: issue.key, body: newComment, replyTo: replyTo?.id });
      setNewComment('');
      setReplyTo(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : messages['request.failed']);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#181A20] overflow-hidden text-[12px]">
      {/* Top action row */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1C1E26] border-b border-[#2B2E3C] shrink-0">
        <button
          type="button"
          onClick={onBackToIssues}
          className="flex items-center gap-1 text-[11px] text-[#7D8395] hover:text-[#E1E4EA] transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Back to Issues</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Copy key button */}
          <button
            type="button"
            onClick={handleCopyKey}
            title="Copy Jira issue key to clipboard"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#232630] text-[#C5CAD4] hover:text-white border border-[#2E3240] transition-colors"
          >
            {copiedKey ? (
              <>
                <Check className="w-3 h-3 text-[#34C759]" />
                <span className="font-mono text-[#34C759]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-[#7D8395]" />
                <span className="font-mono">{issue.key}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => { void handleCopyCommitMessage(); }}
            disabled={commitMessageCopyState === 'copying'}
            title={messages['commit.message.copy']}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[#232630] text-[#C5CAD4] hover:text-white border border-[#2E3240] transition-colors disabled:opacity-50"
          >
            <Copy className="w-3 h-3 text-[#7D8395]" />
            <span>{messages[commitMessageCopyState === 'copied'
              ? 'commit.message.copied'
              : commitMessageCopyState === 'failed'
              ? 'commit.message.copy.failed'
              : 'commit.message.copy']}</span>
          </button>

          {/* Start tracking CTA */}
          <button
            type="button"
            onClick={() => onStartTracking(issue)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#3B68FF] text-white text-[11px] font-medium hover:bg-[#4E76FF] transition-colors"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Track Time</span>
          </button>
        </div>
      </div>

      {/* Scrollable details content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <div role="status">{messages.loading}</div>}
        {error && <div role="alert" className="text-[#FF5C5C]">{error}</div>}
        {/* Header Block */}
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="font-mono font-bold text-[14px] text-[#5384F7]">
              {issue.key}
            </span>

            {/* Status Dropdown */}
            <div className="relative inline-block">
              <select
                value=""
                disabled={writing || loading}
                onChange={(event) => {
                  const transitionId = event.target.value;
                  if (transitionId) void onMutate('transition', { key: issue.key, transitionId }).catch((failure: unknown) => {
                    setError(failure instanceof Error ? failure.message : messages['request.failed']);
                  });
                }}
                className={`text-[10.5px] font-mono font-medium px-2 py-0.5 rounded border focus:outline-none cursor-pointer ${
                  issue.status === 'IN PROGRESS'
                    ? 'bg-[#1E2945] text-[#5384F7] border-[#5384F7]/40'
                    : issue.status === 'DONE'
                    ? 'bg-[#19332A] text-[#34C759] border-[#34C759]/40'
                    : 'bg-[#282A33] text-[#8A8F9E] border-[#2E3240]'
                }`}
              >
                <option value="">{issue.status}</option>
                {transitions.map((transition) => <option key={transition.id} value={transition.id}>{transition.name} ({transition.to.name})</option>)}
              </select>
            </div>

            {/* Priority */}
            {issue.priority === 'CRITICAL' && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#3D1F24] text-[#FF5C5C] border border-[#FF5C5C]/30">
                ❗ CRITICAL
              </span>
            )}
            {issue.priority === 'HIGHEST' && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#3D1F24] text-[#FF5C5C] border border-[#FF5C5C]/30">
                HIGHEST PRIORITY
              </span>
            )}
            {issue.priority === 'HIGH' && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#352516] text-[#F59E0B] border border-[#F59E0B]/30">
                HIGH PRIORITY
              </span>
            )}

            {issue.version && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#232630] text-[#7D8395] border border-[#2E3240]">
                {issue.version}
              </span>
            )}
          </div>

          <h2 className="text-[15px] font-semibold text-[#FFFFFF] leading-snug">
            {issue.title}
          </h2>
        </div>

        {/* Description Section */}
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5">
          <div className="text-[10.5px] font-mono uppercase tracking-wider text-[#7D8395] mb-1.5">
            Description
          </div>
          <div className="text-[12px] text-[#C5CAD4] leading-relaxed whitespace-pre-line">
            {issue.description || 'No description provided.'}
          </div>
        </div>

        {/* Metadata Properties Grid */}
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5 grid grid-cols-2 gap-3 text-[11px]">
          <div>
            <span className="block text-[10px] uppercase font-mono text-[#7D8395] mb-0.5">
              Assignee
            </span>
            <div className="flex items-center gap-1.5 text-[#E1E4EA]">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${issue.assignee.color}`}
              >
                {issue.assignee.initials}
              </span>
              <span>{issue.assignee.name}</span>
            </div>
          </div>

          <div>
            <span className="block text-[10px] uppercase font-mono text-[#7D8395] mb-0.5">
              Reporter
            </span>
            <div className="flex items-center gap-1.5 text-[#E1E4EA]">
              <span className="w-4 h-4 rounded-full bg-[#2E3240] text-[#7D8395] flex items-center justify-center text-[9px] font-bold">
                {issue.reporter.initials}
              </span>
              <span>{issue.reporter.name}</span>
            </div>
          </div>

          <div>
            <span className="block text-[10px] uppercase font-mono text-[#7D8395] mb-0.5">
              Component
            </span>
            <span className="text-[#9D68FF] font-medium">
              {issue.component || '-'}
            </span>
          </div>

          <div>
            <span className="block text-[10px] uppercase font-mono text-[#7D8395] mb-0.5">
              Fix Version
            </span>
            <span className="font-mono text-[#E1E4EA]">
              {issue.version || '-'}
            </span>
          </div>
        </div>

        {/* Time Tracking Widget */}
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] mb-2">
            <span className="text-[10px] uppercase font-mono text-[#7D8395]">
              Time Tracking
            </span>
            <span className="font-mono text-[11px] text-[#34C759]">
              Logged: {formatTimeSpent(issue.timeSpent) || '0m'} / {issue.estimate}
            </span>
          </div>
        </div>

        {/* Discussion / Comments */}
        <div className="bg-[#232630] border border-[#2E3240] rounded-lg p-3.5 space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#E1E4EA]">
            <MessageSquare className="w-3.5 h-3.5 text-[#5384F7]" />
            <span>Activity & Comments ({comments.length})</span>
          </div>

          <div className="space-y-2.5">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="p-2.5 rounded bg-[#1C1E26] border border-[#2B2E3C] text-[11.5px]"
              >
                <div className="flex items-center justify-between text-[10.5px] text-[#7D8395] mb-1">
                  <div className="flex items-center gap-1.5 font-medium text-[#C5CAD4]">
                    <span className="w-3.5 h-3.5 rounded-full bg-[#2E3240] flex items-center justify-center text-[8.5px] text-[#5384F7]">
                      {initials(comment.author.displayName || '')}
                    </span>
                    <span>{comment.author.displayName}</span>
                  </div>
                  <span className="font-mono">{formatLocalDateTime(comment.created, systemTimeZone)}</span>
                </div>
                <div className="text-[#C5CAD4] leading-relaxed whitespace-pre-wrap select-text">{comment.body}</div>
                <button disabled={writing || loading} onClick={() => setReplyTo(comment)} className="mt-2 text-[#5384F7]">{messages.reply}</button>
              </div>
            ))}
          </div>

          {/* Quick Comment box */}
          {!loading && !comments.length && <p className="text-[#7D8395]">{messages['no.comments']}</p>}
          {replyTo && <div className="flex gap-2 text-[#7D8395]">{messages['reply.to']} {replyTo.author.displayName}
            <button onClick={() => setReplyTo(undefined)}>{messages.cancel}</button>
          </div>}
          <form onSubmit={handleAddComment} className="mt-2 flex gap-1.5">
            <input
              type="text"
              placeholder="Add a comment on Jira..."
              value={newComment}
              disabled={writing}
              onChange={(e) => setNewComment(e.target.value)}
              className="flex-1 bg-[#181A20] text-[#E1E4EA] text-[11.5px] px-2.5 py-1.5 rounded border border-[#2E3240] focus:outline-none focus:border-[#3B68FF]"
            />
            <button
              type="submit"
              disabled={writing || loading || !newComment.trim()}
              className="px-2.5 py-1.5 rounded bg-[#3B68FF] text-white hover:bg-[#4E76FF] transition-colors"
            >
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

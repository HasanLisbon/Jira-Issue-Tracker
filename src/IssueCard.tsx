import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Bookmark,
  Bug,
  Flame,
  ArrowUp,
  ChevronsUp,
  ArrowDown,
  Play,
  Pause,
  ArrowRight,
  Sparkles,
  GitBranch,
} from 'lucide-react';
import { JiraIssue, Subtask } from './types.ts';
import { SubtaskList } from './SubtaskList.tsx';
import { messages } from './messages.ts';
import type { TaskBranches } from './branches.ts';

interface IssueCardProps {
  issue: JiraIssue;
  branches?: TaskBranches;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onOpenDetails: (issue: JiraIssue) => void;
  onStartTracking: (issue: JiraIssue, e: React.MouseEvent) => void;
  isCurrentlyTracking?: boolean;
  onToggleSubtaskDone?: (subtaskId: string, e: React.MouseEvent) => void;
  onSelectSubtask?: (subtask: Subtask) => void;
  onStartSubtaskTimer?: (subtask: Subtask, e: React.MouseEvent) => void;
}

export const IssueCard: React.FC<IssueCardProps> = ({
  issue,
  branches,
  isSelected,
  isExpanded,
  onToggleExpand,
  onSelect,
  onOpenDetails,
  onStartTracking,
  isCurrentlyTracking = false,
  onToggleSubtaskDone,
  onSelectSubtask,
  onStartSubtaskTimer,
}) => {
  // Render type icon
  const renderTypeIcon = () => {
    if (issue.priority === 'CRITICAL' || issue.type === 'bug') {
      return (
        <span className="text-[#FF5C5C] shrink-0" title="Bug / Critical">
          {issue.priority === 'CRITICAL' ? (
            <Flame className="w-3.5 h-3.5 fill-[#FF5C5C]/20" />
          ) : (
            <Bug className="w-3.5 h-3.5" />
          )}
        </span>
      );
    }
    if (issue.type === 'epic') {
      return (
        <span className="text-[#9D68FF] shrink-0" title="Epic / Story">
          <Bookmark className="w-3.5 h-3.5 fill-[#9D68FF]/30" />
        </span>
      );
    }
    return (
      <span className="text-[#34C759] shrink-0" title="Standard Task">
        <CheckCircle2 className="w-3.5 h-3.5" />
      </span>
    );
  };

  // Render priority indicator
  const renderPriority = () => {
    if (issue.priority === 'CRITICAL') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold tracking-wide bg-[#3D1F24] text-[#FF5C5C] border border-[#FF5C5C]/20 font-mono">
          ❗ CRITICAL
        </span>
      );
    }
    if (issue.priority === 'HIGHEST') {
      return (
        <span className="text-[#FF5C5C] flex items-center" title="Highest Priority">
          <ChevronsUp className="w-3.5 h-3.5 stroke-[2.5]" />
        </span>
      );
    }
    if (issue.priority === 'HIGH') {
      return (
        <span className="text-[#F59E0B] flex items-center" title="High Priority">
          <ArrowUp className="w-3.5 h-3.5 stroke-[2.5]" />
        </span>
      );
    }
    if (issue.priority === 'LOW') {
      return (
        <span className="text-[#7D8395] flex items-center" title="Low Priority">
          <ArrowDown className="w-3.5 h-3.5" />
        </span>
      );
    }
    return null;
  };

  // Status badge styling
  const renderStatusBadge = () => {
    switch (issue.status) {
      case 'Accepted':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide  bg-[#108f23] text-[#f0f2e9] border border-[#34C759]/25 font-mono">
            {issue.status}
          </span>
        );
      case 'Done':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#108f23] text-[#f0f2e9] border border-[#34C759]/25 font-mono">
            {issue.status}
          </span>
        );

      case 'Rejected':
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#eb0505] text-[#f0f2e9] border border-[#5c0a0a]/25 font-mono">
            {issue.status}
          </span>
        );
      case 'ToDo':
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#282A33] text-[#f0f2e9] border border-[#2E3240] font-mono">
            {issue.status}
          </span>
        );
      case 'Ready for Development':
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#282A33] text-[#f0f2e9] border border-[#2E3240] font-mono">
            {issue.status}
          </span>
        );

      case 'Pending':
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#ebcf34] text-[#f0f2e9] border border-[#81870b] font-mono">
            {issue.status}
          </span>
        );

      case 'Waiting for Input':
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#ebcf34] text-[#f0f2e9] border border-[#81870b] font-mono">
            {issue.status}
          </span>
        );

      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#0561eb] text-[#f0f2e9] border border-[#0518eb] font-mono">
            {issue.status}
          </span>
        );
    }
  };

  const hasSubtasks = Boolean(issue.subtasks && issue.subtasks.length > 0);

  return (
    <div
      onClick={onSelect}
      className={`group relative rounded-md transition-all duration-150 border text-[#E1E4EA] ${
        isSelected
          ? 'bg-[#262A37] border-[#3B68FF] shadow-[0_0_0_1px_#3B68FF]'
          : 'bg-[#232630] border-[#2E3240] hover:bg-[#252834] hover:border-[#383C4D]'
      }`}
    >
      <div className="p-3">
        {/* Card Header */}
        <div className="flex items-center justify-between gap-2 text-[11px] mb-2">
          {/* Left: Expand/Collapse + Type Icon + Key + Priority + Tags */}
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {/* Chevron toggle button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              title={isExpanded ? 'Collapse issue' : 'Expand issue'}
              className="p-0.5 -ml-1 text-[#7D8395] hover:text-[#E1E4EA] hover:bg-[#2E3240] rounded transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Type Icon */}
            {renderTypeIcon()}

            {/* Issue Key */}
            <span className="font-mono font-semibold text-[12px] text-[#5384F7] group-hover:text-[#6E95FF] tracking-tight">
              {issue.key}
            </span>

            {/* Priority */}
            {renderPriority()}

            {/* Version Tag */}
            {issue.version && (
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1E2028] text-[#7D8395] border border-[#2E3240] font-mono">
                {issue.version}
              </span>
            )}

            {/* Component Tag */}
            {issue.component && (
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1E2028] text-[#9D68FF] border border-[#9D68FF]/20 font-mono">
                {issue.component}
              </span>
            )}

            {/* Sprint Info Badge (Card 2) */}
            {issue.sprintInfo && (
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1E2028] text-[#5384F7] border border-[#5384F7]/20 font-mono">
                {issue.sprintInfo}
              </span>
            )}
          </div>

          {/* Right: Status Badge & optional top Details link */}
          <div className="flex items-center gap-2 shrink-0">
            {renderStatusBadge()}

            {issue.type === 'epic' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetails(issue);
                }}
                className="text-[11px] text-[#5384F7] hover:text-[#6E95FF] hover:underline flex items-center gap-1 font-medium transition-colors"
              >
                Details ➔
              </button>
            )}
          </div>
        </div>

        {/* Progress bar for Card 2 (Segmented Progress Bar: 1/3 green, 2/3 dark) */}
        {issue.progress && (
          <div className="mb-2.5">
            <div className="w-full h-1.5 bg-[#181A20] rounded-full overflow-hidden flex border border-[#2E3240]">
              <div
                className="bg-[#34C759] h-full transition-all duration-300"
                style={{ width: `${issue.progress.percent}%` }}
                title={`${issue.progress.doneCount}/${issue.progress.totalCount} Done`}
              />
              <div className="bg-[#232630] h-full flex-1" />
            </div>
          </div>
        )}

        {/* Body: Issue Title / Summary */}
        <div
          className="text-[12.5px] font-medium text-[#E1E4EA] leading-snug mb-3 cursor-pointer group-hover:text-[#FFFFFF]"
          onClick={() => onOpenDetails(issue)}
          title="Click to view full issue details"
        >
          {issue.title}
        </div>

        <div aria-label={messages['branch.card.label']} data-branch-issue={issue.key}
          title={branches?.state === 'error' ? branches.message : undefined}
          className="mb-3 flex items-start gap-1.5 text-[11px] font-mono text-[#7D8395]">
          <GitBranch className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-all">{!branches ? messages['branch.checking']
            : branches.state === 'error' ? messages['branch.card.failed']
            : branches.names.length ? branches.names.join(', ') : messages['branch.card.none']}</span>
        </div>

        {/* Nested Subtask Tree when expanded (Card 2) */}
        {hasSubtasks && isExpanded && (
          <SubtaskList
            subtasks={issue.subtasks!}
            onSelectSubtask={onSelectSubtask}
            onToggleSubtaskDone={onToggleSubtaskDone}
            onStartSubtaskTimer={onStartSubtaskTimer}
          />
        )}

        {/* Footer (Not needed on Epic Card 2 per spec or rendered minimally) */}
        {issue.type !== 'epic' && (
          <div className="flex items-center justify-between pt-2 border-t border-[#2B2E3C]/60 text-[11px]">
            {/* Assignee pill + Estimate */}
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
                title={`Assignee: ${issue.assignee.name}`}
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${issue.assignee.color}`}
                >
                  {issue.assignee.initials}
                </span>
                <span className="text-[#C5CAD4] truncate max-w-[110px]">
                  {issue.assignee.name}
                </span>
              </div>

              <span className="font-mono text-[#7D8395] text-[11px] tabular-nums">
                {issue.estimate}
              </span>
            </div>

            {/* Actions: Start Task Button + Details ➔ */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => onStartTracking(issue, e)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-all shadow-sm ${
                  isCurrentlyTracking
                    ? 'bg-[#19332A] text-[#34C759] border border-[#34C759]/40 hover:bg-[#1E3F33]'
                    : 'bg-[#3B68FF] text-white hover:bg-[#4E76FF] active:bg-[#2F57E0]'
                }`}
              >
                {isCurrentlyTracking ? (
                  <>
                    <Pause className="w-3 h-3 fill-current" />
                    <span>Tracking...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>{issue.type === 'task' ? 'Start Task' : 'Start'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetails(issue);
                }}
                className="text-[11px] text-[#5384F7] hover:text-[#6E95FF] hover:underline flex items-center gap-1 font-medium px-1 py-0.5 transition-colors"
              >
                Details ➔
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import React from 'react';
import { Check, PlayCircle, Circle, ArrowRight } from 'lucide-react';
import { Subtask } from './types.ts';
import { messages } from './messages.ts';

interface SubtaskListProps {
  subtasks: Subtask[];
  onSelectSubtask?: (subtask: Subtask) => void;
  onToggleSubtaskDone?: (subtaskId: string, e: React.MouseEvent) => void;
  onStartSubtaskTimer?: (subtask: Subtask, e: React.MouseEvent) => void;
}

export const SubtaskList: React.FC<SubtaskListProps> = ({
  subtasks,
  onSelectSubtask,
  onToggleSubtaskDone,
  onStartSubtaskTimer,
}) => {
  return (
    <div className="mt-2.5 pt-2 border-t border-[#2B2E3C]/60">
      <div className="text-[10px] uppercase font-mono tracking-wider text-[#7D8395] mb-2 px-1 flex items-center justify-between">
        <span>Sub-tasks ({subtasks.filter((s) => s.done).length}/{subtasks.length} Done)</span>
      </div>

      <div className="space-y-1.5 pl-2 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-[#2E3240]">
        {subtasks.map((subtask) => {
          const isDone = subtask.status === 'DONE' || subtask.done;
          const isInProgress = subtask.status === 'IN PROGRESS';

          return (
            <div
              key={subtask.id}
              onClick={() => onSelectSubtask?.(subtask)}
              className="group relative flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded bg-[#1C1E26]/70 hover:bg-[#252834] transition-colors cursor-pointer border border-transparent hover:border-[#2E3240]"
            >
              {/* Connector line dot */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={(e) => onToggleSubtaskDone?.(subtask.id, e)}
                  title={messages['subtask.open']}
                  className="shrink-0 text-[#7D8395] hover:text-[#E1E4EA] focus:outline-none transition-colors"
                >
                  {isDone ? (
                    <div className="w-3.5 h-3.5 rounded bg-[#19332A] border border-[#34C759]/40 flex items-center justify-center text-[#34C759]">
                      <Check className="w-2.5 h-2.5 stroke-[2.5]" />
                    </div>
                  ) : isInProgress ? (
                    <PlayCircle className="w-3.5 h-3.5 text-[#5384F7]" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-[#7D8395] group-hover:text-[#E1E4EA]" />
                  )}
                </button>

                {/* Key */}
                <span className="font-mono text-[11px] font-semibold text-[#5384F7] group-hover:text-[#6E95FF] shrink-0">
                  {subtask.key}
                </span>

                {/* Title */}
                <span
                  className={`text-[12px] truncate ${
                    isDone
                      ? 'line-through text-[#7D8395]'
                      : 'text-[#E1E4EA]'
                  }`}
                  title={subtask.title}
                >
                  {subtask.title}
                </span>
              </div>

              {/* Status Badge & Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {isDone && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#19332A] text-[#34C759] border border-[#34C759]/20 font-mono">
                    {subtask.status}
                  </span>
                )}
                {isInProgress && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#1E2945] text-[#5384F7] border border-[#5384F7]/20 font-mono">
                    <span className="text-[9px]">⏱</span> {subtask.status}
                  </span>
                )}
                {!isDone && !isInProgress && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide bg-[#282A33] text-[#8A8F9E] border border-[#2E3240] font-mono">
                    {subtask.status}
                  </span>
                )}

                {/* Start timer button on hover */}
                <button
                  type="button"
                  onClick={(e) => onStartSubtaskTimer?.(subtask, e)}
                  title="Track time on subtask"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#323646] text-[#7D8395] hover:text-[#5384F7] transition-all"
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

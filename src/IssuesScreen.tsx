import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  ArrowUpDown,
  FileText,
  Boxes,
  RotateCw,
  SlidersHorizontal,
  ChevronDown,
  Layers,
  Sparkles,
  Command,
  LayoutTemplate,
  X,
  Plus,
} from 'lucide-react';
import { JiraIssue, FilterKey, Subtask, IssueStatus } from './types.ts';
import { IssueCard } from './IssueCard.tsx';
import { messages } from './messages.ts';
import type { TaskBranches } from './branches.ts';

interface IssuesScreenProps {
  activeFilter: FilterKey | 'all';
  onFilterChange: (filter: FilterKey | 'all') => void;
  issues: JiraIssue[];
  taskBranches: Record<string, TaskBranches>;
  selectedIssueId: string;
  onSelectIssue: (issue: JiraIssue) => void;
  onOpenDetails: (issue: JiraIssue) => void;
  onStartTracking: (issue: JiraIssue, e: React.MouseEvent) => void;
  activeTrackingKey?: string;
  onUpdateSubtaskDone: (subtaskId: string, e: React.MouseEvent) => void;
  onSelectSubtask: (subtask: Subtask) => void;
  onStartSubtaskTimer: (subtask: Subtask, e: React.MouseEvent) => void;
  onLoadParentKey?: (parentKey: string) => void;
}

export const IssuesScreen: React.FC<IssuesScreenProps> = ({
  activeFilter,
  onFilterChange,
  issues,
  taskBranches,
  selectedIssueId,
  onSelectIssue,
  onOpenDetails,
  onStartTracking,
  activeTrackingKey,
  onUpdateSubtaskDone,
  onSelectSubtask,
  onStartSubtaskTimer,
  onLoadParentKey,
}) => {
  // State for search and active filter pill
  const [searchQuery, setSearchQuery] = useState('');
  const [sortAscending, setSortAscending] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Expanded cards state: Card 2 (proj-1425) expanded by default as requested in spec
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({
    'proj-1425': true,
  });

  const toggleExpand = (issueId: string) => {
    setExpandedCardIds((prev) => ({
      ...prev,
      [issueId]: !prev[issueId],
    }));
  };

  // Keyboard shortcut listener for ⌘F, F4, ⌘U
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘F or Ctrl+F
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      // F4: Open Details
      if (e.key === 'F4') {
        e.preventDefault();
        const selectedIssue = issues.find((i) => i.id === selectedIssueId);
        if (selectedIssue) {
          onOpenDetails(selectedIssue);
        }
      }
      // ⌘U or Ctrl+U: Load parent key
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        handleTriggerLoadParentKey();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIssueId, issues]);

  // Filter pills specification
  const filterPills: { key: FilterKey | 'all'; label: string; count?: number }[] = [
    { key: 'all', label: messages.issues, count: issues.length },
    { key: 'assigned', label: 'Assigned to Me', count: issues.filter((issue) => issue.filterTags.includes('assigned')).length },
    { key: 'reported', label: 'Reported by Me' },
    { key: 'recent', label: 'Recent' },
    { key: 'sprint', label: 'Sprint' },
  ];

  // Filter issues based on active filter and search text
  const filteredIssues = issues
    .filter((issue) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const matchKey = issue.key.toLowerCase().includes(q);
      const matchTitle = issue.title.toLowerCase().includes(q);
      const matchSubtask = issue.subtasks?.some(
        (s) => s.key.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)
      );
      return matchKey || matchTitle || matchSubtask;
    })
    .sort((a, b) => {
      if (sortAscending) {
        return a.key.localeCompare(b.key);
      }
      return b.key.localeCompare(a.key);
    });

  const selectedIssue = issues.find((i) => i.id === selectedIssueId) || issues[0];

  const handleTriggerLoadParentKey = () => {
    // If selected card is a subtask or card 2, navigate/highlight parent
    if (onLoadParentKey) {
      if (selectedIssue?.parentKey) onLoadParentKey(selectedIssue.parentKey);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#181A20] relative">
      {/* 3. Search & Filter Bar */}
      <div className="px-3 pt-2.5 pb-2 border-b border-[#2B2E3C] bg-[#1E2028] shrink-0 space-y-2">
        {/* Search box: Input with magnifying glass, placeholder, right-aligned shortcut badge "⌘F" */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#7D8395] absolute left-2.5 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ticket ID or title (e.g. PROJ-102)..."
            className="w-full bg-[#181A20] text-[#E1E4EA] text-[11.5px] pl-8 pr-14 py-1.5 rounded border border-[#2E3240] focus:outline-none focus:border-[#3B68FF] placeholder:text-[#5B6170] transition-colors"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-8 text-[#7D8395] hover:text-[#E1E4EA] p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          ) : null}
          <div className="absolute right-2.5 pointer-events-none flex items-center">
            <kbd className="px-1.5 py-0.5 text-[9.5px] font-mono text-[#7D8395] bg-[#232630] border border-[#2E3240] rounded shadow-xs">
              ⌘F
            </kbd>
          </div>
        </div>

        {/* Horizontal scrollable filter pill buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          {filterPills.map((pill) => {
            const isActive = activeFilter === pill.key;
            return (
              <button
                key={pill.key}
                type="button"
                onClick={() => onFilterChange(pill.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all shrink-0 border ${
                  isActive
                    ? 'bg-[#1E2945] text-[#5384F7] border-[#5384F7]/40 shadow-xs'
                    : 'bg-[#232630] text-[#7D8395] hover:text-[#C5CAD4] border-[#2E3240] hover:border-[#383C4D]'
                }`}
              >
                <span>{pill.label}</span>
                {pill.count !== undefined && (
                  <span
                    className={`px-1 rounded text-[9.5px] font-mono ${
                      isActive
                        ? 'bg-[#3B68FF] text-white'
                        : 'bg-[#181A20] text-[#7D8395]'
                    }`}
                  >
                    {pill.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Scope Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1C1E26] border-b border-[#2B2E3C] shrink-0 text-[11px]">
        {/* Left: "Sprint Backlog / " in muted gray, followed by "Active Scope" in teal/cyan */}
        <div className="flex items-center gap-1 font-medium">
          <span className="text-[#2DD4BF] font-semibold">{messages['issue.scope']}</span>
        </div>

        {/* Right: "4 ISSUES" with up/down sort chevron */}
        <button
          type="button"
          onClick={() => setSortAscending(!sortAscending)}
          title="Toggle sort order"
          className="flex items-center gap-1 font-mono text-[10.5px] font-semibold text-[#7D8395] hover:text-[#E1E4EA] transition-colors"
        >
          <span>{filteredIssues.length} ISSUES</span>
          <ArrowUpDown className="w-3 h-3 text-[#7D8395]" />
        </button>
      </div>

      {/* 5. Issue Card List (scrollable area) */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 pb-20">
        {filteredIssues.length === 0 ? (
          <div className="py-12 text-center text-[#7D8395]">
            <Layers className="w-8 h-8 mx-auto mb-2 opacity-40 text-[#5384F7]" />
            <p className="text-[12px] font-medium text-[#C5CAD4]">No issues found</p>
            <p className="text-[11px] mt-0.5">
              No matching tickets in "{activeFilter}" scope for "{searchQuery}".
            </p>
            <button
              type="button"
                onClick={() => {
                setSearchQuery('');
                  onFilterChange('all');
              }}
              className="mt-3 px-3 py-1 rounded bg-[#232630] border border-[#2E3240] text-[11px] text-[#5384F7] hover:text-white"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              branches={taskBranches[issue.parentKey || issue.key]}
              isSelected={issue.id === selectedIssueId}
              isExpanded={Boolean(expandedCardIds[issue.id])}
              onToggleExpand={() => toggleExpand(issue.id)}
              onSelect={() => onSelectIssue(issue)}
              onOpenDetails={onOpenDetails}
              onStartTracking={onStartTracking}
              isCurrentlyTracking={activeTrackingKey === issue.key}
              onToggleSubtaskDone={onUpdateSubtaskDone}
              onSelectSubtask={onSelectSubtask}
              onStartSubtaskTimer={onStartSubtaskTimer}
            />
          ))
        )}
      </div>

      {/* 6. Floating Action Dock (Bottom pinned bar above the status line) */}
      <div className="absolute bottom-6 left-0 right-0 px-3 py-2 bg-[#181A20]/95 backdrop-blur-md border-t border-[#2B2E3C] flex items-center justify-between z-20 shadow-lg">
        <div className="flex items-center gap-2">
          {/* Left button: [ 📄 Open Details  F4 ] (Light blue filled button) */}
          <button
            type="button"
            onClick={() => onOpenDetails(selectedIssue)}
            disabled={!selectedIssue}
            title="Open Details (F4)"
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#3B68FF] text-white hover:bg-[#4E76FF] active:bg-[#2F57E0] text-[11px] font-semibold transition-all shadow-sm"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Open Details</span>
            <kbd className="px-1 py-0.2 rounded text-[9.5px] font-mono bg-white/20 text-white">
              F4
            </kbd>
          </button>

          {/* Center/Right button: [ ⊞ Load parent key  ⌘U ] (Dark slate button) */}
          <button
            type="button"
            onClick={handleTriggerLoadParentKey}
            disabled={!selectedIssue?.parentKey}
            title="Load parent key (⌘U)"
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#232630] text-[#E1E4EA] hover:bg-[#2E3240] border border-[#2E3240] text-[11px] font-medium transition-all shadow-xs"
          >
            <Boxes className="w-3.5 h-3.5 text-[#5384F7]" />
            <span>Load parent key</span>
            <kbd className="px-1 py-0.2 rounded text-[9.5px] font-mono bg-[#181A20] text-[#7D8395] border border-[#2E3240]">
              ⌘U
            </kbd>
          </button>
        </div>

        {/* Green status indicator dot on far right */}
      </div>

      {/* 7. Footer Status Bar (Fixed bottom strip) */}
      <div className="h-6 bg-[#181A20] border-t border-[#2B2E3C] px-3 flex items-center justify-between text-[10.5px] text-[#7D8395] shrink-0 font-sans z-30">
        {/* Left: Green dot with label "CGM Live · Jira Cloud: PROJ active" */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#34C759]" />
          <span className="text-[#9CA3AF] tracking-tight">
            {messages['issue.scope']}
          </span>
        </div>

        {/* Right: Status label "Synced" and dock icon */}
        <div className="flex items-center gap-2">
          <span className="text-[#9CA3AF]">{issues.length}</span>
          <LayoutTemplate className="w-3 h-3 text-[#7D8395] hover:text-[#E1E4EA] cursor-pointer" />
        </div>
      </div>
    </div>
  );
};

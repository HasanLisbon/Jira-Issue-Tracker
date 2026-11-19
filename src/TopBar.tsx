import React from 'react';
import { Zap, RotateCw, SlidersHorizontal, ListTodo, Timer, FileText, Calendar, ClipboardList } from 'lucide-react';
import type { ActiveTab } from './types.ts';
import type { JiraConnection } from './jira.ts';
import { messages } from './messages.ts';

interface TopBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenSettings: () => void;
  connections: JiraConnection[];
  connectionId: string;
  onSelectConnection: (id: string) => void;
  hasActiveTimer: boolean;
  stagedCount: number;
  user: string;
  disabled: boolean;
}

export const TopBar: React.FC<TopBarProps> = (props) => (
  <div className="shrink-0 bg-[#181A20] border-b border-[#2B2E3C] select-none">
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#232630]">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded bg-[#3B68FF] flex items-center justify-center text-white shrink-0"><Zap className="w-4 h-4" /></div>
        <span className="text-[12.5px] font-semibold">{messages.issues}</span>
        <select aria-label={messages.settings} value={props.connectionId} disabled={props.disabled}
          onChange={(event) => props.onSelectConnection(event.target.value)}
          className="min-w-0 max-w-52 bg-[#232630] text-[#A8B0C3] font-mono text-[11px] rounded px-1 py-1">
          {!props.connections.length && <option value="">{messages['no.connection']}</option>}
          {props.connections.map((connection) => <option key={connection.id} value={connection.id} title={connection.url}>{connection.name}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" title={messages.refresh} onClick={props.onRefresh} disabled={props.disabled} className="p-1 text-[#7D8395] hover:text-white">
          <RotateCw className={`w-3.5 h-3.5 ${props.isRefreshing ? 'animate-spin text-[#3B68FF]' : ''}`} />
        </button>
        <button type="button" title={messages.settings} disabled={props.disabled} onClick={props.onOpenSettings} className="p-1 text-[#7D8395] hover:text-white"><SlidersHorizontal className="w-3.5 h-3.5" /></button>
        <span className="max-w-24 truncate text-[11px] text-[#C5CAD4]" title={props.user}>{props.user}</span>
      </div>
    </div>
    <div className="flex items-center px-2 pt-1 gap-1 overflow-x-auto">
      {([['issues', ListTodo], ['tracker', Timer], ['details', FileText], ['meetings', Calendar], ['staged', ClipboardList]] as const).map(([tab, Icon]) => (
        <button key={tab} type="button" disabled={props.disabled} onClick={() => props.onTabChange(tab)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-t text-[11.5px] font-medium border-t border-x shrink-0 ${props.activeTab === tab ? 'bg-[#1E2028] text-[#E1E4EA] border-[#2B2E3C]' : 'text-[#7D8395] border-transparent hover:bg-[#232630]'}`}>
          <Icon className={`w-3.5 h-3.5 ${tab === 'tracker' && props.hasActiveTimer ? 'text-[#34C759]' : 'text-[#5384F7]'}`} />
          <span>{messages[tab]}</span>
          {tab === 'staged' && props.stagedCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#3B68FF] text-white font-mono text-[9.5px] leading-tight">
              {props.stagedCount}
            </span>
          )}
        </button>
      ))}
    </div>
  </div>
);

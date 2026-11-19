export type IssueStatus = string;

export type Priority = string;

export interface Subtask {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  done: boolean;
  assignee?: {
    name: string;
    avatarInitials: string;
    avatarColor: string;
  };
  estimate?: string;
  timeSpent?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  type: 'task' | 'epic' | 'bug' | 'story';
  title: string;
  status: IssueStatus;
  priority: Priority;
  version?: string;
  component?: string;
  sprintInfo?: string;
  progress?: {
    doneCount: number;
    totalCount: number;
    percent: number;
  };
  assignee: {
    name: string;
    initials: string;
    color: string;
    isCurrentUser?: boolean;
  };
  reporter: {
    name: string;
    initials: string;
  };
  estimate: string;
  timeSpent?: string;
  subtasks?: Subtask[];
  description?: string;
  createdDate?: string;
  updatedDate?: string;
  labels?: string[];
  parentKey?: string;
  filterTags: Array<'assigned' | 'reported' | 'recent' | 'sprint'>;
}

export type FilterKey = 'assigned' | 'reported' | 'recent' | 'sprint';

export type ActiveTab = 'issues' | 'tracker' | 'details' | 'meetings' | 'staged';

export interface StagedWorklog {
  id: string;
  issueKey: string;
  issueTitle: string;
  minutes: number;
  started: string;
  comment: string;
  source: 'tracker' | 'meeting';
}

export interface TeamsMeeting {
  id: string;
  seriesKey: string;
  title: string;
  start: string;
  end: string;
  durationMinutes: number;
  durationFormatted: string;
  joinUrl?: string;
  isTeamsMeeting: boolean;
  organizer?: string;
}

export interface MeetingTicketMapping {
  matchKey: string;
  matchType: 'series' | 'instance';
  meetingTitle: string;
  issueKey: string;
  issueTitle: string;
}

export interface TeamsMeetingsResponse {
  configured: boolean;
  mode: 'ics' | 'graph';
  icsUrl: string;
  hasGraphToken: boolean;
  meetings: TeamsMeeting[];
  mappings: MeetingTicketMapping[];
}

export interface ActiveTimer {
  issueKey: string;
  issueTitle: string;
  seconds: number;
  isRunning: boolean;
  startedAt?: Date;
}

export interface MeetingTimerPause {
  meetingId: string;
  meetingTitle: string;
  meetingEnd: string;
  issueKey: string;
}

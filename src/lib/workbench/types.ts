/* ==================== Workbench Aurora — Core Types ==================== */

export type ThemeId = 'light' | 'dark' | 'prism';

export type ViewId =
  | 'today'
  | 'inbox'
  | 'dashboard'
  | 'goals'
  | 'log'
  | 'habits'
  | 'journal'
  | 'calendar'
  | 'reports';

export type ItemType = 'goal' | 'task' | 'note';
export type ItemStatus = 'inbox' | 'todo' | 'in_progress' | 'waiting' | 'done' | 'archived';
export type Priority = 'p0' | 'p1' | 'p2' | 'p3';

export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}

export interface Item {
  id: string;
  title: string;
  type: ItemType;
  parentId: string | null;
  deadline: string | null; // ISO date yyyy-mm-dd
  notes: string;
  manualProgress: number; // 0-100, used when no children/checklist
  checklist: ChecklistEntry[];
  color: string | null;
  priority: Priority;
  status: ItemStatus;
  estimateMin: number | null;
  nextAction: string;
  dependsOn: string[]; // item ids this item waits on
  plannedStart: string | null; // yyyy-mm-ddThh:mm timebox start
  plannedEnd: string | null; // yyyy-mm-ddThh:mm timebox end
  startDate: string | null; // planned day (capacity planning)
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  itemIds: string[];
}

export interface Entry {
  id: string;
  date: string; // yyyy-mm-dd
  startTime: string | null; // HH:MM
  endTime: string | null; // HH:MM
  durationMin: number;
  labelIds: string[];
  itemIds: string[];
  note: string;
  createdAt: string;
}

export interface Habit {
  id: string;
  name: string;
  description: string;
  color: string;
  cadence: 'daily' | 'weekly';
  log: Record<string, boolean>; // yyyy-mm-dd -> done
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  date: string; // yyyy-mm-dd
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Pomodoro {
  workMin: number;
  breakMin: number;
  phase: 'work' | 'break';
  cycle: number;
  pausedAt: string | null; // ISO timestamp — countdown frozen while set
}

export interface ActiveTimer {
  startedAt: string; // ISO timestamp
  labelIds: string[];
  itemIds: string[];
  note: string;
  pomodoro: Pomodoro | null;
}

export type GraphView = 'tree' | 'kanban' | 'matrix';
export type ReportRange = 'today' | 'week' | 'month' | 'all';
export type CalendarSystem = 'gregorian' | 'shamsi';
export type ClockType = 'analog' | 'digital' | 'minimal' | 'flip';

export interface FocusTiming {
  phaseLabel: string;
  remaining: number; // seconds
  progress: number; // 0-100
  cycleCount: number;
  paused: boolean;
}

export const SWATCHES = [
  '#0F766E', '#D97706', '#7C3AED', '#DB2777', '#0891B2',
  '#65A30D', '#EA580C', '#4F46E5', '#14B8A6', '#9333EA',
];

export const FOCUS_BACKGROUNDS = [
  'aurora', 'flow', 'nebula', 'grid', 'stars', 'solid', 'paper', 'ember', 'midnight',
] as const;

export const FOCUS_PRESETS = [
  { id: '25', label: 'Deep', workMin: 25, breakMin: 5 },
  { id: '50', label: 'Flow', workMin: 50, breakMin: 10 },
  { id: '90', label: 'Immersion', workMin: 90, breakMin: 15 },
  { id: 'custom', label: 'Custom', workMin: 45, breakMin: 10 },
] as const;

/* ==================== Workbench Aurora — Core Types ==================== */

export type ThemeId = 'light' | 'dark' | 'prism';

export type ViewId =
  | 'today'
  | 'inbox'
  | 'dashboard'
  | 'goals'
  | 'library'
  | 'roadmap'
  | 'planner'
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
  fileIds: string[]; // library files linked to this item (many-to-many)
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
  fileId: string | null; // library file this session is reading (focus-read)
  note: string;
  pomodoro: Pomodoro | null;
}

/* ==================== v4: Library (PDF files) ==================== */

export type FileCoverMode = 'page' | 'custom';

export interface ResourceFile {
  id: string;
  title: string;
  fileName: string;
  size: number; // bytes
  pageCount: number;
  addedAt: string; // ISO
  deadline: string | null; // yyyy-mm-dd "dead time"
  coverMode: FileCoverMode; // 'page' renders coverPage, 'custom' uses uploaded image (IDB)
  coverPage: number; // 1-based page used as cover when coverMode === 'page'
  color: string | null;
  tags: string[];
  notes: string;
  currentPage: number; // 1-based reading position
  pageSeconds: Record<string, number>; // page number -> accumulated seconds
  readPages: string[]; // manually marked read page ids
  lastReadAt: string | null;
  archived: boolean;
}

export interface ReadingSession {
  id: string;
  fileId: string;
  date: string; // yyyy-mm-dd
  startedAt: string; // ISO
  endedAt: string; // ISO
  minutes: number;
  pagesVisited: number;
  pagesRead: number;
  startPage: number;
  endPage: number;
}

export interface FilePlanBlock {
  id: string;
  fileId: string;
  date: string; // yyyy-mm-dd
  startMin: number; // minutes from midnight
  minutes: number;
  done: boolean;
}

/* ==================== v4: Roadmaps ==================== */

export type RoadmapNodeKind = 'goal' | 'task' | 'file' | 'milestone' | 'note';

export interface RoadmapNode {
  id: string;
  kind: RoadmapNodeKind;
  refId: string | null; // linked entity id (item id / file id)
  label: string; // fallback title (mirrors entity when linked)
  x: number;
  y: number;
  milestoneDate: string | null; // yyyy-mm-dd for milestones
  note: string; // note text / extra context
  done: boolean; // manual toggle for milestones
}

export interface RoadmapEdge {
  id: string;
  from: string; // node id
  to: string; // node id
  label: string; // e.g. "then", "needs"
}

export interface Roadmap {
  id: string;
  title: string;
  description: string;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
  createdAt: string;
  updatedAt: string;
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

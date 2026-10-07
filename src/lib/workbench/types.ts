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
  | 'reports'
  | 'vocab';

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

export type FileCoverMode = 'page' | 'custom' | 'text';

/* ==================== v7: vocabulary (dictionary flashcards) ==================== */

/** One part-of-speech sense from the dictionary lookup. */
export interface VocabSense {
  pos: string;
  defs: string[];
  syns: string[];
  ants: string[];
  ex: string[];
}

/** A saved word for review. Leitner box 0=learning … 5=mastered. */
export interface VocabEntry {
  id: string;
  word: string;
  lang: 'en';
  translation: string | null; // Persian meaning when saved from the FA tab
  senses: VocabSense[] | null; // null while only the translation is known
  sourceFileId: string | null;
  sourcePage: number | null;
  createdAt: string;
  box: number; // 0..5
  lastReviewAt: string | null;
  nextReviewAt: string; // ISO date
}
/** Library file kinds: PDF documents and Markdown notes/docs. */
export type FileKind = 'pdf' | 'md';

/** Library folder — user-created grouping for shelf organization (nested tree). */
export interface LibraryFolder {
  id: string;
  name: string;
  color: string;
  icon: string; // FOLDER_ICONS key
  parentId: string | null; // nested subfolders
  createdAt: string;
}

export const FOLDER_ICONS = [
  'folder', 'book', 'graduation', 'flask', 'calculator', 'code',
  'music', 'globe', 'star', 'archive', 'pen', 'brain',
] as const;
export type FolderIcon = (typeof FOLDER_ICONS)[number];

export interface ResourceFile {
  id: string;
  kind: FileKind; // 'pdf' rendered by pdf.js · 'md' rendered as markdown
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
  favoritePages: string[]; // starred pages (simple / review collections)
  annoPages: string[]; // pages carrying pen/highlight annotations (IDB mirror)
  folderId: string | null; // library folder
  lastReadAt: string | null;
  archived: boolean;
  scrollProgress?: number; // 0-100 — reading progress for kind 'md'
}

/* ---------- v5: PDF annotations (pen / highlight / eraser) ---------- */

export type AnnoTool = 'pen' | 'highlight';
export type StrokeShape = 'rect' | 'ellipse' | 'line' | 'arrow';

/** A freehand stroke, normalized to page dimensions (0..1) so it survives zoom. */
export interface Stroke {
  id: string;
  tool: AnnoTool | 'whiteout';
  shape?: StrokeShape | 'text'; // text boxes: points[0..1] = top-left/bottom-right
  text?: string; // text-box content (canvas-rendered, Persian-safe)
  fontSize?: number; // px at 1000px reference page width
  font?: 'sans' | 'serif' | 'mono' | 'persian'; // text-box font family
  group?: string; // linked strokes (e.g. whiteout patch + its replacement box) die together
  note?: string; // user note attached to this annotation (sidebar)
  color: string;
  width: number; // px at 1000px reference page width
  opacity: number; // 0..1 (highlights render translucent)
  points: number[]; // flattened [x0,y0,x1,y1,...] normalized 0..1
  createdAt: number;
}

/** page number (string) -> strokes. Persisted per file in IndexedDB. */
export type PageAnnoMap = Record<string, Stroke[]>;

/* ---------- v5: reader preferences ---------- */

export type ReaderViewMode = 'single' | 'scroll' | 'text' | 'split';
export type ReaderTextFont = 'sans' | 'serif' | 'mono' | 'persian';
export type ReaderTool =
  | 'select'
  | 'pen'
  | 'highlight'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
;
export type ReaderThemeMode = 'light' | 'dark' | 'warm' | 'custom';

export interface ReaderPrefs {
  viewMode: ReaderViewMode;
  tool: ReaderTool;
  themeMode: ReaderThemeMode;
  custom: { brightness: number; contrast: number; sepia: number }; // percent, 100 = neutral
  penColor: string;
  penWidth: number; // px
  penOpacity: number; // 0..1
  hlColor: string;
  hlWidth: number; // px
  hlOpacity: number; // 0..1
  recentColors: string[]; // most-recent-first, max 6
  /* text reflow mode typography */
  textFont: ReaderTextFont;
  textSize: number; // px 14–28
  textLineHeight: number; // 1.4–2.2
  textWidth: number; // ch 40–80
  eraserSize: number; // CSS px radius
  eraserMode: 'stroke' | 'precise'; // whole strokes vs partial split
}

export const HL_SWATCHES = ['#FDE68A', '#86EFAC', '#93C5FD', '#F9A8D4', '#FDBA74', '#C4B5FD'];
export const PEN_SWATCHES = ['#FB7185', '#FBBF24', '#34D399', '#22D3EE', '#A78BFA', '#F8FAFC'];

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
export type ReportRange =
  | 'today' | 'last3' | 'last7' | 'week' | 'month' | 'last30'
  | 'year' | 'lastyear' | 'all' | 'custom';
export interface ReportCustomRange { from: string; to: string }
export type CalendarSystem = 'gregorian' | 'shamsi';
export type ClockType = 'aura' | 'orbit' | 'cards' | 'typo';

/* v6 — focus mode clock configuration: size / position / accent color */
export interface FocusClockCfg {
  size: number; // 60..170 (percent of base clock size)
  xPct: number; // 0..100 horizontal center position
  yPct: number; // 0..100 vertical center position
  accent: string; // 'auto' | hex color
}

/* v6 — user-uploaded focus backgrounds (downscaled dataURLs) */
export interface FocusCustomBg {
  id: string;
  label: string;
  dataUrl: string;
  accent: string; // dominant color extracted at upload time
}

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

export const FOLDER_SWATCHES = [
  '#0F766E', '#D97706', '#7C3AED', '#DB2777', '#0891B2',
  '#65A30D', '#EA580C', '#9333EA',
];

/* Photo atmospheres shipped in /public/focus-bg (switchable in the focus panel). */
export const FOCUS_BACKGROUNDS = [
  'aurora', 'forest', 'sea', 'village', 'desert', 'sky', 'stars', 'night',
] as const;

export type FocusBackgroundId = (typeof FOCUS_BACKGROUNDS)[number];

export const FOCUS_BG_META: { id: FocusBackgroundId; label: string; photo: string | null; accent: string }[] = [
  { id: 'aurora', label: 'Aurora', photo: null, accent: '#2DD4BF' },
  { id: 'forest', label: 'Forest', photo: '/focus-bg/forest.png', accent: '#4ADE80' },
  { id: 'sea', label: 'Sea', photo: '/focus-bg/sea.png', accent: '#22D3EE' },
  { id: 'village', label: 'Village', photo: '/focus-bg/village.png', accent: '#FBBF24' },
  { id: 'desert', label: 'Desert', photo: '/focus-bg/desert.png', accent: '#F59E0B' },
  { id: 'sky', label: 'Sky', photo: '/focus-bg/sky.png', accent: '#93C5FD' },
  { id: 'stars', label: 'Star sky', photo: '/focus-bg/stars.png', accent: '#A5B4FC' },
  { id: 'night', label: 'Night sky', photo: '/focus-bg/night.png', accent: '#818CF8' },
];

export const FOCUS_PRESETS = [
  { id: '25', label: 'Deep', workMin: 25, breakMin: 5 },
  { id: '50', label: 'Flow', workMin: 50, breakMin: 10 },
  { id: '90', label: 'Immersion', workMin: 90, breakMin: 15 },
  { id: 'custom', label: 'Custom', workMin: 45, breakMin: 10 },
] as const;

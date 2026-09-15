/* ==================== Workbench Aurora — Zustand Store ==================== */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ActiveTimer, CalendarSystem, ClockType, Entry, FilePlanBlock, FocusClockCfg, FocusCustomBg,
  FocusTiming, GraphView, Habit, Item, ItemStatus, JournalEntry, Label, LibraryFolder,
  ReadingSession, ReaderPrefs, ReportCustomRange, ReportRange, ResourceFile, Roadmap,
  RoadmapEdge, RoadmapNode, ThemeId, ViewId,
} from './types';
import { FOLDER_ICONS, SWATCHES, FOCUS_PRESETS, FOLDER_SWATCHES } from './types';
import {
  entriesInRange, getFocusTiming, hhmm, isoDate, todayStr, uid,
} from './helpers';

const STORAGE_KEY = 'workbench_aurora_v3';
const MAX_HIST = 80;
const MAX_READING_SESSIONS = 400;

/* ---------- defaults ---------- */

export function makeItem(partial: Partial<Item> = {}): Item {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: 'Untitled',
    type: 'task',
    parentId: null,
    deadline: null,
    notes: '',
    manualProgress: 0,
    checklist: [],
    color: null,
    priority: 'p2',
    status: 'todo',
    estimateMin: null,
    nextAction: '',
    dependsOn: [],
    fileIds: [],
    plannedStart: null,
    plannedEnd: null,
    startDate: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function makeFile(partial: Partial<ResourceFile> = {}): ResourceFile {
  return {
    id: uid(),
    title: 'Untitled PDF',
    fileName: 'file.pdf',
    size: 0,
    pageCount: 1,
    addedAt: new Date().toISOString(),
    deadline: null,
    coverMode: 'page',
    coverPage: 1,
    color: null,
    tags: [],
    notes: '',
    currentPage: 1,
    pageSeconds: {},
    readPages: [],
    favoritePages: [],
    annoPages: [],
    folderId: null,
    lastReadAt: null,
    archived: false,
    ...partial,
  };
}

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  viewMode: 'single',
  tool: 'select',
  themeMode: 'light',
  custom: { brightness: 100, contrast: 100, sepia: 0 },
  penColor: '#FB7185',
  penWidth: 3,
  hlColor: '#FDE68A',
  hlWidth: 18,
};

export function makeRoadmap(partial: Partial<Roadmap> = {}): Roadmap {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: 'New roadmap',
    description: '',
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function makeEntry(partial: Partial<Entry> = {}): Entry {
  return {
    id: uid(),
    date: todayStr(),
    startTime: null,
    endTime: null,
    durationMin: 0,
    labelIds: [],
    itemIds: [],
    note: '',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export interface WBState {
  hydrated: boolean;
  /* data */
  items: Item[];
  labels: Label[];
  entries: Entry[];
  habits: Habit[];
  journal: JournalEntry[];
  activeTimer: ActiveTimer | null;
  expanded: Record<string, boolean>;
  /* v4 data */
  files: ResourceFile[];
  readingSessions: ReadingSession[];
  filePlans: FilePlanBlock[];
  roadmaps: Roadmap[];
  activeRoadmapId: string | null;
  libraryFolders: LibraryFolder[];
  libraryFolderFilter: string; // 'all' | 'unfiled' | folder id
  librarySearch: string;
  readerPrefs: ReaderPrefs;
  /* v6: focus — custom backgrounds + flexible clock */
  focusCustomBgs: FocusCustomBg[];
  focusClockCfg: FocusClockCfg;
  focusAutoColor: boolean; // auto-theme UI accent from background
  /* v6: general */
  sidebarCollapsed: boolean;
  reportCustom: ReportCustomRange;

  /* ui */
  theme: ThemeId;
  view: ViewId;
  graphView: GraphView;
  reportRange: ReportRange;
  calendarSystem: CalendarSystem;
  calMonthOffset: number;
  calendarSelectedDate: string;
  plannerMode: 'day' | 'week';
  plannerDate: string;
  libraryFilter: 'all' | 'reading' | 'unread' | 'deadline' | 'archived';
  focusOpen: boolean;
  focusClockType: ClockType;
  focusBackground: string;
  focusPreset: string;
  focusCustomWork: number;
  focusCustomBreak: number;
  focusCompact: boolean;
  dailyCapacityMin: number;
  stats: { focusSessions: number; focusMinutes: number; readingMinutes: number; pagesRead: number };
  lastSavedAt: string | null;
  /* history (session only) */
  undoStack: string[];
  redoStack: string[];

  /* ---------- actions ---------- */
  setHydrated: (v: boolean) => void;
  setView: (v: ViewId) => void;
  setTheme: (t: ThemeId) => void;
  cycleTheme: () => void;
  setGraphView: (g: GraphView) => void;
  setReportRange: (r: ReportRange) => void;
  setReportCustom: (patch: Partial<ReportCustomRange>) => void;
  setCalendarSystem: (c: CalendarSystem) => void;
  calNavigate: (delta: number) => void;
  calToday: () => void;
  selectCalendarDay: (iso: string) => void;
  setDailyCapacity: (m: number) => void;

  toggleExpanded: (id: string) => void;

  addItem: (partial: Partial<Item>) => Item;
  updateItem: (id: string, patch: Partial<Item>, opts?: { snapshot?: boolean }) => void;
  setItemStatus: (id: string, status: ItemStatus) => void;
  moveItem: (id: string, status: ItemStatus) => void; // kanban DnD with undo snapshot
  deleteItemCascade: (id: string) => void;

  addLabel: (name: string) => void;
  renameLabel: (id: string, name: string) => void;
  deleteLabel: (id: string) => void;
  toggleItemLabel: (itemId: string, labelId: string) => void;

  addEntry: (partial: Partial<Entry>) => void;
  deleteEntry: (id: string) => void;

  addHabit: (partial: Partial<Habit>) => void;
  updateHabit: (id: string, patch: Partial<Habit>) => void;
  deleteHabit: (id: string) => void;
  toggleHabitDay: (id: string, date: string) => void;

  saveJournal: (date: string, content: string) => void;

  /* ---------- v4: library files ---------- */
  addFile: (partial: Partial<ResourceFile>) => ResourceFile;
  updateFile: (id: string, patch: Partial<ResourceFile>) => void;
  deleteFile: (id: string) => void;
  setFilePosition: (id: string, page: number) => void;
  addFilePageSeconds: (id: string, page: number, seconds: number) => void;
  markFilePage: (id: string, page: number, read: boolean) => void;
  logReadingSession: (session: Omit<ReadingSession, 'id'>) => void;
  toggleItemFile: (itemId: string, fileId: string) => void;

  /* ---------- v4: file plan blocks ---------- */
  addFilePlan: (fileId: string, date: string, startMin: number, minutes: number) => FilePlanBlock;
  updateFilePlan: (id: string, patch: Partial<FilePlanBlock>) => void;
  deleteFilePlan: (id: string) => void;

  /* ---------- v4: roadmaps ---------- */
  createRoadmap: (title: string) => Roadmap;
  updateRoadmap: (id: string, patch: Partial<Pick<Roadmap, 'title' | 'description'>>) => void;
  deleteRoadmap: (id: string) => void;
  setActiveRoadmap: (id: string | null) => void;
  addRoadmapNode: (roadmapId: string, node: Omit<RoadmapNode, 'id'>) => RoadmapNode;
  updateRoadmapNode: (roadmapId: string, nodeId: string, patch: Partial<RoadmapNode>) => void;
  removeRoadmapNode: (roadmapId: string, nodeId: string) => void;
  addRoadmapEdge: (roadmapId: string, from: string, to: string, label?: string) => void;
  updateRoadmapEdge: (roadmapId: string, edgeId: string, patch: Partial<RoadmapEdge>) => void;
  removeRoadmapEdge: (roadmapId: string, edgeId: string) => void;

  setPlannerMode: (m: 'day' | 'week') => void;
  setPlannerDate: (d: string) => void;
  navigatePlanner: (deltaDays: number) => void;
  setLibraryFilter: (f: 'all' | 'reading' | 'unread' | 'deadline' | 'archived') => void;

  /* v5: library folders + search */
  addLibraryFolder: (name: string, parentId?: string | null) => LibraryFolder;
  renameLibraryFolder: (id: string, name: string) => void;
  setLibraryFolderColor: (id: string, color: string) => void;
  setLibraryFolderIcon: (id: string, icon: string) => void;
  deleteLibraryFolder: (id: string) => void; // cascade: subfolders flattened, files unfiled
  moveLibraryFolder: (id: string, parentId: string | null) => void; // cycle-safe
  moveFileToFolder: (fileId: string, folderId: string | null) => void;
  setLibraryFolderFilter: (f: string) => void;
  setLibrarySearch: (q: string) => void;

  /* v5: reader — favorites + annotation mirror + prefs */
  toggleFileFavoritePage: (fileId: string, page: number) => void;
  setFileAnnoPages: (fileId: string, pages: string[]) => void;
  updateReaderPrefs: (patch: Partial<ReaderPrefs>) => void;

  /* v6: focus — custom backgrounds + clock config + auto color */
  addFocusCustomBg: (label: string, dataUrl: string, accent: string) => FocusCustomBg;
  removeFocusCustomBg: (id: string) => void;
  setFocusClockCfg: (patch: Partial<FocusClockCfg>) => void;
  resetFocusClockCfg: () => void;
  setFocusAutoColor: (v: boolean) => void;

  /* v6: general */
  toggleSidebarCollapsed: () => void;

  /* v5: roadmap utilities */
  duplicateRoadmap: (id: string) => Roadmap | null;

  startTimer: (labelIds: string[], note: string, itemIds?: string[]) => void;
  startItemFocus: (itemId: string) => boolean;
  startFileFocus: (fileId: string) => boolean;
  startPomodoro: (itemIds?: string[]) => void;
  pausePomodoro: () => void;
  resumePomodoro: () => void;
  advancePomodoro: () => void;
  stopTimer: () => void;

  setFocusOpen: (v: boolean) => void;
  setFocusClockType: (c: ClockType) => void;
  setFocusBackground: (b: string) => void;
  setFocusPreset: (p: string) => void;
  setFocusCustom: (work: number, brk: number) => void;
  toggleFocusCompact: () => void;

  snapshot: () => void;
  undo: () => boolean;
  redo: () => boolean;

  importData: (raw: unknown) => string | null;
  exportData: () => string;
  getFocusTiming: () => FocusTiming;
}

/* ---------- helpers used by store ---------- */

function coreSnapshot(s: WBState): string {
  return JSON.stringify({
    items: s.items,
    labels: s.labels,
    entries: s.entries,
    habits: s.habits,
    journal: s.journal,
    activeTimer: s.activeTimer,
    files: s.files,
    readingSessions: s.readingSessions,
    filePlans: s.filePlans,
    roadmaps: s.roadmaps,
  });
}

function deleteCascade(
  items: Item[],
  labels: Label[],
  expanded: Record<string, boolean>,
  id: string
): Item[] {
  const desc = (iid: string): string[] => {
    const out: string[] = [];
    items.filter((i) => i.parentId === iid).forEach((c) => {
      out.push(c.id);
      out.push(...desc(c.id));
    });
    return out;
  };
  const ids = [id, ...desc(id)];
  labels.forEach((l) => {
    l.itemIds = l.itemIds.filter((x) => !ids.includes(x));
  });
  ids.forEach((i) => delete expanded[i]);
  return items.filter((i) => !ids.includes(i.id));
}

/* ==================== store ==================== */

export const useWB = create<WBState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      items: [],
      labels: [],
      entries: [],
      habits: [],
      journal: [],
      activeTimer: null,
      expanded: {},
      files: [],
      readingSessions: [],
      filePlans: [],
      roadmaps: [],
      activeRoadmapId: null,
      libraryFolders: [],
      libraryFolderFilter: 'all',
      librarySearch: '',
      readerPrefs: { ...DEFAULT_READER_PREFS },
      focusCustomBgs: [],
      focusClockCfg: { size: 100, xPct: 50, yPct: 46, accent: 'auto' },
      focusAutoColor: true,
      sidebarCollapsed: false,
      reportCustom: { from: todayStr(), to: todayStr() },

      theme: 'light',
      view: 'today',
      graphView: 'tree',
      reportRange: 'week',
      calendarSystem: 'gregorian',
      calMonthOffset: 0,
      calendarSelectedDate: todayStr(),
      plannerMode: 'day',
      plannerDate: todayStr(),
      libraryFilter: 'all',
      focusOpen: false,
      focusClockType: 'aura',
      focusBackground: 'aurora',
      focusPreset: '25',
      focusCustomWork: 45,
      focusCustomBreak: 10,
      focusCompact: false,
      dailyCapacityMin: 240,
      stats: { focusSessions: 0, focusMinutes: 0, readingMinutes: 0, pagesRead: 0 },
      lastSavedAt: null,
      undoStack: [],
      redoStack: [],

      setHydrated: (v) => set({ hydrated: v }),
      setView: (v) => set({ view: v }),
      setTheme: (t) => set({ theme: t }),
      cycleTheme: () => {
        const order: ThemeId[] = ['light', 'dark', 'prism'];
        const cur = get().theme;
        set({ theme: order[(order.indexOf(cur) + 1) % order.length] });
      },
      setGraphView: (g) => set({ graphView: g }),
      setReportRange: (r) => set({ reportRange: r }),
      setReportCustom: (patch) => set((s) => ({ reportCustom: { ...s.reportCustom, ...patch } })),
      setCalendarSystem: (c) => set({ calendarSystem: c, calMonthOffset: 0 }),
      calNavigate: (delta) => set((s) => ({ calMonthOffset: s.calMonthOffset + delta })),
      calToday: () => set({ calMonthOffset: 0, calendarSelectedDate: todayStr() }),
      selectCalendarDay: (iso) => set({ calendarSelectedDate: iso }),
      setDailyCapacity: (m) => set({ dailyCapacityMin: m }),

      toggleExpanded: (id) =>
        set((s) => ({ expanded: { ...s.expanded, [id]: !(s.expanded[id] !== false) } })),

      addItem: (partial) => {
        const item = makeItem(partial);
        set((s) => ({ items: [...s.items, item] }));
        return item;
      },
      updateItem: (id, patch, opts) => {
        if (opts?.snapshot) get().snapshot();
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i
          ),
        }));
      },
      setItemStatus: (id, status) => {
        set((s) => ({
          items: s.items.map((i) => {
            if (i.id !== id) return i;
            const completedAt =
              status === 'done' ? i.completedAt || new Date().toISOString() : null;
            return { ...i, status, completedAt, updatedAt: new Date().toISOString() };
          }),
        }));
      },
      moveItem: (id, status) => {
        get().snapshot();
        get().setItemStatus(id, status);
      },
      deleteItemCascade: (id) => {
        get().snapshot();
        set((s) => {
          const labels = s.labels.map((l) => ({ ...l, itemIds: [...l.itemIds] }));
          const expanded = { ...s.expanded };
          const items = deleteCascade(s.items, labels, expanded, id);
          return { items, labels, expanded };
        });
      },

      addLabel: (name) =>
        set((s) => ({
          labels: [...s.labels, { id: uid(), name, color: SWATCHES[s.labels.length % SWATCHES.length], itemIds: [] }],
        })),
      renameLabel: (id, name) =>
        set((s) => ({ labels: s.labels.map((l) => (l.id === id ? { ...l, name } : l)) })),
      deleteLabel: (id) => {
        get().snapshot();
        set((s) => ({
          labels: s.labels.filter((l) => l.id !== id),
          entries: s.entries.map((e) => ({ ...e, labelIds: e.labelIds.filter((x) => x !== id) })),
        }));
      },
      toggleItemLabel: (itemId, labelId) =>
        set((s) => ({
          labels: s.labels.map((l) =>
            l.id === labelId
              ? {
                  ...l,
                  itemIds: l.itemIds.includes(itemId)
                    ? l.itemIds.filter((x) => x !== itemId)
                    : [...l.itemIds, itemId],
                }
              : l
          ),
        })),

      addEntry: (partial) => set((s) => ({ entries: [...s.entries, makeEntry(partial)] })),
      deleteEntry: (id) => {
        get().snapshot();
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
      },

      addHabit: (partial) =>
        set((s) => ({
          habits: [
            ...s.habits,
            {
              id: uid(),
              name: 'New habit',
              description: '',
              color: SWATCHES[s.habits.length % SWATCHES.length],
              cadence: 'daily',
              log: {},
              createdAt: new Date().toISOString(),
              ...partial,
            },
          ],
        })),
      updateHabit: (id, patch) =>
        set((s) => ({ habits: s.habits.map((h) => (h.id === id ? { ...h, ...patch } : h)) })),
      deleteHabit: (id) => {
        get().snapshot();
        set((s) => ({ habits: s.habits.filter((h) => h.id !== id) }));
      },
      toggleHabitDay: (id, date) =>
        set((s) => ({
          habits: s.habits.map((h) => (h.id === id ? { ...h, log: { ...h.log, [date]: !h.log[date] } } : h)),
        })),

      saveJournal: (date, content) =>
        set((s) => {
          const existing = s.journal.find((j) => j.date === date);
          if (existing) {
            return {
              journal: s.journal.map((j) =>
                j.date === date ? { ...j, content, updatedAt: new Date().toISOString() } : j
              ),
            };
          }
          return {
            journal: [
              ...s.journal,
              { id: uid(), date, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
            ],
          };
        }),

      /* ---------- v4: library files ---------- */
      addFile: (partial) => {
        const file = makeFile(partial);
        set((s) => ({ files: [...s.files, file] }));
        return file;
      },
      updateFile: (id, patch) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),
      deleteFile: (id) => {
        get().snapshot();
        set((s) => ({
          files: s.files.filter((f) => f.id !== id),
          readingSessions: s.readingSessions.filter((r) => r.fileId !== id),
          filePlans: s.filePlans.filter((p) => p.fileId !== id),
          items: s.items.map((i) => ({ ...i, fileIds: (i.fileIds || []).filter((x) => x !== id) })),
          roadmaps: s.roadmaps.map((r) => ({
            ...r,
            nodes: r.nodes.filter((n) => !(n.kind === 'file' && n.refId === id)),
            edges: (() => {
              const removed = r.nodes.filter((n) => n.kind === 'file' && n.refId === id).map((n) => n.id);
              return r.edges.filter((e) => !removed.includes(e.from) && !removed.includes(e.to));
            })(),
          })),
        }));
      },
      setFilePosition: (id, page) =>
        set((s) => ({
          files: s.files.map((f) =>
            f.id === id
              ? { ...f, currentPage: Math.max(1, Math.min(f.pageCount, page)), lastReadAt: new Date().toISOString() }
              : f
          ),
        })),
      addFilePageSeconds: (id, page, seconds) =>
        set((s) => ({
          files: s.files.map((f) => {
            if (f.id !== id) return f;
            const key = String(page);
            const pageSeconds = { ...f.pageSeconds, [key]: (f.pageSeconds[key] || 0) + seconds };
            return { ...f, pageSeconds, lastReadAt: new Date().toISOString() };
          }),
        })),
      markFilePage: (id, page, read) =>
        set((s) => ({
          files: s.files.map((f) => {
            if (f.id !== id) return f;
            const key = String(page);
            const readPages = read
              ? Array.from(new Set([...f.readPages, key]))
              : f.readPages.filter((p) => p !== key);
            return { ...f, readPages };
          }),
        })),
      logReadingSession: (session) => {
        if (session.minutes < 1) return; // ignore <1s noise
        set((s) => ({
          readingSessions: [...s.readingSessions, { ...session, id: uid() }].slice(-MAX_READING_SESSIONS),
          stats: {
            ...s.stats,
            readingMinutes: s.stats.readingMinutes + session.minutes,
            pagesRead: s.stats.pagesRead + session.pagesRead,
          },
        }));
      },
      toggleItemFile: (itemId, fileId) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  fileIds: (i.fileIds || []).includes(fileId)
                    ? (i.fileIds || []).filter((x) => x !== fileId)
                    : [...(i.fileIds || []), fileId],
                  updatedAt: new Date().toISOString(),
                }
              : i
          ),
        })),

      /* ---------- v4: file plan blocks ---------- */
      addFilePlan: (fileId, date, startMin, minutes) => {
        const plan: FilePlanBlock = { id: uid(), fileId, date, startMin, minutes, done: false };
        set((s) => ({ filePlans: [...s.filePlans, plan] }));
        return plan;
      },
      updateFilePlan: (id, patch) =>
        set((s) => ({ filePlans: s.filePlans.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deleteFilePlan: (id) => {
        get().snapshot();
        set((s) => ({ filePlans: s.filePlans.filter((p) => p.id !== id) }));
      },

      /* ---------- v4: roadmaps ---------- */
      createRoadmap: (title) => {
        const rm = makeRoadmap({ title });
        set((s) => ({ roadmaps: [...s.roadmaps, rm], activeRoadmapId: rm.id }));
        return rm;
      },
      updateRoadmap: (id, patch) =>
        set((s) => ({
          roadmaps: s.roadmaps.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
          ),
        })),
      deleteRoadmap: (id) => {
        get().snapshot();
        set((s) => ({
          roadmaps: s.roadmaps.filter((r) => r.id !== id),
          activeRoadmapId: s.activeRoadmapId === id ? null : s.activeRoadmapId,
        }));
      },
      duplicateRoadmap: (id) => {
        const src = get().roadmaps.find((r) => r.id === id);
        if (!src) return null;
        get().snapshot();
        const now = new Date().toISOString();
        const idMap = new Map<string, string>();
        src.nodes.forEach((n) => idMap.set(n.id, uid()));
        const copy: Roadmap = {
          id: uid(),
          title: `${src.title} (copy)`,
          description: src.description,
          nodes: src.nodes.map((n) => ({ ...n, id: idMap.get(n.id) || uid() })),
          edges: src.edges.map((e) => ({
            ...e,
            id: uid(),
            from: idMap.get(e.from) || e.from,
            to: idMap.get(e.to) || e.to,
          })),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ roadmaps: [...s.roadmaps, copy] }));
        return copy;
      },
      setActiveRoadmap: (id) => set({ activeRoadmapId: id }),
      addRoadmapNode: (roadmapId, node) => {
        const full: RoadmapNode = { ...node, id: uid() };
        set((s) => ({
          roadmaps: s.roadmaps.map((r) =>
            r.id === roadmapId ? { ...r, nodes: [...r.nodes, full], updatedAt: new Date().toISOString() } : r
          ),
        }));
        return full;
      },
      updateRoadmapNode: (roadmapId, nodeId, patch) =>
        set((s) => ({
          roadmaps: s.roadmaps.map((r) =>
            r.id === roadmapId
              ? {
                  ...r,
                  nodes: r.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
                  updatedAt: new Date().toISOString(),
                }
              : r
          ),
        })),
      removeRoadmapNode: (roadmapId, nodeId) =>
        set((s) => ({
          roadmaps: s.roadmaps.map((r) =>
            r.id === roadmapId
              ? {
                  ...r,
                  nodes: r.nodes.filter((n) => n.id !== nodeId),
                  edges: r.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
                  updatedAt: new Date().toISOString(),
                }
              : r
          ),
        })),
      addRoadmapEdge: (roadmapId, from, to, label = '') => {
        set((s) => {
          const rm = s.roadmaps.find((r) => r.id === roadmapId);
          if (!rm) return {};
          if (from === to) return {};
          if (rm.edges.some((e) => e.from === from && e.to === to)) return {};
          return {
            roadmaps: s.roadmaps.map((r) =>
              r.id === roadmapId
                ? { ...r, edges: [...r.edges, { id: uid(), from, to, label }], updatedAt: new Date().toISOString() }
                : r
            ),
          };
        });
      },
      updateRoadmapEdge: (roadmapId, edgeId, patch) =>
        set((s) => ({
          roadmaps: s.roadmaps.map((r) =>
            r.id === roadmapId
              ? { ...r, edges: r.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)), updatedAt: new Date().toISOString() }
              : r
          ),
        })),
      removeRoadmapEdge: (roadmapId, edgeId) =>
        set((s) => ({
          roadmaps: s.roadmaps.map((r) =>
            r.id === roadmapId
              ? { ...r, edges: r.edges.filter((e) => e.id !== edgeId), updatedAt: new Date().toISOString() }
              : r
          ),
        })),

      setPlannerMode: (m) => set({ plannerMode: m }),
      setPlannerDate: (d) => set({ plannerDate: d }),
      navigatePlanner: (deltaDays) =>
        set((s) => {
          const d = new Date(s.plannerDate + 'T12:00:00');
          d.setDate(d.getDate() + deltaDays);
          return { plannerDate: isoDate(d) };
        }),
      setLibraryFilter: (f) => set({ libraryFilter: f }),

      /* ---------- v5: library folders + search ---------- */
      setLibraryFolderFilter: (f) => set({ libraryFolderFilter: f }),
      setLibrarySearch: (q) => set({ librarySearch: q }),
      addLibraryFolder: (name, parentId = null) => {
        const folder: LibraryFolder = {
          id: uid(),
          name: name.trim() || 'New folder',
          color: FOLDER_SWATCHES[Math.floor(Math.random() * FOLDER_SWATCHES.length)],
          icon: FOLDER_ICONS[Math.floor(Math.random() * Math.min(4, FOLDER_ICONS.length))],
          parentId,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ libraryFolders: [...s.libraryFolders, folder] }));
        return folder;
      },
      renameLibraryFolder: (id, name) =>
        set((s) => ({
          libraryFolders: s.libraryFolders.map((f) =>
            f.id === id ? { ...f, name: name.trim() || f.name } : f
          ),
        })),
      setLibraryFolderColor: (id, color) =>
        set((s) => ({
          libraryFolders: s.libraryFolders.map((f) => (f.id === id ? { ...f, color } : f)),
        })),
      setLibraryFolderIcon: (id, icon) =>
        set((s) => ({
          libraryFolders: s.libraryFolders.map((f) => (f.id === id ? { ...f, icon } : f)),
        })),
      deleteLibraryFolder: (id) => {
        /* cascade: descendants are flattened to the deleted folder's parent,
           files inside (direct or nested) move up to that parent */
        set((s) => {
          const target = s.libraryFolders.find((f) => f.id === id);
          const newParent = target?.parentId ?? null;
          const descendants = new Set<string>([id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const f of s.libraryFolders) {
              if (f.parentId && descendants.has(f.parentId) && !descendants.has(f.id)) {
                descendants.add(f.id);
                grew = true;
              }
            }
          }
          return {
            libraryFolders: s.libraryFolders
              .filter((f) => f.id !== id)
              .map((f) => {
                if (descendants.has(f.id)) return { ...f, parentId: newParent };
                if (f.parentId === id) return { ...f, parentId: newParent };
                return f;
              }),
            files: s.files.map((f) => {
              if (descendants.has(f.folderId || '')) return { ...f, folderId: newParent };
              return f;
            }),
            libraryFolderFilter:
              s.libraryFolderFilter === id || descendants.has(s.libraryFolderFilter)
                ? 'all'
                : s.libraryFolderFilter,
          };
        });
      },
      moveLibraryFolder: (id, parentId) => {
        set((s) => {
          if (id === parentId) return {};
          /* reject cycles: parentId must not be a descendant of id */
          if (parentId) {
            const descendants = new Set<string>([id]);
            let grew = true;
            while (grew) {
              grew = false;
              for (const f of s.libraryFolders) {
                if (f.parentId && descendants.has(f.parentId) && !descendants.has(f.id)) {
                  descendants.add(f.id);
                  grew = true;
                }
              }
            }
            if (descendants.has(parentId)) return {};
          }
          return {
            libraryFolders: s.libraryFolders.map((f) => (f.id === id ? { ...f, parentId } : f)),
          };
        });
      },

      moveFileToFolder: (fileId, folderId) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === fileId ? { ...f, folderId } : f)),
        })),

      /* ---------- v5: reader — favorites, annotation mirror, prefs ---------- */
      toggleFileFavoritePage: (fileId, page) =>
        set((s) => ({
          files: s.files.map((f) => {
            if (f.id !== fileId) return f;
            const key = String(page);
            const favoritePages = (f.favoritePages || []).includes(key)
              ? (f.favoritePages || []).filter((p) => p !== key)
              : [...(f.favoritePages || []), key];
            return { ...f, favoritePages };
          }),
        })),
      setFileAnnoPages: (fileId, pages) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === fileId ? { ...f, annoPages: pages } : f)),
        })),
      updateReaderPrefs: (patch) =>
        set((s) => ({ readerPrefs: { ...s.readerPrefs, ...patch } })),

      startTimer: (labelIds, note, itemIds = []) => {
        get().snapshot();
        set({
          activeTimer: { startedAt: new Date().toISOString(), labelIds, itemIds, fileId: null, note, pomodoro: null },
        });
      },
      startItemFocus: (itemId) => {
        const s = get();
        const item = s.items.find((i) => i.id === itemId);
        if (!item) return false;
        const blocked = (item.dependsOn || [])
          .map((d) => s.items.find((x) => x.id === d))
          .some((d) => d && d.status !== 'done' && d.status !== 'archived');
        if (blocked) return false;
        if (s.activeTimer) return false;
        const labelIds = s.labels.filter((l) => l.itemIds.includes(itemId)).map((l) => l.id);
        const preset = FOCUS_PRESETS.find((p) => p.id === s.focusPreset) || FOCUS_PRESETS[0];
        const workMin = s.focusPreset === 'custom' ? s.focusCustomWork : preset.workMin;
        const breakMin = s.focusPreset === 'custom' ? s.focusCustomBreak : preset.breakMin;
        set({
          activeTimer: {
            startedAt: new Date().toISOString(),
            labelIds,
            itemIds: [itemId],
            fileId: null,
            note: item.title,
            pomodoro: { workMin, breakMin, phase: 'work', cycle: 0, pausedAt: null },
          },
        });
        if (['todo', 'inbox', 'waiting'].includes(item.status)) get().setItemStatus(itemId, 'in_progress');
        return true;
      },
      startFileFocus: (fileId) => {
        const s = get();
        if (s.activeTimer) return false;
        const file = s.files.find((f) => f.id === fileId);
        if (!file) return false;
        const preset = FOCUS_PRESETS.find((p) => p.id === s.focusPreset) || FOCUS_PRESETS[0];
        const workMin = s.focusPreset === 'custom' ? s.focusCustomWork : preset.workMin;
        const breakMin = s.focusPreset === 'custom' ? s.focusCustomBreak : preset.breakMin;
        set({
          activeTimer: {
            startedAt: new Date().toISOString(),
            labelIds: [],
            itemIds: [],
            fileId,
            note: `Reading · ${file.title}`,
            pomodoro: { workMin, breakMin, phase: 'work', cycle: 0, pausedAt: null },
          },
        });
        return true;
      },
      startPomodoro: (itemIds = []) => {
        const s = get();
        const preset = FOCUS_PRESETS.find((p) => p.id === s.focusPreset) || FOCUS_PRESETS[0];
        const workMin = s.focusPreset === 'custom' ? s.focusCustomWork : preset.workMin;
        const breakMin = s.focusPreset === 'custom' ? s.focusCustomBreak : preset.breakMin;
        set({
          activeTimer: {
            startedAt: new Date().toISOString(),
            labelIds: [],
            itemIds,
            fileId: null,
            note: '',
            pomodoro: { workMin, breakMin, phase: 'work', cycle: 0, pausedAt: null },
          },
        });
      },
      pausePomodoro: () =>
        set((s) => {
          if (!s.activeTimer?.pomodoro || s.activeTimer.pomodoro.pausedAt) return {};
          return {
            activeTimer: {
              ...s.activeTimer,
              pomodoro: { ...s.activeTimer.pomodoro, pausedAt: new Date().toISOString() },
            },
          };
        }),
      resumePomodoro: () =>
        set((s) => {
          const t = s.activeTimer;
          if (!t?.pomodoro?.pausedAt) return {};
          const pauseMs = Date.now() - new Date(t.pomodoro.pausedAt).getTime();
          return {
            activeTimer: {
              ...t,
              startedAt: new Date(new Date(t.startedAt).getTime() + pauseMs).toISOString(),
              pomodoro: { ...t.pomodoro, pausedAt: null },
            },
          };
        }),
      advancePomodoro: () => {
        const s = get();
        const t = s.activeTimer;
        if (!t?.pomodoro) return;
        const start = new Date(t.startedAt);
        const end = new Date();
        const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
        const wasWork = t.pomodoro.phase === 'work';
        const entry = makeEntry({
          date: isoDate(start),
          startTime: hhmm(start),
          endTime: hhmm(end),
          durationMin,
          labelIds: [...t.labelIds],
          itemIds: [...t.itemIds],
          note: `${t.note} (${wasWork ? 'focus' : 'break'} ${t.pomodoro.cycle})`.trim(),
        });
        set({
          entries: [...s.entries, entry],
          activeTimer: {
            ...t,
            startedAt: new Date().toISOString(),
            pomodoro: {
              ...t.pomodoro,
              phase: wasWork ? 'break' : 'work',
              cycle: wasWork ? t.pomodoro.cycle + 1 : t.pomodoro.cycle,
              pausedAt: null,
            },
          },
          stats: wasWork
            ? {
                ...s.stats,
                focusSessions: s.stats.focusSessions + 1,
                focusMinutes: s.stats.focusMinutes + durationMin,
              }
            : s.stats,
        });
      },
      stopTimer: () => {
        const s = get();
        const t = s.activeTimer;
        if (!t) return;
        const start = new Date(t.startedAt);
        const end = new Date();
        const durationMin = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
        const entry = makeEntry({
          date: isoDate(start),
          startTime: hhmm(start),
          endTime: hhmm(end),
          durationMin,
          labelIds: [...t.labelIds],
          itemIds: [...t.itemIds],
          note: t.note,
        });
        set({ entries: [...s.entries, entry], activeTimer: null });
      },

      setFocusOpen: (v) => set({ focusOpen: v }),
      setFocusClockType: (c) => set({ focusClockType: c }),
      setFocusBackground: (b) => set({ focusBackground: b }),
      setFocusPreset: (p) => set({ focusPreset: p }),
      setFocusCustom: (work, brk) => set({ focusCustomWork: work, focusCustomBreak: brk }),
      toggleFocusCompact: () => set((s) => ({ focusCompact: !s.focusCompact })),

      /* ---------- v6: focus — custom backgrounds + flexible clock + auto color ---------- */
      addFocusCustomBg: (label, dataUrl, accent) => {
        const bg: FocusCustomBg = { id: uid(), label: label.trim() || 'My background', dataUrl, accent };
        set((s) => ({
          focusCustomBgs: [...s.focusCustomBgs.slice(-2), bg], // keep at most 3
          focusBackground: `custom:${bg.id}`,
        }));
        return bg;
      },
      removeFocusCustomBg: (id) =>
        set((s) => ({
          focusCustomBgs: s.focusCustomBgs.filter((b) => b.id !== id),
          focusBackground: s.focusBackground === `custom:${id}` ? 'aurora' : s.focusBackground,
        })),
      setFocusClockCfg: (patch) => set((s) => ({ focusClockCfg: { ...s.focusClockCfg, ...patch } })),
      resetFocusClockCfg: () =>
        set({ focusClockCfg: { size: 100, xPct: 50, yPct: 46, accent: 'auto' } }),
      setFocusAutoColor: (v) => set({ focusAutoColor: v }),

      /* ---------- v6: general ---------- */
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      snapshot: () =>
        set((s) => ({
          undoStack: [...s.undoStack.slice(-(MAX_HIST - 1)), coreSnapshot(s)],
          redoStack: [],
        })),
      undo: () => {
        const s = get();
        if (!s.undoStack.length) return false;
        const prev = JSON.parse(s.undoStack[s.undoStack.length - 1]);
        set({
          undoStack: s.undoStack.slice(0, -1),
          redoStack: [...s.redoStack, coreSnapshot(s)],
          items: prev.items ?? s.items,
          labels: prev.labels ?? s.labels,
          entries: prev.entries ?? s.entries,
          habits: prev.habits ?? s.habits,
          journal: prev.journal ?? s.journal,
          activeTimer: prev.activeTimer ?? null,
          files: prev.files ?? s.files,
          readingSessions: prev.readingSessions ?? s.readingSessions,
          filePlans: prev.filePlans ?? s.filePlans,
          roadmaps: prev.roadmaps ?? s.roadmaps,
        });
        return true;
      },
      redo: () => {
        const s = get();
        if (!s.redoStack.length) return false;
        const next = JSON.parse(s.redoStack[s.redoStack.length - 1]);
        set({
          redoStack: s.redoStack.slice(0, -1),
          undoStack: [...s.undoStack, coreSnapshot(s)],
          items: next.items ?? s.items,
          labels: next.labels ?? s.labels,
          entries: next.entries ?? s.entries,
          habits: next.habits ?? s.habits,
          journal: next.journal ?? s.journal,
          activeTimer: next.activeTimer ?? null,
          files: next.files ?? s.files,
          readingSessions: next.readingSessions ?? s.readingSessions,
          filePlans: next.filePlans ?? s.filePlans,
          roadmaps: next.roadmaps ?? s.roadmaps,
        });
        return true;
      },

      importData: (raw) => {
        try {
          const data = raw as Record<string, unknown>;
          if (!data || !Array.isArray(data.items)) return 'Invalid backup: no items array';
          const items = (data.items as Partial<Item>[]).map((i) => makeItem(i));
          const labels = ((data.labels as Partial<Label>[]) || []).map((l) => ({
            id: uid(),
            name: 'Label',
            color: SWATCHES[0],
            itemIds: [] as string[],
            ...l,
          }));
          const entries = ((data.entries as Partial<Entry>[]) || []).map((e) => makeEntry(e));
          const habits = ((data.habits as Partial<Habit>[]) || []).map((h) => ({
            id: uid(),
            name: 'Habit',
            description: '',
            color: SWATCHES[0],
            cadence: 'daily' as const,
            log: {},
            createdAt: new Date().toISOString(),
            ...h,
          }));
          const journal = ((data.journal as Partial<JournalEntry>[]) || []).map((j) => ({
            id: uid(),
            date: todayStr(),
            content: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            ...j,
          }));
          const files = ((data.files as Partial<ResourceFile>[]) || []).map((f) => makeFile(f));
          const readingSessions = ((data.readingSessions as Partial<ReadingSession>[]) || []).map((r) => ({
            id: uid(),
            fileId: '',
            date: todayStr(),
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            minutes: 0,
            pagesVisited: 0,
            pagesRead: 0,
            startPage: 1,
            endPage: 1,
            ...r,
          }));
          const filePlans = ((data.filePlans as Partial<FilePlanBlock>[]) || []).map((p) => ({
            id: uid(),
            fileId: '',
            date: todayStr(),
            startMin: 540,
            minutes: 30,
            done: false,
            ...p,
          }));
          const roadmaps = ((data.roadmaps as Partial<Roadmap>[]) || []).map((r) => makeRoadmap(r));
          get().snapshot();
          set({ items, labels, entries, habits, journal, files, readingSessions, filePlans, roadmaps });
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : 'Import failed';
        }
      },
      exportData: () => {
        const s = get();
        return JSON.stringify(
          {
            app: 'workbench-aurora',
            schemaVersion: 4,
            exportedAt: new Date().toISOString(),
            items: s.items,
            labels: s.labels,
            entries: s.entries,
            habits: s.habits,
            journal: s.journal,
            stats: s.stats,
            files: s.files,
            readingSessions: s.readingSessions,
            filePlans: s.filePlans,
            roadmaps: s.roadmaps,
          },
          null,
          2
        );
      },
      getFocusTiming: () => getFocusTiming(get().activeTimer, Date.now()),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 5,
      migrate: (persisted: unknown) => {
        const p = (persisted || {}) as Record<string, unknown>;
        const items = Array.isArray(p.items)
          ? (p.items as Partial<Item>[]).map((i) => makeItem(i))
          : [];
        const stats = (p.stats as WBState['stats']) || { focusSessions: 0, focusMinutes: 0, readingMinutes: 0, pagesRead: 0 };
        if (typeof stats.readingMinutes !== 'number') stats.readingMinutes = 0;
        if (typeof stats.pagesRead !== 'number') stats.pagesRead = 0;
        const prefsRaw = (p.readerPrefs || {}) as Partial<ReaderPrefs>;
        /* v6 clock ids — legacy clocks replaced by the new set */
        const legacyClock = p.focusClockType as string | undefined;
        const clockType: ClockType =
          legacyClock === 'analog' || legacyClock === 'digital' || legacyClock === 'minimal' || legacyClock === 'flip'
            ? 'aura'
            : ((legacyClock as ClockType) || 'aura');
        return {
          ...p,
          focusClockType: clockType,
          items,
          files: Array.isArray(p.files) ? (p.files as Partial<ResourceFile>[]).map((f) => makeFile(f)) : [],
          readingSessions: Array.isArray(p.readingSessions) ? p.readingSessions : [],
          filePlans: Array.isArray(p.filePlans) ? p.filePlans : [],
          roadmaps: Array.isArray(p.roadmaps) ? (p.roadmaps as Partial<Roadmap>[]).map((r) => makeRoadmap(r)) : [],
          activeRoadmapId: (p.activeRoadmapId as string | null) ?? null,
          plannerMode: (p.plannerMode as 'day' | 'week') ?? 'day',
          plannerDate: (p.plannerDate as string) ?? todayStr(),
          libraryFilter: (p.libraryFilter as WBState['libraryFilter']) ?? 'all',
          libraryFolders: Array.isArray(p.libraryFolders)
            ? (p.libraryFolders as Partial<LibraryFolder>[]).map((f) => ({
                id: f.id || uid(),
                name: f.name || 'Folder',
                color: f.color || FOLDER_SWATCHES[0],
                icon: (f.icon as string) || 'folder',
                parentId: (f.parentId as string | null) ?? null,
                createdAt: f.createdAt || new Date().toISOString(),
              }))
            : [],
          libraryFolderFilter: (p.libraryFolderFilter as string) || 'all',
          librarySearch: (p.librarySearch as string) || '',
          readerPrefs: {
            ...DEFAULT_READER_PREFS,
            ...prefsRaw,
            custom: { ...DEFAULT_READER_PREFS.custom, ...(prefsRaw.custom || {}) },
          },
          focusCustomBgs: Array.isArray(p.focusCustomBgs) ? (p.focusCustomBgs as FocusCustomBg[]) : [],
          focusClockCfg: {
            size: 100, xPct: 50, yPct: 46, accent: 'auto',
            ...((p.focusClockCfg as Partial<FocusClockCfg>) || {}),
          },
          focusAutoColor: (p.focusAutoColor as boolean) ?? true,
          sidebarCollapsed: (p.sidebarCollapsed as boolean) ?? false,
          reportCustom: {
            from: todayStr(),
            to: todayStr(),
            ...((p.reportCustom as Partial<ReportCustomRange>) || {}),
          },
          stats,
        };
      },
      partialize: (s) => ({
        theme: s.theme,
        view: s.view,
        graphView: s.graphView,
        reportRange: s.reportRange,
        calendarSystem: s.calendarSystem,
        calMonthOffset: s.calMonthOffset,
        calendarSelectedDate: s.calendarSelectedDate,
        plannerMode: s.plannerMode,
        plannerDate: s.plannerDate,
        libraryFilter: s.libraryFilter,
        libraryFolders: s.libraryFolders,
        libraryFolderFilter: s.libraryFolderFilter,
        librarySearch: s.librarySearch,
        readerPrefs: s.readerPrefs,
        focusClockType: s.focusClockType,
        focusBackground: s.focusBackground,
        focusPreset: s.focusPreset,
        focusCustomWork: s.focusCustomWork,
        focusCustomBreak: s.focusCustomBreak,
        focusCompact: s.focusCompact,
        focusCustomBgs: s.focusCustomBgs,
        focusClockCfg: s.focusClockCfg,
        focusAutoColor: s.focusAutoColor,
        sidebarCollapsed: s.sidebarCollapsed,
        reportCustom: s.reportCustom,
        dailyCapacityMin: s.dailyCapacityMin,
        stats: s.stats,
        items: s.items,
        labels: s.labels,
        entries: s.entries,
        habits: s.habits,
        journal: s.journal,
        activeTimer: s.activeTimer,
        expanded: s.expanded,
        files: s.files,
        readingSessions: s.readingSessions,
        filePlans: s.filePlans,
        roadmaps: s.roadmaps,
        activeRoadmapId: s.activeRoadmapId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    }
  )
);

/* ---------- standalone data selectors ---------- */

export function wbChildren(items: Item[], id: string): Item[] {
  return items.filter((i) => i.parentId === id);
}
export function wbItem(items: Item[], id: string): Item | undefined {
  return items.find((i) => i.id === id);
}
export function wbRootItems(items: Item[]): Item[] {
  return items.filter((i) => !i.parentId);
}
export function wbDescendantIds(items: Item[], id: string): string[] {
  const out: string[] = [];
  items.filter((i) => i.parentId === id).forEach((c) => {
    out.push(c.id);
    out.push(...wbDescendantIds(items, c.id));
  });
  return out;
}
export function wbIsBlocked(items: Item[], item: Item | undefined): boolean {
  if (!item) return false;
  return (item.dependsOn || []).some((depId) => {
    const d = wbItem(items, depId);
    return !!d && d.status !== 'done' && d.status !== 'archived';
  });
}
export function wbBlockedCount(items: Item[], item: Item): number {
  return (item.dependsOn || []).filter((depId) => {
    const d = wbItem(items, depId);
    return !!d && d.status !== 'done' && d.status !== 'archived';
  }).length;
}
export function wbCanDependOn(items: Item[], itemId: string, candidateId: string): boolean {
  if (!candidateId || candidateId === itemId) return false;
  if (wbDescendantIds(items, itemId).includes(candidateId)) return false;
  if (!wbItem(items, candidateId)) return false;
  // no cycles: candidate must not (transitively) depend on itemId
  const reaches = (startId: string, targetId: string, seen = new Set<string>()): boolean => {
    if (startId === targetId) return true;
    if (seen.has(startId)) return false;
    seen.add(startId);
    const it = wbItem(items, startId);
    return !!it && (it.dependsOn || []).some((d) => reaches(d, targetId, seen));
  };
  return !reaches(candidateId, itemId);
}
export function wbReadyItems(items: Item[]): Item[] {
  return items.filter(
    (i) => !['done', 'archived', 'inbox'].includes(i.status) && !wbIsBlocked(items, i)
  );
}
export function wbPlannedItems(items: Item[], date: string): Item[] {
  return items.filter((i) => i.type === 'task' && i.startDate === date && i.status !== 'done' && i.status !== 'archived');
}
export function wbPlannedMinutes(items: Item[], date: string): number {
  return wbPlannedItems(items, date).reduce((s, i) => s + (Number(i.estimateMin) || 30), 0);
}
export function wbTimeboxedItems(items: Item[], date: string): Item[] {
  return items
    .filter((i) => i.plannedStart && i.plannedStart.slice(0, 10) === date && i.status !== 'archived')
    .sort((a, b) => (a.plannedStart || '').localeCompare(b.plannedStart || ''));
}
export function wbPriorityWeight(p: string): number {
  return ({ p0: 0, p1: 1, p2: 2, p3: 3 } as Record<string, number>)[p] ?? 2;
}
export function wbPickNextAction(items: Item[]): Item | null {
  const today = todayStr();
  const pool = wbPlannedItems(items, today).filter((i) => !wbIsBlocked(items, i));
  const source = pool.length ? pool : wbReadyItems(items).filter((i) => i.type === 'task');
  return (
    source
      .filter((i) => i.type !== 'goal' || wbChildren(items, i.id).length === 0)
      .sort((a, b) => {
        const p = wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority);
        if (p) return p;
        const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        if (ad !== bd) return ad - bd;
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      })[0] || null
  );
}
export function wbInsights(items: Item[], entries: Entry[], capacity: number): string[] {
  const today = todayStr();
  const a: string[] = [];
  const overdue = items.filter(
    (i) => i.deadline && i.status !== 'done' && i.status !== 'archived' && i.deadline < today
  ).length;
  const blocked = items.filter((i) => wbIsBlocked(items, i)).length;
  const planned = wbPlannedMinutes(items, today);
  const logged = entriesInRange(entries, today, today).reduce((s, e) => s + e.durationMin, 0);
  if (overdue) a.push(`${overdue} item${overdue === 1 ? ' is' : 's are'} overdue — pull the most important one into your next focus block.`);
  if (blocked) a.push(`${blocked} item${blocked === 1 ? ' is' : 's are'} blocked by dependencies. Resolve them before adding more work.`);
  if (planned > capacity) a.push(`Today is over capacity by ${planned - capacity} minutes. Trim the plan before starting another block.`);
  if (logged >= 240) a.push(`${Math.round(logged / 60)}h logged today — protect your recovery time.`);
  if (!a.length) a.push('The system is stable. Protect your next action and keep capacity realistic.');
  return a;
}

/* ---------- v4: file selectors ---------- */

export const PAGE_READ_THRESHOLD_SEC = 15;

export function wbFileReadPages(file: ResourceFile): number {
  let count = 0;
  for (let p = 1; p <= file.pageCount; p++) {
    const key = String(p);
    if (file.readPages.includes(key) || (file.pageSeconds[key] || 0) >= PAGE_READ_THRESHOLD_SEC) count++;
  }
  return count;
}

export function wbFileProgress(file: ResourceFile): number {
  if (!file.pageCount) return 0;
  return Math.round((wbFileReadPages(file) / file.pageCount) * 100);
}

export function wbFileSeconds(file: ResourceFile): number {
  return Object.values(file.pageSeconds || {}).reduce((s, v) => s + v, 0);
}

export function wbFileMinutes(file: ResourceFile): number {
  return Math.round(wbFileSeconds(file) / 60);
}

export function wbFileAvgSecPerPage(file: ResourceFile): number {
  const visited = Object.values(file.pageSeconds || {}).filter((v) => v > 0).length;
  return visited ? Math.round(wbFileSeconds(file) / visited) : 0;
}

export type FileDeadlineStatus = 'over' | 'soon' | 'ok' | null;

export function wbFileDeadlineStatus(file: ResourceFile): FileDeadlineStatus {
  if (!file.deadline) return null;
  const pct = wbFileProgress(file);
  if (pct >= 100) return 'ok';
  const du = Math.round(
    (new Date(file.deadline + 'T12:00:00').getTime() - new Date(todayStr() + 'T12:00:00').getTime()) / 86400000
  );
  if (du < 0) return 'over';
  if (du <= 3) return 'soon';
  return 'ok';
}

export function wbItemsForFile(items: Item[], fileId: string): Item[] {
  return items.filter((i) => (i.fileIds || []).includes(fileId));
}

export function wbFilePlansForDate(filePlans: FilePlanBlock[], date: string): FilePlanBlock[] {
  return filePlans
    .filter((p) => p.date === date)
    .sort((a, b) => a.startMin - b.startMin);
}

export function wbReadingMinutesInRange(readingSessions: ReadingSession[], from: string, to: string): number {
  return readingSessions
    .filter((r) => r.date >= from && r.date <= to)
    .reduce((s, r) => s + r.minutes, 0);
}

export function wbReadingPagesInRange(readingSessions: ReadingSession[], from: string, to: string): number {
  return readingSessions
    .filter((r) => r.date >= from && r.date <= to)
    .reduce((s, r) => s + r.pagesRead, 0);
}

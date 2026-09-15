/* ==================== Workbench Aurora — Zustand Store ==================== */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  ActiveTimer, CalendarSystem, ClockType, Entry, FocusTiming, GraphView, Habit,
  Item, ItemStatus, JournalEntry, Label, ReportRange, ThemeId, ViewId,
} from './types';
import { SWATCHES, FOCUS_PRESETS } from './types';
import {
  entriesInRange, getFocusTiming, hhmm, isoDate, todayStr, uid,
} from './helpers';

const STORAGE_KEY = 'workbench_aurora_v3';
const MAX_HIST = 80;

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
    plannedStart: null,
    plannedEnd: null,
    startDate: null,
    completedAt: null,
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
  /* ui */
  theme: ThemeId;
  view: ViewId;
  graphView: GraphView;
  reportRange: ReportRange;
  calendarSystem: CalendarSystem;
  calMonthOffset: number;
  calendarSelectedDate: string;
  focusOpen: boolean;
  focusClockType: ClockType;
  focusBackground: string;
  focusPreset: string;
  focusCustomWork: number;
  focusCustomBreak: number;
  focusCompact: boolean;
  dailyCapacityMin: number;
  stats: { focusSessions: number; focusMinutes: number };
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

  startTimer: (labelIds: string[], note: string, itemIds?: string[]) => void;
  startItemFocus: (itemId: string) => boolean;
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
  undo: () => void;
  redo: () => void;

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

      theme: 'light',
      view: 'today',
      graphView: 'tree',
      reportRange: 'week',
      calendarSystem: 'gregorian',
      calMonthOffset: 0,
      calendarSelectedDate: todayStr(),
      focusOpen: false,
      focusClockType: 'analog',
      focusBackground: 'aurora',
      focusPreset: '25',
      focusCustomWork: 45,
      focusCustomBreak: 10,
      focusCompact: false,
      dailyCapacityMin: 240,
      stats: { focusSessions: 0, focusMinutes: 0 },
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

      startTimer: (labelIds, note, itemIds = []) => {
        get().snapshot();
        set({
          activeTimer: { startedAt: new Date().toISOString(), labelIds, itemIds, note, pomodoro: null },
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
            note: item.title,
            pomodoro: { workMin, breakMin, phase: 'work', cycle: 0, pausedAt: null },
          },
        });
        if (['todo', 'inbox', 'waiting'].includes(item.status)) get().setItemStatus(itemId, 'in_progress');
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
          items: prev.items,
          labels: prev.labels,
          entries: prev.entries,
          habits: prev.habits,
          journal: prev.journal,
          activeTimer: prev.activeTimer,
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
          items: next.items,
          labels: next.labels,
          entries: next.entries,
          habits: next.habits,
          journal: next.journal,
          activeTimer: next.activeTimer,
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
          get().snapshot();
          set({ items, labels, entries, habits, journal });
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
            schemaVersion: 3,
            exportedAt: new Date().toISOString(),
            items: s.items,
            labels: s.labels,
            entries: s.entries,
            habits: s.habits,
            journal: s.journal,
            stats: s.stats,
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
      partialize: (s) => ({
        theme: s.theme,
        view: s.view,
        graphView: s.graphView,
        reportRange: s.reportRange,
        calendarSystem: s.calendarSystem,
        calMonthOffset: s.calMonthOffset,
        calendarSelectedDate: s.calendarSelectedDate,
        focusClockType: s.focusClockType,
        focusBackground: s.focusBackground,
        focusPreset: s.focusPreset,
        focusCustomWork: s.focusCustomWork,
        focusCustomBreak: s.focusCustomBreak,
        focusCompact: s.focusCompact,
        dailyCapacityMin: s.dailyCapacityMin,
        stats: s.stats,
        items: s.items,
        labels: s.labels,
        entries: s.entries,
        habits: s.habits,
        journal: s.journal,
        activeTimer: s.activeTimer,
        expanded: s.expanded,
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

/* ==================== Planner — Day timeline & Week board ==================== */
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  CornerDownRight,
  Crosshair,
  Eraser,
  GripVertical,
  Minus,
  Plus,
  Repeat,
  Search,
  SquareCheck,
  Target,
  Wand2,
  Waypoints,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useWB,
  wbFileDeadlineStatus,
  wbFilePagesLeft,
  wbFilePlansForDate,
  wbFileProgress,
  wbFileReadPages,
  wbIsBlocked,
  wbPriorityWeight,
  wbTimeboxedItems,
} from '@/lib/workbench/store';
import type { FilePlanBlock, Item, ResourceFile, Roadmap, RoadmapNode } from '@/lib/workbench/types';
import {
  addDaysStr,
  clamp,
  computeProgress,
  computeHabitStreak,
  dateTimeFromMin,
  daysUntil,
  fmtDateNice,
  fmtDuration,
  hhmmToMin,
  minToHHMM,
  parseDate,
  plannedStartToMin,
  startOfWeekStr,
  timeDiffMin,
  todayStr,
} from '@/lib/workbench/helpers';
import { Btn, IconBtn, Seg, toast, useConfirm, useNow } from '../ui/primitives';
import { DateField } from '../ui/DateField';
import { useViewActions } from '../views/viewCtx';
import './planner.css';

/* ---------- constants ---------- */

const DAY_START_MIN = 360; // 06:00
const DAY_END_MIN = 1380; // 23:00
const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;
const SNAP_MIN = 5;
const SNAP_QK = 15; // quick-capture / pool-drop grid
const TIMELINE_H = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;
const QUICK_DURS = [15, 30, 45, 60, 90, 120];
const PANEL_W = 420;
const WK_MIME = 'application/x-wb-plan';

const snap = (n: number): number => Math.round(n / SNAP_MIN) * SNAP_MIN;
const snapQ = (n: number): number => Math.round(n / SNAP_QK) * SNAP_QK;

function timeboxDurMin(it: Item): number {
  if (it.plannedStart && it.plannedEnd) {
    const d = timeDiffMin(it.plannedStart.slice(11, 16), it.plannedEnd.slice(11, 16));
    if (d > 0) return d;
  }
  return it.estimateMin || 30;
}

interface Slot {
  start: number;
  end: number;
}

/** first free slot ≥ max(8:00, now-if-today) in 5-min steps */
function nextFreeSlot(duration: number, occupied: Slot[], fromMin: number): number {
  let start = snap(Math.max(480, fromMin));
  const limit = 1440 - duration;
  while (start <= limit) {
    if (occupied.every((b) => start + duration <= b.start || start >= b.end)) return start;
    start += SNAP_MIN;
  }
  const lastEnd = occupied.reduce((m, b) => Math.max(m, b.end), 0);
  /* keep the fallback inside the day so a scheduled block can never spill
     past midnight — overlap warnings still flag it if it lands on a block */
  return clamp(Math.max(480, lastEnd), 480, Math.max(480, 1440 - duration));
}

/* ---------- pointer drag ---------- */

type DragKind = 'item' | 'file';

interface DragState {
  kind: DragKind;
  id: string;
  mode: 'move' | 'resize';
  pointerId: number;
  startY: number;
  origStart: number;
  origDur: number;
  start: number;
  dur: number;
  movedPx: number;
}

/* drag-to-schedule from the backlog pool */
interface PoolDrag {
  kind: DragKind;
  id: string;
  title: string;
  dur: number;
  pointerId: number;
  startX: number;
  startY: number;
  movedPx: number;
  overTimeline: boolean;
  minute: number;
}

/* add-block panel — anchored right of the click point, viewport-clamped, portaled */
type AddKind = 'task' | 'reading' | 'habit' | 'goalwork';

interface PanelState {
  date: string; /* the panel is only valid while still viewing this date */
  x: number;
  y: number;
  startMin: number;
  kind: AddKind;
  taskId: string | null; /* prefill from the "From goals" rows */
}

/* each roadmap's next unfinished, not-yet-planned node, resolved to its live entity */
type RmNext =
  | { rm: Roadmap; node: RoadmapNode; kind: 'task'; item: Item }
  | { rm: Roadmap; node: RoadmapNode; kind: 'file'; file: ResourceFile };

/* panel anchor helpers (module-scope pure; called from event handlers only).
   The estimates mirror the panel's real CSS box: width min(420px, 92vw),
   max-height min(88vh, 720px) — so the clamped position can never clip the foot. */
const anchorX = (cx: number): number => {
  const w = Math.min(PANEL_W, window.innerWidth * 0.92);
  return clamp(cx + 14, 8, Math.max(8, window.innerWidth - w - 8));
};
const anchorY = (cy: number): number => {
  const h = Math.min(720, window.innerHeight * 0.88);
  return clamp(cy - 28, 8, Math.max(8, window.innerHeight - h - 8));
};

/* week view HTML5 drag & drop payload */
interface WkDragPayload {
  kind: DragKind;
  id: string;
  src: string;
}

/* ==================== header actions ==================== */

export function PlannerHeaderActions() {
  const mode = useWB((s) => s.plannerMode);
  const setMode = useWB((s) => s.setPlannerMode);
  const setPlannerDate = useWB((s) => s.setPlannerDate);
  return (
    <>
      <Seg<'day' | 'week'>
        value={mode}
        onChange={setMode}
        options={[
          { id: 'day', label: 'Day' },
          { id: 'week', label: 'Week' },
        ]}
      />
      <Btn size="sm" variant="ghost" onClick={() => setPlannerDate(todayStr())}>
        Today
      </Btn>
    </>
  );
}

/* ==================== root ==================== */

export function PlannerView() {
  const mode = useWB((s) => s.plannerMode);
  const date = useWB((s) => s.plannerDate);
  const navigatePlanner = useWB((s) => s.navigatePlanner);
  const setPlannerDate = useWB((s) => s.setPlannerDate);
  const setPlannerMode = useWB((s) => s.setPlannerMode);

  const weekStart = useMemo(() => startOfWeekStr(parseDate(date)), [date]);
  const weekEnd = addDaysStr(weekStart, 6);
  const openDay = (d: string) => {
    setPlannerDate(d);
    setPlannerMode('day');
  };

  const today = todayStr();
  const dayLabel = parseDate(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const step = mode === 'day' ? 1 : 7;

  return (
    <div className="fade-in">
      {/* compact date navigation bar */}
      <div className="plan-nav">
        <div className="plan-datebar">
          <IconBtn
            title={mode === 'day' ? 'Previous day' : 'Previous week'}
            onClick={() => navigatePlanner(-step)}
          >
            <ChevronLeft size={16} />
          </IconBtn>
          <div className="plan-datebar-label">
            <span className="wb-display">
              {mode === 'day' ? dayLabel : `${fmtDateNice(weekStart)} – ${fmtDateNice(weekEnd)}`}
            </span>
            {date === today && <span className="plan-datebar-badge">Today</span>}
          </div>
          <IconBtn
            title={mode === 'day' ? 'Next day' : 'Next week'}
            onClick={() => navigatePlanner(step)}
          >
            <ChevronRight size={16} />
          </IconBtn>
        </div>
        <div className="plan-datebar-aux">
          <DateField
            value={date}
            onChange={(iso) => {
              if (iso) setPlannerDate(iso);
            }}
            compact
          />
          <button
            type="button"
            className="plan-today-chip"
            onClick={() => setPlannerDate(today)}
            title="Jump to today"
          >
            Today
          </button>
        </div>
      </div>
      {mode === 'day' ? <DayPlanner date={date} /> : <WeekPlanner date={date} onOpenDay={openDay} />}
    </div>
  );
}

/* ==================== now line (isolated so only it re-renders each second) ==================== */

function NowLine() {
  const now = useNow(true);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < DAY_START_MIN || nowMin > DAY_END_MIN) return null;
  return (
    <div className="plan-now" style={{ top: (nowMin - DAY_START_MIN) * PX_PER_MIN }}>
      <span className="plan-now-bubble mono">{minToHHMM(nowMin)}</span>
    </div>
  );
}

/* ==================== add-block panel (wide, anchored, portaled) ==================== */

const ADD_KINDS: { id: AddKind; label: string; Icon: LucideIcon }[] = [
  { id: 'task', label: 'Task', Icon: SquareCheck },
  { id: 'reading', label: 'Reading', Icon: BookOpen },
  { id: 'habit', label: 'Habit', Icon: Repeat },
  { id: 'goalwork', label: 'Goal-work', Icon: Target },
];

/** one row inside the task / goal sub-task pickers */
function TaskRow({
  it,
  parent,
  onPick,
}: {
  it: Item;
  parent: Item | null;
  onPick: (it: Item) => void;
}) {
  return (
    <button type="button" className="plan-add-row" onClick={() => onPick(it)} title={it.title}>
      <SquareCheck size={14} className="plan-add-row-ico" aria-hidden />
      <span className="plan-add-row-main">
        <span className="plan-add-row-title">{it.title}</span>
        <span className="plan-add-row-sub">
          {it.priority === 'p0' && <span className="chip chip-over">P0</span>}
          {it.priority === 'p1' && <span className="chip chip-soon">P1</span>}
          {it.estimateMin ? <span className="chip chip-ok">~{fmtDuration(it.estimateMin)}</span> : null}
          {parent && (
            <span className="plan-add-row-goal">
              {parent.type === 'goal' ? (
                <Target size={10} aria-hidden />
              ) : (
                <CornerDownRight size={10} aria-hidden />
              )}
              {parent.title}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** deadline chip for file rows */
function FileDueChip({ f }: { f: ResourceFile }) {
  if (!f.deadline) return null;
  const du = daysUntil(f.deadline);
  const st = wbFileDeadlineStatus(f);
  if (du < 0) return <span className="chip chip-over">overdue</span>;
  if (du === 0) return <span className="chip chip-soon">due today</span>;
  return <span className={`chip ${st === 'soon' ? 'chip-soon' : 'chip-ok'}`}>due {du}d</span>;
}

function AddBlockPanel({
  date,
  startMin: initStart,
  x,
  y,
  kind: initKind,
  taskId: initTaskId,
  habitLayerOn,
  onToggleHabitLayer,
  onClose,
}: {
  date: string;
  startMin: number;
  x: number;
  y: number;
  kind: AddKind;
  taskId: string | null;
  habitLayerOn: boolean;
  onToggleHabitLayer: () => void;
  onClose: () => void;
}) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const setView = useWB((s) => s.setView);
  const addItem = useWB((s) => s.addItem);
  const updateItem = useWB((s) => s.updateItem);
  const addFilePlan = useWB((s) => s.addFilePlan);
  const snapshot = useWB((s) => s.snapshot);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [title, setTitle] = useState('');
  const [day, setDay] = useState(date);
  const [startMin, setStart] = useState(initStart);
  const [dur, setDur] = useState(() => {
    const it = initTaskId ? items.find((i) => i.id === initTaskId) : undefined;
    return clamp(it?.estimateMin || 30, 5, 720);
  });
  const [kind, setKind] = useState<AddKind>(initKind);
  const [pickedId, setPickedId] = useState<string | null>(initTaskId);
  const [goalId, setGoalId] = useState<string | null>(() => {
    if (!initTaskId) return null;
    const it = items.find((i) => i.id === initTaskId);
    const parent = it?.parentId ? items.find((p) => p.id === it.parentId) : undefined;
    return parent && parent.type === 'goal' ? parent.id : null;
  });
  const [fileId, setFileId] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [goalQuery, setGoalQuery] = useState('');

  /* Esc close (yields to an open calendar popover) + page scroll lock */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.df-pop')) return; /* calendar closes first */
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  /* focus the shell when nothing inside grabbed focus (keyboard baseline) */
  useEffect(() => {
    const el = panelRef.current;
    if (el && (!document.activeElement || document.activeElement === document.body)) el.focus();
  }, []);

  /* ---------- picker pools ---------- */
  const taskPool = useMemo(
    () => {
      const q = taskQuery.trim().toLowerCase();
      return items
        .filter(
          (i) =>
            i.type === 'task' &&
            !['done', 'archived', 'inbox'].includes(i.status) &&
            !wbIsBlocked(items, i) &&
            !(i.plannedStart && i.plannedStart.slice(0, 10) === day)
        )
        .filter((i) => (q ? i.title.toLowerCase().includes(q) : true))
        .sort((a, b) => {
          const p = wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority);
          if (p) return p;
          return (
            (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31') ||
            a.title.localeCompare(b.title)
          );
        })
        .slice(0, 40);
    },
    [items, day, taskQuery]
  );

  const filePool = useMemo(
    () => {
      const q = fileQuery.trim().toLowerCase();
      return files
        .filter((f) => !f.archived && wbFileProgress(f) < 100)
        .filter((f) => (q ? f.title.toLowerCase().includes(q) : true))
        .sort(
          (a, b) =>
            (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31') ||
            a.title.localeCompare(b.title)
        );
    },
    [files, fileQuery]
  );

  const goalPool = useMemo(
    () => {
      const q = goalQuery.trim().toLowerCase();
      return items
        .filter((g) => g.type === 'goal' && g.status !== 'done' && g.status !== 'archived')
        .filter((g) => (q ? g.title.toLowerCase().includes(q) : true))
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    [items, goalQuery]
  );

  const goalTasks = useMemo(
    () => {
      if (!goalId) return [];
      return items
        .filter(
          (i) =>
            i.parentId === goalId &&
            !['done', 'archived', 'inbox'].includes(i.status) &&
            !wbIsBlocked(items, i) &&
            !(i.plannedStart && i.plannedStart.slice(0, 10) === day)
        )
        .sort((a, b) => {
          const p = wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority);
          if (p) return p;
          return (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31');
        });
    },
    [items, goalId, day]
  );

  /* ---------- selections ---------- */
  const selTask = pickedId ? items.find((i) => i.id === pickedId) || null : null;
  const selFile = fileId ? files.find((f) => f.id === fileId) || null : null;
  const selGoal = goalId ? items.find((g) => g.id === goalId) || null : null;
  const taskParent = ((): Item | null => {
    if (!selTask?.parentId) return null;
    return items.find((p) => p.id === selTask.parentId) || null;
  })();
  const parentOf = (it: Item): Item | null => {
    if (!it.parentId) return null;
    return items.find((p) => p.id === it.parentId) || null;
  };

  const endMin = startMin + dur;

  /* ---------- time editing ---------- */
  const changeDur = (d: number) => {
    const nd = clamp(Math.round(d), 5, 720);
    setDur(nd);
    setStart((s) => clamp(s, 0, Math.max(0, 1440 - nd)));
  };
  const setStartAt = (m: number) => setStart(clamp(m, 0, 1440 - dur));
  const changeEnd = (m: number) => {
    if (m > startMin + 4) changeDur(m - startMin);
  };
  const pickTask = (it: Item) => {
    setPickedId(it.id);
    changeDur(it.estimateMin || 30);
  };

  /* ---------- submit ---------- */
  const canSubmit =
    kind === 'reading' ? !!selFile : kind === 'goalwork' ? !!selTask : kind === 'task';
  const submitLabel = kind === 'reading' ? 'Add reading block' : selTask ? 'Schedule task' : 'Add task';

  const submit = () => {
    if (!canSubmit) return;
    if (kind === 'reading' && selFile) {
      snapshot();
      addFilePlan(selFile.id, day, startMin, dur);
      toast('Reading block added', `${selFile.title} · ${minToHHMM(startMin)}–${minToHHMM(endMin)}`);
    } else if (selTask) {
      updateItem(
        selTask.id,
        {
          plannedStart: dateTimeFromMin(day, startMin),
          plannedEnd: dateTimeFromMin(day, endMin),
          startDate: day,
        },
        { snapshot: true }
      );
      toast('Scheduled', `${selTask.title} · ${minToHHMM(startMin)}–${minToHHMM(endMin)}`);
    } else {
      const t = title.trim() || 'Untitled task';
      snapshot();
      addItem({
        title: t,
        type: 'task',
        status: 'todo',
        estimateMin: dur,
        plannedStart: dateTimeFromMin(day, startMin),
        plannedEnd: dateTimeFromMin(day, endMin),
        startDate: day,
      });
      toast('Block added', `${t} · ${minToHHMM(startMin)}–${minToHHMM(endMin)}`);
    }
    onClose();
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  const showTaskish = kind === 'task' || kind === 'goalwork';

  return createPortal(
    <>
      <div className="plan-add-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="plan-add"
        style={{ left: x, top: y }}
        role="dialog"
        aria-modal="true"
        aria-label="Add a block"
        tabIndex={-1}
      >
        <div className="plan-add-head">
          <span className="plan-add-title">New block</span>
          <button
            type="button"
            className="plan-add-x"
            onClick={onClose}
            aria-label="Close panel"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <span className="plan-add-sum mono">
          {fmtDateNice(day)} · {minToHHMM(startMin)}–{minToHHMM(endMin)} · {fmtDuration(dur)}
        </span>

        {/* title — or the picked task card */}
        {showTaskish &&
          (selTask ? (
            <div className="plan-add-sel">
              <SquareCheck size={16} className="plan-add-sel-ico" aria-hidden />
              <span className="plan-add-sel-main">
                <span className="plan-add-sel-title" title={selTask.title}>
                  {selTask.title}
                </span>
                <span className="plan-add-sel-chips">
                  {selTask.priority === 'p0' && <span className="chip chip-over">P0</span>}
                  {selTask.priority === 'p1' && <span className="chip chip-soon">P1</span>}
                  {selTask.estimateMin ? (
                    <span className="chip chip-ok">~{fmtDuration(selTask.estimateMin)}</span>
                  ) : null}
                  {taskParent && (
                    <span className="plan-add-row-goal">
                      {taskParent.type === 'goal' ? (
                        <Target size={10} aria-hidden />
                      ) : (
                        <CornerDownRight size={10} aria-hidden />
                      )}
                      {taskParent.title}
                    </span>
                  )}
                </span>
              </span>
              <button
                type="button"
                className="plan-add-sel-x"
                onClick={() => setPickedId(null)}
                aria-label="Choose a different task"
                title="Choose a different task"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <input
              className="plan-add-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              maxLength={120}
              autoFocus
              onKeyDown={onEnter}
            />
          ))}

        {/* when */}
        <div className="plan-add-sec">
          <span className="plan-add-lab">When</span>
          <DateField
            value={day}
            onChange={(iso) => {
              if (iso) setDay(iso);
            }}
            compact
          />
          <div className="plan-add-timerow">
            <label className="plan-add-timelab" htmlFor="plan-add-start">
              Start
            </label>
            <input
              id="plan-add-start"
              type="time"
              className="plan-add-time mono"
              value={minToHHMM(startMin)}
              onChange={(e) => {
                if (e.target.value) setStartAt(hhmmToMin(e.target.value));
              }}
              onKeyDown={onEnter}
            />
            <span className="plan-add-arrow" aria-hidden>
              →
            </span>
            <label className="plan-add-timelab" htmlFor="plan-add-end">
              End
            </label>
            <input
              id="plan-add-end"
              type="time"
              className="plan-add-time mono"
              value={minToHHMM(endMin)}
              onChange={(e) => {
                if (e.target.value) changeEnd(hhmmToMin(e.target.value));
              }}
              onKeyDown={onEnter}
            />
          </div>
          <div className="plan-add-dur">
            <Seg<string>
              options={QUICK_DURS.map((d) => ({ id: String(d), label: `${d}m` }))}
              value={String(dur)}
              onChange={(v) => changeDur(Number(v))}
            />
            <span className="plan-add-step">
              <button
                type="button"
                onClick={() => changeDur(dur - 5)}
                aria-label="Five minutes shorter"
                title="−5 min"
              >
                <Minus size={13} />
              </button>
              <input
                type="number"
                min={5}
                max={720}
                value={dur}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) changeDur(n);
                }}
                aria-label="Duration in minutes"
                onKeyDown={onEnter}
              />
              <span className="plan-add-step-lab">min</span>
              <button
                type="button"
                onClick={() => changeDur(dur + 5)}
                aria-label="Five minutes longer"
                title="+5 min"
              >
                <Plus size={13} />
              </button>
            </span>
          </div>
        </div>

        {/* type */}
        <div className="plan-add-sec">
          <span className="plan-add-lab">Type</span>
          <div className="plan-add-types" role="radiogroup" aria-label="Block type">
            {ADD_KINDS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                data-k={id}
                className={`plan-add-type${kind === id ? ' sel' : ''}`}
                onClick={() => setKind(id)}
                role="radio"
                aria-checked={kind === id}
              >
                <Icon size={15} aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* task picker */}
        {kind === 'task' && !selTask && (
          <div className="plan-add-sec">
            <span className="plan-add-lab">
              Pick a task <span className="plan-add-lab-alt">— or type a new one above</span>
            </span>
            <div className="plan-add-search">
              <Search size={13} aria-hidden />
              <input
                value={taskQuery}
                onChange={(e) => setTaskQuery(e.target.value)}
                placeholder="Search ready tasks…"
                aria-label="Search tasks"
              />
            </div>
            <div className="plan-add-list plan-scroll">
              {taskPool.map((it) => (
                <TaskRow key={it.id} it={it} parent={parentOf(it)} onPick={pickTask} />
              ))}
              {!taskPool.length && (
                <div className="plan-add-none">
                  {taskQuery ? 'No matching tasks.' : 'No ready tasks — type a title to create one.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* reading picker */}
        {kind === 'reading' && (
          <div className="plan-add-sec">
            <span className="plan-add-lab">Pick a file</span>
            <div className="plan-add-search">
              <Search size={13} aria-hidden />
              <input
                value={fileQuery}
                onChange={(e) => setFileQuery(e.target.value)}
                placeholder="Search the library…"
                aria-label="Search files"
              />
            </div>
            <div className="plan-add-list plan-scroll">
              {filePool.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`plan-add-row${fileId === f.id ? ' sel' : ''}`}
                  aria-pressed={fileId === f.id}
                  onClick={() => setFileId(f.id)}
                  title={f.title}
                >
                  <BookOpen size={14} className="plan-add-row-ico violet" aria-hidden />
                  <span className="plan-add-row-main">
                    <span className="plan-add-row-title">{f.title}</span>
                    <span className="plan-add-row-sub">
                      <span className="chip chip-ok">
                        {f.kind === 'md' ? `${wbFilePagesLeft(f)}% left` : `${wbFilePagesLeft(f)}p left`}
                      </span>
                      <FileDueChip f={f} />
                    </span>
                  </span>
                </button>
              ))}
              {!filePool.length && (
                <div className="plan-add-none">
                  {fileQuery ? 'No matching files.' : 'No unread files in the library.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* goal-work: pick a goal, then one of its ready sub-tasks */}
        {kind === 'goalwork' && !selTask && (
          <div className="plan-add-sec">
            <span className="plan-add-lab">Pick a goal, then a task under it</span>
            <div className="plan-add-search">
              <Search size={13} aria-hidden />
              <input
                value={goalQuery}
                onChange={(e) => setGoalQuery(e.target.value)}
                placeholder="Search goals…"
                aria-label="Search goals"
              />
            </div>
            <div className="plan-add-list plan-scroll">
              {goalPool.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`plan-add-row${goalId === g.id ? ' sel' : ''}`}
                  aria-pressed={goalId === g.id}
                  onClick={() => setGoalId(goalId === g.id ? null : g.id)}
                  title={g.title}
                >
                  <Target size={14} className="plan-add-row-ico" aria-hidden />
                  <span className="plan-add-row-main">
                    <span className="plan-add-row-title">{g.title}</span>
                    <span className="plan-add-row-sub">
                      <span className="chip chip-ok">
                        {computeProgress(g, (id) => items.filter((i) => i.parentId === id))}%
                      </span>
                      <span className="plan-add-row-goal">
                        {
                          items.filter(
                            (i) => i.parentId === g.id && !['done', 'archived'].includes(i.status)
                          ).length
                        }{' '}
                        open tasks
                      </span>
                    </span>
                  </span>
                </button>
              ))}
              {!goalPool.length && (
                <div className="plan-add-none">
                  {goalQuery ? 'No matching goals.' : 'No active goals yet.'}
                </div>
              )}
            </div>
            {selGoal && (
              <div className="plan-add-sub">
                <span className="plan-add-lab">Tasks under {selGoal.title}</span>
                <div className="plan-add-list plan-scroll">
                  {goalTasks.map((it) => (
                    <TaskRow key={it.id} it={it} parent={selGoal} onPick={pickTask} />
                  ))}
                  {!goalTasks.length && (
                    <div className="plan-add-none">No ready tasks under this goal.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* habits: info + layer toggle + jump */}
        {kind === 'habit' && (
          <div className="plan-add-sec">
            <span className="plan-add-lab">Habits</span>
            <div className="plan-add-habit">
              <Repeat size={16} className="plan-add-habit-ico" aria-hidden />
              <p className="plan-add-habit-txt">
                Habits don&apos;t need a time block — they appear as a check-in strip under the day
                timeline, so you can tick them off right where you plan. Toggle the strip below or
                review streaks in the Habits view.
              </p>
              <div className="plan-add-habit-row">
                <span className="plan-add-habit-lab">Show habit strip</span>
                <label className="wb-switch" title="Toggle the habit strip">
                  <input
                    type="checkbox"
                    checked={habitLayerOn}
                    onChange={onToggleHabitLayer}
                    aria-label="Show the habit strip on the planner"
                  />
                  <span className="track">
                    <span className="knob" />
                  </span>
                </label>
              </div>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  onClose();
                  setView('habits');
                }}
              >
                <Repeat size={13} /> Open Habits view
              </Btn>
            </div>
          </div>
        )}

        {/* foot */}
        <div className="plan-add-foot">
          <Btn size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Btn>
          {kind !== 'habit' && (
            <Btn size="sm" variant="primary" disabled={!canSubmit} onClick={submit}>
              {submitLabel}
            </Btn>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

/* ==================== habit strip (under the day timeline) ==================== */

function HabitsStrip({ date }: { date: string }) {
  const habits = useWB((s) => s.habits);
  const toggleHabitDay = useWB((s) => s.toggleHabitDay);
  const setView = useWB((s) => s.setView);

  const days = useMemo(() => {
    const ws = startOfWeekStr(parseDate(date));
    return Array.from({ length: 7 }, (_, i) => addDaysStr(ws, i));
  }, [date]);
  const today = todayStr();

  if (!habits.length) {
    return (
      <div className="plan-hab-empty">
        <span>No habits yet — build a streak from the Habits view.</span>
        <Btn size="sm" variant="ghost" onClick={() => setView('habits')}>
          <Repeat size={13} /> Open Habits
        </Btn>
      </div>
    );
  }

  return (
    <div className="plan-habits">
      <div className="plan-hab-head" aria-hidden>
        <span className="plan-hab-head-lab">Habits · this week</span>
        <div className="plan-hab-days">
          {days.map((d) => (
            <span key={d} className={`plan-hab-hd${d === date ? ' cur' : ''}`}>
              {parseDate(d).toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
          ))}
        </div>
      </div>
      {habits.map((h) => {
        const streak = computeHabitStreak(h.log, h.cadence);
        return (
          <div key={h.id} className="plan-hab-row">
            <span className="plan-hab-name">
              <span className="plan-hab-dot" style={{ background: h.color }} aria-hidden />
              <span className="plan-hab-title" title={h.name}>
                {h.name}
              </span>
              {streak > 0 && <span className="chip chip-soon">{streak}{h.cadence === 'weekly' ? 'w' : 'd'}</span>}
            </span>
            <div className="plan-hab-days">
              {days.map((d) => {
                const done = !!h.log?.[d];
                const st: React.CSSProperties = {};
                (st as Record<string, string | number>)['--hab'] = h.color;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`plan-hab-day${done ? ' done' : ''}${d === date ? ' cur' : ''}${d === today ? ' today' : ''}`}
                    style={st}
                    onClick={() => toggleHabitDay(h.id, d)}
                    aria-pressed={done}
                    aria-label={`${h.name} — ${fmtDateNice(d)} — ${done ? 'done' : 'not done'}`}
                    title={`${fmtDateNice(d)}${done ? ' · done' : ''}`}
                  >
                    {done && <Check size={11} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ==================== Up Next card (isolated so the 1s ticker stays cheap) ==================== */

interface UnBlock {
  kind: DragKind;
  id: string;
  fileId: string | null;
  title: string;
  start: number;
  end: number;
}

function UpNextCard({
  date,
  timeboxed,
  fileBlocks,
  fileById,
}: {
  date: string;
  timeboxed: Item[];
  fileBlocks: FilePlanBlock[];
  fileById: Map<string, ResourceFile>;
}) {
  const { openItemDetail } = useViewActions();
  const isToday = date === todayStr();
  const now = useNow(isToday);

  const blocks = useMemo<UnBlock[]>(() => {
    const list: UnBlock[] = [
      ...timeboxed
        .filter((it) => it.status !== 'done')
        .map((it) => {
          const s = plannedStartToMin(it.plannedStart ?? '');
          return {
            kind: 'item' as const,
            id: it.id,
            fileId: null,
            title: it.title,
            start: s,
            end: s + timeboxDurMin(it),
          };
        }),
      ...fileBlocks
        .filter((p) => !p.done)
        .map((p) => ({
          kind: 'file' as const,
          id: p.id,
          fileId: p.fileId,
          title: fileById.get(p.fileId)?.title || 'Reading block',
          start: p.startMin,
          end: p.startMin + p.minutes,
        })),
    ];
    list.sort((a, b) => a.start - b.start);
    return list;
  }, [timeboxed, fileBlocks, fileById]);

  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : -1;
  const running = isToday ? blocks.find((b) => b.start <= nowMin && nowMin < b.end) : undefined;
  const next = running ? undefined : blocks.find((b) => b.start >= nowMin);
  const active = running ?? next;

  const open = (b: UnBlock) => {
    if (b.kind === 'item') openItemDetail(b.id);
    else if (b.fileId) window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: b.fileId }));
  };

  let body: React.ReactNode;
  if (active) {
    const meta = running
      ? `${minToHHMM(running.start)}–${minToHHMM(running.end)} · ${fmtDuration(Math.max(0, running.end - nowMin))} left`
      : isToday
        ? `at ${minToHHMM(next!.start)} · in ${fmtDuration(Math.max(0, next!.start - nowMin))}`
        : `at ${minToHHMM(next!.start)}`;
    body = (
      <button
        type="button"
        className="plan-un-row"
        onClick={() => open(active)}
        title={running ? 'Open current block' : 'Open next block'}
      >
        {running && <span className="plan-un-dot" aria-hidden />}
        <span className="plan-un-main">
          <span className="plan-un-kicker">{running ? 'Now' : isToday ? 'Next' : 'First block'}</span>
          <span className="plan-un-title">{active.title}</span>
          <span className="plan-un-meta mono">{meta}</span>
        </span>
        <ChevronRight size={14} className="plan-un-go" aria-hidden />
      </button>
    );
  } else {
    body = (
      <div className="plan-un-empty">
        {isToday ? 'Nothing left today — nice.' : 'Nothing planned for this day.'}
      </div>
    );
  }

  return (
    <div className="card plan-card">
      <div className="plan-card-head">
        <span className="plan-card-title">Up next</span>
      </div>
      {body}
    </div>
  );
}

/* ==================== day mode ==================== */

function DayPlanner({ date }: { date: string }) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const filePlans = useWB((s) => s.filePlans);
  const capacity = useWB((s) => s.dailyCapacityMin);
  const updateItem = useWB((s) => s.updateItem);
  const addItem = useWB((s) => s.addItem);
  const updateFilePlan = useWB((s) => s.updateFilePlan);
  const deleteFilePlan = useWB((s) => s.deleteFilePlan);
  const addFilePlan = useWB((s) => s.addFilePlan);
  const snapshot = useWB((s) => s.snapshot);
  const roadmaps = useWB((s) => s.roadmaps);
  const confirmMsg = useConfirm();
  const { openItemDetail } = useViewActions();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [poolDrag, setPoolDrag] = useState<PoolDrag | null>(null);
  const [habitLayer, setHabitLayer] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [rmOpen, setRmOpen] = useState(true);
  const closePanel = useCallback(() => setPanel(null), []);
  const toggleHabitLayer = useCallback(() => setHabitLayer((v) => !v), []);

  /* auto-scroll to 08:00 on mount / date change (a stale panel hides via panel.date !== date) */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (480 - DAY_START_MIN) * PX_PER_MIN - 8);
  }, [date]);

  /* safety net: discard drag if pointerup/cancel escapes the captured element */
  useEffect(() => {
    if (!drag) return;
    const clear = () => setDrag(null);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, [drag]);

  /* ---------- data ---------- */
  const timeboxed = useMemo(() => wbTimeboxedItems(items, date), [items, date]);
  const fileBlocks = useMemo(() => wbFilePlansForDate(filePlans, date), [filePlans, date]);
  const fileById = useMemo(() => {
    const m = new Map<string, ResourceFile>();
    files.forEach((f) => m.set(f.id, f));
    return m;
  }, [files]);

  const occupied = useMemo<Slot[]>(
    () => [
      ...timeboxed.map((it) => {
        const s = plannedStartToMin(it.plannedStart ?? '');
        return { start: s, end: s + timeboxDurMin(it) };
      }),
      ...fileBlocks.map((p) => ({ start: p.startMin, end: p.startMin + p.minutes })),
    ],
    [timeboxed, fileBlocks]
  );

  const plannedItemMin = useMemo(() => timeboxed.reduce((s, it) => s + timeboxDurMin(it), 0), [timeboxed]);
  const plannedFileMin = useMemo(() => fileBlocks.reduce((s, p) => s + p.minutes, 0), [fileBlocks]);
  const plannedMin = plannedItemMin + plannedFileMin;
  const overCap = plannedMin > capacity;
  const freeMin = Math.max(0, capacity - plannedMin);
  const blockCount = timeboxed.length + fileBlocks.length;
  const doneCount =
    timeboxed.filter((it) => it.status === 'done').length + fileBlocks.filter((p) => p.done).length;

  const suggested = useMemo(
    () =>
      items
        .filter((i) => {
          if (['done', 'archived', 'inbox'].includes(i.status)) return false;
          if (i.plannedStart && i.plannedStart.slice(0, 10) === date) return false;
          if (wbIsBlocked(items, i)) return false;
          const du = i.deadline ? daysUntil(i.deadline) : null;
          return (du !== null && du <= 3) || i.priority === 'p0' || i.priority === 'p1';
        })
        .sort((a, b) => {
          const p = wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority);
          if (p) return p;
          return (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31');
        })
        .slice(0, 30),
    [items, date]
  );

  const readingGoals = useMemo(
    () =>
      files
        .filter((f) => {
          if (f.archived) return false;
          const prog = wbFileProgress(f);
          if (prog >= 100) return false;
          if (f.deadline && daysUntil(f.deadline) <= 7) return true;
          return prog > 0 || !!f.deadline; /* in progress, or unread with a deadline */
        })
        .sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'))
        .slice(0, 30),
    [files]
  );

  /* ---------- goals & roadmaps bridges (v3) ---------- */

  /* ready tasks whose parent is an active goal */
  const fromGoals = useMemo(
    () => {
      const activeGoalIds = new Set(
        items
          .filter((g) => g.type === 'goal' && g.status !== 'done' && g.status !== 'archived')
          .map((g) => g.id)
      );
      return items
        .filter(
          (i) =>
            i.type === 'task' &&
            i.parentId !== null &&
            activeGoalIds.has(i.parentId) &&
            !['done', 'archived', 'inbox'].includes(i.status) &&
            !(i.plannedStart && i.plannedStart.slice(0, 10) === date) &&
            !wbIsBlocked(items, i)
        )
        .sort((a, b) => {
          const p = wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority);
          if (p) return p;
          return (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31');
        })
        .slice(0, 4);
    },
    [items, date]
  );

  /* each roadmap's first node whose linked entity is unfinished and not yet on the plan */
  const roadmapNext = useMemo<RmNext[]>(
    () => {
      const out: RmNext[] = [];
      for (const rm of roadmaps) {
        for (const node of rm.nodes) {
          if (node.kind === 'task' && node.refId) {
            const it = items.find((i) => i.id === node.refId);
            if (!it || it.status === 'done' || it.status === 'archived') continue;
            if (it.plannedStart && it.plannedStart.slice(0, 10) === date) continue; /* already on the plan */
            out.push({ rm, node, kind: 'task', item: it });
            break;
          }
          if (node.kind === 'file' && node.refId) {
            const f = files.find((x) => x.id === node.refId);
            if (!f || f.archived || wbFileProgress(f) >= 100) continue;
            if (filePlans.some((p) => p.fileId === f.id && p.date === date)) continue;
            out.push({ rm, node, kind: 'file', file: f });
            break;
          }
        }
      }
      return out;
    },
    [roadmaps, items, files, filePlans, date]
  );

  const openRoadmap = useCallback((id: string) => {
    useWB.setState({ view: 'roadmap', activeRoadmapId: id });
  }, []);

  /* ---------- scheduling ---------- */
  const nowMinutes = (): number =>
    date === todayStr() ? new Date().getHours() * 60 + new Date().getMinutes() : 0;

  const scheduleItem = (it: Item) => {
    const dur = it.estimateMin || 30;
    const start = nextFreeSlot(dur, occupied, nowMinutes());
    updateItem(
      it.id,
      {
        plannedStart: dateTimeFromMin(date, start),
        plannedEnd: dateTimeFromMin(date, start + dur),
        startDate: date,
      },
      { snapshot: true }
    );
    toast('Scheduled', `${it.title} at ${minToHHMM(start)}`);
  };

  const addReadingBlock = (f: ResourceFile) => {
    const start = nextFreeSlot(30, occupied, nowMinutes());
    addFilePlan(f.id, date, start, 30);
    toast('Reading block added', `${f.title} at ${minToHHMM(start)} · 30m`);
  };

  const autoPlan = () => {
    const occ = occupied.map((o) => ({ ...o }));
    let planned = plannedMin;
    let blocks = 0;
    let addedMin = 0;
    let snapped = false;
    const ensureSnap = () => {
      if (!snapped) {
        snapshot();
        snapped = true;
      }
    };
    for (const it of suggested) {
      const dur = it.estimateMin || 30;
      /* never overshoot capacity — skip a task that doesn't fit and try the
         next (smaller) one, mirroring DailyPlanModal's auto-fill */
      if (planned + dur > capacity) continue;
      const start = nextFreeSlot(dur, occ, nowMinutes());
      ensureSnap();
      updateItem(it.id, {
        plannedStart: dateTimeFromMin(date, start),
        plannedEnd: dateTimeFromMin(date, start + dur),
        startDate: date,
      });
      occ.push({ start, end: start + dur });
      planned += dur;
      blocks++;
      addedMin += dur;
    }
    let readings = 0;
    for (const f of readingGoals) {
      if (readings >= 2 || planned + 30 > capacity) break;
      const start = nextFreeSlot(30, occ, nowMinutes());
      ensureSnap();
      addFilePlan(f.id, date, start, 30);
      occ.push({ start, end: start + 30 });
      planned += 30;
      blocks++;
      addedMin += 30;
      readings++;
    }
    if (!blocks) {
      toast('Nothing to plan', 'Capacity is already committed.');
      return;
    }
    toast('Auto-planned', `Planned ${blocks} block${blocks === 1 ? '' : 's'} · ${fmtDuration(addedMin)}`);
  };

  /* ---------- timeline header actions ---------- */
  const copyYesterday = () => {
    const y = addDaysStr(date, -1);
    const yItems = wbTimeboxedItems(items, y);
    const yPlans = wbFilePlansForDate(filePlans, y);
    const n = yItems.length + yPlans.length;
    if (!n) {
      toast('Nothing to copy', 'No blocks on yesterday.');
      return;
    }
    snapshot();
    yItems.forEach((it) => {
      const s = plannedStartToMin(it.plannedStart ?? '');
      const dur = timeboxDurMin(it);
      addItem({
        title: it.title,
        type: it.type,
        priority: it.priority,
        color: it.color,
        estimateMin: dur,
        plannedStart: dateTimeFromMin(date, s),
        plannedEnd: dateTimeFromMin(date, s + dur),
        startDate: date,
        status: 'todo',
      });
    });
    yPlans.forEach((p) => addFilePlan(p.fileId, date, p.startMin, p.minutes));
    toast('Copied from yesterday', `Copied ${n} block${n === 1 ? '' : 's'} from yesterday.`);
  };

  const clearDay = () => {
    if (!blockCount) return;
    if (!confirmMsg(`Clear all blocks on ${fmtDateNice(date)}?`)) return;
    snapshot();
    timeboxed.forEach((it) => updateItem(it.id, { plannedStart: null, plannedEnd: null }));
    fileBlocks.forEach((p) => deleteFilePlan(p.id));
    toast('Day cleared', `${blockCount} block${blockCount === 1 ? '' : 's'} removed.`);
  };

  const scrollToNow = () => {
    const el = scrollRef.current;
    if (!el) return;
    const n = new Date();
    const nowMin = n.getHours() * 60 + n.getMinutes();
    el.scrollTo({
      top: Math.max(0, (nowMin - DAY_START_MIN) * PX_PER_MIN - el.clientHeight / 2),
      behavior: 'smooth',
    });
  };

  /* ---------- add-block panel (click on empty timeline, or prefilled from goals) ---------- */
  const openQuickAdd = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest('.plan-block')) return;
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return;
    const minute = clamp(snapQ(DAY_START_MIN + (e.clientY - rect.top) / PX_PER_MIN), 0, 1425);
    setPanel({
      date,
      x: anchorX(e.clientX),
      y: anchorY(e.clientY),
      startMin: minute,
      kind: 'task',
      taskId: null,
    });
  };

  /** open the panel pre-filled with a task ("From goals" rows) at the next free slot */
  const openPrefilled = (e: React.MouseEvent<HTMLElement>, it: Item) => {
    const dur = it.estimateMin || 30;
    const start = nextFreeSlot(dur, occupied, nowMinutes());
    setPanel({
      date,
      x: anchorX(e.clientX),
      y: anchorY(e.clientY),
      startMin: start,
      kind: 'task',
      taskId: it.id,
    });
  };

  /* ---------- pointer drag (move + resize) ---------- */
  const openItemBlock = (id: string) => openItemDetail(id);
  const openFileBlock = (planId: string) => {
    const p = fileBlocks.find((x) => x.id === planId);
    if (p) window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: p.fileId }));
  };

  const beginDrag = (
    e: React.PointerEvent<HTMLElement>,
    kind: DragKind,
    id: string,
    mode: 'move' | 'resize',
    origStart: number,
    origDur: number
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released — drag simply won't start */
    }
    setDrag({
      kind,
      id,
      mode,
      pointerId: e.pointerId,
      startY: e.clientY,
      origStart,
      origDur,
      start: origStart,
      dur: origDur,
      movedPx: 0,
    });
  };

  const onDragMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dy = e.clientY - drag.startY;
    const dMin = dy / PX_PER_MIN;
    const movedPx = Math.max(drag.movedPx, Math.abs(dy));
    if (drag.mode === 'move') {
      const start = clamp(snap(drag.origStart + dMin), 0, 1440 - drag.dur);
      setDrag({ ...drag, start, movedPx });
    } else {
      const dur = clamp(snap(drag.origDur + dMin), 15, 1440 - drag.start);
      setDrag({ ...drag, dur, movedPx });
    }
  };

  const onDragEnd = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const d = drag;
    setDrag(null);
    if (cancelled) return;
    if (d.movedPx < 4) {
      if (d.mode === 'move') {
        if (d.kind === 'item') openItemBlock(d.id);
        else openFileBlock(d.id);
      }
      return;
    }
    if (d.mode === 'move' && d.start === d.origStart) return;
    if (d.mode === 'resize' && d.dur === d.origDur) return;
    if (d.kind === 'item') {
      const patch: Partial<Item> = {
        plannedStart: dateTimeFromMin(date, d.start),
        plannedEnd: dateTimeFromMin(date, d.start + d.dur),
        startDate: date,
      };
      if (d.mode === 'resize') patch.estimateMin = d.dur;
      updateItem(d.id, patch, { snapshot: true });
    } else {
      snapshot();
      updateFilePlan(d.id, { startMin: d.start, minutes: d.dur });
    }
  };

  const dragFor = (kind: DragKind, id: string): DragState | null =>
    drag && drag.kind === kind && drag.id === id ? drag : null;

  /* ---------- drag-to-schedule from the backlog ---------- */
  const beginPoolDrag = (
    e: React.PointerEvent<HTMLElement>,
    kind: DragKind,
    id: string,
    title: string,
    dur: number
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released — drag simply won't start */
    }
    setPoolDrag({
      kind,
      id,
      title,
      dur,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      movedPx: 0,
      overTimeline: false,
      minute: -1,
    });
  };

  const onPoolDragMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!poolDrag || poolDrag.pointerId !== e.pointerId) return;
    const movedPx = Math.max(
      poolDrag.movedPx,
      Math.max(Math.abs(e.clientX - poolDrag.startX), Math.abs(e.clientY - poolDrag.startY))
    );
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) {
      setPoolDrag({ ...poolDrag, movedPx, overTimeline: false });
      return;
    }
    const overTimeline =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    const minute = clamp(
      snapQ(DAY_START_MIN + (e.clientY - rect.top) / PX_PER_MIN),
      0,
      1440 - poolDrag.dur
    );
    setPoolDrag({ ...poolDrag, movedPx, overTimeline, minute });
  };

  const onPoolDragEnd = (e: React.PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (!poolDrag || poolDrag.pointerId !== e.pointerId) return;
    const d = poolDrag;
    setPoolDrag(null);
    if (cancelled || d.movedPx < 4 || !d.overTimeline) return;
    const start = clamp(d.minute, 0, 1440 - d.dur);
    if (d.kind === 'item') {
      updateItem(
        d.id,
        {
          plannedStart: dateTimeFromMin(date, start),
          plannedEnd: dateTimeFromMin(date, start + d.dur),
          startDate: date,
        },
        { snapshot: true }
      );
      toast('Scheduled', `${d.title} at ${minToHHMM(start)}`);
    } else {
      snapshot();
      addFilePlan(d.id, date, start, d.dur);
      toast('Reading block added', `${d.title} at ${minToHHMM(start)} · ${d.dur}m`);
    }
  };

  /* ---------- overlap detection (drag-aware, O(n²) — n is small) ---------- */
  const liveBlocks: { key: string; start: number; end: number }[] = [];
  timeboxed.forEach((it) => {
    const g = dragFor('item', it.id);
    const s = g ? g.start : plannedStartToMin(it.plannedStart ?? '');
    const d = g ? g.dur : timeboxDurMin(it);
    liveBlocks.push({ key: `i${it.id}`, start: s, end: s + d });
  });
  fileBlocks.forEach((p) => {
    const g = dragFor('file', p.id);
    const s = g ? g.start : p.startMin;
    const d = g ? g.dur : p.minutes;
    liveBlocks.push({ key: `f${p.id}`, start: s, end: s + d });
  });
  const overlapKeys = new Set<string>();
  for (let a = 0; a < liveBlocks.length; a++) {
    for (let b = a + 1; b < liveBlocks.length; b++) {
      if (liveBlocks[a].start < liveBlocks[b].end && liveBlocks[b].start < liveBlocks[a].end) {
        overlapKeys.add(liveBlocks[a].key);
        overlapKeys.add(liveBlocks[b].key);
      }
    }
  }

  /* ---------- geometry ---------- */
  const blockTop = (startMin: number) => Math.max(0, Math.round((startMin - DAY_START_MIN) * PX_PER_MIN));
  const blockHeight = (startMin: number, dur: number) =>
    Math.max(24, Math.round((startMin + dur - Math.max(startMin, DAY_START_MIN)) * PX_PER_MIN));

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START_MIN / 60; h <= DAY_END_MIN / 60; h++) out.push(h);
    return out;
  }, []);
  const today = todayStr();

  /* ---------- render ---------- */
  return (
    <div className="plan-day-grid">
      {/* -------- timeline -------- */}
      <div className="card plan-tl-card">
        <div className="plan-tl-head">
          <span className="plan-tl-count">
            {blockCount
              ? `${blockCount} block${blockCount === 1 ? '' : 's'} · ${fmtDuration(plannedMin)} planned`
              : 'Timeline · 06:00 – 23:00'}
          </span>
          <div className="plan-head-actions">
            {blockCount > 0 && (
              <span className={`chip plan-done-chip ${doneCount === blockCount ? 'chip-ok' : 'chip-soon'}`}>
                {doneCount}/{blockCount} done
              </span>
            )}
            <button
              type="button"
              className={`plan-hab-chip${habitLayer ? ' on' : ''}`}
              onClick={toggleHabitLayer}
              aria-pressed={habitLayer}
              title={habitLayer ? 'Hide the habit strip' : 'Show the habit strip under the timeline'}
            >
              <Repeat size={12} aria-hidden />
              Habits
            </button>
            <IconBtn small title="Copy yesterday's blocks onto this day" onClick={copyYesterday}>
              <Copy size={14} />
            </IconBtn>
            {blockCount > 0 && (
              <IconBtn small danger title="Clear all blocks on this day" onClick={clearDay}>
                <Eraser size={14} />
              </IconBtn>
            )}
            {date === today && (
              <IconBtn small title="Scroll to now" onClick={scrollToNow}>
                <Crosshair size={14} />
              </IconBtn>
            )}
          </div>
        </div>
        <div className="plan-tl-scroll plan-scroll" ref={scrollRef}>
          <div className="plan-tl" style={{ height: TIMELINE_H }}>
            <div className="plan-tl-gutter" aria-hidden>
              {hours.slice(0, -1).map((h) => (
                <span key={h} style={{ top: (h * 60 - DAY_START_MIN) * PX_PER_MIN - 7 }}>
                  {String(h).padStart(2, '0')}:00
                </span>
              ))}
            </div>
            <div
              className={`plan-tl-lanes${poolDrag ? ' droptarget' : ''}`}
              ref={lanesRef}
              onClick={openQuickAdd}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="plan-hour-line"
                  style={{ top: Math.round((h * 60 - DAY_START_MIN) * PX_PER_MIN) }}
                />
              ))}
              {hours.slice(0, -1).map((h) => (
                <div
                  key={`h${h}`}
                  className="plan-half-line"
                  style={{ top: Math.round((h * 60 - DAY_START_MIN) * PX_PER_MIN + HOUR_PX / 2) }}
                />
              ))}
              {date === today && <NowLine />}
              {!blockCount && (
                <div className="plan-empty">
                  <div>
                    <div className="plan-empty-title">A clear day</div>
                    <div className="plan-empty-sub">
                      click any empty spot to add a block — or pull work in from the backlog
                    </div>
                  </div>
                </div>
              )}

              {/* item timeboxes */}
              {timeboxed.map((it) => {
                const g = dragFor('item', it.id);
                const startMin = g ? g.start : plannedStartToMin(it.plannedStart ?? '');
                const durMin = g ? g.dur : timeboxDurMin(it);
                const clamped = startMin < DAY_START_MIN;
                const overl = overlapKeys.has(`i${it.id}`);
                const style: React.CSSProperties = {
                  top: blockTop(startMin),
                  height: blockHeight(startMin, durMin),
                };
                if (it.color) (style as Record<string, string | number>)['--stripe'] = it.color;
                return (
                  <div
                    key={it.id}
                    className={`plan-block plan-block-item${it.status === 'done' ? ' done' : ''}${g ? ' dragging' : ''}${overl ? ' plan-overlap' : ''}`}
                    style={style}
                    role="button"
                    tabIndex={0}
                    aria-label={`${it.title}, ${minToHHMM(startMin)} to ${minToHHMM(startMin + durMin)}${overl ? ', overlaps another block' : ''}`}
                    onPointerDown={(e) => beginDrag(e, 'item', it.id, 'move', startMin, durMin)}
                    onPointerMove={onDragMove}
                    onPointerUp={(e) => onDragEnd(e, false)}
                    onPointerCancel={(e) => onDragEnd(e, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openItemDetail(it.id);
                      }
                    }}
                  >
                    <div className="plan-block-time mono">
                      {clamped && <span aria-hidden>↑ </span>}
                      {minToHHMM(startMin)}–{minToHHMM(startMin + durMin)}
                    </div>
                    <div className="plan-block-title">{it.title}</div>
                    {overl && (
                      <span className="plan-overlap-ico" aria-hidden>
                        <AlertTriangle size={10} />
                      </span>
                    )}
                    <div
                      className="plan-block-resize"
                      role="separator"
                      aria-label="Resize block"
                      onPointerDown={(e) => beginDrag(e, 'item', it.id, 'resize', startMin, durMin)}
                    />
                  </div>
                );
              })}

              {/* file reading blocks */}
              {fileBlocks.map((p) => {
                const g = dragFor('file', p.id);
                const startMin = g ? g.start : p.startMin;
                const durMin = g ? g.dur : p.minutes;
                const f = fileById.get(p.fileId);
                const overl = overlapKeys.has(`f${p.id}`);
                return (
                  <div
                    key={p.id}
                    className={`plan-block plan-block-file${p.done ? ' done' : ''}${g ? ' dragging' : ''}${overl ? ' plan-overlap' : ''}`}
                    style={{ top: blockTop(startMin), height: blockHeight(startMin, durMin) }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Read ${f?.title || 'file'}, ${minToHHMM(startMin)} to ${minToHHMM(startMin + durMin)}${overl ? ', overlaps another block' : ''}`}
                    onPointerDown={(e) => beginDrag(e, 'file', p.id, 'move', startMin, durMin)}
                    onPointerMove={onDragMove}
                    onPointerUp={(e) => onDragEnd(e, false)}
                    onPointerCancel={(e) => onDragEnd(e, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: p.fileId }));
                      }
                    }}
                  >
                    <div className="plan-block-time mono">
                      <BookOpen size={11} className="plan-block-ico" aria-hidden />
                      {minToHHMM(startMin)}–{minToHHMM(startMin + durMin)}
                    </div>
                    <div className="plan-block-title">{f?.title || 'Removed file'}</div>
                    {overl && (
                      <span className="plan-overlap-ico" aria-hidden>
                        <AlertTriangle size={10} />
                      </span>
                    )}
                    <button
                      type="button"
                      className={`plan-check${p.done ? ' on' : ''}`}
                      title={p.done ? 'Mark as not read' : 'Mark as read'}
                      aria-label={p.done ? 'Mark reading block as not done' : 'Mark reading block as done'}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateFilePlan(p.id, { done: !p.done });
                      }}
                    >
                      <Check size={11} />
                    </button>
                    <button
                      type="button"
                      className="plan-x"
                      title="Remove reading block"
                      aria-label="Remove reading block"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteFilePlan(p.id);
                      }}
                    >
                      <X size={11} />
                    </button>
                    <div
                      className="plan-block-resize"
                      role="separator"
                      aria-label="Resize reading block"
                      onPointerDown={(e) => beginDrag(e, 'file', p.id, 'resize', startMin, durMin)}
                    />
                  </div>
                );
              })}

              {/* pool drag ghost */}
              {poolDrag?.overTimeline && (
                <div
                  className={`plan-block plan-ghost${poolDrag.kind === 'file' ? ' plan-ghost-file' : ''}`}
                  style={{
                    top: blockTop(poolDrag.minute),
                    height: blockHeight(poolDrag.minute, poolDrag.dur),
                  }}
                  aria-hidden="true"
                >
                  <div className="plan-block-time mono">
                    {minToHHMM(poolDrag.minute)}–{minToHHMM(poolDrag.minute + poolDrag.dur)}
                  </div>
                  <div className="plan-block-title">{poolDrag.title}</div>
                </div>
              )}
            </div>
          </div>
        </div>
        {habitLayer && <HabitsStrip date={date} />}
      </div>

      {/* -------- backlog -------- */}
      <div className="plan-side">
        {/* up next */}
        <UpNextCard date={date} timeboxed={timeboxed} fileBlocks={fileBlocks} fileById={fileById} />

        {/* capacity */}
        <div className="card plan-card">
          <div className="plan-card-head">
            <span className="plan-card-title">Capacity</span>
            <span className="mono plan-cap-num">
              {fmtDuration(plannedMin)} / {fmtDuration(capacity)}
            </span>
          </div>
          <div className={`plan-meter${overCap ? ' over' : ''}`}>
            <span style={{ width: `${Math.min(100, (plannedMin / Math.max(1, capacity)) * 100)}%` }} />
          </div>
          <div className={`plan-meter-note${overCap ? ' over' : ''}`}>
            {overCap
              ? `Over by ${fmtDuration(plannedMin - capacity)} — consider moving a block.`
              : plannedMin === 0
                ? 'Nothing planned yet.'
                : `${fmtDuration(freeMin)} of capacity free.`}
          </div>
          {!overCap && (
            <div className="plan-free">
              <div className="plan-meter plan-meter-sm">
                <span style={{ width: `${Math.min(100, (freeMin / Math.max(1, capacity)) * 100)}%` }} />
              </div>
              <span className="plan-free-lab mono">{fmtDuration(freeMin)} free</span>
            </div>
          )}
        </div>

        {/* suggested work */}
        <div className="card plan-card">
          <div className="plan-card-head">
            <span className="plan-card-title">Suggested work</span>
            <span className="plan-card-count">{suggested.length}</span>
          </div>
          {suggested.length ? (
            <div className="plan-sug-list plan-scroll">
              {suggested.map((it) => {
                const du = it.deadline ? daysUntil(it.deadline) : null;
                return (
                  <div
                    key={it.id}
                    className={`plan-sug-row${poolDrag?.id === it.id ? ' dragging' : ''}`}
                  >
                    <button
                      type="button"
                      className="plan-sug-grip"
                      title="Drag onto the timeline to schedule"
                      aria-label={`Drag ${it.title} onto the timeline to schedule`}
                      onPointerDown={(e) =>
                        beginPoolDrag(e, 'item', it.id, it.title, it.estimateMin || 30)
                      }
                      onPointerMove={onPoolDragMove}
                      onPointerUp={(e) => onPoolDragEnd(e, false)}
                      onPointerCancel={(e) => onPoolDragEnd(e, true)}
                    >
                      <GripVertical size={14} aria-hidden />
                    </button>
                    <div className="plan-sug-main">
                      <div className="plan-sug-title" title={it.title}>
                        {it.title}
                      </div>
                      <div className="plan-sug-chips">
                        {it.priority === 'p0' && <span className="chip chip-over">P0</span>}
                        {it.priority === 'p1' && <span className="chip chip-soon">P1</span>}
                        {du !== null && du < 0 && (
                          <span className="chip chip-over">overdue {Math.abs(du)}d</span>
                        )}
                        {du === 0 && <span className="chip chip-soon">due today</span>}
                        {du !== null && du > 0 && du <= 3 && (
                          <span className="chip chip-soon">due {du}d</span>
                        )}
                      </div>
                    </div>
                    <Btn size="sm" onClick={() => scheduleItem(it)}>
                      + Add
                    </Btn>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="plan-side-empty">No pressing work — clear waters.</div>
          )}
        </div>

        {/* from goals — ready tasks under active goals */}
        <div className={`wb-collapsible plan-coll${goalsOpen ? ' open' : ''}`}>
          <button
            type="button"
            className="wb-coll-head"
            onClick={() => setGoalsOpen((o) => !o)}
            aria-expanded={goalsOpen}
          >
            <Target size={14} className="plan-coll-ico" aria-hidden />
            <span className="plan-coll-title">From goals</span>
            {fromGoals.length > 0 && <span className="plan-card-count">{fromGoals.length}</span>}
            <ChevronRight size={15} className="chev" aria-hidden />
          </button>
          <div className="wb-coll-body">
            {fromGoals.length ? (
              <div className="plan-src-list">
                {fromGoals.map((it) => {
                  const goal = items.find((g) => g.id === it.parentId) || null;
                  return (
                    <div key={it.id} className="plan-src-row">
                      <button
                        type="button"
                        className="plan-src-main"
                        onClick={() => openItemDetail(it.id)}
                        title={it.title}
                      >
                        <span className="plan-src-title">{it.title}</span>
                        <span className="plan-src-chips">
                          {it.priority === 'p0' && <span className="chip chip-over">P0</span>}
                          {it.priority === 'p1' && <span className="chip chip-soon">P1</span>}
                          {it.estimateMin ? (
                            <span className="chip chip-ok">~{fmtDuration(it.estimateMin)}</span>
                          ) : null}
                          {goal && (
                            <span className="plan-src-next">
                              <Target size={10} aria-hidden /> {goal.title}
                            </span>
                          )}
                        </span>
                      </button>
                      <IconBtn
                        small
                        title={`Pick a time for "${it.title}"`}
                        onClick={(e) => openPrefilled(e, it)}
                      >
                        <Clock3 size={14} />
                      </IconBtn>
                      <Btn size="sm" onClick={() => scheduleItem(it)}>
                        Schedule
                      </Btn>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="plan-side-empty">No ready tasks under active goals.</div>
            )}
          </div>
        </div>

        {/* from roadmaps — each roadmap's next unfinished node */}
        <div className={`wb-collapsible plan-coll${rmOpen ? ' open' : ''}`}>
          <button
            type="button"
            className="wb-coll-head"
            onClick={() => setRmOpen((o) => !o)}
            aria-expanded={rmOpen}
          >
            <Waypoints size={14} className="plan-coll-ico" aria-hidden />
            <span className="plan-coll-title">From roadmaps</span>
            {roadmapNext.length > 0 && (
              <span className="plan-card-count">{roadmapNext.length}</span>
            )}
            <ChevronRight size={15} className="chev" aria-hidden />
          </button>
          <div className="wb-coll-body">
            {roadmapNext.length ? (
              <div className="plan-src-list">
                {roadmapNext.map((nx) => (
                  <div key={`${nx.rm.id}:${nx.node.id}`} className="plan-src-row">
                    <button
                      type="button"
                      className="plan-src-main"
                      onClick={() => openRoadmap(nx.rm.id)}
                      title={nx.rm.title}
                    >
                      <span className="plan-src-title">{nx.rm.title}</span>
                      <span className="plan-src-chips">
                        <span className="plan-src-next">
                          {nx.kind === 'task' ? (
                            <SquareCheck size={11} aria-hidden />
                          ) : (
                            <BookOpen size={11} aria-hidden />
                          )}
                          {nx.kind === 'task' ? nx.item.title : nx.file.title}
                        </span>
                        {nx.kind === 'task' && nx.item.estimateMin ? (
                          <span className="chip chip-ok">~{fmtDuration(nx.item.estimateMin)}</span>
                        ) : null}
                        {nx.kind === 'file' ? (
                          <span className="chip chip-ok">
                            {nx.file.kind === 'md' ? `${wbFilePagesLeft(nx.file)}% left` : `${wbFilePagesLeft(nx.file)}p left`}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <Btn size="sm" variant="ghost" onClick={() => openRoadmap(nx.rm.id)}>
                      Open
                    </Btn>
                    <Btn
                      size="sm"
                      onClick={() =>
                        nx.kind === 'task' ? scheduleItem(nx.item) : addReadingBlock(nx.file)
                      }
                    >
                      Schedule
                    </Btn>
                  </div>
                ))}
              </div>
            ) : (
              <div className="plan-side-empty">
                No roadmap next-steps waiting
                {roadmaps.length ? '.' : ' — create a roadmap to connect.'}
              </div>
            )}
          </div>
        </div>

        {/* reading goals */}
        <div className="card plan-card">
          <div className="plan-card-head">
            <span className="plan-card-title">Reading goals</span>
            <span className="plan-card-count">{readingGoals.length}</span>
          </div>
          {readingGoals.length ? (
            <div className="plan-sug-list plan-scroll">
              {readingGoals.map((f) => {
                const left = wbFilePagesLeft(f);
                const du = f.deadline ? daysUntil(f.deadline) : null;
                const st = wbFileDeadlineStatus(f);
                return (
                  <div key={f.id} className={`plan-sug-row${poolDrag?.id === f.id ? ' dragging' : ''}`}>
                    <button
                      type="button"
                      className="plan-sug-grip"
                      title="Drag onto the timeline to schedule a reading block"
                      aria-label={`Drag ${f.title} onto the timeline to schedule a reading block`}
                      onPointerDown={(e) => beginPoolDrag(e, 'file', f.id, f.title, 30)}
                      onPointerMove={onPoolDragMove}
                      onPointerUp={(e) => onPoolDragEnd(e, false)}
                      onPointerCancel={(e) => onPoolDragEnd(e, true)}
                    >
                      <GripVertical size={14} aria-hidden />
                    </button>
                    <BookOpen size={15} className="plan-read-ico" aria-hidden />
                    <div className="plan-sug-main">
                      <div className="plan-sug-title" title={f.title}>
                        {f.title}
                      </div>
                      <div className="plan-sug-chips">
                        <span className="chip chip-ok">{f.kind === 'md' ? `${left}% left` : `${left} pages left`}</span>
                        {st === 'over' && <span className="chip chip-over">overdue</span>}
                        {du === 0 && <span className="chip chip-soon">due today</span>}
                        {du !== null && du > 0 && (
                          <span className={`chip ${st === 'soon' ? 'chip-soon' : 'chip-ok'}`}>
                            due {du}d
                          </span>
                        )}
                      </div>
                    </div>
                    <Btn size="sm" onClick={() => addReadingBlock(f)}>
                      30m
                    </Btn>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="plan-side-empty">No reading goals right now.</div>
          )}
        </div>

        {/* auto-plan */}
        <div className="card plan-card">
          <div className="plan-card-head">
            <span className="plan-card-title">Auto-plan</span>
          </div>
          <p className="plan-autop-note">
            Greedily schedules suggested work and up to 2 reading blocks, until the day&apos;s capacity
            is committed.
          </p>
          <Btn
            size="sm"
            variant="primary"
            block
            disabled={(!suggested.length && !readingGoals.length) || plannedMin >= capacity}
            onClick={autoPlan}
          >
            <Wand2 size={13} /> Auto-plan the day
          </Btn>
        </div>
      </div>

      {/* add-block panel (portaled, anchored) — auto-hidden when the viewed date changes */}
      {panel && panel.date === date && (
        <AddBlockPanel
          date={panel.date}
          startMin={panel.startMin}
          x={panel.x}
          y={panel.y}
          kind={panel.kind}
          taskId={panel.taskId}
          habitLayerOn={habitLayer}
          onToggleHabitLayer={toggleHabitLayer}
          onClose={closePanel}
        />
      )}
    </div>
  );
}

/* ==================== week mode ==================== */

type WeekRow =
  | { key: string; start: number; kind: 'item'; it: Item }
  | { key: string; start: number; kind: 'file'; p: FilePlanBlock };

function WeekPlanner({ date, onOpenDay }: { date: string; onOpenDay: (d: string) => void }) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const filePlans = useWB((s) => s.filePlans);
  const updateItem = useWB((s) => s.updateItem);
  const updateFilePlan = useWB((s) => s.updateFilePlan);
  const deleteFilePlan = useWB((s) => s.deleteFilePlan);
  const snapshot = useWB((s) => s.snapshot);
  const { openItemDetail } = useViewActions();

  const [dropDate, setDropDate] = useState<string | null>(null);

  const today = todayStr();
  const weekStart = useMemo(() => startOfWeekStr(parseDate(date)), [date]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i)), [weekStart]);
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  const perDay = useMemo(
    () =>
      days.map((d) => {
        const tb = wbTimeboxedItems(items, d);
        const fb = wbFilePlansForDate(filePlans, d);
        const dueItems = items.filter(
          (i) => i.deadline === d && i.status !== 'done' && i.status !== 'archived'
        );
        const dueFiles = files.filter((f) => f.deadline === d && !f.archived);
        const itemMin = tb.reduce((s, i) => s + timeboxDurMin(i), 0);
        const fileMin = fb.reduce((s, p) => s + p.minutes, 0);
        return { d, tb, fb, dueItems, dueFiles, itemMin, fileMin };
      }),
    [days, items, files, filePlans]
  );

  const maxDayMin = Math.max(1, ...perDay.map((p) => p.itemMin + p.fileMin));
  const totItem = perDay.reduce((s, p) => s + p.itemMin, 0);
  const totFile = perDay.reduce((s, p) => s + p.fileMin, 0);

  const shiftTimebox = (it: Item, d: string, delta: number) => {
    if (!it.plannedStart) return;
    const startMin = plannedStartToMin(it.plannedStart);
    const dur = timeboxDurMin(it);
    const nd = addDaysStr(d, delta);
    updateItem(
      it.id,
      {
        plannedStart: dateTimeFromMin(nd, startMin),
        plannedEnd: dateTimeFromMin(nd, startMin + dur),
        startDate: nd,
      },
      { snapshot: true }
    );
  };

  const shiftFilePlan = (p: FilePlanBlock, delta: number) => {
    snapshot();
    updateFilePlan(p.id, { date: addDaysStr(p.date, delta) });
  };

  /* HTML5 drag & drop between day columns */
  const onColDragOver = (e: React.DragEvent<HTMLDivElement>, d: string) => {
    if (!e.dataTransfer.types.includes(WK_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropDate !== d) setDropDate(d);
  };

  const onColDragLeave = (e: React.DragEvent<HTMLDivElement>, d: string) => {
    const rt = e.relatedTarget as Node | null;
    if (!e.currentTarget.contains(rt)) setDropDate((cur) => (cur === d ? null : cur));
  };

  const onColDrop = (e: React.DragEvent<HTMLDivElement>, d: string) => {
    e.preventDefault();
    setDropDate(null);
    const raw = e.dataTransfer.getData(WK_MIME);
    if (!raw) return;
    let p: WkDragPayload;
    try {
      p = JSON.parse(raw) as WkDragPayload;
    } catch {
      return;
    }
    if (!p || p.src === d) return;
    if (p.kind === 'item') {
      const it = items.find((i) => i.id === p.id);
      if (!it?.plannedStart) return;
      const startMin = plannedStartToMin(it.plannedStart);
      const dur = timeboxDurMin(it);
      updateItem(
        p.id,
        {
          plannedStart: dateTimeFromMin(d, startMin),
          plannedEnd: dateTimeFromMin(d, startMin + dur),
          startDate: d,
        },
        { snapshot: true }
      );
      toast('Block moved', `${it.title} → ${fmtDateNice(d)}`);
    } else {
      if (!filePlans.some((x) => x.id === p.id)) return;
      snapshot();
      updateFilePlan(p.id, { date: d });
      toast('Reading block moved', `→ ${fmtDateNice(d)}`);
    }
  };

  return (
    <div className="plan-week">
      <div className="plan-wk-head">
        {perDay.map(({ d, itemMin, fileMin }) => {
          const tot = itemMin + fileMin;
          return (
            <button
              key={d}
              type="button"
              className={`plan-wk-dayhead${d === today ? ' today' : ''}`}
              onClick={() => onOpenDay(d)}
              title={`Open ${fmtDateNice(d)} in Day view`}
            >
              <span className="plan-wk-dow">
                {parseDate(d).toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="plan-wk-num mono">{parseDate(d).getDate()}</span>
              {tot > 0 && (
                <span className="plan-wk-daytotal mono" title={`${fmtDuration(tot)} planned`}>
                  {fmtDuration(tot)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="plan-wk-cols">
        {perDay.map(({ d, tb, fb, dueItems, dueFiles }) => {
          const rows: WeekRow[] = [
            ...tb.map(
              (it): WeekRow => ({
                key: `i${it.id}`,
                start: plannedStartToMin(it.plannedStart ?? ''),
                kind: 'item',
                it,
              })
            ),
            ...fb.map(
              (p): WeekRow => ({ key: `f${p.id}`, start: p.startMin, kind: 'file', p })
            ),
          ].sort((a, b) => a.start - b.start);
          const empty = !rows.length && !dueItems.length && !dueFiles.length;
          return (
            <div
              key={d}
              className={`plan-wk-col plan-scroll${d === today ? ' today' : ''}${dropDate === d ? ' drop' : ''}`}
              onDragOver={(e) => onColDragOver(e, d)}
              onDragLeave={(e) => onColDragLeave(e, d)}
              onDrop={(e) => onColDrop(e, d)}
            >
              <div className="plan-wk-all">
                {dueItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className={`plan-wk-due${d < today ? ' past' : ''}`}
                    onClick={() => openItemDetail(it.id)}
                    title={`${it.title} — deadline`}
                  >
                    {it.title}
                  </button>
                ))}
                {dueFiles.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="plan-wk-due file"
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: f.id }))
                    }
                    title={`${f.title} — reading deadline`}
                  >
                    {f.title}
                  </button>
                ))}
              </div>
              <div className="plan-wk-rows">
                {rows.map((row) =>
                  row.kind === 'item' ? (
                    <div
                      key={row.key}
                      className={`plan-wk-row${row.it.status === 'done' ? ' done' : ''}`}
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          WK_MIME,
                          JSON.stringify({ kind: 'item', id: row.it.id, src: d })
                        );
                        e.dataTransfer.setData('text/plain', row.it.title);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDropDate(null)}
                      onClick={() => openItemDetail(row.it.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openItemDetail(row.it.id);
                        }
                      }}
                    >
                      <span className="plan-dot pine" aria-hidden />
                      <span className="mono plan-wk-time">{(row.it.plannedStart ?? '').slice(11, 16)}</span>
                      <span className="plan-wk-label">{row.it.title}</span>
                      <span className="plan-wk-moves">
                        <button
                          type="button"
                          title="Move one day earlier"
                          aria-label="Move one day earlier"
                          onClick={(e) => {
                            e.stopPropagation();
                            shiftTimebox(row.it, d, -1);
                          }}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <button
                          type="button"
                          title="Move one day later"
                          aria-label="Move one day later"
                          onClick={(e) => {
                            e.stopPropagation();
                            shiftTimebox(row.it, d, 1);
                          }}
                        >
                          <ChevronRight size={12} />
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div
                      key={row.key}
                      className={`plan-wk-row${row.p.done ? ' done' : ''}`}
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          WK_MIME,
                          JSON.stringify({ kind: 'file', id: row.p.id, src: d })
                        );
                        e.dataTransfer.setData(
                          'text/plain',
                          fileById.get(row.p.fileId)?.title || 'Reading block'
                        );
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDropDate(null)}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('wb-open-reader', { detail: row.p.fileId })
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          window.dispatchEvent(
                            new CustomEvent('wb-open-reader', { detail: row.p.fileId })
                          );
                        }
                      }}
                    >
                      <span className="plan-dot violet" aria-hidden />
                      <span className="mono plan-wk-time">{minToHHMM(row.p.startMin)}</span>
                      <span className="plan-wk-label">
                        {fileById.get(row.p.fileId)?.title || 'Removed file'}
                      </span>
                      <span className="plan-wk-moves">
                        <button
                          type="button"
                          title="Move one day earlier"
                          aria-label="Move one day earlier"
                          onClick={(e) => {
                            e.stopPropagation();
                            shiftFilePlan(row.p, -1);
                          }}
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <button
                          type="button"
                          title="Move one day later"
                          aria-label="Move one day later"
                          onClick={(e) => {
                            e.stopPropagation();
                            shiftFilePlan(row.p, 1);
                          }}
                        >
                          <ChevronRight size={12} />
                        </button>
                        <button
                          type="button"
                          className="plan-wk-x"
                          title="Remove reading block"
                          aria-label="Remove reading block"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFilePlan(row.p.id);
                          }}
                        >
                          <X size={11} />
                        </button>
                      </span>
                    </div>
                  )
                )}
                {empty && <div className="plan-wk-free">—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* week footer — planned minutes per day */}
      <div className="card plan-wk-foot">
        <div
          className="plan-wk-bars"
          role="img"
          aria-label={`Planned minutes per day this week, total ${fmtDuration(totItem + totFile)}`}
        >
          {perDay.map(({ d, itemMin, fileMin }) => {
            const tot = itemMin + fileMin;
            return (
              <div
                key={d}
                className={`plan-wk-bar-col${d === today ? ' today' : ''}`}
                title={`${fmtDateNice(d)} · ${fmtDuration(tot)}`}
              >
                <div className="plan-wk-bar">
                  {tot > 0 && (
                    <span style={{ height: `${Math.max(6, (tot / maxDayMin) * 100)}%` }}>
                      <i className="bi" style={{ flexGrow: Math.max(itemMin, 0.001) }} />
                      <i className="bf" style={{ flexGrow: Math.max(fileMin, 0.001) }} />
                    </span>
                  )}
                </div>
                <span className="plan-wk-bar-l">
                  {parseDate(d).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mono plan-wk-totals">
          Planned {fmtDuration(totItem)} · Reading {fmtDuration(totFile)}
        </div>
      </div>
    </div>
  );
}

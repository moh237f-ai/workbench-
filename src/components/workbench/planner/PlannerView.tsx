/* ==================== Planner — Day timeline & Week board ==================== */
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronLeft, ChevronRight, Wand2, X } from 'lucide-react';
import {
  useWB,
  wbFileDeadlineStatus,
  wbFilePlansForDate,
  wbFileProgress,
  wbFileReadPages,
  wbIsBlocked,
  wbPriorityWeight,
  wbTimeboxedItems,
} from '@/lib/workbench/store';
import type { FilePlanBlock, Item, ResourceFile } from '@/lib/workbench/types';
import {
  addDaysStr,
  clamp,
  dateTimeFromMin,
  daysUntil,
  fmtDateLong,
  fmtDateNice,
  fmtDuration,
  minToHHMM,
  parseDate,
  plannedStartToMin,
  startOfWeekStr,
  timeDiffMin,
  todayStr,
} from '@/lib/workbench/helpers';
import { Btn, IconBtn, Seg, toast, useNow } from '../ui/primitives';
import { useViewActions } from '../views/viewCtx';
import './planner.css';

/* ---------- constants ---------- */

const DAY_START_MIN = 360; // 06:00
const DAY_END_MIN = 1380; // 23:00
const HOUR_PX = 56;
const PX_PER_MIN = HOUR_PX / 60;
const SNAP_MIN = 5;
const TIMELINE_H = (DAY_END_MIN - DAY_START_MIN) * PX_PER_MIN;

const snap = (n: number): number => Math.round(n / SNAP_MIN) * SNAP_MIN;

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
  return clamp(Math.max(480, lastEnd), 480, 1380);
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

  return (
    <div className="fade-in">
      <div className="plan-nav">
        <div className="plan-nav-title wb-display">
          {mode === 'day'
            ? date === todayStr()
              ? 'Today'
              : fmtDateLong(parseDate(date))
            : `${fmtDateNice(weekStart)} – ${fmtDateNice(weekEnd)}`}
        </div>
        <div className="plan-nav-actions">
          <IconBtn
            title={mode === 'day' ? 'Previous day' : 'Previous week'}
            onClick={() => navigatePlanner(mode === 'day' ? -1 : -7)}
          >
            <ChevronLeft />
          </IconBtn>
          <Btn size="sm" variant="ghost" onClick={() => setPlannerDate(todayStr())}>
            Today
          </Btn>
          <IconBtn
            title={mode === 'day' ? 'Next day' : 'Next week'}
            onClick={() => navigatePlanner(mode === 'day' ? 1 : 7)}
          >
            <ChevronRight />
          </IconBtn>
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

/* ==================== day mode ==================== */

function DayPlanner({ date }: { date: string }) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const filePlans = useWB((s) => s.filePlans);
  const capacity = useWB((s) => s.dailyCapacityMin);
  const updateItem = useWB((s) => s.updateItem);
  const updateFilePlan = useWB((s) => s.updateFilePlan);
  const deleteFilePlan = useWB((s) => s.deleteFilePlan);
  const addFilePlan = useWB((s) => s.addFilePlan);
  const snapshot = useWB((s) => s.snapshot);
  const { openItemDetail } = useViewActions();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  /* auto-scroll to 08:00 on mount / date change */
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
  const blockCount = timeboxed.length + fileBlocks.length;

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
      if (planned >= capacity) break;
      const dur = it.estimateMin || 30;
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
      if (readings >= 2 || planned >= capacity) break;
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

  /* ---------- pointer drag (move + resize) ---------- */
  const openBlock = (kind: DragKind, id: string) => {
    if (kind === 'item') openItemDetail(id);
    else window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: id }));
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
      if (d.mode === 'move') openBlock(d.kind, d.id);
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
            <div className="plan-tl-lanes">
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
                    <div className="plan-empty-sub">pull work in from the backlog →</div>
                  </div>
                </div>
              )}

              {/* item timeboxes */}
              {timeboxed.map((it) => {
                const g = dragFor('item', it.id);
                const startMin = g ? g.start : plannedStartToMin(it.plannedStart ?? '');
                const durMin = g ? g.dur : timeboxDurMin(it);
                const clamped = startMin < DAY_START_MIN;
                const style: React.CSSProperties = {
                  top: blockTop(startMin),
                  height: blockHeight(startMin, durMin),
                };
                if (it.color) (style as Record<string, string | number>)['--stripe'] = it.color;
                return (
                  <div
                    key={it.id}
                    className={`plan-block plan-block-item${it.status === 'done' ? ' done' : ''}${g ? ' dragging' : ''}`}
                    style={style}
                    role="button"
                    tabIndex={0}
                    aria-label={`${it.title}, ${minToHHMM(startMin)} to ${minToHHMM(startMin + durMin)}`}
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
                return (
                  <div
                    key={p.id}
                    className={`plan-block plan-block-file${p.done ? ' done' : ''}${g ? ' dragging' : ''}`}
                    style={{ top: blockTop(startMin), height: blockHeight(startMin, durMin) }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Read ${f?.title || 'file'}, ${minToHHMM(startMin)} to ${minToHHMM(startMin + durMin)}`}
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
            </div>
          </div>
        </div>
      </div>

      {/* -------- backlog -------- */}
      <div className="plan-side">
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
                : `${fmtDuration(capacity - plannedMin)} of capacity free.`}
          </div>
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
                  <div key={it.id} className="plan-sug-row">
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

        {/* reading goals */}
        <div className="card plan-card">
          <div className="plan-card-head">
            <span className="plan-card-title">Reading goals</span>
            <span className="plan-card-count">{readingGoals.length}</span>
          </div>
          {readingGoals.length ? (
            <div className="plan-sug-list plan-scroll">
              {readingGoals.map((f) => {
                const left = Math.max(0, f.pageCount - wbFileReadPages(f));
                const du = f.deadline ? daysUntil(f.deadline) : null;
                const st = wbFileDeadlineStatus(f);
                return (
                  <div key={f.id} className="plan-sug-row">
                    <BookOpen size={15} className="plan-read-ico" aria-hidden />
                    <div className="plan-sug-main">
                      <div className="plan-sug-title" title={f.title}>
                        {f.title}
                      </div>
                      <div className="plan-sug-chips">
                        <span className="chip chip-ok">{left} pages left</span>
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

  return (
    <div className="plan-week">
      <div className="plan-wk-head">
        {perDay.map(({ d }) => (
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
          </button>
        ))}
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
            <div key={d} className={`plan-wk-col plan-scroll${d === today ? ' today' : ''}`}>
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

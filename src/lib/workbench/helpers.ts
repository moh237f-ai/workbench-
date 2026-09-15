/* ==================== Workbench Aurora — Helpers ==================== */
import type { Entry, FocusTiming, Item, Priority } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayStr(): string {
  return isoDate(new Date());
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDateNice(s: string): string {
  if (!s) return '';
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtDateLong(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function fmtDuration(min: number): string {
  min = Math.round(min || 0);
  if (min < 60) return min + 'm';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function hhmm(d: Date): string {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-based
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  return r;
}

export function daysUntil(deadline: string): number {
  const d = parseDate(deadline);
  const t = parseDate(todayStr());
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

export function priorityLabel(p: string): string {
  return p.toUpperCase();
}

export function timeDiffMin(a: string, b: string): number {
  const [sh, sm] = a.split(':').map(Number);
  const [eh, em] = b.split(':').map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 1440;
  return diff;
}

/* ---------- v4: planner time helpers ---------- */

/** minutes-since-midnight → "HH:MM" */
export function minToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "HH:MM" → minutes since midnight */
export function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** yyyy-mm-dd + minutes → "yyyy-mm-ddThh:mm" (timebox format) */
export function dateTimeFromMin(date: string, min: number): string {
  return `${date}T${minToHHMM(min)}`;
}

/** "yyyy-mm-ddThh:mm" → minutes since midnight */
export function plannedStartToMin(plannedStart: string): number {
  return hhmmToMin(plannedStart.slice(11, 16));
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function startOfWeekStr(d: Date = new Date()): string {
  return isoDate(startOfWeek(d));
}

export function colorForIndex(i: number, swatches: string[]): string {
  return swatches[i % swatches.length];
}

/* ---------- Item progress & status ---------- */

export function computeProgress(
  item: Item,
  getChildren: (id: string) => Item[]
): number {
  const children = getChildren(item.id);
  if (children.length > 0) {
    const vals = children.map((c) => computeProgress(c, getChildren));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }
  if (item.checklist && item.checklist.length > 0) {
    const done = item.checklist.filter((c) => c.done).length;
    return Math.round((done / item.checklist.length) * 100);
  }
  return item.manualProgress || 0;
}

export type DeadlineStatus = 'done' | 'over' | 'soon' | 'ok' | null;

export function deadlineStatus(
  item: Item,
  pct: number
): DeadlineStatus {
  if (!item.deadline) return null;
  if (pct >= 100) return 'done';
  const du = daysUntil(item.deadline);
  if (du < 0) return 'over';
  if (du <= 3) return 'soon';
  return 'ok';
}

/* ---------- Focus timing (pause-aware) ---------- */

export function getFocusTiming(
  activeTimer: { startedAt: string; pomodoro: PomodoroLike | null } | null,
  nowMs: number
): FocusTiming {
  let phaseLabel = 'Free';
  let remaining = 0;
  let progress = 0;
  let cycleCount = 0;
  let paused = false;
  const t = activeTimer;
  if (t && t.pomodoro) {
    const p = t.pomodoro;
    paused = !!p.pausedAt;
    const totalSec = Math.max(1, (p.phase === 'work' ? p.workMin : p.breakMin) * 60);
    const startMs = new Date(t.startedAt).getTime();
    const refMs = paused ? new Date(p.pausedAt!).getTime() : nowMs;
    const elapsed = Math.max(0, Math.floor((refMs - startMs) / 1000));
    remaining = Math.max(0, totalSec - elapsed);
    progress = Math.min(100, (elapsed / totalSec) * 100);
    phaseLabel = p.phase === 'work' ? 'Focus' : 'Break';
    cycleCount = p.cycle + (p.phase === 'work' ? 1 : 0);
  } else if (t) {
    remaining = Math.max(0, Math.floor((nowMs - new Date(t.startedAt).getTime()) / 1000));
    phaseLabel = 'Timer';
  }
  return { phaseLabel, remaining, progress, cycleCount, paused };
}

interface PomodoroLike {
  workMin: number;
  breakMin: number;
  phase: 'work' | 'break';
  cycle: number;
  pausedAt: string | null;
}

/* ---------- Quick capture NLP ---------- */

export interface ParsedCapture {
  title: string;
  priority: Priority;
  estimateMin: number | null;
  deadline: string | null;
}

export function parseCapture(text: string): ParsedCapture {
  let title = text.trim();
  let priority: Priority = 'p2';
  let estimateMin: number | null = null;
  let deadline: string | null = null;

  const p = title.match(/(?:^|\s)(p[0-3])(?=\s|$)/i);
  if (p) {
    priority = p[1].toLowerCase() as Priority;
    title = title.replace(p[0], ' ').trim();
  }
  const dur = title.match(/(?:^|\s)(\d+(?:\.5)?)(m|h)(?=\s|$)/i);
  if (dur) {
    estimateMin = Math.round(parseFloat(dur[1]) * (dur[2].toLowerCase() === 'h' ? 60 : 1));
    title = title.replace(dur[0], ' ').trim();
  }
  const lower = title.toLowerCase();
  if (/(?:^|\s)tomorrow(?:\s|$)/.test(lower)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    deadline = isoDate(d);
    title = title.replace(/\btomorrow\b/i, ' ').trim();
  } else if (/(?:^|\s)today(?:\s|$)/.test(lower)) {
    deadline = todayStr();
    title = title.replace(/\btoday\b/i, ' ').trim();
  } else if (/(?:^|\s)next\s+week(?:\s|$)/.test(lower)) {
    const d = startOfWeek(new Date());
    d.setDate(d.getDate() + 7);
    deadline = isoDate(d);
    title = title.replace(/\bnext\s+week\b/i, ' ').trim();
  }
  return { title: title.replace(/\s{2,}/g, ' ').trim() || 'Untitled task', priority, estimateMin, deadline };
}

/* ---------- Reports range ---------- */

/** Last N days INCLUDING today, as an inclusive [start, today] ISO pair. */
export function lastNDays(n: number): [string, string] {
  const t = todayStr();
  const d = parseDate(t);
  d.setDate(d.getDate() - (n - 1));
  return [isoDate(d), t];
}

export function rangeToDates(range: string, custom?: { from: string; to: string }): [string, string] {
  const t = todayStr();
  if (range === 'today') return [t, t];
  if (range === 'last3') return lastNDays(3);
  if (range === 'last7') return lastNDays(7);
  if (range === 'last30') return lastNDays(30);
  if (range === 'week') return [isoDate(startOfWeek(new Date())), t];
  if (range === 'month') {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), t];
  }
  if (range === 'year') {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear(), 0, 1)), t];
  }
  if (range === 'lastyear') {
    const d = new Date();
    return [isoDate(new Date(d.getFullYear() - 1, 0, 1)), isoDate(new Date(d.getFullYear() - 1, 11, 31))];
  }
  if (range === 'custom' && custom?.from && custom?.to) {
    return custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
  }
  return ['0000-01-01', '9999-12-31'];
}

export function rangeLabel(range: string): string {
  const map: Record<string, string> = {
    today: 'Today',
    last3: 'Last 3 days',
    last7: 'Last 7 days',
    week: 'This week',
    month: 'This month',
    last30: 'Last 30 days',
    year: 'This year',
    lastyear: 'Last year',
    all: 'All time',
    custom: 'Custom',
  };
  return map[range] || 'Range';
}

export function entriesInRange(entries: Entry[], start: string, end: string): Entry[] {
  return entries.filter((e) => e.date >= start && e.date <= end);
}

/* ---------- Habit streak ---------- */

export function computeStreak(log: Record<string, boolean>): number {
  let s = 0;
  const cur = new Date();
  // Allow today not-yet-done without breaking yesterday's streak
  if (!log[isoDate(cur)]) cur.setDate(cur.getDate() - 1);
  while (log[isoDate(cur)]) {
    s++;
    cur.setDate(cur.getDate() - 1);
  }
  return s;
}

/* ---------- ICS ---------- */

export function buildICS(items: Item[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Workbench Aurora//EN'];
  items.forEach((it, idx) => {
    if (!it.plannedStart) return;
    const day = it.plannedStart.slice(0, 10).replace(/-/g, '');
    const start = it.plannedStart.slice(11, 16).replace(':', '');
    const end = (it.plannedEnd || it.plannedStart).slice(11, 16).replace(':', '');
    const endDay = (it.plannedEnd || it.plannedStart).slice(0, 10).replace(/-/g, '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:wb-${it.id}@aurora`,
      `DTSTAMP:${day}T${start}00`,
      `DTSTART:${day}T${start}00`,
      `DTEND:${endDay}T${end}00`,
      `SUMMARY:${it.title.replace(/[,;\\]/g, (m) => '\\' + m)}`,
      `DESCRIPTION:${(it.nextAction || '').replace(/[,;\\]/g, (m) => '\\' + m)}`,
      'END:VEVENT'
    );
    void idx;
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function parseICS(raw: string): { title: string; deadline: string; plannedStart: string }[] {
  const out: { title: string; deadline: string; plannedStart: string }[] = [];
  raw.split('BEGIN:VEVENT').slice(1).forEach((b) => {
    const summary = (b.match(/SUMMARY:(.*)/) || [])[1]?.trim();
    const ds = (b.match(/DTSTART(?:;[^:]+)?:([0-9T]+)/) || [])[1];
    if (!summary || !ds) return;
    const m = ds.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
    if (!m) return;
    out.push({
      title: summary,
      deadline: `${m[1]}-${m[2]}-${m[3]}`,
      plannedStart: `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5] || '00'}` : ''}`,
    });
  });
  return out;
}

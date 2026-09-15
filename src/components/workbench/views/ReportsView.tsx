/* ==================== Reports View ==================== */
'use client';

import React, { useMemo, useState } from 'react';
import {
  Activity, BarChart3, BookOpen, CalendarCheck, CalendarDays, CalendarRange, CalendarX, ChevronRight,
  Clock, Flame, Gauge, ListChecks, Map, Printer, Repeat, Sparkles, Tags, Target, TrendingDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useWB, wbChildren, wbFileAvgSecPerPage, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages,
  wbReadingMinutesInRange, wbReadingPagesInRange,
} from '@/lib/workbench/store';
import {
  computeProgress, computeStreak, entriesInRange, fmtDateNice, fmtDuration, hhmmToMin, isoDate,
  parseDate, rangeLabel, rangeToDates, todayStr,
} from '@/lib/workbench/helpers';
import {
  SHAMSI_MONTHS, SHAMSI_MONTHS_SHORT, SHAMSI_WEEKDAYS_SHORT, dateToShamsi, formatShamsi,
  shamsiMonthDays, shamsiToGreg,
} from '@/lib/workbench/shamsi';
import type { CalendarSystem, Item, ReportCustomRange, ReportRange, ResourceFile, Roadmap } from '@/lib/workbench/types';
import { DateField } from '../ui/DateField';
import { Btn } from '../ui/primitives';
import { LogView } from './LogView';
import './reports.css';

/* ---------- shared date helpers (dual calendar) ---------- */

const GREG_WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** weekday index inside the system week: Shamsi Sat=0…Fri=6, Gregorian Mon=0…Sun=6 */
function weekdayIndex(d: Date, system: CalendarSystem): number {
  return system === 'shamsi' ? (d.getDay() + 1) % 7 : (d.getDay() + 6) % 7;
}

/** ISO of the week start (Saturday for Shamsi, Monday for Gregorian) containing d. */
function weekStartIso(d: Date, system: CalendarSystem): string {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - weekdayIndex(r, system));
  return isoDate(r);
}

function gregShort(iso: string): string {
  return parseDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function shamsiShort(iso: string): string {
  return formatShamsi(dateToShamsi(parseDate(iso)), true);
}

function dualDate(iso: string, system: CalendarSystem): string {
  return system === 'shamsi' ? `${shamsiShort(iso)} · ${gregShort(iso)}` : `${gregShort(iso)} · ${shamsiShort(iso)}`;
}

function weekdayShort(d: Date, system: CalendarSystem): string {
  return system === 'shamsi' ? SHAMSI_WEEKDAYS_SHORT[(d.getDay() + 1) % 7] : GREG_WD[(d.getDay() + 6) % 7];
}

function countDaysBetween(a: string, b: string): number {
  if (!a || !b || b < a) return 0;
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000) + 1;
}

/** contribution cell intensity: 0 → empty, 1: 1-30m, 2: 30-60m, 3: 1-2h, 4: 2h+ */
function cgLevel(m: number): number {
  if (m <= 0) return 0;
  if (m <= 30) return 1;
  if (m <= 60) return 2;
  if (m <= 120) return 3;
  return 4;
}

/* ---------- header: range bar + custom range + print ---------- */

const RANGE_OPTIONS: { id: ReportRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'last3', label: 'Last 3' },
  { id: 'last7', label: 'Last 7' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last30', label: 'Last 30' },
  { id: 'year', label: 'This year' },
  { id: 'lastyear', label: 'Last year' },
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom' },
];

export function ReportsHeaderActions() {
  const range = useWB((s) => s.reportRange);
  const setRange = useWB((s) => s.setReportRange);
  const custom = useWB((s) => s.reportCustom);
  const setCustom = useWB((s) => s.setReportCustom);
  const [draft, setDraft] = useState<ReportCustomRange>({ from: custom.from, to: custom.to });

  const draftValid = !!draft.from && !!draft.to;

  return (
    <div className="report-rangebar no-print">
      <div className="radio-pills">
        {RANGE_OPTIONS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`radio-pill ${range === r.id ? 'active' : ''}`}
            onClick={() => {
              if (r.id === 'custom') setDraft({ from: custom.from, to: custom.to });
              setRange(r.id);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div className="report-custom-row">
          <DateField
            compact
            value={draft.from}
            allowClear={false}
            placeholder="From"
            onChange={(v) => setDraft((d) => ({ ...d, from: v }))}
          />
          <span className="report-dash" aria-hidden="true">–</span>
          <DateField
            compact
            value={draft.to}
            allowClear={false}
            placeholder="To"
            onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
          />
          <Btn
            size="sm"
            variant="primary"
            disabled={!draftValid}
            title={draftValid ? 'Apply the custom range' : 'Pick both dates first'}
            onClick={() => setCustom({ from: draft.from, to: draft.to })}
          >
            Apply
          </Btn>
        </div>
      )}

      <Btn size="sm" title="Print this report or save it as PDF" onClick={() => window.print()}>
        <Printer size={14} /> Print / PDF
      </Btn>
    </div>
  );
}

/* ---------- roadmap / planner helpers ---------- */

/** Average progress across a roadmap's measurable nodes
 *  (goal/task → live item progress, file → file progress, milestone → done, note → excluded). */
function roadmapProgress(rm: Roadmap, items: Item[], files: ResourceFile[]): number {
  const vals: number[] = [];
  rm.nodes.forEach((n) => {
    if (n.kind === 'note') return;
    if (n.kind === 'milestone') {
      vals.push(n.done ? 100 : 0);
      return;
    }
    if (!n.refId) return;
    if (n.kind === 'file') {
      const f = files.find((x) => x.id === n.refId);
      if (f) vals.push(wbFileProgress(f));
      return;
    }
    const it = items.find((x) => x.id === n.refId);
    if (it) vals.push(computeProgress(it, (id) => wbChildren(items, id)));
  });
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

/** Planned timebox duration in minutes (plannedEnd − plannedStart, 30m fallback when open-ended). */
function timeboxMinutes(i: Item): number {
  if (!i.plannedStart) return 0;
  const start = hhmmToMin(i.plannedStart.slice(11, 16));
  const end = i.plannedEnd ? hhmmToMin(i.plannedEnd.slice(11, 16)) : start + 30;
  return Math.max(0, end - start);
}

/* ---------- local computation types ---------- */

interface ChartPoint {
  key: string;
  minutes: number;
  reading: number;
  label: string;
  sub: string | null;
  tip: string;
}

interface DayChartData {
  weekly: boolean;
  points: ChartPoint[];
}

interface MonthRow {
  key: string;
  label: string;
  full: string;
  yearLabel: string | null;
  startIso: string;
  endIso: string;
  logged: number;
  reading: number;
  entryCount: number;
}

interface CgDay { iso: string; minutes: number; off: boolean }
interface CgCol { days: CgDay[]; label: string | null }

interface HabitRow {
  habit: { id: string; name: string; color: string; cadence: 'daily' | 'weekly' };
  pct: number;
  done: number;
  denom: number;
  unit: string;
}

interface Insight {
  icon: LucideIcon;
  tone: 'good' | 'warn' | 'bad';
  text: string;
  sub: string;
}

/* ==================== main view ==================== */

export function ReportsView() {
  const entries = useWB((s) => s.entries);
  const labels = useWB((s) => s.labels);
  const items = useWB((s) => s.items);
  const stats = useWB((s) => s.stats);
  const range = useWB((s) => s.reportRange);
  const reportCustom = useWB((s) => s.reportCustom);
  const system = useWB((s) => s.calendarSystem);
  const capacity = useWB((s) => s.dailyCapacityMin);
  const files = useWB((s) => s.files);
  const readingSessions = useWB((s) => s.readingSessions);
  const filePlans = useWB((s) => s.filePlans);
  const roadmaps = useWB((s) => s.roadmaps);
  const habits = useWB((s) => s.habits);
  const [logOpen, setLogOpen] = useState(false);

  const [from, to] = useMemo(() => rangeToDates(range, reportCustom), [range, reportCustom]);
  const isAllTime = from === '0000-01-01';

  /* ----- per-day activity maps ----- */
  const entriesByDay = useMemo(() => {
    const m: Record<string, number> = {};
    entries.forEach((e) => { m[e.date] = (m[e.date] || 0) + e.durationMin; });
    return m;
  }, [entries]);

  const readingByDay = useMemo(() => {
    const m: Record<string, number> = {};
    readingSessions.forEach((r) => { m[r.date] = (m[r.date] || 0) + r.minutes; });
    return m;
  }, [readingSessions]);

  const minutesByDay = useMemo(() => {
    const m: Record<string, number> = { ...entriesByDay };
    readingSessions.forEach((r) => { m[r.date] = (m[r.date] || 0) + r.minutes; });
    return m;
  }, [entriesByDay, readingSessions]);

  const activeMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    Object.keys(minutesByDay).forEach((d) => { if (minutesByDay[d] > 0) m[d] = true; });
    return m;
  }, [minutesByDay]);

  const currentStreak = useMemo(() => computeStreak(activeMap), [activeMap]);

  /* ----- effective span (all-time → earliest activity … today) ----- */
  const effectiveFrom = useMemo(() => {
    if (!isAllTime) return from;
    const keys = Object.keys(minutesByDay).sort();
    return keys[0] || todayStr();
  }, [isAllTime, from, minutesByDay]);

  const effectiveTo = to === '9999-12-31' ? todayStr() : to;
  const statTo = useMemo(() => {
    const t = todayStr();
    return effectiveTo > t ? t : effectiveTo;
  }, [effectiveTo]);
  const statDays = useMemo(() => Math.max(0, countDaysBetween(effectiveFrom, statTo)), [effectiveFrom, statTo]);

  /* ----- range-scoped entries + totals ----- */
  const scoped = useMemo(() => entriesInRange(entries, from, to), [entries, from, to]);
  const readingMinutes = wbReadingMinutesInRange(readingSessions, from, to);
  const readingPages = wbReadingPagesInRange(readingSessions, from, to);

  const rangeStats = useMemo(() => {
    const totalLogged = scoped.reduce((s, e) => s + e.durationMin, 0);
    const totalProductive = totalLogged + readingMinutes;
    const days = statDays;
    const activeDays = Object.keys(minutesByDay).filter(
      (d) => d >= effectiveFrom && d <= statTo && minutesByDay[d] > 0
    ).length;
    const avgPerDay = days > 0 ? totalProductive / days : 0;
    const zeroDays = Math.max(0, days - activeDays);
    let bestIso = '';
    let bestVal = 0;
    Object.keys(minutesByDay).forEach((d) => {
      if (d < effectiveFrom || d > statTo) return;
      if (minutesByDay[d] > bestVal) { bestVal = minutesByDay[d]; bestIso = d; }
    });
    /* longest consecutive active run inside the range */
    let bestRun = 0;
    let run = 0;
    if (days > 0) {
      let cur = parseDate(effectiveFrom);
      const end = parseDate(statTo);
      let guard = 0;
      while (cur <= end && guard < 4000) {
        if (minutesByDay[isoDate(cur)] > 0) { run += 1; if (run > bestRun) bestRun = run; }
        else run = 0;
        cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
        guard += 1;
      }
    }
    return { totalLogged, totalProductive, activeDays, avgPerDay, zeroDays, bestIso, bestVal, bestRun };
  }, [scoped, readingMinutes, statDays, effectiveFrom, statTo, minutesByDay]);

  /* ----- by-label / by-item (range-scoped) ----- */
  const byLabel = useMemo(() => {
    const m: Record<string, number> = {};
    scoped.forEach((e) => {
      if (!e.labelIds.length) {
        m._none = (m._none || 0) + e.durationMin;
        return;
      }
      e.labelIds.forEach((lid) => {
        m[lid] = (m[lid] || 0) + e.durationMin;
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const byItem = useMemo(() => {
    const m: Record<string, number> = {};
    scoped.forEach((e) => {
      e.itemIds.forEach((iid) => {
        m[iid] = (m[iid] || 0) + e.durationMin;
      });
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [scoped]);

  const maxLabelMin = Math.max(1, ...byLabel.map((r) => r[1]));
  const maxItemMin = Math.max(1, ...byItem.map((r) => r[1]));

  /* ----- day list (capped to the most recent 800 days) ----- */
  const allDays = useMemo(() => {
    let startIso = effectiveFrom;
    if (countDaysBetween(startIso, effectiveTo) > 800) {
      const d = parseDate(effectiveTo);
      d.setDate(d.getDate() - 799);
      startIso = isoDate(d);
    }
    const out: string[] = [];
    let cur = parseDate(startIso);
    const end = parseDate(effectiveTo);
    let guard = 0;
    while (cur <= end && guard < 810) {
      out.push(isoDate(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      guard += 1;
    }
    return out;
  }, [effectiveFrom, effectiveTo]);

  /* ----- by day / by week chart data (weekly buckets for long ranges) ----- */
  const dayChartData: DayChartData = useMemo(() => {
    if (allDays.length <= 62) {
      return {
        weekly: false,
        points: allDays.map((iso) => {
          const d = parseDate(iso);
          return {
            key: iso,
            minutes: minutesByDay[iso] || 0,
            reading: readingByDay[iso] || 0,
            label: String(d.getDate()),
            sub: system === 'shamsi' ? String(dateToShamsi(d).jd) : null,
            tip: `${weekdayShort(d, system)} ${dualDate(iso, system)}`,
          };
        }),
      };
    }
    const buckets: { key: string; minutes: number; reading: number }[] = [];
    let curKey = '';
    allDays.forEach((iso) => {
      const k = weekStartIso(parseDate(iso), system);
      if (k !== curKey) { buckets.push({ key: k, minutes: 0, reading: 0 }); curKey = k; }
      const b = buckets[buckets.length - 1];
      b.minutes += minutesByDay[iso] || 0;
      b.reading += readingByDay[iso] || 0;
    });
    return {
      weekly: true,
      points: buckets.map((b) => {
        const d = parseDate(b.key);
        return {
          key: b.key,
          minutes: b.minutes,
          reading: b.reading,
          label: String(d.getDate()),
          sub: system === 'shamsi' ? String(dateToShamsi(d).jd) : null,
          tip: `Week of ${weekdayShort(d, system)} ${dualDate(b.key, system)}`,
        };
      }),
    };
  }, [allDays, system, minutesByDay, readingByDay]);

  const maxDayMin = Math.max(1, ...dayChartData.points.map((p) => p.minutes));
  const maxReadingDay = Math.max(1, ...dayChartData.points.map((p) => p.reading));

  /* ----- by-month section (yearly report) ----- */
  const monthRows: MonthRow[] | null = useMemo(() => {
    const spanDays = countDaysBetween(effectiveFrom, effectiveTo);
    const showMonths = range === 'year' || range === 'lastyear' || spanDays >= 183;
    if (!showMonths) return null;

    const out: MonthRow[] = [];
    const end = parseDate(effectiveTo);
    if (system === 'shamsi') {
      let cur = dateToShamsi(parseDate(effectiveFrom));
      for (let guard = 0; guard < 64; guard++) {
        const a = shamsiToGreg(cur.jy, cur.jm, 1);
        const b = shamsiToGreg(cur.jy, cur.jm, shamsiMonthDays(cur.jy, cur.jm));
        out.push({
          key: `s-${cur.jy}-${cur.jm}`,
          label: SHAMSI_MONTHS_SHORT[cur.jm - 1],
          full: `${SHAMSI_MONTHS[cur.jm - 1]} ${cur.jy}`,
          yearLabel: cur.jm === 1 ? String(cur.jy) : null,
          startIso: isoDate(new Date(a.gy, a.gm - 1, a.gd)),
          endIso: isoDate(new Date(b.gy, b.gm - 1, b.gd)),
          logged: 0,
          reading: 0,
          entryCount: 0,
        });
        if (parseDate(out[out.length - 1].endIso) >= end) break;
        cur = cur.jm === 12 ? { jy: cur.jy + 1, jm: 1, jd: 1 } : { jy: cur.jy, jm: cur.jm + 1, jd: 1 };
      }
    } else {
      let y = parseDate(effectiveFrom).getFullYear();
      let m = parseDate(effectiveFrom).getMonth();
      for (let guard = 0; guard < 64; guard++) {
        out.push({
          key: `g-${y}-${m}`,
          label: new Date(y, m, 15).toLocaleDateString('en-GB', { month: 'short' }),
          full: new Date(y, m, 15).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
          yearLabel: m === 0 ? String(y) : null,
          startIso: isoDate(new Date(y, m, 1)),
          endIso: isoDate(new Date(y, m + 1, 0)),
          logged: 0,
          reading: 0,
          entryCount: 0,
        });
        if (parseDate(out[out.length - 1].endIso) >= end) break;
        m += 1;
        if (m > 11) { m = 0; y += 1; }
      }
    }

    return out.slice(-24).map((b) => {
      const monthEntries = entriesInRange(entries, b.startIso, b.endIso);
      const logged = monthEntries.reduce((s, e) => s + e.durationMin, 0);
      const reading = readingSessions
        .filter((r) => r.date >= b.startIso && r.date <= b.endIso)
        .reduce((s, r) => s + r.minutes, 0);
      return { ...b, logged, reading, entryCount: monthEntries.length };
    });
  }, [range, system, effectiveFrom, effectiveTo, entries, readingSessions]);

  const maxMonthMin = monthRows ? Math.max(1, ...monthRows.map((m) => m.logged)) : 1;

  /* ----- contribution graph (heatmap of productive minutes per day) ----- */
  const contribution = useMemo(() => {
    const rangeDayCount = countDaysBetween(effectiveFrom, effectiveTo);
    const weeks = Math.min(26, Math.max(8, Math.ceil(rangeDayCount / 7)));
    const endIso = effectiveTo;
    const ws = parseDate(weekStartIso(parseDate(endIso), system));
    ws.setDate(ws.getDate() - (weeks - 1) * 7);

    const cols: CgCol[] = [];
    for (let w = 0; w < weeks; w++) {
      const days: CgDay[] = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + w * 7 + r);
        const iso = isoDate(d);
        days.push({ iso, minutes: minutesByDay[iso] || 0, off: iso > endIso });
      }
      cols.push({ days, label: null });
    }
    /* month labels: mark the column that contains the 1st of a month */
    let lastLabel = '';
    cols.forEach((c) => {
      c.days.forEach((d) => {
        if (d.off) return;
        const p = parseDate(d.iso);
        let lbl: string | null = null;
        if (system === 'shamsi') {
          const s = dateToShamsi(p);
          if (s.jd === 1) lbl = `${SHAMSI_MONTHS_SHORT[s.jm - 1]}${s.jm === 1 ? ` ${s.jy}` : ''}`;
        } else if (p.getDate() === 1) {
          lbl = p.toLocaleDateString('en-GB', { month: 'short' }) + (p.getMonth() === 0 ? ` ${p.getFullYear()}` : '');
        }
        if (lbl && lbl !== lastLabel) { c.label = lbl; lastLabel = lbl; }
      });
    });

    const startIso = isoDate(ws);
    let activeDays = 0;
    let bestIso = '';
    let bestVal = 0;
    Object.keys(minutesByDay).forEach((d) => {
      if (d < startIso || d > endIso) return;
      const v = minutesByDay[d];
      if (v > 0) activeDays += 1;
      if (v > bestVal) { bestVal = v; bestIso = d; }
    });
    return { weeks, cols, startIso, endIso, activeDays, bestIso, bestVal };
  }, [effectiveFrom, effectiveTo, system, minutesByDay]);

  const cgWeekdayLabels = system === 'shamsi' ? SHAMSI_WEEKDAYS_SHORT : GREG_WD;

  /* ----- weekday distribution (avg minutes per weekday) ----- */
  const weekdayAgg = useMemo(() => {
    if (allDays.length < 7) return null;
    const totals = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    allDays.forEach((iso) => {
      const i = weekdayIndex(parseDate(iso), system);
      totals[i] += minutesByDay[iso] || 0;
      counts[i] += 1;
    });
    const avgs = totals.map((t, i) => (counts[i] ? t / counts[i] : 0));
    const maxAvg = Math.max(1, ...avgs);
    let weakIdx = -1;
    let strongIdx = -1;
    avgs.forEach((v, i) => {
      if (counts[i] === 0) return;
      if (weakIdx < 0 || v < avgs[weakIdx]) weakIdx = i;
      if (strongIdx < 0 || v > avgs[strongIdx]) strongIdx = i;
    });
    const labels = system === 'shamsi' ? SHAMSI_WEEKDAYS_SHORT : GREG_WD;
    return { avgs, maxAvg, weakIdx, strongIdx, labels, hasData: avgs[strongIdx] > 0 };
  }, [allDays, system, minutesByDay]);

  /* ----- habits completion in range ----- */
  const habitRows: HabitRow[] = useMemo(() => {
    if (!habits.length) return [];
    let effFrom = from;
    if (isAllTime) {
      const dates: string[] = [];
      habits.forEach((h) => {
        if (h.createdAt) dates.push(h.createdAt.slice(0, 10));
        Object.keys(h.log).forEach((d) => dates.push(d));
      });
      dates.sort();
      effFrom = dates[0] || todayStr();
    }
    const t = todayStr();
    const effTo = to === '9999-12-31' ? t : (to > t ? t : to);

    return habits.map((h) => {
      const loggedDays = Object.keys(h.log).filter((d) => h.log[d] && d >= effFrom && d <= effTo);
      let pct = 0;
      let denom = 1;
      let unit = 'days';
      if (h.cadence === 'daily') {
        denom = Math.max(1, countDaysBetween(effFrom, effTo));
        pct = Math.min(100, Math.round((100 * loggedDays.length) / denom));
      } else {
        const weeks = new Set<string>();
        let cur = parseDate(effFrom);
        const endD = parseDate(effTo);
        let guard = 0;
        while (cur <= endD && guard < 3000) {
          weeks.add(weekStartIso(cur, system));
          cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
          guard += 1;
        }
        const doneWeeks = new Set(loggedDays.map((d) => weekStartIso(parseDate(d), system)));
        denom = Math.max(1, weeks.size);
        pct = Math.min(100, Math.round((100 * doneWeeks.size) / denom));
        unit = 'weeks';
      }
      return { habit: h, pct, done: loggedDays.length, denom, unit };
    });
  }, [habits, from, to, isAllTime, system]);

  /* ----- focus vs reading split ----- */
  const splitStats = useMemo(() => {
    const logged = rangeStats.totalLogged;
    const reading = readingMinutes;
    const total = logged + reading;
    const readPct = total > 0 ? Math.round((100 * reading) / total) : 0;
    const max = Math.max(logged, reading, 1);
    return { logged, reading, total, readPct, max };
  }, [rangeStats.totalLogged, readingMinutes]);

  /* ----- insight cards (only the ones that apply) ----- */
  const insights: Insight[] = useMemo(() => {
    const out: Insight[] = [];
    if (statDays >= 7 && rangeStats.zeroDays > 0 && rangeStats.activeDays > 0) {
      const heavy = rangeStats.zeroDays > statDays * 0.4;
      out.push({
        icon: CalendarX,
        tone: heavy ? 'bad' : 'warn',
        text: `${rangeStats.zeroDays} zero day${rangeStats.zeroDays === 1 ? '' : 's'} in range`,
        sub: `${rangeStats.activeDays} of ${statDays} days had activity`,
      });
    }
    if (statDays >= 3 && rangeStats.totalProductive > 0 && rangeStats.avgPerDay < capacity) {
      out.push({
        icon: Gauge,
        tone: 'warn',
        text: `Avg ${fmtDuration(rangeStats.avgPerDay)} / day`,
        sub: `below your ${fmtDuration(capacity)} daily capacity`,
      });
    }
    if (splitStats.total > 0 && splitStats.readPct >= 50) {
      out.push({
        icon: BookOpen,
        tone: 'warn',
        text: `${splitStats.readPct}% of time went to reading`,
        sub: `${fmtDuration(splitStats.logged)} logged vs ${fmtDuration(splitStats.reading)} reading`,
      });
    }
    if (
      weekdayAgg && weekdayAgg.hasData && weekdayAgg.weakIdx !== weekdayAgg.strongIdx &&
      weekdayAgg.avgs[weekdayAgg.weakIdx] < weekdayAgg.avgs[weekdayAgg.strongIdx] * 0.5
    ) {
      out.push({
        icon: TrendingDown,
        tone: 'bad',
        text: `${weekdayAgg.labels[weekdayAgg.weakIdx]} is your weakest day`,
        sub: `avg ${fmtDuration(weekdayAgg.avgs[weekdayAgg.weakIdx])} vs ${fmtDuration(weekdayAgg.avgs[weekdayAgg.strongIdx])} on ${weekdayAgg.labels[weekdayAgg.strongIdx]}`,
      });
    }
    if (rangeStats.bestRun >= 3) {
      out.push({
        icon: Flame,
        tone: 'good',
        text: `Best streak: ${rangeStats.bestRun} days`,
        sub: currentStreak > 0
          ? `current streak: ${currentStreak} day${currentStreak === 1 ? '' : 's'}`
          : 'streak is broken — restart it today',
      });
    }
    if (habitRows.length > 0 && statDays >= 7) {
      const avgPct = Math.round(habitRows.reduce((s, r) => s + r.pct, 0) / habitRows.length);
      if (avgPct > 0 && avgPct < 50) {
        out.push({
          icon: Repeat,
          tone: 'warn',
          text: `Habits at ${avgPct}% in range`,
          sub: `${habitRows.filter((r) => r.pct < 50).length} of ${habitRows.length} below half`,
        });
      }
    }
    return out.slice(0, 4);
  }, [statDays, rangeStats, capacity, splitStats, weekdayAgg, habitRows, currentStreak]);

  /* ----- range meta line (readable label + both calendars) ----- */
  const rangeDates = useMemo(() => {
    if (isAllTime) return { primary: 'Since first activity', alt: '' };
    const fmtP = (iso: string) => (system === 'shamsi' ? shamsiShort(iso) : gregShort(iso));
    const fmtA = (iso: string) => (system === 'shamsi' ? gregShort(iso) : shamsiShort(iso));
    const primary = from === to ? fmtP(from) : `${fmtP(from)} – ${fmtP(to)}`;
    const alt = from === to ? fmtA(from) : `${fmtA(from)} – ${fmtA(to)}`;
    return { primary, alt };
  }, [isAllTime, from, to, system]);

  /* ----- v4: files on track (deadline && unfinished) ----- */
  const trackedFiles = files.filter((f) => !f.archived && !!f.deadline && wbFileProgress(f) < 100);
  const fileRisk = trackedFiles.filter((f) => {
    const st = wbFileDeadlineStatus(f);
    return st === 'over' || st === 'soon';
  }).length;

  /* ----- v4: top reading files (minutes in range + at-risk not started) ----- */
  const readingRows = useMemo(() => {
    const mins: Record<string, number> = {};
    readingSessions
      .filter((r) => r.date >= from && r.date <= to)
      .forEach((r) => {
        mins[r.fileId] = (mins[r.fileId] || 0) + r.minutes;
      });
    const live = files.filter((f) => !f.archived);
    const read = live
      .filter((f) => (mins[f.id] || 0) > 0)
      .sort((a, b) => (mins[b.id] || 0) - (mins[a.id] || 0))
      .slice(0, 8)
      .map((f) => ({ file: f, minutes: mins[f.id], notStarted: false }));
    const readIds = new Set(read.map((r) => r.file.id));
    const atRisk = live
      .filter((f) => !readIds.has(f.id))
      .filter((f) => {
        const st = wbFileDeadlineStatus(f);
        return st === 'over' || st === 'soon';
      })
      .slice(0, 3)
      .map((f) => ({ file: f, minutes: 0, notStarted: true }));
    return [...read, ...atRisk];
  }, [files, readingSessions, from, to]);
  const maxReadMin = Math.max(1, ...readingRows.map((r) => r.minutes));
  const showTopFiles = (readingSessions.length > 0 || files.length > 0) && readingRows.length > 0;

  /* ----- v4: goals & linked files ----- */
  const goalRows = useMemo(() => {
    const pct = (i: Item) => computeProgress(i, (id) => wbChildren(items, id));
    return items
      .filter((g) => g.type === 'goal' && g.status !== 'archived' && pct(g) < 100)
      .sort((a, b) => (a.deadline || '9999-12-31').localeCompare(b.deadline || '9999-12-31'))
      .slice(0, 10)
      .map((g) => {
        const ids = new Set<string>(g.fileIds || []);
        wbChildren(items, g.id).forEach((c) => (c.fileIds || []).forEach((id) => ids.add(id)));
        const linked = [...ids]
          .map((id) => files.find((f) => f.id === id))
          .filter((f): f is ResourceFile => !!f);
        return {
          goal: g,
          pct: pct(g),
          fileCount: linked.length,
          filesPct: linked.length
            ? Math.round(linked.reduce((s, f) => s + wbFileProgress(f), 0) / linked.length)
            : null,
        };
      });
  }, [items, files]);

  /* ----- v4: planner adherence (timeboxes + reading blocks planned vs done) ----- */
  const planned = useMemo(() => {
    const tboxes = items.filter((i) => {
      if (!i.plannedStart) return false;
      const d = i.plannedStart.slice(0, 10);
      return d >= from && d <= to;
    });
    const tboxDone = tboxes.filter((i) => i.status === 'done').length;
    const fblocks = filePlans.filter((p) => p.date >= from && p.date <= to);
    const fblockDone = fblocks.filter((p) => p.done).length;
    const blocks = tboxes.length + fblocks.length;
    return {
      tboxCount: tboxes.length,
      tboxDone,
      fblockCount: fblocks.length,
      fblockDone,
      blocks,
      minutes:
        tboxes.reduce((s, i) => s + timeboxMinutes(i), 0) + fblocks.reduce((s, p) => s + p.minutes, 0),
      adherence: blocks ? Math.round((100 * (tboxDone + fblockDone)) / blocks) : 0,
    };
  }, [items, filePlans, from, to]);
  const adherenceColor =
    planned.adherence >= 60 ? 'var(--pine)' : planned.adherence >= 30 ? 'var(--amber)' : 'var(--coral)';

  /* ----- v4: roadmaps ----- */
  const roadmapRows = useMemo(
    () => roadmaps.map((rm) => ({ rm, pct: roadmapProgress(rm, items, files) })),
    [roadmaps, items, files]
  );

  const today = todayStr();

  return (
    <div className="fade-in report-print-root">
      {/* print-only report header (data-driven) */}
      <div className="report-print-head">
        <div className="rph-app">Workbench Aurora</div>
        <div className="rph-title">Productivity report</div>
        <div className="rph-meta">
          {rangeLabel(range)} · {rangeDates.primary}{rangeDates.alt ? ` · ${rangeDates.alt}` : ''}
        </div>
        <div className="rph-gen">
          Generated {gregShort(today)} · {formatShamsi(dateToShamsi(new Date()))}
        </div>
      </div>

      {/* range summary line — readable label + both calendars */}
      <div className="report-meta">
        <span className="rm-label"><CalendarRange size={15} /> {rangeLabel(range)}</span>
        <span className="rm-dates">
          <span className="rm-primary">{rangeDates.primary}</span>
          {rangeDates.alt && <span className="rm-alt">{rangeDates.alt}</span>}
        </span>
        <span className="rm-extra">
          {statDays} day{statDays === 1 ? '' : 's'} · {fmtDuration(rangeStats.totalProductive)} tracked
        </span>
      </div>

      {/* KPI cards */}
      <div className="grid-cards">
        <div className="stat-card">
          <div className="stat-label">Total logged</div>
          <div className="stat-value">{fmtDuration(rangeStats.totalLogged)}</div>
          <div className="stat-note">{fmtDuration(rangeStats.totalProductive)} incl. reading</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Entries</div>
          <div className="stat-value">{scoped.length}</div>
          <div className="stat-note">
            {scoped.length ? `avg ${fmtDuration(rangeStats.totalLogged / scoped.length)} per entry` : 'none in range'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active days</div>
          <div className="stat-value">{rangeStats.activeDays}</div>
          <div className="stat-note">of {statDays} day{statDays === 1 ? '' : 's'} in range</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg / day</div>
          <div className="stat-value">{fmtDuration(rangeStats.avgPerDay)}</div>
          <div className="stat-note">logged + reading · capacity {fmtDuration(capacity)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Current streak</div>
          <div className="stat-value">{currentStreak} day{currentStreak === 1 ? '' : 's'}</div>
          <div className="stat-note">best run in range: {rangeStats.bestRun} day{rangeStats.bestRun === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Best day</div>
          <div className="stat-value">{rangeStats.bestVal ? fmtDuration(rangeStats.bestVal) : '—'}</div>
          <div className="stat-note">{rangeStats.bestIso ? fmtDateNice(rangeStats.bestIso) : 'no activity yet'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Reading time</div>
          <div className="stat-value">{fmtDuration(readingMinutes)}</div>
          <div className="stat-note">{readingPages} pages read in range</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Files on track</div>
          <div className="stat-value" style={{ color: fileRisk > 0 ? 'var(--coral)' : undefined }}>{fileRisk}</div>
          <div className="stat-note">
            {trackedFiles.length ? `${fileRisk} of ${trackedFiles.length} with deadlines` : 'No files with deadlines'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">All-time focus</div>
          <div className="stat-value" title="Pomodoro work phases completed">{stats.focusSessions} sessions</div>
          <div className="stat-note">{fmtDuration(stats.focusMinutes)} in focus sessions</div>
        </div>
      </div>

      {/* insight cards — dynamic, only when data supports them */}
      {insights.length > 0 && (
        <>
          <div className="section-title st-ico"><Sparkles size={14} /> Insights</div>
          <div className="insight-row">
            {insights.map((ins, i) => {
              const Ico = ins.icon;
              return (
                <div key={i} className={`insight-chip tone-${ins.tone}`}>
                  <span className="insight-ico"><Ico size={16} /></span>
                  <span>
                    <span className="insight-text">{ins.text}</span>
                    <span className="insight-sub">{ins.sub}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* focus vs reading */}
      <div className="section-title st-ico"><Activity size={14} /> Focus vs reading</div>
      <div className="card">
        <div className="bar-row">
          <div className="bar-name">Logged time</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(splitStats.logged / splitStats.max) * 100}%`, background: 'linear-gradient(90deg, var(--pine), var(--pine-dark))' }}
            />
          </div>
          <div className="bar-value">{fmtDuration(splitStats.logged)}</div>
        </div>
        <div className="bar-row">
          <div className="bar-name">Reading time</div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(splitStats.reading / splitStats.max) * 100}%`, background: 'linear-gradient(90deg, var(--violet), color-mix(in srgb, var(--violet) 70%, #000))' }}
            />
          </div>
          <div className="bar-value">{fmtDuration(splitStats.reading)}</div>
        </div>
        <div className="split-note">
          {splitStats.total > 0 ? (
            <>Reading is <b>{splitStats.readPct}%</b> of your tracked time in this range ({fmtDuration(splitStats.total)} total).</>
          ) : (
            'No tracked time in this range.'
          )}
        </div>
      </div>

      {/* contribution graph */}
      <div className="section-title st-ico"><Flame size={14} /> Contribution</div>
      <div className="card">
        <div className="cg-scroll">
          <div className="contribution-wrap">
            <div className="cg-months" aria-hidden="true">
              {contribution.cols.map((c, i) => (
                <span key={i} className="cg-month-lbl">{c.label || ''}</span>
              ))}
            </div>
            <div className="cg-main">
              <div className="cg-weekdays" aria-hidden="true">
                {cgWeekdayLabels.map((w) => <span key={w}>{w}</span>)}
              </div>
              <div
                className="contribution-grid"
                role="img"
                aria-label={`Daily activity heatmap over the last ${contribution.weeks} weeks`}
              >
                {contribution.cols.map((c) => c.days.map((d) => (
                  <span
                    key={d.iso}
                    className={`cg-cell l${cgLevel(d.minutes)}${d.off ? ' off' : ''}`}
                    title={
                      d.off
                        ? undefined
                        : `${weekdayShort(parseDate(d.iso), system)} ${dualDate(d.iso, system)} · ${d.minutes > 0 ? fmtDuration(d.minutes) : 'no activity'}`
                    }
                  />
                )))}
              </div>
            </div>
          </div>
        </div>
        <div className="cg-footer">
          <div className="cg-legend">
            <span>Less</span>
            <span className="cg-cell l0" />
            <span className="cg-cell l1" />
            <span className="cg-cell l2" />
            <span className="cg-cell l3" />
            <span className="cg-cell l4" />
            <span>More</span>
          </div>
          <div className="cg-summary">
            <span className="cg-sum"><Flame size={13} /> <b>{currentStreak}</b> day streak</span>
            {contribution.bestIso && (
              <span className="cg-sum">
                Best day <b>{fmtDuration(contribution.bestVal)}</b> · {dualDate(contribution.bestIso, system)}
              </span>
            )}
            <span className="cg-sum"><b>{contribution.activeDays}</b> active days</span>
          </div>
        </div>
      </div>

      {/* yearly view — by month */}
      {monthRows && monthRows.length > 0 && (
        <>
          <div className="section-title st-ico"><CalendarDays size={14} /> By month</div>
          <div className="card">
            <div className="monthchart">
              {monthRows.map((mo) => {
                const hLog = Math.max(2, Math.round((mo.logged / maxMonthMin) * 100));
                const hRead = Math.max(2, Math.round((mo.reading / maxMonthMin) * 100));
                return (
                  <div
                    key={mo.key}
                    className="monthchart-col"
                    title={`${mo.full}: ${fmtDuration(mo.logged)} logged · ${fmtDuration(mo.reading)} reading`}
                  >
                    <div className="monthchart-bars">
                      <div className="mc-bar" style={{ height: `${hLog}%`, opacity: mo.logged ? 1 : 0.25 }} />
                      <div className="mc-bar read" style={{ height: `${hRead}%`, opacity: mo.reading ? 1 : 0.25 }} />
                    </div>
                    <div className="monthchart-lbl">{mo.label}</div>
                    {mo.yearLabel && <div className="daychart-sub">{mo.yearLabel}</div>}
                  </div>
                );
              })}
            </div>
            <div className="mc-legend">
              <span className="lg"><span className="mc-dot" style={{ background: 'var(--pine)' }} /> Logged minutes</span>
              <span className="lg"><span className="mc-dot" style={{ background: 'var(--violet)' }} /> Reading minutes</span>
            </div>
            <div style={{ marginTop: 14 }}>
              {monthRows.map((mo) => (
                <div key={`${mo.key}-row`} style={{ marginBottom: 10 }}>
                  <div className="bar-row" style={{ marginBottom: 3 }}>
                    <div className="bar-name">{mo.full}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(mo.logged / maxMonthMin) * 100}%` }} />
                    </div>
                    <div className="bar-value">{fmtDuration(mo.logged)}</div>
                  </div>
                  <div className="goal-meta">
                    <span>reading {fmtDuration(mo.reading)}</span>
                    <span>· {mo.entryCount} {mo.entryCount === 1 ? 'entry' : 'entries'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* by day / by week */}
      {allDays.length > 1 && (
        <>
          <div className="section-title st-ico"><BarChart3 size={14} /> {dayChartData.weekly ? 'By week' : 'By day'}</div>
          <div className="card">
            <div className="daychart">
              {dayChartData.points.map((p) => {
                const h = Math.max(2, Math.round((p.minutes / maxDayMin) * 100));
                return (
                  <div key={p.key} className="daychart-col" title={`${p.tip}: ${fmtDuration(p.minutes)}`}>
                    <div className="daychart-bar" style={{ height: `${h}%`, opacity: p.minutes ? 1 : 0.25 }} />
                    <div className="daychart-lbl">{p.label}</div>
                    {p.sub && <div className="daychart-sub">{p.sub}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* reading by day / week */}
      {allDays.length > 1 && readingSessions.length > 0 && (
        <>
          <div className="section-title st-ico"><BookOpen size={14} /> Reading by {dayChartData.weekly ? 'week' : 'day'}</div>
          <div className="card">
            <div className="daychart">
              {dayChartData.points.map((p) => {
                const h = Math.max(2, Math.round((p.reading / maxReadingDay) * 100));
                return (
                  <div key={p.key} className="daychart-col" title={`${p.tip}: ${fmtDuration(p.reading)} reading`}>
                    <div
                      className="daychart-bar"
                      style={{
                        height: `${h}%`,
                        opacity: p.reading ? 1 : 0.25,
                        background: 'linear-gradient(180deg, var(--violet), color-mix(in srgb, var(--violet) 70%, #000))',
                      }}
                    />
                    <div className="daychart-lbl">{p.label}</div>
                    {p.sub && <div className="daychart-sub">{p.sub}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* weekday distribution */}
      {weekdayAgg && (
        <>
          <div className="section-title st-ico"><CalendarDays size={14} /> Weekday distribution</div>
          <div className="card">
            {weekdayAgg.avgs.map((v, i) => {
              const weak = weekdayAgg.hasData && i === weekdayAgg.weakIdx && weekdayAgg.weakIdx !== weekdayAgg.strongIdx;
              return (
                <div key={i} className="bar-row">
                  <div className="bar-name">{weekdayAgg.labels[i]}</div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${(v / weekdayAgg.maxAvg) * 100}%`,
                        background: weak
                          ? 'linear-gradient(90deg, var(--coral), color-mix(in srgb, var(--coral) 70%, #000))'
                          : 'linear-gradient(90deg, var(--pine), var(--pine-dark))',
                      }}
                    />
                  </div>
                  <div className="bar-value">{fmtDuration(v)}</div>
                </div>
              );
            })}
            <div className="goal-meta" style={{ marginTop: 2 }}>
              Average productive minutes per weekday
              {weekdayAgg.hasData && weekdayAgg.weakIdx !== weekdayAgg.strongIdx
                ? ` — ${weekdayAgg.labels[weekdayAgg.weakIdx]} is your weakest day`
                : ''}
              .
            </div>
          </div>
        </>
      )}

      {/* habits in range */}
      {habitRows.length > 0 && (
        <>
          <div className="section-title st-ico"><Repeat size={14} /> Habits in range</div>
          <div className="card">
            {habitRows.map(({ habit: h, pct, done, denom, unit }) => (
              <div key={h.id} style={{ marginBottom: 12 }}>
                <div className="bar-row" style={{ marginBottom: 3 }}>
                  <div className="bar-name">{h.name}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: h.color || 'var(--pine)' }} />
                  </div>
                  <div className="bar-value">{pct}%</div>
                </div>
                <div className="goal-meta">
                  <span className="mono">{done}/{denom} {unit} · {h.cadence}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showTopFiles && (
        <>
          <div className="section-title st-ico"><BookOpen size={14} /> Top reading files</div>
          <div className="card">
            {readingRows.map(({ file: f, minutes, notStarted }) => {
              const st = wbFileDeadlineStatus(f);
              return (
                <div key={f.id} style={{ marginBottom: 12 }}>
                  <div className="bar-row" style={{ marginBottom: 3 }}>
                    <div className="bar-name">{f.title}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${(minutes / maxReadMin) * 100}%`, background: 'var(--violet)' }}
                      />
                    </div>
                    <div className="bar-value">{fmtDuration(minutes)}</div>
                  </div>
                  <div className="goal-meta">
                    <span className="mono">
                      {wbFileReadPages(f)}/{f.pageCount} pages · {wbFileProgress(f)}% · avg {wbFileAvgSecPerPage(f)}s/page
                    </span>
                    {notStarted && <span className="chip chip-ok">not started</span>}
                    {st && (
                      <span className={`chip chip-${st}`}>
                        {st === 'over' ? 'overdue' : st === 'soon' ? 'due soon' : 'on track'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="section-title st-ico"><Tags size={14} /> By label</div>
      <div className="card">
        {byLabel.length ? (
          byLabel.map(([lid, min]) => {
            const l = labels.find((x) => x.id === lid);
            return (
              <div key={lid} className="bar-row">
                <div className="bar-name">{l ? l.name : 'Untagged'}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(min / maxLabelMin) * 100}%`, background: l ? l.color : '#94A3B8' }}
                  />
                </div>
                <div className="bar-value">{fmtDuration(min)}</div>
              </div>
            );
          })
        ) : (
          <div style={{ color: 'var(--faint)', fontSize: 12.5 }}>No entries in this range.</div>
        )}
      </div>

      {byItem.length > 0 && (
        <>
          <div className="section-title st-ico"><ListChecks size={14} /> By item</div>
          <div className="card">
            {byItem.map(([iid, min]) => {
              const it = items.find((x) => x.id === iid);
              if (!it) return null;
              return (
                <div key={iid} className="bar-row">
                  <div className="bar-name">{it.title}</div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(min / maxItemMin) * 100}%`, background: it.color || 'var(--pine)' }}
                    />
                  </div>
                  <div className="bar-value">{fmtDuration(min)}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {goalRows.length > 0 && (
        <>
          <div className="section-title st-ico"><Target size={14} /> Goals & linked files</div>
          <div className="card">
            {goalRows.map(({ goal: g, pct: p, fileCount, filesPct }) => (
              <div key={g.id} style={{ marginBottom: 12 }}>
                <div className="bar-row" style={{ marginBottom: 3 }}>
                  <div className="bar-name">{g.title}</div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${p}%`, background: g.color || 'var(--pine)' }}
                    />
                  </div>
                  <div className="bar-value">{p}%</div>
                </div>
                <div className="goal-meta">
                  {fileCount > 0
                    ? `${fileCount} linked file${fileCount === 1 ? '' : 's'} · files ${filesPct}%`
                    : 'No linked files'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {planned.blocks > 0 && (
        <>
          <div className="section-title st-ico"><CalendarCheck size={14} /> Planner adherence</div>
          <div className="grid-cards">
            <div className="stat-card">
              <div className="stat-label">Timeboxes planned</div>
              <div className="stat-value">{planned.tboxCount}</div>
              <div className="stat-note">{planned.tboxDone} done</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Reading blocks planned</div>
              <div className="stat-value">{planned.fblockCount}</div>
              <div className="stat-note">{planned.fblockDone} done</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Adherence</div>
              <div className="stat-value" style={{ color: adherenceColor }}>{planned.adherence}%</div>
              <div className="stat-note">completed of planned blocks</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total planned minutes</div>
              <div className="stat-value">{fmtDuration(planned.minutes)}</div>
              <div className="stat-note">timeboxes + reading blocks</div>
            </div>
          </div>
        </>
      )}

      {roadmapRows.length > 0 && (
        <>
          <div className="section-title st-ico"><Map size={14} /> Roadmaps</div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {roadmapRows.map(({ rm, pct: p }) => (
              <div key={rm.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      fontWeight: 650, fontSize: 13, flex: 1, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {rm.title}
                  </div>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--muted2)' }}>{p}%</span>
                </div>
                <div className="pbar" style={{ marginTop: 6 }}><span style={{ width: `${p}%` }} /></div>
                <div className="goal-meta">
                  <span>
                    {rm.nodes.length} node{rm.nodes.length === 1 ? '' : 's'} · {rm.edges.length} link{rm.edges.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* activity log — merged from the old Log view, expandable */}
      <div className={`wb-collapsible report-log${logOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="wb-coll-head"
          aria-expanded={logOpen}
          onClick={() => setLogOpen((v) => !v)}
        >
          <Clock size={16} />
          <span>Activity log</span>
          <span className="log-count">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
          <ChevronRight size={16} className="chev" />
        </button>
        <div className="wb-coll-body">
          <LogView embedded />
        </div>
      </div>
    </div>
  );
}

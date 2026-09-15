/* ==================== DateField — dual-calendar date picker ====================
   Every date input in the app goes through this component so users always see
   BOTH calendars: the primary grid follows the workspace calendar system
   (Shamsi / Gregorian) and every cell carries the alternate system's day
   number as a tiny sub-label. Handles month navigation, today, and clear. */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import {
  SHAMSI_MONTHS, SHAMSI_MONTHS_SHORT, SHAMSI_WEEKDAYS_SHORT, buildGregorianMonthGrid,
  buildShamsiMonthGrid, dateToShamsi, formatShamsi, gregToShamsi, shamsiToGreg,
  shamsiMonthDays,
} from '@/lib/workbench/shamsi';
import type { CalendarCell } from '@/lib/workbench/shamsi';
import { isoDate, todayStr } from '@/lib/workbench/helpers';
import type { CalendarSystem } from '@/lib/workbench/types';

const GREG_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GREG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Shamsi year/month for a given ISO date. */
function isoToShamsi(iso: string): { jy: number; jm: number } {
  const [y, m, d] = iso.split('-').map(Number);
  const s = gregToShamsi(y, m, d);
  return { jy: s.jy, jm: s.jm };
}

function gregYearMonth(iso: string): { y: number; m: number } {
  const [y, m] = iso.split('-').map(Number);
  return { y, m };
}

function shiftMonth(iso: string, system: CalendarSystem, delta: number): string {
  if (system === 'shamsi') {
    const { jy, jm } = isoToShamsi(iso);
    let ny = jy;
    let nm = jm + delta;
    while (nm > 12) { nm -= 12; ny += 1; }
    while (nm < 1) { nm += 12; ny -= 1; }
    const day = Math.min(iso.split('-').map(Number)[2] || 1, shamsiMonthDays(ny, nm));
    const g = shamsiToGreg(ny, nm, day);
    return isoDate(new Date(g.gy, g.gm - 1, g.gd));
  }
  const { y, m } = gregYearMonth(iso);
  const d0 = iso.split('-').map(Number)[2] || 1;
  const dt = new Date(y, m - 1 + delta, 1);
  const dim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  return isoDate(new Date(dt.getFullYear(), dt.getMonth(), Math.min(d0, dim)));
}

/** Dual-format label for the field button. */
export function dualDateLabel(iso: string, system: CalendarSystem): { primary: string; alt: string } {
  if (!iso) return { primary: '', alt: '' };
  const [y, m, d] = iso.split('-').map(Number);
  if (system === 'shamsi') {
    const s = gregToShamsi(y, m, d);
    return {
      primary: `${formatShamsi(s)} (${SHAMSI_WEEKDAYS_SHORT[(new Date(y, m - 1, d).getDay() + 1) % 7]})`,
      alt: new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    };
  }
  const s = gregToShamsi(y, m, d);
  return {
    primary: new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
    alt: `${formatShamsi(s, true)}`,
  };
}

export function DateField({
  value,
  onChange,
  id,
  label,
  allowClear = true,
  placeholder = 'Set date',
  compact = false,
  minIso,
  maxIso,
}: {
  value: string; // '' | yyyy-mm-dd
  onChange: (iso: string) => void;
  id?: string;
  label?: string;
  allowClear?: boolean;
  placeholder?: string;
  compact?: boolean;
  minIso?: string;
  maxIso?: string;
}) {
  const system = useWB((s) => s.calendarSystem);
  const [open, setOpen] = useState(false);
  const [viewIso, setViewIso] = useState<string>(() => value || todayStr()); // any date inside the viewed month
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  /* ---- popover position (fixed, viewport clamped) — set at open time ---- */
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    /* compute view month + popover position at open time (no effect-driven setState) */
    setViewIso(value || todayStr());
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const W = 288;
      const H = 360;
      let left = rect.left;
      if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8);
      let top = rect.bottom + 6;
      if (top + H > window.innerHeight - 8) top = Math.max(8, rect.top - H - 6);
      setPos({ top, left });
    }
    setOpen(true);
  }, [open, value]);

  /* click-outside + Esc */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  /* ---- build grid ---- */
  const cells: CalendarCell[] =
    system === 'shamsi'
      ? (() => {
        const { jy, jm } = isoToShamsi(viewIso);
        return buildShamsiMonthGrid(jy, jm);
      })()
      : (() => {
        const { y, m } = gregYearMonth(viewIso);
        return buildGregorianMonthGrid(y, m);
      })();

  const { jy, jm } = isoToShamsi(viewIso);
  const { y: gy, m: gm } = gregYearMonth(viewIso);
  const monthTitle =
    system === 'shamsi'
      ? `${SHAMSI_MONTHS[jm - 1]} ${jy}`
      : `${GREG_MONTHS[gm - 1]} ${gy}`;
  /* the month range expressed in the alternate calendar */
  const altRange = (() => {
    if (system === 'shamsi') {
      const a = shamsiToGreg(jy, jm, 1);
      const b = shamsiToGreg(jy, jm, shamsiMonthDays(jy, jm));
      const sameMonth = a.gm === b.gm;
      const aLbl = `${GREG_MONTHS[a.gm - 1].slice(0, 3)} ${a.gy}`;
      const bLbl = `${GREG_MONTHS[b.gm - 1].slice(0, 3)} ${b.gy}`;
      return sameMonth ? aLbl : `${aLbl} – ${bLbl}`;
    }
    const firstG = buildShamsiMonthGrid(jy, jm).find((c) => c.inMonth);
    const daysInMonth = new Date(gy, gm, 0).getDate();
    const lastS = dateToShamsi(new Date(gy, gm - 1, daysInMonth));
    const firstS = firstG ? firstG.shamsi : dateToShamsi(new Date(gy, gm - 1, 1));
    const aLbl = `${SHAMSI_MONTHS_SHORT[firstS.jm - 1]} ${firstS.jy}`;
    const bLbl = `${SHAMSI_MONTHS_SHORT[lastS.jm - 1]} ${lastS.jy}`;
    return firstS.jy === lastS.jy && firstS.jm === lastS.jm ? aLbl : `${aLbl} – ${bLbl}`;
  })();

  const weekdayLabels = system === 'shamsi' ? SHAMSI_WEEKDAYS_SHORT : GREG_WEEKDAYS;
  const today = todayStr();
  const dual = dualDateLabel(value, system);

  const pick = useCallback(
    (iso: string) => {
      if (minIso && iso < minIso) return;
      if (maxIso && iso > maxIso) return;
      onChange(iso);
      setOpen(false);
    },
    [onChange, minIso, maxIso]
  );

  return (
    <div className={`df-field ${compact ? 'df-compact' : ''}`}>
      {label && <label htmlFor={id ? `${id}-btn` : undefined} className="df-label">{label}</label>}
      <button
        ref={btnRef}
        id={id ? `${id}-btn` : undefined}
        type="button"
        className={`df-btn ${value ? 'has-value' : ''}`}
        onClick={() => toggle()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? `${label} — ${dual.primary || 'no date set'}` : dual.primary || 'pick date'}
      >
        <CalendarDays size={15} className="df-ico" />
        {value ? (
          <span className="df-btn-text">
            <span className="df-primary">{dual.primary}</span>
            <span className="df-alt">{dual.alt}</span>
          </span>
        ) : (
          <span className="df-btn-text"><span className="df-primary df-empty">{placeholder}</span></span>
        )}
        {allowClear && value && (
          <span
            className="df-clear"
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }
            }}
          >
            <X size={13} />
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="df-pop" ref={popRef} role="dialog" aria-label="Pick a date" style={{ top: pos.top, left: pos.left }}>
            <div className="df-head">
              <button type="button" className="df-nav" aria-label="Previous month" onClick={() => setViewIso(shiftMonth(viewIso, system, -1))}>
                <ChevronLeft size={15} />
              </button>
              <div className="df-month">
                <div className="df-month-name">{monthTitle}</div>
                <div className="df-month-alt">{altRange}</div>
              </div>
              <button type="button" className="df-nav" aria-label="Next month" onClick={() => setViewIso(shiftMonth(viewIso, system, 1))}>
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="df-week">
              {weekdayLabels.map((w) => (
                <span key={w} className="df-wd">{w}</span>
              ))}
            </div>

            <div className="df-grid">
              {cells.map((c, i) => {
                if (!c.iso) return <span key={`e${i}`} className="df-cell df-empty-cell" />;
                const selected = c.iso === value;
                const isToday = c.iso === today;
                const disabled = (!!minIso && c.iso < minIso) || (!!maxIso && c.iso > maxIso);
                const alt =
                  system === 'shamsi'
                    ? c.date.getDate()
                    : `${SHAMSI_MONTHS_SHORT[c.shamsi.jm - 1]} ${c.shamsi.jd}`;
                return (
                  <button
                    key={c.iso}
                    type="button"
                    className={`df-cell ${c.inMonth ? '' : 'out'} ${selected ? 'sel' : ''} ${isToday ? 'today' : ''} ${disabled ? 'dis' : ''}`}
                    onClick={() => pick(c.iso)}
                    disabled={disabled}
                    aria-pressed={selected}
                    aria-label={c.iso}
                  >
                    <span className="df-day">
                      {system === 'shamsi' ? c.shamsi.jd : c.date.getDate()}
                    </span>
                    <span className="df-alt-day">{alt}</span>
                  </button>
                );
              })}
            </div>

            <div className="df-foot">
              <button type="button" className="df-foot-btn" onClick={() => pick(today)}>
                Today · {dualDateLabel(today, system).alt}
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

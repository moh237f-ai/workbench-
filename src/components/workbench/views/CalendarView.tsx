/* ==================== Calendar View (Gregorian + Shamsi) ==================== */
'use client';

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, Plus, Clock, CalendarClock } from 'lucide-react';
import { useWB, wbChildren, wbTimeboxedItems } from '@/lib/workbench/store';
import { computeProgress, deadlineStatus, fmtDateNice, fmtDuration, todayStr } from '@/lib/workbench/helpers';
import {
  SHAMSI_MONTHS, SHAMSI_WEEKDAYS_SHORT, buildGregorianMonthGrid, buildShamsiMonthGrid, dateToShamsi,
} from '@/lib/workbench/shamsi';
import type { CalendarSystem } from '@/lib/workbench/types';
import { Btn, IconBtn, Seg } from '../ui/primitives';
import { useViewActions } from './viewCtx';

const GREG_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarHeaderActions() {
  const system = useWB((s) => s.calendarSystem);
  const setSystem = useWB((s) => s.setCalendarSystem);
  const setView = useWB((s) => s.setView);
  return (
    <>
      <Seg<CalendarSystem>
        value={system}
        onChange={setSystem}
        options={[
          { id: 'gregorian', label: 'Gregorian' },
          { id: 'shamsi', label: 'شمسی' },
        ]}
      />
      <Btn size="sm" onClick={() => setView('planner')} title="Open the day / week planner">
        <CalendarClock size={14} /> Planner
      </Btn>
    </>
  );
}

export function CalendarView() {
  const items = useWB((s) => s.items);
  const entries = useWB((s) => s.entries);
  const system = useWB((s) => s.calendarSystem);
  const offset = useWB((s) => s.calMonthOffset);
  const calNavigate = useWB((s) => s.calNavigate);
  const calToday = useWB((s) => s.calToday);
  const selectedDate = useWB((s) => s.calendarSelectedDate);
  const selectCalendarDay = useWB((s) => s.selectCalendarDay);
  const { openItemDetail, openDayPlanner, openTimebox } = useViewActions();

  const today = todayStr();

  /* month context */
  const view = useMemo(() => {
    const now = new Date();
    if (system === 'shamsi') {
      let { jy, jm } = dateToShamsi(now);
      const total = jm - 1 + offset;
      jy += Math.floor(total / 12);
      jm = ((total % 12) + 12) % 12 + 1;
      return { jy, jm, gy: 0, gm: 0 };
    }
    let gy = now.getFullYear();
    let gm = now.getMonth();
    const total = gm + offset;
    gy += Math.floor(total / 12);
    gm = ((total % 12) + 12) % 12 + 1 - 1;
    return { jy: 0, jm: 0, gy, gm };
  }, [system, offset]);

  const cells = useMemo(
    () =>
      system === 'shamsi'
        ? buildShamsiMonthGrid(view.jy, view.jm)
        : buildGregorianMonthGrid(view.gy, view.gm),
    [system, view]
  );

  const title =
    system === 'shamsi'
      ? `${SHAMSI_MONTHS[view.jm - 1]} ${view.jy}`
      : new Date(view.gy, view.gm, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const weekdayLabels = system === 'shamsi' ? SHAMSI_WEEKDAYS_SHORT : GREG_WEEKDAYS;

  /* aggregates */
  const entriesByDay: Record<string, typeof entries> = {};
  entries.forEach((e) => {
    (entriesByDay[e.date] = entriesByDay[e.date] || []).push(e);
  });
  const deadlinesByDay: Record<string, typeof items> = {};
  items.forEach((it) => {
    if (it.deadline && it.status !== 'done' && it.status !== 'archived') {
      (deadlinesByDay[it.deadline] = deadlinesByDay[it.deadline] || []).push(it);
    }
  });
  const timeboxesByDay: Record<string, typeof items> = {};
  items.forEach((it) => {
    if (it.plannedStart) {
      const d = it.plannedStart.slice(0, 10);
      (timeboxesByDay[d] = timeboxesByDay[d] || []).push(it);
    }
  });

  const dayTimeboxes = wbTimeboxedItems(items, selectedDate);
  const dayEntries = (entriesByDay[selectedDate] || []).slice().sort((a, b) =>
    (a.startTime || '99:99').localeCompare(b.startTime || '99:99')
  );

  return (
    <div className="fade-in">
      <div className="calendar-shell">
        <div className="calendar-head">
          <div className="calendar-title wb-display">{title}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <IconBtn title="Previous month" onClick={() => calNavigate(-1)}>
              <ChevronLeft />
            </IconBtn>
            <Btn size="sm" onClick={calToday}>
              Today
            </Btn>
            <IconBtn title="Next month" onClick={() => calNavigate(1)}>
              <ChevronRight />
            </IconBtn>
          </div>
        </div>
        <div className="calendar-grid">
          {weekdayLabels.map((w) => (
            <div key={w} className="calendar-weekday">{w}</div>
          ))}
          {cells.map((cell, idx) => {
            if (!cell.iso) {
              return <div key={`e${idx}`} className="calendar-cell muted" style={{ cursor: 'default', background: 'var(--surface-alt)' }} />;
            }
            const dayEntries2 = entriesByDay[cell.iso] || [];
            const dayMin = dayEntries2.reduce((s, e) => s + e.durationMin, 0);
            const dayDeadlines = deadlinesByDay[cell.iso] || [];
            const dayTbx = timeboxesByDay[cell.iso] || [];
            const isToday = cell.iso === today;
            const isSelected = cell.iso === selectedDate;
            const day = system === 'shamsi' ? cell.shamsi.jd : cell.date.getDate();
            return (
              <div
                key={cell.iso}
                className={`calendar-cell ${!cell.inMonth ? 'muted' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                onClick={() => selectCalendarDay(cell.iso)}
                role="button"
                aria-label={`${cell.iso}${dayMin ? `, ${fmtDuration(dayMin)} logged` : ''}`}
              >
                <span className="calendar-day">{day}</span>
                {dayMin > 0 && <span className="calendar-summary">{fmtDuration(dayMin)}</span>}
                {dayTbx.slice(0, 2).map((it) => (
                  <div
                    key={it.id}
                    className="calendar-event timebox"
                    onClick={(e) => {
                      e.stopPropagation();
                      openTimebox(it.id, cell.iso);
                    }}
                    title={`${it.plannedStart?.slice(11, 16)}–${it.plannedEnd?.slice(11, 16)} ${it.title}`}
                  >
                    <span className="tbx-time">{it.plannedStart?.slice(11, 16)}</span>
                    {it.title}
                  </div>
                ))}
                {dayDeadlines.slice(0, 2).map((it) => {
                  const dpct = computeProgress(it, (id) => wbChildren(items, id));
                  const dst = deadlineStatus(it, dpct) ?? 'ok';
                  return (
                    <div
                      key={it.id}
                      className={`calendar-event deadline d-${dst}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openItemDetail(it.id);
                      }}
                      title={`Deadline: ${it.title}`}
                    >
                      {it.title}
                    </div>
                  );
                })}
                {dayDeadlines.length + dayTbx.length > 4 && (
                  <span className="calendar-more">+{dayDeadlines.length + dayTbx.length - 4} more</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Day panel */}
      <div className="screen-grid two-col" style={{ marginTop: 18 }}>
        <div>
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{selectedDate === today ? 'Today' : fmtDateNice(selectedDate)} · timeline</span>
            <Btn size="sm" onClick={() => openDayPlanner(selectedDate)}>
              <Plus size={13} /> Plan day
            </Btn>
          </div>
          <div className="card">
            {dayTimeboxes.length ? (
              dayTimeboxes.map((it) => (
                <div key={it.id} className="timeline-row" onClick={() => openItemDetail(it.id)} role="button">
                  <div className="timeline-time">
                    {it.plannedStart?.slice(11, 16)}
                    <span style={{ color: 'var(--muted2)', fontWeight: 500, marginTop: 3, fontSize: 10 }}>
                      → {it.plannedEnd?.slice(11, 16) || '—'}
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 650, fontSize: 13.5 }}>{it.title}</div>
                    <div className="card-sub" style={{ marginTop: 2 }}>
                      {fmtDuration(it.estimateMin || 30)}
                      {it.nextAction ? ` · ${it.nextAction}` : ''}
                    </div>
                  </div>
                  <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openTimebox(it.id, selectedDate); }}>
                    Edit
                  </Btn>
                </div>
              ))
            ) : (
              <div className="empty-state" style={{ padding: '26px 16px' }}>
                <div className="es-title">No time blocks on this day.</div>
                <div style={{ marginTop: 4, fontSize: 12.5 }}>Timebox tasks to protect your attention.</div>
                <Btn size="sm" variant="primary" onClick={() => openDayPlanner(selectedDate)}>
                  <CalendarDays size={13} /> Plan this day
                </Btn>
              </div>
            )}
          </div>
        </div>
        <div>
          <div className="section-title">Logged that day</div>
          <div className="card">
            {dayEntries.length ? (
              dayEntries.map((e) => (
                <div key={e.id} className="entry-row">
                  <div className="entry-time">{e.startTime || 'manual'}</div>
                  <div className="entry-body">
                    {e.note && <div className="entry-note">{e.note}</div>}
                  </div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted2)', fontWeight: 650 }}>
                    {fmtDuration(e.durationMin)}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state" style={{ padding: '26px 16px' }}>
                <Clock size={22} style={{ color: 'var(--faint)', marginBottom: 8 }} />
                <div className="es-title">Nothing logged.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

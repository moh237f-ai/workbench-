/* ==================== Habits View ==================== */
'use client';

import React from 'react';
import { Check, Flame, Pencil, Plus } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { computeHabitStreak, fmtDateNice, isoDate, todayStr } from '@/lib/workbench/helpers';
import { Btn, IconBtn } from '../ui/primitives';
import { useViewActions } from './viewCtx';

export function HabitsHeaderActions() {
  const { openHabitForm } = useViewActions();
  return (
    <Btn size="sm" variant="primary" onClick={() => openHabitForm(null)}>
      <Plus size={14} /> New habit
    </Btn>
  );
}

export function HabitsView() {
  const habits = useWB((s) => s.habits);
  const toggleHabitDay = useWB((s) => s.toggleHabitDay);
  const { openHabitForm } = useViewActions();

  if (!habits.length) {
    return (
      <div className="empty-state fade-in">
        <div className="es-title">No habits yet</div>
        Build a streak. Start with one small daily habit.
        <div style={{ marginTop: 12 }}>
          <Btn variant="primary" onClick={() => openHabitForm(null)}>
            <Plus size={15} /> New habit
          </Btn>
        </div>
      </div>
    );
  }

  const today = todayStr();

  return (
    <div className="habit-grid fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14 }}>
      {habits.map((h) => {
        const doneToday = !!h.log?.[today];
        const streak = computeHabitStreak(h.log, h.cadence);
        const days: { date: string; done: boolean }[] = [];
        const td = new Date();
        for (let i = 83; i >= 0; i--) {
          const d = new Date(td);
          d.setDate(td.getDate() - i);
          const ds = isoDate(d);
          days.push({ date: ds, done: !!h.log?.[ds] });
        }
        const weeks: typeof days[] = [];
        for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
        const done30 = days.slice(-30).filter((d) => d.done).length;
        const done84 = days.filter((d) => d.done).length;

        return (
          <div key={h.id} className="card habit-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span className="habit-avatar" style={{ background: h.color }}>
                {h.name.slice(0, 1).toUpperCase()}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="wb-display" style={{ fontWeight: 750, fontSize: 16 }}>{h.name}</div>
                {h.description && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.description}
                  </div>
                )}
              </div>
              {streak > 0 && (
                <span className="chip chip-soon">
                  <Flame size={11} /> {streak}{h.cadence === 'weekly' ? 'w' : 'd'}
                </span>
              )}
              <IconBtn small title="Edit habit" onClick={() => openHabitForm(h.id)}>
                <Pencil size={14} />
              </IconBtn>
            </div>

            <Btn
              block
              variant={doneToday ? 'primary' : 'default'}
              style={{ marginBottom: 14 }}
              onClick={() => toggleHabitDay(h.id, today)}
            >
              {doneToday ? <><Check size={15} /> Done today</> : 'Mark done today'}
            </Btn>

            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="chip chip-ok">{done30}/30 days</span>
              <span className="chip chip-ok">{done84}/12 weeks</span>
              <span className="chip chip-ok">{h.cadence}</span>
            </div>

            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 750, color: 'var(--muted2)', marginBottom: 6 }}>
              Last 12 weeks
            </div>
            <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 4 }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {week.map((day) => (
                    <div
                      key={day.date}
                      className="heatmap-cell"
                      style={{ background: day.done ? h.color : 'var(--surface-alt)' }}
                      title={`${fmtDateNice(day.date)}${day.done ? ' · done' : ''}`}
                      onClick={() => toggleHabitDay(h.id, day.date)}
                      role="button"
                      aria-label={`${day.date} ${day.done ? 'done' : 'not done'}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

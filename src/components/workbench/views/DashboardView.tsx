/* ==================== Dashboard View ==================== */
'use client';

import React, { useMemo } from 'react';
import {
  Clock, Target, BarChart3, Repeat, AlertTriangle, Zap, TrendingUp, Lightbulb,
} from 'lucide-react';
import {
  useWB, wbChildren, wbInsights, wbIsBlocked, wbPlannedMinutes,
} from '@/lib/workbench/store';
import {
  computeProgress, daysUntil, deadlineStatus, entriesInRange, fmtDateNice, fmtDuration, isoDate, startOfWeek, todayStr,
} from '@/lib/workbench/helpers';
import { useViewActions } from './viewCtx';

export function DashboardView() {
  const items = useWB((s) => s.items);
  const entries = useWB((s) => s.entries);
  const habits = useWB((s) => s.habits);
  const labels = useWB((s) => s.labels);
  const capacity = useWB((s) => s.dailyCapacityMin);
  const setView = useWB((s) => s.setView);
  const { openItemDetail } = useViewActions();

  const today = todayStr();
  const weekStart = isoDate(startOfWeek(new Date()));
  const todayMin = entriesInRange(entries, today, today).reduce((s, e) => s + e.durationMin, 0);
  const weekMin = entriesInRange(entries, weekStart, today).reduce((s, e) => s + e.durationMin, 0);
  const pct = (i: typeof items[number]) => computeProgress(i, (id) => wbChildren(items, id));

  const activeGoals = items.filter((i) => i.type === 'goal' && pct(i) < 100 && i.status !== 'archived').length;
  const overdue = items.filter((i) => deadlineStatus(i, pct(i)) === 'over');
  const blocked = items.filter((i) => wbIsBlocked(items, i));
  const plannedMin = wbPlannedMinutes(items, today);
  const insights = useMemo(() => wbInsights(items, entries, capacity || 240), [items, entries, capacity]);
  const habitsDone = habits.filter((h) => h.log?.[today]).length;

  const upcoming = items
    .filter((i) => i.deadline && pct(i) < 100 && !['done', 'archived'].includes(i.status))
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 6);

  /* last 7 days chart */
  const days = Array.from({ length: 7 }, (_, k) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - k));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { iso, min: entriesInRange(entries, iso, iso).reduce((s, e) => s + e.durationMin, 0), lbl: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2) };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.min));

  /* label distribution */
  const labelRows = labels
    .map((l) => ({
      l,
      min: entriesInRange(entries, '0000-01-01', '9999-12-31')
        .filter((e) => e.labelIds.includes(l.id))
        .reduce((s, e) => s + e.durationMin, 0),
    }))
    .filter((r) => r.min > 0)
    .sort((a, b) => b.min - a.min)
    .slice(0, 5);
  const maxLabel = Math.max(1, ...labelRows.map((r) => r.min));

  return (
    <div className="fade-in">
      <div className="grid-cards kpi-grid" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
        <div className="stat-card">
          <div className="stat-label">Logged today</div>
          <div className="stat-value">{fmtDuration(todayMin)}</div>
          <div className="stat-note">{fmtDuration(plannedMin)} planned</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">This week</div>
          <div className="stat-value">{fmtDuration(weekMin)}</div>
          <div className="stat-note">since Monday</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active goals</div>
          <div className="stat-value">{activeGoals}</div>
          <div className="stat-note">{items.filter((i) => i.status === 'done').length} done all-time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Needs attention</div>
          <div className="stat-value" style={{ color: overdue.length ? 'var(--coral)' : undefined }}>
            {overdue.length + blocked.length}
          </div>
          <div className="stat-note">{overdue.length} overdue · {blocked.length} blocked</div>
        </div>
      </div>

      <div className="screen-grid two-col">
        <div>
          <div className="section-title">Last 7 days</div>
          <div className="card">
            <div className="daychart" style={{ height: 150 }}>
              {days.map((d) => (
                <div key={d.iso} className="daychart-col" title={`${d.lbl}: ${fmtDuration(d.min)}`}>
                  <div className="daychart-bar" style={{ height: `${Math.max(2, (d.min / maxDay) * 100)}%`, opacity: d.min ? 1 : 0.25 }} />
                  <div className="daychart-lbl">{d.lbl}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="section-title">Upcoming deadlines</div>
          <div className="card">
            {upcoming.length ? (
              upcoming.map((i) => {
                const st = deadlineStatus(i, pct(i));
                const du = daysUntil(i.deadline!);
                const label = st === 'over' ? `${Math.abs(du)}d overdue` : du === 0 ? 'due today' : `in ${du}d`;
                return (
                  <div
                    key={i.id}
                    className="goal-card"
                    style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', padding: '10px 12px' }}
                    onClick={() => openItemDetail(i.id)}
                    role="button"
                  >
                    <span className="goal-dot" style={{ background: i.color || 'var(--pine)' }} />
                    <div className="goal-main">
                      <div className="goal-name" style={{ fontSize: 13 }}>{i.title}</div>
                      <div className="goal-meta">{pct(i)}% · {i.priority.toUpperCase()}</div>
                    </div>
                    <span className={`chip chip-${st}`}>{label}</span>
                  </div>
                );
              })
            ) : (
              <div className="empty-state" style={{ padding: '22px 14px' }}>
                <div className="es-title">No upcoming deadlines.</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-title">Signals</div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {insights.map((msg, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5, color: 'var(--muted2)', lineHeight: 1.5 }}>
                <Lightbulb size={14} style={{ color: 'var(--pine)', flexShrink: 0, marginTop: 2 }} />
                <span>{msg}</span>
              </div>
            ))}
          </div>

          <div className="section-title">Habits today</div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <svg viewBox="0 0 64 64" style={{ width: 64, height: 64, transform: 'rotate(-90deg)' }}>
                <circle cx="32" cy="32" r="27" fill="none" stroke="var(--surface-alt)" strokeWidth="7" />
                <circle
                  cx="32" cy="32" r="27" fill="none" stroke="var(--pine)" strokeWidth="7" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 27 * (habits.length ? habitsDone / habits.length : 0)} ${2 * Math.PI * 27}`}
                />
              </svg>
              <div className="mono" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>
                {habits.length ? Math.round((habitsDone / habits.length) * 100) : 0}%
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <div style={{ fontWeight: 650, fontSize: 13.5 }}>{habitsDone}/{habits.length} done</div>
              <div className="card-sub">{habits.length ? 'Keep the streaks alive.' : 'No habits tracked yet.'}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setView('habits')}>Open habits</button>
          </div>

          {labelRows.length > 0 && (
            <>
              <div className="section-title">Where time goes</div>
              <div className="card">
                {labelRows.map(({ l, min }) => (
                  <div key={l.id} className="bar-row">
                    <div className="bar-name">{l.name}</div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(min / maxLabel) * 100}%`, background: l.color }} />
                    </div>
                    <div className="bar-value">{fmtDuration(min)}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-title">Quick jumps</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => setView('today')}><Zap size={13} /> Today</button>
            <button className="btn btn-sm" onClick={() => setView('goals')}><Target size={13} /> Goals</button>
            <button className="btn btn-sm" onClick={() => setView('log')}><Clock size={13} /> Log</button>
            <button className="btn btn-sm" onClick={() => setView('calendar')}><TrendingUp size={13} /> Calendar</button>
            <button className="btn btn-sm" onClick={() => setView('reports')}><BarChart3 size={13} /> Reports</button>
            <button className="btn btn-sm" onClick={() => setView('habits')}><Repeat size={13} /> Habits</button>
          </div>

          {(overdue.length > 0 || blocked.length > 0) && (
            <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} style={{ color: 'var(--coral)' }} /> Attention
            </div>
          )}
          {overdue.slice(0, 3).map((i) => (
            <div key={i.id} className="chip chip-over" style={{ marginBottom: 6 }}>
              Overdue: {i.title} · {Math.abs(daysUntil(i.deadline!))}d
            </div>
          ))}
          {blocked.slice(0, 3).map((i) => (
            <div key={i.id} className="chip chip-soon" style={{ marginBottom: 6 }}>
              Blocked: {i.title}
            </div>
          ))}
          {upcoming.length > 0 && (
            <div className="field-help" style={{ marginTop: 8 }}>
              Next deadline: {fmtDateNice(upcoming[0].deadline!)} — {upcoming[0].title}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== Today View ==================== */
'use client';

import React from 'react';
import {
  Play, Plus, CalendarDays, Target, Clock, Repeat, BarChart3, Zap, Sparkles, BookOpen,
} from 'lucide-react';
import {
  useWB, wbChildren, wbFilePositionLabel, wbFileProgress, wbFileReadPages, wbIsBlocked, wbPickNextAction, wbPlannedItems, wbPlannedMinutes, wbReadyItems,
} from '@/lib/workbench/store';
import {
  computeProgress, daysUntil, deadlineStatus, entriesInRange, fmtDateNice, fmtDuration, isoDate, startOfWeek, todayStr,
} from '@/lib/workbench/helpers';
import { useFileCover } from '@/lib/workbench/covers';
import { dateToShamsi, formatShamsi } from '@/lib/workbench/shamsi';
import { Btn, toast, useNow } from '../ui/primitives';
import { useViewActions } from './viewCtx';
import { TodayClock } from '../TodayClock';

function ContinueReading() {
  const files = useWB((s) => s.files)
    .filter((f) => !f.archived)
    .filter((f) => {
      const pct = wbFileProgress(f);
      return pct > 0 && pct < 100;
    })
    .sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''))
    .slice(0, 3);
  if (!files.length) return null;
  return (
    <>
      <div className="section-title">Continue reading</div>
      <div className="card" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, marginBottom: 18 }}>
        {files.map((f) => (
          <ReadingMiniCard key={f.id} fileId={f.id} />
        ))}
      </div>
    </>
  );
}

function ReadingMiniCard({ fileId }: { fileId: string }) {
  const file = useWB((s) => s.files.find((f) => f.id === fileId));
  const cover = useFileCover(file);
  if (!file) return null;
  const pct = wbFileProgress(file);
  const pages = wbFileReadPages(file);
  return (
    <div style={{ display: 'flex', gap: 10, minWidth: 250, flex: '0 0 auto', alignItems: 'center' }}>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: file.id }))}
        aria-label={`Resume reading ${file.title}`}
        title={`Resume ${file.title}`}
        style={{
          width: 58, height: 76, borderRadius: 8, overflow: 'hidden', flexShrink: 0,
          border: '1px solid var(--hairline)', background: 'var(--surface-alt)', cursor: 'pointer', padding: 0,
        }}
      >
        {cover ? (
          <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--faint)' }}>
            <BookOpen size={20} />
          </span>
        )}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.title}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted2)', margin: '3px 0 6px' }}>
          {wbFilePositionLabel(file)}{file.kind === 'pdf' ? ` · ${pages} read` : ''}
        </div>
        <div className="pbar sm" style={{ marginBottom: 8 }}>
          <span style={{ width: `${pct}%`, background: 'var(--violet)' }} />
        </div>
        <Btn
          size="sm"
          onClick={() => window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: file.id }))}
        >
          <Play size={13} /> Resume
        </Btn>
      </div>
    </div>
  );
}

export function TodayView() {
  const items = useWB((s) => s.items);
  const entries = useWB((s) => s.entries);
  const habits = useWB((s) => s.habits);
  const files = useWB((s) => s.files);
  const activeTimer = useWB((s) => s.activeTimer);
  const capacity = useWB((s) => s.dailyCapacityMin);
  const startItemFocus = useWB((s) => s.startItemFocus);
  const setFocusOpen = useWB((s) => s.setFocusOpen);
  const updateItem = useWB((s) => s.updateItem);
  const { openItemForm, openDailyPlan, openCapture } = useViewActions();
  const now = useNow();

  const today = todayStr();
  const weekStart = isoDate(startOfWeek(new Date()));
  const todayMin = entriesInRange(entries, today, today).reduce((s, e) => s + e.durationMin, 0);
  const weekMin = entriesInRange(entries, weekStart, today).reduce((s, e) => s + e.durationMin, 0);
  const planned = wbPlannedItems(items, today);
  const plannedMin = wbPlannedMinutes(items, today);
  const cap = capacity || 240;
  const remaining = Math.max(0, cap - plannedMin);
  const next = wbPickNextAction(items);
  const candidates = wbReadyItems(items).filter((i) => i.type === 'task' && !i.startDate).slice(0, 5);
  const upcoming = items
    .filter((i) => i.deadline && computeProgress(i, (id) => wbChildren(items, id)) < 100 && !['done', 'archived'].includes(i.status))
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 5);
  const fileDeadlines = files
    .filter((f) => !f.archived && f.deadline && wbFileProgress(f) < 100)
    .sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))
    .slice(0, 3);
  const todayEntries = entriesInRange(entries, today, today).slice(-6).reverse();
  const habitsDone = habits.filter((h) => h.log?.[today]).length;
  const shamsi = dateToShamsi(now);

  const startNext = () => {
    if (!next) {
      openCapture();
      return;
    }
    const ok = startItemFocus(next.id);
    if (ok) {
      setFocusOpen(true);
      toast('Focus started', next.title);
    } else {
      toast('Cannot start focus', 'A timer is already running.');
    }
  };

  return (
    <div className="fade-in">
      {/* Hero */}
      <div className="hero-card" style={{ marginBottom: 18 }}>
        <div className="hero-row">
          <div style={{ minWidth: 0 }}>
            <div className="hero-label" style={{ marginBottom: 10 }}>Today · {formatShamsi(shamsi)}</div>
            <h2 className="hero-title">
              {planned.length
                ? `${planned.length} task${planned.length === 1 ? ' is' : 's are'} planned.`
                : 'Your next focused hour starts here.'}
            </h2>
            <p style={{ margin: '10px 0 0', color: 'var(--muted2)', fontSize: 14, maxWidth: 560 }}>
              {next ? (
                <>Next: <strong style={{ color: 'var(--ink)' }}>{next.nextAction || next.title}</strong> ·{' '}
                  {fmtDuration(next.estimateMin || 30)} estimated.</>
              ) : (
                'Choose a few tasks before you start — not after.'
              )}
            </p>
            <div className="insight-strip" style={{ marginTop: 18 }}>
              <span className="insight-pill"><Target size={14} /> {fmtDuration(plannedMin)} planned</span>
              <span className="insight-pill"><Clock size={14} /> {fmtDuration(remaining)} left</span>
              <span className="insight-pill"><Repeat size={14} /> {habitsDone}/{habits.length} habits</span>
              <span className="insight-pill"><BarChart3 size={14} /> {fmtDuration(weekMin)} this week</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="hero-metric">
              {planned.length ? `${Math.min(100, Math.round((plannedMin / Math.max(1, cap)) * 100))}%` : `${fmtDuration(cap)}`}
            </div>
            <div className="hero-label">{planned.length ? 'day planned' : 'available today'}</div>
          </div>
        </div>
        <div className="action-bar" style={{ marginTop: 20 }}>
          <Btn variant="primary" onClick={startNext}>
            <Play size={15} /> {activeTimer ? 'Focus running…' : next ? 'Start next' : 'Capture something'}
          </Btn>
          <Btn onClick={openDailyPlan}>
            <CalendarDays size={15} /> Plan today
          </Btn>
          <Btn onClick={() => openItemForm(null)}>
            <Plus size={15} /> New goal
          </Btn>
          <Btn variant="ghost" onClick={openCapture}>
            <Sparkles size={15} /> Quick capture
          </Btn>
        </div>
      </div>

      {/* Live clock + capacity */}
      <div className="screen-grid two-col" style={{ marginBottom: 18 }}>
        <TodayClock />
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-head" style={{ marginBottom: 12 }}>
            <div>
              <div className="card-title">Today&apos;s capacity</div>
              <div className="card-sub">Plan slightly under your real capacity.</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <strong className="mono" style={{ fontSize: 17 }}>{fmtDuration(plannedMin)}</strong>
              <span style={{ color: 'var(--faint)', fontSize: 12 }}> / {fmtDuration(cap)}</span>
            </div>
          </div>
          <div className={`capacity-track ${plannedMin > cap ? 'over' : ''}`}>
            <span style={{ width: `${Math.min(100, (plannedMin / Math.max(1, cap)) * 100)}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--muted2)' }}>
              {remaining > 0 ? `${fmtDuration(remaining)} still available` : 'Capacity full'}
            </span>
            <Btn size="sm" onClick={openDailyPlan}>Adjust plan</Btn>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid-cards kpi-grid" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-label">Logged today</div>
          <div className="stat-value">{fmtDuration(todayMin)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Planned today</div>
          <div className="stat-value">{fmtDuration(plannedMin)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">This week</div>
          <div className="stat-value">{fmtDuration(weekMin)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Habits today</div>
          <div className="stat-value">{habitsDone}/{habits.length}</div>
        </div>
      </div>

      {/* Continue reading */}
      <ContinueReading />

      {/* Plan + candidates */}
      <div className="screen-grid two-col">
        <div>
          <div className="section-title">Today&apos;s plan</div>
          <div className="card">
            {planned.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {planned.map((i) => {
                  const pct = computeProgress(i, (id) => wbChildren(items, id));
                  const blocked = wbIsBlocked(items, i);
                  const st = deadlineStatus(i, pct);
                  const du = i.deadline ? daysUntil(i.deadline) : null;
                  return (
                    <div
                      key={i.id}
                      className="goal-card"
                      onClick={() => useWB.getState().setView('goals')}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="goal-dot" style={{ background: i.color || 'var(--pine)' }} />
                      <div className="goal-main">
                        <div className="goal-name">{i.title}</div>
                        <div className="goal-meta">
                          {i.nextAction || 'Define a next action'} · {fmtDuration(i.estimateMin || 0)}
                          {blocked && <span className="chip chip-over">blocked</span>}
                          {st === 'over' && <span className="chip chip-over">{Math.abs(du || 0)}d overdue</span>}
                          {st === 'soon' && <span className="chip chip-soon">{du === 0 ? 'due today' : `${du}d left`}</span>}
                        </div>
                        <div className="pbar" style={{ marginTop: 8 }}>
                          <span style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="progress-ring-mini" style={{ ['--progress' as string]: pct }} data-label={`${pct}%`} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '34px 18px' }}>
                <div className="es-title">Your day is still open.</div>
                <div style={{ marginTop: 6 }}>Plan 2–4 meaningful tasks before you start.</div>
                <Btn variant="primary" size="sm" onClick={openDailyPlan}>Plan today&apos;s work</Btn>
              </div>
            )}
          </div>

          <div className="section-title">Recent work</div>
          <div className="card">
            {todayEntries.length ? (
              todayEntries.map((e) => (
                <div key={e.id} className="entry-row">
                  <div className="entry-time">{e.startTime || 'Manual'}</div>
                  <div className="entry-body">
                    {e.note && <div className="entry-note">{e.note}</div>}
                    <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>
                      {e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : 'Tracked manually'}
                    </div>
                  </div>
                  <div className="mono" style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted2)' }}>
                    {fmtDuration(e.durationMin)}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state" style={{ padding: '28px 18px' }}>
                <div className="es-title">Nothing logged yet.</div>
                <div style={{ marginTop: 6 }}>Start a session and turn intention into evidence.</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="section-title">Ready next</div>
          <div className="card" style={{ marginBottom: 4 }}>
            <div className="card-head" style={{ marginBottom: 10 }}>
              <div>
                <div className="card-title" style={{ fontSize: 14.5 }}>Candidates outside the plan</div>
                <div className="card-sub">Pull work into today only when capacity allows.</div>
              </div>
            </div>
            {candidates.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {candidates.map((i) => (
                  <div key={i.id} className="goal-card" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
                    <span className="goal-dot" style={{ background: i.color || 'var(--faint)' }} />
                    <div className="goal-main">
                      <div className="goal-name" style={{ fontSize: 13 }}>{i.title}</div>
                      <div className="goal-meta">
                        {i.priority.toUpperCase()} · {fmtDuration(i.estimateMin || 30)}
                        {i.deadline ? ` · due ${fmtDateNice(i.deadline)}` : ''}
                      </div>
                    </div>
                    <Btn
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        const used = wbPlannedMinutes(useWB.getState().items, today);
                        const c = useWB.getState().dailyCapacityMin || 240;
                        const m = Number(i.estimateMin) || 30;
                        if (used + m > c) {
                          toast('Not enough capacity', `${fmtDuration(c - used)} left today`);
                          return;
                        }
                        updateItem(i.id, { startDate: today, status: i.status === 'inbox' ? 'todo' : i.status });
                        toast('Added to today', i.title);
                      }}
                    >
                      Plan
                    </Btn>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <div className="es-title">No extra ready work.</div>
              </div>
            )}
          </div>

          <div className="section-title">Deadlines worth seeing</div>
          <div className="card">
            {upcoming.length || fileDeadlines.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {upcoming.map((i) => {
                  const st = deadlineStatus(i, computeProgress(i, (id) => wbChildren(items, id)));
                  const du = daysUntil(i.deadline!);
                  const label = st === 'over' ? `${Math.abs(du)}d overdue` : du === 0 ? 'Due today' : `in ${du}d`;
                  return (
                    <div key={i.id} className="goal-card" style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}>
                      <span className="goal-dot" style={{ background: i.color || (i.type === 'goal' ? 'var(--pine)' : 'var(--faint)') }} />
                      <div className="goal-main">
                        <div className="goal-name" style={{ fontSize: 13 }}>{i.title}</div>
                        <div className="goal-meta">{i.type === 'goal' ? 'Goal' : 'Task'}</div>
                      </div>
                      <span className={`chip chip-${st}`}>{label}</span>
                    </div>
                  );
                })}
                {fileDeadlines.map((f) => {
                  const du = daysUntil(f.deadline!);
                  const pct = wbFileProgress(f);
                  const tone = du < 0 ? 'over' : du <= 3 ? 'soon' : 'ok';
                  const label = du < 0 ? `${Math.abs(du)}d overdue` : du === 0 ? 'Due today' : `in ${du}d`;
                  return (
                    <div
                      key={f.id}
                      className="goal-card"
                      style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', cursor: 'pointer' }}
                      onClick={() => window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: f.id }))}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: f.id }));
                      }}
                    >
                      <span className="goal-dot" style={{ background: 'var(--violet)' }} />
                      <div className="goal-main">
                        <div className="goal-name" style={{ fontSize: 13 }}>{f.title}</div>
                        <div className="goal-meta">Reading · {pct}% · p.{f.currentPage}/{f.pageCount}</div>
                      </div>
                      <span className={`chip chip-${tone}`}>{label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 16px' }}>
                <div className="es-title">No deadlines pulling at you.</div>
              </div>
            )}
          </div>

          <div className="section-title">Momentum</div>
          <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="insight-pill"><Zap size={14} /> {fmtDuration(weekMin)} logged this week</span>
            <span className="insight-pill"><Target size={14} /> {Math.min(100, Math.round((weekMin / 600) * 100))}% weekly momentum</span>
          </div>
        </div>
      </div>
    </div>
  );
}

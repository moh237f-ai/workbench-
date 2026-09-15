/* ==================== Dashboard View ==================== */
'use client';

import React, { useMemo } from 'react';
import {
  AlertTriangle, BarChart3, BookOpen, CalendarClock, Clock, FileText, Lightbulb, Repeat, Target,
  TrendingUp, Waypoints, Zap,
} from 'lucide-react';
import {
  useWB, wbChildren, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages, wbInsights, wbIsBlocked,
  wbPlannedMinutes, wbReadingMinutesInRange, wbReadingPagesInRange,
} from '@/lib/workbench/store';
import {
  computeProgress, daysUntil, deadlineStatus, entriesInRange, fmtDateNice, fmtDuration, isoDate, startOfWeek, todayStr,
} from '@/lib/workbench/helpers';
import { useFileCover } from '@/lib/workbench/covers';
import { Btn } from '../ui/primitives';
import { useViewActions } from './viewCtx';
import type { Item, ResourceFile, Roadmap } from '@/lib/workbench/types';

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

/** Mini "continue reading" card — own component so each file resolves its own cover. */
function ContinueCard({ file }: { file: ResourceFile }) {
  const cover = useFileCover(file);
  const pct = wbFileProgress(file);
  const open = () => window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: file.id }));
  return (
    <div style={{ flex: '0 0 auto', width: 120, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <button
        type="button"
        onClick={open}
        title={`Open ${file.title}`}
        aria-label={`Open ${file.title} in the reader`}
        style={{
          width: 84, height: 112, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
          background: 'var(--surface-alt)', border: '1px solid var(--hairline)',
          display: 'grid', placeItems: 'center', padding: 0, cursor: 'pointer',
        }}
      >
        {cover ? (
          <img src={cover} alt={file.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <FileText size={20} style={{ color: 'var(--faint)' }} />
        )}
      </button>
      <div
        title={file.title}
        style={{
          fontWeight: 650, fontSize: 12.5, lineHeight: 1.35, minHeight: 34,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
      >
        {file.title}
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>
        p.{file.currentPage} of {file.pageCount}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div className="pbar" style={{ flex: 1 }}><span style={{ width: `${pct}%` }} /></div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted2)' }}>{pct}%</span>
      </div>
      <Btn size="sm" style={{ width: '100%' }} onClick={open}>Resume</Btn>
    </div>
  );
}

export function DashboardView() {
  const items = useWB((s) => s.items);
  const entries = useWB((s) => s.entries);
  const habits = useWB((s) => s.habits);
  const labels = useWB((s) => s.labels);
  const capacity = useWB((s) => s.dailyCapacityMin);
  const files = useWB((s) => s.files);
  const readingSessions = useWB((s) => s.readingSessions);
  const roadmaps = useWB((s) => s.roadmaps);
  const createRoadmap = useWB((s) => s.createRoadmap);
  const setView = useWB((s) => s.setView);
  const { openItemDetail } = useViewActions();

  const today = todayStr();
  const weekStart = isoDate(startOfWeek(new Date()));
  const todayMin = entriesInRange(entries, today, today).reduce((s, e) => s + e.durationMin, 0);
  const weekMin = entriesInRange(entries, weekStart, today).reduce((s, e) => s + e.durationMin, 0);
  const pct = (i: typeof items[number]) => computeProgress(i, (id) => wbChildren(items, id));

  const weekReadMin = wbReadingMinutesInRange(readingSessions, weekStart, today);
  const weekReadPages = wbReadingPagesInRange(readingSessions, weekStart, today);
  const libraryCount = files.filter((f) => !f.archived).length;

  const activeGoals = items.filter((i) => i.type === 'goal' && pct(i) < 100 && i.status !== 'archived').length;
  const overdue = items.filter((i) => deadlineStatus(i, pct(i)) === 'over');
  const blocked = items.filter((i) => wbIsBlocked(items, i));
  const plannedMin = wbPlannedMinutes(items, today);
  const insights = useMemo(() => wbInsights(items, entries, capacity || 240), [items, entries, capacity]);
  const habitsDone = habits.filter((h) => h.log?.[today]).length;

  /* continue reading strip: in-progress files, most recently read first */
  const continueFiles = useMemo(
    () => files
      .filter((f) => !f.archived && wbFileProgress(f) > 0 && wbFileProgress(f) < 100)
      .sort((a, b) => (b.lastReadAt || '').localeCompare(a.lastReadAt || ''))
      .slice(0, 5),
    [files]
  );

  /* unified upcoming deadlines: items + files, soonest first */
  const upcoming = useMemo(() => {
    const pct = (i: Item) => computeProgress(i, (id) => wbChildren(items, id));
    type Row = {
      kind: 'item' | 'file';
      id: string;
      title: string;
      deadline: string;
      meta: string;
      color: string | null;
      status: 'over' | 'soon' | 'ok';
    };
    const rows: Row[] = [];
    items.forEach((i) => {
      if (!(i.deadline && pct(i) < 100 && !['done', 'archived'].includes(i.status))) return;
      const raw = deadlineStatus(i, pct(i));
      rows.push({
        kind: 'item',
        id: i.id,
        title: i.title,
        deadline: i.deadline!,
        meta: `${pct(i)}% · ${i.priority.toUpperCase()}`,
        color: i.color,
        status: raw === 'over' || raw === 'soon' ? raw : 'ok',
      });
    });
    files.forEach((f) => {
      if (!(!f.archived && f.deadline && wbFileProgress(f) < 100)) return;
      const raw = wbFileDeadlineStatus(f);
      rows.push({
        kind: 'file',
        id: f.id,
        title: f.title,
        deadline: f.deadline!,
        meta: `${wbFileReadPages(f)}/${f.pageCount} pages`,
        color: f.color,
        status: raw === 'over' || raw === 'soon' ? raw : 'ok',
      });
    });
    return rows.sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 6);
  }, [items, files]);

  /* roadmaps mini widget: two most recently updated */
  const roadmapMini = useMemo(
    () => [...roadmaps]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 2)
      .map((rm) => ({ rm, pct: roadmapProgress(rm, items, files) })),
    [roadmaps, items, files]
  );

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
      <div className="grid-cards kpi-grid">
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
        <div className="stat-card">
          <div className="stat-label">Reading this week</div>
          <div className="stat-value">{fmtDuration(weekReadMin)}</div>
          <div className="stat-note">{weekReadPages} pages · {libraryCount} files in library</div>
        </div>
      </div>

      {continueFiles.length > 0 && (
        <>
          <div className="section-title">Continue reading</div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'thin' }}>
              {continueFiles.map((f) => (
                <ContinueCard key={f.id} file={f} />
              ))}
            </div>
          </div>
        </>
      )}

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
              upcoming.map((u) => {
                const du = daysUntil(u.deadline);
                const label = u.status === 'over' ? `${Math.abs(du)}d overdue` : du === 0 ? 'due today' : `in ${du}d`;
                const open = () => {
                  if (u.kind === 'item') openItemDetail(u.id);
                  else window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: u.id }));
                };
                return (
                  <div
                    key={`${u.kind}:${u.id}`}
                    className="goal-card"
                    style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', padding: '10px 12px' }}
                    onClick={open}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open();
                      }
                    }}
                  >
                    {u.kind === 'item' ? (
                      <Target size={15} style={{ color: u.color || 'var(--pine)', flexShrink: 0 }} />
                    ) : (
                      <BookOpen size={15} style={{ color: u.color || 'var(--violet)', flexShrink: 0 }} />
                    )}
                    <div className="goal-main">
                      <div className="goal-name" style={{ fontSize: 13 }}>{u.title}</div>
                      <div className="goal-meta">{u.kind === 'item' ? 'Item' : 'File'} · {u.meta}</div>
                    </div>
                    <span className={`chip chip-${u.status}`}>{label}</span>
                  </div>
                );
              })
            ) : (
              <div className="empty-state" style={{ padding: '22px 14px' }}>
                <div className="es-title">No upcoming deadlines — items or files.</div>
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

          {roadmaps.length > 0 && (
            <>
              <div className="section-title">Roadmaps</div>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {roadmapMini.map(({ rm, pct: p }) => (
                  <div
                    key={rm.id}
                    className="goal-card"
                    style={{ gridTemplateColumns: 'minmax(0,1fr) auto', padding: '10px 12px' }}
                    role="button"
                    tabIndex={0}
                    onClick={() => useWB.setState({ view: 'roadmap', activeRoadmapId: rm.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        useWB.setState({ view: 'roadmap', activeRoadmapId: rm.id });
                      }
                    }}
                  >
                    <div className="goal-main">
                      <div className="goal-name" style={{ fontSize: 13 }}>{rm.title}</div>
                      <div className="pbar" style={{ marginTop: 6 }}><span style={{ width: `${p}%` }} /></div>
                      <div className="goal-meta"><span className="mono">{rm.nodes.length} node{rm.nodes.length === 1 ? '' : 's'}</span></div>
                    </div>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{p}%</span>
                  </div>
                ))}
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    createRoadmap('Untitled roadmap');
                    useWB.setState({ view: 'roadmap' });
                  }}
                >
                  + New
                </Btn>
              </div>
            </>
          )}

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
            <button className="btn btn-sm" onClick={() => setView('library')}><BookOpen size={13} /> Library</button>
            <button className="btn btn-sm" onClick={() => setView('roadmap')}><Waypoints size={13} /> Roadmaps</button>
            <button className="btn btn-sm" onClick={() => setView('planner')}><CalendarClock size={13} /> Planner</button>
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
              Next deadline: {fmtDateNice(upcoming[0].deadline)} — {upcoming[0].title}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ==================== Reports View ==================== */
'use client';

import React, { useMemo } from 'react';
import {
  useWB, wbChildren, wbFileAvgSecPerPage, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages,
  wbReadingMinutesInRange, wbReadingPagesInRange,
} from '@/lib/workbench/store';
import {
  computeProgress, entriesInRange, fmtDateNice, fmtDuration, hhmmToMin, parseDate, rangeToDates,
} from '@/lib/workbench/helpers';
import type { Item, ReportRange, ResourceFile, Roadmap } from '@/lib/workbench/types';

export function ReportsHeaderActions() {
  const range = useWB((s) => s.reportRange);
  const setRange = useWB((s) => s.setReportRange);
  const ranges: { id: ReportRange; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'month', label: 'This month' },
    { id: 'all', label: 'All time' },
  ];
  return (
    <div className="radio-pills">
      {ranges.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`radio-pill ${range === r.id ? 'active' : ''}`}
          onClick={() => setRange(r.id)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

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

export function ReportsView() {
  const entries = useWB((s) => s.entries);
  const labels = useWB((s) => s.labels);
  const items = useWB((s) => s.items);
  const stats = useWB((s) => s.stats);
  const range = useWB((s) => s.reportRange);
  const files = useWB((s) => s.files);
  const readingSessions = useWB((s) => s.readingSessions);
  const filePlans = useWB((s) => s.filePlans);
  const roadmaps = useWB((s) => s.roadmaps);
  const [from, to] = rangeToDates(range);

  const scoped = useMemo(() => entriesInRange(entries, from, to), [entries, from, to]);
  const totalMin = scoped.reduce((s, e) => s + e.durationMin, 0);

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

  const days = useMemo(() => {
    if (from === '0000-01-01') return [];
    const out: string[] = [];
    let cur = parseDate(from);
    const end = parseDate(to);
    let guard = 0;
    while (cur <= end && guard < 62) {
      out.push(
        `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      );
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      guard++;
    }
    return out;
  }, [from, to]);

  const dayMinutes = days.map((d) => entriesInRange(entries, d, d).reduce((s, e) => s + e.durationMin, 0));
  const maxDayMin = Math.max(1, ...dayMinutes);

  /* ----- v4: reading in range ----- */
  const readingMinutes = wbReadingMinutesInRange(readingSessions, from, to);
  const readingPages = wbReadingPagesInRange(readingSessions, from, to);
  const readingByDay = useMemo(() => {
    const m: Record<string, number> = {};
    readingSessions.forEach((r) => {
      m[r.date] = (m[r.date] || 0) + r.minutes;
    });
    return m;
  }, [readingSessions]);
  const readingDayMinutes = days.map((d) => readingByDay[d] || 0);
  const maxReadingDay = Math.max(1, ...readingDayMinutes);

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

  return (
    <div className="fade-in">
      <div className="grid-cards">
        <div className="stat-card">
          <div className="stat-label">Total logged</div>
          <div className="stat-value">{fmtDuration(totalMin)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Entries</div>
          <div className="stat-value">{scoped.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg / entry</div>
          <div className="stat-value">{scoped.length ? fmtDuration(Math.round(totalMin / scoped.length)) : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">All-time focus</div>
          <div className="stat-value" title="Pomodoro work phases completed">{stats.focusSessions} sessions</div>
          <div className="stat-note">{fmtDuration(stats.focusMinutes)} in focus sessions</div>
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
      </div>

      {days.length > 1 && (
        <>
          <div className="section-title">By day</div>
          <div className="card">
            <div className="daychart">
              {days.map((d, i) => {
                const m = dayMinutes[i];
                const h = Math.max(2, Math.round((m / maxDayMin) * 100));
                return (
                  <div key={d} className="daychart-col" title={`${fmtDateNice(d)}: ${fmtDuration(m)}`}>
                    <div className="daychart-bar" style={{ height: `${h}%`, opacity: m ? 1 : 0.25 }} />
                    <div className="daychart-lbl">{parseDate(d).getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-title">Reading by day</div>
          <div className="card">
            <div className="daychart">
              {days.map((d, i) => {
                const m = readingDayMinutes[i];
                const h = Math.max(2, Math.round((m / maxReadingDay) * 100));
                return (
                  <div key={d} className="daychart-col" title={`${fmtDateNice(d)}: ${fmtDuration(m)} reading`}>
                    <div
                      className="daychart-bar"
                      style={{
                        height: `${h}%`,
                        opacity: m ? 1 : 0.25,
                        background: 'linear-gradient(180deg, var(--violet), color-mix(in srgb, var(--violet) 70%, #000))',
                      }}
                    />
                    <div className="daychart-lbl">{parseDate(d).getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {showTopFiles && (
        <>
          <div className="section-title">Top reading files</div>
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

      <div className="section-title">By label</div>
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
          <div className="section-title">By item</div>
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
          <div className="section-title">Goals & linked files</div>
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
          <div className="section-title">Planner adherence</div>
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
          <div className="section-title">Roadmaps</div>
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
    </div>
  );
}

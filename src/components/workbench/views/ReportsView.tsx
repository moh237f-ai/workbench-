/* ==================== Reports View ==================== */
'use client';

import React, { useMemo } from 'react';
import { useWB } from '@/lib/workbench/store';
import {
  entriesInRange, fmtDateNice, fmtDuration, parseDate, rangeToDates,
} from '@/lib/workbench/helpers';
import type { ReportRange } from '@/lib/workbench/types';

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

export function ReportsView() {
  const entries = useWB((s) => s.entries);
  const labels = useWB((s) => s.labels);
  const items = useWB((s) => s.items);
  const stats = useWB((s) => s.stats);
  const range = useWB((s) => s.reportRange);
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
    </div>
  );
}

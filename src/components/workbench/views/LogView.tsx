/* ==================== Activity Log View ==================== */
'use client';

import React, { useState } from 'react';
import { Play, Plus, Trash2, ChevronDown } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { fmtDateNice, fmtDuration, todayStr } from '@/lib/workbench/helpers';
import { Btn, IconBtn, toast } from '../ui/primitives';
import { useViewActions } from './viewCtx';

/* ---------- Timer + manual entry widget ---------- */

export function TimerWidget() {
  const labels = useWB((s) => s.labels);
  const activeTimer = useWB((s) => s.activeTimer);
  const startTimer = useWB((s) => s.startTimer);
  const addEntry = useWB((s) => s.addEntry);
  const [note, setNote] = useState('');
  const [manualMin, setManualMin] = useState('30');
  const [manualNote, setManualNote] = useState('');
  const [manualLabels, setManualLabels] = useState<string[]>([]);
  const [showManual, setShowManual] = useState(false);

  if (activeTimer) {
    return (
      <div
        style={{
          color: 'var(--muted2)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 14px', borderRadius: 12,
          background: 'var(--pine-light)',
          borderLeft: '3px solid var(--pine)',
        }}
      >
        <span className="timer-pill-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--pine)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {activeTimer.pomodoro ? (activeTimer.pomodoro.phase === 'work' ? 'Focus session' : 'Break') : 'Timer'} running
        </span>
        — stop it from the sidebar or Focus Mode.
      </div>
    );
  }

  return (
    <div>
      <div className="field-row">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="timer-note">Note</label>
          <input id="timer-note" type="text" value={note} placeholder="What are you doing?" onChange={(e) => setNote(e.target.value)} />
          {labels.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {labels.map((l) => {
                const on = manualLabels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    className="chip label-chip"
                    style={{
                      background: on ? `${l.color}33` : 'var(--surface-alt)',
                      color: on ? l.color : 'var(--muted2)',
                      border: '1px solid transparent',
                    }}
                    onClick={() =>
                      setManualLabels((prev) => (on ? prev.filter((x) => x !== l.id) : [...prev, l.id]))
                    }
                  >
                    <span className="chip-dot" style={{ background: l.color }} />
                    {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>&nbsp;</label>
          <Btn
            variant="primary"
            block
            onClick={() => {
              startTimer(manualLabels, note.trim());
              setNote('');
              toast('Timer started');
            }}
          >
            <Play size={15} /> Start timer
          </Btn>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--hairline)', margin: '4px 0 12px' }} />

      <button
        type="button"
        onClick={() => setShowManual((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          color: 'var(--muted2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0,
        }}
      >
        <ChevronDown size={14} style={{ transform: showManual ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        Log time manually instead
      </button>

      {showManual && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, width: 130 }}>
            <label htmlFor="manual-min">Duration (min)</label>
            <input id="manual-min" type="number" min={1} value={manualMin} onChange={(e) => setManualMin(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}>
            <label htmlFor="manual-note">Note</label>
            <input id="manual-note" type="text" value={manualNote} placeholder="What did you do?" onChange={(e) => setManualNote(e.target.value)} />
          </div>
          <Btn
            onClick={() => {
              const min = Number(manualMin) || 0;
              if (min <= 0) {
                toast('Enter a duration');
                return;
              }
              addEntry({ durationMin: min, note: manualNote.trim(), labelIds: [...manualLabels] });
              setManualNote('');
              toast('Entry added', fmtDuration(min));
            }}
          >
            <Plus size={15} /> Add entry
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ---------- Log view ---------- */

export function LogView() {
  const entries = useWB((s) => s.entries);
  const labels = useWB((s) => s.labels);
  const items = useWB((s) => s.items);
  const deleteEntry = useWB((s) => s.deleteEntry);
  const { openLabels } = useViewActions();

  const sorted = [...entries].sort((a, b) =>
    (b.date + (b.startTime || '00:00')).localeCompare(a.date + (a.startTime || '00:00'))
  );

  const byDay: { date: string; ents: typeof sorted }[] = [];
  sorted.forEach((e) => {
    const last = byDay[byDay.length - 1];
    if (last && last.date === e.date) last.ents.push(e);
    else byDay.push({ date: e.date, ents: [e] });
  });

  return (
    <div className="fade-in">
      <div className="card" style={{ marginBottom: 16 }}>
        <TimerWidget />
      </div>

      <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Entries · {entries.length}</span>
        <Btn size="sm" variant="ghost" onClick={openLabels}>
          Manage labels
        </Btn>
      </div>

      {!byDay.length ? (
        <div className="empty-state">
          <div className="es-title">No entries yet</div>
          Start a timer or log time manually.
        </div>
      ) : (
        byDay.map((day) => {
          const total = day.ents.reduce((s, e) => s + e.durationMin, 0);
          return (
            <div key={day.date} style={{ marginBottom: 6 }}>
              <div className="day-group-heading">
                {day.date === todayStr() ? 'Today' : fmtDateNice(day.date)}
                <span className="dgh-total">{fmtDuration(total)}</span>
              </div>
              <div className="card" style={{ padding: '2px 16px' }}>
                {day.ents.map((e) => {
                  const eLabels = e.labelIds
                    .map((id) => labels.find((l) => l.id === id))
                    .filter(Boolean);
                  const eItems = e.itemIds
                    .map((id) => items.find((i) => i.id === id))
                    .filter(Boolean);
                  const timeStr = e.startTime && e.endTime ? `${e.startTime}–${e.endTime}` : 'manual';
                  return (
                    <div key={e.id} className="entry-row">
                      <div className="entry-time">
                        {timeStr}
                        <div style={{ fontWeight: 700, color: 'var(--muted2)', marginTop: 2 }}>{fmtDuration(e.durationMin)}</div>
                      </div>
                      <div className="entry-body">
                        {(eLabels.length > 0 || eItems.length > 0) && (
                          <div className="entry-labels">
                            {eLabels.map((l) => (
                              <span key={l!.id} className="chip label-chip" style={{ background: `${l!.color}22`, color: l!.color }}>
                                <span className="chip-dot" style={{ background: l!.color }} />
                                {l!.name}
                              </span>
                            ))}
                            {eItems.map((it) => (
                              <span key={it!.id} className="chip chip-ok">{it!.title}</span>
                            ))}
                          </div>
                        )}
                        {e.note && <div className="entry-note">{e.note}</div>}
                      </div>
                      <IconBtn
                        danger
                        small
                        title="Delete entry"
                        onClick={() => {
                          if (confirm('Delete this entry?')) {
                            deleteEntry(e.id);
                            toast('Entry deleted');
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </IconBtn>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

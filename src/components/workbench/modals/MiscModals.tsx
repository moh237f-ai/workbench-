/* ==================== Misc Modals ==================== */
'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus, Trash2, Check, Download, Upload, CalendarDays, Sparkles, Pencil, Flame,
} from 'lucide-react';
import { useWB, wbIsBlocked, wbPlannedItems, wbPlannedMinutes, wbPriorityWeight, wbReadyItems } from '@/lib/workbench/store';
import {
  buildICS, fmtDateNice, fmtDuration, isoDate, parseCapture, parseICS, priorityLabel, todayStr,
} from '@/lib/workbench/helpers';
import { Btn, Modal, toast } from '../ui/primitives';

/* ---------- Labels manager ---------- */

export function LabelsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const labels = useWB((s) => s.labels);
  const items = useWB((s) => s.items);
  const addLabel = useWB((s) => s.addLabel);
  const renameLabel = useWB((s) => s.renameLabel);
  const deleteLabel = useWB((s) => s.deleteLabel);
  const [name, setName] = useState('');

  const save = () => {
    const n = name.trim();
    if (!n) {
      toast('Label name is required');
      return;
    }
    addLabel(n);
    setName('');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage labels"
      footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }} onSubmit={(e) => e.preventDefault()}>
        <input
          type="text"
          value={name}
          placeholder="New label name"
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          style={{
            flex: 1, padding: '9px 13px', border: '1px solid var(--hairline)',
            borderRadius: 'var(--radius-wb-sm)', background: 'var(--surface-solid)', color: 'var(--ink)',
          }}
        />
        <Btn variant="primary" size="sm" onClick={save}>
          <Plus size={14} /> Add
        </Btn>
      </div>
      {labels.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {labels.map((l) => (
            <div key={l.id} className="card" style={{ padding: '11px 13px', margin: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span className="chip-dot" style={{ background: l.color, width: 11, height: 11 }} />
                <input
                  type="text"
                  defaultValue={l.name}
                  key={l.id + l.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== l.name) {
                      renameLabel(l.id, v);
                      toast('Label renamed', v);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  style={{
                    border: 'none', background: 'none', fontWeight: 650, flex: 1,
                    color: 'var(--ink)', fontSize: 13.5, outline: 'none',
                    borderBottom: '1px dashed transparent',
                  }}
                  aria-label={`Rename label ${l.name}`}
                />
                <span style={{ fontSize: 11, color: 'var(--faint)' }} className="mono">
                  {l.itemIds.filter((iid) => items.some((i) => i.id === iid)).length} items
                </span>
                <button
                  className="icon-btn icon-btn-sm icon-btn-danger"
                  title={`Delete label ${l.name}`}
                  onClick={() => {
                    if (confirm(`Delete label "${l.name}"? It will be removed from all entries.`)) {
                      deleteLabel(l.id);
                      toast('Label deleted');
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          <div className="field-help">Click a label name to rename it. Changes save when you click away.</div>
        </div>
      ) : (
        <div className="field-help">No labels yet — add one above, then attach it from an item&apos;s detail view.</div>
      )}
    </Modal>
  );
}

/* ---------- Shortcuts help ---------- */

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string[], string][] = [
    [['F'], 'Open / focus mode'],
    [['⌘', 'K'], 'Command palette & search'],
    [['C'], 'Quick capture'],
    [['T'], 'Start / stop quick timer'],
    [['N'], 'New goal'],
    [['G', 'T/D/G/L/H/J/C/R/I'], 'Jump to a view'],
    [['G', 'B'], 'Library — your PDFs'],
    [['G', 'M'], 'Roadmaps'],
    [['G', 'P'], 'Day / week planner'],
    [['Ctrl', 'Z'], 'Undo'],
    [['Ctrl', 'Shift', 'Z'], 'Redo'],
    [['Ctrl', 'J'], 'Cycle theme'],
    [['Esc'], 'Exit focus / close dialog'],
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      footer={<Btn variant="primary" onClick={onClose}>Close</Btn>}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map(([keys, desc], i) => (
          <div
            key={desc}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              padding: '10px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--hairline)' : 'none',
            }}
          >
            <span style={{ fontSize: 13 }}>{desc}</span>
            <span style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
              {keys.map((k, j) => (
                <React.Fragment key={k}>
                  {j > 0 && <span style={{ color: 'var(--faint)', fontSize: 11 }}>+</span>}
                  <span className="kbd">{k}</span>
                </React.Fragment>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- Data (export / import / ICS) ---------- */

export function DataModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const exportData = useWB((s) => s.exportData);
  const importData = useWB((s) => s.importData);
  const items = useWB((s) => s.items);

  const doExport = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workbench-aurora-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Backup exported');
  };

  const doImport = (kind: 'json' | 'ics') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'json' ? 'application/json,.json' : '.ics,text/calendar';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        if (kind === 'json') {
          try {
            const raw = JSON.parse(String(fr.result));
            if (!confirm('Replace the current workspace with this backup?')) return;
            const err = importData(raw);
            if (err) toast('Import failed', err);
            else toast('Backup imported', 'Your workspace has been restored.');
          } catch (e) {
            toast('Import failed', e instanceof Error ? e.message : 'Invalid file');
          }
        } else {
          const events = parseICS(String(fr.result));
          if (!events.length) {
            toast('No events found', 'The .ics file contained no importable events.');
            return;
          }
          const { addItem } = useWB.getState();
          events.forEach((ev) =>
            addItem({ title: ev.title, type: 'task', status: 'todo', deadline: ev.deadline, plannedStart: ev.plannedStart })
          );
          toast('Calendar imported', `${events.length} event${events.length === 1 ? '' : 's'} converted to tasks`);
        }
      };
      fr.readAsText(f);
    };
    input.click();
  };

  const doIcsExport = () => {
    const timeboxed = items.filter((i) => i.plannedStart);
    if (!timeboxed.length) {
      toast('Nothing to export', 'Timebox a few tasks first — their blocks become calendar events.');
      return;
    }
    const blob = new Blob([buildICS(timeboxed)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workbench-timeboxes-${todayStr()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Calendar exported', `${timeboxed.length} time block${timeboxed.length === 1 ? '' : 's'}`);
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0',
    borderBottom: '1px solid var(--hairline)',
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Backup & data"
      footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}
    >
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5 }}>Workspace backup</div>
          <div className="field-help">Full JSON export/import of goals, tasks, entries, habits and journal.</div>
        </div>
        <Btn size="sm" onClick={doExport}><Download size={14} /> Export</Btn>
        <Btn size="sm" onClick={() => doImport('json')}><Upload size={14} /> Import</Btn>
      </div>
      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5 }}>Calendar bridge</div>
          <div className="field-help">Move timeboxed work in and out using standard .ics files.</div>
        </div>
        <Btn size="sm" onClick={doIcsExport}><Download size={14} /> .ics</Btn>
        <Btn size="sm" onClick={() => doImport('ics')}><Upload size={14} /> .ics</Btn>
      </div>
      <div style={{ ...rowStyle, borderBottom: 'none' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 13.5 }}>Storage</div>
          <div className="field-help">Local-first: everything lives in this browser. Export regularly.</div>
        </div>
        <span className="chip chip-ok">Local</span>
      </div>
    </Modal>
  );
}

/* ---------- Quick capture ---------- */

export function CaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addItem = useWB((s) => s.addItem);
  const [kind, setKind] = useState<'task' | 'note'>('task');
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseCapture(text), [text]);

  const save = () => {
    if (!text.trim()) {
      toast('Write something to capture');
      return;
    }
    addItem({
      title: parsed.title,
      type: kind === 'note' ? 'note' : 'task',
      status: 'inbox',
      priority: parsed.priority,
      estimateMin: parsed.estimateMin,
      deadline: parsed.deadline,
      nextAction: kind === 'task' ? parsed.title : '',
    });
    toast('Captured', kind === 'note' ? 'Note saved to Inbox' : parsed.title);
    setText('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick capture"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>
            <Sparkles size={15} /> Capture
          </Btn>
        </>
      }
    >
      <div className="radio-pills" style={{ marginBottom: 12 }}>
        <button className={`radio-pill ${kind === 'task' ? 'active' : ''}`} onClick={() => setKind('task')} type="button">
          Task
        </button>
        <button className={`radio-pill ${kind === 'note' ? 'active' : ''}`} onClick={() => setKind('note')} type="button">
          Note
        </button>
      </div>
      <div className="field">
        <label htmlFor="capture-input">Capture what is on your mind</label>
        <input
          id="capture-input"
          type="text"
          autoFocus
          value={text}
          placeholder="e.g. Finish CFD notes tomorrow 45m p1"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>
      {text.trim() && (
        <div className="capture-preview">
          <span className="capture-preview-label">Will capture</span>
          <span style={{ fontWeight: 650 }}>{parsed.title}</span>
          <span style={{ color: 'var(--muted2)', fontSize: 12 }}>
            {[kind === 'note' ? 'Note' : 'Inbox', parsed.priority.toUpperCase()]
              .concat(parsed.estimateMin ? [fmtDuration(parsed.estimateMin)] : [])
              .concat(parsed.deadline ? [`due ${fmtDateNice(parsed.deadline)}`] : [])
              .join(' · ')}
          </span>
        </div>
      )}
      <div className="field-help" style={{ marginTop: 10 }}>
        Tip: include <span className="kbd">p1</span>, <span className="kbd">45m</span>, <span className="kbd">1.5h</span>,{' '}
        <span className="kbd">today</span>, <span className="kbd">tomorrow</span> or <span className="kbd">next week</span>.
      </div>
    </Modal>
  );
}

/* ---------- Timebox ---------- */

export function TimeboxModal({
  itemId,
  date,
  onClose,
}: {
  itemId: string;
  date?: string;
  onClose: () => void;
}) {
  const items = useWB((s) => s.items);
  const updateItem = useWB((s) => s.updateItem);
  const item = items.find((i) => i.id === itemId) || null;

  const d = date || item?.startDate || todayStr();
  const currentStart =
    item?.plannedStart && item.plannedStart.slice(0, 10) === d ? item.plannedStart.slice(11, 16) : '09:00';
  const mins = Math.max(15, item?.estimateMin || 30);
  const [h0, m0] = currentStart.split(':').map(Number);
  const x0 = new Date(2000, 0, 1, h0, m0 + mins);
  const defaultEnd = `${String(x0.getHours()).padStart(2, '0')}:${String(x0.getMinutes()).padStart(2, '0')}`;

  const [day, setDay] = useState(d);
  const [start, setStart] = useState(currentStart);
  const [end, setEnd] = useState(
    item?.plannedEnd && item.plannedEnd.slice(0, 10) === d ? item.plannedEnd.slice(11, 16) : defaultEnd
  );

  if (!item) return null;

  const plannedOnDay = items
    .filter((i) => i.id !== item.id && i.plannedStart && i.plannedStart.slice(0, 10) === day)
    .reduce((s, i) => s + (Number(i.estimateMin) || 30), 0);

  return (
    <Modal
      open
      onClose={onClose}
      title="Timebox task"
      footer={
        <>
          <Btn
            variant="danger"
            onClick={() => {
              updateItem(item.id, { plannedStart: null, plannedEnd: null });
              toast('Timebox cleared');
              onClose();
            }}
          >
            Clear
          </Btn>
          <span className="spacer" />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            onClick={() => {
              if (!start || !end || end <= start) {
                toast('End time must be after start');
                return;
              }
              updateItem(item.id, {
                plannedStart: `${day}T${start}`,
                plannedEnd: `${day}T${end}`,
                startDate: day,
              });
              useWB.setState({ calendarSelectedDate: day });
              toast('Time block saved', `${fmtDateNice(day)} · ${start}–${end}`);
              onClose();
            }}
          >
            <Check size={15} /> Save block
          </Btn>
        </>
      }
    >
      <div className="field">
        <label htmlFor="tb-date">Day</label>
        <input id="tb-date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="tb-start">Start</label>
          <input id="tb-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tb-end">End</label>
          <input id="tb-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="card" style={{ padding: '12px 14px', marginTop: 4 }}>
        <div style={{ fontWeight: 650 }}>{item.title}</div>
        <div className="card-sub" style={{ marginTop: 4 }}>
          Estimated {fmtDuration(mins)} · Other blocks that day: {fmtDuration(plannedOnDay)}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Day planner ---------- */

export function DayPlannerModal({ date, onClose, onTimebox }: { date: string; onClose: () => void; onTimebox: (id: string, date: string) => void }) {
  const items = useWB((s) => s.items);
  const updateItem = useWB((s) => s.updateItem);

  const blocked = items.filter((i) => i.status !== 'done' && i.status !== 'archived' && wbIsBlocked(items, i));
  const dayItems = items
    .filter((i) => i.plannedStart && i.plannedStart.slice(0, 10) === date && i.status !== 'archived')
    .sort((a, b) => (a.plannedStart || '').localeCompare(b.plannedStart || ''));
  const available = items
    .filter((i) => !['done', 'archived', 'inbox'].includes(i.status) && !wbIsBlocked(items, i) && !i.plannedStart)
    .sort((a, b) => wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority))
    .slice(0, 40);
  const plannedMin = dayItems.reduce((s, i) => s + Math.max(1, Number(i.estimateMin) || 30), 0);
  const [addId, setAddId] = useState('');

  return (
    <Modal open onClose={onClose} title={`Plan ${fmtDateNice(date)}`} wide>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 14px', borderRadius: 12, background: 'var(--pine-light)', marginBottom: 14,
        }}
      >
        <strong>{fmtDateNice(date)}</strong>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted2)' }}>{fmtDuration(plannedMin)} planned</span>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {dayItems.length ? (
          dayItems.map((i) => (
            <div
              key={i.id}
              style={{
                display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) auto', alignItems: 'center',
                gap: 12, padding: 10, border: '1px solid var(--hairline)', borderRadius: 12,
              }}
            >
              <div className="mono" style={{ fontWeight: 700, fontSize: 11, color: 'var(--pine)' }}>
                {i.plannedStart?.slice(11, 16)}–{i.plannedEnd?.slice(11, 16) || '—'}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{i.title}</div>
                <div className="card-sub">
                  {fmtDuration(i.estimateMin || 30)}
                  {i.nextAction ? ` · ${i.nextAction}` : ''}
                </div>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => onTimebox(i.id, date)}>
                <Pencil size={13} /> Edit
              </Btn>
            </div>
          ))
        ) : (
          <div className="empty-state" style={{ padding: '22px 14px' }}>
            <div className="es-title">No time blocks yet.</div>
          </div>
        )}
      </div>
      <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
        <label htmlFor="day-add-item">Add a task to this day</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select id="day-add-item" value={addId} onChange={(e) => setAddId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Choose a ready task…</option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title} · {fmtDuration(i.estimateMin || 30)}
              </option>
            ))}
          </select>
          <Btn
            variant="primary"
            size="sm"
            onClick={() => {
              if (!addId) return;
              onTimebox(addId, date);
            }}
          >
            Timebox
          </Btn>
        </div>
        {blocked.length > 0 && (
          <div className="field-help">{blocked.length} blocked task{blocked.length === 1 ? '' : 's'} hidden (resolve dependencies first).</div>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Daily plan (capacity) ---------- */

export function DailyPlanModal({ onClose }: { onClose: () => void }) {
  const items = useWB((s) => s.items);
  const dailyCapacityMin = useWB((s) => s.dailyCapacityMin);
  const setDailyCapacity = useWB((s) => s.setDailyCapacity);
  const updateItem = useWB((s) => s.updateItem);

  const today = todayStr();
  const planned = wbPlannedItems(items, today);
  const used = wbPlannedMinutes(items, today);
  const cap = dailyCapacityMin || 240;
  const ready = wbReadyItems(items).filter((i) => i.type === 'task' && !i.startDate);
  const [capacity, setCapacity] = useState(String(cap));

  return (
    <Modal
      open
      onClose={onClose}
      title="Plan today"
      wide
      footer={
        <>
          <Btn
            onClick={() => {
              // auto-fill: add ready tasks by priority until capacity
              let total = used;
              const c = Number(capacity) || 240;
              ready
                .slice()
                .sort((a, b) => wbPriorityWeight(a.priority) - wbPriorityWeight(b.priority))
                .forEach((i) => {
                  const m = Number(i.estimateMin) || 30;
                  if (total + m <= c) {
                    updateItem(i.id, { startDate: today, status: i.status === 'inbox' ? 'todo' : i.status });
                    total += m;
                  }
                });
              toast('Plan auto-filled', `${fmtDuration(Math.min(total, c))} of ${fmtDuration(c)} capacity`);
            }}
          >
            Auto-fill capacity
          </Btn>
          <span className="spacer" />
          <Btn variant="primary" onClick={() => { setDailyCapacity(Number(capacity) || 240); onClose(); }}>
            <Check size={15} /> Done
          </Btn>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 650 }}>Today&apos;s capacity</div>
          <div className="field-help">Keep the plan below what you can realistically finish.</div>
        </div>
        <select value={capacity} onChange={(e) => setCapacity(e.target.value)} style={{ minWidth: 120 }}>
          {[120, 180, 240, 300, 360, 420, 480].map((m) => (
            <option key={m} value={m}>{fmtDuration(m)}</option>
          ))}
        </select>
      </div>
      <div className={`capacity-track ${used > cap ? 'over' : ''}`}>
        <span style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
      </div>
      <div className="field-help" style={{ margin: '6px 0 16px' }}>
        Planned {fmtDuration(used)} · {fmtDuration(Math.max(0, cap - used))} remaining
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Planned today · {planned.length}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {planned.length ? (
          planned.map((i) => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--hairline)', borderRadius: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 13.5 }}>{i.title}</div>
                <div className="card-sub">{i.nextAction || 'No next action'} · {fmtDuration(i.estimateMin || 0)}</div>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => updateItem(i.id, { startDate: null })}>
                Unplan
              </Btn>
            </div>
          ))
        ) : (
          <div className="field-help">Nothing planned yet.</div>
        )}
      </div>

      <div className="section-title">Ready to plan · {ready.length}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', paddingRight: 4 }}>
        {ready.length ? (
          ready.map((i) => (
            <label key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--hairline)', borderRadius: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={i.startDate === today}
                onChange={() => updateItem(i.id, { startDate: i.startDate === today ? null : today })}
                style={{ accentColor: 'var(--pine)' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 13.5 }}>{i.title}</div>
                <div className="card-sub">
                  {priorityLabel(i.priority)} · {fmtDuration(i.estimateMin || 30)}
                  {i.deadline ? ` · due ${fmtDateNice(i.deadline)}` : ''}
                </div>
              </div>
            </label>
          ))
        ) : (
          <div className="field-help">No ready tasks need planning.</div>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Habit form ---------- */

export function HabitFormModal({ habitId, onClose }: { habitId: string | null; onClose: () => void }) {
  const habits = useWB((s) => s.habits);
  const addHabit = useWB((s) => s.addHabit);
  const updateHabit = useWB((s) => s.updateHabit);
  const habit = habitId ? habits.find((h) => h.id === habitId) : null;

  const [name, setName] = useState(habit?.name || '');
  const [description, setDescription] = useState(habit?.description || '');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>(habit?.cadence || 'daily');

  return (
    <Modal
      open
      onClose={onClose}
      title={habit ? 'Edit habit' : 'New habit'}
      footer={
        <>
          {habit && (
            <Btn
              variant="danger"
              onClick={() => {
                if (confirm(`Delete habit "${habit.name}" and its history?`)) {
                  useWB.getState().deleteHabit(habit.id);
                  toast('Habit deleted');
                  onClose();
                }
              }}
            >
              <Trash2 size={15} /> Delete
            </Btn>
          )}
          <span className="spacer" />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            onClick={() => {
              const n = name.trim();
              if (!n) {
                toast('Habit name is required');
                return;
              }
              if (habit) updateHabit(habit.id, { name: n, description: description.trim(), cadence });
              else addHabit({ name: n, description: description.trim(), cadence });
              toast(habit ? 'Habit updated' : 'Habit created', n);
              onClose();
            }}
          >
            <Check size={15} /> Save
          </Btn>
        </>
      }
    >
      <div className="field">
        <label htmlFor="h-name">Name</label>
        <input id="h-name" type="text" autoFocus value={name} placeholder="e.g. Read 20 pages" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="h-desc">Description (optional)</label>
        <input id="h-desc" type="text" value={description} placeholder="Why does this matter?" onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="field">
        <label>Cadence</label>
        <div className="radio-pills">
          <button className={`radio-pill ${cadence === 'daily' ? 'active' : ''}`} onClick={() => setCadence('daily')} type="button">
            <Flame size={13} /> Daily
          </button>
          <button className={`radio-pill ${cadence === 'weekly' ? 'active' : ''}`} onClick={() => setCadence('weekly')} type="button">
            <CalendarDays size={13} /> Weekly
          </button>
        </div>
      </div>
    </Modal>
  );
}

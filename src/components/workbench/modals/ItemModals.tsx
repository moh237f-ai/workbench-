/* ==================== Item Modals: Create + Detail ==================== */
'use client';

import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Check, Link2, Tag, BookOpen, X as XIcon } from 'lucide-react';
import { useWB, wbCanDependOn, wbChildren, wbFileProgress, wbFileReadPages, wbIsBlocked } from '@/lib/workbench/store';
import { computeProgress, daysUntil, deadlineStatus } from '@/lib/workbench/helpers';
import { SWATCHES } from '@/lib/workbench/types';
import type { ItemStatus, ItemType, Priority } from '@/lib/workbench/types';
import { Btn, Modal, toast } from '../ui/primitives';
import { DateField } from '../ui/DateField';

/* ---------- Create item ---------- */

export function ItemFormModal({
  parentId,
  onClose,
}: {
  parentId: string | null;
  onClose: () => void;
}) {
  const items = useWB((s) => s.items);
  const addItem = useWB((s) => s.addItem);
  const parent = parentId ? items.find((i) => i.id === parentId) : null;

  const [title, setTitle] = useState('');
  const [type, setType] = useState<ItemType>(parent ? 'task' : 'goal');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<Priority>('p2');
  const [estimate, setEstimate] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [notes, setNotes] = useState('');
  const [color, setColor] = useState<string | null>(null);

  const save = () => {
    const t = title.trim();
    if (!t) {
      toast('Title is required', 'Give it a name so future-you knows what it is.');
      return;
    }
    addItem({
      title: t,
      type,
      parentId: parentId || null,
      deadline: deadline || null,
      priority,
      estimateMin: estimate ? Number(estimate) : null,
      nextAction: nextAction.trim(),
      notes: notes.trim(),
      color,
      status: 'todo',
    });
    toast(parent ? 'Sub-item created' : 'Item created', t);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={parent ? `Add sub-item · ${parent.title}` : 'New goal'}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>
            <Plus size={15} /> Create
          </Btn>
        </>
      }
    >
      <div className="field">
        <label htmlFor="f-title">Title</label>
        <input
          id="f-title"
          type="text"
          autoFocus
          value={title}
          placeholder={parent ? 'Sub-goal or task' : 'Goal title'}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="f-type">Type</label>
          <select id="f-type" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            <option value="goal">Goal</option>
            <option value="task">Task</option>
            <option value="note">Note</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-deadline">Deadline</label>
          <DateField id="f-deadline" value={deadline} onChange={setDeadline} compact placeholder="No deadline" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="f-priority">Priority</label>
          <select id="f-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {(['p0', 'p1', 'p2', 'p3'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {p.toUpperCase()} {p === 'p0' ? '· critical' : p === 'p1' ? '· high' : p === 'p2' ? '· normal' : '· low'}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-estimate">Estimate (min)</label>
          <input
            id="f-estimate" type="number" min={5} step={5} placeholder="30"
            value={estimate} onChange={(e) => setEstimate(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="f-next">Next action</label>
        <input
          id="f-next" type="text" value={nextAction}
          placeholder="What physically happens next?"
          onChange={(e) => setNextAction(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="f-notes">Notes</label>
        <textarea id="f-notes" value={notes} placeholder="Details, context, links…" onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <div
              key={c}
              className={`swatch ${color === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(color === c ? null : c)}
              role="button"
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Item detail (edit) ---------- */

const STATUS_OPTIONS: { id: ItemStatus; label: string }[] = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'todo', label: 'Todo' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
  { id: 'archived', label: 'Archived' },
];

export function ItemDetailModal({
  itemId,
  onClose,
  onOpenLabels,
}: {
  itemId: string;
  onClose: () => void;
  onOpenLabels: () => void;
}) {
  const items = useWB((s) => s.items);
  const labels = useWB((s) => s.labels);
  const files = useWB((s) => s.files);
  const updateItem = useWB((s) => s.updateItem);
  const deleteItemCascade = useWB((s) => s.deleteItemCascade);
  const toggleItemLabel = useWB((s) => s.toggleItemLabel);
  const setItemStatus = useWB((s) => s.setItemStatus);
  const startItemFocus = useWB((s) => s.startItemFocus);
  const setFocusOpen = useWB((s) => s.setFocusOpen);
  const toggleItemFile = useWB((s) => s.toggleItemFile);

  const item = items.find((i) => i.id === itemId) || null;

  const [title, setTitle] = useState(item?.title || '');
  const [type, setType] = useState<ItemType>(item?.type || 'task');
  const [deadline, setDeadline] = useState(item?.deadline || '');
  const [priority, setPriority] = useState<Priority>(item?.priority || 'p2');
  const [status, setStatus] = useState<ItemStatus>(item?.status || 'todo');
  const [estimate, setEstimate] = useState(item?.estimateMin ? String(item.estimateMin) : '');
  const [nextAction, setNextAction] = useState(item?.nextAction || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [manual, setManual] = useState(item?.manualProgress || 0);
  const [color, setColor] = useState<string | null>(item?.color ?? null);
  const [checklistText, setChecklistText] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([...(item?.dependsOn || [])]);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [fileSearch, setFileSearch] = useState('');

  const children = useMemo(() => (item ? wbChildren(items, item.id) : []), [items, item]);
  const hasChildren = children.length > 0;
  const pct = item ? computeProgress(item, (id) => wbChildren(items, id)) : 0;
  const itemLabels = item ? labels.filter((l) => l.itemIds.includes(item.id)) : [];
  const blocked = item ? wbIsBlocked(items, item) : false;
  const linkedFiles = item
    ? files.filter((f) => (item.fileIds || []).includes(f.id) && !f.archived)
    : [];
  const linkableFiles = item
    ? files.filter(
        (f) =>
          !f.archived &&
          !(item.fileIds || []).includes(f.id) &&
          (f.title.toLowerCase().includes(fileSearch.trim().toLowerCase()) ||
            f.fileName.toLowerCase().includes(fileSearch.trim().toLowerCase()))
      )
    : [];

  if (!item) return null;

  const path: string[] = [];
  {
    let cur: typeof item | undefined = item;
    while (cur) {
      path.unshift(cur.title);
      cur = cur.parentId ? items.find((i) => i.id === cur?.parentId) : undefined;
    }
  }

  const save = () => {
    const t = title.trim();
    if (!t) {
      toast('Title is required');
      return;
    }
    updateItem(item.id, {
      title: t,
      type,
      deadline: deadline || null,
      priority,
      status,
      estimateMin: estimate ? Number(estimate) : null,
      nextAction: nextAction.trim(),
      notes: notes.trim(),
      manualProgress: hasChildren ? item.manualProgress : manual,
      color,
      dependsOn,
    });
    toast('Saved', t);
    onClose();
  };

  const addChecklistItem = () => {
    const text = checklistText.trim();
    if (!text) return;
    updateItem(item.id, {
      checklist: [...item.checklist, { id: `cl-${Date.now()}`, text, done: false }],
    });
    setChecklistText('');
  };

  const depCandidates = items.filter(
    (i) => i.id !== item.id && wbCanDependOn(items, item.id, i.id)
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Item detail"
      footer={
        <>
          <Btn
            variant="danger"
            onClick={() => {
              if (confirm(`Delete "${item.title}"${hasChildren ? ' and all its sub-items' : ''}?`)) {
                deleteItemCascade(item.id);
                toast('Deleted', item.title);
                onClose();
              }
            }}
          >
            <Trash2 size={15} /> Delete
          </Btn>
          <span className="spacer" />
          <Btn variant="primary" onClick={save}>
            <Check size={15} /> Save
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {path.join(' / ')}
      </div>

      <div className="field">
        <label htmlFor="d-title">Title</label>
        <input id="d-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="d-type">Type</label>
          <select id="d-type" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
            <option value="goal">Goal</option>
            <option value="task">Task</option>
            <option value="note">Note</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-deadline">Deadline</label>
          <DateField id="d-deadline" value={deadline} onChange={setDeadline} compact placeholder="No deadline" />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="d-priority">Priority</label>
          <select id="d-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {(['p0', 'p1', 'p2', 'p3'] as Priority[]).map((p) => (
              <option key={p} value={p}>{p.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-status">Status</label>
          <select id="d-status" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="d-estimate">Estimate (min)</label>
          <input id="d-estimate" type="number" min={5} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="d-next">Next action</label>
        <input id="d-next" type="text" value={nextAction} placeholder="What physically happens next?" onChange={(e) => setNextAction(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="d-notes">Notes</label>
        <textarea id="d-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="field">
        <label>Progress · {pct}% {hasChildren ? '(from sub-items)' : item.checklist.length ? '(from checklist)' : ''}</label>
        {!hasChildren && item.checklist.length === 0 && (
          <input type="range" min={0} max={100} value={manual} onChange={(e) => setManual(Number(e.target.value))} />
        )}
        <div className="pbar" style={{ marginTop: 6 }}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="field">
        <label>Checklist {item.checklist.length > 0 && `· ${item.checklist.filter((c) => c.done).length}/${item.checklist.length}`}</label>
        {item.checklist.length > 0 && (
          <div className="checkbox-list" style={{ marginBottom: 8 }}>
            {item.checklist.map((c) => (
              <div key={c.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={c.done}
                  onChange={() =>
                    updateItem(item.id, {
                      checklist: item.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)),
                    })
                  }
                />
                <span style={{ flex: 1, textDecoration: c.done ? 'line-through' : 'none', color: c.done ? 'var(--faint)' : 'inherit', fontSize: 13 }}>
                  {c.text}
                </span>
                <button
                  className="icon-btn icon-btn-sm icon-btn-danger"
                  title="Remove"
                  onClick={() =>
                    updateItem(item.id, { checklist: item.checklist.filter((x) => x.id !== c.id) })
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={checklistText}
            placeholder="Add a checklist step…"
            onChange={(e) => setChecklistText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addChecklistItem()}
            style={{
              flex: 1, padding: '8px 12px', border: '1px solid var(--hairline)',
              borderRadius: 'var(--radius-wb-sm)', background: 'var(--surface-solid)', color: 'var(--ink)',
            }}
          />
          <Btn size="sm" onClick={addChecklistItem}>
            <Plus size={14} /> Add
          </Btn>
        </div>
      </div>

      <div className="field">
        <label>
          <Link2 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
          Blocked by {blocked && <span style={{ color: 'var(--coral)' }}>· currently blocked</span>}
        </label>
        {depCandidates.length ? (
          <div className="checkbox-list">
            {depCandidates.slice(0, 30).map((d) => (
              <label key={d.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={dependsOn.includes(d.id)}
                  onChange={() =>
                    setDependsOn((prev) => (prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]))
                  }
                />
                <span style={{ fontSize: 13 }}>{d.title}</span>
                {d.status !== 'done' && <span className="chip chip-soon" style={{ marginLeft: 'auto' }}>open</span>}
              </label>
            ))}
          </div>
        ) : (
          <div className="field-help">No other items available to depend on yet.</div>
        )}
      </div>

      <div className="field">
        <label>Color</label>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <div
              key={c}
              className={`swatch ${color === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(color === c ? null : c)}
              role="button"
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label>Labels</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {itemLabels.map((l) => (
            <button
              key={l.id}
              className="chip label-chip"
              style={{ background: `${l.color}22`, color: l.color }}
              onClick={() => toggleItemLabel(item.id, l.id)}
              title="Click to remove"
            >
              <span className="chip-dot" style={{ background: l.color }} />
              {l.name} ×
            </button>
          ))}
          <Btn size="sm" variant="ghost" onClick={onOpenLabels}>
            <Tag size={13} /> {itemLabels.length ? 'Manage' : 'Add labels'}
          </Btn>
        </div>
      </div>

      <div className="field">
        <label>
          <BookOpen size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
          Linked files {linkedFiles.length > 0 && `· ${linkedFiles.length}`}
        </label>
        {linkedFiles.length > 0 && (
          <div className="checkbox-list" style={{ marginBottom: 8 }}>
            {linkedFiles.map((f) => {
              const fp = wbFileProgress(f);
              const pages = wbFileReadPages(f);
              return (
                <div key={f.id} className="checkbox-row" style={{ alignItems: 'center' }}>
                  <BookOpen size={14} style={{ color: 'var(--violet)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.title}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <div className="pbar sm" style={{ flex: 1 }}>
                        <span style={{ width: `${fp}%`, background: 'var(--violet)' }} />
                      </div>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--muted2)', flexShrink: 0 }}>
                        {pages}/{f.pageCount}p · {fp}%
                      </span>
                    </div>
                  </div>
                  <Btn
                    size="sm"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: f.id }));
                    }}
                    title="Open in the reader"
                  >
                    Read
                  </Btn>
                  <button
                    className="icon-btn icon-btn-sm icon-btn-danger"
                    title="Unlink file"
                    onClick={() => {
                      toggleItemFile(item.id, f.id);
                      toast('File unlinked', f.title);
                    }}
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {linkPickerOpen ? (
          <div className="checkbox-list">
            <input
              type="text"
              placeholder="Search library files…"
              value={fileSearch}
              autoFocus
              onChange={(e) => setFileSearch(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid var(--hairline)',
                borderRadius: 'var(--radius-wb-sm)', background: 'var(--surface-solid)', color: 'var(--ink)',
                marginBottom: 6,
              }}
            />
            <div style={{ maxHeight: 168, overflowY: 'auto' }}>
              {linkableFiles.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="checkbox-row"
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', fontFamily: 'inherit',
                  }}
                  onClick={() => {
                    toggleItemFile(item.id, f.id);
                    setFileSearch('');
                    toast('File linked', f.title);
                  }}
                >
                  <BookOpen size={14} style={{ color: 'var(--violet)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.title}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>
                    {f.pageCount}p · p.{f.currentPage}
                  </span>
                </button>
              ))}
              {!linkableFiles.length && (
                <div className="field-help">
                  {files.length
                    ? 'No unlinked files match — add PDFs in the Library first.'
                    : 'Your library is empty — add PDFs in the Library view first.'}
                </div>
              )}
            </div>
            <Btn size="sm" variant="ghost" style={{ marginTop: 6 }} onClick={() => setLinkPickerOpen(false)}>
              Done
            </Btn>
          </div>
        ) : (
          <Btn size="sm" variant="ghost" onClick={() => setLinkPickerOpen(true)}>
            <Link2 size={13} /> {linkedFiles.length ? 'Link another file' : 'Link a library file'}
          </Btn>
        )}
        <div className="field-help" style={{ marginTop: 6 }}>
          One file can serve many goals — reading progress stays with the file.
        </div>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>Actions</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {item.status !== 'done' && (
            <>
              <Btn
                size="sm"
                variant="primary"
                onClick={() => {
                  const ok = startItemFocus(item.id);
                  if (ok) {
                    setFocusOpen(true);
                    onClose();
                    toast('Focus started', item.title);
                  } else {
                    toast('Cannot start focus', blocked ? 'This item is blocked by dependencies.' : 'A timer is already running.');
                  }
                }}
              >
                Focus on this
              </Btn>
              <Btn size="sm" onClick={() => { setItemStatus(item.id, 'done'); setStatus('done'); toast('Marked done', item.title); }}>
                <Check size={14} /> Mark done
              </Btn>
            </>
          )}
          {item.status === 'done' && (
            <Btn size="sm" onClick={() => { setItemStatus(item.id, 'todo'); setStatus('todo'); toast('Reopened', item.title); }}>
              Reopen
            </Btn>
          )}
        </div>
        {item.deadline && (
          <div className="field-help" style={{ marginTop: 8 }}>
            {(() => {
              const st = deadlineStatus(item, pct);
              const du = daysUntil(item.deadline);
              if (st === 'done') return 'Deadline met ✓';
              if (st === 'over') return `${Math.abs(du)} day${Math.abs(du) === 1 ? '' : 's'} overdue`;
              if (du === 0) return 'Due today';
              return `${du} day${du === 1 ? '' : 's'} left`;
            })()}
          </div>
        )}
      </div>
    </Modal>
  );
}

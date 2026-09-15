/* ==================== Goals & Work View: Tree · Board (DnD) · Matrix ==================== */
'use client';

import React, { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  Plus, Pencil, Trash2, ChevronRight, Tag, GripVertical, AlertTriangle, BookOpen,
  ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import {
  useWB, wbBlockedCount, wbChildren, wbFileProgress, wbIsBlocked, wbRootItems,
} from '@/lib/workbench/store';
import { computeProgress, daysUntil, deadlineStatus, priorityLabel } from '@/lib/workbench/helpers';
import type { GraphView, Item, ItemStatus } from '@/lib/workbench/types';
import { Btn, IconBtn, Seg, toast } from '../ui/primitives';
import { useViewActions } from './viewCtx';

/* ---------- header actions ---------- */

export function GoalsHeaderActions() {
  const graphView = useWB((s) => s.graphView);
  const setGraphView = useWB((s) => s.setGraphView);
  const { openItemForm, openLabels } = useViewActions();
  return (
    <>
      <Seg<GraphView>
        value={graphView}
        onChange={setGraphView}
        options={[
          { id: 'tree', label: 'Tree' },
          { id: 'kanban', label: 'Board' },
          { id: 'matrix', label: 'Matrix' },
        ]}
      />
      <Btn size="sm" onClick={openLabels}>
        <Tag size={14} /> Labels
      </Btn>
      <Btn size="sm" variant="primary" onClick={() => openItemForm(null)}>
        <Plus size={14} /> New goal
      </Btn>
    </>
  );
}

/* ---------- main view ---------- */

export function GoalsView() {
  const items = useWB((s) => s.items);
  const graphView = useWB((s) => s.graphView);
  const { openItemForm } = useViewActions();

  if (!items.length) {
    return (
      <div className="empty-state fade-in">
        <div className="es-title">No goals or work yet</div>
        Add your first goal — you can break it into sub-goals or tasks once it exists.
        <div style={{ marginTop: 12 }}>
          <Btn variant="primary" onClick={() => openItemForm(null)}>
            <Plus size={15} /> New goal
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {graphView === 'tree' && <TreeView />}
      {graphView === 'kanban' && <BoardView />}
      {graphView === 'matrix' && <MatrixView />}
    </div>
  );
}

/* ---------- Tree ---------- */

type StatusFilter = 'all' | 'active' | 'done';

function matchesFilters(
  item: Item,
  items: Item[],
  statusFilter: StatusFilter,
  overdueOnly: boolean,
  filesOnly: boolean
): boolean {
  const pct = computeProgress(item, (id) => wbChildren(items, id));
  if (statusFilter === 'active' && (pct >= 100 || ['done', 'archived'].includes(item.status))) return false;
  if (statusFilter === 'done' && (pct < 100 || item.status !== 'done')) return false;
  if (overdueOnly && deadlineStatus(item, pct) !== 'over') return false;
  if (filesOnly && !(item.fileIds || []).length) return false;
  return true;
}

/** keep an item only when it matches OR one of its descendants matches */
function filterTree(items: Item[], roots: Item[], fn: (i: Item) => boolean): Item[] {
  const keep = new Set<string>();
  const walk = (i: Item): boolean => {
    const kids = wbChildren(items, i.id);
    const kidsKeep = kids.map(walk);
    const self = fn(i);
    if (self || kidsKeep.some(Boolean)) {
      keep.add(i.id);
      return true;
    }
    return false;
  };
  roots.forEach(walk);
  return items.filter((i) => keep.has(i.id));
}

function TreeView() {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const expanded = useWB((s) => s.expanded);
  const toggleExpanded = useWB((s) => s.toggleExpanded);
  const deleteItemCascade = useWB((s) => s.deleteItemCascade);
  const updateItem = useWB((s) => s.updateItem);
  const setItemStatus = useWB((s) => s.setItemStatus);
  const { openItemForm, openItemDetail } = useViewActions();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [filesOnly, setFilesOnly] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [quickDraft, setQuickDraft] = useState('');

  const hasFilters = statusFilter !== 'all' || overdueOnly || filesOnly;
  const visible = hasFilters
    ? filterTree(items, wbRootItems(items), (i) =>
        matchesFilters(i, items, statusFilter, overdueOnly, filesOnly)
      )
    : items;
  const visibleRoots = wbRootItems(visible);

  const cycleStatus = (item: Item) => {
    const nextStatus: ItemStatus =
      item.status === 'todo' || item.status === 'inbox'
        ? 'in_progress'
        : item.status === 'in_progress'
          ? 'done'
          : 'todo';
    setItemStatus(item.id, nextStatus);
    toast(nextStatus === 'done' ? 'Marked done' : nextStatus === 'in_progress' ? 'Started' : 'Reopened', item.title);
  };

  const statusColor = (item: Item): string => {
    if (item.status === 'done') return 'var(--pine)';
    if (item.status === 'in_progress') return 'var(--amber)';
    if (item.status === 'waiting') return 'var(--coral)';
    return 'var(--faint)';
  };

  const renderNode = (item: Item, depth: number): React.ReactNode => {
    const children = wbChildren(visible, item.id);
    const allKids = wbChildren(items, item.id);
    const isOpen = hasFilters ? true : expanded[item.id] !== false;
    const pct = computeProgress(item, (id) => wbChildren(items, id));
    const st = deadlineStatus(item, pct);
    const blockedCount = wbBlockedCount(items, item);
    const linkedFiles = files.filter((f) => (item.fileIds || []).includes(f.id) && !f.archived);
    const filesPct = linkedFiles.length
      ? Math.round(linkedFiles.reduce((s, f) => s + wbFileProgress(f), 0) / linkedFiles.length)
      : null;
    let dueChip: React.ReactNode = null;
    if (item.deadline) {
      const du = daysUntil(item.deadline);
      const label = st === 'done' ? 'done' : st === 'over' ? `${Math.abs(du)}d overdue` : du === 0 ? 'due today' : `${du}d left`;
      dueChip = <span className={`chip chip-${st}`}>{label}</span>;
    }
    return (
      <div className="tree-node" key={item.id}>
        <div className="tree-row">
          <span
            className={`tree-caret ${allKids.length ? (isOpen ? 'open' : '') : 'leaf'}`}
            onClick={() => allKids.length && toggleExpanded(item.id)}
            role={allKids.length ? 'button' : undefined}
            aria-label={allKids.length ? (isOpen ? 'Collapse' : 'Expand') : undefined}
          >
            <ChevronRight />
            {allKids.length > 1 && (
              <span className="mono" style={{ fontSize: 9, position: 'absolute', left: 13, top: 9, color: 'var(--faint)' }}>
                {allKids.length}
              </span>
            )}
          </span>
          <span
            className="tree-dot"
            style={{
              background: statusColor(item),
              cursor: 'pointer',
              boxShadow: item.status === 'in_progress' ? '0 0 0 3px var(--amber-light)' : undefined,
            }}
            onClick={() => cycleStatus(item)}
            role="button"
            title="Click to cycle: todo → in progress → done"
            aria-label={`Status: ${item.status}. Click to change.`}
          />
          {renaming === item.id ? (
            <input
              autoFocus
              className="tree-title"
              style={{
                borderBottom: '2px solid var(--pine)', outline: 'none', background: 'transparent',
                padding: '0 2px', minWidth: 120, width: 'min(320px, 40vw)',
              }}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => {
                const t = renameDraft.trim();
                if (t && t !== item.title) {
                  updateItem(item.id, { title: t });
                  toast('Renamed', t);
                }
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <span
              className="tree-title"
              onClick={() => openItemDetail(item.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenameDraft(item.title);
                setRenaming(item.id);
              }}
              title={`${item.title} — double-click to rename`}
              role="button"
            >
              {item.title}
            </span>
          )}
          <span className="tree-meta">
            {blockedCount > 0 && (
              <span className="chip chip-over" title={`${blockedCount} unmet dependencies`}>
                <AlertTriangle size={11} /> {blockedCount}
              </span>
            )}
            {linkedFiles.length > 0 && (
              <span
                className="chip"
                style={{ background: 'var(--violet-light)', color: 'var(--violet)', gap: 4 }}
                title={`${linkedFiles.map((f) => f.title).join(', ')} — reading ${filesPct}%`}
                onClick={() => openItemDetail(item.id)}
                role="button"
              >
                <BookOpen size={11} /> {linkedFiles.length} {filesPct !== null ? `${filesPct}%` : ''}
              </span>
            )}
            {item.status === 'done' && <span className="chip chip-done">done</span>}
            {item.status === 'inbox' && <span className="chip chip-ok">inbox</span>}
            <span className="pbar sm">
              <span style={{ width: `${pct}%`, background: st === 'over' ? 'var(--coral)' : undefined }} />
            </span>
            <span className="tree-pct">{pct}%</span>
            {dueChip}
            <span className="tree-actions">
              <IconBtn
                small
                title="Add sub-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setQuickAdd(item.id);
                  setQuickDraft('');
                }}
              >
                <Plus size={14} />
              </IconBtn>
              <IconBtn small title="Edit details" onClick={(e) => { e.stopPropagation(); openItemDetail(item.id); }}>
                <Pencil size={14} />
              </IconBtn>
              <IconBtn
                small
                danger
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${item.title}"${allKids.length ? ' and all sub-items' : ''}?`)) {
                    deleteItemCascade(item.id);
                    toast('Deleted', item.title);
                  }
                }}
              >
                <Trash2 size={14} />
              </IconBtn>
            </span>
          </span>
        </div>
        {quickAdd === item.id && (
          <div className="tree-children" style={{ borderLeftStyle: 'dashed' }}>
            <div className="tree-row" style={{ paddingLeft: 2 }}>
              <input
                autoFocus
                className="tree-title"
                style={{
                  borderBottom: '2px solid var(--pine)', outline: 'none', background: 'transparent',
                  padding: '0 2px', minWidth: 160, flex: 1,
                }}
                placeholder="New sub-item — Enter to add, Esc to cancel"
                value={quickDraft}
                onChange={(e) => setQuickDraft(e.target.value)}
                onBlur={() => {
                  const t = quickDraft.trim();
                  if (t) {
                    useWB.getState().addItem({
                      title: t,
                      type: 'task',
                      parentId: item.id,
                      status: 'todo',
                    });
                    toast('Sub-item added', t);
                  }
                  setQuickAdd(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setQuickAdd(null);
                }}
              />
            </div>
          </div>
        )}
        {allKids.length > 0 && isOpen && (
          <div className="tree-children">{children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  const allExpanded = items.every((i) => expanded[i.id] !== false);

  return (
    <div className="fade-in">
      <div className="action-bar" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <Seg<StatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'done', label: 'Done' },
          ]}
        />
        <Btn
          size="sm"
          className={overdueOnly ? 'btn-primary' : ''}
          onClick={() => setOverdueOnly((v) => !v)}
        >
          <AlertTriangle size={13} /> Overdue
        </Btn>
        <Btn
          size="sm"
          className={filesOnly ? 'btn-primary' : ''}
          onClick={() => setFilesOnly((v) => !v)}
        >
          <BookOpen size={13} /> With files
        </Btn>
        <span className="spacer" />
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => {
            const next: Record<string, boolean> = {};
            items.forEach((i) => (next[i.id] = !allExpanded));
            useWB.setState({ expanded: next });
          }}
        >
          {allExpanded ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </Btn>
      </div>
      <div className="card" style={{ padding: 10 }}>
        {visibleRoots.length ? (
          visibleRoots.map((i) => renderNode(i, 0))
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 12.5, padding: '22px 8px' }}>
            {hasFilters ? 'Nothing matches these filters.' : 'Nothing here yet.'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Board (Kanban with drag & drop) ---------- */

const BOARD_COLS: { id: ItemStatus; label: string }[] = [
  { id: 'todo', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

function BoardView() {
  const items = useWB((s) => s.items);
  const moveItem = useWB((s) => s.moveItem);
  const { openItemDetail } = useViewActions();
  const [activeItem, setActiveItem] = useState<Item | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = (e: DragStartEvent) => {
    setActiveItem(items.find((i) => i.id === e.active.id) || null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveItem(null);
    const { active, over } = e;
    if (!over) return;
    const itemId = String(active.id);
    const targetStatus = String(over.id) as ItemStatus;
    const item = items.find((i) => i.id === itemId);
    if (!item || item.status === targetStatus) return;
    moveItem(itemId, targetStatus);
    toast('Moved', `${item.title} → ${BOARD_COLS.find((c) => c.id === targetStatus)?.label}`);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="board">
        {BOARD_COLS.map((col) => {
          const colItems = items.filter(
            (i) =>
              (i.status || 'todo') === col.id &&
              computeProgress(i, (id) => wbChildren(items, id)) < 100 &&
              i.status !== 'archived'
          );
          return <BoardColumn key={col.id} col={col} items={colItems} onOpen={openItemDetail} />;
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }}>
        {activeItem && (
          <div className="board-item dragging" style={{ width: 260 }}>
            <div className="board-item-title">{activeItem.title}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  col,
  items,
  onOpen,
}: {
  col: { id: ItemStatus; label: string };
  items: Item[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const items_ = items;
  return (
    <div className={`board-col ${isOver ? 'drag-over' : ''}`} ref={setNodeRef} data-status={col.id}>
      <div className="board-head">
        <span className="board-title">{col.label}</span>
        <span className="board-count">{items_.length}</span>
      </div>
      <div className="board-items">
        {items_.map((i) => (
          <BoardCard key={i.id} item={i} onOpen={onOpen} />
        ))}
        {items_.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 12, padding: '26px 8px', border: '1px dashed var(--hairline)', borderRadius: 14 }}>
            Drag cards here
          </div>
        )}
      </div>
    </div>
  );
}

function BoardCard({ item, onOpen }: { item: Item; onOpen: (id: string) => void }) {
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id });
  const pct = computeProgress(item, (id) => wbChildren(items, id));
  const blocked = wbIsBlocked(items, item);
  const fileCount = (item.fileIds || []).filter((fid) =>
    files.some((f) => f.id === fid && !f.archived)
  ).length;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`board-item ${isDragging ? 'dragging' : ''}`}
      onClick={() => onOpen(item.id)}
      role="button"
      aria-label={`Open ${item.title}`}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <GripVertical size={13} style={{ color: 'var(--faint)', flexShrink: 0, marginTop: 1, cursor: 'grab' }} />
        <div className="board-item-title" style={{ flex: 1 }}>{item.title}</div>
      </div>
      <div className="board-item-meta">
        {item.type === 'goal' && <span className="chip chip-done" style={{ fontSize: 10 }}>goal</span>}
        <span className="chip chip-ok" style={{ fontSize: 10 }}>{priorityLabel(item.priority)}</span>
        {item.deadline && <span className="mono" style={{ fontSize: 10, color: 'var(--muted2)' }}>{item.deadline.slice(5)}</span>}
        {blocked && <span className="chip chip-over" style={{ fontSize: 10 }}>blocked</span>}
        {fileCount > 0 && (
          <span className="chip" style={{ fontSize: 10, background: 'var(--violet-light)', color: 'var(--violet)' }}>
            <BookOpen size={10} /> {fileCount}
          </span>
        )}
        {pct > 0 && pct < 100 && <span className="mono" style={{ fontSize: 10, color: 'var(--pine)' }}>{pct}%</span>}
        {item.estimateMin != null && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{item.estimateMin}m</span>}
      </div>
    </div>
  );
}

/* ---------- Matrix (Eisenhower) ---------- */

function MatrixView() {
  const items = useWB((s) => s.items);
  const { openItemDetail } = useViewActions();
  const active = items.filter((i) => computeProgress(i, (id) => wbChildren(items, id)) < 100 && i.status !== 'archived');
  const isUrgent = (i: Item) => !!i.deadline && daysUntil(i.deadline) <= 3;
  const isImportant = (i: Item) => i.priority === 'p0' || i.priority === 'p1';

  const Q = [
    { t: 'Do First', d: 'Urgent & Important', c: 'var(--coral)', b: 'var(--coral-light)', list: active.filter((i) => isUrgent(i) && isImportant(i)) },
    { t: 'Schedule', d: 'Important · Not Urgent', c: 'var(--pine)', b: 'var(--pine-light)', list: active.filter((i) => !isUrgent(i) && isImportant(i)) },
    { t: 'Delegate', d: 'Urgent · Not Important', c: 'var(--amber)', b: 'var(--amber-light)', list: active.filter((i) => isUrgent(i) && !isImportant(i)) },
    { t: 'Eliminate', d: 'Neither', c: 'var(--faint)', b: 'var(--surface-alt)', list: active.filter((i) => !isUrgent(i) && !isImportant(i)) },
  ];

  return (
    <div className="matrix">
      {Q.map((q) => (
        <div key={q.t} className="matrix-card" style={{ background: q.b }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 750, color: q.c, fontFamily: 'var(--font-sora)' }}>{q.t}</span>
            <span style={{ fontSize: 11, color: 'var(--muted2)' }}>{q.d}</span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted2)' }}>{q.list.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {q.list.map((i) => (
              <div key={i.id} className="matrix-item" onClick={() => openItemDetail(i.id)} role="button">
                {i.title}
              </div>
            ))}
            {q.list.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 12, padding: 14 }}>
                Nothing here
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ==================== Command Palette (commands + global search) ==================== */
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun, LayoutGrid, Target, Repeat, BookOpen, Library as LibraryIcon, Waypoints,
  CalendarDays, CalendarClock, BarChart3, Inbox,
  Play, Square, Focus, Tag, Palette, Undo2, Sparkles, Search as SearchIcon,
  Settings2, FileText, Timer as TimerIcon,
} from 'lucide-react';
import { useWB, wbChildren, wbFilePositionLabel, wbFileProgress } from '@/lib/workbench/store';
import { computeHabitStreak, computeProgress, fmtDuration } from '@/lib/workbench/helpers';
import { Modal } from '../ui/primitives';

interface CmdRow {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onOpenLabels,
  onOpenSettings,
  onOpenCapture,
}: {
  open: boolean;
  onClose: () => void;
  onOpenLabels: () => void;
  onOpenSettings: () => void;
  onOpenCapture: () => void;
}) {
  const store = useWB();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const commands: CmdRow[] = useMemo(() => {
    const go = (v: Parameters<typeof store.setView>[0]) => () => {
      store.setView(v);
      onClose();
    };
    const rows: CmdRow[] = [
      { id: 'cap', group: 'Actions', label: 'Quick capture', sub: 'C', icon: <Sparkles size={16} />, action: () => { onClose(); onOpenCapture(); } },
      store.activeTimer
        ? { id: 'stop', group: 'Actions', label: 'Stop timer', icon: <Square size={16} />, action: () => { store.stopTimer(); onClose(); } }
        : { id: 'start', group: 'Actions', label: 'Start quick timer', sub: 'T', icon: <Play size={16} />, action: () => { store.startTimer([], ''); onClose(); } },
      { id: 'focus', group: 'Actions', label: 'Open Focus Mode', sub: 'F', icon: <Focus size={16} />, action: () => { store.setFocusOpen(true); onClose(); } },
      { id: 'undo', group: 'Actions', label: 'Undo', sub: 'Ctrl+Z', icon: <Undo2 size={16} />, action: () => { store.undo(); onClose(); } },
      { id: 'theme', group: 'Actions', label: 'Cycle theme', sub: 'Ctrl+J', icon: <Palette size={16} />, action: () => { store.cycleTheme(); onClose(); } },
      { id: 'labels', group: 'Manage', label: 'Manage labels', icon: <Tag size={16} />, action: () => { onClose(); onOpenLabels(); } },
      { id: 'settings', group: 'Manage', label: 'Settings — theme, calendar, backup, shortcuts', icon: <Settings2 size={16} />, action: () => { onClose(); onOpenSettings(); } },
      { id: 'v-today', group: 'Go to', label: 'Today', icon: <Sun size={16} />, action: go('today') },
      { id: 'v-inbox', group: 'Go to', label: 'Inbox', icon: <Inbox size={16} />, action: go('inbox') },
      { id: 'v-dash', group: 'Go to', label: 'Dashboard', icon: <LayoutGrid size={16} />, action: go('dashboard') },
      { id: 'v-goals', group: 'Go to', label: 'Goals & Work', icon: <Target size={16} />, action: go('goals') },
      { id: 'v-library', group: 'Go to', label: 'Library', sub: 'G B', icon: <LibraryIcon size={16} />, action: go('library') },
      { id: 'v-roadmap', group: 'Go to', label: 'Roadmaps', sub: 'G M', icon: <Waypoints size={16} />, action: go('roadmap') },
      { id: 'v-planner', group: 'Go to', label: 'Planner', sub: 'G P', icon: <CalendarClock size={16} />, action: go('planner') },
      { id: 'v-reports', group: 'Go to', label: 'Reports & Activity log', sub: 'G R', icon: <BarChart3 size={16} />, action: go('reports') },
      { id: 'v-habits', group: 'Go to', label: 'Habits', icon: <Repeat size={16} />, action: go('habits') },
      { id: 'v-journal', group: 'Go to', label: 'Journal', icon: <BookOpen size={16} />, action: go('journal') },
      { id: 'v-calendar', group: 'Go to', label: 'Calendar', icon: <CalendarDays size={16} />, action: go('calendar') },
    ];
    return rows;
  }, [store.activeTimer, open]);

  const results: CmdRow[] = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return commands;
    const out: CmdRow[] = [];
    commands.forEach((c) => {
      if (c.label.toLowerCase().includes(query)) out.push(c);
    });
    /* search items */
    store.items.forEach((i) => {
      const hay = [i.title, i.notes, i.nextAction, i.priority, i.type].join(' ').toLowerCase();
      if (hay.includes(query)) {
        const pct = computeProgress(i, (id) => wbChildren(store.items, id));
        out.push({
          id: `item-${i.id}`,
          group: i.type === 'goal' ? 'Goals' : i.type === 'note' ? 'Notes' : 'Tasks',
          label: i.title,
          sub: `${pct}% · ${i.status.replace('_', ' ')}`,
          icon: <Target size={16} />,
          action: () => { onClose(); onOpenItemDetail(i.id); },
        });
      }
    });
    /* library files */
    store.files.forEach((f) => {
      if ((f.title + ' ' + f.fileName + ' ' + f.tags.join(' ')).toLowerCase().includes(query)) {
        out.push({
          id: `file-${f.id}`,
          group: 'Library',
          label: f.title,
          sub: `${wbFileProgress(f)}% · ${wbFilePositionLabel(f)}`,
          icon: <FileText size={16} />,
          action: () => {
            onClose();
            window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: f.id }));
          },
        });
      }
    });
    /* roadmaps */
    store.roadmaps.forEach((r) => {
      if ((r.title + ' ' + r.description).toLowerCase().includes(query)) {
        out.push({
          id: `rm-${r.id}`,
          group: 'Roadmaps',
          label: r.title,
          sub: `${r.nodes.length} nodes · ${r.edges.length} links`,
          icon: <Waypoints size={16} />,
          action: () => {
            onClose();
            store.setActiveRoadmap(r.id);
            store.setView('roadmap');
          },
        });
      }
    });
    /* journal */
    store.journal.forEach((j) => {
      if ((j.date + ' ' + j.content).toLowerCase().includes(query)) {
        out.push({
          id: `jr-${j.id}`,
          group: 'Journal',
          label: j.date,
          sub: j.content.slice(0, 60) || 'empty',
          icon: <FileText size={16} />,
          action: () => { onClose(); store.setView('journal'); },
        });
      }
    });
    /* habits */
    store.habits.forEach((h) => {
      if ((h.name + ' ' + h.description).toLowerCase().includes(query)) {
        out.push({
          id: `hb-${h.id}`,
          group: 'Habits',
          label: h.name,
          sub: `streak ${computeHabitStreak(h.log, h.cadence)}d`,
          icon: <Repeat size={16} />,
          action: () => { onClose(); store.setView('habits'); },
        });
      }
    });
    /* labels */
    store.labels.forEach((l) => {
      if (l.name.toLowerCase().includes(query)) {
        out.push({
          id: `lb-${l.id}`,
          group: 'Labels',
          label: l.name,
          sub: `${l.itemIds.length} items`,
          icon: <Tag size={16} />,
          action: () => { onClose(); onOpenLabels(); },
        });
      }
    });
    /* entries */
    store.entries.slice().reverse().slice(0, 200).forEach((e) => {
      if (e.note && e.note.toLowerCase().includes(query)) {
        out.push({
          id: `en-${e.id}`,
          group: 'Logged time',
          label: e.note,
          sub: `${e.date} · ${fmtDuration(e.durationMin)}`,
          icon: <TimerIcon size={16} />,
          action: () => { onClose(); store.setView('reports'); },
        });
      }
    });
    return out.slice(0, 40);
  }, [q, commands, store.items, store.journal, store.habits, store.labels, store.entries, store.files, store.roadmaps, onClose, onOpenLabels]);

  const grouped = useMemo(() => {
    const m: Map<string, CmdRow[]> = new Map();
    results.forEach((r) => {
      const arr = m.get(r.group) || [];
      arr.push(r);
      m.set(r.group, arr);
    });
    return [...m.entries()];
  }, [results]);

  useEffect(() => {
    setSel(0);
  }, [q]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-sel="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const flat = grouped.flatMap(([, rows]) => rows);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[sel]?.action();
    }
  };

  let idx = -1;

  return (
    <Modal open={open} onClose={onClose} title="">
      <div style={{ marginTop: -16 }}>
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          value={q}
          placeholder="Type a command, or search everything…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          aria-label="Command palette search"
        />
        <div className="cmdk-list" ref={listRef} onKeyDown={(e) => e.stopPropagation()}>
          {!q && (
            <div className="cmdk-group" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SearchIcon size={11} /> Type to search tasks, files, roadmaps, journal, habits, labels…
            </div>
          )}
          {grouped.map(([group, rows]) => (
            <div key={group}>
              <div className="cmdk-group">{group}</div>
              {rows.map((r) => {
                idx++;
                const isSel = idx === sel;
                return (
                  <button
                    key={r.id}
                    className={`cmdk-row ${isSel ? 'selected' : ''}`}
                    data-sel={isSel}
                    onMouseEnter={() => setSel(flat.indexOf(r))}
                    onClick={() => r.action()}
                    type="button"
                  >
                    {r.icon}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                    {r.sub && <span className="cmdk-sub">{r.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && (
            <div className="empty-state" style={{ padding: '28px 16px', borderWidth: 0 }}>
              <div className="es-title" style={{ fontSize: 13 }}>No matches.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Try a different word, or press Esc.</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );

  function onOpenItemDetail(id: string) {
    /* detail modal opens via custom event handled by app root */
    window.dispatchEvent(new CustomEvent('wb-open-item', { detail: id }));
  }
}

/* ==================== App Shell: Sidebar · Topbar · Footer ==================== */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sun, LayoutGrid, Target, Repeat, BookOpen, BookA, Library as LibraryIcon, Waypoints,
  CalendarDays, CalendarClock, BarChart3,
  Inbox, Focus, Play, Square, Settings as SettingsIcon, Undo2, Redo2,
  Menu, Command, Zap, Timer as TimerIcon, CheckCircle2, X, PanelLeftClose,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { fmtClock, fmtDuration, todayStr } from '@/lib/workbench/helpers';
import type { ViewId } from '@/lib/workbench/types';
import { Btn, IconBtn, toast, useNow } from './ui/primitives';

/* ---------- Nav definition (v6: activity log merged into Reports) ---------- */

const NAV: { id: ViewId; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: 'today', label: 'Today', icon: <Sun />, shortcut: 'G T' },
  { id: 'inbox', label: 'Inbox', icon: <Inbox />, shortcut: 'G I' },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutGrid />, shortcut: 'G D' },
  { id: 'goals', label: 'Goals & Work', icon: <Target />, shortcut: 'G G' },
  { id: 'library', label: 'Library', icon: <LibraryIcon />, shortcut: 'G B' },
  { id: 'roadmap', label: 'Roadmaps', icon: <Waypoints />, shortcut: 'G M' },
  { id: 'planner', label: 'Planner', icon: <CalendarClock />, shortcut: 'G P' },
  { id: 'habits', label: 'Habits', icon: <Repeat />, shortcut: 'G H' },
  { id: 'journal', label: 'Journal', icon: <BookOpen />, shortcut: 'G J' },
  { id: 'calendar', label: 'Calendar', icon: <CalendarDays />, shortcut: 'G C' },
  { id: 'reports', label: 'Reports', icon: <BarChart3 />, shortcut: 'G R' },
  { id: 'vocab', label: 'Vocabulary', icon: <BookA />, shortcut: 'G V' },
];

/* ---------- Running timer pill ---------- */

function TimerPill() {
  const activeTimer = useWB((s) => s.activeTimer);
  const stopTimer = useWB((s) => s.stopTimer);
  const collapsed = useWB((s) => s.sidebarCollapsed);
  const now = useNow(!!activeTimer);
  if (!activeTimer) return null;
  const secs = Math.floor((now.getTime() - new Date(activeTimer.startedAt).getTime()) / 1000);
  const phase = activeTimer.pomodoro
    ? activeTimer.pomodoro.phase === 'work'
      ? 'Focus'
      : 'Break'
    : 'Timer';
  return (
    <div className="timer-pill" title={`${phase} · ${fmtClock(secs)}`}>
      <span className="timer-pill-dot" />
      {!collapsed && (
        <span className="mono" style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {fmtClock(secs)}
        </span>
      )}
      <IconBtn title="Stop timer" small onClick={() => { stopTimer(); toast('Entry logged'); }}>
        <Square />
      </IconBtn>
    </div>
  );
}

/* ---------- Sidebar ---------- */

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
}

export function Sidebar(props: SidebarProps) {
  const collapsed = useWB((s) => s.sidebarCollapsed);
  const setCollapsed = useWB((s) => s.setSidebarCollapsed);
  const [peek, setPeek] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* hover-peek is a desktop affordance only (mobile uses the drawer) */
  const clearTimers = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    hoverTimer.current = null;
    closeTimer.current = null;
  };
  const onRailEnter = () => {
    if (!collapsed || props.open || window.matchMedia('(max-width: 900px)').matches) return;
    clearTimers();
    hoverTimer.current = setTimeout(() => setPeek(true), 150);
  };
  const schedulePeekClose = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setPeek(false), 120);
  };
  const cancelPeekClose = () => clearTimers();

  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPeek(false);
        clearTimers();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek]);

  const expand = () => {
    setCollapsed(false);
    setPeek(false);
    clearTimers();
  };

  return (
    <>
      {props.open && <div className="mobile-backdrop" onClick={props.onClose} aria-hidden="true" />}
      <aside
        className={`wb-sidebar ${props.open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}
        aria-label="Main navigation"
        onMouseEnter={onRailEnter}
        onMouseLeave={schedulePeekClose}
      >
        <SidebarInner {...props} collapsed={collapsed} peek={false} onExpand={expand} />
      </aside>
      {peek &&
        createPortal(
          <div
            className="wb-sidebar peek"
            role="navigation"
            aria-label="Navigation preview"
            onMouseEnter={cancelPeekClose}
            onMouseLeave={schedulePeekClose}
          >
            <SidebarInner {...props} collapsed={false} peek onExpand={expand} />
          </div>,
          document.body
        )}
    </>
  );
}

function SidebarInner({
  open,
  onClose,
  onOpenSettings,
  onOpenPalette,
  collapsed,
  peek,
  onExpand,
}: SidebarProps & { collapsed: boolean; peek: boolean; onExpand: () => void }) {
  const view = useWB((s) => s.view);
  const setView = useWB((s) => s.setView);
  const toggleCollapsed = useWB((s) => s.toggleSidebarCollapsed);
  const setFocusOpen = useWB((s) => s.setFocusOpen);

  const go = (id: ViewId) => {
    setView(id);
    if (peek) onExpand(); /* peek click = navigate + expand */
    else onClose();
  };

  return (
    <>
      <div className="brand">
        <button
          type="button"
          className={`brand-mark ${collapsed && !peek ? 'brand-expand' : ''}`}
          onClick={() => {
            if (peek || collapsed) onExpand();
          }}
          title={collapsed && !peek ? 'Expand sidebar' : undefined}
          aria-label={collapsed && !peek ? 'Expand sidebar' : 'Workbench'}
          tabIndex={collapsed && !peek ? 0 : -1}
        >
          <Target />
        </button>
        <span className="brand-name wb-display">Workbench</span>
        {!collapsed && (
          <button
            className="sb-collapse"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onClick={toggleCollapsed}
            style={{ marginLeft: 'auto' }}
            type="button"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
        <button
          className="icon-btn"
          style={{ display: 'none' }}
          id="sidebarCloseBtn"
          aria-label="Close menu"
          onClick={onClose}
        >
          <X />
        </button>
      </div>

      <nav className="mainnav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`navlink ${view === n.id ? 'active' : ''}`}
            onClick={() => go(n.id)}
            title={collapsed && !peek ? n.label : undefined}
            aria-current={view === n.id ? 'page' : undefined}
          >
            {n.icon}
            <span className="lbl">{n.label}</span>
            <span className="nav-kbd">{n.shortcut}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <TimerPill />

      <button
        className="focus-btn-sidebar"
        onClick={() => {
          setFocusOpen(true);
          if (peek) onExpand();
          else onClose();
        }}
        title={collapsed && !peek ? 'Focus mode' : undefined}
      >
        <Focus />
        <span className="lbl">Focus Mode</span>
        <span className="nav-kbd">F</span>
      </button>

      <div className="sidebar-foot">
        <button className="sidebar-btn" onClick={onOpenSettings} title="Settings — theme, calendar, backup, shortcuts">
          <SettingsIcon />
          <span className="lbl">Settings</span>
          <span className="nav-kbd">,</span>
        </button>
        <button className="sidebar-btn" onClick={onOpenPalette} title="Command palette (⌘K)">
          <Command />
          <span className="lbl">Commands</span>
          <span className="nav-kbd">⌘K</span>
        </button>
        {!collapsed && <SaveIndicator />}
      </div>
    </>
  );
}

function SaveIndicator() {
  const [saved, setSaved] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    const unsub = useWB.subscribe(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      setSaved(new Date().toLocaleTimeString());
    });
    return unsub;
  }, []);
  return <div className="sidebar-save">{saved ? `Saved ${saved}` : 'Local autosave ready'}</div>;
}

/* ---------- Topbar ---------- */

export function Topbar({ onMenu, onOpenPalette, onOpenSettings }: { onMenu: () => void; onOpenPalette: () => void; onOpenSettings: () => void }) {
  const undo = useWB((s) => s.undo);
  const redo = useWB((s) => s.redo);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    const check = () => {
      const st = useWB.getState();
      setCanUndo(st.undoStack.length > 0);
      setCanRedo(st.redoStack.length > 0);
    };
    const unsub = useWB.subscribe(check);
    check();
    return unsub;
  }, []);

  return (
    <header className="wb-topbar">
      <IconBtn title="Menu" onClick={onMenu} className="menu-toggle" aria-label="Open menu">
        <Menu />
      </IconBtn>
      <Btn size="sm" variant="ghost" onClick={onOpenPalette}>
        <Command />
        <span>Commands</span>
        <span className="kbd" style={{ marginLeft: 4 }}>⌘K</span>
      </Btn>
      <div className="topbar-spacer" />
      <IconBtn
        title={`Undo (Ctrl+Z)${canUndo ? '' : ' — nothing to undo'}`}
        onClick={() => {
          if (undo()) toast('Undone');
          else toast('Nothing to undo');
        }}
        aria-label="Undo"
      >
        <Undo2 />
      </IconBtn>
      <IconBtn
        title={`Redo (Ctrl+Shift+Z)${canRedo ? '' : ' — nothing to redo'}`}
        onClick={() => {
          if (redo()) toast('Redone');
          else toast('Nothing to redo');
        }}
        aria-label="Redo"
      >
        <Redo2 />
      </IconBtn>
      <IconBtn title="Settings" onClick={onOpenSettings} aria-label="Settings">
        <SettingsIcon />
      </IconBtn>
    </header>
  );
}

/* ---------- Status footer (sticky bottom) ---------- */

export function StatusFooter() {
  const items = useWB((s) => s.items);
  const entries = useWB((s) => s.entries);
  const habits = useWB((s) => s.habits);
  const files = useWB((s) => s.files);
  const activeTimer = useWB((s) => s.activeTimer);
  const stats = useWB((s) => s.stats);
  const now = useNow(!!activeTimer);

  const today = todayStr();
  const todayMin = entries.filter((e) => e.date === today).reduce((s, e) => s + e.durationMin, 0);
  const activeCount = items.filter((i) => i.status !== 'done' && i.status !== 'archived' && i.status !== 'inbox').length;
  const habitsDone = habits.filter((h) => h.log?.[today]).length;
  const timerSecs = activeTimer
    ? Math.floor((now.getTime() - new Date(activeTimer.startedAt).getTime()) / 1000)
    : 0;

  return (
    <footer className="wb-footer">
      <span className="foot-item">
        <Zap size={13} />
        {activeTimer ? (
          <span className="mono" style={{ color: activeTimer.fileId ? 'var(--violet)' : 'var(--pine)', fontWeight: 700 }}>
            {activeTimer.fileId
              ? 'Reading'
              : activeTimer.pomodoro
                ? activeTimer.pomodoro.phase === 'work' ? 'Focus' : 'Break'
                : 'Timer'} · {fmtClock(timerSecs)}
          </span>
        ) : (
          <span>Ready</span>
        )}
      </span>
      <span className="foot-item">
        <TimerIcon />
        {fmtDuration(todayMin)} today
      </span>
      <span className="foot-item">
        <Target size={13} />
        {activeCount} active
      </span>
      <span className="foot-item">
        <CheckCircle2 />
        {habitsDone}/{habits.length} habits
      </span>
      <span className="foot-spacer" />
      <span className="foot-item opt-files" title="PDF files in your library">
        <BookOpen />
        {files.filter((f) => !f.archived).length} file{files.filter((f) => !f.archived).length === 1 ? '' : 's'}
      </span>
      <span className="foot-item" title="Total focus sessions, minutes and reading time tracked">
        <Focus />
        {stats.focusSessions} sessions · {fmtDuration(stats.focusMinutes)}
      </span>
      {stats.readingMinutes > 0 && (
        <span className="foot-item opt-reading" title="Total reading time and pages read">
          <LibraryIcon />
          {fmtDuration(stats.readingMinutes)} read · {stats.pagesRead}p
        </span>
      )}
      <span className="foot-item" style={{ color: 'var(--faint)' }}>
        Workbench Aurora · local-first
      </span>
    </footer>
  );
}

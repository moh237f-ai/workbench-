/* ==================== App Shell: Sidebar · Topbar · Footer ==================== */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Sun, LayoutGrid, Target, Clock, Repeat, BookOpen, Library as LibraryIcon, Waypoints,
  CalendarDays, CalendarClock, BarChart3,
  Inbox, Focus, Play, Square, Download, Keyboard, Sparkles, Undo2, Redo2,
  Menu, Command, Zap, Palette, Timer as TimerIcon, CheckCircle2, X,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { fmtClock, fmtDuration, todayStr } from '@/lib/workbench/helpers';
import { dateToShamsi, formatShamsi } from '@/lib/workbench/shamsi';
import type { ViewId } from '@/lib/workbench/types';
import { Btn, IconBtn, toast, useNow } from './ui/primitives';

/* ---------- Nav definition ---------- */

const NAV: { id: ViewId; label: string; icon: React.ReactNode; shortcut: string }[] = [
  { id: 'today', label: 'Today', icon: <Sun />, shortcut: 'G T' },
  { id: 'inbox', label: 'Inbox', icon: <Inbox />, shortcut: 'G I' },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutGrid />, shortcut: 'G D' },
  { id: 'goals', label: 'Goals & Work', icon: <Target />, shortcut: 'G G' },
  { id: 'library', label: 'Library', icon: <LibraryIcon />, shortcut: 'G B' },
  { id: 'roadmap', label: 'Roadmaps', icon: <Waypoints />, shortcut: 'G M' },
  { id: 'planner', label: 'Planner', icon: <CalendarClock />, shortcut: 'G P' },
  { id: 'log', label: 'Activity Log', icon: <Clock />, shortcut: 'G L' },
  { id: 'habits', label: 'Habits', icon: <Repeat />, shortcut: 'G H' },
  { id: 'journal', label: 'Journal', icon: <BookOpen />, shortcut: 'G J' },
  { id: 'calendar', label: 'Calendar', icon: <CalendarDays />, shortcut: 'G C' },
  { id: 'reports', label: 'Reports', icon: <BarChart3 />, shortcut: 'G R' },
];

/* ---------- Sidebar clock ---------- */

function SidebarClock() {
  const now = useNow();
  const h12 = now.getHours() % 12 || 12;
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  const shamsi = dateToShamsi(now);
  return (
    <div className="sidebar-clock" aria-label="Current time">
      <svg viewBox="0 0 60 60" style={{ width: 46, height: 46 }} aria-hidden="true">
        <circle cx="30" cy="30" r="27" fill="rgba(127,127,127,0.05)" stroke="var(--sidebar-border2)" strokeWidth="1.5" />
        {[0, 3, 6, 9].map((h) => {
          const a = (h * 30 - 90) * (Math.PI / 180);
          return (
            <line
              key={h}
              x1={30 + Math.cos(a) * 21} y1={30 + Math.sin(a) * 21}
              x2={30 + Math.cos(a) * 25} y2={30 + Math.sin(a) * 25}
              stroke="var(--sidebar-muted)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6"
            />
          );
        })}
        <line
          x1="30" y1="30"
          x2={30 + Math.cos(((now.getHours() % 12) * 30 + now.getMinutes() * 0.5 - 90) * (Math.PI / 180)) * 13}
          y2={30 + Math.sin(((now.getHours() % 12) * 30 + now.getMinutes() * 0.5 - 90) * (Math.PI / 180)) * 13}
          stroke="var(--sidebar-ink)" strokeWidth="2.2" strokeLinecap="round"
        />
        <line
          x1="30" y1="30"
          x2={30 + Math.cos((now.getMinutes() * 6 - 90) * (Math.PI / 180)) * 19}
          y2={30 + Math.sin((now.getMinutes() * 6 - 90) * (Math.PI / 180)) * 19}
          stroke="var(--sidebar-ink)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8"
        />
        <line
          x1="30" y1="30"
          x2={30 + Math.cos((now.getSeconds() * 6 - 90) * (Math.PI / 180)) * 21}
          y2={30 + Math.sin((now.getSeconds() * 6 - 90) * (Math.PI / 180)) * 21}
          stroke="var(--pine)" strokeWidth="0.9" strokeLinecap="round"
        />
        <circle cx="30" cy="30" r="1.6" fill="var(--pine)" />
      </svg>
      <div className="sidebar-clock-time">
        {String(h12).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
        <span style={{ fontSize: 10, opacity: 0.55, marginLeft: 3 }}>{ampm}</span>
      </div>
      <div className="sidebar-clock-date">
        {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>
      <div className="sidebar-clock-shamsi mono">{formatShamsi(shamsi, true)}</div>
    </div>
  );
}

/* ---------- Running timer pill ---------- */

function TimerPill() {
  const activeTimer = useWB((s) => s.activeTimer);
  const stopTimer = useWB((s) => s.stopTimer);
  const now = useNow(!!activeTimer);
  if (!activeTimer) return null;
  const secs = Math.floor((now.getTime() - new Date(activeTimer.startedAt).getTime()) / 1000);
  const phase = activeTimer.pomodoro
    ? activeTimer.pomodoro.phase === 'work'
      ? 'Focus'
      : 'Break'
    : 'Timer';
  return (
    <div className="timer-pill">
      <span className="timer-pill-dot" />
      <span className="mono" style={{ fontSize: 13, fontWeight: 700, flex: 1 }} title={phase}>
        {fmtClock(secs)}
      </span>
      <IconBtn title="Stop timer" small onClick={() => { stopTimer(); toast('Entry logged'); }}>
        <Square />
      </IconBtn>
    </div>
  );
}

/* ---------- Sidebar ---------- */

export function Sidebar({
  open,
  onClose,
  onOpenShortcuts,
  onOpenData,
  onOpenPalette,
}: {
  open: boolean;
  onClose: () => void;
  onOpenShortcuts: () => void;
  onOpenData: () => void;
  onOpenPalette: () => void;
}) {
  const view = useWB((s) => s.view);
  const setView = useWB((s) => s.setView);
  const setFocusOpen = useWB((s) => s.setFocusOpen);
  const theme = useWB((s) => s.theme);
  const cycleTheme = useWB((s) => s.cycleTheme);

  const themeLabels: Record<string, string> = {
    light: 'Light · Cream',
    dark: 'Dark · Night',
    prism: 'Prism · Signal',
  };

  return (
    <>
      {open && <div className="mobile-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`wb-sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">
            <Target />
          </div>
          <span className="brand-name wb-display">Workbench</span>
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto', display: 'none' }}
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
              onClick={() => {
                setView(n.id);
                onClose();
              }}
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
            onClose();
          }}
        >
          <Focus />
          <span className="lbl">Focus Mode</span>
          <span className="nav-kbd">F</span>
        </button>

        <div style={{ padding: '4px 0 10px' }}>
          <SidebarClock />
        </div>

        <div className="sidebar-foot">
          <button className="sidebar-btn" onClick={onOpenPalette}>
            <Command />
            <span className="lbl">Commands</span>
            <span className="nav-kbd">⌘K</span>
          </button>
          <button className="sidebar-btn" onClick={onOpenData}>
            <Download />
            <span className="lbl">Backup &amp; Data</span>
          </button>
          <button className="sidebar-btn" onClick={onOpenShortcuts}>
            <Keyboard />
            <span className="lbl">Shortcuts</span>
          </button>
          <button className="sidebar-btn" onClick={cycleTheme} title={`Theme: ${themeLabels[theme]} — click to change`}>
            <Palette />
            <span className="lbl" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{themeLabels[theme]}</span>
            <span className="theme-dot" aria-hidden="true" />
          </button>
          <SaveIndicator />
        </div>
      </aside>
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

export function Topbar({ onMenu, onOpenPalette }: { onMenu: () => void; onOpenPalette: () => void }) {
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
      <span className="foot-item" title="PDF files in your library">
        <BookOpen />
        {files.filter((f) => !f.archived).length} file{files.filter((f) => !f.archived).length === 1 ? '' : 's'}
      </span>
      <span className="foot-item" title="Total focus sessions, minutes and reading time tracked">
        <Focus />
        {stats.focusSessions} sessions · {fmtDuration(stats.focusMinutes)}
      </span>
      {stats.readingMinutes > 0 && (
        <span className="foot-item" title="Total reading time and pages read">
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

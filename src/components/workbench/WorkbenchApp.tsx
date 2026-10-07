/* ==================== Workbench App Root ==================== */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import type { ViewId } from '@/lib/workbench/types';
import { Btn, ToastStack, toast, useNow } from './ui/primitives';
import { Sidebar, Topbar, StatusFooter } from './shell';
import { FocusMode } from './focus/FocusMode';
import { BlinkCare } from './BlinkCare';
import { ItemFormModal, ItemDetailModal } from './modals/ItemModals';
import {
  CaptureModal, DailyPlanModal, HabitFormModal, LabelsModal, TimeboxModal, DayPlannerModal,
} from './modals/MiscModals';
import { CommandPalette } from './modals/CommandPalette';
import { SettingsModal } from './modals/SettingsModal';
import { ViewCtx } from './views/viewCtx';
import { TodayView } from './views/TodayView';
import { VocabularyView } from './views/VocabularyView';
import { DashboardView } from './views/DashboardView';
import { GoalsView, GoalsHeaderActions } from './views/GoalsView';
import { HabitsView, HabitsHeaderActions } from './views/HabitsView';
import { JournalView } from './views/JournalView';
import { CalendarView, CalendarHeaderActions } from './views/CalendarView';
import { ReportsView, ReportsHeaderActions } from './views/ReportsView';
import { InboxView, InboxHeaderActions } from './views/InboxView';
import { LibraryView, LibraryHeaderActions } from './library/LibraryView';
import { FileFormModal } from './library/FileFormModal';
import { RoadmapView, RoadmapHeaderActions } from './roadmap/RoadmapView';
import { PlannerView, PlannerHeaderActions } from './planner/PlannerView';
import { ReaderOverlay } from './reader/ReaderOverlay';

/* ---------- view registry ---------- */

const HEADERS: Record<ViewId, [string, string]> = {
  today: ['Today', 'Your focus for the day — one screen, one decision.'],
  vocab: ['Vocabulary', 'Words you met while reading — keep them.'],
  inbox: ['Inbox', 'Capture first. Clarify when you are ready.'],
  dashboard: ['Dashboard', 'Where things stand right now.'],
  goals: ['Goals & Work', 'Plan the work, break it down, watch it move.'],
  library: ['Library', 'Your PDF shelf — covers, deadlines, reading progress.'],
  roadmap: ['Roadmaps', 'Design the master plan — connect goals, tasks and files.'],
  planner: ['Planner', 'Shape your days and weeks before they happen.'],
  log: ['Activity Log', 'Log what you actually did, and tag it.'],
  habits: ['Habits', 'Small reps, compounding returns.'],
  journal: ['Journal', 'Daily notes, mood, and reflections.'],
  calendar: ['Calendar', 'Deadlines, time blocks, and the shape of your weeks.'],
  reports: ['Reports', 'See how your time adds up.'],
};

function ViewBody({ view }: { view: ViewId }) {
  switch (view) {
    case 'today': return <TodayView />;
    case 'vocab': return <VocabularyView />;
    case 'inbox': return <InboxView />;
    case 'dashboard': return <DashboardView />;
    case 'goals': return <GoalsView />;
    case 'library': return <LibraryView />;
    case 'roadmap': return <RoadmapView />;
    case 'planner': return <PlannerView />;
    case 'habits': return <HabitsView />;
    case 'journal': return <JournalView />;
    case 'calendar': return <CalendarView />;
    case 'reports':
    case 'log':
      return <ReportsView />;
  }
}

function ViewHeaderActions({ view }: { view: ViewId }) {
  switch (view) {
    case 'goals': return <GoalsHeaderActions />;
    case 'habits': return <HabitsHeaderActions />;
    case 'calendar': return <CalendarHeaderActions />;
    case 'reports': return <ReportsHeaderActions />;
    case 'inbox': return <InboxHeaderActions />;
    case 'library': return <LibraryHeaderActions />;
    case 'roadmap': return <RoadmapHeaderActions />;
    case 'planner': return <PlannerHeaderActions />;
    default: return null;
  }
}

/* ---------- global pomodoro engine ----------
   ONE always-mounted watcher advances pomodoro phases app-wide: with the
   focus overlay closed, after closing the reader, etc. Previously each
   surface (FocusMode + Reader) had its own effect, so phases froze at 00:00
   once the overlay closed — and double-advanced when both were open. */
function PomodoroEngine() {
  const activeTimer = useWB((s) => s.activeTimer);
  const pomodoro = !!activeTimer?.pomodoro;
  const now = useNow(pomodoro);
  useEffect(() => {
    if (!pomodoro) return;
    const st = useWB.getState();
    const t = st.activeTimer;
    if (!t?.pomodoro || t.pomodoro.pausedAt) return;
    const timing = st.getFocusTiming();
    if (timing.remaining > 0) return;
    const wasWork = t.pomodoro.phase === 'work';
    st.advancePomodoro();
    toast(
      wasWork ? 'Break time! ☕' : 'Back to work! 🧠',
      wasWork ? 'Focus phase logged. Take a real break.' : 'Break over — next cycle starts now.'
    );
  }, [pomodoro, now]);
  return null;
}

/* ---------- app ---------- */

export default function WorkbenchApp() {
  const view = useWB((s) => s.view);
  const theme = useWB((s) => s.theme);
  const hydrated = useWB((s) => s.hydrated);
  const setView = useWB((s) => s.setView);
  const undo = useWB((s) => s.undo);
  const redo = useWB((s) => s.redo);
  const cycleTheme = useWB((s) => s.cycleTheme);
  const setFocusOpen = useWB((s) => s.setFocusOpen);
  const startTimer = useWB((s) => s.startTimer);
  const stopTimer = useWB((s) => s.stopTimer);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mItemForm, setMItemForm] = useState<{ parentId: string | null } | null>(null);
  const [mItemDetail, setMItemDetail] = useState<string | null>(null);
  const [mLabels, setMLabels] = useState(false);
  const [mSettings, setMSettings] = useState(false);
  const [mCapture, setMCapture] = useState(false);
  const [mDailyPlan, setMDailyPlan] = useState(false);
  const [mTimebox, setMTimebox] = useState<{ id: string; date?: string } | null>(null);
  const [mDayPlanner, setMDayPlanner] = useState<string | null>(null);
  const [mHabitForm, setMHabitForm] = useState<{ id: string | null } | null>(null);
  const [mPalette, setMPalette] = useState(false);
  const [mReader, setMReader] = useState<string | null>(null);
  const [mFileForm, setMFileForm] = useState<string | null>(null);

  /* hydrate persisted state after mount (avoids SSR mismatch) */
  useEffect(() => {
    void useWB.persist.rehydrate();
  }, []);

  /* apply theme class to <html> — sidebar + focus + everything follows it */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'prism');
    if (theme === 'dark') root.classList.add('dark');
    if (theme === 'prism') root.classList.add('prism');
  }, [theme]);

  /* palette "open item detail" event */
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setMItemDetail(id);
    };
    window.addEventListener('wb-open-item', handler);
    return () => window.removeEventListener('wb-open-item', handler);
  }, []);

  /* open the PDF reader overlay (library / palette / planner / dashboard / roadmap) */
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setMReader(id);
    };
    window.addEventListener('wb-open-reader', handler);
    return () => window.removeEventListener('wb-open-reader', handler);
  }, []);

  /* drops are only meaningful on dedicated zones (library shelf, folder rows,
     planner columns); anywhere else a dropped file must NOT navigate —
     Chromium's default navigates to file://…pdf, and in the desktop app that
     lands on "This page couldn't load" (no PDF viewer). Zone handlers already
     preventDefault; this window-level guard covers every other surface. */
  useEffect(() => {
    const stopNav = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', stopNav);
    window.addEventListener('drop', stopNav);
    return () => {
      window.removeEventListener('dragover', stopNav);
      window.removeEventListener('drop', stopNav);
    };
  }, []);

  /* open the file edit modal (library cards) */
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setMFileForm(id);
    };
    window.addEventListener('wb-open-file-form', handler);
    return () => window.removeEventListener('wb-open-file-form', handler);
  }, []);

  /* keyboard shortcuts */
  useEffect(() => {
    let gPressed = false;
    let gTimeout: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMPalette(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        if (redo()) toast('Redone');
        else toast('Nothing to redo');
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (undo()) toast('Undone');
        else toast('Nothing to undo');
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (redo()) toast('Redone');
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        setMSettings(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        cycleTheme();
        return;
      }
      if (typing || e.altKey) return;
      /* single-letter shortcuts are suppressed while a full-screen surface
         owns the keyboard (reader has its own keymap; modals/focus stack) */
      if (document.querySelector('.reader-overlay, .modal-overlay, .focus-overlay')) return;

      const key = e.key.toLowerCase();

      /* the G-chord is checked FIRST — G C / G T / G F / G N must reach the
         navigation map, not be stolen by the bare c/t/f/n shortcuts */
      if (key === 'g' && !mod) {
        e.preventDefault();
        if (gPressed) {
          /* G G is itself a destination (Goals) — don't just re-arm the chord */
          gPressed = false;
          if (gTimeout) clearTimeout(gTimeout);
          setView('goals');
          return;
        }
        gPressed = true;
        if (gTimeout) clearTimeout(gTimeout);
        gTimeout = setTimeout(() => (gPressed = false), 700);
        return;
      }
      if (gPressed && !mod) {
        const map: Record<string, ViewId> = {
          t: 'today', i: 'inbox', d: 'dashboard', g: 'goals', l: 'reports',
          h: 'habits', j: 'journal', c: 'calendar', r: 'reports',
          b: 'library', m: 'roadmap', p: 'planner', v: 'vocab',
        };
        if (map[key]) {
          e.preventDefault();
          gPressed = false;
          if (gTimeout) clearTimeout(gTimeout);
          setView(map[key]);
          return;
        }
      }

      if (key === 'f' && !mod) {
        e.preventDefault();
        setFocusOpen(true);
        return;
      }
      if (key === 'c' && !mod) {
        e.preventDefault();
        setMCapture(true);
        return;
      }
      if (key === 't' && !mod) {
        e.preventDefault();
        if (useWB.getState().activeTimer) {
          stopTimer();
          toast('Timer stopped', 'Entry logged.');
        } else {
          startTimer([], '');
          toast('Timer started');
        }
        return;
      }
      if (key === 'n' && !mod) {
        e.preventDefault();
        setMItemForm({ parentId: null });
        return;
      }
      if (key === ',' && !mod) {
        e.preventDefault();
        setMSettings(true);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (gTimeout) clearTimeout(gTimeout);
    };
  }, [setView, undo, redo, cycleTheme, setFocusOpen, startTimer, stopTimer]);

  const viewActions = {
    openItemForm: useCallback((parentId: string | null) => setMItemForm({ parentId }), []),
    openItemDetail: useCallback((id: string) => setMItemDetail(id), []),
    openLabels: useCallback(() => setMLabels(true), []),
    openCapture: useCallback(() => setMCapture(true), []),
    openDailyPlan: useCallback(() => setMDailyPlan(true), []),
    openTimebox: useCallback((id: string, date?: string) => setMTimebox({ id, date }), []),
    openDayPlanner: useCallback((date: string) => setMDayPlanner(date), []),
    openHabitForm: useCallback((id: string | null) => setMHabitForm({ id }), []),
    openPalette: useCallback(() => setMPalette(true), []),
  };

  const [title, subtitle] = HEADERS[view];

  return (
    <ViewCtx.Provider value={viewActions}>
      <div className="wb-app">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenSettings={() => setMSettings(true)}
          onOpenPalette={() => setMPalette(true)}
        />

        <div className="wb-main">
          <Topbar
            onMenu={() => setSidebarOpen(true)}
            onOpenPalette={() => setMPalette(true)}
            onOpenSettings={() => setMSettings(true)}
          />

          <div className="wb-header">
            <h1 className="wb-display">{title}</h1>
            <p className="sub">{subtitle}</p>
            <div className="header-actions">
              <ViewHeaderActions view={view} />
              {view !== 'goals' && view !== 'inbox' && view !== 'library' && view !== 'roadmap' && view !== 'planner' && (
                <>
                  <Btn size="sm" variant="primary" onClick={() => setMCapture(true)}>
                    <Sparkles size={14} /> Capture
                  </Btn>
                  <Btn size="sm" onClick={() => setMItemForm({ parentId: null })}>
                    <Plus size={14} /> New
                  </Btn>
                </>
              )}
            </div>
          </div>

          <main className="wb-content" id="pageContent">
            {hydrated ? (
              <ViewBody view={view} />
            ) : (
              <div className="card" style={{ display: 'grid', placeItems: 'center', minHeight: 240, color: 'var(--muted2)' }}>
                Loading workspace…
              </div>
            )}
          </main>

          <StatusFooter />
        </div>

        {/* Focus overlay */}
        <FocusMode />

        {/* Modals — conditionally mounted so each opens with fresh state */}
        {mItemForm && (
          <ItemFormModal
            parentId={mItemForm.parentId}
            onClose={() => setMItemForm(null)}
          />
        )}
        {mItemDetail && (
          <ItemDetailModal
            itemId={mItemDetail}
            onClose={() => setMItemDetail(null)}
            onOpenLabels={() => setMLabels(true)}
          />
        )}
        <LabelsModal open={mLabels} onClose={() => setMLabels(false)} />
        <SettingsModal open={mSettings} onClose={() => setMSettings(false)} onOpenPalette={() => setMPalette(true)} />
        <CaptureModal open={mCapture} onClose={() => setMCapture(false)} />
        {mDailyPlan && <DailyPlanModal onClose={() => setMDailyPlan(false)} />}
        {mTimebox && (
          <TimeboxModal
            itemId={mTimebox.id}
            date={mTimebox.date}
            onClose={() => setMTimebox(null)}
          />
        )}
        {mDayPlanner && (
          <DayPlannerModal
            date={mDayPlanner}
            onClose={() => setMDayPlanner(null)}
            onTimebox={(id, date) => setMTimebox({ id, date })}
          />
        )}
        {mHabitForm && (
          <HabitFormModal habitId={mHabitForm.id} onClose={() => setMHabitForm(null)} />
        )}
        {mReader && (
          <ReaderOverlay fileId={mReader} onClose={() => setMReader(null)} />
        )}
        {mFileForm && (
          <FileFormModal fileId={mFileForm} onClose={() => setMFileForm(null)} />
        )}
        {mPalette && (
          <CommandPalette
            open
            onClose={() => setMPalette(false)}
            onOpenLabels={() => setMLabels(true)}
            onOpenSettings={() => setMSettings(true)}
            onOpenCapture={() => setMCapture(true)}
          />
        )}

        <ToastStack />
        <PomodoroEngine />
        <BlinkCare />
      </div>
    </ViewCtx.Provider>
  );
}

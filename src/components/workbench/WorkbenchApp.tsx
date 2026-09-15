/* ==================== Workbench App Root ==================== */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import type { ViewId } from '@/lib/workbench/types';
import { Btn, ToastStack, toast } from './ui/primitives';
import { Sidebar, Topbar, StatusFooter } from './shell';
import { FocusMode } from './focus/FocusMode';
import { ItemFormModal, ItemDetailModal } from './modals/ItemModals';
import {
  CaptureModal, DailyPlanModal, DataModal, DayPlannerModal, HabitFormModal, LabelsModal,
  ShortcutsModal, TimeboxModal,
} from './modals/MiscModals';
import { CommandPalette } from './modals/CommandPalette';
import { ViewCtx } from './views/viewCtx';
import { TodayView } from './views/TodayView';
import { DashboardView } from './views/DashboardView';
import { GoalsView, GoalsHeaderActions } from './views/GoalsView';
import { LogView } from './views/LogView';
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
    case 'inbox': return <InboxView />;
    case 'dashboard': return <DashboardView />;
    case 'goals': return <GoalsView />;
    case 'library': return <LibraryView />;
    case 'roadmap': return <RoadmapView />;
    case 'planner': return <PlannerView />;
    case 'log': return <LogView />;
    case 'habits': return <HabitsView />;
    case 'journal': return <JournalView />;
    case 'calendar': return <CalendarView />;
    case 'reports': return <ReportsView />;
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
  const [mShortcuts, setMShortcuts] = useState(false);
  const [mData, setMData] = useState(false);
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
        setMShortcuts(true);
        return;
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        cycleTheme();
        return;
      }
      if (typing || e.altKey) return;

      const key = e.key.toLowerCase();
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
      if (key === 'g' && !mod) {
        if (gPressed) return;
        gPressed = true;
        if (gTimeout) clearTimeout(gTimeout);
        gTimeout = setTimeout(() => (gPressed = false), 700);
        return;
      }
      if (gPressed && !mod) {
        const map: Record<string, ViewId> = {
          t: 'today', i: 'inbox', d: 'dashboard', g: 'goals', l: 'log',
          h: 'habits', j: 'journal', c: 'calendar', r: 'reports',
          b: 'library', m: 'roadmap', p: 'planner',
        };
        if (map[key]) {
          e.preventDefault();
          gPressed = false;
          setView(map[key]);
        }
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
          onOpenShortcuts={() => setMShortcuts(true)}
          onOpenData={() => setMData(true)}
          onOpenPalette={() => setMPalette(true)}
        />

        <div className="wb-main">
          <Topbar onMenu={() => setSidebarOpen(true)} onOpenPalette={() => setMPalette(true)} />

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
        <ShortcutsModal open={mShortcuts} onClose={() => setMShortcuts(false)} />
        <DataModal open={mData} onClose={() => setMData(false)} />
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
        <CommandPalette
          open={mPalette}
          onClose={() => setMPalette(false)}
          onOpenLabels={() => setMLabels(true)}
          onOpenData={() => setMData(true)}
          onOpenCapture={() => setMCapture(true)}
          onOpenShortcuts={() => setMShortcuts(true)}
        />

        <ToastStack />
      </div>
    </ViewCtx.Provider>
  );
}

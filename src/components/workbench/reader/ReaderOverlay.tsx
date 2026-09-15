/* ==================== Reader v2 — PDF reading surface ====================
   Full-screen reading overlay for a stored PDF:
   - Single-page AND continuous scroll modes (virtualized strip)
   - Annotation engine: pen / highlighter / stroke-eraser + undo/redo + autosave (IDB)
   - Page themes: light / dark / warm / custom (applied to the page, not the ink)
   - Favorite pages with review mode ("review at end of day")
   - Pages panel: lazy thumbnails with read/unread/favorites/annotated filters
   - Per-page reading-second tracking, focus-read pomodoro, immersive chrome */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  BookCheck, BookPlus, BookmarkCheck, ChevronLeft, ChevronRight, Clock, Download, Eraser, Eye,
  FileText, FileWarning, Highlighter, LayoutGrid, MoveHorizontal, PanelTopClose, PanelTopOpen,
  Pause, Pen, Play, ScrollText, SkipForward, Square, SquareCheck, Star, StickyNote, Sun, Moon,
  Leaf, SlidersHorizontal, Target, Timer, Undo2, Redo2, Trash2, X, ZoomIn, ZoomOut, MousePointer2,
} from 'lucide-react';
import {
  PAGE_READ_THRESHOLD_SEC, useWB, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages,
  wbItemsForFile,
} from '@/lib/workbench/store';
import { cacheAnnos, fetchAnnosCached, putAnnos } from '@/lib/workbench/idb';
import { drawStrokes } from './annotations';
import type { AnnoCommand } from './annotations';
import { applyAnnoCommand, createLimiter, revertAnnoCommand, UNDO_CAP } from './annotations';
import { renderPageToCanvas } from '@/lib/workbench/pdf';
import { HL_SWATCHES, PEN_SWATCHES } from '@/lib/workbench/types';
import type { PageAnnoMap, ReaderThemeMode, ReaderTool, ReaderViewMode, Stroke } from '@/lib/workbench/types';
import type { Item } from '@/lib/workbench/types';
import { daysUntil, fmtClock, getFocusTiming, isoDate } from '@/lib/workbench/helpers';
import { PagesPanel, filterLabel } from './PagesPanel';
import type { FilterCounts, PageFilter } from './PagesPanel';
import { PdfPageCard } from './PdfPageCard';
import { Btn, IconBtn, toast, useConfirm, useNow } from '../ui/primitives';
import './reader.css';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.1;
const FLUSH_EVERY_MS = 10_000;
const ANNO_SAVE_DEBOUNCE_MS = 700;
const CHROME_IDLE_MS = 2_600;
const MIN_SESSION_MS = 60_000;
const DIMS_FETCH_CAP = 150;

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved';

const ITEM_ICON: Record<Item['type'], React.ReactNode> = {
  goal: <Target size={12} />,
  task: <SquareCheck size={12} />,
  note: <StickyNote size={12} />,
};

const THEME_ORDER: ReaderThemeMode[] = ['light', 'dark', 'warm', 'custom'];

/* Custom-theme quick presets — set all three sliders at once. */
const THEME_PRESETS: { id: string; label: string; values: { brightness: number; contrast: number; sepia: number } }[] = [
  { id: 'night', label: 'Night reading', values: { brightness: 85, contrast: 110, sepia: 25 } },
  { id: 'paper', label: 'Paper', values: { brightness: 100, contrast: 100, sepia: 35 } },
  { id: 'contrast', label: 'High contrast', values: { brightness: 95, contrast: 140, sepia: 0 } },
];

/* Width of the custom-theme popover (matches .rd-theme-pop CSS). */
const THEME_POP_W = 262;

type RGB = [number, number, number];

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const c = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * t);
  return [c(0), c(1), c(2)];
}

function rgbCss(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function clamp01v(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Tint for the surface behind the canvas so themed pages have no white glare. */
function pageSurfaceBg(mode: ReaderThemeMode, custom: { brightness: number; sepia: number }): string {
  const white: RGB = [255, 255, 255];
  switch (mode) {
    case 'dark':
      return '#15181a';
    case 'warm':
      return '#f3ecdc';
    case 'custom': {
      let c = mixRgb(white, [0xef, 0xe3, 0xcd], clamp01v(custom.sepia / 100));
      const dim = clamp01v((100 - custom.brightness) / 100);
      c = mixRgb(c, [0x16, 0x19, 0x18], dim * 0.9);
      return rgbCss(c);
    }
    default:
      return '#ffffff';
  }
}

function clampPage(p: number, total: number): number {
  const max = Math.max(1, total);
  const n = Math.round(p);
  return Math.max(1, Math.min(max, Number.isFinite(n) ? n : 1));
}

function fmtRem(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function themeFilterOf(mode: ReaderThemeMode, custom: { brightness: number; contrast: number; sepia: number }): string {
  switch (mode) {
    case 'dark':
      return 'invert(1) hue-rotate(180deg) brightness(0.92) contrast(1.06)';
    case 'warm':
      return 'sepia(0.45) brightness(1.05)';
    case 'custom':
      return `brightness(${custom.brightness / 100}) contrast(${custom.contrast / 100}) sepia(${custom.sepia / 100})`;
    default:
      return 'none';
  }
}

const dimsLimiter = createLimiter(8);

export function ReaderOverlay({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  /* ---------- store ---------- */
  const file = useWB((s) => s.files.find((f) => f.id === fileId));
  const items = useWB((s) => s.items);
  const activeTimer = useWB((s) => s.activeTimer);
  const prefs = useWB((s) => s.readerPrefs);
  const updateReaderPrefs = useWB((s) => s.updateReaderPrefs);
  const setFilePosition = useWB((s) => s.setFilePosition);
  const addFilePageSeconds = useWB((s) => s.addFilePageSeconds);
  const markFilePage = useWB((s) => s.markFilePage);
  const toggleFileFavoritePage = useWB((s) => s.toggleFileFavoritePage);
  const setFileAnnoPages = useWB((s) => s.setFileAnnoPages);
  const logReadingSession = useWB((s) => s.logReadingSession);
  const startFileFocus = useWB((s) => s.startFileFocus);
  const pausePomodoro = useWB((s) => s.pausePomodoro);
  const resumePomodoro = useWB((s) => s.resumePomodoro);
  const advancePomodoro = useWB((s) => s.advancePomodoro);
  const stopTimer = useWB((s) => s.stopTimer);
  const confirm = useConfirm();

  const now = useNow();

  /* ---------- document loading ---------- */
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [dims, setDims] = useState<{ w: number; h: number }[]>([]);
  const numPages = doc?.numPages ?? file?.pageCount ?? 1;

  /* ---------- annotations ---------- */
  const [annos, setAnnos] = useState<PageAnnoMap>({});
  const [annosReady, setAnnosReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const undoRef = useRef<AnnoCommand[]>([]);
  const redoRef = useRef<AnnoCommand[]>([]);
  const [, forceAnnoTick] = useState(0); // re-render for undo/redo availability
  const annosRef = useRef<PageAnnoMap>({});
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- view state ---------- */
  const [page, setPage] = useState(() => clampPage(file?.currentPage ?? 1, file?.pageCount ?? 1));
  const [pageInput, setPageInput] = useState(() => String(clampPage(file?.currentPage ?? 1, file?.pageCount ?? 1)));
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [stageW, setStageW] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const [chromeOn, setChromeOn] = useState(true);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [filter, setFilter] = useState<PageFilter>('all');
  const [review, setReview] = useState(false);
  const [themePop, setThemePop] = useState(false);
  const [themePopPos, setThemePopPos] = useState<{ left: number; bottom: number } | null>(null);
  const themeAnchorRef = useRef<HTMLSpanElement | null>(null);
  const themePopRef = useRef<HTMLDivElement | null>(null);

  const viewMode = prefs.viewMode;
  const tool = prefs.tool;
  const themeMode = prefs.themeMode;
  const themeFilter = useMemo(() => themeFilterOf(themeMode, prefs.custom), [themeMode, prefs.custom]);
  const pageBg = useMemo(() => pageSurfaceBg(themeMode, prefs.custom), [themeMode, prefs.custom]);

  /* ---------- refs (session tracking + render bookkeeping) ---------- */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stripScrollRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const visRatiosRef = useRef<Map<number, number>>(new Map());
  const sessionStartRef = useRef(Date.now());
  const startPageRef = useRef(page);
  const pageRef = useRef(page);
  const pageSecsRef = useRef(0);
  const pendingRef = useRef<Map<number, number>>(new Map());
  const sessionTotalsRef = useRef<Map<number, number>>(new Map());
  const visitedRef = useRef<Set<number>>(new Set());
  const newlyReadRef = useRef<Set<number>>(new Set());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewScrollGuardRef = useRef(false);

  /* immutable snapshot of pageSeconds/readPages at mount — threshold crossing math */
  const snapshotRef = useRef<{ secs: Record<string, number>; read: Set<string> } | null>(null);
  if (file && snapshotRef.current === null) {
    snapshotRef.current = { secs: { ...file.pageSeconds }, read: new Set(file.readPages) };
  }

  /* ---------- derived ---------- */
  const elapsedSec = Math.max(0, Math.floor((now.getTime() - sessionStartRef.current) / 1000));
  const timeOnPage = pageSecsRef.current;
  const fileProgress = file ? wbFileProgress(file) : 0;
  const readCount = file ? wbFileReadPages(file) : 0;
  const pageIsRead = !!file && file.readPages.includes(String(page));
  const pageIsFav = !!file && (file.favoritePages ?? []).includes(String(page));
  const linkedItems = useMemo(() => wbItemsForFile(items, fileId), [items, fileId]);
  const readSet = useMemo(() => new Set(file?.readPages ?? []), [file]);
  const favoriteSet = useMemo(() => new Set(file?.favoritePages ?? []), [file]);
  const annoLiveSet = useMemo(() => {
    const s = new Set(file?.annoPages ?? []);
    for (const k of Object.keys(annos)) if (annos[k].length > 0) s.add(k);
    return s;
  }, [file, annos]);
  const currentStrokes = annos[String(page)] ?? [];

  const focusHere = !!activeTimer && activeTimer.fileId === fileId;
  const focusTiming = focusHere && activeTimer ? getFocusTiming(activeTimer, now.getTime()) : null;
  const ftPaused = focusTiming?.paused ?? false;
  const ftRemaining = focusTiming?.remaining ?? 0;
  const ftPhase = focusTiming?.phaseLabel ?? '';
  const phaseTone = activeTimer?.pomodoro?.phase === 'break' ? 'break' : 'work';

  const deadlineChip = useMemo(() => {
    if (!file?.deadline) return null;
    const status = wbFileDeadlineStatus(file);
    if (!status) return null;
    if (fileProgress >= 100) return { text: 'Complete', tone: 'ok' as const };
    const d = daysUntil(file.deadline);
    if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: 'over' as const };
    if (d === 0) return { text: 'Due today', tone: 'soon' as const };
    return { text: `${d}d left`, tone: status === 'soon' ? ('soon' as const) : ('ok' as const) };
  }, [file, fileProgress]);

  /* ---------- page filter + review ---------- */
  const effectiveFilter: PageFilter = review ? 'favorites' : filter;

  const counts: FilterCounts = useMemo(() => ({
    all: numPages,
    read: Math.min(numPages, readSet.size),
    unread: numPages - Math.min(numPages, readSet.size),
    favorites: Math.min(numPages, favoriteSet.size),
    annotated: Math.min(numPages, annoLiveSet.size),
  }), [numPages, readSet, favoriteSet, annoLiveSet]);

  const pagesList = useMemo(() => {
    const all = Array.from({ length: numPages }, (_, i) => i + 1);
    if (effectiveFilter === 'all') return all;
    return all.filter((n) => {
      const key = String(n);
      switch (effectiveFilter) {
        case 'read': return readSet.has(key);
        case 'unread': return !readSet.has(key);
        case 'favorites': return favoriteSet.has(key);
        case 'annotated': return annoLiveSet.has(key);
        default: return true;
      }
    });
  }, [numPages, effectiveFilter, readSet, favoriteSet, annoLiveSet]);

  const reviewIndex = review ? pagesList.indexOf(page) + 1 : 0;

  const enterReview = useCallback((f: PageFilter) => {
    updateReaderPrefs({ viewMode: 'scroll' });
    setFilter(f);
    setReview(true);
    toast('Review mode', `Showing ${filterLabel(f)} pages only — read them like a deck.`);
  }, [updateReaderPrefs]);

  const exitReview = useCallback(() => {
    setReview(false);
    setFilter('all');
  }, []);

  /* ---------- annotation persistence ---------- */

  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const map = annosRef.current;
    cacheAnnos(fileId, map);
    try {
      await putAnnos(fileId, map);
    } catch {
      /* IDB hiccup — next change retries */
    }
    setFileAnnoPages(fileId, Object.keys(map).filter((p) => map[p].length > 0));
    setSaveState('saved');
  }, [fileId, setFileAnnoPages]);

  const scheduleSave = useCallback(() => {
    setSaveState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSave(), ANNO_SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const commitCommand = useCallback((cmd: AnnoCommand) => {
    setAnnos((prev) => {
      const next = applyAnnoCommand(prev, cmd);
      annosRef.current = next;
      return next;
    });
    undoRef.current.push(cmd);
    if (undoRef.current.length > UNDO_CAP) undoRef.current.shift();
    redoRef.current = [];
    dirtyRef.current = true;
    forceAnnoTick((t) => t + 1);
    scheduleSave();
  }, [scheduleSave]);

  const undo = useCallback(() => {
    const cmd = undoRef.current.pop();
    if (!cmd) return;
    setAnnos((prev) => {
      const next = revertAnnoCommand(prev, cmd);
      annosRef.current = next;
      return next;
    });
    redoRef.current.push(cmd);
    dirtyRef.current = true;
    forceAnnoTick((t) => t + 1);
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const cmd = redoRef.current.pop();
    if (!cmd) return;
    setAnnos((prev) => {
      const next = applyAnnoCommand(prev, cmd);
      annosRef.current = next;
      return next;
    });
    undoRef.current.push(cmd);
    dirtyRef.current = true;
    forceAnnoTick((t) => t + 1);
    scheduleSave();
  }, [scheduleSave]);

  const clearPage = useCallback((pageNum: number) => {
    const cur = annosRef.current[String(pageNum)] ?? [];
    if (!cur.length) return;
    if (!confirm(`Clear all ink on page ${pageNum}?`)) return;
    commitCommand({ type: 'clear', page: pageNum, strokes: cur });
  }, [annosRef, commitCommand, confirm]);

  /* ---------- reading-time tracking (v4 logic, kept) ---------- */

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    const snap = snapshotRef.current;
    for (const [pg, secs] of pending) {
      pending.delete(pg);
      if (secs <= 0) continue;
      addFilePageSeconds(fileId, pg, secs);
      const sess = (sessionTotalsRef.current.get(pg) || 0) + secs;
      sessionTotalsRef.current.set(pg, sess);
      if (snap) {
        const before = snap.secs[String(pg)] || 0;
        if (!snap.read.has(String(pg)) && before < PAGE_READ_THRESHOLD_SEC && before + sess >= PAGE_READ_THRESHOLD_SEC) {
          newlyReadRef.current.add(pg);
        }
      }
    }
  }, [fileId, addFilePageSeconds]);

  /* 1-second tick — only while the tab is visible */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const p = pageRef.current;
      pendingRef.current.set(p, (pendingRef.current.get(p) || 0) + 1);
      pageSecsRef.current += 1;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  /* mark the entry page as visited */
  useEffect(() => {
    visitedRef.current.add(pageRef.current);
  }, []);

  /* periodic flush */
  useEffect(() => {
    const id = setInterval(() => flushPending(), FLUSH_EVERY_MS);
    return () => clearInterval(id);
  }, [flushPending]);

  /* final flush + session log + annotation save on unmount */
  useEffect(() => {
    const sessionStart = sessionStartRef.current;
    const startPage = startPageRef.current;
    return () => {
      flushPending();
      void flushSave();
      const elapsed = Date.now() - sessionStart;
      if (elapsed < MIN_SESSION_MS) return;
      logReadingSession({
        fileId,
        date: isoDate(new Date(sessionStart)),
        startedAt: new Date(sessionStart).toISOString(),
        endedAt: new Date().toISOString(),
        minutes: Math.max(1, Math.round(elapsed / 60000)),
        pagesVisited: visitedRef.current.size,
        pagesRead: newlyReadRef.current.size,
        startPage,
        endPage: pageRef.current,
      });
    };
  }, [fileId, flushPending, flushSave, logReadingSession]);

  /* save when the tab hides or closes */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSave();
    };
    const onBeforeUnload = () => void flushSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushSave]);

  /* lock background scroll while the overlay is up */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* ---------- load document + annotations ---------- */

  useEffect(() => {
    let alive = true;
    setLoadState('loading');
    setDims([]);
    setDoc(null);
    loadFileDocSafe(fileId)
      .then(async (d) => {
        if (!alive) return;
        setDoc(d);
        setLoadState('ready');
        /* page dimensions for placeholders / aspect math */
        const count = Math.min(d.numPages, DIMS_FETCH_CAP);
        const out: { w: number; h: number }[] = [];
        for (let i = 1; i <= count; i++) {
          const p = await dimsLimiter(() => d.getPage(i));
          if (!alive) return;
          out.push({ w: p.getViewport({ scale: 1 }).width, h: p.getViewport({ scale: 1 }).height });
        }
        while (out.length < d.numPages) out.push(out[out.length - 1] ?? { w: 612, h: 792 });
        if (alive) setDims(out);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoadState('error');
        setLoadError(err instanceof Error ? err.message : 'Could not open this PDF.');
      });
    return () => {
      alive = false;
    };
  }, [fileId]);

  /* annotations: IDB → state (instant when cached) */
  useEffect(() => {
    let alive = true;
    setAnnosReady(false);
    fetchAnnosCached(fileId)
      .then((map) => {
        if (!alive) return;
        annosRef.current = map;
        setAnnos(map);
        setAnnosReady(true);
      })
      .catch(() => {
        if (!alive) return;
        annosRef.current = {};
        setAnnos({});
        setAnnosReady(true);
      });
    return () => {
      alive = false;
    };
  }, [fileId]);

  /* clamp page if the doc turns out shorter than stored metadata */
  useEffect(() => {
    if (doc && page > doc.numPages) {
      const target = clampPage(page, doc.numPages);
      setPage(target);
      setPageInput(String(target));
      pageRef.current = target;
      pageSecsRef.current = 0;
    }
  }, [doc, page]);

  /* ---------- stage measurement (single stage OR strip scroller) ---------- */

  useEffect(() => {
    const el = viewMode === 'single' ? stageRef.current : stripScrollRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const cs = window.getComputedStyle(el);
      const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      setStageW(Math.max(0, el.clientWidth - pad - 12));
    };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, 140);
    });
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [viewMode, loadState, pagesOpen]);

  /* ---------- dominant page (scroll mode) ---------- */

  const changeDominant = useCallback((next: number) => {
    if (next === pageRef.current) return;
    flushPending();
    visitedRef.current.add(next);
    pageRef.current = next;
    pageSecsRef.current = 0;
    setPage(next);
    setPageInput(String(next));
    setFilePosition(fileId, next);
  }, [fileId, flushPending, setFilePosition]);

  useEffect(() => {
    if (viewMode !== 'scroll' || loadState !== 'ready') return;
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const en of entries) {
          const n = Number((en.target as HTMLElement).dataset.page);
          if (!Number.isFinite(n)) continue;
          visRatiosRef.current.set(n, en.intersectionRatio);
          changed = true;
        }
        if (!changed) return;
        let best = -1;
        let bestR = 0.12;
        visRatiosRef.current.forEach((r, n) => {
          if (r > bestR) {
            bestR = r;
            best = n;
          }
        });
        if (best > 0) changeDominant(best);
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    );
    pagesList.forEach((n) => {
      const el = pageElsRef.current.get(n);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [viewMode, loadState, pagesList, changeDominant]);

  /* scroll to the current page after switching into scroll mode */
  useEffect(() => {
    if (viewMode !== 'scroll' || loadState !== 'ready' || reviewScrollGuardRef.current) return;
    reviewScrollGuardRef.current = true;
    const t = setTimeout(() => {
      const el = pageElsRef.current.get(pageRef.current);
      el?.scrollIntoView({ block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [viewMode, loadState]);

  /* ---------- navigation ---------- */

  const goToPage = useCallback(
    (next: number) => {
      const total = doc?.numPages ?? file?.pageCount ?? 1;
      const target = clampPage(next, total);
      setPageInput(String(target));
      if (target === pageRef.current && viewMode === 'scroll') {
        const el = pageElsRef.current.get(target);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (viewMode === 'scroll') {
        flushPending();
        visitedRef.current.add(target);
        pageRef.current = target;
        pageSecsRef.current = 0;
        setPage(target);
        setFilePosition(fileId, target);
        const el = pageElsRef.current.get(target);
        const dist = Math.abs(target - page);
        el?.scrollIntoView({ behavior: dist > 5 ? 'auto' : 'smooth', block: 'start' });
      } else {
        if (target !== page) {
          flushPending();
          visitedRef.current.add(target);
          pageRef.current = target;
          pageSecsRef.current = 0;
          setPage(target);
          setFilePosition(fileId, target);
          stageRef.current?.scrollTo({ top: 0 });
        }
      }
    },
    [doc, file, fileId, page, viewMode, flushPending, setFilePosition]
  );

  const applyPageInput = useCallback(() => {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) goToPage(n);
    else setPageInput(String(page));
  }, [pageInput, goToPage, page]);

  const closeReader = useCallback(() => {
    onClose();
  }, [onClose]);

  /* ---------- zoom ---------- */

  const baseW = viewMode === 'single'
    ? (dims[page - 1]?.w || 612)
    : (dims[0]?.w || 612);
  const effScale = fit && baseW > 0 && stageW > 0 ? Math.max(0.05, stageW / baseW) : scale;
  const cssWidth = Math.max(120, Math.round(baseW * effScale));

  const zoomBy = useCallback(
    (mult: number) => {
      setScale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, effScale * mult)));
      setFit(false);
    },
    [effScale]
  );

  /* ---------- toolbar actions ---------- */

  const setTool = (t: ReaderTool) => updateReaderPrefs({ tool: t });
  const setViewModePref = (m: ReaderViewMode) => updateReaderPrefs({ viewMode: m });

  /* Open the custom-theme popover as a body portal anchored above the custom
     button. Computed once on open (viewport-clamped); the toolbar's overflow-x
     no longer clips it. */
  const openThemePop = useCallback(() => {
    const anchor = themeAnchorRef.current;
    let left = 24;
    let bottom = 12;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      left = r.left + r.width / 2 - THEME_POP_W / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - THEME_POP_W - 8));
      bottom = Math.max(8, window.innerHeight - r.top + 10);
    }
    setThemePopPos({ left, bottom });
    setThemePop(true);
  }, []);

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(themeMode) + 1) % THEME_ORDER.length];
    updateReaderPrefs({ themeMode: next });
    if (next === 'custom') openThemePop();
    else if (themePop) setThemePop(false);
    toast(`Page theme · ${next}`, next === 'custom' ? 'Tune brightness, contrast and warmth in the sliders.' : 'Applied to the page — your ink keeps its colors.');
  };

  const toggleFavorite = useCallback(() => {
    toggleFileFavoritePage(fileId, pageRef.current);
    toast(pageIsFav ? 'Removed from favorites' : 'Page starred', `p.${pageRef.current} ${pageIsFav ? 'unstarred' : 'added to your review deck'}.`);
  }, [fileId, toggleFileFavoritePage, pageIsFav]);

  const exportPage = useCallback(async () => {
    if (!doc) return;
    const pageNum = pageRef.current;
    try {
      const canvas = document.createElement('canvas');
      await renderPageToCanvas(doc, pageNum, canvas, { scale: 2 });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const strokes: Stroke[] = annosRef.current[String(pageNum)] ?? [];
      if (strokes.length) drawStrokes(ctx, strokes, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${file?.title || 'page'} - p${pageNum}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }, 'image/png');
      toast('Page exported', `p.${pageNum} saved as PNG with your ink.`);
    } catch {
      toast('Export failed', 'The page could not be rendered right now.');
    }
  }, [doc, file]);

  /* ---------- focus read ---------- */

  const startFocusRead = () => {
    if (startFileFocus(fileId)) toast('Focus read started', 'Pomodoro running — page time still counts.');
    else toast('A timer is already running', 'End it before starting a focus read.');
  };

  const endFocusRead = () => {
    stopTimer();
    toast('Session logged');
  };

  /* auto-advance the pomodoro while focus-reading here */
  useEffect(() => {
    if (!focusHere || ftPaused || ftRemaining > 0) return;
    advancePomodoro();
    toast(
      ftPhase === 'Focus' ? 'Break time! ☕' : 'Back to work! 🧠',
      ftPhase === 'Focus' ? 'Focus phase logged.' : 'Break over — next cycle starts now.'
    );
  }, [focusHere, ftPaused, ftRemaining, ftPhase, advancePomodoro]);

  /* ---------- immersive chrome ---------- */

  const bumpChrome = useCallback(() => {
    setChromeOn(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setChromeOn(false), CHROME_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    bumpChrome();
    const onMove = () => bumpChrome();
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [immersive, bumpChrome]);

  const toggleImmersive = useCallback(() => {
    const next = !immersive;
    setImmersive(next);
    if (!next) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      setChromeOn(true);
    }
  }, [immersive]);

  /* close the theme popover on outside clicks (portal lives on body) */
  useEffect(() => {
    if (!themePop) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && themePopRef.current?.contains(t)) return;
      if (t && themeAnchorRef.current?.contains(t)) return; /* the button toggles itself */
      setThemePop(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [themePop]);

  const onStageClick = () => {
    if (immersive && !chromeOn) bumpChrome();
  };

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        if (inField) {
          /* a focused slider inside the theme popover — Esc closes the popover */
          if (themePop && t && themePopRef.current?.contains(t)) {
            setThemePop(false);
            return;
          }
          setPageInput(String(page));
          (t as HTMLElement).blur?.();
          return;
        }
        if (document.querySelector('.modal-overlay')) return; // a modal above owns Esc
        e.preventDefault();
        if (review) {
          exitReview();
          return;
        }
        if (themePop) {
          setThemePop(false);
          return;
        }
        if (pagesOpen) {
          setPagesOpen(false);
          return;
        }
        if (immersive) {
          setImmersive(false);
          setChromeOn(true);
          return;
        }
        closeReader();
        return;
      }
      if (inField || document.querySelector('.modal-overlay')) return;

      const meta = e.ctrlKey || e.metaKey;
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (meta) return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          goToPage(pageRef.current - 1);
          break;
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          goToPage(pageRef.current + 1);
          break;
        case 'Home':
          e.preventDefault();
          goToPage(1);
          break;
        case 'End':
          e.preventDefault();
          goToPage(numPages);
          break;
        case '+':
        case '=':
          e.preventDefault();
          zoomBy(ZOOM_STEP);
          break;
        case '-':
          e.preventDefault();
          zoomBy(1 / ZOOM_STEP);
          break;
        case '0':
          e.preventDefault();
          setFit(true);
          break;
        case 'f':
        case 'F':
          toggleFavorite();
          break;
        case 'p':
        case 'P':
          setPagesOpen((v) => !v);
          break;
        case 't':
        case 'T':
          cycleTheme();
          break;
        case 's':
        case 'S':
          setViewModePref(viewMode === 'single' ? 'scroll' : 'single');
          break;
        case 'v':
        case 'V':
          setTool('select');
          break;
        case 'd':
        case 'D':
          setTool('pen');
          break;
        case 'h':
        case 'H':
          setTool('highlight');
          break;
        case 'e':
        case 'E':
          setTool('eraser');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    page, numPages, review, themePop, pagesOpen, immersive, closeReader, goToPage, zoomBy,
    toggleFavorite, undo, redo, themeMode, viewMode, exitReview,
  ]);

  /* ---------- render ---------- */

  if (typeof document === 'undefined') return null;

  const openLinked = (itemId: string) => {
    window.dispatchEvent(new CustomEvent('wb-open-item', { detail: itemId }));
  };

  const showSpinner = loadState === 'loading' || (!!file && loadState === 'ready' && dims.length === 0 && viewMode === 'scroll');
  const drawingTool = tool === 'pen' || tool === 'highlight';
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;
  const annoCountPages = annoLiveSet.size;

  const cardCommon = {
    doc: doc as PDFDocumentProxy,
    themeFilter,
    pageBg,
    strokes: [] as Stroke[],
    tool,
    penColor: prefs.penColor,
    penWidth: prefs.penWidth,
    hlColor: prefs.hlColor,
    hlWidth: prefs.hlWidth,
    interactive: annosReady,
    onCommitStroke: (p: number, s: Stroke) => commitCommand({ type: 'add', page: p, strokes: [s] }),
    onEraseStrokes: (p: number, ss: Stroke[]) => commitCommand({ type: 'remove', page: p, strokes: ss }),
    onPointerActivity: bumpChrome,
    onGoToPage: goToPage,
    registerEl: (n: number, el: HTMLElement | null) => {
      if (el) pageElsRef.current.set(n, el);
      else pageElsRef.current.delete(n);
    },
  };

  const themeIcons: Record<ReaderThemeMode, React.ReactNode> = {
    light: <Sun size={14} />,
    dark: <Moon size={14} />,
    warm: <Leaf size={14} />,
    custom: <SlidersHorizontal size={14} />,
  };

  return createPortal(
    <div
      className={`reader-overlay${immersive ? ' reader-immersive' : ''}${immersive && chromeOn ? ' rd-chrome-on' : ''}${pagesOpen ? ' rd-pages-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Reading ${file?.title ?? 'PDF'}`}
    >
      {/* ------- header ------- */}
      <header className="rd-header">
        <div className="rd-title-wrap">
          <div className="rd-title-row">
            <span className="rd-file-badge">
              <FileText size={15} />
            </span>
            <span className="rd-title" title={file?.title ?? 'PDF'}>
              {file?.title ?? 'PDF'}
            </span>
            <span className="rd-pages">
              p.{page} of {numPages}
            </span>
          </div>
          <div
            className="rd-progress"
            role="progressbar"
            aria-valuenow={fileProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Read pages"
          >
            <div className="rd-progress-fill" style={{ width: `${fileProgress}%` }} />
          </div>
          <div className="rd-progress-meta">
            {readCount}/{numPages} pages read · {fileProgress}%
            {annoCountPages > 0 && (
              <span className="rd-annos-chip" title="Pages with your ink">
                <Pen size={10} aria-hidden /> {annoCountPages}
              </span>
            )}
            {saveState !== 'idle' && (
              <span className={`rd-save-chip ${saveState}`} title="Annotations are saved automatically">
                <span className="rd-save-dot" aria-hidden />
                {saveState === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
          </div>
        </div>

        <div className="rd-header-side">
          <span className="rd-clock-chip" title="Reading session time">
            <Clock size={13} />
            <span className="rd-mono">{fmtClock(elapsedSec)}</span>
          </span>
          <span className="rd-clock-chip rd-sub" title="Time on this page">
            <Eye size={13} />
            <span>
              {timeOnPage}s on page
            </span>
          </span>

          {deadlineChip && <span className={`rd-chip rd-${deadlineChip.tone}`}>{deadlineChip.text}</span>}

          {linkedItems.length > 0 && (
            <div className="rd-items">
              {linkedItems.slice(0, 3).map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="rd-item-chip"
                  onClick={() => openLinked(it.id)}
                  title={`Open ${it.title}`}
                >
                  {ITEM_ICON[it.type]}
                  <span className="rd-item-title">{it.title}</span>
                </button>
              ))}
              {linkedItems.length > 3 && <span className="rd-chip">+{linkedItems.length - 3}</span>}
            </div>
          )}

          {!activeTimer ? (
            <Btn variant="primary" size="sm" onClick={startFocusRead}>
              <Play size={13} /> Focus read
            </Btn>
          ) : focusHere && focusTiming ? (
            <div className="rd-focus-box">
              <span className={`rd-phase-badge ${phaseTone}`}>{focusTiming.phaseLabel}</span>
              <span className="rd-mono rd-focus-rem">{fmtRem(focusTiming.remaining)}</span>
              {focusTiming.paused ? (
                <IconBtn small title="Resume pomodoro" onClick={resumePomodoro}>
                  <Play size={13} />
                </IconBtn>
              ) : (
                <IconBtn small title="Pause pomodoro" onClick={pausePomodoro}>
                  <Pause size={13} />
                </IconBtn>
              )}
              <IconBtn small title="Skip to next phase" onClick={advancePomodoro}>
                <SkipForward size={13} />
              </IconBtn>
              <IconBtn small danger title="End focus session" onClick={endFocusRead}>
                <Square size={13} />
              </IconBtn>
            </div>
          ) : (
            <span className="rd-chip rd-elsewhere" title="A timer is running outside the reader">
              <Timer size={12} /> Timer running elsewhere
            </span>
          )}

          <IconBtn title="Close reader (Esc)" onClick={closeReader}>
            <X size={16} />
          </IconBtn>
        </div>
      </header>

      {/* ------- page stage ------- */}
      <div className="rd-stage-wrap" onClick={onStageClick}>
        {viewMode === 'single' ? (
          <div className="rd-stage" ref={stageRef} role="region" aria-label="PDF page view">
            {file && loadState === 'ready' && doc && (
              <PdfPageCard
                {...cardCommon}
                key={`single-p${page}`}
                pageNum={page}
                baseW={baseW}
                aspect={(dims[page - 1]?.w ?? baseW) / (dims[page - 1]?.h ?? baseW * 1.333)}
                cssWidth={cssWidth}
                virtualize={false}
                showLabel={false}
                strokes={currentStrokes}
              />
            )}
          </div>
        ) : (
          <div className="rd-strip-scroll" ref={stripScrollRef} role="region" aria-label="PDF continuous view">
            {review && (
              <div className="rd-review-banner" role="status">
                <BookmarkCheck size={14} aria-hidden />
                <span>
                  Reviewing {pagesList.length} favorite page{pagesList.length === 1 ? '' : 's'}
                  {reviewIndex > 0 && (
                    <span className="rd-mono"> · {reviewIndex} of {pagesList.length}</span>
                  )}
                </span>
                <button type="button" onClick={exitReview} className="rd-review-exit">
                  Exit review
                </button>
              </div>
            )}
            {!review && effectiveFilter !== 'all' && (
              <div className="rd-strip-filterbar">
                <span className="rd-strip-filter-label">
                  {filterLabel(effectiveFilter)} pages · {pagesList.length} shown
                </span>
                <button type="button" className="rd-review-exit" onClick={() => setFilter('all')}>
                  Show all
                </button>
              </div>
            )}
            <div className="rd-strip">
              {loadState === 'ready' && doc && dims.length > 0 && pagesList.map((n) => {
                const d = dims[n - 1] ?? dims[0] ?? { w: 612, h: 792 };
                return (
                  <PdfPageCard
                    {...cardCommon}
                    key={`strip-p${n}`}
                    pageNum={n}
                    baseW={d.w}
                    aspect={d.w / d.h}
                    cssWidth={cssWidth}
                    virtualize
                    showLabel
                    strokes={annos[String(n)] ?? []}
                  />
                );
              })}
            </div>
          </div>
        )}

        {showSpinner && (
          <div className="rd-centered">
            <div className="rd-spinner" role="status" aria-label="Loading PDF" />
            <div className="rd-load-label">{loadState === 'loading' ? 'Opening PDF…' : 'Measuring pages…'}</div>
          </div>
        )}

        {loadState === 'error' && (
          <div className="rd-centered">
            <div className="rd-error-card">
              <FileWarning size={22} />
              <div className="rd-error-title">Couldn't open this file</div>
              <div className="rd-error-msg">{loadError}</div>
              <Btn variant="primary" size="sm" onClick={closeReader}>
                Close
              </Btn>
            </div>
          </div>
        )}

        {!file && loadState === 'ready' && (
          <div className="rd-centered">
            <div className="rd-error-card">
              <FileWarning size={22} />
              <div className="rd-error-title">File not found</div>
              <div className="rd-error-msg">This file may have been deleted from your library.</div>
              <Btn variant="primary" size="sm" onClick={closeReader}>
                Close
              </Btn>
            </div>
          </div>
        )}

        {immersive && !chromeOn && (
          <div className="rd-immersive-hint">Immersive reading · move mouse or tap for controls · Esc exits</div>
        )}
      </div>

      {/* ------- pages panel (right slide-over) ------- */}
      <PagesPanel
        open={pagesOpen}
        onClose={() => setPagesOpen(false)}
        doc={doc}
        pages={pagesList}
        aspects={dims.map((d) => d.w / d.h)}
        currentPage={page}
        readSet={readSet}
        favoriteSet={favoriteSet}
        annos={annos}
        annoFileSet={new Set(file?.annoPages ?? [])}
        filter={effectiveFilter}
        counts={counts}
        onFilter={(f) => setFilter(f)}
        onReviewThese={enterReview}
        onGoToPage={goToPage}
        onToggleFavorite={(n) => toggleFileFavoritePage(fileId, n)}
        onToggleRead={(n) => markFilePage(fileId, n, !readSet.has(String(n)))}
      />

      {/* ------- footer toolbar ------- */}
      <footer className="rd-footer">
        <div className="rd-toolbar">
          {/* view mode */}
          <div className="rd-group" role="group" aria-label="View mode">
            <IconBtn
              title="Single page view (s)"
              aria-pressed={viewMode === 'single'}
              className={viewMode === 'single' ? 'rd-on' : ''}
              onClick={() => setViewModePref('single')}
            >
              <FileText size={15} />
            </IconBtn>
            <IconBtn
              title="Continuous reading — scroll through every page (s)"
              aria-pressed={viewMode === 'scroll'}
              className={viewMode === 'scroll' ? 'rd-on' : ''}
              onClick={() => setViewModePref('scroll')}
            >
              <ScrollText size={15} />
            </IconBtn>
          </div>

          <span className="rd-sep" aria-hidden="true" />

          {/* zoom */}
          <div className="rd-group" role="group" aria-label="Zoom">
            <IconBtn title="Zoom out (−)" onClick={() => zoomBy(1 / ZOOM_STEP)}>
              <ZoomOut size={15} />
            </IconBtn>
            <span className="rd-zoom-label rd-mono">{Math.round(effScale * 100)}%</span>
            <IconBtn title="Zoom in (+)" onClick={() => zoomBy(ZOOM_STEP)}>
              <ZoomIn size={15} />
            </IconBtn>
            <Btn size="sm" variant={fit ? 'primary' : 'default'} onClick={() => setFit(true)} title="Fit page width (0)">
              <MoveHorizontal size={13} /> Fit
            </Btn>
          </div>

          <span className="rd-sep" aria-hidden="true" />

          {/* tools */}
          <div className="rd-group" role="group" aria-label="Annotation tools">
            <IconBtn
              title="Select / navigate — links inside the page are clickable (v)"
              aria-pressed={tool === 'select'}
              className={tool === 'select' ? 'rd-on' : ''}
              onClick={() => setTool('select')}
            >
              <MousePointer2 size={15} />
            </IconBtn>
            <IconBtn
              title="Pen — freehand ink (d)"
              aria-pressed={tool === 'pen'}
              className={tool === 'pen' ? 'rd-on' : ''}
              onClick={() => setTool('pen')}
            >
              <Pen size={15} />
            </IconBtn>
            <IconBtn
              title="Highlighter — translucent marker (h)"
              aria-pressed={tool === 'highlight'}
              className={tool === 'highlight' ? 'rd-on' : ''}
              onClick={() => setTool('highlight')}
            >
              <Highlighter size={15} />
            </IconBtn>
            <IconBtn
              title="Eraser — removes whole strokes (e)"
              aria-pressed={tool === 'eraser'}
              className={tool === 'eraser' ? 'rd-on' : ''}
              onClick={() => setTool('eraser')}
            >
              <Eraser size={15} />
            </IconBtn>
          </div>

          {/* color + width for the active drawing tool */}
          {drawingTool && (
            <div className="rd-group rd-ink-group" role="group" aria-label="Ink color and thickness">
              <span className="rd-ink-dots">
                {(tool === 'pen' ? PEN_SWATCHES : HL_SWATCHES).map((c) => {
                  const active = tool === 'pen' ? prefs.penColor === c : prefs.hlColor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`rd-color-dot${active ? ' on' : ''}`}
                      style={{ background: c }}
                      aria-label={`Ink color ${c}`}
                      aria-pressed={active}
                      onClick={() =>
                        updateReaderPrefs(tool === 'pen' ? { penColor: c } : { hlColor: c })
                      }
                    />
                  );
                })}
              </span>
              <input
                className="rd-width-slider"
                type="range"
                min={tool === 'pen' ? 1 : 8}
                max={tool === 'pen' ? 12 : 48}
                step={tool === 'pen' ? 1 : 2}
                value={tool === 'pen' ? prefs.penWidth : prefs.hlWidth}
                onChange={(e) =>
                  updateReaderPrefs(
                    tool === 'pen'
                      ? { penWidth: Number(e.target.value) }
                      : { hlWidth: Number(e.target.value) }
                  )
                }
                aria-label={tool === 'pen' ? 'Pen thickness' : 'Highlighter thickness'}
              />
              <span className="rd-width-val rd-mono">{tool === 'pen' ? prefs.penWidth : prefs.hlWidth}</span>
            </div>
          )}

          <span className="rd-sep" aria-hidden="true" />

          {/* undo / redo / clear */}
          <div className="rd-group" role="group" aria-label="Undo and redo">
            <IconBtn title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
              <Undo2 size={15} />
            </IconBtn>
            <IconBtn title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
              <Redo2 size={15} />
            </IconBtn>
            <IconBtn title="Clear ink on this page" onClick={() => clearPage(pageRef.current)} disabled={!currentStrokes.length}>
              <Trash2 size={15} />
            </IconBtn>
          </div>

          <span className="rd-sep" aria-hidden="true" />

          {/* page theme */}
          <div className="rd-group rd-theme-group" role="group" aria-label="Page theme">
            {THEME_ORDER.filter((m) => m !== 'custom').map((m) => (
              <IconBtn
                key={m}
                title={`Page theme · ${m} (T cycles)`}
                aria-pressed={themeMode === m}
                className={`rd-theme-btn${themeMode === m ? ' rd-on' : ''}`}
                onClick={() => {
                  updateReaderPrefs({ themeMode: m });
                  if (themePop) setThemePop(false);
                }}
              >
                {themeIcons[m]}
              </IconBtn>
            ))}
            <span className="rd-theme-anchor" ref={themeAnchorRef}>
              <IconBtn
                title="Page theme · custom — tune brightness, contrast and warmth with sliders"
                aria-pressed={themeMode === 'custom'}
                aria-haspopup="dialog"
                aria-expanded={themePop}
                className={`rd-theme-btn rd-theme-btn-custom${themeMode === 'custom' ? ' rd-on' : ''}`}
                onClick={() => {
                  updateReaderPrefs({ themeMode: 'custom' });
                  if (themePop) setThemePop(false);
                  else openThemePop();
                }}
              >
                {themeIcons.custom}
              </IconBtn>
            </span>
            {themeMode === 'custom' && (
              <span
                className="rd-theme-live rd-mono"
                title={`Custom page theme — brightness ${prefs.custom.brightness}, contrast ${prefs.custom.contrast}, warmth ${prefs.custom.sepia}`}
              >
                b {prefs.custom.brightness} · c {prefs.custom.contrast} · w {prefs.custom.sepia}
              </span>
            )}
          </div>

          {/* custom theme popover — portal to body so the toolbar's overflow
              never clips or scrolls it away; fixed position computed on open */}
          {themePop && themePopPos && createPortal(
            <div
              ref={themePopRef}
              className="rd-theme-pop"
              role="dialog"
              aria-label="Custom page theme"
              style={{ position: 'fixed', left: themePopPos.left, bottom: themePopPos.bottom }}
            >
              <div className="rd-theme-pop-title">Custom page look</div>
              <div className="rd-theme-presets" role="group" aria-label="Custom theme presets">
                {THEME_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="rd-theme-preset"
                    onClick={() => updateReaderPrefs({ themeMode: 'custom', custom: { ...p.values } })}
                    title={`Brightness ${p.values.brightness} · contrast ${p.values.contrast} · warmth ${p.values.sepia}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {(['brightness', 'contrast', 'sepia'] as const).map((k) => (
                <label key={k} className="rd-theme-row">
                  <span>{k === 'sepia' ? 'warmth' : k}</span>
                  <input
                    type="range"
                    min={k === 'sepia' ? 0 : 50}
                    max={k === 'sepia' ? 80 : 150}
                    value={prefs.custom[k]}
                    onChange={(e) =>
                      updateReaderPrefs({ custom: { ...prefs.custom, [k]: Number(e.target.value) } })
                    }
                    aria-label={`${k} for custom page theme`}
                  />
                  <span className="rd-mono rd-theme-val">{prefs.custom[k]}</span>
                </label>
              ))}
              <div className="rd-theme-hint">Sliders apply live · T cycles themes · Esc closes</div>
            </div>,
            document.body
          )}

          <span className="rd-sep" aria-hidden="true" />

          {/* favorites + review + pages + export */}
          <div className="rd-group" role="group" aria-label="Page actions">
            <Btn
              size="sm"
              variant={pageIsFav ? 'primary' : 'default'}
              onClick={toggleFavorite}
              title={pageIsFav ? 'Remove this page from favorites (f)' : 'Star this page for review (f)'}
            >
              <Star size={13} /> {pageIsFav ? 'Starred' : 'Star'}
            </Btn>
            <Btn
              size="sm"
              variant={review ? 'primary' : 'default'}
              onClick={() => (review ? exitReview() : enterReview('favorites'))}
              title="Review your starred pages like a deck — great at the end of the day"
            >
              <BookmarkCheck size={13} /> {review ? 'Exit review' : 'Review'}
            </Btn>
            <IconBtn
              title="Pages panel — thumbnails and filters (p)"
              aria-pressed={pagesOpen}
              className={pagesOpen ? 'rd-on' : ''}
              onClick={() => setPagesOpen((v) => !v)}
            >
              <LayoutGrid size={15} />
            </IconBtn>
            <IconBtn title="Export this page as PNG (with ink)" onClick={() => void exportPage()}>
              <Download size={15} />
            </IconBtn>
          </div>

          <span className="rd-sep" aria-hidden="true" />

          {/* page nav */}
          <div className="rd-group" role="group" aria-label="Page navigation">
            <IconBtn title="Previous page (←)" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
              <ChevronLeft size={15} />
            </IconBtn>
            <span className="rd-page-box">
              <input
                className="rd-page-input"
                type="text"
                inputMode="numeric"
                value={pageInput}
                aria-label="Page number — press Enter to go"
                onChange={(e) => setPageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyPageInput();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <span className="rd-page-total">/ {numPages}</span>
            </span>
            <IconBtn title="Next page (→)" onClick={() => goToPage(page + 1)} disabled={page >= numPages}>
              <ChevronRight size={15} />
            </IconBtn>
          </div>

          <span className="rd-sep" aria-hidden="true" />

          <Btn
            size="sm"
            variant={pageIsRead ? 'primary' : 'default'}
            onClick={() => markFilePage(fileId, page, !pageIsRead)}
            title={pageIsRead ? 'Mark this page unread' : 'Mark this page read'}
          >
            {pageIsRead ? <BookCheck size={13} /> : <BookPlus size={13} />}
            {pageIsRead ? 'Read' : 'Mark read'}
          </Btn>

          <Btn
            size="sm"
            variant={immersive ? 'primary' : 'default'}
            onClick={toggleImmersive}
            title="Immersive reading — hides the toolbar until you move the mouse"
          >
            {immersive ? <PanelTopOpen size={13} /> : <PanelTopClose size={13} />} Immersive
          </Btn>

          <span className="rd-sep" aria-hidden="true" />

          <span className="rd-session-clock" title="Reading session time">
            <Clock size={13} />
            <span className="rd-mono">{fmtClock(elapsedSec)}</span>
          </span>
        </div>
      </footer>
    </div>,
    document.body
  );
}

/* pdf.js doc loader with the module-level cache from lib (kept separate so the
   overlay never imports the worker bundle synchronously). */
async function loadFileDocSafe(fileId: string): Promise<PDFDocumentProxy> {
  const { loadFileDoc } = await import('@/lib/workbench/pdf');
  return loadFileDoc(fileId);
}

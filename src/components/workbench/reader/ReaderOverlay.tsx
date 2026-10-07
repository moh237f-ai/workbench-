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
  BookCheck, BookOpenText, BookPlus, BookmarkCheck, ChevronLeft, ChevronRight, Clock, Download, Eraser, Eye,
  AlignJustify, Circle, Columns2, Copy, FileText, FileWarning, FilePlus2, Highlighter, Layers, LayoutGrid, Minus,
  MoreHorizontal, MoveHorizontal, MoveUpRight, PanelTopClose, PanelTopOpen, Shapes, Square, SquareCheck, Star,
  StickyNote, Sun, Moon, Type, Leaf, SlidersHorizontal, NotebookPen, Pause, Pen, Play, ScrollText, SkipForward,
  Target, Timer, Undo2, Redo2, Trash2, X, ZoomIn, ZoomOut, MousePointer2,
} from 'lucide-react';
import {
  PAGE_READ_THRESHOLD_SEC, useWB, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages,
  wbItemsForFile,
} from '@/lib/workbench/store';
import { cacheAnnos, fetchAnnosCached, putAnnos } from '@/lib/workbench/idb';
import { createStroke, drawStrokes, textBoxFontCss } from './annotations';
import { uid } from '@/lib/workbench/helpers';
import type { AnnoCommand } from './annotations';
import { applyAnnoCommand, createLimiter, revertAnnoCommand, UNDO_CAP } from './annotations';
import { renderPageToCanvas } from '@/lib/workbench/pdf';
import { HL_SWATCHES, PEN_SWATCHES } from '@/lib/workbench/types';
import type { StrokeShape } from '@/lib/workbench/types';
import type { PageAnnoMap, ReaderPrefs, ReaderThemeMode, ReaderTool, ReaderViewMode, Stroke } from '@/lib/workbench/types';
import type { Item } from '@/lib/workbench/types';
import { daysUntil, fmtClock, getFocusTiming, isoDate } from '@/lib/workbench/helpers';
import { PagesPanel, filterLabel } from './PagesPanel';
import type { FilterCounts, PageFilter } from './PagesPanel';
import { PdfPageCard } from './PdfPageCard';
import { MarkdownReader } from './MarkdownReader';
import { TextReader } from './TextReader';
import { InkColorPicker } from './InkColorPicker';
import { DictionaryPopup } from './DictionaryPopup';
import { InsertPagesModal } from './InsertPagesModal';
import { AnnotationsPanel } from './AnnotationsPanel';
import { exportAnnotatedPdf } from '@/lib/workbench/pdfwrite';
import { dropPageTexts, getPageTexts } from '@/lib/workbench/pdftext';
import { createMdNote } from '@/lib/workbench/notes';
import { useFindController, FindBar, paintFindHits } from './FindInDoc';
import type { TextMatch } from '@/lib/workbench/pdftext';
import { Btn, IconBtn, PopMenu, PopMenuItem, toast, useConfirm, useMediaQuery, useNow } from '../ui/primitives';
import './reader.css';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.1;
const FLUSH_EVERY_MS = 10_000;
const ANNO_SAVE_DEBOUNCE_MS = 700;
const CHROME_IDLE_MS = 2_600;
const MIN_SESSION_MS = 60_000;

/** Normalized width that fits the longest line of `text` at `size` (at-1000 units). */
function measureTextBox(text: string, size: number, font: Stroke['font']): number {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return 0.3;
  ctx.font = `${size}px ${textBoxFontCss(font)}`;
  const longest = text.split('\n').reduce((a, b) => (ctx.measureText(a).width >= ctx.measureText(b).width ? a : b), '');
  return Math.max(0.08, Math.min(0.92, (ctx.measureText(longest).width + 12) / 1000));
}
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

/** Text-mode font choices. */
const TEXT_FONTS: { id: ReaderPrefs['textFont']; label: string; tag: string; preview: string }[] = [
  { id: 'sans', label: 'Inter — clean sans', tag: 'Ag', preview: 'var(--font-inter), sans-serif' },
  { id: 'serif', label: 'Literata — book serif', tag: 'Ag', preview: 'Georgia, serif' },
  { id: 'mono', label: 'JetBrains — monospace', tag: 'Ag', preview: 'var(--font-jetbrains), monospace' },
  { id: 'persian', label: 'Vazirmatn — فارسی', tag: 'ف', preview: 'var(--font-persian), sans-serif' },
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
  const narrow = useMediaQuery('(max-width: 1100px)');
  const [moreOpen, setMoreOpen] = useState(false);
  const [dictSel, setDictSel] = useState<{ text: string; page: number; rect: DOMRect } | null>(null);
  const [selectedStroke, setSelectedStroke] = useState<{ page: number; id: string } | null>(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [docVersion, setDocVersion] = useState(0);
  const [readerTab, setReaderTab] = useState<'view' | 'draw' | 'insert'>('view');
  const [rulerOn, setRulerOn] = useState(false);
  const [annosOpen, setAnnosOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [textSync, setTextSync] = useState<{ page: number; nonce: number } | null>(null);
  const [textDraft, setTextDraft] = useState<{
    page: number; x: number; y: number; left: number; top: number;
    value: string; font: Stroke['font']; size: number; color: string;
    editId?: string; before?: Stroke; src?: boolean;
  } | null>(null);
  /* keep the text pop inside the window (it is fixed-positioned at the click) */
  const clampPopPos = (x: number, y: number): { left: number; top: number } => ({
    left: Math.max(8, Math.min(x, window.innerWidth - 356)),
    top: Math.max(8, Math.min(y, window.innerHeight - 240)),
  });

  const [srcSel, setSrcSel] = useState<{
    page: number; box: [number, number, number, number]; text: string; fontSize: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const shapesAnchorRef = useRef<HTMLSpanElement | null>(null);
  const find = useFindController(fileId, doc);
  const pageFindHits = useMemo(() => {
    if (!find.findOpen || !find.matches.length) return undefined;
    const onActivePage = find.matches.filter((m) => m.page === page);
    return onActivePage.map((m, i) => ({ index: m.index, length: m.length, active: i === find.active % Math.max(1, onActivePage.length) }));
  }, [find.findOpen, find.matches, find.active, page]);
  const moreAnchorRef = useRef<HTMLButtonElement | null>(null);
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
  const splitPageRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const visRatiosRef = useRef<Map<number, number>>(new Map());
  const sessionStartRef = useRef(Date.now());
  const startPageRef = useRef(page);
  const pageRef = useRef(page);
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    if (tool !== 'select') setReaderTab('draw');
  }, [tool]);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  const pageSecsRef = useRef(0);
  const pendingRef = useRef<Map<number, number>>(new Map());
  const sessionTotalsRef = useRef<Map<number, number>>(new Map());
  const visitedRef = useRef<Set<number>>(new Set());
  const newlyReadRef = useRef<Set<number>>(new Set());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewScrollGuardRef = useRef(false);
  /* while switching into scroll mode, the IO's first observation burst reports
     the top of the strip (page 1) — ignore dominant changes until the
     programmatic scroll to the current page has settled */
  const modeSwitchGuardUntilRef = useRef(0);

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
    reviewScrollGuardRef.current = true; // start the deck from the top, not the current page
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

  /* a stroke with `group` takes its linked strokes with it (patch + box) */
  const deleteStrokes = useCallback((pg: number, stroke: Stroke) => {
    const siblings = stroke.group
      ? (annosRef.current[String(pg)] ?? []).filter((st) => st.group === stroke.group)
      : [stroke];
    const doomed = siblings.length > 1 ? siblings : [stroke];
    commitCommand({ type: 'remove', page: pg, strokes: doomed });
    if (selectedStroke && pg === selectedStroke.page && doomed.some((st) => st.id === selectedStroke.id)) {
      setSelectedStroke(null);
    }
  }, [commitCommand, selectedStroke]);


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

  const commitUpdate = useCallback((page: number, before: Stroke, after: Stroke) => {
    commitCommand({ type: 'update', page, before, after });
  }, [commitCommand]);

  const updateSelected = useCallback((patch: Partial<Stroke>) => {
    if (!selectedStroke) return;
    const annos = annosRef.current[String(selectedStroke.page)] ?? [];
    const target = annos.find((st) => st.id === selectedStroke.id);
    if (!target) return;
    commitCommand({ type: 'update', page: selectedStroke.page, before: target, after: { ...target, ...patch } });
  }, [selectedStroke, commitCommand]);

  const deleteSelected = useCallback(() => {
    if (!selectedStroke) return;
    const annos = annosRef.current[String(selectedStroke.page)] ?? [];
    const target = annos.find((st) => st.id === selectedStroke.id);
    if (!target) return;
    deleteStrokes(selectedStroke.page, target);
    setSelectedStroke(null);
    toast('Stroke removed');
  }, [selectedStroke, commitCommand]);

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
      if (viewModeRef.current === 'text') return; // TextReader buckets its own time
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
    if (file?.kind === 'md') return; // markdown branch renders its own surface
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
  }, [fileId, file?.kind, docVersion]);

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
    const el = viewMode === 'single' ? stageRef.current : viewMode === 'split' ? splitPageRef.current : stripScrollRef.current;
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
    if (Date.now() < modeSwitchGuardUntilRef.current) return;
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

  /* scroll to the current page after switching into scroll mode.
     Entering review mode suppresses the jump exactly once (it should start
     from the top of the review deck), then the guard re-arms automatically. */
  useEffect(() => {
    if (viewMode !== 'scroll' || loadState !== 'ready') return;
    if (reviewScrollGuardRef.current) {
      reviewScrollGuardRef.current = false;
      return;
    }
    modeSwitchGuardUntilRef.current = Date.now() + 600;
    const el = pageElsRef.current.get(pageRef.current);
    el?.scrollIntoView({ block: 'start' });
    const t = setTimeout(() => {
      modeSwitchGuardUntilRef.current = 0;
    }, 600);
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
      } else if (viewMode === 'split') {
        flushPending();
        visitedRef.current.add(target);
        pageRef.current = target;
        pageSecsRef.current = 0;
        setPage(target);
        setFilePosition(fileId, target);
        setTextSync({ page: target, nonce: Date.now() });
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

  /* (pomodoro auto-advance is handled by the global PomodoroEngine — the manual
     skip button below still advances explicitly.) */

  /* ---------- annotation sidebar ---------- */
  /* tool activation: drawing/text tools need a visible page — Text (reflow)
     mode has no page surface, so switching to any of them leaves Text for
     Split automatically */
  const activateTool = useCallback((t: ReaderTool) => {
    setTool(t);
    if (t !== 'select' && viewMode === 'text') setViewModePref('split');
  }, [viewMode]);

  const jumpToAnnotation = useCallback((pg: number, strokeId: string) => {
    setTool('select');
    setSelectedStroke({ page: pg, id: strokeId });
    if (viewMode === 'text') setViewModePref('split'); /* show the page */
    goToPage(pg);
  }, [viewMode, goToPage]);

  const updateAnnotationNote = useCallback((pg: number, stroke: Stroke, note: string) => {
    commitCommand({ type: 'update', page: pg, before: stroke, after: { ...stroke, note } });
  }, [commitCommand]);

  const deleteAnnotationFromPanel = useCallback((pg: number, stroke: Stroke) => {
    deleteStrokes(pg, stroke);
  }, [deleteStrokes]);

  /* ---------- immersive chrome ----------
     Entering immersive hides the chrome IMMEDIATELY. It comes back only when
     the cursor aims at the screen edges where the chrome lives (top/bottom
     96px), on a tap, or exits with Esc — mid-page mouse movement (reading,
     drawing, trackpad drift) never wakes it. The old ≥28px-move wake made
     every hand adjustment re-show the toolbar, which is why immersive felt
     like it "didn't work". */
  const immersiveRef = useRef(false);
  useEffect(() => {
    immersiveRef.current = immersive;
  }, [immersive]);

  const bumpChrome = useCallback(() => {
    setChromeOn(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setChromeOn(false), CHROME_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!immersive) return;
    setChromeOn(false);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const EDGE = 96;
    const onMove = (e: MouseEvent) => {
      if (e.clientY <= EDGE || e.clientY >= window.innerHeight - EDGE) bumpChrome();
    };
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
    } else {
      setChromeOn(false);
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
        if (annosOpen) {
          setAnnosOpen(false);
          return;
        }
        if (srcSel) {
          setSrcSel(null);
          setTextDraft(null);
          return;
        }
        if (selectedStroke) {
          setSelectedStroke(null);
          return;
        }
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
      if (meta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        find.open();
        return;
      }
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
        case 'Delete':
        case 'Backspace':
          if (selectedStroke) {
            e.preventDefault();
            deleteSelected();
          }
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
          setViewModePref(
            viewMode === 'single' ? 'scroll' : viewMode === 'scroll' ? 'text' : viewMode === 'text' ? 'split' : 'single'
          );
          break;
        case 'v':
        case 'V':
          setTool('select');
          break;
        case 'd':
        case 'D':
          activateTool('pen');
          break;
        case 'h':
        case 'H':
          activateTool('highlight');
          break;
        case 'e':
        case 'E':
          activateTool('eraser');
          break;
        case 'r':
        case 'R':
          activateTool('rect');
          break;
        case 'o':
        case 'O':
          activateTool('ellipse');
          break;
        case 'l':
        case 'L':
          activateTool('line');
          break;
        case 'a':
        case 'A':
          activateTool('arrow');
          break;
        case 'x':
        case 'X':
          activateTool('text');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    page, numPages, review, themePop, pagesOpen, immersive, closeReader, goToPage, zoomBy,
    toggleFavorite, undo, redo, themeMode, viewMode, exitReview, find, selectedStroke, deleteSelected,
    annosOpen, srcSel,
  ]);

  /* ---------- render ---------- */

  if (typeof document === 'undefined') return null;

  /* markdown files render in their own surface */
  if (file?.kind === 'md') {
    return <MarkdownReader fileId={fileId} onClose={onClose} />;
  }

  /* after inserting pages the stored PDF changed — remount the whole overlay
     with fresh caches (doc, dims, text) */
  void file?.pageCount; // pageCount changes feed the reloadKey remount

  const openLinked = (itemId: string) => {
    window.dispatchEvent(new CustomEvent('wb-open-item', { detail: itemId }));
  };

  const showSpinner = loadState === 'loading' || (!!file && loadState === 'ready' && dims.length === 0 && viewMode === 'scroll');
  const drawingTool = tool === 'pen' || tool === 'highlight' || tool === 'text';
  const isShapeTool = tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow';
  const selStrokeObj = selectedStroke?.page === page
    ? (annos[String(selectedStroke.page)] ?? []).find((st) => st.id === selectedStroke.id)
    : null;
  const selectedColor = selStrokeObj?.color ?? prefs.penColor;
  const selectedWidth = selStrokeObj?.width ?? prefs.penWidth;
  const selectedOpacity = selStrokeObj?.opacity ?? 1;
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
    penOpacity: prefs.penOpacity,
    hlColor: prefs.hlColor,
    hlWidth: prefs.hlWidth,
    hlOpacity: prefs.hlOpacity,
    interactive: annosReady,
    textEnabled: tool === 'select' || !!pageFindHits,
    findHits: pageFindHits,
    onWordSelected: (payload) => setDictSel(payload),
    selectedId: selectedStroke?.page === page ? selectedStroke.id : null,
    onSelectStroke: (id) => setSelectedStroke(id ? { page, id } : null),
    onCommitUpdate: commitUpdate,
    onTextPlace: (pg, x, y, vp) => {
      setSelectedStroke(null);
      const pos = clampPopPos(vp.left, vp.top);
      setTextDraft({ page: pg, x, y, left: pos.left, top: pos.top, value: '', font: 'sans', size: 18, color: prefs.penColor });
    },
    eraserSize: prefs.eraserSize,
    onEditText: (pg, stroke, vp) => {
      setSelectedStroke(null);
      const pos = clampPopPos(vp.left, vp.top);
      setTextDraft({
        page: pg, x: stroke.points[0], y: stroke.points[1], left: pos.left, top: pos.top,
        value: stroke.text ?? '', font: stroke.font ?? 'sans', size: stroke.fontSize ?? 18,
        color: stroke.color, editId: stroke.id, before: stroke,
      });
    },
    onEditTextSource: (pg, info) => {
      /* replace real page text: enter a SELECTABLE placement — drag/resize the
         highlighted box, then save; saving writes a whiteout patch + the text
         box as one grouped pair (deleting the box removes the patch) */
      setDictSel(null);
      window.getSelection()?.removeAllRanges();
      setSrcSel({ page: pg, box: info.box, text: info.text, fontSize: info.fontSize });
      const pos = clampPopPos(info.left, info.top);
      setTextDraft({
        page: pg, x: info.box[0], y: info.box[1], left: pos.left, top: pos.top,
        value: info.text, font: 'sans', size: info.fontSize, color: '#111111', src: true,
      });
    },
    onCommitStroke: (p: number, s: Stroke) => commitCommand({ type: 'add', page: p, strokes: [s] }),
    onEraseStrokes: (p: number, ss: Stroke[]) => commitCommand({ type: 'remove', page: p, strokes: ss }),
    onEraseResult: (p: number, removed: Stroke[], added: Stroke[]) =>
      commitCommand({ type: 'replace', page: p, remove: removed, add: added }),
    eraserMode: prefs.eraserMode,
    srcSelBox: srcSel && srcSel.page === page ? srcSel.box : null,
    onSrcSelBox: (box: [number, number, number, number]) =>
      setSrcSel((cur) => (cur ? { ...cur, box } : cur)),
    onPointerActivity: () => {
      if (!immersiveRef.current) bumpChrome();
    },
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

      {/* reading ruler */}
      {rulerOn && <ReadingRuler />}

      {/* ------- page stage ------- */}
      <div
        className={`rd-stage-wrap${viewMode === 'text' || viewMode === 'split' ? ` rd-theme-${themeMode}-text` : ''}`}
        onClick={onStageClick}
      >
        {find.findOpen && doc && (
          <FindBar
            find={find}
            onJump={(m: TextMatch) => {
              if (viewMode === 'text' || viewMode === 'split') {
                const el = document.querySelector(`.rd-text-article section[data-page='${m.page}']`);
                el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
              } else {
                goToPage(m.page);
              }
            }}
          />
        )}
        {viewMode === 'split' && doc ? (
          <div className="rd-split">
            <div className="rd-split-page" ref={splitPageRef}>
              {file && loadState === 'ready' && (
                <PdfPageCard
                  {...cardCommon}
                  key={`split-p${page}`}
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
            <div className="rd-split-text">
              <TextReader
                fileId={fileId}
                doc={doc}
                startPage={page}
                scrollToPage={textSync}
                onActivePage={(n) => {
                  pageRef.current = n;
                  setPageInput(String(n));
                  if (n !== page) setPage(n);
                }}
                onWordSelected={setDictSel}
              />
            </div>
          </div>
        ) : viewMode === 'text' ? (
          doc && (
            <TextReader
              fileId={fileId}
              doc={doc}
              startPage={page}
              onActivePage={(n) => {
                pageRef.current = n;
                setPageInput(String(n));
              }}
              onWordSelected={setDictSel}
              onExitText={() => setViewModePref('single')}
            />
          )
        ) : viewMode === 'single' ? (
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
          <div className="rd-immersive-hint">Immersive reading · move to the screen edge or tap for controls · Esc exits</div>
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
        {/* contextual stroke editor — floats above this footer */}
      {selectedStroke?.page === page && selStrokeObj && (
        <div className="rd-stroke-editor" role="group" aria-label="Selected annotation">
          <span className="rd-sel-lab">
            {selStrokeObj.shape ? (selStrokeObj.shape === 'rect' ? 'rectangle' : selStrokeObj.shape) : selStrokeObj.tool}
          </span>
          <InkColorPicker
            label="Stroke color"
            value={selectedColor}
            swatches={selStrokeObj.tool === 'highlight' ? HL_SWATCHES : PEN_SWATCHES}
            onChange={(c) => updateSelected({ color: c })}
          />
          {selStrokeObj.shape === 'text' ? (
            <>
              <textarea
                className="rd-stroke-textedit"
                value={selStrokeObj.text ?? ''}
                dir="auto"
                rows={2}
                onChange={(e) => updateSelected({ text: e.target.value })}
                aria-label="Text box content"
              />
              <label className="rd-edit-row" title="Font size">
                <span className="rd-edit-lab">size</span>
                <input
                  type="range"
                  min={8}
                  max={48}
                  step={1}
                  value={selStrokeObj.fontSize ?? 14}
                  onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })}
                  aria-label="Font size"
                />
                <span className="rd-mono rd-width-val">{selStrokeObj.fontSize ?? 14}px</span>
              </label>
              <div className="rd-edit-row" role="group" aria-label="Font family" title="Font family">
                <span className="rd-edit-lab">font</span>
                <div className="rd-font-seg">
                  {(['sans', 'serif', 'mono', 'persian'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`rd-text-fontbtn f-${f}${(selStrokeObj.font ?? 'sans') === f ? ' on' : ''}`}
                      aria-pressed={(selStrokeObj.font ?? 'sans') === f}
                      onClick={() => updateSelected({ font: f })}
                    >
                      {f === 'persian' ? 'فارسی' : f === 'sans' ? 'Aa' : f === 'serif' ? 'Ag' : 'A_'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <label className="rd-edit-row" title="Thickness">
              <span className="rd-edit-lab">size</span>
              <input
                type="range"
                min={1}
                max={48}
                step={1}
                value={selectedWidth}
                onChange={(e) => updateSelected({ width: Number(e.target.value) })}
                aria-label="Stroke thickness"
              />
              <span className="rd-mono rd-width-val">{selectedWidth}</span>
            </label>
          )}
          <label className="rd-edit-row" title="Opacity">
            <span className="rd-edit-lab">fill</span>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(selectedOpacity * 100)}
              onChange={(e) => updateSelected({ opacity: Number(e.target.value) / 100 })}
              aria-label="Stroke opacity"
            />
            <span className="rd-mono rd-width-val">{Math.round(selectedOpacity * 100)}%</span>
          </label>
          <IconBtn
            small
            title={selStrokeObj.note ? 'Edit note' : 'Add note'}
            onClick={() => {
              setEditingNote(true);
              setNoteDraft(selStrokeObj.note ?? '');
            }}
          >
            <NotebookPen size={14} />
          </IconBtn>
          <span className="rd-sep" aria-hidden="true" />
          <IconBtn
            small
            title="Duplicate — copies beside the original"
            onClick={() => {
              const off = 0.035;
              const copy = { ...selStrokeObj, id: `${selStrokeObj.id}-c${Date.now().toString(36)}`, points: selStrokeObj.points.map((v, i) => Math.min(1, Math.max(0, v + (i % 2 === 0 ? off : off)))) , createdAt: Date.now() };
              commitCommand({ type: 'add', page, strokes: [copy] });
              toast('Duplicated');
            }}
          >
            <Copy size={14} />
          </IconBtn>
          <IconBtn small danger title="Delete (Del)" onClick={deleteSelected}>
            <Trash2 size={14} />
          </IconBtn>
          {editingNote && (
            <div className="rd-anno-note-edit">
              <textarea
                autoFocus
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Note for this annotation…"
                rows={3}
                dir="auto"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    updateSelected({ note: noteDraft.trim() });
                    setEditingNote(false);
                    toast('Note saved');
                  } else if (e.key === 'Escape') {
                    setEditingNote(false);
                  }
                }}
              />
              <div className="rd-anno-note-acts">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => {
                    updateSelected({ note: noteDraft.trim() });
                    setEditingNote(false);
                    toast('Note saved');
                  }}
                >
                  Save
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setEditingNote(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
        <div className="rd-toolbar">
          {/* tab rail — View · Draw · Insert */}
          <div className="rd-tab-rail" role="tablist" aria-label="Toolbar sections">
            {([
              { id: 'view', label: 'View', icon: <FileText size={14} /> },
              { id: 'draw', label: 'Draw', icon: <Pen size={14} /> },
              { id: 'insert', label: 'Insert', icon: <FilePlus2 size={14} /> },
            ] as const).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={readerTab === t.id}
                className={`rd-tab${readerTab === t.id ? ' on' : ''}`}
                onClick={() => setReaderTab(t.id)}
                title={`${t.label} tools`}
              >
                {t.icon}
                <span className="rd-tab-lbl">{t.label}</span>
              </button>
            ))}
          </div>

          <span className="rd-sep" aria-hidden="true" />

          {/* ============ VIEW tab ============ */}
          {readerTab === 'view' && (
            <>
          {/* view mode */}
          <div className="rd-group" role="group" aria-label="View mode">
            <IconBtn
              title="Single page view (s cycles)"
              aria-pressed={viewMode === 'single'}
              className={viewMode === 'single' ? 'rd-on' : ''}
              onClick={() => setViewModePref('single')}
            >
              <FileText size={15} />
            </IconBtn>
            <IconBtn
              title="Continuous reading (s cycles)"
              aria-pressed={viewMode === 'scroll'}
              className={viewMode === 'scroll' ? 'rd-on' : ''}
              onClick={() => setViewModePref('scroll')}
            >
              <ScrollText size={15} />
            </IconBtn>
            <IconBtn
              title="Text mode — reflowable typography (s cycles)"
              aria-pressed={viewMode === 'text'}
              className={viewMode === 'text' ? 'rd-on' : ''}
              onClick={() => setViewModePref('text')}
            >
              <BookOpenText size={15} />
            </IconBtn>
            <IconBtn
              title="Split view — page + text side by side (s cycles)"
              aria-pressed={viewMode === 'split'}
              className={viewMode === 'split' ? 'rd-on' : ''}
              onClick={() => setViewModePref('split')}
            >
              <Columns2 size={15} />
            </IconBtn>
            {(viewMode === 'text' || viewMode === 'split') && (
              <div className="rd-typo" role="group" aria-label="Text typography">
                <span className="rd-typo-seg" role="radiogroup" aria-label="Font family">
                  {TEXT_FONTS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={prefs.textFont === f.id}
                      className={prefs.textFont === f.id ? 'on' : ''}
                      onClick={() => updateReaderPrefs({ textFont: f.id })}
                      title={f.label}
                      style={{ fontFamily: f.preview }}
                    >
                      {f.tag}
                    </button>
                  ))}
                </span>
                <label className="rd-typo-slider" title="Font size">
                  <span className="rd-mono">{prefs.textSize}px</span>
                  <input type="range" min={14} max={28} step={1} value={prefs.textSize}
                    onChange={(e) => updateReaderPrefs({ textSize: Number(e.target.value) })}
                    aria-label="Font size" />
                </label>
                <label className="rd-typo-slider" title="Line height">
                  <span className="rd-mono">{prefs.textLineHeight.toFixed(2)}</span>
                  <input type="range" min={1.4} max={2.2} step={0.05} value={prefs.textLineHeight}
                    onChange={(e) => updateReaderPrefs({ textLineHeight: Number(e.target.value) })}
                    aria-label="Line height" />
                </label>
                <label className="rd-typo-slider" title="Column width">
                  <span className="rd-mono">{prefs.textWidth}ch</span>
                  <input type="range" min={40} max={80} step={2} value={prefs.textWidth}
                    onChange={(e) => updateReaderPrefs({ textWidth: Number(e.target.value) })}
                    aria-label="Column width" />
                </label>
              </div>
            )}
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


          <IconBtn
            title="Reading ruler — a guide band that follows your cursor"
            aria-pressed={rulerOn}
            className={rulerOn ? 'rd-on' : ''}
            onClick={() => setRulerOn((v) => !v)}
          >
            <AlignJustify size={15} />
          </IconBtn>
          <span className="rd-sep" aria-hidden="true" />
            </>
          )}

          {/* ============ DRAW tab ============ */}
          {readerTab === 'draw' && (
            <>
          {/* tools */}
          <div className="rd-group" role="group" aria-label="Annotation tools">
            <IconBtn
              title="Select / navigate — pick strokes, links clickable (v)"
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
              onClick={() => activateTool('pen')}
            >
              <Pen size={15} />
            </IconBtn>
            <IconBtn
              title="Highlighter — translucent marker (h)"
              aria-pressed={tool === 'highlight'}
              className={tool === 'highlight' ? 'rd-on' : ''}
              onClick={() => activateTool('highlight')}
            >
              <Highlighter size={15} />
            </IconBtn>
            <IconBtn
              title="Eraser — removes whole strokes (e)"
              aria-pressed={tool === 'eraser'}
              className={tool === 'eraser' ? 'rd-on' : ''}
              onClick={() => activateTool('eraser')}
            >
              <Eraser size={15} />
            </IconBtn>
            <IconBtn
              title="Text box — click the page, type (x)"
              aria-pressed={tool === 'text'}
              className={tool === 'text' ? 'rd-on' : ''}
              onClick={() => activateTool('text')}
            >
              <Type size={15} />
            </IconBtn>
            <span ref={shapesAnchorRef} className="rd-more-anchor">
              <IconBtn
                title="Shapes — rectangle, ellipse, line, arrow"
                aria-haspopup="menu"
                aria-expanded={shapesOpen}
                className={isShapeTool ? 'rd-on' : ''}
                onClick={() => setShapesOpen((v) => !v)}
              >
                {tool === 'rect' ? <Square size={15} /> : tool === 'ellipse' ? <Circle size={15} /> : tool === 'arrow' ? <MoveUpRight size={15} /> : tool === 'line' ? <Minus size={15} /> : <Shapes size={15} />}
              </IconBtn>
            </span>
            <PopMenu open={shapesOpen} onClose={() => setShapesOpen(false)} anchorRef={shapesAnchorRef} width={168}>
              {([
                { id: 'rect', label: 'Rectangle', icon: <Square size={14} /> },
                { id: 'ellipse', label: 'Ellipse', icon: <Circle size={14} /> },
                { id: 'line', label: 'Line', icon: <Minus size={14} /> },
                { id: 'arrow', label: 'Arrow', icon: <MoveUpRight size={14} /> },
              ] as { id: ReaderTool; label: string; icon: React.ReactNode }[]).map((sh) => (
                <PopMenuItem
                  key={sh.id}
                  icon={sh.icon}
                  label={sh.label}
                  active={tool === sh.id}
                  onClick={() => {
                    setTool(sh.id);
                    setShapesOpen(false);
                  }}
                />
              ))}
            </PopMenu>
          </div>

          {/* eraser size */}
          {tool === 'eraser' && (
            <>
              <div className="rd-group rd-ink-group" role="group" aria-label="Eraser size">
                <span className="rd-ink-dots" />
                <input
                  className="rd-width-slider"
                  type="range"
                  min={6}
                  max={40}
                  step={2}
                  value={prefs.eraserSize}
                  onChange={(e) => updateReaderPrefs({ eraserSize: Number(e.target.value) })}
                  aria-label="Eraser size"
                />
                <span className="rd-width-val rd-mono">{prefs.eraserSize}</span>
              </div>
              <div className="rd-group" role="group" aria-label="Eraser mode">
                <button
                  type="button"
                  className={`rd-mode-btn${prefs.eraserMode === 'stroke' ? ' on' : ''}`}
                  aria-pressed={prefs.eraserMode === 'stroke'}
                  title="Whole strokes — one touch removes the entire stroke"
                  onClick={() => updateReaderPrefs({ eraserMode: 'stroke' })}
                >
                  Whole
                </button>
                <button
                  type="button"
                  className={`rd-mode-btn${prefs.eraserMode === 'precise' ? ' on' : ''}`}
                  aria-pressed={prefs.eraserMode === 'precise'}
                  title="Precise — erases only the touched part and splits the rest (pen & highlighter)"
                  onClick={() => updateReaderPrefs({ eraserMode: 'precise' })}
                >
                  Precise
                </button>
              </div>
            </>
          )}

          {/* color + width for the active drawing tool */}
          {drawingTool && !selectedStroke && (
            <div className="rd-group rd-ink-group rd-ink-compact" role="group" aria-label="Ink color and thickness">
              <InkColorPicker
                label={tool === 'pen' ? 'Pen color' : 'Highlighter color'}
                value={tool === 'pen' ? prefs.penColor : prefs.hlColor}
                swatches={tool === 'pen' ? PEN_SWATCHES : HL_SWATCHES}
                onChange={(c) => updateReaderPrefs(tool === 'pen' ? { penColor: c } : { hlColor: c })}
              />
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
              <input
                className="rd-opacity-slider"
                type="range"
                min={tool === 'pen' ? 20 : 15}
                max={100}
                step={5}
                value={Math.round((tool === 'pen' ? prefs.penOpacity : prefs.hlOpacity) * 100)}
                onChange={(e) =>
                  updateReaderPrefs(
                    tool === 'pen'
                      ? { penOpacity: Number(e.target.value) / 100 }
                      : { hlOpacity: Number(e.target.value) / 100 }
                  )
                }
                aria-label="Ink opacity"
                title="Opacity"
              />
              <span className="rd-width-val rd-mono">{Math.round((tool === 'pen' ? prefs.penOpacity : prefs.hlOpacity) * 100)}%</span>
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

          <IconBtn
            title="Annotations panel — list, search, jump, notes"
            aria-pressed={annosOpen}
            className={annosOpen ? 'rd-on' : ''}
            onClick={() => setAnnosOpen((v) => !v)}
          >
            <StickyNote size={15} />
          </IconBtn>

          <span className="rd-sep" aria-hidden="true" />

          {/* page theme */}

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

            </>
          )}

          {/* ============ INSERT tab ============ */}
          {readerTab === 'insert' && (
            <>
          {/* favorites + review + pages + export — slimmed on narrow widths */}
          <div className="rd-group" role="group" aria-label="Page actions">
            {!narrow && (
              <>
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
              </>
            )}
            <IconBtn
              title="Pages panel — thumbnails and filters (p)"
              aria-pressed={pagesOpen}
              className={pagesOpen ? 'rd-on' : ''}
              onClick={() => setPagesOpen((v) => !v)}
            >
              <LayoutGrid size={15} />
            </IconBtn>
            {!narrow && (
              <>
                <IconBtn title="Insert template pages (notes, lines, grid…)" onClick={() => setInsertOpen(true)}>
                  <FilePlus2 size={15} />
                </IconBtn>
                <IconBtn
                  title="New markdown note from this page's text"
                  onClick={() => {
                    void (async () => {
                      if (!doc) return;
                      const texts = await getPageTexts(fileId, doc);
                      const text = texts[pageRef.current - 1]?.plain ?? '';
                      const title = `${file?.title ?? 'PDF'} — p.${pageRef.current}`;
                      const ok = await createMdNote({ title, content: `# ${title}\n\n${text}\n` });
                      if (ok) toast('Note created', `Page ${pageRef.current} captured.`);
                      else toast('Could not create note');
                    })();
                  }}
                >
                  <NotebookPen size={15} />
                </IconBtn>
                <IconBtn
                  title="Export the whole PDF with your ink as a new file"
                  disabled={exporting}
                  onClick={() => {
                    if (!doc || exporting) return;
                    setExporting(true);
                    void exportAnnotatedPdf(fileId, doc, annos, (done, total) => {
                      toast('Exporting with ink…', `Page ${done} of ${total}`);
                    })
                      .then(async (bytes) => {
                        const { putBlob } = await import('@/lib/workbench/idb');
                        const { useWB } = await import('@/lib/workbench/store');
                        const newId = `${fileId}-ink-${Date.now().toString(36)}`;
                        await putBlob(newId, new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
                        const src = useWB.getState().files.find((f) => f.id === fileId);
                        useWB.getState().addFile({
                          id: newId,
                          kind: 'pdf',
                          title: `${src?.title ?? 'PDF'} (with ink)`,
                          fileName: `${src?.fileName ?? 'document.pdf'}`,
                          size: bytes.length,
                          pageCount: doc.numPages,
                          folderId: src?.folderId ?? null,
                          color: src?.color ?? null,
                          tags: src?.tags ?? [],
                        });
                        toast('Exported with ink', `“${src?.title ?? 'PDF'} (with ink)” added to the library.`);
                      })
                      .catch((err) => toast('Export failed', err instanceof Error ? err.message : 'Could not write the PDF.'))
                      .finally(() => setExporting(false));
                  }}
                >
                  <Download size={15} />
                </IconBtn>
              </>
            )}
          </div>

            </>
          )}

          <span className="rd-sep" aria-hidden="true" />

          {/* page nav — always visible */}
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

          {/* narrow widths: low-priority controls move into the ⋯ overflow menu */}
          {narrow ? (
            <div className="rd-group">
              <span ref={moreAnchorRef} className="rd-more-anchor">
                <IconBtn
                  title="More reader actions"
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  className={moreOpen ? 'rd-on' : ''}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  <MoreHorizontal size={16} />
                </IconBtn>
              </span>
              <PopMenu open={moreOpen} onClose={() => setMoreOpen(false)} anchorRef={moreAnchorRef} width={216}>
                <PopMenuItem
                  icon={pageIsRead ? <BookCheck size={14} /> : <BookPlus size={14} />}
                  label={pageIsRead ? 'Mark page unread' : 'Mark page read'}
                  active={pageIsRead}
                  onClick={() => {
                    markFilePage(fileId, page, !pageIsRead);
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={immersive ? <PanelTopOpen size={14} /> : <PanelTopClose size={14} />}
                  label={immersive ? 'Exit immersive' : 'Immersive reading'}
                  active={immersive}
                  onClick={() => {
                    toggleImmersive();
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={<FilePlus2 size={14} />}
                  label="Insert template pages"
                  onClick={() => {
                    setInsertOpen(true);
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={<Download size={14} />}
                  label="Export page as PNG"
                  onClick={() => {
                    void exportPage();
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={<Layers size={14} />}
                  label="Export PDF with ink"
                  onClick={() => {
                    if (!doc || exporting) return;
                    setExporting(true);
                    void exportAnnotatedPdf(fileId, doc, annos, (done, total) => {
                      toast('Exporting with ink…', `Page ${done} of ${total}`);
                    })
                      .then(async (bytes) => {
                        const { putBlob } = await import('@/lib/workbench/idb');
                        const { useWB } = await import('@/lib/workbench/store');
                        const newId = `${fileId}-ink-${Date.now().toString(36)}`;
                        await putBlob(newId, new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
                        const src = useWB.getState().files.find((f) => f.id === fileId);
                        useWB.getState().addFile({
                          id: newId,
                          kind: 'pdf',
                          title: `${src?.title ?? 'PDF'} (with ink)`,
                          fileName: src?.fileName ?? 'document.pdf',
                          size: bytes.length,
                          pageCount: doc.numPages,
                          folderId: src?.folderId ?? null,
                          color: src?.color ?? null,
                          tags: src?.tags ?? [],
                        });
                        toast('Exported with ink', `“${src?.title ?? 'PDF'} (with ink)” added to the library.`);
                      })
                      .catch((err) => toast('Export failed', err instanceof Error ? err.message : 'Could not write the PDF.'))
                      .finally(() => setExporting(false));
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={<NotebookPen size={14} />}
                  label="New note from this page"
                  onClick={() => {
                    void (async () => {
                      const texts = await getPageTexts(fileId, doc!);
                      const text = texts[pageRef.current - 1]?.plain ?? '';
                      const title = `${file?.title ?? 'PDF'} — p.${pageRef.current}`;
                      const ok = await createMdNote({ title, content: `# ${title}\n\n${text}\n` });
                      if (ok) toast('Note created', `Page ${pageRef.current} text captured — find it in the Library.`);
                      else toast('Could not create note');
                    })();
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={<Star size={14} />}
                  label={pageIsFav ? 'Unstar this page' : 'Star this page'}
                  active={pageIsFav}
                  onClick={() => {
                    toggleFavorite();
                    setMoreOpen(false);
                  }}
                />
                <PopMenuItem
                  icon={<BookmarkCheck size={14} />}
                  label={review ? 'Exit review deck' : 'Review starred pages'}
                  active={review}
                  onClick={() => {
                    if (review) exitReview();
                    else enterReview('favorites');
                    setMoreOpen(false);
                  }}
                />
              </PopMenu>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      </footer>

      <AnnotationsPanel
        open={annosOpen}
        onClose={() => setAnnosOpen(false)}
        annos={annos}
        currentPage={page}
        onJump={jumpToAnnotation}
        onUpdateNote={updateAnnotationNote}
        onDelete={deleteAnnotationFromPanel}
      />
      {insertOpen && (
        <InsertPagesModal
          fileId={fileId}
          currentPage={page}
          numPages={numPages}
          onClose={() => setInsertOpen(false)}
          onInserted={() => {
            /* stored blob changed: drop every cache layer, then reload the doc */
            void (async () => {
              const { invalidateDocCache } = await import('@/lib/workbench/pdf');
              const { invalidateCoverCache } = await import('@/lib/workbench/idb');
              invalidateDocCache(fileId);
              dropPageTexts(fileId);
              invalidateCoverCache(fileId);
              setDoc(null);
              setDims([]);
              setPage(1);
              setPageInput('1');
              setDocVersion((v) => v + 1);
            })();
          }}
        />
      )}
      {textDraft && (
        <div className="rd-text-input-pop" style={{ left: textDraft.left, top: textDraft.top }}>
          <div className="rd-text-pop-ctl" role="group" aria-label="Text style">
            {(['sans', 'serif', 'mono', 'persian'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`rd-text-fontbtn f-${f}${textDraft.font === f ? ' on' : ''}`}
                title={f === 'persian' ? 'Vazirmatn (فارسی)' : f}
                aria-pressed={textDraft.font === f}
                onClick={() => setTextDraft({ ...textDraft, font: f })}
              >
                {f === 'persian' ? 'فارسی' : f === 'sans' ? 'Aa' : f === 'serif' ? 'Ag' : 'A_'}
              </button>
            ))}
            <input
              type="range" min={10} max={48} step={1} value={textDraft.size}
              title="Font size" aria-label="Font size"
              onChange={(e) => setTextDraft({ ...textDraft, size: Number(e.target.value) })}
            />
            <span className="rd-mono rd-width-val">{textDraft.size}</span>
            <input
              type="color" value={textDraft.color} title="Text color" aria-label="Text color"
              className="rd-text-color"
              onChange={(e) => setTextDraft({ ...textDraft, color: e.target.value })}
            />
          </div>
          <textarea
            autoFocus
            className="rd-text-input"
            value={textDraft.value}
            placeholder={textDraft.editId ? 'Edit text… (Enter saves)' : 'Type… (Enter saves)'}
            dir="auto"
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = textDraft.value.trim();
                if (!text) {
                  setTextDraft(null);
                  return;
                }
                if (textDraft.src && srcSel) {
                  /* source-text replacement: whiteout patch + text box, grouped */
                  const gid = uid();
                  const [bx0, by0, bx1, by1] = srcSel.box;
                  const patch: Stroke = {
                    id: uid(),
                    tool: 'whiteout',
                    shape: 'rect',
                    /* page surface color so the patch disappears into the page
                       under every reader theme (the old pure-white box glared) */
                    color: pageBg || '#ffffff',
                    width: 1,
                    opacity: 1,
                    group: gid,
                    points: [Math.max(0, bx0 - 0.004), Math.max(0, by0 - 0.006), Math.min(1, bx1 + 0.004), Math.min(1, by1 + 0.006)],
                    createdAt: Date.now(),
                  };
                  const tbox: Stroke = {
                    id: uid(),
                    tool: 'pen',
                    shape: 'text',
                    text,
                    fontSize: textDraft.size,
                    font: textDraft.font,
                    color: textDraft.color,
                    width: 0,
                    opacity: 1,
                    group: gid,
                    points: [bx0, by0, Math.min(1, bx1), Math.min(1, by1 + 0.012)],
                    createdAt: Date.now(),
                  };
                  commitCommand({ type: 'add', page: srcSel.page, strokes: [patch, tbox] });
                  setSrcSel(null);
                  setTextDraft(null);
                  return;
                }
                const lines = text.split('\n').length;
                /* re-edits keep their original box; fresh boxes auto-fit the
                   text, measured with the real font (canvas reference width 1000) */
                const boxW = textDraft.before
                  ? Math.max(0.05, textDraft.before.points[2] - textDraft.before.points[0])
                  : measureTextBox(text, textDraft.size, textDraft.font);
                const boxH = textDraft.before
                  ? Math.max(0.03, textDraft.before.points[3] - textDraft.before.points[1])
                  : Math.min(0.6, Math.max(0.045, lines * (textDraft.size / 1000) * 1.45 + 0.02));
                const stroke: Stroke = {
                  id: textDraft.editId ?? uid(),
                  tool: 'pen',
                  shape: 'text',
                  text,
                  fontSize: textDraft.size,
                  font: textDraft.font,
                  color: textDraft.color,
                  width: 0,
                  opacity: 1,
                  points: [textDraft.x, textDraft.y, Math.min(1, textDraft.x + boxW), Math.min(1, textDraft.y + boxH)],
                  createdAt: textDraft.before?.createdAt ?? Date.now(),
                };
                if (textDraft.editId && textDraft.before) {
                  commitCommand({ type: 'update', page: textDraft.page, before: textDraft.before, after: stroke });
                } else {
                  commitCommand({ type: 'add', page: textDraft.page, strokes: [stroke] });
                }
                setTextDraft(null);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setTextDraft(null);
              }
            }}
          />
          <div className="rd-text-input-hint">
            {textDraft.src
              ? 'Drag the highlighted box to place · Enter saves patch + text · Esc cancels'
              : 'Enter saves · Shift+Enter newline · Esc cancels'}
          </div>
        </div>
      )}
      <DictionaryPopup
        selection={dictSel}
        onClose={() => setDictSel(null)}
        onHighlight={(sel) => {
          /* viewport rect of the selected lines → normalized rect stroke on the page */
          const surface = document.querySelector(`.rd-page-card[data-page='${sel.page}'] .rd-page-surface`);
          if (!surface) return;
          const sr = surface.getBoundingClientRect();
          const x0 = Math.min(1, Math.max(0, (sel.rect.left - sr.left) / sr.width));
          const y0 = Math.min(1, Math.max(0, (sel.rect.top - sr.top) / sr.height));
          const x1 = Math.min(1, Math.max(0, (sel.rect.right - sr.left) / sr.width));
          const y1 = Math.min(1, Math.max(0, (sel.rect.bottom - sr.top) / sr.height));
          if (x1 - x0 < 0.005) return;
          const stroke = createStroke('highlight', prefs.hlColor, Math.max(24, prefs.hlWidth), [x0, y0, x1, y1], 'rect');
          commitCommand({ type: 'add', page: sel.page, strokes: [stroke] });
          toast('Text highlighted', `p.${sel.page} — find it in the annotations of this page.`);
        }}
      />
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


/* ---------- reading ruler ---------- */

function ReadingRuler() {
  const [y, setY] = useState<number | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => setY(e.clientY);
    const onLeave = (): void => setY(null);
    window.addEventListener('mousemove', onMove);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, []);
  if (y === null) return null;
  return (
    <div className="rd-ruler" style={{ top: y - 22 }} aria-hidden="true">
      <div className="rd-ruler-band" />
      <div className="rd-ruler-line" style={{ top: 0 }} />
      <div className="rd-ruler-line" style={{ bottom: 0 }} />
    </div>
  );
}

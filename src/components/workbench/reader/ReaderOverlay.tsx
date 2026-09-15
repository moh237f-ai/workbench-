/* ==================== Library: Reader Overlay (pdf.js canvas) ====================
   Full-screen reading surface for a stored PDF.
   - Fit-width / zoom rendering with serialized page paints (no render races)
   - Per-page reading-second tracking (flushed to the store every 10s / page change / close)
   - Focus-read integration (pomodoro started from the reader)
   - Immersive mode with auto-hiding chrome */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  BookCheck, BookPlus, ChevronLeft, ChevronRight, Clock, Eye, FileText, FileWarning,
  MoveHorizontal, PanelTopClose, PanelTopOpen, Pause, Play, SkipForward, Square, SquareCheck,
  StickyNote, Target, Timer, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  PAGE_READ_THRESHOLD_SEC, useWB, wbFileDeadlineStatus, wbFileProgress, wbFileReadPages,
  wbItemsForFile,
} from '@/lib/workbench/store';
import { daysUntil, fmtClock, getFocusTiming, isoDate } from '@/lib/workbench/helpers';
import { loadFileDoc, renderPageToCanvas } from '@/lib/workbench/pdf';
import type { Item } from '@/lib/workbench/types';
import { Btn, IconBtn, toast, useNow } from '../ui/primitives';
import './reader.css';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.1;
const FLUSH_EVERY_MS = 10_000;
const CHROME_IDLE_MS = 2_600;
const MIN_SESSION_MS = 60_000;

type LoadState = 'loading' | 'ready' | 'error';

const ITEM_ICON: Record<Item['type'], React.ReactNode> = {
  goal: <Target size={12} />,
  task: <SquareCheck size={12} />,
  note: <StickyNote size={12} />,
};

function clampPage(p: number, total: number): number {
  const max = Math.max(1, total);
  const n = Math.round(p);
  return Math.max(1, Math.min(max, Number.isFinite(n) ? n : 1));
}

function fmtRem(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ReaderOverlay({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  /* ---------- store ---------- */
  const file = useWB((s) => s.files.find((f) => f.id === fileId));
  const items = useWB((s) => s.items);
  const activeTimer = useWB((s) => s.activeTimer);
  const setFilePosition = useWB((s) => s.setFilePosition);
  const addFilePageSeconds = useWB((s) => s.addFilePageSeconds);
  const markFilePage = useWB((s) => s.markFilePage);
  const logReadingSession = useWB((s) => s.logReadingSession);
  const startFileFocus = useWB((s) => s.startFileFocus);
  const pausePomodoro = useWB((s) => s.pausePomodoro);
  const resumePomodoro = useWB((s) => s.resumePomodoro);
  const advancePomodoro = useWB((s) => s.advancePomodoro);
  const stopTimer = useWB((s) => s.stopTimer);

  const now = useNow();

  /* ---------- view state ---------- */
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(() => clampPage(file?.currentPage ?? 1, file?.pageCount ?? 1));
  const [pageInput, setPageInput] = useState(() => String(clampPage(file?.currentPage ?? 1, file?.pageCount ?? 1)));
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [baseW, setBaseW] = useState(0);
  const [stageW, setStageW] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [hasPaint, setHasPaint] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [chromeOn, setChromeOn] = useState(true);

  const numPages = doc?.numPages ?? file?.pageCount ?? 1;
  const effScale = fit && baseW > 0 && stageW > 0 ? Math.max(0.05, stageW / baseW) : scale;

  /* ---------- refs (session tracking + render serialization) ---------- */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageInputRef = useRef<HTMLInputElement | null>(null);
  const sessionStartRef = useRef(Date.now());
  const startPageRef = useRef(page);
  const pageRef = useRef(page);
  const pageSecsRef = useRef(0); // visible seconds on the current page (display)
  const pendingRef = useRef<Map<number, number>>(new Map()); // page -> unflushed seconds
  const sessionTotalsRef = useRef<Map<number, number>>(new Map()); // page -> session seconds
  const visitedRef = useRef<Set<number>>(new Set());
  const newlyReadRef = useRef<Set<number>>(new Set());
  const renderSeqRef = useRef(0);
  const renderChainRef = useRef<Promise<void>>(Promise.resolve());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const linkedItems = useMemo(() => wbItemsForFile(items, fileId), [items, fileId]);

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

  /* ---------- reading-time tracking ---------- */

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

  /* final flush + session log on unmount */
  useEffect(() => {
    const sessionStart = sessionStartRef.current;
    const startPage = startPageRef.current;
    return () => {
      flushPending();
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
  }, [fileId, flushPending, logReadingSession]);

  /* lock background scroll while the overlay is up */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* ---------- document loading ---------- */

  useEffect(() => {
    let alive = true;
    loadFileDoc(fileId)
      .then((d) => {
        if (!alive) return;
        setDoc(d);
        setLoadState('ready');
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

  /* base page width (scale 1) for fit-width math */
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    doc
      .getPage(clampPage(page, doc.numPages))
      .then((pg) => {
        if (alive) setBaseW(pg.getViewport({ scale: 1 }).width);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [doc, page]);

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

  /* available stage width (debounced, exact against computed padding) */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const cs = window.getComputedStyle(stage);
      const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      setStageW(Math.max(0, stage.clientWidth - pad - 12));
    };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, 140);
    });
    ro.observe(stage);
    measure();
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  /* serialized canvas painting — latest request wins, no concurrent renders */
  useEffect(() => {
    if (!doc || loadState !== 'ready' || effScale <= 0) return;
    const seq = ++renderSeqRef.current;
    const prev = renderChainRef.current;
    const run = (async () => {
      await prev;
      if (seq !== renderSeqRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      setRendering(true);
      try {
        await renderPageToCanvas(doc, page, canvas, { scale: effScale });
        if (seq === renderSeqRef.current) {
          setRendering(false);
          setHasPaint(true);
        }
      } catch {
        if (seq === renderSeqRef.current) setRendering(false);
      }
    })();
    renderChainRef.current = run.catch(() => {});
  }, [doc, page, effScale, loadState]);

  /* ---------- navigation ---------- */

  const goToPage = useCallback(
    (next: number) => {
      const total = doc?.numPages ?? file?.pageCount ?? 1;
      const target = clampPage(next, total);
      if (target !== page) {
        flushPending();
        visitedRef.current.add(target);
        pageRef.current = target;
        pageSecsRef.current = 0;
        setPage(target);
        setFilePosition(fileId, target);
        stageRef.current?.scrollTo({ top: 0 });
      }
      setPageInput(String(target));
    },
    [doc, file, fileId, page, flushPending, setFilePosition]
  );

  const applyPageInput = useCallback(() => {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) goToPage(n);
    else setPageInput(String(page));
  }, [pageInput, goToPage, page]);

  const closeReader = useCallback(() => {
    onClose();
  }, [onClose]);

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        if (inField) {
          pageInputRef.current?.blur();
          setPageInput(String(page));
          return;
        }
        if (document.querySelector('.modal-overlay')) return; // a modal above owns Esc
        e.preventDefault();
        if (immersive) {
          setImmersive(false);
          setChromeOn(true);
        } else {
          closeReader();
        }
        return;
      }
      if (inField || document.querySelector('.modal-overlay')) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(page - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        goToPage(page + 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(numPages);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, numPages, goToPage, immersive, closeReader]);

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

  /* tap/click on the page reveals chrome while immersive (touch support) */
  const onStageClick = () => {
    if (immersive && !chromeOn) bumpChrome();
  };

  /* ---------- zoom ---------- */

  const zoomBy = useCallback(
    (mult: number) => {
      setScale(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, effScale * mult)));
      setFit(false);
    },
    [effScale]
  );

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

  /* ---------- render ---------- */

  if (typeof document === 'undefined') return null;

  const openLinked = (itemId: string) => {
    window.dispatchEvent(new CustomEvent('wb-open-item', { detail: itemId }));
  };

  const showSpinner = loadState === 'loading' || (!!file && loadState === 'ready' && !hasPaint);

  return createPortal(
    <div
      className={`reader-overlay${immersive ? ' reader-immersive' : ''}${immersive && chromeOn ? ' rd-chrome-on' : ''}`}
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
        <div className="rd-stage" ref={stageRef} role="region" aria-label="PDF page view">
          {file && loadState === 'ready' && (
            <canvas
              ref={canvasRef}
              className="rd-canvas"
              style={{ visibility: hasPaint ? 'visible' : 'hidden' }}
              aria-label={`Page ${page} of ${numPages}`}
            />
          )}
        </div>

        {showSpinner && (
          <div className="rd-centered">
            <div className="rd-spinner" role="status" aria-label="Loading PDF" />
            <div className="rd-load-label">{loadState === 'loading' ? 'Opening PDF…' : 'Rendering page…'}</div>
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

        {rendering && hasPaint && (
          <div className="rd-rendering-chip">
            <span className="rd-spinner rd-spinner-sm" /> Rendering…
          </div>
        )}

        {immersive && !chromeOn && (
          <div className="rd-immersive-hint">Immersive reading · move mouse or tap for controls · Esc exits</div>
        )}
      </div>

      {/* ------- footer toolbar ------- */}
      <footer className="rd-footer">
        <div className="rd-toolbar">
          <div className="rd-group" role="group" aria-label="Zoom">
            <IconBtn title="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
              <ZoomOut size={15} />
            </IconBtn>
            <span className="rd-zoom-label rd-mono">{Math.round(effScale * 100)}%</span>
            <IconBtn title="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
              <ZoomIn size={15} />
            </IconBtn>
            <Btn size="sm" variant={fit ? 'primary' : 'default'} onClick={() => setFit(true)} title="Fit page width">
              <MoveHorizontal size={13} /> Fit
            </Btn>
          </div>

          <span className="rd-sep" aria-hidden="true" />

          <div className="rd-group" role="group" aria-label="Page navigation">
            <IconBtn title="Previous page (←)" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
              <ChevronLeft size={15} />
            </IconBtn>
            <span className="rd-page-box">
              <input
                ref={pageInputRef}
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
                    pageInputRef.current?.blur();
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

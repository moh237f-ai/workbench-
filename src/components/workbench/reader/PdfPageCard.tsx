/* ==================== Reader v2 — one PDF page ====================
   A page card renders the pdf.js canvas plus a transparent annotation layer
   (pen / highlight / eraser) and a link layer (clickable regions for internal
   PDF destinations — table-of-contents entries, cross-references — and
   external URLs). In virtualized strips the card shows a cheap
   aspect-correct placeholder until it comes within the IO root margin. */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { renderPageToCanvas } from '@/lib/workbench/pdf';
import type { ReaderTool, Stroke } from '@/lib/workbench/types';
import { createStroke, drawStrokes, hitTestStroke, HL_OPACITY, strokePath } from './annotations';

const ERASER_RADIUS_PX = 12;
const MIN_MOVE_CSS_PX = 2;

/* ==================== PDF link annotations ====================
   pdfjs-dist types annotations as `any[]`, so we re-type the tiny slice we
   consume. Raw annotations are scale-independent (PDF user-space rects) and
   are cached per doc+page; only the rect→CSS conversion depends on zoom. */

interface RawLinkAnno {
  /** [x1, y1, x2, y2] in PDF user space (bottom-left origin). */
  rect: number[];
  /** Sanitized absolute URL when pdf.js could resolve one. */
  url?: string;
  /** Raw URL as written in the PDF — needs scheme validation. */
  unsafeUrl?: string;
  /** Named (string) or explicit (array) internal destination. */
  dest?: string | unknown[];
}

/** A link zone positioned over the page surface, in CSS pixels. */
export interface PdfLinkZone {
  left: number;
  top: number;
  width: number;
  height: number;
  url?: string;
  targetPage?: number;
  label: string;
}

const linkAnnoCache = new WeakMap<PDFDocumentProxy, Map<number, RawLinkAnno[]>>();
const destPageCache = new WeakMap<PDFDocumentProxy, Map<string, number>>();

async function fetchLinkAnnos(doc: PDFDocumentProxy, pageNum: number): Promise<RawLinkAnno[]> {
  let byPage = linkAnnoCache.get(doc);
  if (!byPage) {
    byPage = new Map<number, RawLinkAnno[]>();
    linkAnnoCache.set(doc, byPage);
  }
  const hit = byPage.get(pageNum);
  if (hit) return hit;
  const page = await doc.getPage(pageNum);
  const raw = (await page.getAnnotations()) as unknown as Array<Record<string, unknown>>;
  const links: RawLinkAnno[] = [];
  for (const a of raw) {
    if (a.subtype !== 'Link') continue;
    const rect = a.rect;
    if (!Array.isArray(rect) || rect.length < 4) continue;
    const nums = rect.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
    if (nums.some((v) => Number.isNaN(v))) continue;
    const dest = typeof a.dest === 'string' || Array.isArray(a.dest) ? a.dest : undefined;
    if (!dest && typeof a.url !== 'string' && typeof a.unsafeUrl !== 'string') continue;
    links.push({
      rect: nums,
      url: typeof a.url === 'string' ? a.url : undefined,
      unsafeUrl: typeof a.unsafeUrl === 'string' ? a.unsafeUrl : undefined,
      dest,
    });
  }
  byPage.set(pageNum, links);
  return links;
}

function isRefLike(v: unknown): v is { num: number; gen: number } {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.num === 'number' && typeof r.gen === 'number';
}

/** Raw PDF URLs are untrusted — only absolute http(s)/mailto links are opened. */
function sanitizeExternalUrl(raw: string): string | undefined {
  if (!/^(https?:|mailto:)/i.test(raw)) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return u.href;
  } catch {
    /* malformed URL — ignore */
  }
  return undefined;
}

/** Resolve an internal destination (named string or explicit array) to a 1-based page. */
async function resolveDestPage(doc: PDFDocumentProxy, dest: string | unknown[]): Promise<number | undefined> {
  let cache = destPageCache.get(doc);
  if (!cache) {
    cache = new Map<string, number>();
    destPageCache.set(doc, cache);
  }
  const key = typeof dest === 'string' ? `n:${dest}` : `a:${JSON.stringify(dest)}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let explicit: unknown;
  if (typeof dest === 'string') {
    explicit = await doc.getDestination(dest);
  } else {
    explicit = dest;
  }
  let pageNum: number | undefined;
  if (Array.isArray(explicit) && explicit.length > 0) {
    const ref: unknown = explicit[0];
    if (isRefLike(ref)) {
      try {
        pageNum = (await doc.getPageIndex(ref)) + 1;
      } catch {
        pageNum = undefined; /* stale page reference in the PDF */
      }
    } else if (typeof ref === 'number' && Number.isInteger(ref) && ref >= 0) {
      pageNum = ref + 1;
    }
  }
  if (pageNum === undefined || pageNum < 1 || pageNum > doc.numPages) return undefined;
  cache.set(key, pageNum);
  return pageNum;
}

/** Convert a PDF user-space rect to CSS-pixel box on this viewport (handles rotation + flip). */
function rectToCssBox(
  rect: number[],
  viewport: PageViewport
): { left: number; top: number; width: number; height: number } | null {
  const p1 = viewport.convertToViewportPoint(rect[0], rect[1]) as number[];
  const p2 = viewport.convertToViewportPoint(rect[2], rect[3]) as number[];
  const left = Math.min(p1[0], p2[0]);
  const top = Math.min(p1[1], p2[1]);
  const width = Math.abs(p2[0] - p1[0]);
  const height = Math.abs(p2[1] - p1[1]);
  if (!Number.isFinite(left + top + width + height)) return null;
  if (width < 2 || height < 2) return null; /* degenerate annotation rect */
  return { left, top, width, height };
}

export interface PdfPageCardProps {
  doc: PDFDocumentProxy;
  pageNum: number;
  baseW: number; // viewport width at scale 1
  aspect: number; // width / height
  cssWidth: number; // target CSS width in px
  virtualize: boolean; // strip mode: only paint when near the viewport
  showLabel: boolean; // strip mode: "p. N" under the page
  themeFilter: string; // CSS filter applied to the PDF canvas only
  pageBg?: string; // tinted surface behind the canvas so themed pages don't glare
  strokes: Stroke[]; // committed annotations for this page
  tool: ReaderTool;
  penColor: string;
  penWidth: number;
  hlColor: string;
  hlWidth: number;
  interactive: boolean; // annotations loaded — drawing allowed
  onCommitStroke: (page: number, stroke: Stroke) => void;
  onEraseStrokes: (page: number, strokes: Stroke[]) => void;
  onPointerActivity: () => void;
  registerEl: (page: number, el: HTMLElement | null) => void;
  onGoToPage?: (page: number) => void; // internal PDF link navigation
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function PdfPageCard({
  doc,
  pageNum,
  baseW,
  aspect,
  cssWidth,
  virtualize,
  showLabel,
  themeFilter,
  pageBg,
  strokes,
  tool,
  penColor,
  penWidth,
  hlColor,
  hlWidth,
  interactive,
  onCommitStroke,
  onEraseStrokes,
  onPointerActivity,
  registerEl,
  onGoToPage,
}: PdfPageCardProps) {
  const [near, setNear] = useState(!virtualize);
  const [painted, setPainted] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [linkZones, setLinkZones] = useState<PdfLinkZone[]>([]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<HTMLCanvasElement | null>(null);
  const annoRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>(strokes);
  const draftPtsRef = useRef<number[] | null>(null);
  const draftStrokeRef = useRef<Stroke | null>(null);
  const erasedIdsRef = useRef<Set<string> | null>(null);
  const erasedStrokesRef = useRef<Stroke[] | null>(null);
  const drawingRef = useRef(false);
  const renderSeqRef = useRef(0);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const linkSeqRef = useRef(0);

  const live = virtualize ? near : true;
  const cssH = aspect > 0 ? cssWidth / aspect : cssWidth * 1.333;

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  /* ---- virtualization: paint only within ~1.5 viewport heights ---- */
  useEffect(() => {
    if (!virtualize) return;
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) setNear(en.isIntersecting);
      },
      { rootMargin: '1200px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [virtualize]);

  /* ---- keep the root el registered for dominant-page tracking / nav ---- */
  const rootRefCb = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      registerEl(pageNum, el);
    },
    [pageNum, registerEl]
  );

  /* ---- reset paint state when the canvas unmounts (far away) ---- */
  useEffect(() => {
    if (!live && painted) setPainted(false);
  }, [live, painted]);

  /* ---- serialized pdf.js paint (latest request wins, never concurrent) ---- */
  useEffect(() => {
    if (!live || cssWidth <= 0 || baseW <= 0) return;
    const seq = (renderSeqRef.current += 1);
    const prev = chainRef.current;
    const run = (async () => {
      await prev;
      if (seq !== renderSeqRef.current) return;
      const canvas = pdfRef.current;
      if (!canvas) return;
      setRendering(true);
      try {
        await renderPageToCanvas(doc, pageNum, canvas, { scale: cssWidth / baseW });
        if (seq !== renderSeqRef.current) return;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        setPainted(true);
      } catch {
        /* render failure — the placeholder stays */
      } finally {
        if (seq === renderSeqRef.current) setRendering(false);
      }
    })();
    chainRef.current = run.catch(() => {});
    return () => {
      renderSeqRef.current += 1;
    };
  }, [doc, pageNum, cssWidth, baseW, live]);

  /* ---- link layer: fetch annotations (cached) + convert rects at this zoom ----
     Runs whenever the page becomes live or the zoom changes; the raw PDF-space
     annotations come from the module cache so re-runs only re-convert rects. */
  useEffect(() => {
    if (!live || cssWidth <= 0 || baseW <= 0) return;
    const seq = (linkSeqRef.current += 1);
    let cancelled = false;
    void (async () => {
      try {
        const links = await fetchLinkAnnos(doc, pageNum);
        if (cancelled || seq !== linkSeqRef.current) return;
        const page = await doc.getPage(pageNum);
        if (cancelled || seq !== linkSeqRef.current) return;
        const viewport = page.getViewport({ scale: cssWidth / baseW });
        const zones: PdfLinkZone[] = [];
        for (const link of links) {
          /* both fields are untrusted input from the PDF — scheme-validated */
          const rawUrl = link.url ?? link.unsafeUrl;
          const external = rawUrl ? sanitizeExternalUrl(rawUrl) : undefined;
          let targetPage: number | undefined;
          if (!external && link.dest) {
            targetPage = await resolveDestPage(doc, link.dest);
            if (cancelled || seq !== linkSeqRef.current) return;
          }
          /* nothing actionable (e.g. named action links) — skip */
          if (!external && targetPage === undefined) continue;
          const box = rectToCssBox(link.rect, viewport);
          if (!box) continue;
          zones.push({
            ...box,
            url: external,
            targetPage,
            label: external ? 'Open external link' : `Go to page ${targetPage}`,
          });
        }
        if (cancelled || seq !== linkSeqRef.current) return;
        setLinkZones(zones);
      } catch {
        /* annotations unavailable — this page just gets no link layer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageNum, live, cssWidth, baseW]);

  /* ---- annotation layer: resize to device pixels + repaint ---- */
  const redraw = useCallback(() => {
    const canvas = annoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const dpr = canvas.width / cw;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const erased = erasedIdsRef.current;
    const committed = erased ? strokesRef.current.filter((s) => !erased.has(s.id)) : strokesRef.current;
    drawStrokes(ctx, committed, cw, ch);
    const draft = draftStrokeRef.current;
    if (draft && draft.points.length >= 2) strokePath(ctx, draft, cw, ch);
  }, []);

  useEffect(() => {
    const canvas = annoRef.current;
    if (!live || !canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    redraw();
  }, [live, strokes, cssWidth, painted, redraw]);

  /* ---- pointer drawing ---- */

  const toNorm = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number; w: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((e.clientY - rect.top) / Math.max(1, rect.height)),
      w: Math.max(1, rect.width),
    };
  };

  const eraseAt = (x: number, y: number, w: number) => {
    const ids = erasedIdsRef.current;
    const removed = erasedStrokesRef.current;
    if (!ids || !removed) return;
    const r = ERASER_RADIUS_PX / w;
    let hit = false;
    for (const s of strokesRef.current) {
      if (ids.has(s.id)) continue;
      if (hitTestStroke(s, x, y, r)) {
        ids.add(s.id);
        removed.push(s);
        hit = true;
      }
    }
    if (hit) redraw();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || tool === 'select') return;
    if (!e.isPrimary || drawingRef.current) return;
    const { x, y, w } = toNorm(e);
    if (tool === 'eraser') {
      erasedIdsRef.current = new Set<string>();
      erasedStrokesRef.current = [];
      eraseAt(x, y, w);
    } else {
      const isPen = tool === 'pen';
      draftPtsRef.current = [x, y];
      draftStrokeRef.current = {
        id: 'draft',
        tool: isPen ? 'pen' : 'highlight',
        color: isPen ? penColor : hlColor,
        width: isPen ? penWidth : hlWidth,
        opacity: isPen ? 1 : HL_OPACITY,
        points: draftPtsRef.current,
        createdAt: 0,
      };
      redraw();
    }
    drawingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    e.preventDefault();
    onPointerActivity();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !e.isPrimary) return;
    const { x, y, w } = toNorm(e);
    if (tool === 'eraser') {
      eraseAt(x, y, w);
      return;
    }
    const pts = draftPtsRef.current;
    if (!pts) return;
    const minNorm = MIN_MOVE_CSS_PX / w;
    const dx = x - pts[pts.length - 2];
    const dy = y - pts[pts.length - 1];
    if (dx * dx + dy * dy < minNorm * minNorm) return;
    pts.push(x, y);
    redraw();
  };

  const finishDrawing = (e: React.PointerEvent<HTMLCanvasElement>, discard: boolean) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (tool === 'eraser') {
      const removed = erasedStrokesRef.current ?? [];
      erasedIdsRef.current = null;
      erasedStrokesRef.current = null;
      if (!discard && removed.length > 0) onEraseStrokes(pageNum, removed);
      else redraw();
      return;
    }
    const pts = draftPtsRef.current;
    const draft = draftStrokeRef.current;
    draftPtsRef.current = null;
    draftStrokeRef.current = null;
    if (!discard && pts && draft && pts.length >= 4) {
      onCommitStroke(pageNum, createStroke(draft.tool, draft.color, draft.width, pts));
    } else {
      redraw();
    }
  };

  const showLoading = live && (rendering || !painted);
  const linksInteractive = tool === 'select';

  return (
    <div className="rd-page-card" data-page={pageNum} ref={rootRefCb}>
      <div
        className="rd-page-surface"
        style={pageBg ? { width: cssWidth, height: cssH, background: pageBg } : { width: cssWidth, height: cssH }}
      >
        {live ? (
          <>
            <canvas
              ref={pdfRef}
              className="rd-pdf"
              style={{ filter: themeFilter }}
              aria-label={`Page ${pageNum}`}
            />
            <canvas
              ref={annoRef}
              className="rd-anno-layer"
              style={{
                pointerEvents: tool === 'select' ? 'none' : 'auto',
                touchAction: tool === 'select' ? 'auto' : 'none',
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => finishDrawing(e, false)}
              onPointerCancel={(e) => finishDrawing(e, true)}
              onContextMenu={(e) => e.preventDefault()}
            />
            {linkZones.length > 0 && (
              <div className="rd-link-layer">
                {linkZones.map((z, i) => {
                  const zoneStyle: CSSProperties = {
                    left: z.left,
                    top: z.top,
                    width: z.width,
                    height: z.height,
                    pointerEvents: linksInteractive ? 'auto' : 'none',
                  };
                  return z.url ? (
                    <a
                      key={`lnk${i}`}
                      className="rd-link-zone"
                      style={zoneStyle}
                      href={z.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={z.label}
                      aria-label={z.label}
                      onClick={(e) => {
                        onPointerActivity();
                        /* let ⌘/⌃/⇧-clicks use the browser's native link behavior */
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        window.open(z.url, '_blank', 'noopener,noreferrer');
                      }}
                    />
                  ) : (
                    <button
                      key={`lnk${i}`}
                      type="button"
                      className="rd-link-zone"
                      style={zoneStyle}
                      title={z.label}
                      aria-label={z.label}
                      onClick={() => {
                        onPointerActivity();
                        if (z.targetPage !== undefined) onGoToPage?.(z.targetPage);
                      }}
                    />
                  );
                })}
              </div>
            )}
            {showLoading && (
              <div className="rd-page-loading">
                <span className="rd-spinner rd-spinner-sm" role="status" aria-label="Rendering page" />
              </div>
            )}
          </>
        ) : (
          <div className="rd-page-ph" />
        )}
      </div>
      {showLabel && (
        <div className="rd-page-label rd-mono" aria-hidden="true">
          p. {pageNum}
        </div>
      )}
    </div>
  );
}

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
import { paintFindHits } from './FindInDoc';
import type { ReaderTool, Stroke, StrokeShape } from '@/lib/workbench/types';
import { uid } from '@/lib/workbench/helpers';
import {
  createStroke,
  drawStrokes,
  hitTestStroke,
  hitTestStrokeAt,
  HL_OPACITY,
  scaleStroke,
  strokeBBox,
  strokePath,
  translateStroke,
} from './annotations';

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
  penOpacity?: number;
  hlColor: string;
  hlWidth: number;
  hlOpacity?: number;
  interactive: boolean; // annotations loaded — drawing allowed
  /** build the selectable pdf.js text layer (select tool / find active) */
  textEnabled?: boolean;
  /** word/phrase selected in the text layer — dictionary popup hook */
  onWordSelected?: (payload: { text: string; page: number; rect: DOMRect }) => void;
  /** find-in-document hits on this page (char index + length in the page's plain text) */
  findHits?: { index: number; length: number; active?: boolean }[];
  /** currently selected stroke (select tool) */
  selectedId?: string | null;
  onSelectStroke?: (id: string | null) => void;
  /** committed transform of a stroke (move/resize/recolor) */
  onCommitUpdate?: (page: number, before: Stroke, after: Stroke) => void;
  /** text tool: place a new text box at normalized page coords */
  onTextPlace?: (page: number, x: number, y: number, vp: { left: number; top: number }) => void;
  onEditText?: (page: number, stroke: Stroke, vp: { left: number; top: number }) => void;
  onEditTextSource?: (
    page: number,
    info: { text: string; box: [number, number, number, number]; fontSize: number; left: number; top: number }
  ) => void;
  onEraseResult?: (page: number, removed: Stroke[], added: Stroke[]) => void;
  eraserMode?: 'stroke' | 'precise';
  srcSelBox?: [number, number, number, number] | null; /* active text-edit selection on THIS page */
  onSrcSelBox?: (box: [number, number, number, number]) => void;
  /** eraser radius in CSS px */
  eraserSize?: number;
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
  penOpacity = 1,
  hlColor,
  hlWidth,
  hlOpacity = HL_OPACITY,
  interactive,
  textEnabled,
  onWordSelected,
  findHits,
  selectedId,
  onSelectStroke,
  onCommitUpdate,
  onTextPlace,
  onEditText,
  onEditTextSource,
  onEraseResult,
  eraserMode = 'stroke',
  srcSelBox,
  onSrcSelBox,
  eraserSize,
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
  const removedIdsRef = useRef<Set<string> | null>(null); /* precise mode: consumed originals */
  const fragStrokesRef = useRef<Stroke[] | null>(null); /* precise mode: live fragments */
  const eraserRingRef = useRef<HTMLDivElement | null>(null);  const drawingRef = useRef(false);
  /* select-tool stroke interaction (move / resize) */
  const xformRef = useRef<{
    mode: 'move' | 'resize';
    id: string;
    orig: Stroke;
    startX: number;
    startY: number;
    anchorX: number;
    anchorY: number;
    bbox: ReturnType<typeof strokeBBox>;
  } | null>(null);
  const [preview, setPreview] = useState<Stroke | null>(null);
  const previewRef = useRef<Stroke | null>(null);
  const [resizeHandle, setResizeHandle] = useState<'nw' | 'ne' | 'sw' | 'se' | null>(null);
  const renderSeqRef = useRef(0);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const linkSeqRef = useRef(0);
  const textHostRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<{ update: (p: { viewport: unknown }) => void } | null>(null);
  const textSeqRef = useRef(0);


  const live = virtualize ? near : true;
  const cssH = aspect > 0 ? cssWidth / aspect : cssWidth * 1.333;

  /* ---- selectable pdf.js text layer (select tool + find) ----
     Built after the canvas paint inside the same serialization chain so
     rapid page/zoom changes never interleave builds. */
  useEffect(() => {
    if (!live || cssWidth <= 0 || baseW <= 0 || !textEnabled) return;
    const seq = (textSeqRef.current += 1);
    const host = textHostRef.current;
    if (!host) return;
    const prev = chainRef.current;
    const run = (async () => {
      await prev;
      if (seq !== textSeqRef.current) return;
      try {
        const page = await doc.getPage(pageNum);
        if (seq !== textSeqRef.current) return;
        const viewport = page.getViewport({ scale: cssWidth / baseW });
        host.replaceChildren();
        host.style.setProperty('--scale-factor', String(viewport.scale));
        host.style.setProperty('--user-unit', '1');
        host.style.width = `${cssWidth}px`;
        host.style.height = `${Math.round(cssH)}px`;
        const { TextLayer } = await import('pdfjs-dist');
        const layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: host,
          viewport,
        });
        await layer.render();
        if (seq !== textSeqRef.current) return;
        textLayerRef.current = layer as unknown as { update: (p: { viewport: unknown }) => void };
        /* pdf.js selection spec: the endOfContent marker makes cross-line
           selection snap to full lines instead of the diagonal drift */
        const end = document.createElement('div');
        end.className = 'endOfContent';
        host.appendChild(end);
        if (findHits?.length) paintFindHits(host, findHits.map((h) => ({ index: h.index, length: h.length })), findHits.findIndex((h) => h.active));
      } catch {
        /* text layer is optional — failures never block the page paint */
      }
    })();
    chainRef.current = run.catch(() => {});
    return () => {
      textSeqRef.current += 1;
    };
  }, [doc, pageNum, cssWidth, baseW, live, cssH, textEnabled]);

  /* re-paint find hits when they change without a rebuild */
  const findKey = findHits ? findHits.map((h) => `${h.index}:${h.length}`).join('|') : '';
  useEffect(() => {
    if (!textEnabled || !live) return;
    const host = textHostRef.current;
    if (!host || !host.childElementCount) return;
    paintFindHits(host, findHits?.map((h) => ({ index: h.index, length: h.length })) ?? [], findHits?.findIndex((h) => h.active) ?? -1);
     
  }, [findKey]);

  /* clear the layer when disabled or far away */
  useEffect(() => {
    if (textEnabled && live) return;
    const host = textHostRef.current;
    if (host) host.replaceChildren();
    textLayerRef.current = null;
  }, [textEnabled, live]);


  const selectedIdRef = useRef<string | null | undefined>(selectedId);
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
    const removed = removedIdsRef.current;
    const frags = fragStrokesRef.current;
    const pv = previewRef.current;
    let committed = erased
      ? strokesRef.current.filter((s) => !erased.has(s.id))
      : strokesRef.current.map((s) => (pv && s.id === pv.id ? pv : s));
    if (removed) committed = committed.filter((s) => !removed.has(s.id));
    if (frags?.length) committed = [...committed, ...frags];
    drawStrokes(ctx, committed, cw, ch);
    const draft = draftStrokeRef.current;
    if (draft && draft.points.length >= 2) strokePath(ctx, draft, cw, ch);
    /* selection outline */
    if (selectedIdRef.current) {
      const sel = strokesRef.current.find((s) => s.id === selectedIdRef.current) ?? (pv?.id === selectedIdRef.current ? pv : null);
      if (sel) {
        const b = strokeBBox(sel);
        ctx.save();
        ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--pine') || '#0e8a7d';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x * cw - 4, b.y * ch - 4, b.w * cw + 8, b.h * ch + 8);
        ctx.restore();
      }
    }
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    redraw();
  }, [selectedId, redraw]);
  useEffect(() => {
    previewRef.current = preview;
    redraw();
  }, [preview, redraw]);

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

  const SHAPE_TOOLS: ReaderTool[] = ['rect', 'ellipse', 'line', 'arrow'];
  const isShapeTool = (t: ReaderTool): t is 'rect' | 'ellipse' | 'line' | 'arrow' =>
    (SHAPE_TOOLS as string[]).includes(t);

  const toNormSurface = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }): { x: number; y: number; w: number; h: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((e.clientY - rect.top) / Math.max(1, rect.height)),
      w: Math.max(1, rect.width),
      h: Math.max(1, rect.height),
    };
  };

  /** Precise mode: remove the points of a freehand stroke inside the radius and
      split the survivors into independent strokes. Shapes/text/whiteout always
      die whole — they have no meaningful "half". */
  const splitStrokeAt = (st: Stroke, x: number, y: number, r: number): Stroke[] | null => {
    const freehand = (st.tool === 'pen' || st.tool === 'highlight') && !st.shape && st.shape !== 'text';
    if (!freehand) return null;
    const p = st.points;
    const runs: number[][] = [];
    let cur: number[] = [];
    for (let i = 0; i + 1 < p.length; i += 2) {
      const dx = p[i] - x;
      const dy = p[i + 1] - y;
      if (dx * dx + dy * dy <= r * r) {
        if (cur.length >= 4) runs.push(cur);
        cur = [];
      } else {
        cur.push(p[i], p[i + 1]);
      }
    }
    if (cur.length >= 4) runs.push(cur);
    if (!runs.length) return []; /* fully consumed */
    if (runs.length === 1 && runs[0].length === p.length) return null; /* untouched */
    return runs.map((pts, idx) => ({ ...st, id: uid(), points: pts, createdAt: Date.now() + idx }));
  };

  const eraseAt = (x: number, y: number, w: number) => {
    const r = (eraserSize ?? ERASER_RADIUS_PX) / w;
    if (eraserMode === 'precise') {
      const removedIds = removedIdsRef.current;
      const frags = fragStrokesRef.current;
      if (!removedIds || !frags) return;
      let hit = false;
      for (const st of strokesRef.current) {
        if (removedIds.has(st.id)) continue;
        const parts = splitStrokeAt(st, x, y, r);
        if (parts === null) continue; /* untouched freehand */
        removedIds.add(st.id);
        if (parts.length) frags.push(...parts);
        hit = true;
      }
      if (hit) redraw();
      return;
    }
    const ids = erasedIdsRef.current;
    const removed = erasedStrokesRef.current;
    if (!ids || !removed) return;
    let hit = false;
    for (const st of strokesRef.current) {
      if (ids.has(st.id)) continue;
      if (hitTestStroke(st, x, y, r)) {
        ids.add(st.id);
        removed.push(st);
        hit = true;
      }
    }
    if (hit) redraw();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || tool === 'select' || tool === 'text') return;
    if (!e.isPrimary || drawingRef.current) return;
    const { x, y, w } = toNorm(e);
    if (tool === 'eraser') {
      if (eraserMode === 'precise') {
        removedIdsRef.current = new Set<string>();
        fragStrokesRef.current = [];
      } else {
        erasedIdsRef.current = new Set<string>();
        erasedStrokesRef.current = [];
      }
      eraseAt(x, y, w);
    } else if (isShapeTool(tool)) {
      draftPtsRef.current = [x, y, x, y];
      draftStrokeRef.current = {
        id: 'draft',
        tool: 'pen',
        shape: tool as StrokeShape,
        color: penColor,
        width: penWidth,
        opacity: penOpacity,
        points: draftPtsRef.current,
        createdAt: 0,
      };
      redraw();
    } else {
      const isPen = tool === 'pen';
      draftPtsRef.current = [x, y];
      draftStrokeRef.current = {
        id: 'draft',
        tool: isPen ? 'pen' : 'highlight',
        color: isPen ? penColor : hlColor,
        width: isPen ? penWidth : hlWidth,
        opacity: isPen ? penOpacity : hlOpacity,
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
    /* eraser ring follows the pointer even when not dragging */
    if (tool === 'eraser' && eraserRingRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const d = (eraserSize ?? ERASER_RADIUS_PX) * 2;
      eraserRingRef.current.style.opacity = '1';
      eraserRingRef.current.style.width = `${d}px`;
      eraserRingRef.current.style.height = `${d}px`;
      eraserRingRef.current.style.transform = `translate(${e.clientX - rect.left - d / 2}px, ${e.clientY - rect.top - d / 2}px)`;
    }
    if (!drawingRef.current || !e.isPrimary) return;
    const { x, y, w } = toNorm(e);
    if (tool === 'eraser') {
      eraseAt(x, y, w);
      return;
    }
    const pts = draftPtsRef.current;
    if (!pts) return;
    const minNorm = MIN_MOVE_CSS_PX / w;
    if (draftStrokeRef.current?.shape) {
      pts[2] = x;
      pts[3] = y;
      redraw();
      return;
    }
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
      if (eraserMode === 'precise') {
        const removedIds = removedIdsRef.current;
        const frags = fragStrokesRef.current ?? [];
        const removed = removedIds
          ? strokesRef.current.filter((st) => removedIds.has(st.id))
          : [];
        removedIdsRef.current = null;
        fragStrokesRef.current = null;
        if (!discard && removed.length > 0) onEraseResult?.(pageNum, removed, frags);
        else redraw();
        return;
      }
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
      if (draft.shape) {
        /* drop zero-size shapes */
        const dx = Math.abs(pts[2] - pts[0]);
        const dy = Math.abs(pts[3] - pts[1]);
        if (dx < 0.005 && dy < 0.005) {
          redraw();
          return;
        }
        onCommitStroke(pageNum, createStroke(draft.tool, draft.color, draft.width, pts, draft.shape));
      } else {
        onCommitStroke(pageNum, createStroke(draft.tool, draft.color, draft.width, pts));
      }
    } else {
      redraw();
    }
  };

  /* ---- select tool: pick / move / resize strokes (surface-level so text
     selection stays available when no stroke is hit) ---- */
  const pickStroke = (x: number, y: number, w: number, h: number): Stroke | null => {
    const rx = 9 / w;
    const ry = 9 / h;
    const arr = strokesRef.current;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (hitTestStrokeAt(arr[i], x, y, Math.max(rx, ry * (h / Math.max(0.001, w))))) return arr[i];
      if (hitTestStrokeAt(arr[i], x, y, Math.max(rx, ry))) return arr[i];
    }
    return null;
  };

  /* text-edit selection: drag the rect to choose where the replacement goes,
     SE handle resizes it — committed only when the user saves the pop */
  const srcDragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; box: [number, number, number, number]; rect: DOMRect } | null>(null);

  const onSrcSelPointerDown = (e: React.PointerEvent<HTMLElement>, mode: 'move' | 'resize') => {
    if (!srcSelBox || !onSrcSelBox) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget.closest('.rd-page-surface') as HTMLElement)?.getBoundingClientRect();
    if (!rect) return;
    srcDragRef.current = { mode, startX: e.clientX, startY: e.clientY, box: [...srcSelBox], rect };
    (e.currentTarget.closest('.rd-page-surface') as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onSrcSelPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = srcDragRef.current;
    if (!d || !onSrcSelBox) return;
    const dx = (e.clientX - d.startX) / d.rect.width;
    const dy = (e.clientY - d.startY) / d.rect.height;
    const clamp = (v: number) => Math.max(0.005, Math.min(0.995, v));
    let box: [number, number, number, number];
    if (d.mode === 'move') {
      const w = d.box[2] - d.box[0];
      const h = d.box[3] - d.box[1];
      const x0 = clamp(d.box[0] + dx);
      const y0 = clamp(d.box[1] + dy);
      box = [Math.min(x0, 0.995 - w), Math.min(y0, 0.995 - h), Math.min(0.995, x0 + w), Math.min(0.995, y0 + h)];
    } else {
      box = [d.box[0], d.box[1], clamp(d.box[2] + dx), clamp(d.box[3] + dy)];
    }
    if (box[2] - box[0] > 0.02 && box[3] - box[1] > 0.01) onSrcSelBox(box);
  };

  const onSrcSelPointerUp = () => {
    srcDragRef.current = null;
  };

  const onSurfaceDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || tool !== 'select') return;
    const { x, y, w } = toNormSurface(e);
    const hit = pickStroke(x, y, w, 1);
    if (hit && hit.shape === 'text') {
      e.stopPropagation();
      onEditText?.(pageNum, hit, { left: e.clientX, top: e.clientY });
      return;
    }
  };

  /** Find the source text item under a normalized click. Geometry comes from
      the text ITEM transforms — text-layer span rects lie whenever a PDF
      scales text through matrices. Returns null when nothing matches. */
  const lookupTextItemAt = async (click: { x: number; y: number }): Promise<{ text: string; box: [number, number, number, number]; fontSize: number } | null> => {
    try {
      const { Util } = await import('pdfjs-dist');
      const pg = await doc.getPage(pageNum);
      const vp1 = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      let best: { text: string; box: [number, number, number, number]; fontSize: number; score: number } | null = null;
      for (const it of tc.items as { str?: string; transform?: number[]; width?: number }[]) {
        if (typeof it.str !== 'string' || !it.str.trim()) continue;
        const t = Util.transform(vp1.transform, it.transform ?? [1, 0, 0, 1, 0, 0]);
        const fs = Math.hypot(t[2], t[3]) || 10;
        const x0 = t[4] / vp1.width;
        const yb = t[5] / vp1.height;
        const wpx = (it.width || it.str.length * fs * 0.55) / vp1.width;
        const box: [number, number, number, number] = [
          x0,
          Math.max(0, yb - (fs * 0.82) / vp1.height),
          Math.min(1, x0 + wpx),
          Math.min(1, yb + (fs * 0.26) / vp1.height),
        ];
        const inside =
          click.x >= box[0] - 0.012 && click.x <= box[2] + 0.012 &&
          click.y >= box[1] - 0.02 && click.y <= box[3] + 0.02;
        const score = inside ? 2 : 0;
        if (score > (best?.score ?? -1)) best = { text: it.str, box, fontSize: Math.round((fs / vp1.width) * 1000), score };
      }
      return best && best.score > 0 ? best : null;
    } catch {
      return null;
    }
  };

    const onSurfacePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || !e.isPrimary) return;
    if ((e.target as HTMLElement).closest('.rd-resize-handle, a, button')) return;
    if (tool === 'text') {
      /* clicking an existing text box edits it; clicking real PDF text opens
         it for editing (selective replacement); a new box only starts on
         empty page space */
      const { x, y, w } = toNormSurface(e);
      const hit = pickStroke(x, y, w, 1);
      if (hit && hit.shape === 'text') {
        e.preventDefault();
        onEditText?.(pageNum, hit, { left: e.clientX, top: e.clientY });
        return;
      }
      /* clicking the patch of a replacement pair edits its text box partner */
      if (hit && hit.tool === 'whiteout' && hit.group) {
        const partner = strokesRef.current.find((st) => st.group === hit.group && st.shape === 'text');
        if (partner) {
          e.preventDefault();
          onEditText?.(pageNum, partner, { left: e.clientX, top: e.clientY });
          return;
        }
      }
      const client = { left: e.clientX, top: e.clientY };
      void lookupTextItemAt({ x, y }).then((item) => {
        if (item) {
          onEditTextSource?.(pageNum, {
            text: item.text,
            box: item.box,
            fontSize: Math.max(8, Math.min(96, item.fontSize)),
            ...client,
          });
        } else {
          onTextPlace?.(pageNum, x, y, client);
        }
      });
      e.preventDefault();
      return;
    }
    if (tool !== 'select') return;
    const { x, y, w } = toNormSurface(e);
    const hit = pickStroke(x, y, w, 1);
    if (!hit) {
      if (selectedId) onSelectStroke?.(null);
      return; /* let the event reach the text layer for selection */
    }
    e.preventDefault();
    onSelectStroke?.(hit.id);
    const b = strokeBBox(hit);
    xformRef.current = { mode: 'move', id: hit.id, orig: hit, startX: x, startY: y, anchorX: 0, anchorY: 0, bbox: b };
    drawingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* best effort */
    }
    onPointerActivity();
  };

  const onSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const xf = xformRef.current;
    if (!xf || !e.isPrimary) return;
    const { x, y } = toNormSurface(e);
    if (xf.mode === 'move') {
      const dx = x - xf.startX;
      const dy = y - xf.startY;
      const moved = translateStroke(xf.orig, dx, dy);
      setPreview((p) => (p && p.id === moved.id && Math.abs((p.points[0] ?? 0) - moved.points[0]) < 1e-6 && Math.abs((p.points[1] ?? 0) - moved.points[1]) < 1e-6) ? p : moved);
    } else {
      /* resize: anchor = opposite corner */
      const fx = xf.startX === xf.anchorX ? 1 : (x - xf.anchorX) / (xf.startX - xf.anchorX);
      const fy = xf.startY === xf.anchorY ? 1 : (y - xf.anchorY) / (xf.startY - xf.anchorY);
      setPreview(scaleStroke(xf.orig, xf.anchorX, xf.anchorY, fx, fy));
    }
  };

  const onSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const xf = xformRef.current;
    if (!xf) return;
    xformRef.current = null;
    drawingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const pv = previewRef.current;
    setPreview(null);
    if (pv && onCommitUpdate) {
      const changed = pv.points.some((v, i) => Math.abs(v - xf.orig.points[i]) > 1e-6);
      if (changed) onCommitUpdate(pageNum, xf.orig, pv);
      else redraw();
    } else {
      redraw();
    }
  };

  const beginResize = (e: React.PointerEvent<HTMLDivElement>, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!selectedId || !e.isPrimary) return;
    const orig = strokesRef.current.find((s) => s.id === selectedId);
    if (!orig) return;
    e.stopPropagation();
    e.preventDefault();
    const b = strokeBBox(orig);
    const anchorX = corner.includes('w') ? b.x + b.w : b.x;
    const anchorY = corner.includes('n') ? b.y + b.h : b.y;
    const { x, y } = toNormSurface(e);
    xformRef.current = { mode: 'resize', id: orig.id, orig, startX: x, startY: y, anchorX, anchorY, bbox: b };
    setResizeHandle(corner);
    drawingRef.current = true;
    try {
      (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* best effort */
    }
    onPointerActivity();
  };

  const showLoading = live && (rendering || !painted);
  const linksInteractive = tool === 'select';
  const selectedStroke = selectedId
    ? strokesRef.current.find((s) => s.id === selectedId) ?? (preview?.id === selectedId ? preview : null)
    : null;
  const selBBox = selectedStroke ? strokeBBox(selectedStroke) : null;

  /* resize handle overlay positions from the selected stroke's bbox */
  const handles: { corner: 'nw' | 'ne' | 'sw' | 'se'; left: string; top: string }[] = selBBox && selBBox.w >= 0
    ? [
        { corner: 'nw', left: `${selBBox.x * 100}%`, top: `${selBBox.y * 100}%` },
        { corner: 'ne', left: `${(selBBox.x + selBBox.w) * 100}%`, top: `${selBBox.y * 100}%` },
        { corner: 'sw', left: `${selBBox.x * 100}%`, top: `${(selBBox.y + selBBox.h) * 100}%` },
        { corner: 'se', left: `${(selBBox.x + selBBox.w) * 100}%`, top: `${(selBBox.y + selBBox.h) * 100}%` },
      ]
    : [];

  const onSurfaceMouseDown = (e: React.MouseEvent) => {
    if (tool !== 'select') return;
    /* pdf.js selection trick: pull endOfContent over the layer while selecting */
    const host = textHostRef.current;
    const end = host?.querySelector('.endOfContent') as HTMLElement | null;
    if (end && e.target === host) {
      end.style.top = '0';
      end.style.left = '0';
      end.style.width = '100%';
      end.style.height = '100%';
    }
  };

  const onSurfaceMouseUp = (e: React.MouseEvent) => {
    const end = textHostRef.current?.querySelector('.endOfContent') as HTMLElement | null;
    if (end) {
      end.style.top = '';
      end.style.left = '';
      end.style.width = '';
      end.style.height = '';
    }
    if (tool !== 'select' || !onWordSelected) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text || !sel) return;
    const words = text.split(/\s+/);
    if (words.length > 3) return;
    const range = sel.getRangeAt(0);
    if (!textHostRef.current?.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    onWordSelected({ text, page: pageNum, rect });
  };

  return (
    <div className="rd-page-card" data-page={pageNum} ref={rootRefCb}>
      <div
        className={`rd-page-surface${tool === 'select' && interactive ? ' rd-picking' : ''}`}
        style={pageBg ? { width: cssWidth, height: cssH, background: pageBg } : { width: cssWidth, height: cssH }}
        onMouseUp={onSurfaceMouseUp}
        onMouseDown={onSurfaceMouseDown}
        onPointerDown={onSurfacePointerDown}
        onDoubleClick={onSurfaceDoubleClick}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={onSurfacePointerUp}
      >
        {live ? (
          <>
            <canvas
              ref={pdfRef}
              className="rd-pdf"
              style={{ filter: themeFilter }}
              aria-label={`Page ${pageNum}`}
            />
            <div
              ref={textHostRef}
              className={`rd-text-layer${tool === 'select' ? ' active' : ''}`}
              aria-hidden="true"
            />
            <canvas
              ref={annoRef}
              className="rd-anno-layer"
              style={{
                pointerEvents: tool === 'select' ? 'none' : 'auto',
                touchAction: tool === 'select' ? 'auto' : 'none',
                cursor: tool === 'eraser' ? 'none' : undefined,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => finishDrawing(e, false)}
              onPointerCancel={(e) => finishDrawing(e, true)}
              onPointerLeave={() => {
                if (eraserRingRef.current) eraserRingRef.current.style.opacity = '0';
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
            {tool === 'eraser' && (
              <div ref={eraserRingRef} className="rd-eraser-ring" style={{ opacity: 0 }} aria-hidden="true" />
            )}
            {srcSelBox && (
              <div
                className="rd-srcsel"
                style={{
                  left: `${srcSelBox[0] * 100}%`,
                  top: `${srcSelBox[1] * 100}%`,
                  width: `${(srcSelBox[2] - srcSelBox[0]) * 100}%`,
                  height: `${(srcSelBox[3] - srcSelBox[1]) * 100}%`,
                }}
                role="application"
                aria-label="Replacement text placement — drag to move, corner handle to resize"
                onPointerDown={(e) => onSrcSelPointerDown(e, 'move')}
                onPointerMove={onSrcSelPointerMove}
                onPointerUp={onSrcSelPointerUp}
                onPointerCancel={onSrcSelPointerUp}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <span
                  className="rd-srcsel-handle"
                  role="button"
                  aria-label="Resize selection"
                  tabIndex={-1}
                  onPointerDown={(e) => onSrcSelPointerDown(e, 'resize')}
                  onPointerMove={onSrcSelPointerMove}
                  onPointerUp={onSrcSelPointerUp}
                />
              </div>
            )}
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
            {tool === 'select' && selectedId && handles.map((h) => (
              <div
                key={h.corner}
                className={`rd-resize-handle rd-h-${h.corner}${resizeHandle === h.corner ? ' active' : ''}`}
                style={{ left: h.left, top: h.top }}
                role="separator"
                aria-label={`Resize stroke (${h.corner} handle)`}
                onPointerDown={(e) => beginResize(e, h.corner)}
              />
            ))}
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

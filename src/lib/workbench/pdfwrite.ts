/* ==================== PDF writing (pdf-lib) ====================
   Page insertion with note templates (blank / lined / grid / dots / Oxford)
   and annotated-PDF export. All vector drawing — crisp at any zoom, small
   file delta. Everything happens locally. */

import { PDFDocument, rgb } from 'pdf-lib';
import { isRtlText } from './helpers';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageAnnoMap } from './types';
import { drawStrokes } from '@/components/workbench/reader/annotations';
import { getBlob, purgeFileArtifacts, putBlob } from './idb';
import { uid } from './helpers';

export type PageTemplate = 'blank' | 'lined' | 'grid' | 'dots' | 'oxford' | 'note';

export interface TemplateSpec {
  template: PageTemplate;
  count: number; // pages to insert
  afterPage: number; // 0 = start of document
  pageColor: string; // hex
  lineColor: string; // hex
  lineWidth: number; // pt
  spacing: number; // pt between lines
  size: 'match' | 'a4';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  return { r: v[0] / 255, g: v[1] / 255, b: v[2] / 255 };
}

function hexRgbCss(hex: string): { r: number; g: number; b: number } {
  return hexToRgb(hex);
}

/** Draw one template page's decorations. */
function drawTemplate(
  page: { getSize: () => { width: number; height: number }; drawLine: (o: unknown) => void; drawRectangle: (o: unknown) => void; drawCircle: (o: unknown) => void },
  spec: TemplateSpec
): void {
  const { width, height } = page.getSize();
  const bg = hexRgbCss(spec.pageColor);
  page.drawRectangle({
    x: 0, y: 0, width, height,
    color: rgb(bg.r, bg.g, bg.b),
  });
  const lc = hexRgbCss(spec.lineColor);
  const line = rgb(lc.r, lc.g, lc.b);
  const gap = Math.max(12, spec.spacing);
  const margin = 48;

  if (spec.template === 'lined' || spec.template === 'oxford') {
    const left = spec.template === 'oxford' ? width * 0.3 : margin;
    for (let y = gap; y < height - 40; y += gap) {
      page.drawLine({
        start: { x: left, y },
        end: { x: width - margin, y },
        thickness: spec.lineWidth,
        color: line,
        opacity: 0.55,
      });
    }
    if (spec.template === 'oxford') {
      /* vertical cue-column rule + header rule + summary area */
      page.drawLine({
        start: { x: width * 0.3, y: 40 },
        end: { x: width * 0.3, y: height - gap * 2 - 24 },
        thickness: Math.max(1, spec.lineWidth * 1.2),
        color: line,
        opacity: 0.75,
      });
      page.drawLine({
        start: { x: margin, y: height - gap * 2 },
        end: { x: width - margin, y: height - gap * 2 },
        thickness: Math.max(1, spec.lineWidth * 1.2),
        color: line,
        opacity: 0.75,
      });
      page.drawLine({
        start: { x: margin, y: 56 },
        end: { x: width - margin, y: 56 },
        thickness: Math.max(1, spec.lineWidth * 1.2),
        color: line,
        opacity: 0.75,
      });
    }
  } else if (spec.template === 'grid') {
    for (let x = margin; x < width - margin + gap; x += gap) {
      page.drawLine({
        start: { x, y: gap }, end: { x, y: height - gap },
        thickness: spec.lineWidth, color: line, opacity: 0.4,
      });
    }
    for (let y = gap; y < height - gap + gap; y += gap) {
      page.drawLine({
        start: { x: margin, y }, end: { x: width - margin, y },
        thickness: spec.lineWidth, color: line, opacity: 0.4,
      });
    }
  } else if (spec.template === 'dots') {
    for (let x = margin; x <= width - margin; x += gap) {
      for (let y = gap; y <= height - gap; y += gap) {
        page.drawCircle({
          x, y, size: Math.max(0.8, spec.lineWidth),
          color: line, opacity: 0.5,
        });
      }
    }
  }
}

export interface InsertResult {
  bytes: Uint8Array;
  newPageCount: number;
}

/** Load the stored PDF, insert template pages after `afterPage`, return new bytes. */
export async function insertTemplatePages(fileId: string, spec: TemplateSpec): Promise<InsertResult> {
  const blob = await getBlob(fileId);
  if (!blob) throw new Error('PDF not found in local storage');
  const srcBytes = new Uint8Array(await blob.arrayBuffer());
  const src = await PDFDocument.load(srcBytes);

  const firstSize = src.getPage(0).getSize();
  const size = spec.size === 'a4' ? { width: 595.28, height: 841.89 } : firstSize;

  const indices = Array.from({ length: src.getPageCount() }, (_, i) => i);
  /* pdf-lib inserts at the end via copyPages — we rebuild in order instead */
  const out = await PDFDocument.create();
  out.setProducer('Workbench Aurora');
  const copied = await out.copyPages(src, indices);
  let cursor = 0;
  for (let i = 0; i <= src.getPageCount(); i++) {
    if (i === spec.afterPage) {
      for (let k = 0; k < spec.count; k++) {
        const page = out.addPage([size.width, size.height]);
        drawTemplate(page as unknown as Parameters<typeof drawTemplate>[0], spec);
        /* no baked text here: anything drawn into the page becomes PDF content
           that no eraser can remove — templates are pure geometry */
      }
    }
    if (i < src.getPageCount()) out.addPage(copied[cursor++]);
  }

  const bytes = await out.save();
  return { bytes, newPageCount: out.getPageCount() };
}

/** Create a STANDALONE PDF note file from a template ("blank as new note").
    Independent of any source document — A4 portrait pages, straight into the library. */
export async function createTemplatePdfNote(
  spec: Pick<TemplateSpec, 'template' | 'count' | 'pageColor' | 'lineColor' | 'lineWidth' | 'spacing'>,
  title: string,
  folderId: string | null
): Promise<string | null> {
  const id = uid();
  try {
    const out = await PDFDocument.create();
    out.setProducer('Workbench Aurora');
    const pageSpec: TemplateSpec = { ...spec, afterPage: 0, size: 'a4' };
    for (let k = 0; k < Math.max(1, spec.count); k++) {
      const page = out.addPage([595.28, 841.89]); /* A4 portrait */
      drawTemplate(page as unknown as Parameters<typeof drawTemplate>[0], pageSpec);
    }
    const bytes = await out.save();
    await putBlob(id, new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
    const { useWB } = await import('./store');
    useWB.getState().addFile({
      id,
      kind: 'pdf',
      title,
      fileName: `${title}.pdf`,
      size: bytes.byteLength,
      pageCount: Math.max(1, spec.count),
      currentPage: 1,
      scrollProgress: 0,
      folderId,
    });
    return id;
  } catch {
    await purgeFileArtifacts(id).catch(() => undefined);
    return null;
  }
}

/* ---------- blob-level undo support ----------
   Undo snapshots capture store metadata, not IDB bytes. When a write changes
   the stored PDF (page insertion), we keep the pre-write bytes so an undo
   that shrinks pageCount can restore the blob and stay consistent. */
const blobBackups = new Map<string, { bytes: Uint8Array; pageCount: number }>();

/** Called by the store's undo/redo after a snapshot restore. */
export async function reconcileBlobAfterUndo(fileId: string, metaPageCount: number): Promise<void> {
  const backup = blobBackups.get(fileId);
  if (!backup) return;
  if (backup.pageCount === metaPageCount) {
    /* undo returned metadata to the pre-write shape — restore the old blob */
    await putBlob(fileId, new Blob([backup.bytes as unknown as BlobPart], { type: 'application/pdf' }));
    blobBackups.delete(fileId);
  } else if (metaPageCount > backup.pageCount) {
    /* redo (or a later insert) — drop the stale backup */
    blobBackups.delete(fileId);
  }
}

/** Persist an updated PDF back into the library (blob + metadata). */
export async function savePdfBytes(fileId: string, bytes: Uint8Array, newPageCount: number, opts?: { keepBackup?: boolean }): Promise<void> {
  if (opts?.keepBackup) {
    const prev = await getBlob(fileId);
    if (prev && !blobBackups.has(fileId)) {
      blobBackups.set(fileId, { bytes: new Uint8Array(await prev.arrayBuffer()), pageCount: newPageCount - 1 });
    }
  }
  await putBlob(fileId, new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }));
  const { useWB } = await import('./store');
  useWB.getState().updateFile(fileId, { pageCount: newPageCount });
}

/**
 * Export the document with ink flattened: every page renders through pdf.js
 * (canvas + strokes) and lands as a full-page PNG overlay in a new PDF.
 */
export async function exportAnnotatedPdf(
  fileId: string,
  doc: PDFDocumentProxy,
  annos: PageAnnoMap,
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const blob = await getBlob(fileId);
  if (!blob) throw new Error('PDF not found');
  const srcBytes = new Uint8Array(await blob.arrayBuffer());
  const src = await PDFDocument.load(srcBytes);
  const out = await PDFDocument.create();
  out.setProducer('Workbench Aurora');

  const total = doc.numPages;
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const strokes = annos[String(n)] ?? [];
    if (strokes.length) drawStrokes(ctx, strokes, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    const embedded = await out.embedPng(png);
    const base = src.getPage(n - 1).getSize();
    const p = out.addPage([base.width, base.height]);
    p.drawImage(embedded, { x: 0, y: 0, width: base.width, height: base.height });
    onProgress?.(n, total);
  }
  return out.save();
}


/* ---------- markdown → canvas (for note pages) ---------- */

const MD_SANS = '"Inter Variable", "Vazirmatn Variable", sans-serif';
const MD_DISPLAY = '"Sora Variable", "Inter Variable", "Vazirmatn Variable", sans-serif';

interface MdLine { text: string; size: number; font: string; bold: boolean; italic: boolean; bullet: boolean; quote: boolean; rtl: boolean; hr: boolean }

function parseMarkdownLines(md: string, basePx: number): MdLine[] {
  const out: MdLine[] = [];
  const boldSplit = (t: string): { text: string; bold: boolean }[] =>
    t.split(/\*\*(.+?)\*\*/g).map((part, i) => ({ text: part, bold: i % 2 === 1 }));
  const push = (raw: string, o: Partial<MdLine> = {}): void => {
    if (!raw.trim() && !o.hr) return;
    out.push({
      text: raw,
      size: basePx,
      font: MD_SANS,
      bold: false,
      italic: false,
      bullet: false,
      quote: false,
      rtl: isRtlText(raw),
      hr: false,
      ...o,
    });
  };
  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd();
    if (/^---+$/.test(line.trim())) {
      out.push({ text: '', size: 0, font: '', bold: false, italic: false, bullet: false, quote: false, rtl: false, hr: true });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const scale = [1.9, 1.5, 1.22, 1.08][h[1].length - 1];
      for (const seg of boldSplit(h[2])) {
        push(seg.text, { size: basePx * scale, font: MD_DISPLAY, bold: true, ...{} });
      }
      continue;
    }
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      for (const seg of boldSplit(bq[1])) {
        push(seg.text, { italic: true, quote: true, bold: seg.bold });
      }
      continue;
    }
    const ul = line.match(/^[-*+]\s+(.*)$/);
    if (ul) {
      const nested = out[out.length - 1]?.bullet ? '  ' : '';
      for (const seg of boldSplit(ul[1])) {
        /* RLM keeps the bullet on the reading-start side for RTL lines */
        const text = isRtlText(seg.text) ? '\u200F•  ' + seg.text : '•  ' + seg.text;
        push(nested + text, { bullet: true, bold: seg.bold });
      }
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      const num = line.match(/^\d+/)?.[0] ?? '1';
      for (const seg of boldSplit(ol[1])) {
        push(`${num}.  ${seg.text}`, { bold: seg.bold });
      }
      continue;
    }
    if (!line.trim()) {
      out.push({ text: '', size: basePx * 0.6, font: MD_SANS, bold: false, italic: false, bullet: false, quote: false, rtl: false, hr: false });
      continue;
    }
    for (const seg of boldSplit(line)) push(seg.text, { bold: seg.bold });
  }
  return out;
}

/** Render markdown onto a canvas at the given pixel width (2x for crispness). */
export function renderMarkdownToCanvas(md: string, widthPx: number, pageColor: string, inkColor: string): HTMLCanvasElement {
  const base = 15; /* px at 1x — canvas is 2x */
  const scale = 2;
  const margin = 52 * scale;
  const canvas = document.createElement('canvas');
  const ctx0 = canvas.getContext('2d');
  if (!ctx0) throw new Error('no 2d context');

  const lines = parseMarkdownLines(md, base * scale);
  const lineH = (l: MdLine): number => l.size * (l.quote ? 1.5 : 1.55) + (l.size > base * scale ? 8 * scale : 4 * scale);
  let y = margin;
  const wrapCache = new Map<MdLine, string[]>();
  const probe = document.createElement('canvas').getContext('2d')!;
  const maxW = widthPx * scale - margin * 2;
  for (const l of lines) {
    if (l.hr) {
      y += 10 * scale;
      continue;
    }
    probe.font = `${l.italic ? 'italic ' : ''}${l.bold ? '700 ' : '400 '}${l.size}px ${l.font}`;
    const words = l.text.split(/\s+/);
    const wrapped: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (probe.measureText(test).width > maxW - (l.quote ? 26 * scale : 0) && line) {
        wrapped.push(line);
        line = w;
      } else line = test;
    }
    if (line) wrapped.push(line);
    wrapCache.set(l, wrapped);
    y += wrapped.length * lineH(l) + (l.size > base * scale ? 10 * scale : 0);
  }

  canvas.width = widthPx * scale;
  canvas.height = Math.max(Math.round(y + margin), widthPx * scale * 1.2);
  const ctx = canvas.getContext('2d')!;
  const bg = hexToRgb(pageColor);
  ctx.fillStyle = rgb(bg.r, bg.g, bg.b).toString();
  ctx.fillStyle = pageColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = inkColor;

  y = margin;
  for (const l of lines) {
    if (l.hr) {
      ctx.fillStyle = hexToRgb(inkColor) ? inkColor : '#888';
      ctx.globalAlpha = 0.35;
      ctx.fillRect(margin, y, canvas.width - margin * 2, 1.2 * scale);
      ctx.globalAlpha = 1;
      ctx.fillStyle = inkColor;
      y += 18 * scale;
      continue;
    }
    const wrapped = wrapCache.get(l) ?? [];
    ctx.font = `${l.italic ? 'italic ' : ''}${l.bold ? '700 ' : '400 '}${l.size}px ${l.font}`;
    ctx.direction = l.rtl ? 'rtl' : 'ltr';
    ctx.textAlign = l.rtl ? 'right' : 'left';
    const anchorX = l.rtl ? canvas.width - margin : margin + (l.quote ? 26 * scale : 0);
    const barX = l.rtl ? canvas.width - margin - 6 * scale : margin + 6 * scale;
    if (l.quote) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = inkColor;
      ctx.fillRect(l.rtl ? canvas.width - margin : margin, y - l.size, 4 * scale, wrapped.length * lineH(l));
      ctx.restore();
      ctx.globalAlpha = 0.75;
    }
    for (const wl of wrapped) {
      ctx.fillText(wl, anchorX, y);
      y += lineH(l);
    }
    if (l.quote) {
      ctx.globalAlpha = 1;
      y += 6 * scale;
    }
    if (l.size > base * scale) y += 6 * scale;
  }
  return canvas;
}

/** Insert a markdown note page (canvas-rendered, Persian-safe) after `afterPage`. */
export async function insertMarkdownPage(
  fileId: string,
  afterPage: number,
  md: string,
  pageColor: string,
  inkColor: string,
  size: 'match' | 'a4'
): Promise<InsertResult> {
  const blob = await getBlob(fileId);
  if (!blob) throw new Error('PDF not found in local storage');
  const src = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  const firstSize = src.getPage(0).getSize();
  const dims = size === 'a4' ? { width: 595.28, height: 841.89 } : firstSize;
  const canvas = renderMarkdownToCanvas(md, Math.round(dims.width), pageColor, inkColor);
  const out = await PDFDocument.create();
  out.setProducer('Workbench Aurora');
  const copied = await out.copyPages(src, Array.from({ length: src.getPageCount() }, (_, i) => i));
  let cursor = 0;
  for (let i = 0; i <= src.getPageCount(); i++) {
    if (i === afterPage) {
      const page = out.addPage([dims.width, dims.height]);
      const png = await out.embedPng(canvas.toDataURL('image/png'));
      page.drawImage(png, { x: 0, y: 0, width: dims.width, height: dims.height });
    }
    if (i < src.getPageCount()) out.addPage(copied[cursor++]);
  }
  return { bytes: await out.save(), newPageCount: out.getPageCount() };
}

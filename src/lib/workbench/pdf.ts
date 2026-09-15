/* ==================== Workbench Aurora — pdf.js helpers (client-only, lazy) ====================
   The worker is served from /pdf.worker.min.mjs (copied into public/).
   All APIs are async and only called from browser components. */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getBlobUrl } from './idb';

type PdfjsModule = typeof import('pdfjs-dist');

let pdfjs: PdfjsModule | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (pdfjs) return pdfjs;
  const mod = await import('pdfjs-dist');
  mod.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  pdfjs = mod;
  return mod;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

/** Load (and cache) a PDF document for a stored file id. */
export async function loadFileDoc(fileId: string): Promise<PDFDocumentProxy> {
  const hit = docCache.get(fileId);
  if (hit) return hit;
  const p = (async () => {
    const lib = await getPdfjs();
    const url = await getBlobUrl(fileId);
    if (!url) throw new Error('PDF blob not found in local storage');
    return lib.getDocument({ url }).promise;
  })();
  docCache.set(fileId, p);
  p.catch(() => docCache.delete(fileId));
  return p;
}

/** Load a PDF document from a raw File/Blob (upload flow — not cached). */
export async function loadDocFromBlob(blob: Blob): Promise<PDFDocumentProxy> {
  const lib = await getPdfjs();
  const url = URL.createObjectURL(blob);
  try {
    return await lib.getDocument({ url }).promise;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render a page onto a canvas element at a given scale. */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement,
  opts: { scale?: number; maxWidth?: number } = {}
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, pageNum)));
  let scale = opts.scale ?? 1;
  if (opts.maxWidth) {
    const initial = page.getViewport({ scale: 1 });
    scale = opts.maxWidth / initial.width;
    if (opts.scale) scale = Math.min(opts.scale, scale);
  }
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
  return { width: viewport.width, height: viewport.height };
}

/** Render a page to a JPEG dataURL (covers/thumbnails). */
export async function pageToDataUrl(
  doc: PDFDocumentProxy,
  pageNum: number,
  maxWidth = 420,
  quality = 0.72
): Promise<string> {
  const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, pageNum)));
  const base = page.getViewport({ scale: 1 });
  const scale = maxWidth / base.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const dpr = 1; // thumbnails don't need retina
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', quality);
}

/** Compute rough reading metadata for a freshly uploaded file. */
export async function inspectPdf(blob: Blob): Promise<{ pageCount: number }> {
  const doc = await loadDocFromBlob(blob);
  return { pageCount: doc.numPages };
}

/** Warm the worker so first reader open is fast. */
export function warmPdfWorker(): void {
  void getPdfjs();
}

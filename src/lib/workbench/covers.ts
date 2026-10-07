/* ==================== Workbench Aurora — cover resolution hook ====================
   Resolves a ResourceFile cover to a dataURL:
   custom mode → uploaded image in IDB; page mode → renders coverPage via pdf.js (cached in IDB). */

'use client';

import { useEffect, useState } from 'react';
import type { ResourceFile } from './types';

/** Typographic cover tile for markdown files — first heading on a color wash. */
async function makeTextCover(file: ResourceFile): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 560;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const base = file.color || '#0e8a7d';
  const g = ctx.createLinearGradient(0, 0, 420, 560);
  g.addColorStop(0, base);
  g.addColorStop(1, '#15181d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 420, 560);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(0, 0, 420, 8);
  const raw = (file.title || 'Note').trim();
  // wrap up to 4 lines
  ctx.font = '700 40px "Sora Variable", "Inter Variable", sans-serif';
  ctx.fillStyle = '#ffffff';
  const words = raw.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > 340 && line) {
      lines.push(line);
      line = w;
      if (lines.length === 4) break;
    } else line = test;
  }
  if (lines.length < 4 && line) lines.push(line);
  const startY = 560 / 2 - ((lines.length - 1) * 52) / 2;
  lines.forEach((l, i) => ctx.fillText(l, 40, startY + i * 52));
  ctx.font = '650 17px "JetBrains Mono Variable", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.fillText('MARKDOWN', 40, 560 - 44);
  return canvas.toDataURL('image/jpeg', 0.8);
}
import { ensureCover, fetchCoverCached, invalidateCoverCache, saveCover } from './idb';
import { loadFileDoc, pageToDataUrl } from './pdf';

/**
 * Returns the cover dataURL for a file, generating + persisting it when missing.
 * Re-resolves when coverMode/coverPage change (cache key includes them).
 */
export function useFileCover(file: ResourceFile | undefined): string | null {
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [nonce, setNonce] = useState(0);
  const id = file?.id;

  // Re-resolve when another component refreshes this file's cover.
  useEffect(() => {
    if (!id) return;
    const h = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setNonce((x) => x + 1);
    };
    window.addEventListener('wb-cover-refresh', h);
    return () => window.removeEventListener('wb-cover-refresh', h);
  }, [id]);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    const cacheKey = `${file.id}::${file.coverMode}::${file.coverPage}`;
    const storedKey = `covermeta:${file.id}`;
    (async () => {
      // Regenerate when the cover config changed since last persist.
      const lastMeta = localStorage.getItem(storedKey);
      if (lastMeta !== cacheKey) {
        invalidateCoverCache(file.id);
        localStorage.setItem(storedKey, cacheKey);
      }
      const dataUrl = await ensureCover(file.id, async () => {
        if (file.coverMode === 'custom') return null; // custom covers are only uploaded, never generated
        if (file.kind === 'md') {
          try {
            return await makeTextCover(file);
          } catch {
            return null;
          }
        }
        try {
          const doc = await loadFileDoc(file.id);
          return pageToDataUrl(doc, file.coverPage, 420, 0.72);
        } catch {
          return null;
        }
      });
      if (alive) setResolved((prev) => ({ ...prev, [file.id]: dataUrl ?? null }));
    })();
    return () => {
      alive = false;
    };
  }, [file?.id, file?.coverMode, file?.coverPage, nonce]);

  return file ? (resolved[file.id] ?? null) : null;
}

/** Force a re-render of the page-cover (called after page-cover regeneration). */
export function refreshCover(fileId: string): void {
  invalidateCoverCache(fileId);
  window.dispatchEvent(new CustomEvent('wb-cover-refresh', { detail: fileId }));
}

/** Save an uploaded custom cover and broadcast refresh. */
export async function applyCustomCover(fileId: string, dataUrl: string): Promise<void> {
  await saveCover(fileId, dataUrl);
  window.dispatchEvent(new CustomEvent('wb-cover-refresh', { detail: fileId }));
}

/** Subscribe to cover refresh events (used internally by useFileCover consumers). */
export function useCoverRefreshSignal(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const h = () => setN((x) => x + 1);
    window.addEventListener('wb-cover-refresh', h);
    return () => window.removeEventListener('wb-cover-refresh', h);
  }, []);
  return n;
}

/** Prefetch covers for a list of files (warms IDB cache without React state). */
export function prefetchCovers(files: ResourceFile[]): void {
  files.forEach((f) => {
    void fetchCoverCached(f.id).then((hit) => {
      if (hit) return;
      void ensureCover(f.id, async () => {
        if (f.coverMode === 'custom') return null;
        try {
          const doc = await loadFileDoc(f.id);
          return pageToDataUrl(doc, f.coverPage, 420, 0.72);
        } catch {
          return null;
        }
      });
    });
  });
}

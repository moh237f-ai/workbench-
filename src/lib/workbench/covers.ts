/* ==================== Workbench Aurora — cover resolution hook ====================
   Resolves a ResourceFile cover to a dataURL:
   custom mode → uploaded image in IDB; page mode → renders coverPage via pdf.js (cached in IDB). */

'use client';

import { useEffect, useState } from 'react';
import type { ResourceFile } from './types';
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

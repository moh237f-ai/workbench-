/* ==================== Workbench Aurora — IndexedDB for PDF blobs & covers ====================
   Local-first storage for heavy artifacts. Metadata lives in Zustand (localStorage);
   blobs and cover images live here so localStorage stays light. 'use client' side only. */

const DB_NAME = 'wb-files';
const DB_VERSION = 1;
const STORE_BLOBS = 'blobs';
const STORE_COVERS = 'covers';

let dbPromise: Promise<IDBDatabase> | null = null;

function openFileDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      if (!db.objectStoreNames.contains(STORE_COVERS)) db.createObjectStore(STORE_COVERS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openFileDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/* ---------- blobs ---------- */

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await tx(STORE_BLOBS, 'readwrite', (s) => s.put(blob, id));
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>(STORE_BLOBS, 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
}

export async function delBlob(id: string): Promise<void> {
  await tx(STORE_BLOBS, 'readwrite', (s) => s.delete(id));
}

/* ---------- covers (dataURL strings) ---------- */

export async function putCover(id: string, dataUrl: string): Promise<void> {
  await tx(STORE_COVERS, 'readwrite', (s) => s.put(dataUrl, id));
}

export async function getCover(id: string): Promise<string | undefined> {
  return tx<string | undefined>(STORE_COVERS, 'readonly', (s) => s.get(id) as IDBRequest<string | undefined>);
}

export async function delCover(id: string): Promise<void> {
  await tx(STORE_COVERS, 'readwrite', (s) => s.delete(id));
}

/* ---------- in-memory caches ---------- */

const coverCache = new Map<string, string>();
const coverInflight = new Map<string, Promise<string | null>>();

/** Cache-aware cover getter: IDB → memory cache. */
export async function fetchCoverCached(id: string): Promise<string | null> {
  const hit = coverCache.get(id);
  if (hit) return hit;
  const fromIdb = await getCover(id).catch(() => undefined);
  if (fromIdb) {
    coverCache.set(id, fromIdb);
    return fromIdb;
  }
  return null;
}

/** Store cover in IDB + memory cache. */
export async function saveCover(id: string, dataUrl: string): Promise<void> {
  coverCache.set(id, dataUrl);
  await putCover(id, dataUrl).catch(() => undefined);
}

/** Invalidate cached cover (e.g. cover mode/page changed). */
export function invalidateCoverCache(id: string): void {
  coverCache.delete(id);
  coverInflight.delete(id);
}

/** Run a cover generation once per id (dedupes concurrent calls). */
export async function ensureCover(
  id: string,
  generate: () => Promise<string | null>
): Promise<string | null> {
  const cached = await fetchCoverCached(id);
  if (cached) return cached;
  const running = coverInflight.get(id);
  if (running) return running;
  const p = generate()
    .then(async (dataUrl) => {
      if (dataUrl) await saveCover(id, dataUrl);
      return dataUrl;
    })
    .finally(() => {
      coverInflight.delete(id);
    });
  coverInflight.set(id, p);
  return p;
}

/* ---------- object URLs for pdf blobs (revoked on release) ---------- */

const urlCache = new Map<string, string>();

export async function getBlobUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getBlob(id).catch(() => undefined);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function releaseBlobUrl(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

/** Delete every artifact of a file (blob, cover, urls). */
export async function purgeFileArtifacts(id: string): Promise<void> {
  releaseBlobUrl(id);
  coverCache.delete(id);
  coverInflight.delete(id);
  await Promise.all([delBlob(id).catch(() => undefined), delCover(id).catch(() => undefined)]);
}

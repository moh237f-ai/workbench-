/* ==================== Library View: PDF shelf — folder tree, bulk select, covers, deadlines, reading stats ==================== */
'use client';

import './library.css';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive, ArchiveRestore, BookOpen, Brain, Calculator, Check, CheckSquare, ChevronDown, ChevronRight,
  Clock, Code2, FileText, FlaskConical, Folder, FolderInput, FolderPlus, Globe, GraduationCap, Inbox,
  Library as LibraryIco, Link2, ListTree, Music, Palette, Pencil, PenLine, Plus, Search, Star, Trash2,
  Upload, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useWB, wbFileDeadlineStatus, wbFileMinutes, wbFileProgress, wbFileReadPages, wbFileSeconds,
  wbItemsForFile, wbReadingMinutesInRange, wbReadingPagesInRange,
} from '@/lib/workbench/store';
import { daysUntil, fmtDuration, startOfWeekStr, todayStr, uid } from '@/lib/workbench/helpers';
import { FOLDER_ICONS, FOLDER_SWATCHES } from '@/lib/workbench/types';
import type { LibraryFolder, ResourceFile } from '@/lib/workbench/types';
import { putBlob, purgeFileArtifacts, saveCover } from '@/lib/workbench/idb';
import { loadDocFromBlob, pageToDataUrl } from '@/lib/workbench/pdf';
import { useFileCover } from '@/lib/workbench/covers';
import { Btn, IconBtn, Seg, toast, useConfirm } from '../ui/primitives';

/* ---------- local types ---------- */

type LibFilter = 'all' | 'reading' | 'unread' | 'deadline' | 'archived';
type LibSort = 'recent' | 'deadline' | 'progress' | 'title';

const FILTER_OPTIONS: { id: LibFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reading', label: 'Reading' },
  { id: 'unread', label: 'Unread' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'archived', label: 'Archived' },
];

/* ---------- folder icon mapping (store keeps a string key) ---------- */

const FOLDER_ICON_MAP: Record<string, LucideIcon> = {
  folder: Folder,
  book: BookOpen,
  graduation: GraduationCap,
  flask: FlaskConical,
  calculator: Calculator,
  code: Code2,
  music: Music,
  globe: Globe,
  star: Star,
  archive: Archive,
  pen: PenLine,
  brain: Brain,
};

function folderIconOf(key: string): LucideIcon {
  return FOLDER_ICON_MAP[key] ?? Folder;
}

/* ---------- shared import pipeline (module level: header buttons + drop zone + empty state) ---------- */

let importingCount = 0;
const importingListeners = new Set<() => void>();

function bumpImporting(delta: number): void {
  importingCount = Math.max(0, importingCount + delta);
  importingListeners.forEach((l) => l());
}

function useImportingCount(): number {
  return useSyncExternalStore(
    (cb) => {
      importingListeners.add(cb);
      return () => {
        importingListeners.delete(cb);
      };
    },
    () => importingCount
  );
}

/** One PDF through the pipeline: blob → IDB, cover render, store record. Throws on failure (caller purges). */
async function ingestPdf(file: File, id: string, folderId: string | null): Promise<void> {
  await putBlob(id, file);
  const doc = await loadDocFromBlob(file);
  const cover = await pageToDataUrl(doc, 1, 420, 0.72);
  await saveCover(id, cover);
  useWB.getState().addFile({
    id,
    title: file.name.replace(/\.pdf$/i, ''),
    fileName: file.name,
    size: file.size,
    pageCount: doc.numPages,
    folderId,
  });
}

/** Upload pipeline for loose PDF files: store blob → render cover → register file (toast per file). */
async function importPdfFiles(list: File[]): Promise<void> {
  bumpImporting(list.length);
  for (const file of list) {
    const id = uid();
    try {
      await ingestPdf(file, id, null);
      toast('Added to library', file.name.replace(/\.pdf$/i, ''));
    } catch {
      await purgeFileArtifacts(id).catch(() => undefined);
      toast('Import failed', file.name);
    } finally {
      bumpImporting(-1);
    }
  }
}

const IMPORT_FOLDER_CAP = 60;

/** Import a whole system folder: builds the folder tree from each file's webkitRelativePath
 *  (e.g. "Math/ODE/chapter1.pdf" → Math → ODE), reusing folders by name + parent. */
async function importPdfFolder(list: File[]): Promise<void> {
  const pdfs = list.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const skipped = list.length - pdfs.length;
  if (skipped > 0) {
    toast('Skipped non-PDFs', `${skipped} file${skipped === 1 ? '' : 's'} ignored — only PDFs are imported.`);
  }
  if (!pdfs.length) {
    toast('No PDFs found', 'Pick a folder that contains PDF files.');
    return;
  }
  let work = pdfs;
  if (work.length > IMPORT_FOLDER_CAP) {
    work = work.slice(0, IMPORT_FOLDER_CAP);
    toast('Import capped', `Only the first ${IMPORT_FOLDER_CAP} PDFs will be imported (found ${pdfs.length}).`);
  }

  /* relative path → folder id cache (create or reuse by name + parent) */
  const cache = new Map<string, string>();
  let created = 0;
  const ensureFolderPath = (segments: string[]): string | null => {
    let parentId: string | null = null;
    let path = '';
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg;
      const hit = cache.get(path);
      if (hit) {
        parentId = hit;
        continue;
      }
      const st = useWB.getState();
      const found = st.libraryFolders.find((f) => f.name === seg && f.parentId === parentId);
      const fid = found ? found.id : st.addLibraryFolder(seg, parentId).id;
      if (!found) created += 1;
      cache.set(path, fid);
      parentId = fid;
    }
    return parentId;
  };

  let imported = 0;
  let failed = 0;
  const targetFolders = new Set<string>();
  bumpImporting(work.length);
  for (const file of work) {
    const id = uid();
    try {
      const segments = file.webkitRelativePath.split('/').filter(Boolean);
      segments.pop(); // strip the file name
      const folderId = segments.length ? ensureFolderPath(segments) : null;
      await ingestPdf(file, id, folderId);
      if (folderId) targetFolders.add(folderId);
      imported += 1;
    } catch {
      failed += 1;
      await purgeFileArtifacts(id).catch(() => undefined);
    } finally {
      bumpImporting(-1);
    }
  }

  const title = imported
    ? targetFolders.size
      ? `Imported ${imported} ${imported === 1 ? 'file' : 'files'} into ${targetFolders.size} ${
          targetFolders.size === 1 ? 'folder' : 'folders'
        }`
      : `Imported ${imported} ${imported === 1 ? 'file' : 'files'}`
    : 'Import failed';
  const desc: string[] = [];
  if (created) desc.push(`${created} new ${created === 1 ? 'folder' : 'folders'} created`);
  if (failed) desc.push(`${failed} failed`);
  toast(title, desc.length ? desc.join(' · ') : undefined);
}

/** Hidden multi-PDF file input + programmatic opener (self-contained per consumer). */
function usePdfPicker(onFiles: (files: File[]) => void): { open: () => void; input: React.ReactNode } {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = useCallback(() => inputRef.current?.click(), []);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf"
      multiple
      hidden
      onChange={(e) => {
        const el = e.currentTarget;
        const picked = Array.from(el.files || []);
        el.value = '';
        if (picked.length) onFiles(picked);
      }}
    />
  );
  return { open, input };
}

/** Hidden directory input (webkitdirectory set via ref attribute — not in React's typings). */
function useFolderPicker(onFiles: (files: File[]) => void): { open: () => void; input: React.ReactNode } {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const open = useCallback(() => inputRef.current?.click(), []);
  const setRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);
  const input = (
    <input
      ref={setRef}
      type="file"
      multiple
      hidden
      onChange={(e) => {
        const el = e.currentTarget;
        const picked = Array.from(el.files || []);
        el.value = '';
        if (picked.length) onFiles(picked);
      }}
    />
  );
  return { open, input };
}

/* ---------- selection mode (module-level store: header toggle ↔ cards ↔ bulk bar) ---------- */

let selectionMode = false;
let selectedIds: ReadonlySet<string> = new Set<string>();
const selectionListeners = new Set<() => void>();

function emitSelection(): void {
  selectionListeners.forEach((l) => l());
}

function setSelectionMode(v: boolean): void {
  if (selectionMode === v) return;
  selectionMode = v;
  if (!v) selectedIds = new Set<string>();
  emitSelection();
}

function toggleSelected(id: string): void {
  const next = new Set<string>(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds = next;
  emitSelection();
}

function selectMany(ids: string[], mode: 'replace' | 'add'): void {
  selectedIds = mode === 'replace' ? new Set<string>(ids) : new Set<string>([...selectedIds, ...ids]);
  emitSelection();
}

function clearSelection(): void {
  if (!selectedIds.size) return;
  selectedIds = new Set<string>();
  emitSelection();
}

function subscribeSelection(cb: () => void): () => void {
  selectionListeners.add(cb);
  return () => {
    selectionListeners.delete(cb);
  };
}

function useSelectionMode(): boolean {
  return useSyncExternalStore(subscribeSelection, () => selectionMode);
}

function useSelectedIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeSelection, () => selectedIds);
}

function useIsSelected(id: string): boolean {
  return useSyncExternalStore(subscribeSelection, () => selectedIds.has(id));
}

/** useFileCover plus a "gave up" flag: distinguishes loading (shimmer) from failed (icon tile). */
function useCoverWithFallback(file: ResourceFile): { cover: string | null; failed: boolean } {
  const cover = useFileCover(file);
  const epoch = `${file.id}::${file.coverMode}::${file.coverPage}`;
  const [timedOut, setTimedOut] = useState<{ epoch: string; done: boolean }>({ epoch: '', done: false });
  useEffect(() => {
    const t = setTimeout(() => setTimedOut({ epoch, done: true }), 2400);
    return () => clearTimeout(t);
  }, [epoch]);
  return { cover, failed: !cover && timedOut.epoch === epoch && timedOut.done };
}

/* ---------- folder tree helpers (pure, module scope) ---------- */

type FolderNode = { folder: LibraryFolder; children: FolderNode[]; depth: number };

/** Root folders + nested subfolders; orphans (missing parent) are treated as roots. */
function buildFolderTree(folders: LibraryFolder[]): FolderNode[] {
  const byParent = new Map<string | null, LibraryFolder[]>();
  for (const f of folders) {
    const key = f.parentId && folders.some((x) => x.id === f.parentId) ? f.parentId : null;
    const arr = byParent.get(key);
    if (arr) arr.push(f);
    else byParent.set(key, [f]);
  }
  const make = (parent: string | null, depth: number): FolderNode[] =>
    (byParent.get(parent) ?? []).map((folder) => ({ folder, children: make(folder.id, depth + 1), depth }));
  return make(null, 0);
}

/** folderId → set of itself + all descendants (for counts + cycle guards). */
function selfAndDescendants(folders: LibraryFolder[]): Map<string, Set<string>> {
  const childrenOf = new Map<string, LibraryFolder[]>();
  for (const f of folders) {
    if (!f.parentId || !folders.some((x) => x.id === f.parentId)) continue;
    const arr = childrenOf.get(f.parentId);
    if (arr) arr.push(f);
    else childrenOf.set(f.parentId, [f]);
  }
  const memo = new Map<string, Set<string>>();
  const collect = (id: string): Set<string> => {
    const cached = memo.get(id);
    if (cached) return cached;
    const set = new Set<string>([id]);
    memo.set(id, set); /* seed before recursion — breaks any (impossible-by-store) parent cycle */
    for (const child of childrenOf.get(id) ?? []) {
      for (const d of collect(child.id)) set.add(d);
    }
    return set;
  };
  for (const f of folders) collect(f.id);
  return memo;
}

/** Ancestor chain for a folder id (root first). Empty when unknown. */
function folderPathOf(folders: LibraryFolder[], id: string): LibraryFolder[] {
  const map = new Map(folders.map((f) => [f.id, f]));
  const path: LibraryFolder[] = [];
  const seen = new Set<string>();
  let cur = map.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? map.get(cur.parentId) : undefined;
  }
  return path;
}

/** Folder list in tree order (pre-order) with depth-prefixed labels — for selects that mirror the tree. */
function flattenFolderOptions(folders: LibraryFolder[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: FolderNode[]): void => {
    for (const n of nodes) {
      out.push({ id: n.folder.id, label: `${'— '.repeat(Math.min(n.depth, 6))}${n.folder.name}` });
      walk(n.children);
    }
  };
  walk(buildFolderTree(folders));
  return out;
}

/* ---------- header actions ---------- */

export function LibraryHeaderActions() {
  const filter = useWB((s) => s.libraryFilter);
  const setFilter = useWB((s) => s.setLibraryFilter);
  const search = useWB((s) => s.librarySearch);
  const setSearch = useWB((s) => s.setLibrarySearch);
  const importing = useImportingCount();
  const selecting = useSelectionMode();
  const { open, input } = usePdfPicker((fs) => void importPdfFiles(fs));
  const { open: openFolder, input: folderInput } = useFolderPicker((fs) => void importPdfFolder(fs));

  return (
    <>
      {input}
      {folderInput}
      <div className="lib-search-box">
        <Search size={14} aria-hidden="true" />
        <input
          type="text"
          value={search}
          placeholder="Search files…"
          aria-label="Search files by title, file name or tag"
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="lib-search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setSearch('')}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <Seg<LibFilter>
        className="lib-filter-seg"
        value={filter}
        onChange={setFilter}
        options={FILTER_OPTIONS}
      />
      {importing > 0 && (
        <span className="lib-importing" role="status">
          <span className="lib-spin" aria-hidden="true" />
          {importing > 1 ? `Importing ${importing}…` : 'Importing…'}
        </span>
      )}
      <Btn
        size="sm"
        variant={selecting ? 'primary' : 'ghost'}
        aria-pressed={selecting}
        title="Bulk-select files — move, archive or delete many at once"
        onClick={() => setSelectionMode(!selecting)}
      >
        <CheckSquare size={14} /> Select
      </Btn>
      <Btn size="sm" variant="ghost" title="Import a folder of PDFs from your system" onClick={openFolder}>
        <FolderPlus size={14} /> Add folder
      </Btn>
      <Btn size="sm" variant="primary" onClick={open}>
        <Upload size={14} /> Add PDF
      </Btn>
    </>
  );
}

/* ---------- filter + sort ---------- */

function matchesFilter(f: ResourceFile, filter: LibFilter): boolean {
  if (filter === 'archived') return f.archived;
  if (f.archived) return false;
  const pct = wbFileProgress(f);
  if (filter === 'reading') return pct > 0 && pct < 100;
  if (filter === 'unread') return pct === 0;
  if (filter === 'deadline') return !!f.deadline && (wbFileDeadlineStatus(f) !== 'ok' || pct < 100);
  return true;
}

/** Folder filter: 'all' | 'unfiled' | folder id (files directly in that folder only). */
function matchesFolder(f: ResourceFile, folderFilter: string): boolean {
  if (folderFilter === 'all') return true;
  if (folderFilter === 'unfiled') return !f.folderId;
  return f.folderId === folderFilter;
}

/** Search: case-insensitive substring over title, fileName and tags. */
function matchesSearch(f: ResourceFile, q: string): boolean {
  if (!q) return true;
  return (
    f.title.toLowerCase().includes(q) ||
    f.fileName.toLowerCase().includes(q) ||
    f.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function sortFiles(list: ResourceFile[], sort: LibSort): ResourceFile[] {
  const arr = [...list];
  if (sort === 'recent') {
    arr.sort((a, b) => (b.lastReadAt || b.addedAt).localeCompare(a.lastReadAt || a.addedAt));
  } else if (sort === 'deadline') {
    arr.sort((a, b) => {
      if (!a.deadline || !b.deadline) return a.deadline ? -1 : b.deadline ? 1 : 0;
      return a.deadline.localeCompare(b.deadline);
    });
  } else if (sort === 'progress') {
    arr.sort((a, b) => wbFileProgress(b) - wbFileProgress(a));
  } else {
    arr.sort((a, b) => a.title.localeCompare(b.title));
  }
  return arr;
}

/* ---------- folder tree (file-manager rail) ---------- */

function FolderTree() {
  const files = useWB((s) => s.files);
  const folders = useWB((s) => s.libraryFolders);
  const folderFilter = useWB((s) => s.libraryFolderFilter);
  const setFolderFilter = useWB((s) => s.setLibraryFolderFilter);
  const addFolder = useWB((s) => s.addLibraryFolder);
  const renameFolder = useWB((s) => s.renameLibraryFolder);
  const setFolderColor = useWB((s) => s.setLibraryFolderColor);
  const setFolderIcon = useWB((s) => s.setLibraryFolderIcon);
  const deleteFolder = useWB((s) => s.deleteLibraryFolder);
  const moveFolder = useWB((s) => s.moveLibraryFolder);
  const moveFile = useWB((s) => s.moveFileToFolder);
  const confirm = useConfirm();

  const [treeOpen, setTreeOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [createParent, setCreateParent] = useState<string | null>(null); // 'root' | folder id | null
  const [createText, setCreateText] = useState('');
  const [dropId, setDropId] = useState<string | null>(null);
  const [iconPop, setIconPop] = useState<{ id: string; top: number; left: number } | null>(null);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const descendants = useMemo(() => selfAndDescendants(folders), [folders]);

  /* per-folder file counts INCLUDING subfolders (tooltip says so) */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const direct = new Map<string, number>();
    const known = new Set(folders.map((f) => f.id));
    for (const f of files) {
      if (f.folderId && known.has(f.folderId)) direct.set(f.folderId, (direct.get(f.folderId) ?? 0) + 1);
    }
    for (const folder of folders) {
      let n = 0;
      for (const id of descendants.get(folder.id) ?? [folder.id]) n += direct.get(id) ?? 0;
      map.set(folder.id, n);
    }
    return map;
  }, [files, folders, descendants]);

  const unfiledCount = files.filter((f) => !f.folderId).length;

  /* ancestors of the filtered folder are always visible (auto-expand, user can still collapse) */
  const filterPath = useMemo(
    () => (folderFilter === 'all' || folderFilter === 'unfiled' ? [] : folderPathOf(folders, folderFilter)),
    [folders, folderFilter]
  );
  const autoExpandIds = useMemo(() => {
    const s = new Set<string>();
    if (filterPath.length > 1) for (const f of filterPath.slice(0, -1)) s.add(f.id);
    return s;
  }, [filterPath]);

  const isExpanded = (id: string): boolean =>
    (expanded.has(id) || autoExpandIds.has(id)) && !collapsedIds.has(id);

  const forceExpand = (id: string) => {
    setExpanded((prev) => new Set([...prev, id]));
    setCollapsedIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const toggleExpand = (id: string) => {
    const willOpen = !isExpanded(id);
    setExpanded((prev) => {
      if (willOpen === prev.has(id)) return prev;
      const n = new Set(prev);
      if (willOpen) n.add(id);
      else n.delete(id);
      return n;
    });
    setCollapsedIds((prev) => {
      if (!willOpen === prev.has(id)) return prev;
      const n = new Set(prev);
      if (willOpen) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  /* icon picker popover: fixed + viewport-clamped at open time, closes on outside click / Esc */
  useEffect(() => {
    if (!iconPop) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.lib-icon-pop') || t.closest('[data-ico-btn]')) return;
      setIconPop(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIconPop(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [iconPop]);

  const openIconPop = (e: React.MouseEvent, folder: LibraryFolder) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const W = 200;
    const H = 158;
    let left = rect.left;
    if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8);
    let top = rect.bottom + 4;
    if (top + H > window.innerHeight - 8) top = Math.max(8, rect.top - H - 4);
    setIconPop((cur) => (cur?.id === folder.id ? null : { id: folder.id, top, left }));
  };

  const startRename = (folder: LibraryFolder) => {
    setIconPop(null);
    setCreateParent(null);
    setRenameId(folder.id);
    setRenameText(folder.name);
  };

  const commitRename = () => {
    if (!renameId) return;
    const name = renameText.trim();
    if (name) renameFolder(renameId, name);
    setRenameId(null);
  };

  const cycleColor = (folder: LibraryFolder) => {
    const i = FOLDER_SWATCHES.indexOf(folder.color);
    setFolderColor(folder.id, FOLDER_SWATCHES[(i + 1) % FOLDER_SWATCHES.length]);
  };

  const removeFolder = (folder: LibraryFolder) => {
    if (!confirm(`Delete folder "${folder.name}"? Subfolders flatten and files stay in the library.`)) return;
    deleteFolder(folder.id);
    toast('Folder deleted', folder.name);
  };

  const finishCreate = (byKeyboard: boolean) => {
    const name = createText.trim();
    if (!name) {
      if (byKeyboard) toast('Folder name required', 'Give the folder a short name.');
      else {
        setCreateParent(null);
        setCreateText('');
      }
      return;
    }
    const parent = createParent === 'root' ? null : createParent;
    const folder = addFolder(name, parent);
    setCreateText('');
    setCreateParent(null);
    if (parent) forceExpand(parent);
    setFolderFilter(folder.id);
    toast(parent ? 'Subfolder created' : 'Folder created', name);
  };

  /* drag & drop: file cards carry text/plain = file id; folder rows carry their folder id */
  const onRowDragOver = (e: React.DragEvent, id: string) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes('text/plain')) return;
    /* folder drags carry the custom type — folders can't be dropped on "Unfiled" (don't tease it) */
    if (id === 'unfiled' && types.includes('application/x-wb-folder')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropId(id);
  };
  const onRowDragLeave = (id: string) => setDropId((cur) => (cur === id ? null : cur));

  const onRowDragStart = (e: React.DragEvent, folder: LibraryFolder) => {
    if (renameId === folder.id) {
      e.preventDefault();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest('button, input, select, textarea')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', folder.id);
    try {
      e.dataTransfer.setData('application/x-wb-folder', folder.id);
    } catch {
      /* some engines reject custom types — the text/plain payload covers it */
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, rowId: string) => {
    if (!Array.from(e.dataTransfer.types).includes('text/plain')) return;
    e.preventDefault();
    e.stopPropagation();
    setDropId(null);
    const fid = e.dataTransfer.getData('text/plain');
    if (!fid) return;
    const isFile = files.some((f) => f.id === fid);
    const isFolder = !isFile && folders.some((f) => f.id === fid);
    if (isFile) {
      const file = files.find((f) => f.id === fid);
      if (!file) return;
      const folderId = rowId === 'all' || rowId === 'unfiled' ? null : rowId;
      if ((file.folderId ?? null) === folderId) return;
      moveFile(fid, folderId);
      const folder = folderId ? folders.find((x) => x.id === folderId) : undefined;
      toast(folder ? 'Moved to folder' : 'Removed from folder', folder ? folder.name : file.title);
      return;
    }
    if (isFolder) {
      if (rowId === 'unfiled') return; // folders can't be unfiled
      if (rowId !== 'all' && (descendants.get(fid)?.has(rowId) ?? false)) return; // own descendant → silent
      const targetId = rowId === 'all' ? null : rowId;
      if ((folders.find((x) => x.id === fid)?.parentId ?? null) === targetId) return; // same parent → no-op
      const from = folders.find((x) => x.id === fid)?.name ?? 'Folder';
      moveFolder(fid, targetId);
      if (targetId) {
        forceExpand(targetId);
        toast('Folder moved', `${from} → ${folders.find((x) => x.id === targetId)?.name ?? ''}`);
      } else {
        toast('Folder moved to root', from);
      }
    }
  };

  const rowKey = (e: React.KeyboardEvent, fn: () => void) => {
    /* inner controls (caret / dot / actions) handle their own keys */
    if ((e.target as HTMLElement).closest('button, input')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  const renderRow = (node: FolderNode): React.ReactNode => {
    const { folder, children, depth } = node;
    const hasKids = children.length > 0;
    const isOpen = isExpanded(folder.id);
    const Icon = folderIconOf(folder.icon);
    const n = counts.get(folder.id) ?? 0;
    return (
      <React.Fragment key={folder.id}>
        <div
          role="treeitem"
          aria-selected={folderFilter === folder.id}
          aria-level={depth + 1}
          aria-expanded={hasKids ? isOpen : undefined}
          tabIndex={0}
          className={`lib-tree-row ${folderFilter === folder.id ? 'active' : ''} ${
            dropId === folder.id ? 'drop' : ''
          } ${renameId === folder.id ? 'renaming' : ''}`}
          style={{ ['--lib-d' as string]: depth }}
          title={`${n} ${n === 1 ? 'file' : 'files'} (incl. subfolders) · double-click to rename`}
          onClick={() => {
            if (renameId !== folder.id) setFolderFilter(folder.id);
          }}
          onKeyDown={(e) => {
            if (renameId === folder.id) return;
            rowKey(e, () => setFolderFilter(folder.id));
          }}
          onDoubleClick={() => startRename(folder)}
          draggable={renameId !== folder.id}
          onDragStart={(e) => onRowDragStart(e, folder)}
          onDragOver={(e) => onRowDragOver(e, folder.id)}
          onDragLeave={() => onRowDragLeave(folder.id)}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          {hasKids ? (
            <button
              type="button"
              className={`lib-tree-caret ${isOpen ? 'open' : ''}`}
              aria-label={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(folder.id);
              }}
            >
              <ChevronRight size={12} />
            </button>
          ) : (
            <span className="lib-tree-caret spacer" aria-hidden="true" />
          )}
          <Icon size={13} className="lib-tree-ico" aria-hidden="true" />
          <span
            className="lib-tree-dot"
            style={{ backgroundColor: folder.color }}
            role="button"
            tabIndex={0}
            title={`Cycle color (currently ${folder.color})`}
            aria-label={`Change color of folder ${folder.name}`}
            onClick={(e) => {
              e.stopPropagation();
              cycleColor(folder);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                cycleColor(folder);
              }
            }}
          />
          {renameId === folder.id ? (
            <input
              className="lib-folder-input"
              value={renameText}
              autoFocus
              aria-label={`Rename folder ${folder.name}`}
              onChange={(e) => setRenameText(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') setRenameId(null);
              }}
              onBlur={commitRename}
            />
          ) : (
            <span className="lib-tree-name">{folder.name}</span>
          )}
          <span className="lib-folder-count">{n}</span>
          <span className="lib-tree-acts">
            <button
              type="button"
              className="lib-tree-act"
              data-ico-btn
              title={`New subfolder in ${folder.name}`}
              aria-label={`Add subfolder to ${folder.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setRenameId(null);
                setCreateParent(folder.id);
                setCreateText('');
                forceExpand(folder.id);
              }}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              className="lib-tree-act"
              data-ico-btn
              title="Pick icon"
              aria-label={`Pick icon for ${folder.name}`}
              onClick={(e) => {
                e.stopPropagation();
                openIconPop(e, folder);
              }}
            >
              <Palette size={12} />
            </button>
            <button
              type="button"
              className="lib-tree-act danger"
              title={`Delete folder "${folder.name}"`}
              aria-label={`Delete folder ${folder.name}`}
              onClick={(e) => {
                e.stopPropagation();
                removeFolder(folder);
              }}
            >
              <X size={11} />
            </button>
          </span>
        </div>
        {createParent === folder.id && (
          <div className="lib-subrow" style={{ ['--lib-d' as string]: depth + 1 }}>
            <input
              className="lib-folder-input lib-tree-new"
              value={createText}
              autoFocus
              placeholder="Subfolder name…"
              aria-label="New subfolder name"
              onChange={(e) => setCreateText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishCreate(true);
                else if (e.key === 'Escape') {
                  setCreateParent(null);
                  setCreateText('');
                }
              }}
              onBlur={() => finishCreate(false)}
            />
          </div>
        )}
        {isOpen && children.map(renderRow)}
      </React.Fragment>
    );
  };

  return (
    <aside className={`lib-tree ${treeOpen ? '' : 'closed'}`} aria-label="Library folder tree">
      <div className="lib-tree-head">
        <span className="lib-tree-title">
          <ListTree size={13} aria-hidden="true" /> Folders
        </span>
        <button
          type="button"
          className="lib-tree-fold"
          onClick={() => setTreeOpen((v) => !v)}
          aria-expanded={treeOpen}
          aria-label={treeOpen ? 'Collapse folder tree' : 'Expand folder tree'}
          title={treeOpen ? 'Collapse folder tree' : 'Expand folder tree'}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {treeOpen && (
        <div className="lib-tree-body" role="tree" aria-label="Folders">
          <div
            role="treeitem"
            aria-selected={folderFilter === 'all'}
            aria-level={1}
            tabIndex={0}
            className={`lib-tree-row vroot ${folderFilter === 'all' ? 'active' : ''} ${
              dropId === 'all' ? 'drop' : ''
            }`}
            title="All files — drop here to unfile"
            onClick={() => setFolderFilter('all')}
            onKeyDown={(e) => rowKey(e, () => setFolderFilter('all'))}
            onDragOver={(e) => onRowDragOver(e, 'all')}
            onDragLeave={() => onRowDragLeave('all')}
            onDrop={(e) => handleDrop(e, 'all')}
          >
            <span className="lib-tree-caret spacer" aria-hidden="true" />
            <LibraryIco size={13} className="lib-tree-ico" aria-hidden="true" />
            <span className="lib-tree-name">All files</span>
            <span className="lib-folder-count">{files.length}</span>
          </div>
          <div
            role="treeitem"
            aria-selected={folderFilter === 'unfiled'}
            aria-level={1}
            tabIndex={0}
            className={`lib-tree-row vroot ${folderFilter === 'unfiled' ? 'active' : ''} ${
              dropId === 'unfiled' ? 'drop' : ''
            }`}
            title="Files not in any folder — drop a file here to unfile it"
            onClick={() => setFolderFilter('unfiled')}
            onKeyDown={(e) => rowKey(e, () => setFolderFilter('unfiled'))}
            onDragOver={(e) => onRowDragOver(e, 'unfiled')}
            onDragLeave={() => onRowDragLeave('unfiled')}
            onDrop={(e) => handleDrop(e, 'unfiled')}
          >
            <span className="lib-tree-caret spacer" aria-hidden="true" />
            <Inbox size={13} className="lib-tree-ico" aria-hidden="true" />
            <span className="lib-tree-name">Unfiled</span>
            <span className="lib-folder-count">{unfiledCount}</span>
          </div>
          {tree.map(renderRow)}
          {createParent === 'root' ? (
            <div className="lib-subrow" style={{ ['--lib-d' as string]: 0 }}>
              <input
                className="lib-folder-input lib-tree-new"
                value={createText}
                autoFocus
                placeholder="Folder name…"
                aria-label="New folder name"
                onChange={(e) => setCreateText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishCreate(true);
                  else if (e.key === 'Escape') {
                    setCreateParent(null);
                    setCreateText('');
                  }
                }}
                onBlur={() => finishCreate(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              className="lib-newfolder-btn"
              onClick={() => {
                setRenameId(null);
                setIconPop(null);
                setCreateParent('root');
              }}
            >
              <FolderPlus size={13} /> New folder
            </button>
          )}
        </div>
      )}
      {iconPop &&
        createPortal(
          <div
            className="lib-icon-pop"
            style={{ top: iconPop.top, left: iconPop.left }}
            role="dialog"
            aria-label="Pick a folder icon"
          >
            {FOLDER_ICONS.map((key) => {
              const Ico = folderIconOf(key);
              const sel = folders.find((f) => f.id === iconPop.id)?.icon === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`lib-icon-cell ${sel ? 'sel' : ''}`}
                  title={key}
                  aria-label={`Icon: ${key}`}
                  aria-pressed={sel}
                  onClick={() => {
                    setFolderIcon(iconPop.id, key);
                    setIconPop(null);
                  }}
                >
                  <Ico size={15} />
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </aside>
  );
}

/* ---------- file card ---------- */

function FileCard({
  file,
  linkedCount,
  onSelect,
}: {
  file: ResourceFile;
  linkedCount: number;
  onSelect: (file: ResourceFile, shift: boolean) => void;
}) {
  const deleteFile = useWB((s) => s.deleteFile);
  const folders = useWB((s) => s.libraryFolders);
  const moveFileToFolder = useWB((s) => s.moveFileToFolder);
  const setFolderFilter = useWB((s) => s.setLibraryFolderFilter);
  const confirm = useConfirm();
  const [linking, setLinking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { cover, failed } = useCoverWithFallback(file);
  const selecting = useSelectionMode();
  const selected = useIsSelected(file.id);

  const folder = folders.find((f) => f.id === file.folderId) ?? null;
  const folderOpts = useMemo(() => flattenFolderOptions(folders), [folders]);
  const favCount = file.favoritePages?.length ?? 0;
  const annoCount = file.annoPages?.length ?? 0;

  const pct = wbFileProgress(file);
  const readPages = wbFileReadPages(file);
  const minutes = wbFileMinutes(file);
  const st = wbFileDeadlineStatus(file);

  const openReader = () => window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: file.id }));
  const openEdit = () => window.dispatchEvent(new CustomEvent('wb-open-file-form', { detail: file.id }));

  const move = (folderId: string | null) => {
    moveFileToFolder(file.id, folderId);
    const f = folders.find((x) => x.id === folderId);
    toast(f ? 'Moved to folder' : 'Removed from folder', f ? f.name : file.title);
  };

  /* the whole card is a drag source (its file id as text/plain) — but never from form controls */
  const onCardDragStart = (e: React.DragEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, button, a, label')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', file.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  };

  const remove = () => {
    if (!confirm(`Delete "${file.title}"? Its PDF, cover and reading history will be removed.`)) return;
    void purgeFileArtifacts(file.id).catch(() => undefined);
    deleteFile(file.id);
    toast('Deleted from library', file.title);
  };

  let dueChip: React.ReactNode = null;
  if (file.deadline) {
    const du = daysUntil(file.deadline);
    const label =
      pct >= 100 ? 'done'
        : st === 'over' ? `${Math.abs(du)}d overdue`
          : du === 0 ? 'due today'
            : `${du}d left`;
    const cls =
      pct >= 100 ? 'chip-done'
        : st === 'over' ? 'chip-over'
          : st === 'soon' ? 'chip-soon'
            : 'chip-ok';
    dueChip = <span className={`chip ${cls}`}>{label}</span>;
  }

  return (
    <article
      className={`lib-card ${file.archived ? 'archived' : ''} ${linking ? 'linking' : ''} ${
        dragging ? 'dragging' : ''
      } ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      draggable
      onDragStart={onCardDragStart}
      onDragEnd={() => setDragging(false)}
      onClick={
        selecting
          ? (e) => {
              const t = e.target as HTMLElement;
              if (t.closest('button, select, input, textarea, a, label')) return;
              onSelect(file, e.shiftKey);
            }
          : undefined
      }
    >
      <div
        className="lib-cover"
        role="button"
        tabIndex={0}
        aria-label={
          selecting
            ? `Select "${file.title}"`
            : `Open "${file.title}" in the reader`
        }
        onClick={(e) => {
          if (selecting) {
            e.stopPropagation();
            onSelect(file, e.shiftKey);
            return;
          }
          openReader();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (selecting) onSelect(file, e.shiftKey);
            else openReader();
          }
        }}
      >
        {cover ? (
          <img className="lib-cover-img" src={cover} alt="" loading="lazy" />
        ) : failed ? (
          <div className="lib-cover-fallback" aria-hidden="true">
            <FileText />
          </div>
        ) : (
          <div className="lib-cover-skel" aria-hidden="true" />
        )}
        <span className="lib-page-badge mono" title="Current reading position">
          p.{file.currentPage}/{file.pageCount}
        </span>
        {selecting && (
          <button
            type="button"
            className={`lib-check ${selected ? 'on' : ''}`}
            aria-pressed={selected}
            aria-label={selected ? `Deselect ${file.title}` : `Select ${file.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(file, e.shiftKey);
            }}
          >
            {selected && <Check size={13} />}
          </button>
        )}
      </div>

      <div className="lib-body">
        <div
          className="lib-title"
          role="button"
          tabIndex={0}
          title={selecting ? `Select "${file.title}"` : `${file.title} — click to edit`}
          onClick={(e) => {
            if (selecting) {
              e.stopPropagation();
              onSelect(file, e.shiftKey);
              return;
            }
            openEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (selecting) onSelect(file, e.shiftKey);
              else openEdit();
            }
          }}
        >
          {file.title}
        </div>

        <div className="lib-chips">
          {dueChip}
          {file.archived && <span className="chip chip-ok">archived</span>}
          {folder && (
            <button
              type="button"
              className="lib-card-folder"
              title={`In folder "${folder.name}" — click to filter`}
              onClick={() => setFolderFilter(folder.id)}
            >
              <span className="lib-folder-dot-sm" style={{ background: folder.color }} />
              <span className="lib-folder-name">{folder.name}</span>
            </button>
          )}
          {favCount > 0 && (
            <span className="lib-fav-chip" title="favorite pages">
              <Star size={10} /> {favCount}
            </span>
          )}
          {annoCount > 0 && (
            <span className="lib-fav-chip anno" title="annotated pages">
              <PenLine size={10} /> {annoCount}
            </span>
          )}
          {linkedCount > 0 && (
            <span className="lib-tag" title="Linked goals & tasks">
              <Link2 size={10} /> {linkedCount}
            </span>
          )}
        </div>

        <div className="lib-progress" title={`${readPages} of ${file.pageCount} pages read`}>
          <span className="pbar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="mono lib-progress-num">
            {pct}% · {readPages}/{file.pageCount}p
          </span>
        </div>

        <div className="lib-meta">
          <span className="lib-time mono" title="Total time spent in this file">
            <Clock size={11} /> {fmtDuration(minutes)}
          </span>
          {file.tags.slice(0, 3).map((t) => (
            <span key={t} className="lib-tag">
              {t}
            </span>
          ))}
          {file.tags.length > 3 && (
            <span className="lib-tag" title={file.tags.slice(3).join(', ')}>
              +{file.tags.length - 3}
            </span>
          )}
        </div>

        <div className="lib-actions">
          <Btn size="sm" variant="primary" onClick={openReader}>
            <BookOpen size={13} /> Read
          </Btn>
          <Btn size="sm" variant="ghost" onClick={openEdit}>
            <Pencil size={13} /> Edit
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setLinking((v) => !v)} aria-expanded={linking}>
            <Link2 size={13} /> Link
          </Btn>
          <Btn size="sm" variant="danger" onClick={remove}>
            <Trash2 size={13} /> Delete
          </Btn>
          <label className="lib-move" title="Move to folder">
            <FolderInput size={12} />
            <select
              className="lib-move-select"
              aria-label={`Move "${file.title}" to folder`}
              value={file.folderId ?? ''}
              onChange={(e) => move(e.target.value || null)}
            >
              <option value="">No folder</option>
              {folderOpts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {linking && <LinkPicker file={file} onDone={() => setLinking(false)} />}
      </div>
    </article>
  );
}

/* ---------- inline linker (goals & tasks ↔ file) ---------- */

function LinkPicker({ file, onDone }: { file: ResourceFile; onDone: () => void }) {
  const items = useWB((s) => s.items);
  const toggleItemFile = useWB((s) => s.toggleItemFile);
  const [q, setQ] = useState('');

  const linkedIds = new Set(wbItemsForFile(items, file.id).map((i) => i.id));
  const query = q.trim().toLowerCase();
  const candidates = items
    .filter((i) => i.status !== 'archived' && (!query || i.title.toLowerCase().includes(query)))
    .sort((a, b) => {
      const la = linkedIds.has(a.id) ? 0 : 1;
      const lb = linkedIds.has(b.id) ? 0 : 1;
      return la - lb || a.title.localeCompare(b.title);
    })
    .slice(0, 60);

  return (
    <div className="lib-linkpicker">
      <div className="lib-link-head">
        <Search size={13} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Link to a goal or task…"
          aria-label="Search goals and tasks to link"
        />
        <IconBtn small title="Close linker" onClick={onDone}>
          <X size={13} />
        </IconBtn>
      </div>
      <div className="lib-link-list">
        {candidates.map((i) => {
          const isLinked = linkedIds.has(i.id);
          return (
            <button
              key={i.id}
              type="button"
              className={`lib-link-row ${isLinked ? 'linked' : ''}`}
              aria-pressed={isLinked}
              onClick={() => {
                toggleItemFile(i.id, file.id);
                toast(isLinked ? 'Unlinked from item' : 'Linked to item', i.title);
              }}
            >
              <span className="lib-link-check">{isLinked && <Check size={12} />}</span>
              <span className="lib-link-title">{i.title}</span>
              <span className="lib-link-type">{i.type}</span>
            </button>
          );
        })}
        {!candidates.length && <div className="lib-link-empty">No matching goals or tasks.</div>}
      </div>
    </div>
  );
}

/* ---------- bulk action bar (selection mode) ---------- */

function BulkBar({ visible }: { visible: ResourceFile[] }) {
  const mode = useSelectionMode();
  const ids = useSelectedIds();
  const files = useWB((s) => s.files);
  const folders = useWB((s) => s.libraryFolders);
  const confirm = useConfirm();

  const fileIds = useMemo(() => new Set(files.map((f) => f.id)), [files]);
  const liveIds = useMemo(() => {
    const out: string[] = [];
    ids.forEach((id) => {
      if (fileIds.has(id)) out.push(id);
    });
    return out;
  }, [ids, fileIds]);

  const flatFolders = useMemo(() => flattenFolderOptions(folders), [folders]);

  if (!mode) return null;

  const count = liveIds.length;
  const allSelected = visible.length > 0 && visible.every((f) => ids.has(f.id));

  const selectAllOrNone = () => {
    if (allSelected) {
      clearSelection();
      return;
    }
    selectMany(visible.map((f) => f.id), 'replace');
  };

  const bulkMove = (folderId: string | null) => {
    const st = useWB.getState();
    const targets = st.files.filter((f) => ids.has(f.id) && (f.folderId ?? null) !== folderId);
    if (!targets.length) {
      toast('Nothing to move', 'The selected files are already there.');
      return;
    }
    st.snapshot();
    for (const f of targets) st.moveFileToFolder(f.id, folderId);
    const name = folderId ? st.libraryFolders.find((x) => x.id === folderId)?.name ?? 'folder' : 'no folder';
    toast(`Moved ${targets.length} ${targets.length === 1 ? 'file' : 'files'}`, `Into ${name}`);
  };

  const bulkArchive = (archived: boolean) => {
    const st = useWB.getState();
    const targets = st.files.filter((f) => ids.has(f.id) && f.archived !== archived);
    if (!targets.length) {
      toast(
        archived ? 'Nothing to archive' : 'Nothing to unarchive',
        archived ? 'The selected files are already archived.' : 'The selected files are not archived.'
      );
      return;
    }
    st.snapshot();
    for (const f of targets) st.updateFile(f.id, { archived });
    toast(
      `${archived ? 'Archived' : 'Unarchived'} ${targets.length} ${targets.length === 1 ? 'file' : 'files'}`
    );
  };

  const bulkDelete = () => {
    if (!count) return;
    if (!confirm(`Delete ${count} file${count === 1 ? '' : 's'}? Their PDFs, covers and reading history will be removed.`)) return;
    void (async () => {
      const st = useWB.getState();
      const victims = [...liveIds];
      await Promise.allSettled(victims.map((id) => purgeFileArtifacts(id)));
      for (const id of victims) st.deleteFile(id);
      clearSelection();
      toast(`Deleted ${victims.length} ${victims.length === 1 ? 'file' : 'files'}`);
    })();
  };

  return (
    <div className="lib-bulk" role="toolbar" aria-label="Bulk actions for selected files">
      <span className="lib-bulk-count">
        <CheckSquare size={13} aria-hidden="true" />
        <span className="mono">{count}</span> selected
      </span>
      <Btn size="sm" variant="ghost" onClick={selectAllOrNone} disabled={!visible.length}>
        {allSelected ? <X size={13} /> : <CheckSquare size={13} />} {allSelected ? 'None' : 'All'}
      </Btn>
      <label className="lib-bulk-move" title="Move the selected files to a folder">
        <FolderInput size={12} aria-hidden="true" />
        <select
          value=""
          disabled={!count}
          aria-label="Move selected files to folder"
          onChange={(e) => {
            const v = e.currentTarget.value;
            e.currentTarget.value = '';
            if (v) bulkMove(v === '__none' ? null : v);
          }}
        >
          <option value="" disabled>
            Move to…
          </option>
          <option value="__none">No folder</option>
          {flatFolders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <Btn size="sm" variant="ghost" onClick={() => bulkArchive(true)} disabled={!count}>
        <Archive size={13} /> Archive
      </Btn>
      <Btn size="sm" variant="ghost" onClick={() => bulkArchive(false)} disabled={!count}>
        <ArchiveRestore size={13} /> Unarchive
      </Btn>
      <Btn size="sm" variant="danger" onClick={bulkDelete} disabled={!count}>
        <Trash2 size={13} /> Delete
      </Btn>
      <Btn size="sm" variant="ghost" onClick={clearSelection} disabled={!count}>
        Clear
      </Btn>
      <Btn size="sm" onClick={() => setSelectionMode(false)} title="Exit selection mode">
        <X size={13} /> Exit
      </Btn>
    </div>
  );
}

/* ---------- main view ---------- */

export function LibraryView() {
  const files = useWB((s) => s.files);
  const items = useWB((s) => s.items);
  const sessions = useWB((s) => s.readingSessions);
  const filter = useWB((s) => s.libraryFilter);
  const setFilter = useWB((s) => s.setLibraryFilter);
  const folders = useWB((s) => s.libraryFolders);
  const folderFilter = useWB((s) => s.libraryFolderFilter);
  const setFolderFilter = useWB((s) => s.setLibraryFolderFilter);
  const search = useWB((s) => s.librarySearch);
  const setSearch = useWB((s) => s.setLibrarySearch);
  const [sort, setSort] = useState<LibSort>('recent');
  const [dragOver, setDragOver] = useState(false);
  const { open, input } = usePdfPicker((fs) => void importPdfFiles(fs));
  const { open: openFolder, input: folderInput } = useFolderPicker((fs) => void importPdfFolder(fs));
  const anchorRef = useRef<string | null>(null);

  /* week window (Monday-based) */
  const weekFrom = startOfWeekStr();
  const today = todayStr();
  const weekSessions = useMemo(
    () => sessions.filter((r) => r.date >= weekFrom && r.date <= today),
    [sessions, weekFrom, today]
  );
  const minutesWeek = wbReadingMinutesInRange(sessions, weekFrom, today);
  const pagesWeek = wbReadingPagesInRange(sessions, weekFrom, today);
  const visitedWeek = weekSessions.reduce((s, r) => s + r.pagesVisited, 0);

  /* shelf aggregates */
  const totalPages = files.reduce((s, f) => s + f.pageCount, 0);
  const totalSeconds = files.reduce((s, f) => s + wbFileSeconds(f), 0);
  const visitedPagesAll = files.reduce(
    (s, f) => s + Object.values(f.pageSeconds || {}).filter((v) => v > 0).length,
    0
  );
  const filesWithTime = files.filter((f) => wbFileSeconds(f) > 0).length;
  const avgSec = visitedPagesAll ? Math.round(totalSeconds / visitedPagesAll) : 0;

  const query = search.trim();
  const q = query.toLowerCase();
  const visible = useMemo(
    () =>
      sortFiles(
        files.filter((f) => matchesFilter(f, filter) && matchesFolder(f, folderFilter) && matchesSearch(f, q)),
        sort
      ),
    [files, filter, folderFilter, q, sort]
  );

  /* selection: plain click toggles · shift-click selects the range on the visible list */
  const handleCardSelect = useCallback(
    (file: ResourceFile, shift: boolean) => {
      if (shift && anchorRef.current) {
        const a = visible.findIndex((f) => f.id === anchorRef.current);
        const b = visible.findIndex((f) => f.id === file.id);
        if (a >= 0 && b >= 0) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          selectMany(visible.slice(lo, hi + 1).map((f) => f.id), 'replace');
          return;
        }
      }
      toggleSelected(file.id);
      anchorRef.current = file.id;
    },
    [visible]
  );

  /* drag & drop of PDFs onto the shelf */
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const pdfs = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    );
    if (pdfs.length) void importPdfFiles(pdfs);
    else toast('PDFs only', 'Drop PDF files to add them to the library.');
  };

  /* the full file-manager shell always renders (tree + stats + toolbar) — an empty shelf
     shows the onboarding empty state in the grid column, folders stay manageable */

  const filterLabel = FILTER_OPTIONS.find((o) => o.id === filter)?.label ?? 'this filter';
  const crumbs =
    folderFilter !== 'all' && folderFilter !== 'unfiled' ? folderPathOf(folders, folderFilter) : [];

  return (
    <div className="fade-in">
      <div className="lib-shell">
        <FolderTree />

        <div className="lib-main">
          <div className="grid-cards">
            <div className="stat-card">
              <div className="stat-label">Files</div>
              <div className="stat-value">{files.length}</div>
              <div className="stat-note">
                {totalPages.toLocaleString()} pages on the shelf
                {folders.length > 0 ? ` · ${folders.length} folder${folders.length === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Reading this week</div>
              <div className="stat-value">{fmtDuration(minutesWeek)}</div>
              <div className="stat-note">{pagesWeek} pages</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pages read this week</div>
              <div className="stat-value">{pagesWeek}</div>
              <div className="stat-note">{visitedWeek} visited</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg / visited page</div>
              <div className="stat-value">{visitedPagesAll ? `${avgSec}s` : '—'}</div>
              <div className="stat-note">
                weighted across {filesWithTime} file{filesWithTime === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="lib-toolbar">
            {q ? (
              <>
                <span className="lib-count">
                  {visible.length} {visible.length === 1 ? 'result' : 'results'} for “{query}”
                </span>
                <IconBtn small title="Clear search" onClick={() => setSearch('')}>
                  <X size={13} />
                </IconBtn>
              </>
            ) : (
              <span className="lib-count">
                {visible.length} {visible.length === 1 ? 'file' : 'files'}
                {filter !== 'all' || folderFilter !== 'all' ? ` of ${files.length}` : ''}
              </span>
            )}
            <label className="lib-sort">
              <span>Sort</span>
              <select
                value={sort}
                aria-label="Sort files"
                onChange={(e) => setSort(e.target.value as LibSort)}
              >
                <option value="recent">Recent</option>
                <option value="deadline">Deadline</option>
                <option value="progress">Progress</option>
                <option value="title">Title</option>
              </select>
            </label>
          </div>

          {(folders.length > 0 || folderFilter !== 'all') && (
            <nav className="lib-crumbs" aria-label="Current folder path">
              <button
                type="button"
                className={`lib-crumb ${folderFilter === 'all' ? 'cur' : ''}`}
                title="All files"
                onClick={() => setFolderFilter('all')}
              >
                <LibraryIco size={12} aria-hidden="true" /> Library
              </button>
              {folderFilter === 'unfiled' ? (
                <>
                  <span className="lib-crumb-sep" aria-hidden="true">/</span>
                  <button
                    type="button"
                    className="lib-crumb cur"
                    onClick={() => setFolderFilter('unfiled')}
                  >
                    <Inbox size={12} aria-hidden="true" /> Unfiled
                  </button>
                </>
              ) : (
                crumbs.map((f, i) => (
                  <React.Fragment key={f.id}>
                    <span className="lib-crumb-sep" aria-hidden="true">/</span>
                    <button
                      type="button"
                      className={`lib-crumb ${i === crumbs.length - 1 ? 'cur' : ''}`}
                      title={`Filter to "${f.name}"`}
                      onClick={() => setFolderFilter(f.id)}
                    >
                      {f.name}
                    </button>
                  </React.Fragment>
                ))
              )}
              {folderFilter !== 'unfiled' && (
                <button
                  type="button"
                  className={`lib-crumb-unfiled ${folderFilter === 'unfiled' ? 'cur' : ''}`}
                  title="Files not in any folder"
                  onClick={() => setFolderFilter('unfiled')}
                >
                  <Inbox size={12} aria-hidden="true" /> Unfiled
                </button>
              )}
            </nav>
          )}

          <div
            className={`lib-dropwrap ${dragOver ? 'drop' : ''}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {visible.length ? (
              <div className="lib-grid">
                {visible.map((f) => (
                  <FileCard
                    key={f.id}
                    file={f}
                    linkedCount={wbItemsForFile(items, f.id).length}
                    onSelect={handleCardSelect}
                  />
                ))}
              </div>
            ) : q ? (
              <div className="empty-state">
                <div className="es-title">No files match “{query}”</div>
                Try a different search, or clear it to browse the whole shelf.
                <div style={{ marginTop: 12 }}>
                  <Btn size="sm" onClick={() => setSearch('')}>Clear search</Btn>
                </div>
              </div>
            ) : !files.length ? (
              <div className="empty-state">
                <div className="es-title">No PDFs yet</div>
                Add PDFs to your shelf — covers are rendered automatically, deadlines count down on
                every card, and time spent on each page is tracked while you read. Organize
                everything into a folder tree, or import a whole folder from your system.
                <div className="lib-empty-actions">
                  <Btn variant="primary" onClick={open}>
                    <Upload size={15} /> Add PDF
                  </Btn>
                  <Btn onClick={openFolder}>
                    <FolderPlus size={15} /> Import folder
                  </Btn>
                </div>
                <div className="lib-drop-hint">
                  …or drag &amp; drop PDF files straight onto the shelf
                </div>
              </div>
            ) : folderFilter !== 'all' ? (
              <div className="empty-state">
                <div className="es-title">
                  {folderFilter === 'unfiled' ? 'No unfiled files' : 'This folder is empty'}
                </div>
                {folderFilter === 'unfiled'
                  ? 'Every file on the shelf lives in a folder.'
                  : 'Drag a file card onto a folder in the tree, use Move on a card, or select several files and move them at once.'}
                <div style={{ marginTop: 12 }}>
                  <Btn size="sm" onClick={() => setFolderFilter('all')}>Show all files</Btn>
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="es-title">Nothing in “{filterLabel}”</div>
                No files match this filter yet.
                <div style={{ marginTop: 12 }}>
                  <Btn size="sm" onClick={() => setFilter('all')}>
                    Show all files
                  </Btn>
                </div>
              </div>
            )}
            {input}
            {folderInput}
          </div>
        </div>
      </div>

      <BulkBar visible={visible} />
    </div>
  );
}

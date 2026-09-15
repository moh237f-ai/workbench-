/* ==================== Library View: PDF shelf — covers, deadlines, reading stats ==================== */
'use client';

import './library.css';

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  BookOpen, Check, Clock, FileText, Link2, Pencil, Search, Trash2, Upload, X,
} from 'lucide-react';
import {
  useWB, wbFileDeadlineStatus, wbFileMinutes, wbFileProgress, wbFileReadPages, wbFileSeconds,
  wbItemsForFile, wbReadingMinutesInRange, wbReadingPagesInRange,
} from '@/lib/workbench/store';
import { daysUntil, fmtDuration, startOfWeekStr, todayStr, uid } from '@/lib/workbench/helpers';
import type { ResourceFile } from '@/lib/workbench/types';
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

/* ---------- shared import pipeline (module level: header button + drop zone + empty state) ---------- */

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

/** Upload pipeline: store blob → render cover → register file. Artifacts purged on failure. */
async function importPdfFiles(list: File[]): Promise<void> {
  bumpImporting(list.length);
  for (const file of list) {
    const id = uid();
    try {
      await putBlob(id, file);
      const doc = await loadDocFromBlob(file);
      const cover = await pageToDataUrl(doc, 1, 420, 0.72);
      await saveCover(id, cover);
      const title = file.name.replace(/\.pdf$/i, '');
      useWB.getState().addFile({
        id,
        title,
        fileName: file.name,
        size: file.size,
        pageCount: doc.numPages,
      });
      toast('Added to library', title);
    } catch {
      await purgeFileArtifacts(id).catch(() => undefined);
      toast('Import failed', file.name);
    } finally {
      bumpImporting(-1);
    }
  }
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

/* ---------- header actions ---------- */

export function LibraryHeaderActions() {
  const filter = useWB((s) => s.libraryFilter);
  const setFilter = useWB((s) => s.setLibraryFilter);
  const importing = useImportingCount();
  const { open, input } = usePdfPicker((fs) => void importPdfFiles(fs));

  return (
    <>
      {input}
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

/* ---------- file card ---------- */

function FileCard({ file, linkedCount }: { file: ResourceFile; linkedCount: number }) {
  const deleteFile = useWB((s) => s.deleteFile);
  const confirm = useConfirm();
  const [linking, setLinking] = useState(false);
  const { cover, failed } = useCoverWithFallback(file);

  const pct = wbFileProgress(file);
  const readPages = wbFileReadPages(file);
  const minutes = wbFileMinutes(file);
  const st = wbFileDeadlineStatus(file);

  const openReader = () => window.dispatchEvent(new CustomEvent('wb-open-reader', { detail: file.id }));
  const openEdit = () => window.dispatchEvent(new CustomEvent('wb-open-file-form', { detail: file.id }));

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
    <article className={`lib-card ${file.archived ? 'archived' : ''} ${linking ? 'linking' : ''}`}>
      <div
        className="lib-cover"
        role="button"
        tabIndex={0}
        aria-label={`Open "${file.title}" in the reader`}
        onClick={openReader}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openReader();
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
      </div>

      <div className="lib-body">
        <div
          className="lib-title"
          role="button"
          tabIndex={0}
          title={`${file.title} — click to edit`}
          onClick={openEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openEdit();
            }
          }}
        >
          {file.title}
        </div>

        <div className="lib-chips">
          {dueChip}
          {file.archived && <span className="chip chip-ok">archived</span>}
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

/* ---------- main view ---------- */

export function LibraryView() {
  const files = useWB((s) => s.files);
  const items = useWB((s) => s.items);
  const sessions = useWB((s) => s.readingSessions);
  const filter = useWB((s) => s.libraryFilter);
  const setFilter = useWB((s) => s.setLibraryFilter);
  const [sort, setSort] = useState<LibSort>('recent');
  const [dragOver, setDragOver] = useState(false);
  const { open, input } = usePdfPicker((fs) => void importPdfFiles(fs));

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

  const visible = useMemo(
    () => sortFiles(files.filter((f) => matchesFilter(f, filter)), sort),
    [files, filter, sort]
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

  if (!files.length) {
    return (
      <div className="fade-in">
        <div
          className={`lib-dropwrap ${dragOver ? 'drop' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="empty-state">
            <div className="es-title">No PDFs yet</div>
            Add PDFs to your shelf — covers are rendered automatically, deadlines count down on every
            card, and time spent on each page is tracked while you read.
            <div style={{ marginTop: 12 }}>
              <Btn variant="primary" onClick={open}>
                <Upload size={15} /> Add PDF
              </Btn>
            </div>
            <div className="lib-drop-hint">…or drag &amp; drop PDF files onto the shelf</div>
          </div>
        </div>
        {input}
      </div>
    );
  }

  const filterLabel = FILTER_OPTIONS.find((o) => o.id === filter)?.label ?? 'this filter';

  return (
    <div className="fade-in">
      <div className="grid-cards">
        <div className="stat-card">
          <div className="stat-label">Files</div>
          <div className="stat-value">{files.length}</div>
          <div className="stat-note">{totalPages.toLocaleString()} pages on the shelf</div>
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
        <span className="lib-count">
          {visible.length} {visible.length === 1 ? 'file' : 'files'}
          {filter !== 'all' ? ` of ${files.length}` : ''}
        </span>
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

      <div
        className={`lib-dropwrap ${dragOver ? 'drop' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {visible.length ? (
          <div className="lib-grid">
            {visible.map((f) => (
              <FileCard key={f.id} file={f} linkedCount={wbItemsForFile(items, f.id).length} />
            ))}
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
      </div>
    </div>
  );
}

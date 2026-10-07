/* ==================== File Form Modal: edit a library PDF (cover, meta, insights) ==================== */
'use client';

import './library.css';

import { useMemo, useRef, useState } from 'react';
import { FileText, ImagePlus, PenLine, RefreshCw, Star, Trash2 } from 'lucide-react';
import { useWB, wbFileAvgSecPerPage, wbFileMinutes } from '@/lib/workbench/store';
import { fmtDuration, parseDate } from '@/lib/workbench/helpers';
import { SWATCHES, type FileCoverMode, type LibraryFolder } from '@/lib/workbench/types';
import { purgeFileArtifacts, saveCover } from '@/lib/workbench/idb';
import { loadFileDoc, pageToDataUrl } from '@/lib/workbench/pdf';
import { applyCustomCover, refreshCover, useFileCover } from '@/lib/workbench/covers';
import { Btn, Modal, Seg, toast, useConfirm } from '../ui/primitives';
import { DateField } from '../ui/DateField';

/* seconds → "Xs" / "Xm Ys" (tooltip format) */
function fmtPageSecs(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* 0s → surface-alt · 1–14s → pine tint scaled up · ≥15s → solid pine */
function pmapCellBackground(sec: number): string {
  if (sec >= 15) return 'var(--pine)';
  if (sec <= 0) return 'var(--surface-alt)';
  const mix = Math.round(18 + (Math.min(sec, 14) / 14) * 62);
  return `color-mix(in srgb, var(--pine) ${mix}%, transparent)`;
}

/** Folder options in tree order (pre-order walk) — "— " per level so a flat <select> reads like the tree. */
function folderOptions(folders: LibraryFolder[]): { id: string; label: string }[] {
  const known = new Set(folders.map((f) => f.id));
  const kidsOf = new Map<string | null, LibraryFolder[]>();
  for (const f of folders) {
    const key = f.parentId && known.has(f.parentId) ? f.parentId : null; // orphans → root
    const arr = kidsOf.get(key);
    if (arr) arr.push(f);
    else kidsOf.set(key, [f]);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const f of kidsOf.get(parent) ?? []) {
      out.push({ id: f.id, label: `${'— '.repeat(Math.min(depth, 6))}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function FileFormModal({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const file = useWB((s) => s.files.find((f) => f.id === fileId));
  const sessions = useWB((s) => s.readingSessions);
  const folders = useWB((s) => s.libraryFolders);
  const updateFile = useWB((s) => s.updateFile);
  const deleteFile = useWB((s) => s.deleteFile);
  const moveFileToFolder = useWB((s) => s.moveFileToFolder);
  const confirm = useConfirm();
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  /* hooks first (file may be undefined — useFileCover accepts that) */
  const cover = useFileCover(file);
  const [title, setTitle] = useState(file?.title ?? '');
  const [deadline, setDeadline] = useState(file?.deadline ?? '');
  const [tagsText, setTagsText] = useState((file?.tags ?? []).join(', '));
  const [notes, setNotes] = useState(file?.notes ?? '');
  const [color, setColor] = useState<string | null>(file?.color ?? null);
  const [coverPageText, setCoverPageText] = useState(String(file?.coverPage ?? 1));
  const [redrawing, setRedrawing] = useState(false);

  const fileSessions = useMemo(
    () =>
      sessions
        .filter((r) => r.fileId === fileId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 5),
    [sessions, fileId]
  );
  const folderOpts = useMemo(() => folderOptions(folders), [folders]);

  if (!file) return null;

  /* cover controls (applied live) */
  const applyCoverPage = (raw: string) => {
    setCoverPageText(raw);
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= file.pageCount) {
      updateFile(file.id, { coverPage: n, coverMode: 'page' });
      refreshCover(file.id);
    }
  };

  /* regenerate the page cover with the CURRENT renderer — fixes thumbnails
     rendered by older builds (e.g. before the pdf.js font/cmap fixes) */
  const redrawCover = async () => {
    if (!file) return;
    setRedrawing(true);
    try {
      const doc = await loadFileDoc(file.id);
      const cover = await pageToDataUrl(doc, file.coverPage ?? 1, 420, 0.72);
      await saveCover(file.id, cover);
      refreshCover(file.id);
      toast('Cover redrawn', `Page ${file.coverPage ?? 1} re-rendered.`);
    } catch {
      toast('Could not redraw the cover');
    } finally {
      setRedrawing(false);
    }
  };

  const onCoverImagePick = (img: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      void applyCustomCover(file.id, reader.result);
      updateFile(file.id, { coverMode: 'custom' });
      toast('Custom cover applied');
    };
    reader.onerror = () => toast('Could not read image', 'Try a different file.');
    reader.readAsDataURL(img);
  };

  /* meta (applied on save) */
  const save = () => {
    const t = title.trim();
    if (!t) {
      toast('Title is required', 'Give the file a name so it is easy to find.');
      return;
    }
    updateFile(file.id, {
      title: t,
      deadline: deadline || null,
      tags: Array.from(new Set(tagsText.split(',').map((x) => x.trim()).filter(Boolean))),
      notes: notes.trim(),
      color,
    });
    toast('File updated', t);
    onClose();
  };

  const remove = () => {
    if (!confirm(`Delete "${file.title}"? Its PDF, cover and reading history will be removed.`)) return;
    void (async () => {
      await purgeFileArtifacts(file.id).catch(() => undefined);
      deleteFile(file.id);
      toast('Deleted from library', file.title);
      onClose();
    })();
  };

  /* insights */
  const totalMinutes = wbFileMinutes(file);
  const avgSec = wbFileAvgSecPerPage(file);
  const sessionCount = sessions.filter((r) => r.fileId === file.id).length;

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit file"
      wide
      footer={
        <>
          <Btn variant="danger" onClick={remove}>
            <Trash2 size={15} /> Delete
          </Btn>
          <span className="spacer" />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>
            Save
          </Btn>
        </>
      }
    >
      <div className="lib-file-name" title={file.fileName}>
        {file.kind === 'md'
          ? `${file.fileName} · markdown${file.size ? ` · ${(file.size / 1024).toFixed(1)} kB` : ''}`
          : `${file.fileName} · ${file.pageCount} pages · p.${file.currentPage}`}
      </div>

      <div className="lib-form-grid">
        {/* left: cover */}
        <div>
          <div className="lib-cover-preview">
            {cover ? (
              <img src={cover} alt="Cover preview" />
            ) : (
              <div className="lib-cover-fallback" aria-hidden="true">
                <FileText />
              </div>
            )}
          </div>
          <div className="lib-cover-controls">
            {file.kind !== 'md' && (
            <Seg<FileCoverMode>
              value={file.coverMode}
              onChange={(m) => updateFile(file.id, { coverMode: m })}
              options={[
                { id: 'page', label: 'Page' },
                { id: 'custom', label: 'Custom' },
              ]}
            />
            )}
            {file.kind !== 'md' && (file.coverMode === 'page' ? (
              <div className="field">
                <label htmlFor="ff-coverpage">Cover page (1–{file.pageCount})</label>
                <input
                  id="ff-coverpage"
                  type="number"
                  min={1}
                  max={file.pageCount}
                  step={1}
                  value={coverPageText}
                  onChange={(e) => applyCoverPage(e.target.value)}
                  onBlur={() => setCoverPageText(String(file.coverPage))}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Btn size="sm" onClick={() => void redrawCover()} disabled={redrawing}>
                    <RefreshCw size={13} /> {redrawing ? 'Redrawing…' : 'Redraw cover'}
                  </Btn>
                  <span className="field-help" style={{ margin: 0 }}>
                    Re-renders this thumbnail if it looks wrong.
                  </span>
                </div>
              </div>
            ) : (
              <>
                <Btn size="sm" onClick={() => coverInputRef.current?.click()}>
                  <ImagePlus size={14} /> Upload image
                </Btn>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const el = e.currentTarget;
                    const img = el.files && el.files[0];
                    el.value = '';
                    if (img) onCoverImagePick(img);
                  }}
                />
                <div className="field-help">JPG or PNG — stored locally as this file&apos;s cover.</div>
              </>
            ))}
            {file.kind === 'md' && (
              <div className="field-help">Markdown covers are generated from the note&apos;s title.</div>
            )}
          </div>
        </div>

        {/* right: meta */}
        <div>
          <div className="field">
            <label htmlFor="ff-title">Title</label>
            <input
              id="ff-title"
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
          </div>
          <DateField
            id="ff-deadline"
            label="Deadline"
            value={deadline}
            onChange={setDeadline}
          />
          <div className="field">
            <label htmlFor="ff-folder">Folder</label>
            <select
              id="ff-folder"
              value={file.folderId ?? ''}
              onChange={(e) => {
                const v = e.target.value || null;
                moveFileToFolder(file.id, v);
                const f = folders.find((x) => x.id === v);
                toast(f ? 'Moved to folder' : 'Removed from folder', f ? f.name : file.title);
              }}
            >
              <option value="">No folder</option>
              {folderOpts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <div className="field-help">Applied immediately — mirrors the shelf folder chips.</div>
          </div>
          <div className="field">
            <label htmlFor="ff-tags">Tags</label>
            <input
              id="ff-tags"
              type="text"
              value={tagsText}
              placeholder="research, thesis, design"
              onChange={(e) => setTagsText(e.target.value)}
            />
            <div className="field-help">Comma-separated.</div>
          </div>
          <div className="field">
            <label htmlFor="ff-notes">Notes</label>
            <textarea
              id="ff-notes"
              value={notes}
              placeholder="Why this file matters, key chapters, where you left off…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Color</label>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <div
                  key={c}
                  className={`swatch ${color === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(color === c ? null : c)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setColor(color === c ? null : c);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* reading insights */}
      <div className="lib-insights-grid">
        <div className="lib-insight">
          <div className="lib-insight-label">Total time</div>
          <div className="lib-insight-value">{fmtDuration(totalMinutes)}</div>
        </div>
        <div className="lib-insight">
          <div className="lib-insight-label">Avg / page</div>
          <div className="lib-insight-value">{avgSec ? `${avgSec}s` : '—'}</div>
        </div>
        <div className="lib-insight">
          <div className="lib-insight-label">Sessions</div>
          <div className="lib-insight-value">{sessionCount}</div>
        </div>
        <div className="lib-insight">
          <div className="lib-insight-label">Current page</div>
          <div className="lib-insight-value">p.{file.currentPage}</div>
        </div>
        {(file.favoritePages?.length ?? 0) > 0 && (
          <div className="lib-insight">
            <div className="lib-insight-label">
              <Star size={10} aria-hidden="true" /> Favorites
            </div>
            <div className="lib-insight-value">{file.favoritePages.length}</div>
          </div>
        )}
        {(file.annoPages?.length ?? 0) > 0 && (
          <div className="lib-insight">
            <div className="lib-insight-label">
              <PenLine size={10} aria-hidden="true" /> Annotated
            </div>
            <div className="lib-insight-value">{file.annoPages.length}</div>
          </div>
        )}
      </div>

      {/* page time map (PDF only) */}
      {file.kind !== 'md' && (
      <>
      <div className="section-title">Page time map</div>
      <div
        className="lib-pmap"
        role="img"
        aria-label={`Time spent per page across ${file.pageCount} pages`}
      >
        {Array.from({ length: file.pageCount }, (_, i) => i + 1).map((p) => {
          const sec = file.pageSeconds[String(p)] || 0;
          const manual = file.readPages.includes(String(p));
          return (
            <span
              key={p}
              className={`lib-pmap-cell ${manual ? 'manual' : ''}`}
              style={{ background: pmapCellBackground(sec) }}
              title={`Page ${p} · ${fmtPageSecs(sec)}`}
            />
          );
        })}
      </div>
      <div className="lib-pmap-legend" aria-hidden="true">
        <span className="lib-pmap-cell" style={{ background: pmapCellBackground(0) }} />
        <span className="lib-pmap-cell" style={{ background: pmapCellBackground(5) }} />
        <span className="lib-pmap-cell" style={{ background: pmapCellBackground(10) }} />
        <span className="lib-pmap-cell" style={{ background: pmapCellBackground(15) }} />
        <span className="lib-pmap-legend-label">time per page (15s+ counts as read)</span>
        <span className="lib-pmap-cell manual" style={{ background: pmapCellBackground(0) }} />
        <span className="lib-pmap-legend-label">manually marked read</span>
      </div>
      </>
      )}

      {/* recent sessions */}
      <div className="section-title">Recent sessions</div>
      <div className="lib-sessions">
        {fileSessions.length ? (
          fileSessions.map((r) => (
            <div key={r.id} className="lib-session-row">
              <span className="lib-session-date">
                {parseDate(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <span className="lib-dot">·</span>
              <span className="mono">{fmtDuration(r.minutes)}</span>
              <span className="lib-dot">·</span>
              <span>
                {r.pagesRead} {r.pagesRead === 1 ? 'page' : 'pages'}
              </span>
              <span className="lib-dot">·</span>
              <span className="mono">
                p.{r.startPage}
                {r.endPage !== r.startPage ? `→${r.endPage}` : ''}
              </span>
            </div>
          ))
        ) : (
          <div className="lib-session-empty">
            No reading sessions yet — open the reader to start tracking.
          </div>
        )}
      </div>
    </Modal>
  );
}

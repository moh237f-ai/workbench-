/* ==================== File Form Modal: edit a library PDF (cover, meta, insights) ==================== */
'use client';

import './library.css';

import { useMemo, useRef, useState } from 'react';
import { FileText, ImagePlus, Trash2 } from 'lucide-react';
import { useWB, wbFileAvgSecPerPage, wbFileMinutes } from '@/lib/workbench/store';
import { fmtDuration, parseDate } from '@/lib/workbench/helpers';
import { SWATCHES, type FileCoverMode } from '@/lib/workbench/types';
import { purgeFileArtifacts } from '@/lib/workbench/idb';
import { applyCustomCover, refreshCover, useFileCover } from '@/lib/workbench/covers';
import { Btn, Modal, Seg, toast, useConfirm } from '../ui/primitives';

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

export function FileFormModal({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const file = useWB((s) => s.files.find((f) => f.id === fileId));
  const sessions = useWB((s) => s.readingSessions);
  const updateFile = useWB((s) => s.updateFile);
  const deleteFile = useWB((s) => s.deleteFile);
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

  const fileSessions = useMemo(
    () =>
      sessions
        .filter((r) => r.fileId === fileId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 5),
    [sessions, fileId]
  );

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
        {file.fileName} · {file.pageCount} pages · p.{file.currentPage}
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
            <Seg<FileCoverMode>
              value={file.coverMode}
              onChange={(m) => updateFile(file.id, { coverMode: m })}
              options={[
                { id: 'page', label: 'Page' },
                { id: 'custom', label: 'Custom' },
              ]}
            />
            {file.coverMode === 'page' ? (
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
          <div className="field">
            <label htmlFor="ff-deadline">Deadline</label>
            <input
              id="ff-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
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
      </div>

      {/* page time map */}
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

/* ==================== AnnotationsPanel ====================
   Slide-over listing every annotation in the document: ink, highlights,
   shapes, text boxes. Search by content/note, jump to the page + select,
   per-annotation text notes (saved with the stroke), delete. */

'use client';

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight, Circle, Highlighter, Minus, MoveUpRight, NotebookPen, Pen,
  Search, Square, Trash2, X,
} from 'lucide-react';
import type { PageAnnoMap, Stroke } from '@/lib/workbench/types';
import { IconBtn, toast } from '../ui/primitives';

const KIND_LABEL: Record<string, string> = {
  pen: 'Ink',
  highlight: 'Highlight',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  text: 'Text',
  whiteout: 'Whiteout',
};

function kindIcon(s: Stroke): React.ReactNode {
  const size = 13;
  if (s.shape === 'text') return <NotebookPen size={size} />;
  if (s.tool === 'highlight') return <Highlighter size={size} />;
  if (s.tool === 'whiteout') return <Square size={size} />;
  if (s.shape === 'rect') return <Square size={size} />;
  if (s.shape === 'ellipse') return <Circle size={size} />;
  if (s.shape === 'line') return <Minus size={size} />;
  if (s.shape === 'arrow') return <MoveUpRight size={size} />;
  if (s.tool === 'pen') return <Pen size={size} />;
  return <Square size={size} />;
}

function strokeText(s: Stroke): string {
  return s.text ?? '';
}

export function AnnotationsPanel({
  open,
  onClose,
  annos,
  currentPage,
  onJump,
  onUpdateNote,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  annos: PageAnnoMap;
  currentPage: number;
  onJump: (page: number, strokeId: string) => void;
  onUpdateNote: (page: number, stroke: Stroke, note: string) => void;
  onDelete: (page: number, stroke: Stroke) => void;
}) {
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');

  const entries = useMemo(() => {
    const out: { page: number; stroke: Stroke }[] = [];
    const pages = Object.keys(annos).map(Number).sort((a, b) => a - b);
    for (const pg of pages) {
      for (const st of annos[String(pg)] ?? []) {
        out.push({ page: pg, stroke: st });
      }
    }
    const query = q.trim().toLowerCase();
    if (!query) return out;
    return out.filter(({ stroke }) =>
      (stroke.text ?? '').toLowerCase().includes(query) ||
      (stroke.note ?? '').toLowerCase().includes(query) ||
      (KIND_LABEL[stroke.shape ?? stroke.tool] ?? '').toLowerCase().includes(query)
    );
  }, [annos, q]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <aside className="rd-annos-panel" role="dialog" aria-label="Annotations">
      <div className="rd-pages-head">
        <span className="rd-pages-title">
          Annotations
          <span className="rd-pages-count rd-mono">{entries.length}</span>
        </span>
        <IconBtn title="Close (Esc)" onClick={onClose}><X size={15} /></IconBtn>
      </div>

      <div className="rd-annos-search">
        <Search size={13} aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search text, notes, kinds…"
          aria-label="Search annotations"
        />
        {q && <IconBtn small title="Clear" onClick={() => setQ('')}><X size={12} /></IconBtn>}
      </div>

      <div className="rd-annos-list">
        {entries.length ? (
          entries.map(({ page, stroke }) => {
            const kind = KIND_LABEL[stroke.shape ?? stroke.tool] ?? 'Mark';
            const preview = strokeText(stroke);
            const isEditing = editingId === stroke.id;
            return (
              <div key={stroke.id} className={`rd-anno-row${page === currentPage ? ' cur' : ''}`}>
                <button
                  type="button"
                  className="rd-anno-main"
                  onClick={() => onJump(page, stroke.id)}
                  title={`Jump to page ${page}`}
                >
                  <span className="rd-anno-kind" style={{ color: stroke.color }}>
                    {kindIcon(stroke)}
                  </span>
                  <span className="rd-anno-body">
                    <span className="rd-anno-kind-lab">{kind} · p.{page}</span>
                    {preview ? (
                      <span className="rd-anno-text">{preview.length > 80 ? preview.slice(0, 80) + '…' : preview}</span>
                    ) : null}
                    {stroke.note && (
                      <span className="rd-anno-note-preview">
                        {preview ? '📝 ' + (stroke.note.length > 60 ? stroke.note.slice(0, 60) + '…' : stroke.note) : stroke.note.length > 80 ? stroke.note.slice(0, 80) + '…' : stroke.note}
                      </span>
                    )}
                  </span>
                  <ArrowUpRight size={13} className="rd-anno-go" aria-hidden />
                </button>
                {isEditing ? (
                  <div className="rd-anno-note-edit">
                    <textarea
                      autoFocus
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder="Note for this annotation…"
                      rows={3}
                      dir="auto"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          onUpdateNote(page, stroke, draftNote.trim());
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                    />
                    <div className="rd-anno-note-acts">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => {
                          onUpdateNote(page, stroke, draftNote.trim());
                          setEditingId(null);
                          toast('Note saved');
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="rd-anno-acts">
                    <IconBtn
                      small
                      title={stroke.note ? 'Edit note' : 'Add note'}
                      onClick={() => {
                        setEditingId(stroke.id);
                        setDraftNote(stroke.note ?? '');
                      }}
                    >
                      <NotebookPen size={13} />
                    </IconBtn>
                    <IconBtn
                      small
                      danger
                      title="Delete annotation"
                      onClick={() => {
                        onDelete(page, stroke);
                        toast('Annotation deleted');
                      }}
                    >
                      <Trash2 size={13} />
                    </IconBtn>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="rd-annos-empty">
            {q ? 'No annotations match.' : 'No annotations yet — draw, highlight or add text on any page.'}
          </div>
        )}
      </div>
    </aside>,
    document.body
  );
}

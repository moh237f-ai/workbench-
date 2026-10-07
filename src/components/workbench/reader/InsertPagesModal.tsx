/* ==================== InsertPagesModal ====================
   Insert note-template pages into the PDF at the current position:
   blank / lined / grid / dots / Oxford — with page color, line color,
   line width, spacing and page-size controls. Vector-drawn via pdf-lib. */

'use client';

import React, { useState } from 'react';
import { useEffect, useRef } from 'react';
import { FilePlus2 } from 'lucide-react';
import { createTemplatePdfNote, insertMarkdownPage, insertTemplatePages, renderMarkdownToCanvas, savePdfBytes, type PageTemplate } from '@/lib/workbench/pdfwrite';
import { useWB } from '@/lib/workbench/store';
import { Btn, Modal, toast } from '../ui/primitives';

const TEMPLATES: { id: PageTemplate; label: string; desc: string }[] = [
  { id: 'blank', label: 'Blank', desc: 'Plain page, any color' },
  { id: 'lined', label: 'Lined', desc: 'Horizontal rules' },
  { id: 'grid', label: 'Grid', desc: 'Square graph paper' },
  { id: 'dots', label: 'Dots', desc: 'Dot grid for bullet notes' },
  { id: 'oxford', label: 'Oxford', desc: 'Cue column + summary (Cornell)' },
  { id: 'note', label: 'Note', desc: 'Markdown rendered onto the page' },
];

const PAGE_COLORS = ['#ffffff', '#f8f5ec', '#eef4f0', '#16181c', '#1b2040'];
const LINE_COLORS = ['#c8cdc9', '#9fb8ae', '#7c9ed9', '#d9a441', '#444b47'];

export function InsertPagesModal({
  fileId,
  currentPage,
  numPages,
  onClose,
  onInserted,
}: {
  fileId: string;
  currentPage: number;
  numPages: number;
  onClose: () => void;
  onInserted: (newPageCount: number, insertedAt: number) => void;
}) {
  const updateFile = useWB((s) => s.updateFile);
  const snapshot = useWB((s) => s.snapshot);
  const [template, setTemplate] = useState<PageTemplate>('lined');
  const [count, setCount] = useState(1);
  const [afterPage, setAfterPage] = useState(currentPage);
  const [pageColor, setPageColor] = useState('#ffffff');
  const [lineColor, setLineColor] = useState('#9fb8ae');
  const [lineWidth, setLineWidth] = useState(0.8);
  const [spacing, setSpacing] = useState(28);
  const [size, setSize] = useState<'match' | 'a4'>('match');
  const [noteMd, setNoteMd] = useState('# Notes\n\nStart writing…');
  const [asNote, setAsNote] = useState(false); /* create standalone note file instead of inserting */
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const canSubmit = !busy && count >= 1 && count <= 20 && afterPage >= 0 && afterPage <= numPages;
  const isNote = template === 'note';

  const submit = async () => {
    setBusy(true);
    try {
      if (asNote && !isNote) {
        /* "blank as new note": standalone PDF note file, current PDF untouched */
        const label = TEMPLATES.find((t) => t.id === template)?.label ?? 'Blank';
        const folder = useWB.getState().files.find((f) => f.id === fileId)?.folderId ?? null;
        const id = await createTemplatePdfNote(
          { template, count, pageColor, lineColor, lineWidth, spacing },
          `${label} note`,
          folder
        );
        if (id) {
          toast('Note created', `${label} template · ${count} page${count === 1 ? '' : 's'} in the library.`);
          onClose();
        } else {
          toast('Could not create the note');
        }
        return;
      }
      snapshot();
      const { bytes, newPageCount } =
        template === 'note'
          ? await insertMarkdownPage(fileId, afterPage, noteMd, pageColor, lineColor, size)
          : await insertTemplatePages(fileId, {
              template, count, afterPage, pageColor, lineColor, lineWidth, spacing, size,
            });
      await savePdfBytes(fileId, bytes, newPageCount, { keepBackup: true });
      updateFile(fileId, { lastReadAt: new Date().toISOString() });
      toast(`Inserted ${count} page${count === 1 ? '' : 's'}`, `${TEMPLATES.find((t) => t.id === template)?.label} template after p.${afterPage}.`);
      onInserted(newPageCount, afterPage);
      onClose();
    } catch (err) {
      toast('Insert failed', err instanceof Error ? err.message : 'Could not write the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Insert pages"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
            <FilePlus2 size={15} /> {busy ? 'Writing…' : asNote && !isNote ? `New ${TEMPLATES.find((t) => t.id === template)?.label.toLowerCase() ?? 'blank'} note` : isNote ? 'Insert note page' : `Insert ${count} page${count === 1 ? '' : 's'}`}
          </Btn>
        </>
      }
    >
      <div className="ins-grid">
        {/* templates */}
        <div className="ins-sec">
          <span className="ins-lab">Template</span>
          <div className="ins-tpl-grid" role="radiogroup" aria-label="Page template">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={template === t.id}
                className={`ins-tpl ${template === t.id ? 'on' : ''}`}
                onClick={() => setTemplate(t.id)}
                title={t.desc}
              >
                <TemplatePreview kind={t.id} pageColor={pageColor} lineColor={lineColor} spacing={spacing} lineWidth={lineWidth} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* placement */}
        <div className="ins-sec">
          <span className="ins-lab">Where</span>
          <label className="ins-row">
            <span>After page</span>
            <input
              type="number"
              min={0}
              max={numPages}
              value={afterPage}
              onChange={(e) => setAfterPage(Math.max(0, Math.min(numPages, Number(e.target.value) || 0)))}
              aria-label="Insert after page"
            />
            <span className="ins-muted">of {numPages} · 0 = start</span>
          </label>
          {!isNote && (
            <label className="ins-row">
              <span>How many</span>
              <input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                aria-label="Number of pages"
              />
            </label>
          )}
          <div className="ins-row">
            <span>Page size</span>
            <div className="ins-seg" role="radiogroup" aria-label="Page size">
              <button type="button" role="radio" aria-checked={size === 'match'} className={size === 'match' ? 'on' : ''} onClick={() => setSize('match')}>Match document</button>
              <button type="button" role="radio" aria-checked={size === 'a4'} className={size === 'a4' ? 'on' : ''} onClick={() => setSize('a4')}>A4</button>
            </div>
          </div>
          {!isNote && (
            <div className="ins-row">
              <span>Destination</span>
              <div className="ins-seg" role="radiogroup" aria-label="Destination">
                <button type="button" role="radio" aria-checked={!asNote} className={!asNote ? 'on' : ''} title="Insert into this document">This PDF</button>
                <button type="button" role="radio" aria-checked={asNote} className={asNote ? 'on' : ''} title="Create a standalone note file in the library">New note</button>
              </div>
            </div>
          )}
        </div>

        {isNote && (
          <div className="ins-sec">
            <span className="ins-lab">Markdown — rendered onto the page</span>
            <textarea
              className="ins-note-md"
              value={noteMd}
              onChange={(e) => setNoteMd(e.target.value)}
              rows={7}
              dir="auto"
              aria-label="Markdown for the note page"
              spellCheck={false}
            />
            <div className="ins-note-preview" ref={previewRef} aria-label="Live page preview">
              <NoteCanvasPreview md={noteMd} pageColor={pageColor} lineColor={lineColor} width={340} />
            </div>
          </div>
        )}

        {/* style */}
        <div className="ins-sec">
          <span className="ins-lab">Style</span>
          <div className="ins-row">
            <span>Page color</span>
            <div className="ins-swatches">
              {PAGE_COLORS.map((c) => (
                <button key={c} type="button" className={`ins-swatch ${pageColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setPageColor(c)} aria-label={`Page color ${c}`} aria-pressed={pageColor === c} />
              ))}
            </div>
          </div>
          {(template !== 'blank' && template !== 'note') && (
            <>
              <div className="ins-row">
                <span>Line color</span>
                <div className="ins-swatches">
                  {LINE_COLORS.map((c) => (
                    <button key={c} type="button" className={`ins-swatch ${lineColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLineColor(c)} aria-label={`Line color ${c}`} aria-pressed={lineColor === c} />
                  ))}
                </div>
              </div>
              <label className="ins-row">
                <span>Line width</span>
                <input type="range" min={0.4} max={2} step={0.1} value={lineWidth} onChange={(e) => setLineWidth(Number(e.target.value))} aria-label="Line width" />
                <span className="ins-muted mono">{lineWidth.toFixed(1)}pt</span>
              </label>
              <label className="ins-row">
                <span>Spacing</span>
                <input type="range" min={14} max={56} step={2} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} aria-label="Line spacing" />
                <span className="ins-muted mono">{spacing}pt</span>
              </label>
            </>
          )}
        </div>
      </div>
      <div className="field-help" style={{ marginTop: 12 }}>
        Pages are drawn as crisp vectors and written into the PDF itself — they
        survive export and sync. Undo (Ctrl+Z) reverts the insertion.
      </div>
    </Modal>
  );
}

/* ---------- live preview of each template ---------- */

function TemplatePreview({ kind, pageColor, lineColor, spacing = 28, lineWidth = 0.8 }: { kind: PageTemplate; pageColor: string; lineColor: string; spacing?: number; lineWidth?: number }) {
  const w = 54;
  const h = 68;
  const gap = Math.max(4, Math.min(12, spacing / 4));
  const lines: React.ReactElement[] = [];
  if (kind === 'lined' || kind === 'oxford') {
    for (let y = gap + 4; y < h - 4; y += gap) lines.push(<line key={y} x1={kind === 'oxford' ? w * 0.34 : 6} y1={y} x2={w - 6} y2={y} />);
    if (kind === 'oxford') lines.push(<line key="v" x1={w * 0.34} y1={4} x2={w * 0.34} y2={h - 4} strokeWidth={1.4} />);
  } else if (kind === 'grid') {
    for (let x = 6; x <= w - 6; x += gap) lines.push(<line key={`x${x}`} x1={x} y1={4} x2={x} y2={h - 4} />);
    for (let y = gap; y <= h - 4; y += gap) lines.push(<line key={`y${y}`} x1={6} y1={y} x2={w - 6} y2={y} />);
  } else if (kind === 'note') {
    const rows = [w - 20, w - 14, w - 14, w - 30, w - 14];
    rows.forEach((wd, i) => {
      lines.push(<rect key={`n${i}`} x={7} y={10 + i * 12} width={wd} height={i === 0 ? 4 : 2.4} rx={1.2} fill={lineColor} opacity={i === 0 ? 0.9 : 0.55} />);
    });
  } else if (kind === 'dots') {
    for (let x = 8; x <= w - 8; x += gap) for (let y = gap; y <= h - gap; y += gap) lines.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} />);
  }
  return (
    <svg width={w} height={h} className="ins-tpl-svg" aria-hidden="true">
      <rect x={0} y={0} width={w} height={h} rx={5} fill={pageColor} stroke="var(--hairline)" />
      <g stroke={lineColor} strokeWidth={Math.max(0.4, Math.min(1.6, lineWidth))} fill={lineColor} opacity={0.8}>{lines}</g>
    </svg>
  );
}


/* ---------- live markdown page preview (canvas, Persian-safe) ---------- */

function NoteCanvasPreview({ md, pageColor, lineColor, width }: { md: string; pageColor: string; lineColor: string; width: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const canvas = ref.current;
      if (!canvas) return;
      try {
        const rendered = renderMarkdownToCanvas(md || ' ', width, pageColor, lineColor);
        canvas.width = rendered.width;
        canvas.height = rendered.height;
        canvas.style.width = `${width}px`;
        canvas.getContext('2d')?.drawImage(rendered, 0, 0);
      } catch {
        /* preview is best-effort */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [md, pageColor, lineColor, width]);
  return <canvas ref={ref} className="ins-note-canvas" />;
}

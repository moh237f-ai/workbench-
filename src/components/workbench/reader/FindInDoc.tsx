/* ==================== Find in document ====================
   Ctrl+F search across extracted page text: debounced matching, match list,
   page jump, and per-page highlight overlays drawn via DOM Ranges on the
   pdf.js text layer. */

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { findInDoc, type TextMatch } from '@/lib/workbench/pdftext';
import { IconBtn } from '../ui/primitives';

export interface FindState {
  open: boolean;
  query: string;
  matches: TextMatch[];
  active: number;
}

export function useFindController(fileId: string, doc: PDFDocumentProxy | null) {
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const [active, setActive] = useState(0);
  const seqRef = useRef(0);

  /* debounced search */
  useEffect(() => {
    if (!findOpen || !doc) return;
    const q = query.trim();
    if (!q) {
      setMatches([]);
      return;
    }
    const seq = (seqRef.current += 1);
    const t = setTimeout(() => {
      void findInDoc(fileId, doc, q).then((ms) => {
        if (seq === seqRef.current) {
          setMatches(ms);
          setActive(0);
        }
      });
    }, 260);
    return () => clearTimeout(t);
  }, [query, findOpen, doc, fileId]);

  const open = () => setFindOpen(true);
  const close = () => {
    setFindOpen(false);
    setQuery('');
    setMatches([]);
  };

  return {
    findOpen,
    query,
    setQuery,
    matches,
    active,
    setActive,
    open,
    close,
    prev: () => setActive((a) => (matches.length ? (a - 1 + matches.length) % matches.length : 0)),
    next: () => setActive((a) => (matches.length ? (a + 1) % matches.length : 0)),
  };
}

export function FindBar({
  find,
  onJump,
}: {
  find: ReturnType<typeof useFindController>;
  onJump: (match: TextMatch) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (find.findOpen) inputRef.current?.focus();
  }, [find.findOpen]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [find.active]);

  const current = find.matches[find.active];

  return (
    <div className="rd-find" role="search" aria-label="Find in document">
      <input
        ref={inputRef}
        className="rd-find-input"
        type="text"
        value={find.query}
        placeholder="Find in document…"
        aria-label="Search text"
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) find.prev();
            else {
              find.next();
              if (find.matches.length) onJump(find.matches[(find.active + 1) % find.matches.length]);
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            find.close();
          }
        }}
      />
      <span className="rd-find-count mono">
        {find.matches.length ? `${find.active + 1} / ${find.matches.length}` : find.query ? '0' : ''}
      </span>
      <IconBtn small title="Previous match (Shift+Enter)" onClick={() => {
        find.prev();
        if (find.matches.length) onJump(find.matches[(find.active - 1 + find.matches.length) % find.matches.length]);
      }}>
        <ChevronUp size={14} />
      </IconBtn>
      <IconBtn small title="Next match (Enter)" onClick={() => {
        find.next();
        if (find.matches.length) onJump(find.matches[(find.active + 1) % find.matches.length]);
      }}>
        <ChevronDown size={14} />
      </IconBtn>
      <IconBtn small title="Close (Esc)" onClick={find.close}><X size={14} /></IconBtn>

      {find.matches.length > 3 && (
        <div className="rd-find-list">
          {find.matches.map((m, i) => (
            <button
              key={`${m.page}-${m.index}`}
              ref={i === find.active ? activeRef : undefined}
              type="button"
              className={`rd-find-row ${i === find.active ? 'on' : ''}`}
              onClick={() => {
                find.setActive(i);
                onJump(m);
              }}
            >
              <span className="mono rd-find-page">p.{m.page}</span>
              <span className="rd-find-ctx">…{m.context}…</span>
            </button>
          ))}
        </div>
      )}
      <span hidden>{current ? '' : ''}</span>
    </div>
  );
}

/** Draw (or clear) highlight boxes for matches on one page's text layer host. */
export function paintFindHits(
  host: HTMLElement | null,
  hits: { index: number; length: number }[],
  activeIndex: number
): void {
  if (!host) return;
  host.querySelector('.rd-find-layer')?.remove();
  if (!hits.length) return;

  const layer = document.createElement('div');
  layer.className = 'rd-find-layer';
  /* active hit paints on top */
  const ordered = hits.map((h, i) => ({ h, i })).sort((a, b) => (a.i === activeIndex ? 1 : b.i === activeIndex ? -1 : 0));

  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let total = 0;
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    nodes.push(t);
    total += t.data.length;
  }
  void total;

  let consumed = 0;
  for (const node of nodes) {
    const nodeLen = node.data.length;
    const nodeStart = consumed;
    consumed += nodeLen;
    for (const { h, i } of ordered) {
      const start = h.index;
      const end = h.index + h.length;
      if (end <= nodeStart || start >= nodeStart + nodeLen) continue;
      const localStart = Math.max(0, start - nodeStart);
      const localEnd = Math.min(nodeLen, end - nodeStart);
      try {
        const range = document.createRange();
        range.setStart(node, localStart);
        range.setEnd(node, localEnd);
        for (const r of range.getClientRects()) {
          const hostRect = host.getBoundingClientRect();
          const box = document.createElement('div');
          box.className = `rd-find-hit${i === activeIndex ? ' active' : ''}`;
          box.style.left = `${r.left - hostRect.left}px`;
          box.style.top = `${r.top - hostRect.top}px`;
          box.style.width = `${r.width}px`;
          box.style.height = `${r.height}px`;
          layer.appendChild(box);
        }
      } catch {
        /* detached node — skip */
      }
    }
  }
  if (layer.childElementCount) host.appendChild(layer);
}

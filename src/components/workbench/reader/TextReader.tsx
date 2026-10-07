/* ==================== TextReader — reflowable reading mode ====================
   Extracted PDF text rendered as beautiful typography: font family, size,
   line-height and column width controls. Scroll position maps back to the
   underlying page so currentPage / per-page time / sessions stay accurate. */

'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useWB } from '@/lib/workbench/store';
import type { ReaderPrefs } from '@/lib/workbench/types';
import { getPageTexts } from '@/lib/workbench/pdftext';
import { isRtlText } from '@/lib/workbench/helpers';

const FONTS: { id: ReaderPrefs['textFont']; label: string; css: string }[] = [
  { id: 'sans', label: 'Inter', css: 'var(--font-inter), system-ui, sans-serif' },
  { id: 'serif', label: 'Literata', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'JetBrains', css: 'var(--font-jetbrains), ui-monospace, monospace' },
  { id: 'persian', label: 'Vazirmatn (فارسی)', css: 'var(--font-persian), sans-serif' },
];

export function textFontCss(id: ReaderPrefs['textFont']): string {
  return FONTS.find((f) => f.id === id)?.css ?? FONTS[0].css;
}

export function TextReader({
  fileId,
  doc,
  startPage,
  onActivePage,
  onWordSelected,
  scrollToPage,
  onExitText,
}: {
  fileId: string;
  doc: PDFDocumentProxy;
  startPage: number;
  onActivePage?: (page: number) => void;
  onWordSelected?: (payload: { text: string; page: number; rect: DOMRect }) => void;
  /** external navigation (split view): { page, nonce } — nonce bumps retrigger */
  scrollToPage?: { page: number; nonce: number } | null;
  /** leave Text mode (offered on pages whose embedded text is damaged) */
  onExitText?: () => void;
}) {
  const prefs = useWB((s) => s.readerPrefs);
  const setFilePosition = useWB((s) => s.setFilePosition);
  const addPageSecs = useWB((s) => s.addFilePageSeconds);
  const [pages, setPages] = useState<{ page: number; html: string; puaRatio: number; garbled?: boolean }[] | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const activePageRef = useRef(startPage);
  const pendingSecsRef = useRef(new Map<number, number>());

  useEffect(() => {
    let alive = true;
    void getPageTexts(fileId, doc, (done, total) => {
      if (alive) setProgressLabel(done < total ? `Extracting text · ${done}/${total}` : '');
    }).then((pts) => {
      if (alive) setPages(pts.map((p) => ({ page: p.page, html: p.html, puaRatio: p.puaRatio, garbled: p.garbled })));
    });
    return () => {
      alive = false;
    };
  }, [fileId, doc]);

  /* real 1-second tick: visible time accrues to the active page */
  useEffect(() => {
    if (!pages) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const cur = activePageRef.current;
      pendingSecsRef.current.set(cur, (pendingSecsRef.current.get(cur) ?? 0) + 1);
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pages]);

  /* flush pending page-seconds every 10s + on unmount */
  useEffect(() => {
    const flush = () => {
      for (const [pg, secs] of pendingSecsRef.current) {
        if (secs > 0) addPageSecs(fileId, pg, secs);
      }
      pendingSecsRef.current.clear();
    };
    const id = setInterval(flush, 10_000);
    return () => {
      clearInterval(id);
      flush();
    };
  }, [fileId, addPageSecs]);

  /* dominant page via IntersectionObserver — drives currentPage + time buckets */
  useEffect(() => {
    if (!pages) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const n = Number((en.target as HTMLElement).dataset.page);
          if (Number.isFinite(n)) ratios.set(n, en.intersectionRatio);
        }
        let best = -1;
        let bestR = 0.15;
        ratios.forEach((r, n) => {
          if (r > bestR) {
            bestR = r;
            best = n;
          }
        });
        if (best > 0 && best !== activePageRef.current) {
          activePageRef.current = best;
          setFilePosition(fileId, best);
          onActivePage?.(best);
        }
      },
      { threshold: [0, 0.2, 0.5, 0.8, 1] }
    );
    for (const [, el] of pageElsRef.current) io.observe(el);
    return () => io.disconnect();
  }, [pages, fileId, setFilePosition, onActivePage]);

  /* scroll to the starting page once rendered */
  useEffect(() => {
    if (!pages) return;
    const t = setTimeout(() => {
      pageElsRef.current.get(startPage)?.scrollIntoView({ block: 'start' });
    }, 80);
    return () => clearTimeout(t);
  }, [pages, startPage]);

  /* external page requests (split-view sync / page nav) */
  useEffect(() => {
    if (!pages || !scrollToPage) return;
    const el = pageElsRef.current.get(scrollToPage.page);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [pages, scrollToPage?.nonce]);   

  const style = useMemo<React.CSSProperties>(
    () => ({
      fontFamily: textFontCss(prefs.textFont),
      fontSize: prefs.textSize,
      lineHeight: prefs.textLineHeight,
      maxWidth: `${prefs.textWidth}ch`,
    }),
    [prefs.textFont, prefs.textSize, prefs.textLineHeight, prefs.textWidth]
  );

  const onMouseUp = (e: React.MouseEvent) => {
    if (!onWordSelected) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text || !sel) return;
    if (text.split(/\s+/).length > 3) return;
    const range = sel.getRangeAt(0);
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    onWordSelected({ text, page: activePageRef.current, rect });
  };

  return (
    <div className="rd-text-scroll" ref={containerRef} onMouseUp={onMouseUp}>
      {pages ? (
        <div className="rd-text-article" style={style}>
          {pages.map((p) => (
            <section
              key={p.page}
              data-page={p.page}
              className={p.puaRatio > 0.08 ? 'rd-text-mathpage' : ''}
              dir="auto"
              ref={(el) => {
                if (el) pageElsRef.current.set(p.page, el);
                else pageElsRef.current.delete(p.page);
              }}
            >
              {p.puaRatio > 0.08 && (
                <div className="rd-text-math-hint">
                  This page uses an embedded math font — some symbols may not map cleanly. Check the page pane for the original layout.
                </div>
              )}
              {p.garbled && (
                <div className="rd-text-garble-hint">
                  <span>
                    This page&apos;s embedded text is damaged (legacy fonts) — the reflowed text here is unreliable.
                    The original page renders correctly.
                  </span>
                  {onExitText && (
                    <button type="button" className="btn btn-sm" onClick={onExitText}>
                      Back to page view
                    </button>
                  )}
                </div>
              )}
              {p.html.split(/\n{2,}/).map((para, i) =>
                para.trim() ? <p key={i} dir={isRtlText(para) ? 'rtl' : 'ltr'}>{para}</p> : null
              )}
            </section>
          ))}
          <div className="rd-text-end">· end of document ·</div>
        </div>
      ) : (
        <div className="rd-centered">
          <div className="rd-spinner" role="status" aria-label="Extracting text" />
          <div className="rd-load-label">{progressLabel || 'Extracting text…'}</div>
        </div>
      )}
    </div>
  );
}

/* ==================== DictionaryPopup ====================
   Word lookup on text selection: definitions + synonyms + examples (offline
   WordNet) with an EN→FA translation tab, pronounce button, and save to the
   vocabulary deck. Portaled to body, positioned near the selection rect. */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookMarked, Highlighter, Languages, Plus, Volume2, X } from 'lucide-react';
import { lookupWord, pronounce } from '@/lib/workbench/dictionary';
import type { LookupResult } from '@/lib/workbench/dictionary';
import { useWB } from '@/lib/workbench/store';
import { Btn, IconBtn, toast } from '../ui/primitives';

const POP_W = 372;
const MAX_H = 380;

export function DictionaryPopup({
  selection,
  onClose,
  onHighlight,
}: {
  selection: { text: string; page: number; rect: DOMRect } | null;
  onClose: () => void;
  onHighlight?: (sel: { text: string; page: number; rect: DOMRect }) => void;
}) {
  const addVocab = useWB((s) => s.addVocab);
  const [lang, setLang] = useState<'en' | 'fa'>('en');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selection) {
      setResult(null);
      return;
    }
    /* position near the selection, clamped to the viewport */
    const r = selection.rect;
    let left = r.left + r.width / 2 - POP_W / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - POP_W - 10));
    let top = r.bottom + 8;
    if (top + MAX_H > window.innerHeight - 10) top = Math.max(10, r.top - MAX_H - 8);
    setPos({ top, left });

    setLoading(true);
    let alive = true;
    void lookupWord(selection.text, 'both').then((res) => {
      if (!alive) return;
      setResult(res);
      setLoading(false);
      /* auto-switch to FA when the word has no English entry but translates */
      setLang((cur) => (cur === 'en' && !res.en?.length && res.fa?.length ? 'fa' : cur));
    });
    return () => {
      alive = false;
    };
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [selection, onClose]);

  if (!selection || !pos || typeof document === 'undefined') return null;

  const word = selection.text.trim().toLowerCase();
  const hasEn = !!result?.en?.length;
  const hasFa = !!result?.fa?.length;

  const save = () => {
    const entry = addVocab({
      word,
      translation: result?.fa?.[0] ?? null,
      senses: result?.en?.length ? result.en : null,
      sourcePage: selection.page,
    });
    if (entry) {
      toast(result?.en?.length || result?.fa?.length ? 'Saved to vocabulary' : 'Word saved', `Review "${entry.word}" in the Vocabulary view (G V).`);
      onClose();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="dict-pop"
      role="dialog"
      aria-label={`Dictionary — ${word}`}
      style={{ top: pos.top, left: pos.left, width: POP_W, maxHeight: MAX_H }}
    >
      <div className="dict-head">
        <button
          type="button"
          className="dict-word"
          title="Pronounce"
          onClick={() => pronounce(word)}
        >
          {word}
          <Volume2 size={13} />
        </button>
        <div className="dict-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={lang === 'en'}
            className={lang === 'en' ? 'on' : ''}
            onClick={() => setLang('en')}
            title="English — definitions & synonyms"
          >
            <BookMarked size={12} /> EN
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={lang === 'fa'}
            className={lang === 'fa' ? 'on' : ''}
            onClick={() => setLang('fa')}
            title="English → Persian"
          >
            <Languages size={12} /> FA
          </button>
        </div>
        <IconBtn small title="Close" onClick={onClose}><X size={13} /></IconBtn>
      </div>

      <div className="dict-body">
        {loading && <div className="dict-loading">Looking up…</div>}

        {!loading && lang === 'en' && (
          <>
            {hasEn ? (
              result!.en!.map((sense, i) => (
                <div key={i} className="dict-sense">
                  <span className="dict-pos">{sense.pos}</span>
                  {sense.defs.map((d, j) => (
                    <div key={j} className="dict-def">
                      <span className="dict-def-n">{i + 1}.{j + 1}</span> {d}
                    </div>
                  ))}
                  {sense.ex.length > 0 && (
                    <div className="dict-ex">“{sense.ex[0]}”</div>
                  )}
                  {sense.syns.length > 0 && (
                    <div className="dict-syns">
                      <span className="dict-lab">synonyms</span>
                      {sense.syns.slice(0, 6).map((s) => (
                        <button key={s} type="button" className="dict-syn" onClick={() => pronounce(s)} title={`Pronounce “${s}”`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {sense.ants.length > 0 && (
                    <div className="dict-syns">
                      <span className="dict-lab">antonyms</span>
                      {sense.ants.slice(0, 4).map((s) => (
                        <span key={s} className="dict-syn ant">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="dict-empty">
                No English entry{result && !hasFa ? ' — try the FA tab' : ''}.
              </div>
            )}
          </>
        )}

        {!loading && lang === 'fa' && (
          hasFa ? (
            <div className="dict-fa-list">
              {result!.fa!.map((t, i) => (
                <div key={i} className="dict-fa-item">{t}</div>
              ))}
            </div>
          ) : (
            <div className="dict-empty">
              No translation{result && !hasEn ? ' — try the EN tab' : ''}.
            </div>
          )
        )}

        {!loading && !hasEn && !hasFa && (
          <div className="dict-empty">Nothing found for “{word}”.</div>
        )}
      </div>

      <div className="dict-foot">
        <div style={{ display: 'flex', gap: 8 }}>
          {onHighlight && selection.page > 0 && (
            <Btn size="sm" onClick={() => { onHighlight(selection); onClose(); }} title="Draw a highlighter box over the selected text">
              <Highlighter size={13} /> Highlight
            </Btn>
          )}
          <Btn size="sm" variant="primary" onClick={save}>
            <Plus size={13} /> Save to vocabulary
          </Btn>
        </div>
        <span className="dict-foot-meta">
          {selection.page > 0 ? `p.${selection.page}` : ''}
        </span>
      </div>
    </div>,
    document.body
  );
}

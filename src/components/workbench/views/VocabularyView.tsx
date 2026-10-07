/* ==================== Vocabulary View ====================
   Saved words from dictionary lookups, with flashcard review (Leitner
   boxes), due filters, source links, and CSV/Anki export. */

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BookA, Check, Download, Flame, Layers, RotateCcw, Search, Star, Trash2, Upload, X,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import type { VocabEntry } from '@/lib/workbench/types';
import { todayStr } from '@/lib/workbench/helpers';
import { pronounce } from '@/lib/workbench/dictionary';
import { Btn, IconBtn, Seg, toast } from '../ui/primitives';

type VocabFilter = 'due' | 'all' | 'mastered';

const BOX_LABEL = ['new', 'learning', 'learning', 'familiar', 'solid', 'mastered'];

function dueToday(v: VocabEntry): boolean {
  return v.nextReviewAt <= todayStr();
}

export function VocabularyView() {
  const vocabulary = useWB((s) => s.vocabulary);
  const reviewVocab = useWB((s) => s.reviewVocab);
  const removeVocab = useWB((s) => s.removeVocab);
  const files = useWB((s) => s.files);
  const [filter, setFilter] = useState<VocabFilter>('due');
  const [q, setQ] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [deck, setDeck] = useState<VocabEntry[]>([]);
  const [reverse, setReverse] = useState(false);
  const addVocabStore = useWB((s) => s.addVocab);

  /** Anki CSV import: "word,meaning" or tab-separated; senses looked up from the offline dict. */
  const importCsv = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt,.tsv';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        const text = String(fr.result);
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        let imported = 0;
        let skipped = 0;
        const start = lines[0]?.toLowerCase().includes('word') && lines[0]?.toLowerCase().includes('meaning') ? 1 : 0;
        for (let i = start; i < lines.length; i++) {
          const m = lines[i].match(/^"?(.*?)"?[,;\t]"?(.*?)"?$/);
          if (!m) { skipped++; continue; }
          const word = m[1].trim().toLowerCase();
          const meaning = m[2].trim().replace(/^"|"$/g, '');
          if (!word || word === 'word') { skipped++; continue; }
          const entry = addVocabStore({ word, translation: meaning || null });
          if (entry && !entry.senses) imported++;
          else if (entry) imported++;
          else skipped++;
        }
        toast('Imported', `${imported} words${skipped ? ` · ${skipped} skipped` : ''}.`);
      };
      fr.readAsText(f);
    };
    input.click();
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return vocabulary.filter((v) => {
      if (filter === 'due' && !dueToday(v)) return false;
      if (filter === 'mastered' && v.box < 5) return false;
      if (query && !v.word.includes(query) && !(v.translation ?? '').includes(query)) return false;
      return true;
    });
  }, [vocabulary, filter, q]);

  const dueCount = vocabulary.filter(dueToday).length;
  const masteredCount = vocabulary.filter((v) => v.box >= 5).length;
  const streak = useMemo(() => {
    /* consecutive days with ≥1 review, from lastReviewAt fields */
    const days = new Set(vocabulary.filter((v) => v.lastReviewAt).map((v) => v.lastReviewAt!.slice(0, 10)));
    let s = 0;
    const cur = new Date();
    if (!days.has(cur.toISOString().slice(0, 10))) cur.setDate(cur.getDate() - 1);
    while (days.has(cur.toISOString().slice(0, 10))) {
      s++;
      cur.setDate(cur.getDate() - 1);
    }
    return s;
  }, [vocabulary]);

  const exportCsv = () => {
    const rows = [['word', 'meaning (fa)', 'definition', 'synonyms', 'box', 'source']];
    for (const v of vocabulary) {
      const src = v.sourceFileId ? files.find((f) => f.id === v.sourceFileId)?.title ?? '' : '';
      rows.push([
        v.word,
        v.translation ?? '',
        v.senses?.[0]?.defs?.[0] ?? '',
        v.senses?.[0]?.syns?.slice(0, 4).join(', ') ?? '',
        String(v.box),
        src,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => '"' + c.replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workbench-vocabulary-${todayStr()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Vocabulary exported', `${vocabulary.length} words — Anki-friendly CSV.`);
  };

  if (!vocabulary.length) {
    return (
      <div className="empty-state fade-in">
        <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--violet-light)', color: 'var(--violet)', margin: '0 auto 14px' }}>
          <BookA size={26} />
        </div>
        <div className="es-title">No words saved yet.</div>
        <div style={{ marginTop: 6, maxWidth: 460 }}>
          While reading a PDF or note, select any word — the dictionary popup shows
          definitions, synonyms and the Persian meaning. Save words and review them
          here as flashcards.
        </div>
      </div>
    );
  }

  if (reviewing) {
    return (
      <FlashcardReview
        reverse={reverse}
        entries={deck.length ? deck : filtered.length ? filtered : vocabulary}
        onDone={(reviewed) => {
          setReviewing(false);
          toast(`Review complete`, `${reviewed} word${reviewed === 1 ? '' : 's'} scheduled.`);
        }}
        onExit={() => setReviewing(false)}
      />
    );
  }

  return (
    <div className="fade-in">
      {/* stats */}
      <div className="grid-cards kpi-grid" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-label">Words</div>
          <div className="stat-value">{vocabulary.length}</div>
          <div className="stat-note">{dueCount} due for review</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Mastered</div>
          <div className="stat-value">{masteredCount}</div>
          <div className="stat-note">box 5 of 5</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Review streak</div>
          <div className="stat-value">{streak}d</div>
          <div className="stat-note">consecutive days</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Sources</div>
          <div className="stat-value">{new Set(vocabulary.filter((v) => v.sourceFileId).map((v) => v.sourceFileId)).size}</div>
          <div className="stat-note">files you met words in</div>
        </div>
      </div>

      <div className="action-bar" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Seg<VocabFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'due', label: `Due (${dueCount})` },
            { id: 'all', label: 'All' },
            { id: 'mastered', label: 'Mastered' },
          ]}
        />
        <div className="lib-search-box" style={{ maxWidth: 200 }}>
          <Search size={14} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words…" aria-label="Search vocabulary" />
          {q && (
            <button type="button" className="lib-search-clear" title="Clear" onClick={() => setQ('')}><X size={13} /></button>
          )}
        </div>
        <span className="spacer" />
        <Btn size="sm" variant="ghost" onClick={importCsv} title="Import Anki CSV or tab-separated word,meaning">
          <Upload size={13} /> Import
        </Btn>
        <Btn
          size="sm"
          variant={reverse ? 'primary' : 'ghost'}
          onClick={() => setReverse((v) => !v)}
          title="Reverse mode — show the meaning, recall the word"
        >
          <RotateCcw size={13} /> Reverse
        </Btn>
        <Btn size="sm" variant="ghost" onClick={exportCsv} title="Export as CSV (Anki-friendly)">
          <Download size={13} /> Export
        </Btn>
        <Btn
          size="sm"
          variant="primary"
          onClick={() => {
            /* snapshot the deck — grading changes 'due' mid-session otherwise */
            setDeck(filtered.length ? filtered : vocabulary);
            setReviewing(true);
          }}
          disabled={!filtered.length}
        >
          <Layers size={14} /> Review {filtered.length}
        </Btn>
      </div>

      <div className="card" style={{ padding: 6 }}>
        {filtered.length ? (
          filtered.map((v) => {
            const src = v.sourceFileId ? files.find((f) => f.id === v.sourceFileId) : null;
            return (
              <div key={v.id} className="vocab-row">
                <button
                  type="button"
                  className="vocab-word"
                  onClick={() => pronounce(v.word)}
                  title="Pronounce"
                >
                  {v.word}
                </button>
                <div className="vocab-meaning">
                  {v.senses?.[0]?.defs?.[0] ?? v.translation ?? '—'}
                  {v.senses?.[0]?.syns?.length ? (
                    <span className="vocab-syns">{v.senses[0].syns.slice(0, 3).join(' · ')}</span>
                  ) : null}
                </div>
                {src && (
                  <span className="chip chip-ok" title={`From ${src.title}`}>
                    <Star size={10} /> {src.title.slice(0, 18)}
                  </span>
                )}
                <span className={`chip ${v.box >= 5 ? 'chip-done' : v.box >= 3 ? 'chip-ok' : 'chip-soon'}`}>
                  {BOX_LABEL[v.box]}
                </span>
                <span className="mono vocab-due" title="Next review">
                  {dueToday(v) ? 'due' : v.nextReviewAt.slice(5)}
                </span>
                <IconBtn
                  small
                  danger
                  title="Remove word"
                  onClick={() => {
                    if (confirm(`Remove "${v.word}" from your vocabulary?`)) removeVocab(v.id);
                  }}
                >
                  <Trash2 size={13} />
                </IconBtn>
              </div>
            );
          })
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 12.5, padding: '26px 8px' }}>
            {filter === 'due' ? 'Nothing due — come back tomorrow.' : 'No words match.'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- flashcard review ---------- */

function FlashcardReview({
  entries,
  onDone,
  onExit,
  reverse = false,
}: {
  entries: VocabEntry[];
  onDone: (reviewed: number) => void;
  onExit: () => void;
  reverse?: boolean;
}) {
  const reviewVocab = useWB((s) => s.reviewVocab);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  const card = entries[idx];

  const grade = (g: 'again' | 'good' | 'easy') => {
    reviewVocab(card.id, g);
    setReviewed((n) => n + 1);
    setFlipped(false);
    if (idx + 1 >= entries.length) onDone(reviewed + 1);
    else setIdx(idx + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && e.key === '1') grade('again');
      else if (flipped && e.key === '2') grade('good');
      else if (flipped && e.key === '3') grade('easy');
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
     
  }, [flipped, idx]);

  if (!card) {
    onDone(reviewed);
    return null;
  }

  return (
    <div className="fade-in vocab-review">
      <div className="vocab-review-head">
        <span className="mono">{idx + 1} / {entries.length}</span>
        <span className="vocab-review-hint">Space flips · 1 again · 2 good · 3 easy · Esc exits</span>
        <Btn size="sm" variant="ghost" onClick={onExit}><X size={13} /> Exit</Btn>
      </div>

      <button
        type="button"
        className={`vocab-card ${flipped ? 'flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? 'Show word' : 'Reveal meaning'}
      >
        {!flipped ? (
          <div className="vocab-card-front">
            {reverse ? (
              <span className="vocab-card-word vocab-card-word-sm">
                {card.translation || card.senses?.[0]?.defs?.[0] || card.word}
              </span>
            ) : (
              <span className="vocab-card-word">{card.word}</span>
            )}
            <button
              type="button"
              className="icon-btn"
              title="Pronounce"
              onClick={(e) => {
                e.stopPropagation();
                pronounce(card.word);
              }}
            >
              <Volume2x />
            </button>
            <span className="vocab-card-tap">tap or press Space to reveal</span>
          </div>
        ) : (
          <div className="vocab-card-back">
            {reverse && <div className="vocab-card-fa" style={{ borderTop: 'none', paddingTop: 0 }}>{card.word}</div>}
            {card.senses?.map((sense, i) => (
              <div key={i} className="vocab-card-sense">
                <span className="dict-pos">{sense.pos}</span>
                {sense.defs.slice(0, 2).map((d, j) => (
                  <div key={j} className="vocab-card-def">{d}</div>
                ))}
                {sense.ex[0] && <div className="dict-ex">“{sense.ex[0]}”</div>}
                {sense.syns.length > 0 && (
                  <div className="vocab-card-syns">syn: {sense.syns.slice(0, 5).join(', ')}</div>
                )}
              </div>
            ))}
            {card.translation && (
              <div className="vocab-card-fa">{card.translation}</div>
            )}
          </div>
        )}
      </button>

      {flipped && (
        <div className="vocab-grade-row">
          <Btn variant="danger" onClick={() => grade('again')}><RotateCcw size={14} /> Again <kbd className="kbd">1</kbd></Btn>
          <Btn onClick={() => grade('good')}><Check size={14} /> Good <kbd className="kbd">2</kbd></Btn>
          <Btn variant="primary" onClick={() => grade('easy')}><Flame size={14} /> Easy <kbd className="kbd">3</kbd></Btn>
        </div>
      )}
    </div>
  );
}

function Volume2x() {
  /* inline to avoid another import name clash */
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

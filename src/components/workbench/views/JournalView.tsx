/* ==================== Journal View ==================== */
'use client';

import React, { useMemo, useState } from 'react';
import { BookOpen, Check, CalendarDays } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { fmtDateNice, todayStr } from '@/lib/workbench/helpers';
import { dateToShamsi, formatShamsi } from '@/lib/workbench/shamsi';
import { Btn, toast } from '../ui/primitives';

export function JournalView() {
  const journal = useWB((s) => s.journal);
  const today = todayStr();
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const activeDate = editingDate || today;

  const recent = useMemo(
    () => [...journal].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12),
    [journal]
  );

  return (
    <div className="journal-layout fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 18 }}>
      <JournalEditor key={activeDate} date={activeDate} today={today} onBack={editingDate ? () => setEditingDate(null) : null} />

      <div>
        <div className="section-title" style={{ marginTop: 0 }}>Recent entries</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.length ? (
            recent.map((j) => {
              const wc = j.content.trim() ? j.content.trim().split(/\s+/).length : 0;
              return (
                <button
                  key={j.id}
                  type="button"
                  className={`journal-history-item ${j.date === activeDate ? 'active' : ''}`}
                  onClick={() => setEditingDate(j.date === today ? null : j.date)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 650, fontSize: 13 }}>
                      {j.date === today ? 'Today' : fmtDateNice(j.date)}
                    </span>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{wc}w</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {j.content.slice(0, 120) || 'Empty entry'}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="empty-state" style={{ padding: '24px 14px' }}>
              <div className="es-title" style={{ fontSize: 13 }}>No entries yet</div>
              <div style={{ fontSize: 12 }}>Today&apos;s page is blank — start writing.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JournalEditor({ date, today, onBack }: { date: string; today: string; onBack: (() => void) | null }) {
  const saveJournal = useWB((s) => s.saveJournal);
  const entry = useWB((s) => s.journal.find((j) => j.date === date));
  const [content, setContent] = useState(entry?.content || '');
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const shamsi = dateToShamsi(new Date(date + 'T12:00:00'));

  return (
      <div>
        <div className="journal-toolbar" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <div className="wb-display" style={{ fontWeight: 750, fontSize: 21 }}>
              {date === today ? 'Today' : fmtDateNice(date)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted2)', marginTop: 2 }}>
              {formatShamsi(shamsi)} · {wordCount} word{wordCount === 1 ? '' : 's'}
              {date !== today && ' · editing a past entry'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {onBack && (
              <Btn size="sm" onClick={onBack}>
                <CalendarDays size={14} /> Back to today
              </Btn>
            )}
            <Btn
              size="sm"
              variant="primary"
              onClick={() => {
                saveJournal(date, content);
                toast(date === today ? 'Journal saved' : `Entry updated for ${fmtDateNice(date)}`);
              }}
            >
              <Check size={14} /> Save
            </Btn>
          </div>
        </div>

        <div className="card journal-editor" style={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What happened today? What did you learn? How are you feeling?"
            aria-label="Journal content"
          />
          <div className="journal-quote" style={{ marginTop: 'auto' }}>
            <BookOpen size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: -2, color: 'var(--pine)' }} />
            Write for future-you: facts, feelings, and one thing you&apos;d do differently.
          </div>
        </div>
      </div>
  );
}

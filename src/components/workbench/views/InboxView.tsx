/* ==================== Inbox View ==================== */
'use client';

import React from 'react';
import { Sparkles, Pencil, Target, Check, Inbox as InboxIcon } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { fmtDateNice, fmtDuration, isoDate, priorityLabel } from '@/lib/workbench/helpers';
import { Btn, toast } from '../ui/primitives';
import { useViewActions } from './viewCtx';

/* ---------- clarify modal state is handled here via local component ---------- */

export function InboxHeaderActions() {
  const { openCapture } = useViewActions();
  return (
    <Btn size="sm" onClick={openCapture}>
      <Sparkles size={14} /> New capture
    </Btn>
  );
}

export function InboxView() {
  const items = useWB((s) => s.items);
  const updateItem = useWB((s) => s.updateItem);
  const { openCapture, openItemDetail } = useViewActions();

  const inbox = items
    .filter((i) => i.status === 'inbox')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const urgent = inbox.filter((i) => i.priority === 'p0' || i.priority === 'p1').length;

  return (
    <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(280px,.7fr)', gap: 18 }}>
      <div>
        <div className="section-title" style={{ marginTop: 0 }}>Unprocessed · {inbox.length}</div>
        {inbox.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {inbox.map((i) => (
              <div key={i.id} className="inbox-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="inbox-item-title">{i.title}</div>
                  <div className="inbox-item-meta">
                    {i.priority && <span>{priorityLabel(i.priority)}</span>}
                    {i.estimateMin != null && <span>{fmtDuration(i.estimateMin)}</span>}
                    {i.deadline && <span>due {fmtDateNice(i.deadline)}</span>}
                    <span>captured {fmtDateNice(isoDate(new Date(i.createdAt)))}</span>
                  </div>
                </div>
                <div className="inbox-item-actions">
                  <Btn size="sm" onClick={() => openItemDetail(i.id)}>
                    <Pencil size={13} /> Clarify
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    title="Plan for today"
                    onClick={() => {
                      updateItem(i.id, { status: 'todo', startDate: today_() });
                      toast('Planned for today', i.title);
                    }}
                  >
                    <Target size={14} />
                  </Btn>
                  <Btn
                    size="sm"
                    variant="ghost"
                    title="Archive"
                    onClick={() => {
                      updateItem(i.id, { status: 'archived' });
                      toast('Archived', i.title);
                    }}
                  >
                    <Check size={14} />
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--pine-light)', color: 'var(--pine)', margin: '0 auto 14px' }}>
              <InboxIcon size={26} />
            </div>
            <div className="es-title">Your mind is clear.</div>
            <div style={{ marginTop: 6 }}>
              Capture something with <span className="kbd">C</span> whenever it appears.
            </div>
            <Btn variant="primary" onClick={openCapture}>
              <Sparkles size={15} /> Capture something
            </Btn>
          </div>
        )}
      </div>

      <div>
        <div className="section-title" style={{ marginTop: 0 }}>How Inbox works</div>
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              ['01', 'Capture', 'Write the thing exactly as it appears in your head.'],
              ['02', 'Clarify', 'Open an item to add a date, estimate, priority or next action.'],
              ['03', 'Plan', 'Send it to today, or archive it if it no longer matters.'],
            ].map(([num, t, d]) => (
              <div key={num} style={{ display: 'flex', gap: 12 }}>
                <span
                  className="mono"
                  style={{
                    fontWeight: 800, fontSize: 11, color: 'var(--pine)',
                    background: 'var(--pine-light)', borderRadius: 8, padding: '4px 8px', height: 'fit-content',
                  }}
                >
                  {num}
                </span>
                <div>
                  <div style={{ fontWeight: 650, fontSize: 13.5 }}>{t}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted2)', marginTop: 2 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid var(--hairline)', margin: '16px 0' }} />
          {urgent > 0 && (
            <div className="chip chip-soon" style={{ marginBottom: 10 }}>
              {urgent} high-priority capture{urgent === 1 ? '' : 's'} waiting
            </div>
          )}
          <Btn block onClick={openCapture}>
            <Sparkles size={14} /> Quick capture · <span className="kbd">C</span>
          </Btn>
        </div>
      </div>
    </div>
  );
}

function today_(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

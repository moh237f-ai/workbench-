/* ==================== BlinkCare ====================
   Eye-care reminders while reading or focusing: a quiet toast or a gentle
   3-second overlay pulse at a set interval. Mount once in the app root —
   driven by the shared ticker, zero cost while disabled. */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { toast, useNow } from './ui/primitives';

export function BlinkCare() {
  const enabled = useWB((s) => s.blinkReminder);
  const intervalMin = useWB((s) => s.blinkIntervalMin);
  const style = useWB((s) => s.blinkStyle);
  const context = useWB((s) => s.blinkContext);
  const focusOpen = useWB((s) => s.focusOpen);
  const [pulsing, setPulsing] = useState(false);
  const lastShownRef = useRef(0);
  const now = useNow(enabled);

  useEffect(() => {
    if (!enabled || !now) return;
    const inReader = !!document.querySelector('.reader-overlay');
    const active =
      context === 'always' ? true : context === 'focus' ? focusOpen : inReader || focusOpen;
    if (!active) return;
    if (Date.now() - lastShownRef.current < intervalMin * 60_000 - 1_500) return;
    lastShownRef.current = Date.now();
    if (style === 'toast') {
      toast('Blink break 👁️', 'Look 20 feet away for 20 seconds — your eyes will thank you.');
    } else if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPulsing(true);
      setTimeout(() => setPulsing(false), 3000);
    } else {
      toast('Blink break 👁️', 'Look away for a moment.');
    }
  }, [enabled, now, intervalMin, style, context, focusOpen]);

  if (!pulsing) return null;
  return (
    <div className="blink-pulse" role="status" aria-label="Blink reminder — look away briefly">
      <div className="blink-pulse-card">
        <Eye size={22} />
        <div>
          <div className="blink-pulse-title">Blink break</div>
          <div className="blink-pulse-sub">Look away from the screen for a few seconds</div>
        </div>
      </div>
    </div>
  );
}

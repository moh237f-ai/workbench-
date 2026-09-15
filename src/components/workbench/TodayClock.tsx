/* ==================== Today Live Clock Card ==================== */
'use client';

import React from 'react';
import { useWB } from '@/lib/workbench/store';
import { dateToShamsi, formatShamsi } from '@/lib/workbench/shamsi';
import { useNow } from './ui/primitives';

export function TodayClock() {
  const activeTimer = useWB((s) => s.activeTimer);
  const now = useNow();
  const shamsi = dateToShamsi(now);
  const h12 = now.getHours() % 12 || 12;
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';

  return (
    <div className="card today-clock-card">
      <div className="today-clock">
        <div className="today-clock-face" aria-hidden="true">
          <svg viewBox="0 0 120 120" style={{ width: 118, height: 118 }}>
            <circle cx="60" cy="60" r="56" fill="none" stroke="var(--hairline)" />
            <circle cx="60" cy="60" r="50" fill="var(--pine-light)" fillOpacity="0.35" />
            {[...Array(12)].map((_, i) => {
              const a = (i * 30 - 90) * (Math.PI / 180);
              const r = i % 3 === 0 ? 42 : 47;
              return (
                <line
                  key={i}
                  x1={60 + Math.cos(a) * r} y1={60 + Math.sin(a) * r}
                  x2={60 + Math.cos(a) * 51} y2={60 + Math.sin(a) * 51}
                  stroke="var(--muted2)" strokeWidth={i % 3 === 0 ? 1.8 : 0.7}
                  strokeLinecap="round" opacity={i % 3 === 0 ? 0.75 : 0.3}
                />
              );
            })}
            <line
              x1="60" y1="60"
              x2={60 + Math.cos(((h12 * 30 + now.getMinutes() * 0.5 - 90) * Math.PI) / 180) * 27}
              y2={60 + Math.sin(((h12 * 30 + now.getMinutes() * 0.5 - 90) * Math.PI) / 180) * 27}
              stroke="var(--ink)" strokeWidth="3.6" strokeLinecap="round"
            />
            <line
              x1="60" y1="60"
              x2={60 + Math.cos(((now.getMinutes() * 6 + now.getSeconds() * 0.1 - 90) * Math.PI) / 180) * 40}
              y2={60 + Math.sin(((now.getMinutes() * 6 + now.getSeconds() * 0.1 - 90) * Math.PI) / 180) * 40}
              stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" opacity="0.85"
            />
            <line
              x1="60" y1="60"
              x2={60 + Math.cos(((now.getSeconds() * 6 - 90) * Math.PI) / 180) * 45}
              y2={60 + Math.sin(((now.getSeconds() * 6 - 90) * Math.PI) / 180) * 45}
              stroke="var(--pine)" strokeWidth="1.2" strokeLinecap="round"
            />
            <circle cx="60" cy="60" r="4" fill="var(--ink)" />
            <circle cx="60" cy="60" r="2" fill="var(--pine)" />
          </svg>
        </div>
        <div className="today-clock-copy">
          <div className="today-clock-time mono" id="todayClockTime">
            {String(h12).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
            <span style={{ fontSize: 15, color: 'var(--faint)', letterSpacing: 0, marginLeft: 2 }}>
              :{String(now.getSeconds()).padStart(2, '0')}
            </span>
            <span style={{ fontSize: 13, color: 'var(--muted2)', fontWeight: 600, marginLeft: 10 }}>{ampm}</span>
          </div>
          <div className="today-clock-date">
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
          <div className="today-clock-shamsi">{formatShamsi(shamsi)}</div>
          {activeTimer && (
            <div className="chip chip-done" style={{ marginTop: 10, alignSelf: 'flex-start' }}>
              <span className="timer-pill-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--pine)' }} />
              {activeTimer.pomodoro ? 'Focus session running' : 'Timer running'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

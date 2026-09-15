/* ==================== Focus Clocks ==================== */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { dateToShamsi, formatShamsi } from '@/lib/workbench/shamsi';
import { fmtClock } from '@/lib/workbench/helpers';

interface ClockProps {
  now: Date;
  hasTimer: boolean;
  phaseLabel: string;
  remaining: number;
  progress: number;
  cycle: number;
  paused: boolean;
}

/* ---------- Analog ---------- */

export function AnalogClock({ now, hasTimer, progress }: ClockProps) {
  const h = now.getHours() % 12 || 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const ha = h * 30 + m * 0.5;
  const ma = m * 6 + s * 0.1;
  const sa = s * 6;
  const c = 180;
  const R = (angle: number, r: number) => ({
    x: c + Math.cos(((angle - 90) * Math.PI) / 180) * r,
    y: c + Math.sin(((angle - 90) * Math.PI) / 180) * r,
  });
  const hourEnd = R(ha, 90);
  const minEnd = R(ma, 130);
  const secStart = R(sa + 180, 24);
  const secEnd = R(sa, 144);
  const ringR = c - 8;
  const circ = 2 * Math.PI * ringR;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <svg
        className="analog-clock-svg"
        viewBox="0 0 360 360"
        style={{ width: 'min(380px,58vw)', height: 'min(380px,58vw)' }}
        role="img"
        aria-label="Analog clock"
      >
        {hasTimer && (
          <circle
            cx={c} cy={c} r={ringR}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5"
          />
        )}
        {hasTimer && (
          <circle
            cx={c} cy={c} r={ringR}
            fill="none" stroke="var(--pine)" strokeWidth="2.5" strokeOpacity="0.9"
            strokeLinecap="round"
            strokeDasharray={`${circ * (progress / 100)} ${circ}`}
            transform={`rotate(-90 ${c} ${c})`}
            style={{ transition: 'stroke-dasharray 1s linear' }}
          />
        )}
        <circle cx={c} cy={c} r={c - 16} fill="rgba(14,20,16,0.55)" stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
        <circle cx={c} cy={c} r={c - 26} fill="var(--pine)" fillOpacity="0.05" />
        {Array.from({ length: 12 }).map((_, i) => {
          const num = i === 0 ? 12 : i;
          const a = (i * 30 - 90) * (Math.PI / 180);
          return (
            <text
              key={i}
              x={c + Math.cos(a) * (c - 44)}
              y={c + Math.sin(a) * (c - 44) + 6}
              textAnchor="middle" fontSize="19"
              fontFamily="var(--font-jetbrains), monospace" fontWeight="600"
              fill="rgba(230,242,236,0.55)"
            >
              {num}
            </text>
          );
        })}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i * 6 - 90) * (Math.PI / 180);
          const isH = i % 5 === 0;
          const r1 = isH ? c - 58 : c - 54;
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * r1} y1={c + Math.sin(a) * r1}
              x2={c + Math.cos(a) * (c - 48)} y2={c + Math.sin(a) * (c - 48)}
              stroke={isH ? 'rgba(230,242,236,0.5)' : 'rgba(230,242,236,0.14)'}
              strokeWidth={isH ? 2 : 0.5}
              strokeLinecap="round"
            />
          );
        })}
        <line x1={c} y1={c} x2={hourEnd.x} y2={hourEnd.y} stroke="#eef8f3" strokeWidth="6.5" strokeLinecap="round" />
        <line x1={c} y1={c} x2={minEnd.x} y2={minEnd.y} stroke="#eef8f3" strokeWidth="4.2" strokeLinecap="round" opacity="0.88" />
        <line x1={secStart.x} y1={secStart.y} x2={secEnd.x} y2={secEnd.y} stroke="var(--pine)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx={c} cy={c} r="8" fill="#eef8f3" />
        <circle cx={c} cy={c} r="3.2" fill="var(--pine)" />
      </svg>
      <ClockMeta {...{ now, hasTimer, phaseLabel: '', remaining: 0, progress, cycle: 0, paused: false }} showPhase={false} />
    </div>
  );
}

/* ---------- Digital ---------- */

export function DigitalClock({ now, hasTimer, progress }: ClockProps) {
  const h = now.getHours() % 12 || 12;
  const m = now.getMinutes();
  const s = now.getSeconds();
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  const circ = 2 * Math.PI * 130;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
      <div style={{ position: 'relative' }}>
        <svg viewBox="0 0 280 280" style={{ width: 'min(300px,62vw)', height: 'min(300px,62vw)' }} aria-hidden="true">
          <circle cx="140" cy="140" r="130" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="2" />
          {hasTimer && (
            <>
              <circle cx="140" cy="140" r="130" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
              <circle
                cx="140" cy="140" r="130"
                fill="none" stroke="var(--pine)" strokeWidth="3.5" strokeLinecap="round"
                strokeDasharray={`${circ * (progress / 100)} ${circ}`}
                transform="rotate(-90 140 140)"
                style={{ transition: 'stroke-dasharray 1s linear' }}
              />
            </>
          )}
        </svg>
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div className="digital-time" style={{ fontSize: 'min(62px,11vw)' }}>
            {String(h).padStart(2, '0')}
            <span style={{ color: 'rgba(230,242,236,0.35)' }}>:</span>
            {String(m).padStart(2, '0')}
          </div>
          <div style={{ display: 'flex', gap: 9, marginTop: 10, alignItems: 'baseline' }}>
            <span className="mono" style={{ fontSize: 19, color: 'rgba(230,242,236,0.55)' }}>:{String(s).padStart(2, '0')}</span>
            <span style={{ fontSize: 13, fontWeight: 650, color: 'rgba(230,242,236,0.55)' }}>{ampm}</span>
          </div>
        </div>
      </div>
      <ClockMeta {...{ now, hasTimer, phaseLabel: '', remaining: 0, progress, cycle: 0, paused: false }} showPhase={false} />
    </div>
  );
}

/* ---------- Minimal ---------- */

export function MinimalClock({ now, hasTimer, phaseLabel, remaining, progress, cycle, paused }: ClockProps) {
  const timeStr = hasTimer
    ? fmtClock(remaining)
    : fmtClock(now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds());
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      {hasTimer && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.22em',
            fontWeight: 650, color: 'rgba(230,242,236,0.6)',
          }}
        >
          {phaseLabel === 'Focus' ? '🧠' : phaseLabel === 'Break' ? '☕' : '⏱'} {phaseLabel}
          {cycle > 0 && <span style={{ color: 'rgba(230,242,236,0.4)' }}>· CYCLE {cycle}</span>}
          {paused && <span style={{ color: 'var(--amber)' }}>· PAUSED</span>}
        </div>
      )}
      <div className="minimal-time" style={{ fontSize: 'min(128px,19vw)' }}>{timeStr}</div>
      {hasTimer && (
        <div
          style={{
            width: 'min(340px,56vw)', height: 6,
            background: 'rgba(255,255,255,0.14)', borderRadius: 99, overflow: 'hidden',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              height: '100%', borderRadius: 99,
              background: 'linear-gradient(90deg,var(--aurora-1),var(--aurora-3))',
              width: `${progress}%`, transition: 'width 1s linear',
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ---------- Flip (true split-flap) ---------- */

function FlipDigit({ digit }: { digit: string }) {
  const [prev, setPrev] = useState(digit);
  const flipping = digit !== prev;

  useEffect(() => {
    if (!flipping) return;
    const t = setTimeout(() => setPrev(digit), 640);
    return () => clearTimeout(t);
  }, [flipping, digit]);

  const oldDigit = flipping ? prev : digit;
  const newDigit = digit;

  return (
    <div className="flip-unit" aria-label={digit}>
      <div className="flip-half flip-top-static"><span>{newDigit}</span></div>
      <div className="flip-half flip-bottom-static"><span>{flipping ? oldDigit : newDigit}</span></div>
      {flipping && (
        <>
          <div className="flip-half flip-old-top is-flipping"><span>{oldDigit}</span></div>
          <div className="flip-half flip-new-bottom is-flipping"><span>{newDigit}</span></div>
        </>
      )}
      <div className="flip-shadow" />
    </div>
  );
}

export function FlipClock({ now, hasTimer, phaseLabel, remaining }: ClockProps) {
  const h = now.getHours() % 12 || 12;
  const display = hasTimer
    ? [Math.floor(remaining / 3600), Math.floor((remaining % 3600) / 60), remaining % 60]
    : [h, now.getMinutes(), now.getSeconds()];
  const labels = ['HOURS', 'MINUTES', 'SECONDS'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
      {hasTimer && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.2em',
            fontWeight: 700, color: 'rgba(230,242,236,0.6)',
          }}
        >
          {phaseLabel === 'Focus' ? '🧠' : '☕'} {phaseLabel} PHASE
        </div>
      )}
      <div className="flip-board">
        {display.map((val, i) => {
          const str = String(val).padStart(2, '0');
          return (
            <React.Fragment key={i}>
              <div className="flip-group">
                <FlipDigit digit={str[0]} />
                <FlipDigit digit={str[1]} />
              </div>
              {i < display.length - 1 && <div className="flip-separator">:</div>}
            </React.Fragment>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 22 }}>
        {labels.map((l) => (
          <div key={l} className="flip-label" style={{ flex: 1, textAlign: 'center' }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Shared meta (date + phase) ---------- */

export function ClockMeta({
  now,
  hasTimer,
  phaseLabel,
  remaining,
  cycle,
  paused,
  showPhase = true,
}: ClockProps & { showPhase?: boolean }) {
  const shamsi = dateToShamsi(now);
  return (
    <div className="focus-clock-meta">
      {hasTimer && showPhase && (
        <div className="focus-meta-phase">
          {phaseLabel === 'Focus' ? '🧠 Focus phase' : phaseLabel === 'Break' ? '☕ Break phase' : '⏱ Timer running'}
          {cycle > 0 && <span style={{ color: '#91a79f' }}>· Cycle {cycle}</span>}
          <span style={{ color: '#91a79f' }}>
            · {fmtClock(remaining)} {paused ? '(paused)' : phaseLabel === 'Timer' ? 'elapsed' : 'left'}
          </span>
        </div>
      )}
      <div className="focus-meta-date">
        {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
      <div className="focus-meta-shamsi">{formatShamsi(shamsi)}</div>
    </div>
  );
}

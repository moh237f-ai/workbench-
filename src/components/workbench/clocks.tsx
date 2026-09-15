/* ==================== Focus Clocks v6 ====================
   Four all-new clock faces — every face is timer-aware: while a session
   runs it renders the countdown/elapsed + phase + progress, otherwise the
   wall clock. All faces take an accent color and render both calendars. */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { dateToShamsi, formatShamsi } from '@/lib/workbench/shamsi';
import { fmtClock } from '@/lib/workbench/helpers';

export interface ClockProps {
  now: Date;
  hasTimer: boolean;
  phaseLabel: string; // 'Free' | 'Focus' | 'Break' | 'Timer'
  remaining: number; // seconds (pomodoro: left · plain timer: elapsed)
  progress: number; // 0-100
  cycle: number;
  paused: boolean;
  accent: string; // hex
}

/* ---------- shared helpers ---------- */

/** h:mm:ss when ≥1h, else mm:ss */
function dispClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 3600) return fmtClock(s);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface Face {
  /** main display text */
  time: string;
  /** small line under the digits */
  sub: string;
  isTimer: boolean;
}

function faceOf(p: ClockProps): Face {
  if (p.hasTimer) {
    const countdown = p.phaseLabel !== 'Timer';
    return {
      time: countdown ? dispClock(p.remaining) : dispClock(p.remaining),
      sub: p.phaseLabel,
      isTimer: true,
    };
  }
  const h12 = p.now.getHours() % 12 || 12;
  const ampm = p.now.getHours() >= 12 ? 'PM' : 'AM';
  return {
    time: `${String(h12).padStart(2, '0')}:${String(p.now.getMinutes()).padStart(2, '0')}`,
    sub: `${ampm} · ${String(p.now.getSeconds()).padStart(2, '0')}s`,
    isTimer: false,
  };
}

function dateLines(now: Date): { g: string; shamsi: string } {
  return {
    g: now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    shamsi: formatShamsi(dateToShamsi(now)),
  };
}

function PhasePill({ p, accent }: { p: ClockProps; accent: string }) {
  if (!p.hasTimer) return null;
  const emoji = p.phaseLabel === 'Focus' ? '🧠' : p.phaseLabel === 'Break' ? '☕' : '⏱';
  return (
    <div className="fc-pill" style={{ color: accent, borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`, background: `color-mix(in srgb, ${accent} 12%, transparent)` }}>
      <span aria-hidden="true">{emoji}</span>
      {p.phaseLabel.toUpperCase()}
      {p.cycle > 0 && <span style={{ opacity: 0.7 }}>· CYCLE {p.cycle}</span>}
      {p.paused && <span style={{ color: '#FBBF24' }}>· PAUSED</span>}
    </div>
  );
}

function MetaDate({ now }: { now: Date }) {
  const d = dateLines(now);
  return (
    <div className="fc-date">
      <span>{d.g}</span>
      <span className="fc-date-shamsi" aria-hidden="true">{d.shamsi}</span>
    </div>
  );
}

/* ================= 1 — AURA =================
   Flagship face: huge digits inside a thin progress arc ring. */

export function AuraClock(p: ClockProps) {
  const f = faceOf(p);
  const R = 178;
  const C = 2 * Math.PI * R;
  const pct = p.hasTimer ? Math.min(100, Math.max(0, p.progress)) : 0;
  return (
    <div className="fc-aura">
      <svg viewBox="0 0 400 400" className="fc-aura-svg" aria-hidden="true">
        <circle cx="200" cy="200" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
        {p.hasTimer && (
          <circle
            cx="200" cy="200" r={R}
            fill="none" stroke={p.accent} strokeWidth="3.5" strokeLinecap="round"
            strokeDasharray={`${(C * pct) / 100} ${C}`}
            transform="rotate(-90 200 200)"
            style={{ transition: 'stroke-dasharray 1s linear', filter: `drop-shadow(0 0 10px color-mix(in srgb, ${p.accent} 55%, transparent))` }}
          />
        )}
        {/* minute ticks */}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i * 6 - 90) * (Math.PI / 180);
          const isQ = i % 15 === 0;
          const r1 = R - 14;
          const r2 = R - (isQ ? 8 : 11);
          return (
            <line
              key={i}
              x1={200 + Math.cos(a) * r1} y1={200 + Math.sin(a) * r1}
              x2={200 + Math.cos(a) * r2} y2={200 + Math.sin(a) * r2}
              stroke={isQ ? 'rgba(230,242,236,0.35)' : 'rgba(230,242,236,0.1)'}
              strokeWidth={isQ ? 1.8 : 1}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="fc-aura-center">
        <PhasePill p={p} accent={p.accent} />
        <div className="fc-aura-time">{f.time}</div>
        <div className="fc-aura-sub">
          <span className="fc-dot" style={{ background: p.accent }} aria-hidden="true" />
          {f.isTimer ? (p.phaseLabel === 'Timer' ? 'elapsed' : 'remaining') : f.sub}
        </div>
        <MetaDate now={p.now} />
      </div>
    </div>
  );
}

/* ================= 2 — ORBIT =================
   Ring of 60 dots; filled dots mark progress. */

export function OrbitClock(p: ClockProps) {
  const f = faceOf(p);
  const R = 170;
  const totalDots = 60;
  const filled = p.hasTimer
    ? Math.round((Math.min(100, Math.max(0, p.progress)) / 100) * totalDots)
    : Math.round(((p.now.getMinutes() * 60 + p.now.getSeconds()) / 3600) * totalDots);
  return (
    <div className="fc-orbit">
      <svg viewBox="0 0 400 400" className="fc-orbit-svg" aria-hidden="true">
        {Array.from({ length: totalDots }).map((_, i) => {
          const a = (i * 6 - 90) * (Math.PI / 180);
          const x = 200 + Math.cos(a) * R;
          const y = 200 + Math.sin(a) * R;
          const on = i < filled;
          const big = i % 5 === 0;
          return (
            <circle
              key={i}
              cx={x} cy={y}
              r={big ? 4.4 : 2.8}
              fill={on ? p.accent : 'rgba(230,242,236,0.14)'}
              style={on ? { filter: `drop-shadow(0 0 6px color-mix(in srgb, ${p.accent} 60%, transparent))` } : undefined}
            />
          );
        })}
        {/* orbiting second marker (wall mode) */}
        {!p.hasTimer && (() => {
          const a = (p.now.getSeconds() * 6 - 90) * (Math.PI / 180);
          return (
            <circle
              cx={200 + Math.cos(a) * (R - 26)} cy={200 + Math.sin(a) * (R - 26)}
              r="6" fill={p.accent}
              style={{ filter: `drop-shadow(0 0 9px color-mix(in srgb, ${p.accent} 70%, transparent))` }}
            />
          );
        })()}
      </svg>
      <div className="fc-orbit-center">
        <PhasePill p={p} accent={p.accent} />
        <div className="fc-orbit-time">{f.time}</div>
        <div className="fc-orbit-sub">
          {f.isTimer ? `${Math.round(Math.min(100, Math.max(0, p.progress)))}%` : f.sub}
        </div>
        <MetaDate now={p.now} />
      </div>
    </div>
  );
}

/* ================= 3 — CARDS =================
   Modern split-flap cards with accent tab — full flip animation. */

function CardDigit({ digit, accent }: { digit: string; accent: string }) {
  const [prev, setPrev] = useState(digit);
  const flipping = digit !== prev;
  useEffect(() => {
    if (!flipping) return;
    const t = setTimeout(() => setPrev(digit), 600);
    return () => clearTimeout(t);
  }, [flipping, digit]);
  const oldDigit = flipping ? prev : digit;
  return (
    <div className="fc-card-unit" aria-label={digit}>
      <div className="fc-card-half fc-card-top-static"><span>{digit}</span></div>
      <div className="fc-card-half fc-card-bottom-static"><span>{flipping ? oldDigit : digit}</span></div>
      {flipping && (
        <>
          <div className="fc-card-half fc-card-old-top is-flipping"><span>{oldDigit}</span></div>
          <div className="fc-card-half fc-card-new-bottom is-flipping"><span>{digit}</span></div>
        </>
      )}
      <div className="fc-card-seam" style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${accent} 55%, #000 45%) 50%, transparent)` }} />
    </div>
  );
}

export function CardsClock(p: ClockProps) {
  const f = faceOf(p);
  const secsTotal = p.hasTimer ? p.remaining : p.now.getHours() * 3600 + p.now.getMinutes() * 60 + p.now.getSeconds();
  const useHours = p.hasTimer
    ? p.phaseLabel === 'Timer' || secsTotal >= 3600
    : true;
  const h = Math.floor(secsTotal / 3600);
  const m = Math.floor((secsTotal % 3600) / 60);
  const s = secsTotal % 60;
  const wall12 = p.now.getHours() % 12 || 12;
  const display = useHours
    ? [h, m, s]
    : [m, s];
  const labels = useHours ? ['HOURS', 'MINUTES', 'SECONDS'] : ['MINUTES', 'SECONDS'];
  return (
    <div className="fc-cards">
      <PhasePill p={p} accent={p.accent} />
      <div className="fc-cards-board">
        {display.map((val, i) => {
          const str = String(val).padStart(2, '0');
          return (
            <React.Fragment key={i}>
              <div className="fc-cards-group">
                <CardDigit digit={str[0]} accent={p.accent} />
                <CardDigit digit={str[1]} accent={p.accent} />
              </div>
              {i < display.length - 1 && <div className="fc-cards-sep" style={{ color: p.accent }}>:</div>}
            </React.Fragment>
          );
        })}
      </div>
      <div className="fc-cards-labels">
        {labels.map((l) => (
          <div key={l} className="fc-cards-label" style={{ flex: 1, textAlign: 'center' }}>{l}</div>
        ))}
      </div>
      {!p.hasTimer && (
        <div className="fc-cards-sub" style={{ color: p.accent }}>
          {f.sub}
        </div>
      )}
      <MetaDate now={p.now} />
    </div>
  );
}

/* ================= 4 — TYPO =================
   Pure typography — enormous thin numerals, zero chrome. */

export function TypoClock(p: ClockProps) {
  const f = faceOf(p);
  return (
    <div className="fc-typo">
      <div className="fc-typo-phase" style={{ color: p.accent }}>
        {p.hasTimer ? p.phaseLabel.toUpperCase() : 'NOW'}
        {p.hasTimer && p.paused && <span style={{ color: '#FBBF24' }}> · PAUSED</span>}
        {p.hasTimer && p.cycle > 0 && <span style={{ opacity: 0.65 }}> · {p.cycle}</span>}
      </div>
      <div className="fc-typo-time">{f.time}</div>
      <div className="fc-typo-sub">
        {f.isTimer ? (p.phaseLabel === 'Timer' ? 'elapsed' : 'remaining') : f.sub}
        {f.isTimer && !p.paused && (
          <span className="fc-typo-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, p.progress))}%`, background: p.accent }} />
          </span>
        )}
      </div>
      <MetaDate now={p.now} />
    </div>
  );
}

/* ---------- legacy-free export map ---------- */

export const CLOCK_FACES = {
  aura: AuraClock,
  orbit: OrbitClock,
  cards: CardsClock,
  typo: TypoClock,
} as const;

export type ClockFaceId = keyof typeof CLOCK_FACES;

export function ClockFace({ id, ...props }: ClockProps & { id: string }) {
  const Face = (CLOCK_FACES as Record<string, React.ComponentType<ClockProps>>)[id] || AuraClock;
  return <Face {...props} />;
}

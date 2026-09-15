/* ==================== Focus Mode Overlay ==================== */
'use client';

import React, { useEffect, useState } from 'react';
import {
  Play, Pause, Square, SkipForward, X, Maximize2, Minus, Image as ImageIcon,
  Focus as FocusIcon, Target, Clock, Sparkles,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { getFocusTiming } from '@/lib/workbench/helpers';
import { FOCUS_BACKGROUNDS, FOCUS_PRESETS } from '@/lib/workbench/types';
import type { ClockType } from '@/lib/workbench/types';
import { AnalogClock, DigitalClock, FlipClock, MinimalClock } from '../clocks';
import { toast, useNow } from '../ui/primitives';

const CLOCK_TYPES: { id: ClockType; label: string; icon: React.ReactNode }[] = [
  { id: 'analog', label: 'Analog', icon: <Clock size={14} /> },
  { id: 'digital', label: 'Digital', icon: <Target size={14} /> },
  { id: 'minimal', label: 'Minimal', icon: <FocusIcon size={14} /> },
  { id: 'flip', label: 'Flip', icon: <Sparkles size={14} /> },
];

export function FocusMode() {
  const focusOpen = useWB((s) => s.focusOpen);
  const activeTimer = useWB((s) => s.activeTimer);
  const items = useWB((s) => s.items);
  const clockType = useWB((s) => s.focusClockType);
  const background = useWB((s) => s.focusBackground);
  const preset = useWB((s) => s.focusPreset);
  const compact = useWB((s) => s.focusCompact);
  const customWork = useWB((s) => s.focusCustomWork);
  const customBreak = useWB((s) => s.focusCustomBreak);

  const setFocusOpen = useWB((s) => s.setFocusOpen);
  const setClockType = useWB((s) => s.setFocusClockType);
  const setBackground = useWB((s) => s.setFocusBackground);
  const setPreset = useWB((s) => s.setFocusPreset);
  const toggleCompact = useWB((s) => s.toggleFocusCompact);
  const startPomodoro = useWB((s) => s.startPomodoro);
  const pausePomodoro = useWB((s) => s.pausePomodoro);
  const resumePomodoro = useWB((s) => s.resumePomodoro);
  const advancePomodoro = useWB((s) => s.advancePomodoro);
  const stopTimer = useWB((s) => s.stopTimer);

  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const now = useNow(focusOpen);

  const timing = getFocusTiming(activeTimer, now.getTime());
  const hasTimer = !!activeTimer;
  const pomodoro = activeTimer?.pomodoro || null;
  const paused = timing.paused;

  /* Auto-advance pomodoro phases globally while focus is open */
  useEffect(() => {
    if (!focusOpen) return;
    if (pomodoro && !paused && timing.remaining <= 0) {
      advancePomodoro();
      toast(
        pomodoro.phase === 'work' ? 'Break time! ☕' : 'Back to work! 🧠',
        pomodoro.phase === 'work'
          ? 'Focus phase logged. Take a real break.'
          : 'Break over — next cycle starts now.'
      );
    }
  }, [focusOpen, pomodoro, paused, timing.remaining, advancePomodoro]);

  /* Esc exits focus mode (timer keeps running) */
  useEffect(() => {
    if (!focusOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFocusOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusOpen, setFocusOpen]);

  if (!focusOpen) return null;

  const focusItem = activeTimer?.itemIds?.[0]
    ? items.find((i) => i.id === activeTimer.itemIds[0])
    : null;
  const contextTitle = focusItem?.title || 'Open focus space';
  const contextNext =
    focusItem?.nextAction ||
    (activeTimer?.note ? activeTimer.note : 'No task selected — focus on one useful thing.');

  const presetObj = FOCUS_PRESETS.find((p) => p.id === preset) || FOCUS_PRESETS[0];
  const workMin = preset === 'custom' ? customWork : presetObj.workMin;
  const breakMin = preset === 'custom' ? customBreak : presetObj.breakMin;

  const clockProps = {
    now,
    hasTimer,
    phaseLabel: timing.phaseLabel,
    remaining: timing.remaining,
    progress: timing.progress,
    cycle: timing.cycleCount,
    paused,
  };

  return (
    <div
      className={`focus-overlay fb-${background} ${compact ? 'focus-compact' : ''} ${bgPanelOpen ? 'show-bg-panel' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
    >
      <div className="focus-shell-frame" />

      <div className="focus-topbar">
        <div className="focus-context-card">
          <div className="focus-context-icon">
            {hasTimer ? <Play size={15} /> : <FocusIcon size={15} />}
          </div>
          <div>
            <div className="focus-context-kicker">
              {hasTimer ? (pomodoro ? `${timing.phaseLabel} window` : 'Timer running') : 'Focus workspace'}
            </div>
            <div className="focus-context-title">{contextTitle}</div>
            <div className="focus-context-next">{contextNext}</div>
          </div>
        </div>
        <div className="focus-clock-selector" role="tablist" aria-label="Clock style">
          {CLOCK_TYPES.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={clockType === c.id}
              className={clockType === c.id ? 'active' : ''}
              onClick={() => setClockType(c.id)}
              type="button"
            >
              {c.icon}
              <span className="lbl">{c.label}</span>
            </button>
          ))}
        </div>
        <button
          className="focus-mini-tool"
          title="Fullscreen"
          aria-label="Toggle fullscreen"
          onClick={() => {
            const el = document.getElementById('focus-overlay-root');
            if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {});
            else document.exitFullscreen?.().catch(() => {});
          }}
          type="button"
        >
          <Maximize2 size={15} />
        </button>
      </div>

      <button
        className="focus-exit"
        onClick={() => setFocusOpen(false)}
        aria-label="Exit focus mode"
        title="Exit focus mode (Esc)"
        type="button"
      >
        <X />
      </button>

      <div className="focus-stage-label">
        {pomodoro
          ? timing.phaseLabel === 'Focus'
            ? 'Deep work window'
            : 'Recovery window'
          : hasTimer
            ? 'Live timer'
            : 'Live clock'}
      </div>

      <div className="focus-stage" id="focus-overlay-root">
        <div className="focus-display" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {clockType === 'analog' && <AnalogClock {...clockProps} />}
          {clockType === 'digital' && <DigitalClock {...clockProps} />}
          {clockType === 'minimal' && <MinimalClock {...clockProps} />}
          {clockType === 'flip' && <FlipClock {...clockProps} />}
        </div>
      </div>

      <div className="focus-bg-panel">
        <div className="focus-bg-panel-inner">
          <div className="focus-bg-panel-title">Focus atmosphere</div>
          <div className="focus-bg-grid">
            {FOCUS_BACKGROUNDS.map((b) => (
              <button
                key={b}
                className={`focus-bg-card ${background === b ? 'active' : ''}`}
                onClick={() => setBackground(b)}
                type="button"
              >
                <span className="focus-bg-swatch" />
                {b.charAt(0).toUpperCase() + b.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="focus-controls">
        <div className="focus-session-strip">
          <button
            className="focus-mini-tool"
            title="Change background"
            aria-label="Change background"
            onClick={() => setBgPanelOpen((v) => !v)}
            type="button"
          >
            <ImageIcon size={15} />
          </button>
          {hasTimer ? (
            <div className="focus-status-line">
              {pomodoro
                ? `${timing.phaseLabel} · ${timing.remaining > 0 ? formatRem(timing.remaining) : 'switching…'} ${paused ? '· paused' : 'remaining'} · cycle ${Math.max(1, timing.cycleCount)}`
                : 'Timer running'}
              {focusItem?.estimateMin ? ` · ${focusItem.estimateMin}m estimated` : ''}
            </div>
          ) : (
            <div className="focus-status-line">
              Choose a rhythm, then start. <span className="focus-kbd">F</span> returns here ·{' '}
              <span className="focus-kbd">Esc</span> exits
            </div>
          )}
          <button
            className="focus-mini-tool"
            title={compact ? 'Show controls' : 'Reduce controls'}
            aria-label="Toggle compact mode"
            onClick={toggleCompact}
            type="button"
          >
            <Minus size={15} />
          </button>
        </div>

        <div className="focus-preset-bar" aria-label="Focus presets">
          {FOCUS_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`focus-preset ${preset === p.id ? 'active' : ''}`}
              disabled={hasTimer}
              onClick={() => setPreset(p.id)}
              type="button"
              title={p.id === 'custom' ? `${customWork} / ${customBreak} — change in settings` : `${p.workMin} min work / ${p.breakMin} min break`}
            >
              {p.label}
              <small>{p.id === 'custom' ? `${customWork} / ${customBreak}` : `${p.workMin} / ${p.breakMin}`}</small>
            </button>
          ))}
        </div>

        <div className="focus-action-dock">
          {!hasTimer ? (
            <button className="focus-btn focus-btn-primary" onClick={() => startPomodoro()} type="button">
              <Play /> Start {workMin} min focus
            </button>
          ) : pomodoro ? (
            <>
              {paused ? (
                <button className="focus-btn focus-btn-primary" onClick={resumePomodoro} type="button">
                  <Play /> Resume
                </button>
              ) : (
                <button className="focus-btn focus-btn-outline" onClick={pausePomodoro} type="button">
                  <Pause /> Pause
                </button>
              )}
              <button
                className="focus-btn focus-btn-outline"
                onClick={() => advancePomodoro()}
                type="button"
              >
                <SkipForward /> {pomodoro.phase === 'work' ? 'Take break' : 'Next cycle'}
              </button>
              <button
                className="focus-btn focus-btn-danger"
                onClick={() => {
                  stopTimer();
                  toast('Session ended', 'Time logged to your Activity Log.');
                }}
                type="button"
              >
                <Square /> End session
              </button>
            </>
          ) : (
            <button
              className="focus-btn focus-btn-danger"
              onClick={() => {
                stopTimer();
                toast('Timer stopped', 'Time logged to your Activity Log.');
              }}
              type="button"
            >
              <Square /> End timer
            </button>
          )}
        </div>
        {preset === 'custom' && !hasTimer && (
          <PresetCustomInputs />
        )}
        {!compact && (
          <div className="focus-hint" style={{ fontSize: 10.5, color: '#60766e' }}>
            {hasTimer
              ? 'Timer keeps running if you exit — stop it from the sidebar.'
              : `Rhythm ${workMin} / ${breakMin} · sessions log automatically`}
          </div>
        )}
      </div>
    </div>
  );
}

function formatRem(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function PresetCustomInputs() {
  const customWork = useWB((s) => s.focusCustomWork);
  const customBreak = useWB((s) => s.focusCustomBreak);
  const setFocusCustom = useWB((s) => s.setFocusCustom);
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center',
    padding: '8px 14px', borderRadius: 14,
    background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)',
    fontSize: 12, color: '#b9cbc3', fontWeight: 600,
  };
  const inputStyle: React.CSSProperties = {
    width: 64, padding: '6px 9px', borderRadius: 9,
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#eef8f3', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13, fontWeight: 700,
    outline: 'none', textAlign: 'center',
  };
  return (
    <div style={rowStyle}>
      <span>Custom rhythm</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        work
        <input
          type="number" min={5} max={180} value={customWork}
          style={inputStyle}
          onChange={(e) => setFocusCustom(Math.max(1, Number(e.target.value) || 25), customBreak)}
          aria-label="Work minutes"
        />
        min
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        break
        <input
          type="number" min={1} max={60} value={customBreak}
          style={inputStyle}
          onChange={(e) => setFocusCustom(customWork, Math.max(1, Number(e.target.value) || 5))}
          aria-label="Break minutes"
        />
        min
      </label>
    </div>
  );
}

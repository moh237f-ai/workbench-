/* ==================== Focus Mode v6 ====================
   - Photo atmospheres + user-uploaded backgrounds (local files)
   - All-new timer-aware clock faces, movable / sizable / colorable
   - Fullscreen keeps the background (fullscreen targets the overlay itself)
   - Auto-coloring: UI chrome follows the atmosphere's accent color */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Pause, Square, SkipForward, X, Maximize2, Minus, Image as ImageIcon,
  Focus as FocusIcon, Target, Clock, Sparkles, BookOpen, Orbit, Layers, Type,
  Activity, Plus, SlidersHorizontal, Move, ImagePlus, Palette, Trash2, RotateCcw,
} from 'lucide-react';
import { useWB, wbFilePositionLabel, wbFileProgress, wbFileReadPages } from '@/lib/workbench/store';
import { getFocusTiming } from '@/lib/workbench/helpers';
import { FOCUS_BACKGROUNDS, FOCUS_BG_META, FOCUS_PRESETS, PEN_SWATCHES } from '@/lib/workbench/types';
import type { ClockType, FocusBackgroundId } from '@/lib/workbench/types';
import { ClockFace } from '../clocks';
import { toast, useNow } from '../ui/primitives';

const CLOCK_TYPES: { id: ClockType; label: string; icon: React.ReactNode }[] = [
  { id: 'aura', label: 'Aura', icon: <Activity size={14} /> },
  { id: 'orbit', label: 'Orbit', icon: <Orbit size={14} /> },
  { id: 'cards', label: 'Cards', icon: <Layers size={14} /> },
  { id: 'typo', label: 'Typo', icon: <Type size={14} /> },
];

const CLOCK_ACCENTS = [...PEN_SWATCHES.slice(0, 5), '#2DD4BF', '#FBBF24'];

/** Downscale an image file to a JPEG dataURL (max 1600w) + extract a dominant accent. */
async function importBackgroundFile(
  file: File
): Promise<{ dataUrl: string; accent: string } | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return null;
    const MAX_W = 1600;
    const scale = Math.min(1, MAX_W / (img.naturalWidth || MAX_W));
    const w = Math.max(320, Math.round(img.naturalWidth * scale));
    const h = Math.round((img.naturalHeight || w * 0.6) * (w / (img.naturalWidth || w)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

    /* dominant accent: sample a small grid, weight by saturation, avoid extremes */
    const sw = 36;
    const sh = Math.max(8, Math.round((h / w) * sw));
    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    if (sctx) {
      sctx.drawImage(img, 0, 0, sw, sh);
      const data = sctx.getImageData(0, 0, sw, sh).data;
      let rx = 0;
      let gy = 0;
      let bl = 0;
      let wsum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 510;
        const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255) || 1);
        /* prefer colorful mid-tones */
        const weight = Math.max(0, sat * (1 - Math.abs(l - 0.55) * 1.6));
        rx += r * weight;
        gy += g * weight;
        bl += b * weight;
        wsum += weight;
      }
      if (wsum > 0.001) {
        let r = rx / wsum;
        let g = gy / wsum;
        let b = bl / wsum;
        const boost = (c: number) => Math.round(Math.min(255, Math.max(0, 0.5 + (c / 255) * 0.5) * 255));
        r = boost(r);
        g = boost(g);
        b = boost(b);
        const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
        return { dataUrl, accent: hex };
      }
    }
    return { dataUrl, accent: '#2DD4BF' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FocusMode() {
  const focusOpen = useWB((s) => s.focusOpen);
  const activeTimer = useWB((s) => s.activeTimer);
  const items = useWB((s) => s.items);
  const files = useWB((s) => s.files);
  const clockType = useWB((s) => s.focusClockType);
  const preset = useWB((s) => s.focusPreset);
  const compact = useWB((s) => s.focusCompact);
  const customWork = useWB((s) => s.focusCustomWork);
  const customBreak = useWB((s) => s.focusCustomBreak);
  const customBgs = useWB((s) => s.focusCustomBgs);
  const clockCfg = useWB((s) => s.focusClockCfg);
  const focusAutoColor = useWB((s) => s.focusAutoColor);

  const setFocusOpen = useWB((s) => s.setFocusOpen);
  const setClockType = useWB((s) => s.setFocusClockType);
  const setBackground = useWB((s) => s.setFocusBackground);
  const setPreset = useWB((s) => s.setFocusPreset);
  const toggleCompact = useWB((s) => s.toggleFocusCompact);
  const setClockCfg = useWB((s) => s.setFocusClockCfg);
  const resetClockCfg = useWB((s) => s.resetFocusClockCfg);
  const addFocusCustomBg = useWB((s) => s.addFocusCustomBg);
  const removeFocusCustomBg = useWB((s) => s.removeFocusCustomBg);
  const startPomodoro = useWB((s) => s.startPomodoro);
  const pausePomodoro = useWB((s) => s.pausePomodoro);
  const resumePomodoro = useWB((s) => s.resumePomodoro);
  const advancePomodoro = useWB((s) => s.advancePomodoro);
  const stopTimer = useWB((s) => s.stopTimer);

  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const [clockPop, setClockPop] = useState(false);
  const [importingBg, setImportingBg] = useState(false);
  const [livePos, setLivePos] = useState<{ x: number; y: number } | null>(null);
  const now = useNow(focusOpen);

  /* guard legacy persisted ids (v4 flow/nebula/… and v5 analog/digital/minimal/flip) */
  const storedBg = useWB((s) => s.focusBackground);
  const isCustomBg = storedBg.startsWith('custom:');
  const customBg = isCustomBg ? customBgs.find((b) => b.id === storedBg.slice(7)) || null : null;
  const background: string =
    customBg || FOCUS_BACKGROUNDS.includes(storedBg as FocusBackgroundId)
      ? storedBg
      : 'aurora';
  const bgClass = customBg ? 'fb-custom' : `fb-${background}`;

  /* ---------- accents: clock color + auto UI color ---------- */
  const bgAccent = customBg
    ? customBg.accent
    : FOCUS_BG_META.find((m) => m.id === background)?.accent || '#2DD4BF';
  const clockAccent = clockCfg.accent === 'auto' ? bgAccent : clockCfg.accent;
  const uiAccent = focusAutoColor ? bgAccent : 'var(--pine)';

  const timing = getFocusTiming(activeTimer, now.getTime());
  const hasTimer = !!activeTimer;
  const pomodoro = activeTimer?.pomodoro || null;
  const paused = timing.paused;

  /* Esc exits focus mode · B cycles atmosphere · ] size up · [ size down */
  useEffect(() => {
    if (!focusOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        e.preventDefault();
        setFocusOpen(false);
      } else if (inField) {
        return;
      } else if (e.key === 'b' || e.key === 'B') {
        const cur = (FOCUS_BACKGROUNDS as readonly string[]).indexOf(background);
        const next = FOCUS_BACKGROUNDS[(cur + 1) % FOCUS_BACKGROUNDS.length];
        setBackground(next);
        toast(`Atmosphere · ${FOCUS_BG_META.find((m) => m.id === next)?.label ?? next}`, 'Press B again to keep exploring.');
      } else if (e.key === ']') {
        setClockCfg({ size: Math.min(170, clockCfg.size + 10) });
      } else if (e.key === '[') {
        setClockCfg({ size: Math.max(60, clockCfg.size - 10) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusOpen, background, clockCfg.size, setFocusOpen, setBackground, setClockCfg]);

  /* ---------- draggable clock (position % persisted on release) ---------- */
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const onClockPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        ox: clockCfg.xPct,
        oy: clockCfg.yPct,
      };
      setLivePos({ x: clockCfg.xPct, y: clockCfg.yPct });
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* best effort */
      }
      e.preventDefault();
    },
    [clockCfg.xPct, clockCfg.yPct]
  );
  const onClockPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Math.min(92, Math.max(8, d.ox + ((e.clientX - d.startX) / window.innerWidth) * 100));
    const y = Math.min(86, Math.max(12, d.oy + ((e.clientY - d.startY) / window.innerHeight) * 100));
    setLivePos({ x, y });
  }, []);
  const onClockPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      const final = livePos;
      if (final) setClockCfg({ xPct: Math.round(final.x), yPct: Math.round(final.y) });
      setLivePos(null);
    },
    [livePos, setClockCfg]
  );

  /* ---------- import local background ---------- */
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const onBgFilePicked = async (f: File | null) => {
    if (!f) return;
    setImportingBg(true);
    try {
      const res = await importBackgroundFile(f);
      if (!res) {
        toast('Could not read image', 'Try a JPG or PNG file.');
        return;
      }
      const label = f.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'My background';
      addFocusCustomBg(label, res.dataUrl, res.accent);
      toast('Background added', `${label} — now active. UI auto-colors follow it.`);
    } finally {
      setImportingBg(false);
      if (bgFileRef.current) bgFileRef.current.value = '';
    }
  };

  if (!focusOpen) return null;

  const focusItem = activeTimer?.itemIds?.[0]
    ? items.find((i) => i.id === activeTimer.itemIds[0])
    : null;
  const focusFile = activeTimer?.fileId ? files.find((f) => f.id === activeTimer.fileId) : null;
  const contextTitle = (focusFile && `Reading · ${focusFile.title}`) || focusItem?.title || 'Open focus space';
  const contextNext = focusFile
    ? `${wbFilePositionLabel(focusFile)} · ${focusFile.kind === 'md' ? `${wbFileProgress(focusFile)}% read` : `${wbFileReadPages(focusFile)} pages read`}`
    : focusItem?.nextAction ||
      (activeTimer?.note ? activeTimer.note : 'No task selected — focus on one useful thing.');

  const presetObj = FOCUS_PRESETS.find((p) => p.id === preset) || FOCUS_PRESETS[0];
  const workMin = preset === 'custom' ? customWork : presetObj.workMin;
  const breakMin = preset === 'custom' ? customBreak : presetObj.breakMin;

  const clockPos = livePos || { x: clockCfg.xPct, y: clockCfg.yPct };

  const clockProps = {
    now,
    hasTimer,
    phaseLabel: timing.phaseLabel,
    remaining: timing.remaining,
    progress: timing.progress,
    cycle: timing.cycleCount,
    paused,
    accent: clockAccent,
  };

  return (
    <div
      id="focus-overlay-root"
      className={`focus-overlay ${bgClass} ${compact ? 'focus-compact' : ''} ${bgPanelOpen ? 'show-bg-panel' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      style={{
        ['--focus-accent' as string]: uiAccent,
        ...(customBg ? { ['--focus-bg-img' as string]: `url("${customBg.dataUrl}")`, ['--focus-bg-base' as string]: '#06090a' } : {}),
      }}
    >
      <div className="focus-shell-frame" />

      <div className="focus-topbar">
        <div className="focus-context-card">
          <div className="focus-context-icon" style={{ color: 'var(--focus-accent)', background: 'color-mix(in srgb, var(--focus-accent) 14%, transparent)' }}>
            {focusFile ? <BookOpen size={15} /> : hasTimer ? <Play size={15} /> : <FocusIcon size={15} />}
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
          <button
            className="focus-clock-cfg-btn"
            title="Clock size, position and color"
            aria-label="Clock settings"
            aria-expanded={clockPop}
            onClick={() => setClockPop((v) => !v)}
            type="button"
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
        <button
          className="focus-mini-tool"
          title="Fullscreen — the atmosphere stays with you"
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

      {/* clock settings popover */}
      {clockPop && (
        <div className="fc-cfg-pop" role="dialog" aria-label="Clock settings">
          <div className="fc-cfg-title">Your clock</div>
          <div className="fc-cfg-row">
            <span className="fc-cfg-lab">Size</span>
            <input
              type="range" min={60} max={170} step={5} value={clockCfg.size}
              onChange={(e) => setClockCfg({ size: Number(e.target.value) })}
              aria-label="Clock size"
              style={{ accentColor: 'var(--focus-accent)' }}
            />
            <span className="fc-cfg-val mono">{clockCfg.size}%</span>
          </div>
          <div className="fc-cfg-row">
            <span className="fc-cfg-lab">Color</span>
            <div className="fc-cfg-swatches">
              <button
                type="button"
                className={`fc-swatch fc-swatch-auto ${clockCfg.accent === 'auto' ? 'active' : ''}`}
                onClick={() => setClockCfg({ accent: 'auto' })}
                title="Auto — follows the background"
              >
                <Palette size={13} />
              </button>
              {CLOCK_ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`fc-swatch ${clockCfg.accent === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setClockCfg({ accent: c })}
                  title={c}
                  aria-label={`Clock color ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="fc-cfg-row">
            <span className="fc-cfg-lab">Move</span>
            <span className="fc-cfg-help">
              <Move size={12} /> drag the clock anywhere · <span className="mono">[</span>/<span className="mono">]</span> resize
            </span>
          </div>
          <div className="fc-cfg-row">
            <button type="button" className="fc-cfg-reset" onClick={() => { resetClockCfg(); setLivePos(null); }}>
              <RotateCcw size={12} /> Reset size &amp; position
            </button>
          </div>
        </div>
      )}

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

      {/* the clock — movable + sizable */}
      <div className="focus-stage focus-stage-v6">
        <div
          className="fc-wrap"
          style={{
            left: `${clockPos.x}%`,
            top: `${clockPos.y}%`,
            transform: `translate(-50%, -50%) scale(${clockCfg.size / 100})`,
            cursor: livePos ? 'grabbing' : 'grab',
          }}
          onPointerDown={onClockPointerDown}
          onPointerMove={onClockPointerMove}
          onPointerUp={onClockPointerUp}
          onPointerCancel={onClockPointerUp}
          role="img"
          aria-label={`${CLOCK_TYPES.find((c) => c.id === clockType)?.label ?? ''} clock — drag to move`}
          title="Drag to move · [ ] keys resize"
          tabIndex={-1}
        >
          <ClockFace id={clockType} {...clockProps} />
        </div>
      </div>

      {/* background panel */}
      <div className="focus-bg-panel">
        <div className="focus-bg-panel-inner">
          <div className="focus-bg-panel-title">Focus atmosphere · B to cycle</div>
          <div className="focus-bg-grid">
            {FOCUS_BG_META.map((b) => (
              <button
                key={b.id}
                className={`focus-bg-card ${!customBg && background === b.id ? 'active' : ''}`}
                onClick={() => setBackground(b.id)}
                type="button"
                aria-pressed={!customBg && background === b.id}
              >
                {b.photo ? (
                  <span
                    className="focus-bg-thumb"
                    style={{ backgroundImage: `url(${b.photo})` }}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="focus-bg-swatch" aria-hidden="true" />
                )}
                {b.label}
              </button>
            ))}
          </div>

          {/* Your photos — always rendered so the Add-photo affordance is discoverable */}
          <div className="focus-bg-panel-title" style={{ marginTop: 12 }}>
            Your photos
            <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>
              {' '}· from this device
            </span>
          </div>
          <div className="focus-bg-grid">
            {customBgs.map((b) => (
              <div key={b.id} className={`focus-bg-card has-x ${customBg?.id === b.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className="focus-bg-card-main"
                  onClick={() => setBackground(`custom:${b.id}`)}
                  aria-pressed={customBg?.id === b.id}
                >
                  <span className="focus-bg-thumb" style={{ backgroundImage: `url(${b.dataUrl})` }} aria-hidden="true" />
                  {b.label}
                </button>
                <button
                  type="button"
                  className="focus-bg-x"
                  title="Remove this background"
                  aria-label={`Remove ${b.label}`}
                  onClick={() => {
                    removeFocusCustomBg(b.id);
                    toast('Background removed', b.label);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              className="focus-bg-add"
              type="button"
              disabled={importingBg}
              onClick={() => bgFileRef.current?.click()}
            >
              <ImagePlus size={16} />
              <span>{importingBg ? 'Adding…' : 'Add photo'}</span>
            </button>
          </div>
          <input
            ref={bgFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => void onBgFilePicked(e.target.files?.[0] || null)}
            aria-hidden="true"
            tabIndex={-1}
          />
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
              <span className="focus-kbd">B</span> changes atmosphere ·{' '}
              <span className="focus-kbd">[ ]</span> resize clock ·{' '}
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

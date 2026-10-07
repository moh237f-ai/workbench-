/* ==================== InkColorPicker ====================
   Shared color control for pen/highlighter/selection editing:
   swatch row + recent colors + native custom picker, all keyboard-safe. */

'use client';

import React from 'react';
import { Pipette } from 'lucide-react';
import { useWB } from '@/lib/workbench/store';

export function InkColorPicker({
  value,
  swatches,
  onChange,
  label,
}: {
  value: string;
  swatches: string[];
  onChange: (color: string) => void;
  label: string;
}) {
  const recentColors = useWB((s) => s.readerPrefs.recentColors);

  const pick = (c: string) => {
    onChange(c);
    const { readerPrefs, updateReaderPrefs } = useWB.getState();
    const next = [c, ...readerPrefs.recentColors.filter((x) => x !== c)].slice(0, 6);
    updateReaderPrefs({ recentColors: next });
  };

  const customs = recentColors.filter((c) => !swatches.includes(c)).slice(0, 3);

  return (
    <div className="ink-picker" role="group" aria-label={label}>
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          className={`rd-color-dot${value === c ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => pick(c)}
          aria-label={`${label} ${c}`}
          aria-pressed={value === c}
        />
      ))}
      {customs.length > 0 && <span className="ink-picker-sep" aria-hidden />}
      {customs.map((c) => (
        <button
          key={`r${c}`}
          type="button"
          className={`rd-color-dot ink-recent${value === c ? ' on' : ''}`}
          style={{ background: c }}
          onClick={() => pick(c)}
          aria-label={`${label} custom ${c}`}
          aria-pressed={value === c}
        />
      ))}
      <label
        className={`rd-color-dot ink-custom${/^(?!#(FB7185|FBBF24|34D399|22D3EE|A78BFA|F8FAFC|FDE68A|86EFAC|93C5FD|F9A8D4|FDBA74|C4B5FD)$)/.test(value) && !customs.includes(value) ? ' on' : ''}`}
        title="Custom color"
      >
        <Pipette size={11} />
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#FB7185'}
          onChange={(e) => pick(e.target.value)}
          aria-label={`Custom ${label}`}
        />
      </label>
    </div>
  );
}

/* ==================== Settings Modal (v6) ====================
   Consolidates Commands / Backup & Data / Shortcuts / Themes so the
   sidebar stays clean. One gear button → four tidy sections. */

'use client';

import React, { useState } from 'react';
import {
  Palette, Keyboard, Download, Command as CommandIcon, Sun, Moon, Sparkles,
  CalendarDays, Calendar, Image as ImageIcon, Zap, Upload, Check,
} from 'lucide-react';
import { useWB } from '@/lib/workbench/store';
import { buildICS, parseICS, todayStr } from '@/lib/workbench/helpers';
import { Btn, Modal, toast } from '../ui/primitives';
import type { CalendarSystem, ThemeId } from '@/lib/workbench/types';

type Section = 'appearance' | 'shortcuts' | 'data' | 'commands';

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard size={14} /> },
  { id: 'data', label: 'Backup & data', icon: <Download size={14} /> },
  { id: 'commands', label: 'Commands', icon: <CommandIcon size={14} /> },
];

const SHORTCUT_ROWS: [string[], string][] = [
  [['F'], 'Open / focus mode'],
  [['B'], 'Focus mode — cycle atmosphere'],
  [['⌘', 'K'], 'Command palette & search'],
  [['C'], 'Quick capture'],
  [['T'], 'Start / stop quick timer'],
  [['N'], 'New goal'],
  [['G', 'T/D/G/L/H/J/C/R/I'], 'Jump to a view'],
  [['G', 'B'], 'Library — your PDFs'],
  [['G', 'M'], 'Roadmaps'],
  [['G', 'P'], 'Day / week planner'],
  [['Ctrl', 'Z'], 'Undo'],
  [['Ctrl', 'Shift', 'Z'], 'Redo'],
  [['Ctrl', 'J'], 'Cycle theme'],
  [['Esc'], 'Exit focus / close dialog'],
  [['S'], 'Reader — single / continuous page'],
  [['P'], 'Reader — pages panel & filters'],
  [['F'], 'Reader — star this page'],
  [['T'], 'Reader — page theme (light/dark/warm)'],
  [['+/−'], 'Reader — zoom in / out'],
];

const THEME_CHOICES: { id: ThemeId; label: string; icon: React.ReactNode; dot: string }[] = [
  { id: 'light', label: 'Light · Cream', icon: <Sun size={15} />, dot: 'linear-gradient(135deg,#FDFCF7,#F1EDE2)' },
  { id: 'dark', label: 'Dark · Night', icon: <Moon size={15} />, dot: 'linear-gradient(135deg,#101815,#1c2b26)' },
  { id: 'prism', label: 'Prism · Signal', icon: <Sparkles size={15} />, dot: 'conic-gradient(from 210deg,#2DD4BF,#7C3AED,#F472B6,#2DD4BF)' },
];

const CAL_CHOICES: { id: CalendarSystem; label: string; icon: React.ReactNode }[] = [
  { id: 'shamsi', label: 'Shamsi (Jalali)', icon: <CalendarDays size={14} /> },
  { id: 'gregorian', label: 'Gregorian', icon: <Calendar size={14} /> },
];

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="wb-switch" title={label}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="track"><span className="knob" /></span>
    </label>
  );
}

export function SettingsModal({
  open,
  onClose,
  onOpenPalette,
}: {
  open: boolean;
  onClose: () => void;
  onOpenPalette: () => void;
}) {
  const theme = useWB((s) => s.theme);
  const setTheme = useWB((s) => s.setTheme);
  const calendarSystem = useWB((s) => s.calendarSystem);
  const setCalendarSystem = useWB((s) => s.setCalendarSystem);
  const focusAutoColor = useWB((s) => s.focusAutoColor);
  const setFocusAutoColor = useWB((s) => s.setFocusAutoColor);
  const sidebarCollapsed = useWB((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useWB((s) => s.toggleSidebarCollapsed);
  const exportData = useWB((s) => s.exportData);
  const importData = useWB((s) => s.importData);
  const items = useWB((s) => s.items);

  const [section, setSection] = useState<Section>('appearance');

  const doExport = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workbench-aurora-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Backup exported');
  };

  const doImport = (kind: 'json' | 'ics') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'json' ? 'application/json,.json' : '.ics,text/calendar';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        if (kind === 'json') {
          try {
            const raw = JSON.parse(String(fr.result));
            if (!confirm('Replace the current workspace with this backup?')) return;
            const err = importData(raw);
            if (err) toast('Import failed', err);
            else toast('Backup imported', 'Your workspace has been restored.');
          } catch (e) {
            toast('Import failed', e instanceof Error ? e.message : 'Invalid file');
          }
        } else {
          const events = parseICS(String(fr.result));
          if (!events.length) {
            toast('No events found', 'The .ics file contained no importable events.');
            return;
          }
          const { addItem } = useWB.getState();
          events.forEach((ev) =>
            addItem({ title: ev.title, type: 'task', status: 'todo', deadline: ev.deadline, plannedStart: ev.plannedStart })
          );
          toast('Calendar imported', `${events.length} event${events.length === 1 ? '' : 's'} converted to tasks`);
        }
      };
      fr.readAsText(f);
    };
    input.click();
  };

  const doIcsExport = () => {
    const timeboxed = items.filter((i) => i.plannedStart);
    if (!timeboxed.length) {
      toast('Nothing to export', 'Timebox a few tasks first — their blocks become calendar events.');
      return;
    }
    const blob = new Blob([buildICS(timeboxed)], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workbench-timeboxes-${todayStr()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Calendar exported', `${timeboxed.length} time block${timeboxed.length === 1 ? '' : 's'}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Settings" wide footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className={section === s.id ? 'active' : ''}
            onClick={() => setSection(s.id)}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {section === 'appearance' && (
        <div>
          <div className="set-row">
            <div className="set-info">
              <div className="set-title">Workspace theme</div>
              <div className="set-sub">Applies everywhere — sidebar, views, focus mode chrome.</div>
            </div>
            <div className="theme-choice-grid">
              {THEME_CHOICES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-choice ${theme === t.id ? 'active' : ''}`}
                  onClick={() => setTheme(t.id)}
                  aria-pressed={theme === t.id}
                >
                  <span className="dot" style={{ background: t.dot }} aria-hidden="true" />
                  {t.label.split(' · ')[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <div className="set-info">
              <div className="set-title">Calendar system</div>
              <div className="set-sub">
                Shamsi shows the Jalali calendar (weeks start Saturday) in every date picker, planner and calendar view.
                Both calendars are always visible side-by-side.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {CAL_CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`theme-choice ${calendarSystem === c.id ? 'active' : ''}`}
                  onClick={() => setCalendarSystem(c.id)}
                  aria-pressed={calendarSystem === c.id}
                  style={{ minWidth: 58, padding: '9px 10px' }}
                >
                  {c.icon}
                  {c.id === 'shamsi' ? 'Shamsi' : 'Gregorian'}
                </button>
              ))}
            </div>
          </div>

          <div className="set-row">
            <div className="set-info">
              <div className="set-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Zap size={14} style={{ color: 'var(--pine)' }} /> Focus auto-coloring
              </div>
              <div className="set-sub">
                Recolor focus-mode UI to match the current atmosphere — clock, buttons and highlights follow the background.
              </div>
            </div>
            <Switch checked={focusAutoColor} onChange={setFocusAutoColor} label="Focus auto-coloring" />
          </div>

          <div className="set-row">
            <div className="set-info">
              <div className="set-title">Compact sidebar</div>
              <div className="set-sub">Collapse the sidebar to icons-only for more workspace.</div>
            </div>
            <Switch checked={sidebarCollapsed} onChange={toggleSidebarCollapsed} label="Compact sidebar" />
          </div>

          <div className="set-row" style={{ marginBottom: 0 }}>
            <div className="set-info">
              <div className="set-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <ImageIcon size={14} style={{ color: 'var(--violet)' }} /> Focus backgrounds
              </div>
              <div className="set-sub">Forest · Sea · Village · Desert · Sky · Star sky · Night sky — plus your own photos, added from focus mode (image button → “Your photos”).</div>
            </div>
          </div>
        </div>
      )}

      {section === 'shortcuts' && (
        <div className="shortcut-list">
          {SHORTCUT_ROWS.map(([keys, desc]) => (
            <div key={desc} className="shortcut-row">
              <span>{desc}</span>
              <span className="keys">
                {keys.map((k, j) => (
                  <React.Fragment key={k + j}>
                    {j > 0 && <span style={{ color: 'var(--faint)', fontSize: 10 }}>+</span>}
                    <span className="kbd-chip">{k}</span>
                  </React.Fragment>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {section === 'data' && (
        <div>
          <div className="set-row">
            <div className="set-info">
              <div className="set-title">Workspace backup</div>
              <div className="set-sub">Full JSON export/import of goals, tasks, entries, habits, files metadata and journal.</div>
            </div>
            <Btn size="sm" onClick={doExport}><Download size={14} /> Export</Btn>
            <Btn size="sm" onClick={() => doImport('json')}><Upload size={14} /> Import</Btn>
          </div>
          <div className="set-row">
            <div className="set-info">
              <div className="set-title">Calendar bridge</div>
              <div className="set-sub">Move timeboxed work in and out using standard .ics files.</div>
            </div>
            <Btn size="sm" onClick={doIcsExport}><Download size={14} /> .ics</Btn>
            <Btn size="sm" onClick={() => doImport('ics')}><Upload size={14} /> .ics</Btn>
          </div>
          <div className="set-row" style={{ marginBottom: 0 }}>
            <div className="set-info">
              <div className="set-title">Storage</div>
              <div className="set-sub">Local-first: everything lives in this browser (localStorage + IndexedDB). Export regularly.</div>
            </div>
            <span className="chip chip-ok"><Check size={12} /> Local</span>
          </div>
        </div>
      )}

      {section === 'commands' && (
        <div>
          <div className="set-row">
            <div className="set-info">
              <div className="set-title">Command palette</div>
              <div className="set-sub">
                Search everything — jump to files, goals, roadmaps, run actions.
                Open any time with <span className="kbd-chip">⌘</span> <span className="kbd-chip">K</span>.
              </div>
            </div>
            <Btn
              size="sm"
              variant="primary"
              onClick={() => {
                onClose();
                onOpenPalette();
              }}
            >
              <CommandIcon size={14} /> Open palette
            </Btn>
          </div>
          <div className="set-row" style={{ marginBottom: 0 }}>
            <div className="set-info">
              <div className="set-title">Quick capture</div>
              <div className="set-sub">
                One-line capture with smart parsing — priority, estimate and deadline in the same line.
                Open with <span className="kbd-chip">C</span>.
              </div>
            </div>
            <span className="chip chip-ok">Try it</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

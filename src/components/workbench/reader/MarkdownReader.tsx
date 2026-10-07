/* ==================== Markdown Reader ====================
   The kind:'md' branch of the reader overlay. Renders markdown as themed
   prose, with an edit mode (textarea + live preview, debounced autosave to
   IDB), scroll progress sync, per-session time tracking, and focus-read. */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentPropsWithoutRef } from 'react';
import {
  Bold, Check, Clock, Code, Download, Eye, FileText, Heading1, Heading2, Image as ImageIcon,
  Italic, Link2, List, ListOrdered, Minus, Pencil, Pause, Play, Quote, SkipForward, Square,
  SquareCheck, Strikethrough, Table, X,
} from 'lucide-react';
import {
  useWB, wbFileDeadlineStatus, wbFileProgress, wbItemsForFile,
} from '@/lib/workbench/store';
import type { ResourceFile } from '@/lib/workbench/types';
import { getBlob, putBlob } from '@/lib/workbench/idb';
import { daysUntil, fmtClock, getFocusTiming, isoDate, isRtlText } from '@/lib/workbench/helpers';
import { Btn, IconBtn, toast, useConfirm, useNow } from '../ui/primitives';
import { DictionaryPopup } from './DictionaryPopup';
import { MdCodeEditor } from './MdCodeEditor';
import { renderMarkdownToCanvas } from '@/lib/workbench/pdfwrite';
import { PDFDocument } from 'pdf-lib';

const SAVE_DEBOUNCE_MS = 700;
const MIN_SESSION_MS = 60_000;

function themeFilterOf(mode: string, custom: { brightness: number; contrast: number; sepia: number }): string {
  switch (mode) {
    case 'dark': return 'none';
    case 'warm': return 'none';
    case 'custom': return `brightness(${custom.brightness / 100}) contrast(${custom.contrast / 100}) sepia(${custom.sepia / 100})`;
    default: return 'none';
  }
}

function proseBg(mode: string): string {
  switch (mode) {
    case 'dark': return '#16181c';
    case 'warm': return '#f3ecdc';
    case 'custom': return '#16181c';
    default: return '#f6f6f4';
  }
}

function proseInk(mode: string): string {
  return mode === 'light' || mode === 'warm' ? '#1a1c1e' : '#ecedee';
}

/** Markdown element with automatic RTL direction from its own text. */
function elementIsRtl(children: React.ReactNode): boolean {
  let text = '';
  const walk = (node: React.ReactNode): void => {
    if (typeof node === 'string') text += node;
    else if (Array.isArray(node)) node.forEach(walk);
    else if (React.isValidElement(node)) walk((node.props as { children?: React.ReactNode }).children);
  };
  walk(children);
  return isRtlText(text);
}

 
function AutoDirTag(props: any) {
  const { children, ...rest } = props;
  const Tag = rest.node?.tagName ?? 'p';
  return (
    <Tag {...rest} dir={elementIsRtl(children) ? 'rtl' : 'ltr'}>
      {children}
    </Tag>
  );
}
 

const mdComponents = {
  p: AutoDirTag,
  h1: AutoDirTag,
  h2: AutoDirTag,
  h3: AutoDirTag,
  h4: AutoDirTag,
  li: AutoDirTag,
  blockquote: AutoDirTag,
};

export function MarkdownReader({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const file = useWB((s) => s.files.find((f) => f.id === fileId));
  const items = useWB((s) => s.items);
  const activeTimer = useWB((s) => s.activeTimer);
  const prefs = useWB((s) => s.readerPrefs);
  const updateFile = useWB((s) => s.updateFile);
  const addFilePageSeconds = useWB((s) => s.addFilePageSeconds);
  const logReadingSession = useWB((s) => s.logReadingSession);
  const startFileFocus = useWB((s) => s.startFileFocus);
  const pausePomodoro = useWB((s) => s.pausePomodoro);
  const resumePomodoro = useWB((s) => s.resumePomodoro);
  const advancePomodoro = useWB((s) => s.advancePomodoro);
  const stopTimer = useWB((s) => s.stopTimer);
  const confirm = useConfirm();
  const now = useNow();

  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cmViewRef = useRef<import('@codemirror/view').EditorView | null>(null);

  /** wrap or insert markdown syntax at the CodeMirror cursor */
  const mdEdit = useCallback((kind: 'bold' | 'italic' | 'strike' | 'code' | 'h1' | 'h2' | 'list' | 'olist' | 'task' | 'quote' | 'table' | 'image' | 'link' | 'hr') => {
    const view = cmViewRef.current;
    if (!view) return;
    const { state } = view;
    const sel = state.selection.main;
    const selected = state.sliceDoc(sel.from, sel.to);
    const insert = (text: string, cursorOffset: number): void => {
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + cursorOffset },
      });
      view.focus();
    };
    switch (kind) {
      case 'bold': {
        const t = selected || 'bold';
        insert(`**${t}**`, selected ? -1 : 2);
        return;
      }
      case 'italic': {
        const t = selected || 'italic';
        insert(`*${t}*`, selected ? -1 : 1);
        return;
      }
      case 'strike': {
        const t = selected || 'strike';
        insert(`~~${t}~~`, selected ? -1 : 2);
        return;
      }
      case 'code': {
        const t = selected || 'code';
        insert(selected.includes('\n') ? '\n```\n' + t + '\n```\n' : '`' + t + '`', selected ? -1 : 1);
        return;
      }
      case 'h1': insert('# ' + (selected || 'Heading'), selected ? 0 : 2); return;
      case 'h2': insert('## ' + (selected || 'Heading'), selected ? 0 : 3); return;
      case 'list': {
        const lines = (selected || 'item').split('\n').map((l) => '- ' + l).join('\n');
        insert(lines, selected ? lines.length : 2);
        return;
      }
      case 'olist': {
        const lines = (selected || 'item').split('\n').map((l, i) => `${i + 1}. ` + l).join('\n');
        insert(lines, selected ? lines.length : 3);
        return;
      }
      case 'quote': {
        const lines = (selected || 'quote').split('\n').map((l) => '> ' + l).join('\n');
        insert(lines, selected ? lines.length : 2);
        return;
      }
      case 'task': {
        const lines = (selected || 'task').split('\n').map((l) => '- [ ] ' + l).join('\n');
        insert(lines, selected ? lines.length : 6);
        return;
      }
      case 'link': {
        const t = selected || 'label';
        insert(`[${t}](url)`, selected ? -6 : 3);
        return;
      }
      case 'hr': {
        insert((sel.from > 0 && state.sliceDoc(sel.from - 1, sel.from) !== '\n' ? '\n' : '') + '\n---\n', 5);
        return;
      }
      case 'table':
        insert('| Column | Column |\n|---|---|\n|  |  |\n|  |  |', 2);
        return;
      case 'image':
        insert('![alt](url)', 2);
        return;
    }
  }, []);

  const words = useMemo(() => (draft ? draft.trim().split(/\s+/).filter(Boolean).length : 0), [draft]);
  const readMin = Math.max(1, Math.round(words / 220));
  const [dictSel, setDictSel] = useState<{ text: string; page: number; rect: DOMRect } | null>(null);

  /** click a GFM task checkbox in the preview → flip the matching [ ]/[x] in the source */
  const toggleTask = (index: number): void => {
    let i = -1;
    const next = draft.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/gm, (m, a, mark, b) => {
      i += 1;
      if (i !== index) return m;
      return a + (mark === ' ' ? 'x' : ' ') + b;
    });
    if (next !== draft) onDraftChange(next);
  };

  const onPreviewClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
      e.preventDefault();
      const boxes = [...(e.currentTarget as HTMLElement).querySelectorAll('input[type="checkbox"]')];
      const idx = boxes.indexOf(target as HTMLInputElement);
      if (idx >= 0) toggleTask(idx);
    }
  };

  const onProseMouseUp = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    const txt = sel?.toString().trim() ?? '';
    if (!txt || txt.split(/\s+/).length > 3) return;
    const rect = (e.currentTarget as HTMLElement).contains(sel?.anchorNode ?? null)
      ? sel!.getRangeAt(0).getBoundingClientRect()
      : null;
    if (!rect || (!rect.width && !rect.height)) return;
    setDictSel({ text: txt, page: 0, rect });
  };
  const textRef = useRef('');
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionStartRef = useRef(Date.now());
  const lastProgressRef = useRef(0);

  /* start in edit mode for brand-new empty notes */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const blob = await getBlob(fileId);
        const content = blob ? await blob.text() : '';
        if (!alive) return;
        setText(content);
        setDraft(content);
        textRef.current = content;
        if (!content.trim()) setEditing(true);
      } catch {
        if (alive) setText('');
      }
    })();
    return () => { alive = false; };
  }, [fileId]);

  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const content = textRef.current;
    try {
      await putBlob(fileId, new Blob([content], { type: 'text/markdown' }));
      setSaveState('saved');
    } catch {
      setSaveState('idle');
    }
  }, [fileId]);

  const scheduleSave = useCallback(() => {
    setSaveState('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSave(), SAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const onDraftChange = (v: string) => {
    setDraft(v);
    textRef.current = v;
    dirtyRef.current = true;
    scheduleSave();
  };

  /* flush + session log on unmount / hide */
  useEffect(() => {
    const sessionStart = sessionStartRef.current;
    return () => {
      void flushSave();
      const elapsed = Date.now() - sessionStart;
      if (elapsed < MIN_SESSION_MS) return;
      const pct = lastProgressRef.current;
      logReadingSession({
        fileId,
        date: isoDate(new Date(sessionStart)),
        startedAt: new Date(sessionStart).toISOString(),
        endedAt: new Date().toISOString(),
        minutes: Math.max(1, Math.round(elapsed / 60000)),
        pagesVisited: 1,
        pagesRead: pct >= 95 ? 1 : 0,
        startPage: 1,
        endPage: 1,
      });
    };
  }, [fileId, flushSave, logReadingSession]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flushSave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', () => void flushSave());
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flushSave]);

  /* scroll progress + lastReadAt (throttled) */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || editing) return;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 4 ? Math.round((el.scrollTop / max) * 100) : 100;
    /* coalesce: the library grid re-renders behind the overlay on every store
       write, so step by ≥4% (progress still ends exact on session end) */
    if (Math.abs(pct - lastProgressRef.current) >= 4 || pct >= 100) {
      lastProgressRef.current = pct;
      updateFile(fileId, { scrollProgress: pct, lastReadAt: new Date().toISOString() });
    }
  }, [editing, fileId, updateFile]);

  /* reading seconds — visible time accrues to the file's stats */
  const [secs, setSecs] = useState(0);
  const unflushedRef = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setSecs((s) => s + 1);
      unflushedRef.current += 1;
      if (unflushedRef.current >= 15) {
        addFilePageSeconds(fileId, 1, unflushedRef.current);
        unflushedRef.current = 0;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [fileId, addFilePageSeconds]);
  useEffect(() => {
    return () => {
      if (unflushedRef.current > 0) addFilePageSeconds(fileId, 1, unflushedRef.current);
    };
  }, [fileId, addFilePageSeconds]);

  const focusHere = !!activeTimer && activeTimer.fileId === fileId;
  const focusTiming = focusHere && activeTimer ? getFocusTiming(activeTimer, now.getTime()) : null;
  const linkedItems = useMemo(() => wbItemsForFile(items, fileId), [items, fileId]);
  const pct = file ? wbFileProgress(file) : 0;
  const deadlineChip = useMemo(() => {
    if (!file?.deadline) return null;
    const status = wbFileDeadlineStatus(file);
    if (!status) return null;
    if (pct >= 100) return { text: 'Complete', tone: 'ok' as const };
    const d = daysUntil(file.deadline);
    if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: 'over' as const };
    if (d === 0) return { text: 'Due today', tone: 'soon' as const };
    return { text: `${d}d left`, tone: status === 'soon' ? ('soon' as const) : ('ok' as const) };
  }, [file, pct]);

  const themeMode = prefs.themeMode;
  const filter = themeFilterOf(themeMode, prefs.custom);

  const exportPdf = useCallback(() => {
    const src = text ?? '';
    if (!src.trim()) return;
    const canvas = renderMarkdownToCanvas(src, 794, proseBg(themeMode), proseInk(themeMode));
    void PDFDocument.create().then(async (out) => {
      out.setProducer('Workbench Aurora');
      const pageW = 595.28;
      const pageH = 841.89;
      const sliceH = Math.floor((pageH / pageW) * canvas.width);
      const pages = Math.ceil(canvas.height / sliceH);
      for (let i = 0; i < pages; i++) {
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.min(sliceH, canvas.height - i * sliceH);
        slice.getContext('2d')?.drawImage(canvas, 0, i * sliceH, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
        const png = await out.embedPng(slice.toDataURL('image/png'));
        const pg = out.addPage([pageW, pageH]);
        pg.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH });
      }
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${file?.title || 'note'}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('PDF exported', `${pages} page${pages === 1 ? '' : 's'}.`);
    });
  }, [text, themeMode, file]);

  const toggleEdit = () => {
    if (editing) {
      /* commit any pending change immediately */
      dirtyRef.current = textRef.current !== text;
      void flushSave();
      setText(textRef.current);
      toast('Note saved');
    }
    setEditing((v) => !v);
  };

  /* keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape') {
        if (inField) { (t as HTMLElement).blur(); return; }
        e.preventDefault();
        onClose();
        return;
      }
      if (inField) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          dirtyRef.current = true;
          void flushSave();
          toast('Note saved');
        }
        return;
      }
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        toggleEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, flushSave, editing, text]);

  if (typeof document === 'undefined') return null;

  const openLinked = (itemId: string) => window.dispatchEvent(new CustomEvent('wb-open-item', { detail: itemId }));

  return (
    <div className="reader-overlay md-overlay" role="dialog" aria-modal="true" aria-label={`Reading ${file?.title ?? 'note'}`}>
      <header className="rd-header">
        <div className="rd-title-wrap">
          <div className="rd-title-row">
            <span className="rd-file-badge"><FileText size={15} /></span>
            <span className="rd-title" title={file?.title ?? 'Note'}>{file?.title ?? 'Note'}</span>
            <span className="rd-pages">markdown · {pct}%</span>
          </div>
          <div className="rd-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress">
            <div className="rd-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="rd-progress-meta">
            {pct}% read
            {saveState !== 'idle' && (
              <span className={`rd-save-chip ${saveState}`} title="Autosaves as you type">
                <span className="rd-save-dot" aria-hidden />
                {saveState === 'saving' ? 'Saving…' : 'Saved'}
              </span>
            )}
          </div>
        </div>

        <div className="rd-header-side">
          <span className="rd-clock-chip" title="Reading session time">
            <Clock size={13} />
            <span className="rd-mono">{fmtClock(secs)}</span>
          </span>
          {deadlineChip && <span className={`rd-chip rd-${deadlineChip.tone}`}>{deadlineChip.text}</span>}
          {linkedItems.length > 0 && (
            <div className="rd-items">
              {linkedItems.slice(0, 3).map((it) => (
                <button key={it.id} type="button" className="rd-item-chip" onClick={() => openLinked(it.id)} title={`Open ${it.title}`}>
                  <span className="rd-item-title">{it.title}</span>
                </button>
              ))}
              {linkedItems.length > 3 && <span className="rd-chip">+{linkedItems.length - 3}</span>}
            </div>
          )}

          {!activeTimer ? (
            <Btn variant="primary" size="sm" onClick={() => { if (startFileFocus(fileId)) toast('Focus read started'); else toast('A timer is already running', 'End it before starting a focus read.'); }}>
              <Play size={13} /> Focus read
            </Btn>
          ) : focusHere && focusTiming ? (
            <div className="rd-focus-box">
              <span className="rd-phase-badge break">{focusTiming.phaseLabel}</span>
              <span className="rd-mono rd-focus-rem">{fmtClock(focusTiming.remaining)}</span>
              {focusTiming.paused ? (
                <IconBtn small title="Resume pomodoro" onClick={resumePomodoro}><Play size={13} /></IconBtn>
              ) : (
                <IconBtn small title="Pause pomodoro" onClick={pausePomodoro}><Pause size={13} /></IconBtn>
              )}
              <IconBtn small title="Skip to next phase" onClick={advancePomodoro}><SkipForward size={13} /></IconBtn>
              <IconBtn small danger title="End focus session" onClick={() => { stopTimer(); toast('Session logged'); }}><Square size={13} /></IconBtn>
            </div>
          ) : (
            <span className="rd-chip rd-elsewhere">Timer running elsewhere</span>
          )}

          {!editing && (
            <IconBtn title="Export note as PDF" onClick={exportPdf}><Download size={15} /></IconBtn>
          )}
          <Btn size="sm" variant={editing ? 'primary' : 'default'} onClick={toggleEdit} title="Toggle edit mode (E)">
            {editing ? <Check size={13} /> : <Pencil size={13} />} {editing ? 'Done' : 'Edit'}
          </Btn>

          <IconBtn title="Close reader (Esc)" onClick={onClose}><X size={16} /></IconBtn>
        </div>
      </header>

      <div className="rd-stage-wrap" style={{ padding: 0 }}>
        {editing ? (
          <div className="md-edit">
            <div className="md-toolbar" role="toolbar" aria-label="Formatting">
              <IconBtn small title="Bold (Ctrl+B)" onClick={() => mdEdit('bold')}><Bold size={14} /></IconBtn>
              <IconBtn small title="Italic (Ctrl+I)" onClick={() => mdEdit('italic')}><Italic size={14} /></IconBtn>
              <IconBtn small title="Strikethrough" onClick={() => mdEdit('strike')}><Strikethrough size={14} /></IconBtn>
              <IconBtn small title="Code" onClick={() => mdEdit('code')}><Code size={14} /></IconBtn>
              <span className="md-toolbar-sep" aria-hidden />
              <IconBtn small title="Heading 1" onClick={() => mdEdit('h1')}><Heading1 size={14} /></IconBtn>
              <IconBtn small title="Heading 2" onClick={() => mdEdit('h2')}><Heading2 size={14} /></IconBtn>
              <IconBtn small title="Bullet list" onClick={() => mdEdit('list')}><List size={14} /></IconBtn>
              <IconBtn small title="Numbered list" onClick={() => mdEdit('olist')}><ListOrdered size={14} /></IconBtn>
              <IconBtn small title="Quote" onClick={() => mdEdit('quote')}><Quote size={14} /></IconBtn>
              <IconBtn small title="Table" onClick={() => mdEdit('table')}><Table size={14} /></IconBtn>
              <IconBtn small title="Task list" onClick={() => mdEdit('task')}><SquareCheck size={14} /></IconBtn>
              <IconBtn small title="Link" onClick={() => mdEdit('link')}><Link2 size={14} /></IconBtn>
              <IconBtn small title="Horizontal rule" onClick={() => mdEdit('hr')}><Minus size={14} /></IconBtn>
              <IconBtn small title="Image" onClick={() => mdEdit('image')}><ImageIcon size={14} /></IconBtn>
              <span className="md-toolbar-sep" aria-hidden />
              <span className="md-wordcount mono" title="Words · read time at 220 wpm">
                {words} words · ~{readMin} min
              </span>
              <span className="spacer" />
              <Btn size="sm" variant="ghost" onClick={exportPdf} title="Export this note as a styled PDF">
                <Download size={13} /> PDF
              </Btn>
            </div>
            <div className="md-edit-panes">
              <div className="md-cm-wrap">
                <MdCodeEditor
                  value={draft}
                  onChange={onDraftChange}
                  dark={themeMode === 'dark' || themeMode === 'custom'}
                  rtl={isRtlText(draft.slice(0, 80))}
                  onReady={(v) => { cmViewRef.current = v; }}
                />
              </div>
              <div
                className={`md-prose md-prose-${themeMode}`}
                style={{ background: proseBg(themeMode), color: proseInk(themeMode), filter: filter }}
                onClick={onPreviewClick}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{draft}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : (
          <div className="rd-stage md-stage" ref={scrollRef} onScroll={onScroll} role="region" aria-label="Markdown content">
            <article
              className={`md-prose md-prose-${themeMode}`}
              style={{ background: proseBg(themeMode), color: proseInk(themeMode) }}
              onMouseUp={onProseMouseUp}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text ?? ''}</ReactMarkdown>
            </article>
          </div>
        )}
        {text === null && (
          <div className="rd-centered">
            <div className="rd-spinner" role="status" aria-label="Loading note" />
          </div>
        )}
      </div>

      <DictionaryPopup selection={dictSel} onClose={() => setDictSel(null)} />
    </div>
  );
}

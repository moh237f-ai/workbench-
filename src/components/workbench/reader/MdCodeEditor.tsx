/* ==================== MdCodeEditor ====================
   CodeMirror 6 markdown editor themed to Workbench tokens: syntax
   highlighting, RTL-aware, imperative toolbar API via ref (wrap/insert
   at cursor), works in the reader's edit mode. */

'use client';

import React, { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

export interface MdEditorHandle {
  view: EditorView | null;
}

const lightHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.25em', fontWeight: '800', color: '#0e8a7d' },
  { tag: t.heading2, fontSize: '1.15em', fontWeight: '750', color: '#0e8a7d' },
  { tag: t.heading3, fontWeight: '700', color: '#0a6b60' },
  { tag: t.heading4, fontWeight: '700', color: '#0a6b60' },
  { tag: t.strong, fontWeight: '800' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#0e8a7d', textDecoration: 'underline' },
  { tag: t.url, color: '#7c62e0' },
  { tag: t.monospace, color: '#7c62e0', background: 'rgba(124,98,224,0.08)' },
  { tag: t.quote, color: '#6d6f6b', fontStyle: 'italic' },
  { tag: t.list, color: '#b45309' },
  { tag: t.contentSeparator, color: '#9b9e99' },
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.25em', fontWeight: '800', color: '#2fd9b9' },
  { tag: t.heading2, fontSize: '1.15em', fontWeight: '750', color: '#2fd9b9' },
  { tag: t.heading3, fontWeight: '700', color: '#26b39a' },
  { tag: t.heading4, fontWeight: '700', color: '#26b39a' },
  { tag: t.strong, fontWeight: '800', color: '#ecedee' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#2fd9b9', textDecoration: 'underline' },
  { tag: t.url, color: '#a78bfa' },
  { tag: t.monospace, color: '#a78bfa', background: 'rgba(167,139,250,0.12)' },
  { tag: t.quote, color: '#9ba0a4', fontStyle: 'italic' },
  { tag: t.list, color: '#f0b25a' },
  { tag: t.contentSeparator, color: '#6b7075' },
]);

export interface MdCodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  dark: boolean;
  rtl?: boolean;
  onReady?: (view: EditorView) => void;
}

export function MdCodeEditor({ value, onChange, dark, rtl, onReady }: MdCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const compartment = new Compartment();
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(dark ? darkHighlight : lightHighlight),
        lineNumbers(),
        drawSelection(),
        EditorView.domEventHandlers({
          keydown: (event, view) => {
            if (!(event.ctrlKey || event.metaKey)) return false;
            const k = event.key.toLowerCase();
            if (k !== 'b' && k !== 'i') return false;
            event.preventDefault();
            const sel = view.state.selection.main;
            const selected = view.state.sliceDoc(sel.from, sel.to);
            const text = k === 'b' ? `**${selected || 'bold'}**` : `*${selected || 'italic'}*`;
            view.dispatch({
              changes: { from: sel.from, to: sel.to, insert: text },
              selection: { anchor: sel.from + (selected ? text.length : k === 'b' ? 2 : 1) },
            });
            return true;
          },
        }),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { fontSize: '14.5px', height: '100%', backgroundColor: 'transparent', color: dark ? '#d6d9dd' : '#22262a' },
          '.cm-scroller': {
            fontFamily: 'var(--font-jetbrains), var(--font-persian), ui-monospace, monospace',
            lineHeight: '1.7',
            padding: '12px 0 40px',
            direction: rtl ? 'rtl' : 'ltr',
          },
          '.cm-content': { caretColor: dark ? '#2fd9b9' : '#0e8a7d' },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            border: 'none',
            color: dark ? '#4a4f55' : '#c9ccc9',
          },
          '.cm-activeLine': { backgroundColor: 'transparent' },
          '.cm-activeLineGutter': { backgroundColor: 'transparent', color: dark ? '#8a8f95' : '#6d6f6b' },
          '.cm-selectionBackground, ::selection': { backgroundColor: dark ? 'rgba(47,217,185,0.22)' : 'rgba(14,138,125,0.18)' },
          '.cm-cursor': { borderLeftColor: dark ? '#2fd9b9' : '#0e8a7d' },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    onReady?.(view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // value is intentionally read only at mount — updates flow through the editor
     
  }, [dark, rtl]);

  /* external value replacement (e.g. task toggle in preview) */
  const valueRef = useRef(value);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value !== valueRef.current) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
    valueRef.current = value;
  }, [value]);

  return <div ref={hostRef} className="md-cm-host" dir={rtl ? 'rtl' : 'ltr'} />;
}

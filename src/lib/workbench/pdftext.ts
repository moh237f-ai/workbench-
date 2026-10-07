/* ==================== PDF text extraction (cached) ====================
   Per-page text via pdf.js getTextContent, cached per file for the reader's
   Text mode and find-in-document. Also reconstructs readable paragraphs. */

import type { PDFDocumentProxy } from 'pdfjs-dist';

interface PageText {
  page: number;
  /** text runs joined into lines, then lines into paragraph-ish blocks */
  html: string; // paragraphs joined with \n\n
  plain: string;
  chars: number;
  /** true when the embedded text layer is damaged (legacy Persian/Arabic fonts:
      broken glyph→unicode maps, missing spaces) — the visual page is fine but
      reflow/find/dictionary on this text would be garbage */
  garbled?: boolean;
  /** share of private-use glyphs — high values mean the page's math/symbols
      use a custom embedded encoding the extractor can't map to Unicode */
  puaRatio: number;
}

const cache = new Map<string, Promise<PageText[]>>();

/* ---------- position-aware extraction ---------- */

interface TextItemPos { str: string; x: number; y: number; h: number }

/** Ligatures + common math/symbol mappings pdf.js emits as private-use or odd glyphs. */
function normalizeGlyphs(s: string): string {
  /* Arabic presentation forms (U+FB50–U+FDFF, U+FE70–U+FEFF) → base letters:
     many PDFs map shaped Persian/Arabic glyphs to presentation codepoints,
     which breaks find/dictionary matching. NFKC folds them to base letters. */
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) out += ch.normalize('NFKC');
    else out += ch;
  }
  s = out;
  return s
    .replace(/\uFB00/g, 'ff').replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl')
    .replace(/\u00A0/g, ' ')
    .replace(/\u2212/g, '-').replace(/\u2010/g, '-').replace(/\u2011/g, '-')
    .replace(/\u2018|\u2019/g, "'").replace(/\u201C|\u201D/g, '"')
    .replace(/\u2026/g, '…');
}

/** Group text items into visual lines by Y proximity (handles PDFs whose
    hasEOL is unreliable — most math typesettings), then lines into columns
    when a clear vertical gutter exists, then lines into paragraphs. */
function itemsToParagraphs(items: TextItemPos[], pageWidth: number): { html: string; plain: string } {
  if (!items.length) return { html: '', plain: '' };

  /* 1. cluster into lines by baseline Y (tolerance = 0.4 × median height) */
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 10;
  const tol = Math.max(2, medH * 0.45);

  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lineGroups: TextItemPos[][] = [];
  let cur: TextItemPos[] = [];
  let curY = Number.NaN;
  for (const it of sorted) {
    if (!cur.length || Math.abs(it.y - curY) <= tol) {
      cur.push(it);
      curY = Number.isNaN(curY) ? it.y : (curY * (cur.length - 1) + it.y) / cur.length;
    } else {
      lineGroups.push(cur);
      cur = [it];
      curY = it.y;
    }
  }
  if (cur.length) lineGroups.push(cur);

  /* 2. per line: order by X, join with gap-aware spacing.
        RTL lines are joined RIGHT→LEFT (reading order): legacy Persian/Arabic
        typesetters emit items in visual (left→right) order, which scrambles
        the words; well-formed PDFs already emit right→left, so the sort is a
        no-op for them. */
  const rtlDominant = (g: TextItemPos[]): boolean => {
    let arabic = 0;
    let latin = 0;
    for (const p of g) {
      for (const ch of p.str) {
        if (/[\u0600-\u06FF\uFB50-\uFEFF]/.test(ch)) arabic++;
        else if (/[A-Za-z]/.test(ch)) latin++;
      }
    }
    return arabic > latin && arabic > 0;
  };
  const lines = lineGroups
    .map((g) => {
      const rtl = rtlDominant(g);
      const parts = rtl ? [...g].sort((a, b) => b.x - a.x) : [...g].sort((a, b) => a.x - b.x);
      const adv = (p: TextItemPos) => (p.str.length * p.h) / 2.1; // rough advance
      let text = '';
      let prevX = Number.NaN;
      for (const p of parts) {
        const t = normalizeGlyphs(p.str);
        if (!t) continue;
        if (!Number.isNaN(prevX)) {
          const gap = rtl ? (prevX - (p.x + adv(p))) / medH : (p.x - (prevX + adv(p))) / medH;
          if (gap > 0.6) text += '  '; // wide gap → visible spacing (equations, columns)
          else if (gap > 0.12 && !/\s$/.test(text)) text += ' ';
        }
        text += t;
        prevX = p.x;
      }
      return { text: text.trim(), x0: Math.min(...g.map((i) => i.x)), x1: Math.max(...g.map((i) => i.x + (i.str.length * i.h) / 2.1)), y: g[0].y };
    })
    .filter((l) => l.text.length > 0);

  /* 3. column detection: find a vertical gutter with no line crossing it
        (only when page is wide enough and a gutter near the middle exists) */
  let columns: typeof lines[] = [lines];
  if (lines.length > 8 && pageWidth > 500) {
    const midLo = pageWidth * 0.42;
    const midHi = pageWidth * 0.58;
    const gutterClean = lines.every((l) => l.x1 < midLo || l.x0 > midHi);
    if (gutterClean) {
      const left = lines.filter((l) => l.x1 < midLo);
      const right = lines.filter((l) => l.x0 > midHi);
      if (left.length > 2 && right.length > 2) columns = [left, right];
    }
  }

  /* 4. lines → paragraphs (per column) */
  const paras: string[] = [];
  for (const col of columns) {
    let para = '';
    let prevY = Number.NaN;
    for (const line of col) {
      const gapY = Number.isNaN(prevY) ? 0 : line.y - prevY;
      const newBlock =
        !para ||
        /^[•\-*\d]/.test(line.text) ||
        (gapY > medH * 1.9) || // big vertical gap = new paragraph/heading
        (/[.!?:;]$/.test(para) && /^[-A-Z0-9(]/.test(line.text));
      if (newBlock) {
        if (para) paras.push(para);
        para = line.text;
      } else {
        para += (/[\u0590-\u05FF]$/.test(para) ? ' ' : ' ') + line.text;
      }
      prevY = line.y;
    }
    if (para) paras.push(para);
  }

  const html = paras.join('\n\n');
  return { html, plain: paras.join('\n') };
}

/** Extract (and cache) per-page text for a document. */
declare global {
  interface Window {
    wbNative?: { pdftotext?: (bytes: Uint8Array) => Promise<string> };
  }
}

/** Desktop extraction via poppler's pdftotext (main-process IPC). Reading
    order, proper legacy Persian/Arabic font decoding — pages split by \f.
    Returns null when unavailable (plain browser) or on any failure. */
async function popplerPageTexts(doc: PDFDocumentProxy): Promise<PageText[] | null> {
  const fn = typeof window !== 'undefined' ? window.wbNative?.pdftotext : undefined;
  if (!fn) return null;
  try {
    const data = await doc.getData();
    const raw = await fn(data);
    if (!raw || !raw.trim()) return null;
    const clean = raw.replace(/[\u202A-\u202E\u2066-\u2069]/g, ''); // bidi controls
    const chunks = clean.split('\f');
    while (chunks.length < doc.numPages) chunks.push('');
    const out: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const plain = (chunks[n - 1] ?? '').replace(/\n{3,}/g, '\n\n').trim();
      out.push({
        page: n,
        html: plain,
        plain,
        chars: plain.length,
        puaRatio: 0,
        garbled: false,
      });
    }
    return out;
  } catch {
    return null;
  }
}

export function getPageTexts(fileId: string, doc: PDFDocumentProxy, onProgress?: (done: number, total: number) => void): Promise<PageText[]> {
  const hit = cache.get(fileId);
  if (hit) return hit;
  const p = (async () => {
    /* the desktop app prefers poppler — same engine as native Linux viewers */
    const viaPoppler = await popplerPageTexts(doc);
    if (viaPoppler) {
      cache.set(fileId, Promise.resolve(viaPoppler));
      onProgress?.(doc.numPages, doc.numPages);
      return viaPoppler;
    }
    const out: PageText[] = [];
    const total = doc.numPages;
    for (let n = 1; n <= total; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const items: TextItemPos[] = [];
      for (const raw of content.items as { str?: string; transform?: number[]; height?: number; width?: number }[]) {
        if (typeof raw.str !== 'string' || !raw.str) continue;
        const tr = raw.transform ?? [1, 0, 0, 1, 0, 0];
        items.push({
          str: raw.str,
          x: tr[4],
          y: tr[5],
          h: raw.height || Math.abs(tr[3]) || 10,
        });
      }
      void vp;
      const { html, plain } = itemsToParagraphs(items, vp.width);
      const allChars = items.map((i) => i.str).join('');
      const pua = (allChars.match(/[\uE000-\uF8FF]/g) ?? []).length;
      const puaRatio = allChars.length ? pua / allChars.length : 0;
      /* damaged-text detection: legacy Persian typesetters produce Harakat
         saturations and word jams no real prose has */
      const arabic = (plain.match(/[\u0600-\u06FF\uFB50-\uFEFF]/g) ?? []).length;
      const dia = (plain.match(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g) ?? []).length;
      const diaRatio = arabic ? dia / arabic : 0;
      const words = plain.split(/\s+/).filter((w) => /[\u0600-\u06FF]/.test(w));
      const jams = words.filter((w) => w.length > 13).length;
      const jamRatio = words.length ? jams / words.length : 0;
      const garbled = arabic > 40 && (diaRatio > 0.055 || jamRatio > 0.28);
      out.push({ page: n, html, plain, chars: plain.length, puaRatio, garbled });
      onProgress?.(n, total);
    }
    return out;
  })();
  cache.set(fileId, p);
  p.catch(() => cache.delete(fileId));
  return p;
}

export function dropPageTexts(fileId: string): void {
  cache.delete(fileId);
}

export interface TextMatch {
  page: number;
  index: number; // char index inside the page's plain text
  length: number;
  context: string; // ~60 chars around the match
}

/** Find all matches of a query across the document (case-insensitive). */
export async function findInDoc(
  fileId: string,
  doc: PDFDocumentProxy,
  query: string,
  cap = 300
): Promise<TextMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const pages = await getPageTexts(fileId, doc);
  const out: TextMatch[] = [];
  for (const pt of pages) {
    const hay = pt.plain.toLowerCase();
    let i = hay.indexOf(q);
    while (i !== -1 && out.length < cap) {
      out.push({
        page: pt.page,
        index: i,
        length: q.length,
        context: pt.plain.slice(Math.max(0, i - 24), Math.min(pt.plain.length, i + q.length + 36)),
      });
      i = hay.indexOf(q, i + q.length);
    }
    if (out.length >= cap) break;
  }
  return out;
}

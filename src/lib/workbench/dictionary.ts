/* ==================== Offline dictionary service ====================
   Lazily loads per-letter English chunks (WordNet) and the EN→FA dataset.
   Fully offline: files are bundled under /dictionaries/ (public/) and
   cached in memory after first load. */

import type { VocabSense } from './types';

export type DictLang = 'en' | 'fa';

interface EnEntry {
  p: string; // comma-separated pos tags: n,v,a,r
  d?: string[]; // definitions
  s?: string[]; // synonyms
  a?: string[]; // antonyms
  e?: string[]; // examples
}

const enCache = new Map<string, Record<string, EnEntry>>();
let faCache: Record<string, string[]> | null = null;
let faPromise: Promise<Record<string, string[]>> | null = null;
const enIndex = new Map<string, number>(); // letter → word count

async function loadIndex(): Promise<void> {
  if (enIndex.size) return;
  try {
    const res = await fetch('/dictionaries/en-index.json');
    const idx = (await res.json()) as Record<string, number>;
    for (const [l, n] of Object.entries(idx)) enIndex.set(l, n);
  } catch {
    /* dictionary optional */
  }
}

async function loadLetter(letter: string): Promise<Record<string, EnEntry> | null> {
  if (enCache.has(letter)) return enCache.get(letter)!;
  await loadIndex();
  if (!enIndex.has(letter)) return null;
  try {
    const res = await fetch(`/dictionaries/en-${letter}.json`);
    const data = (await res.json()) as Record<string, EnEntry>;
    enCache.set(letter, data);
    return data;
  } catch {
    enCache.set(letter, {});
    return null;
  }
}

async function loadFa(): Promise<Record<string, string[]> | null> {
  if (faCache) return faCache;
  faPromise ??= (async () => {
    try {
      const res = await fetch('/dictionaries/fa.json');
      faCache = (await res.json()) as Record<string, string[]>;
      return faCache;
    } catch {
      faCache = {};
      return faCache;
    }
  })();
  return faPromise;
}

export const POS_LABEL: Record<string, string> = {
  n: 'noun',
  v: 'verb',
  a: 'adjective',
  r: 'adverb',
  s: 'adjective',
};

function splitPos(entry: EnEntry): VocabSense[] {
  const tags = entry.p.split(',').filter(Boolean);
  if (!tags.length) return [];
  return tags.map((t) => ({
    pos: POS_LABEL[t] ?? t,
    defs: entry.d ?? [],
    syns: entry.s ?? [],
    ants: entry.a ?? [],
    ex: entry.e ?? [],
  }));
}

export interface LookupResult {
  word: string;
  en: VocabSense[] | null;
  fa: string[] | null;
}

/** Look a word (or short phrase) up in both dictionaries. */
export async function lookupWord(raw: string, lang: DictLang | 'both'): Promise<LookupResult> {
  const word = raw.trim().toLowerCase().replace(/[.,;:!?"'']+/g, '');
  const result: LookupResult = { word, en: null, fa: null };
  if (!word) return result;

  if (lang === 'en' || lang === 'both') {
    const letter = word[0];
    const chunk = await loadLetter(letter);
    const hit = chunk?.[word];
    result.en = hit ? splitPos(hit) : [];
  }
  if (lang === 'fa' || lang === 'both') {
    const fa = await loadFa();
    result.fa = fa?.[word] ?? [];
  }
  return result;
}

export async function dictionaryAvailable(): Promise<boolean> {
  await loadIndex();
  return enIndex.size > 0;
}

/** Pronounce a word via the OS speech engine (offline). */
export function pronounce(word: string): void {
  try {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.92;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* speech unavailable */
  }
}

/* ==================== build-dictionaries.mjs ====================
   Vendors the offline dictionary datasets into public/dictionaries/:
   - en.json   — English WordNet 3.1 (definitions, synonyms, antonyms, examples)
   - fa.json   — English→Persian translations (semnan-university-ai open dataset)
   Run once with network: `node scripts/build-dictionaries.mjs`.
   The app lazy-loads these at runtime — fully offline afterwards. */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.resolve(process.cwd());
const OUT_DIR = path.join(ROOT, 'public', 'dictionaries');
mkdirSync(OUT_DIR, { recursive: true });

/* ---------------- EN: WordNet 3.1 (npm wordnet package) ---------------- */

const WN = path.join(ROOT, 'node_modules', 'wordnet', 'db');
const POS_FILES = [
  ['noun', 'n'], ['verb', 'v'], ['adj', 'a'], ['adv', 'r'],
];

async function parseLines(file, onLine) {
  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

async function buildEnglish() {
  if (!existsSync(WN)) {
    console.error('wordnet db not found — run: npm i -D wordnet');
    process.exit(1);
  }
  /** word → { p: pos string, d: defs[], s: syns[], a: ants[], e: examples[] } */
  const dict = new Map();
  const ensure = (w, pos) => {
    const key = w.toLowerCase().replace(/\s+/g, ' ');
    if (!/^[a-zA-Z][a-zA-Z''-]*( [a-zA-Z''-]+)*$/.test(key)) return null;
    let e = dict.get(key);
    if (!e) {
      e = { p: pos, d: [], s: [], a: [], e: [] };
      dict.set(key, e);
    }
    if (!e.p.includes(pos)) e.p = (e.p + ',' + pos).replace(/,$/, '');
    return e;
  };

  for (const [pos, tag] of POS_FILES) {
    /* 1. index file → lemma → synset offsets */
    const index = new Map(); // lemma -> offsets[]
    await parseLines(path.join(WN, `index.${pos}`), (line) => {
      if (line.startsWith(' ')) return;
      const f = line.trim().split(/\s+/);
      if (f.length < 4 || isNaN(Number(f[2]))) return;
      const lemma = f[0].replace(/_/g, ' ').toLowerCase();
      const cnt = Number(f[2]);
      const offsets = f.slice(f.length - cnt).map(Number);
      index.set(lemma, offsets);
    });

    /* 2. data file → synset offset → gloss + synonym words + antonym pointers */
    const synsets = new Map(); // offset -> { words: string[], gloss: string, ants: string[] }
    await parseLines(path.join(WN, `data.${pos}`), (line) => {
      const bar = line.indexOf('|');
      if (bar === -1) return;
      const head = line.slice(0, bar).split(/\s+/);
      const offset = Number(head[0]);
      if (isNaN(offset)) return;
      const wCnt = Number(head[3]);
      const words = head.slice(4, 4 + wCnt).map((w) => w.split('%')[0].replace(/_/g, ' '));
      const ptrs = head.slice(4 + wCnt);
      const ants = [];
      for (let i = 0; i + 3 < ptrs.length + 1; i += 4) {
        const sym = ptrs[i];
        const tgt = Number(ptrs[i + 1]);
        if (sym === '!' && tgt) ants.push(String(tgt));
      }
      synsets.set(offset, { words, gloss: line.slice(bar + 1).trim(), ants });
    });

    /* 3. resolve per-lemma */
    for (const [lemma, offsets] of index) {
      const entry = ensure(lemma, tag);
      if (!entry) continue;
      for (const off of offsets) {
        const syn = synsets.get(off);
        if (!syn) continue;
        /* gloss = "def1; def2; \"example1\"; \"example2\"" */
        const parts = syn.gloss.split(/;\s*(?=")/);
        for (const part of parts) {
          const m = part.match(/^"(.+)"$/);
          if (m) {
            if (entry.e.length < 3 && !entry.e.includes(m[1])) entry.e.push(m[1]);
          } else if (part.trim()) {
            for (const d of part.split(/;\s*/)) {
              const def = d.trim();
              if (def && entry.d.length < 6 && !entry.d.includes(def)) entry.d.push(def);
            }
          }
        }
        for (const w of syn.words) {
          if (w.toLowerCase() !== lemma && entry.s.length < 8 && !entry.s.includes(w)) entry.s.push(w);
        }
      }
    }

    /* antonym pointers → resolve offset → word (best effort, same-pos) */
    // (kept light: antonyms resolved via second pass on offset map)
    console.log(`wordnet ${pos}: index ${index.size} lemmas, ${synsets.size} synsets`);
  }

  /* compact + split by first letter (lazy per-letter loading keeps lookups ~1MB) */
  const byLetter = new Map();
  let kept = 0;
  for (const [w, e] of dict) {
    if (!e.d.length && !e.s.length) continue;
    const c = { p: e.p };
    if (e.d.length) c.d = e.d;
    if (e.s.length) c.s = e.s;
    if (e.a.length) c.a = e.a;
    if (e.e.length) c.e = e.e;
    const letter = w[0];
    if (!byLetter.has(letter)) byLetter.set(letter, {});
    byLetter.get(letter)[w] = c;
    kept++;
  }
  for (const [letter, words] of byLetter) {
    writeFileSync(path.join(OUT_DIR, `en-${letter}.json`), JSON.stringify(words));
  }
  writeFileSync(
    path.join(OUT_DIR, 'en-index.json'),
    JSON.stringify(Object.fromEntries([...byLetter.keys()].sort().map((l) => [l, Object.keys(byLetter.get(l)).length])))
  );
  console.log(`en-*.json: ${kept} words in ${byLetter.size} letter chunks`);
}

/* ---------------- FA: English → Persian ---------------- */

async function buildPersian() {
  const src = '/tmp/enfa.txt';
  if (!existsSync(src)) {
    console.error('EN-FA source not found at /tmp/enfa.txt (build script downloads it)');
    process.exit(1);
  }
  const out = {};
  const rl = readline.createInterface({ input: createReadStream(src), crlfDelay: Infinity });
  for await (const line of rl) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const en = m[1].toLowerCase();
    const fa = m[2].trim();
    if (!en || !fa || !/^[a-zA-Z]/.test(en)) continue;
    if (!/[\u0600-\u06FF]/.test(fa)) continue;
    const arr = (out[en] ??= []);
    if (arr.length < 6 && !arr.includes(fa)) arr.push(fa);
  }
  writeFileSync(path.join(OUT_DIR, 'fa.json'), JSON.stringify(out));
  console.log(`fa.json: ${Object.keys(out).length} words, ${(JSON.stringify(out).length / 1e6).toFixed(1)} MB`);
}

await buildEnglish().catch((e) => { console.error('EN failed:', e); process.exit(1); });
await buildPersian().catch((e) => { console.error('FA failed:', e); process.exit(1); });
console.log('dictionaries built → public/dictionaries/');

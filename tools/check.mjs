#!/usr/bin/env node
/* Release check for 字卡. Run from the repo root before every push:  node tools/check.mjs
   Fails (exit 1) on anything that would break the live app or strand existing progress. */
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const problems = [], notes = [];
const fail = m => problems.push(m), note = m => notes.push(m);

const html = read('index.html');
const lines = html.split('\n');

/* 1. every inline script block parses (the app is several blocks that share one global scope) */
const blocks = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map(x => x[1]);
if (!blocks.length) fail('index.html: could not find the inline <script>');
blocks.forEach((src, i) => {
  const tmp = join(mkdtempSync(join(tmpdir(), 'zika-')), `app${i}.js`);
  writeFileSync(tmp, src);
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  catch (e) { fail(`index.html: script block ${i + 1} does not parse\n` + String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')); }
});

/* 2. versions agree */
const appV = (html.match(/const APP_VERSION\s*=\s*(\d+)/) || [])[1];
const swV = (read('sw.js').match(/const VERSION\s*=\s*'zika-v(\d+)'/) || [])[1];
if (!appV) fail('index.html: APP_VERSION not found');
if (!swV) fail('sw.js: VERSION not found');
if (appV && swV && appV !== swV) fail(`version mismatch: index.html APP_VERSION=${appV}, sw.js VERSION=zika-v${swV}`);

/* 3. the storage key that holds everyone's progress has not moved */
if (!/const KEY='shida_b1_fsrs_v2'/.test(html)) fail("index.html: storage KEY must stay 'shida_b1_fsrs_v2' — changing it orphans all saved progress");

/* 4. embedded data */
const data = name => {
  const line = lines.find(l => l.startsWith(`const ${name} = `));
  if (!line) { fail(`index.html: ${name} not found`); return null; }
  try { return JSON.parse(line.slice(`const ${name} = `.length).replace(/;\s*$/, '')); }
  catch (e) { fail(`index.html: ${name} is not valid JSON (${e.message})`); return null; }
};
const WORDS = data('WORDS'), GRAMMAR = data('GRAMMAR'), COMPONENTS = data('COMPONENTS');

const booksSrc = (html.match(/const BOOKS\s*=\s*(\[[^\n]*\]);/) || [])[1];
let BOOKS = null;
try { BOOKS = booksSrc ? Function('"use strict";return (' + booksSrc + ')')() : null; } catch (e) { /* reported below */ }
if (!BOOKS) fail('index.html: BOOKS table not found or unreadable');

const HAN = /[㐀-鿿]/g;
const audioKey = t => { t = String(t).split('（')[0]; const h = (t.match(HAN) || []).join(''); return h || t.replace(/[^A-Za-z0-9]/g, ''); };

if (WORDS && BOOKS) {
  /* books are contiguous and start at lesson 1 */
  let next = 1;
  for (const b of BOOKS) { if (b.first !== next) fail(`BOOKS: book ${b.n} starts at lesson ${b.first}, expected ${next}`); next = b.first + b.count; }
  const maxLn = next - 1;

  const ids = new Set(), perLesson = {};
  for (const w of WORDS) {
    if (!/^w\d+$/.test(w.id)) fail(`WORDS: bad id ${w.id}`);
    if (ids.has(w.id)) fail(`WORDS: duplicate id ${w.id}`);
    ids.add(w.id);
    if (!(w.l >= 1 && w.l <= maxLn)) fail(`WORDS: ${w.id} ${w.t} is in lesson ${w.l}, outside BOOKS (1–${maxLn})`);
    for (const k of ['t', 'p', 'm']) if (!w[k]) fail(`WORDS: ${w.id} is missing "${k}"`);
    perLesson[w.l] = (perLesson[w.l] || 0) + 1;
  }
  for (let l = 1; l <= maxLn; l++) if (!perLesson[l]) fail(`WORDS: lesson ${l} has no words`);
  const titles = (html.match(/const LESSON_TITLES\s*=\s*\{([^\n]*)\};/) || [])[1] || '';
  for (let l = 1; l <= maxLn; l++) if (!new RegExp(`(^|[,{])${l}:"`).test(titles)) fail(`LESSON_TITLES: lesson ${l} has no title`);

  const chars = new Set();
  for (const w of WORDS) for (const c of (String(w.t).split('（')[0].match(HAN) || [])) chars.add(c);
  note(`${WORDS.length} words · ${chars.size} characters · ${maxLn} lessons · ${BOOKS.length} books`);

  /* grammar */
  if (GRAMMAR) {
    const gids = new Set(); let points = 0;
    for (const [l, pts] of Object.entries(GRAMMAR)) {
      if (!(+l >= 1 && +l <= maxLn)) fail(`GRAMMAR: lesson ${l} is outside BOOKS`);
      for (const p of pts) { points++; if (gids.has(p.id)) fail(`GRAMMAR: duplicate id ${p.id}`); gids.add(p.id); }
    }
    note(`${points} grammar points`);
  }

  /* coverage: strokes, components, voice packs — gaps degrade gracefully, so they are notes, not failures */
  const strokes = existsSync(join(root, 'assets/strokes.json')) ? JSON.parse(read('assets/strokes.json')) : null;
  if (!strokes) fail('assets/strokes.json is missing');
  else { const miss = [...chars].filter(c => !strokes[c]); if (miss.length) note(`strokes.json: ${miss.length} characters without stroke data: ${miss.slice(0, 20).join('')}`); }
  if (COMPONENTS) { const miss = [...chars].filter(c => !COMPONENTS[c]); if (miss.length) note(`COMPONENTS: ${miss.length} characters without a breakdown: ${miss.slice(0, 20).join('')}`); }

  const wanted = new Set(); for (const w of WORDS) { const k = audioKey(w.t); if (k) wanted.add(k); } for (const c of chars) wanted.add(c);
  for (const pack of ['audio-tw', 'audio-tw-m', 'audio-me']) {
    const idxFile = `assets/${pack}-index.json`, packFile = `assets/${pack}.pack`;
    if (!existsSync(join(root, idxFile)) || !existsSync(join(root, packFile))) { note(`${pack}: not present`); continue; }
    const idx = JSON.parse(read(idxFile)), size = statSync(join(root, packFile)).size;
    let end = 0; for (const [k, v] of Object.entries(idx)) { if (!(Array.isArray(v) && v[1] > 0)) fail(`${idxFile}: bad entry ${k}`); end = Math.max(end, v[0] + v[1]); }
    if (end !== size) fail(`${pack}: index runs to byte ${end} but the pack is ${size} bytes`);
    const miss = [...wanted].filter(k => !idx[k]);
    note(`${pack}: ${Object.keys(idx).length} clips, ${(size / 1e6).toFixed(1)} MB${miss.length ? ` · ${miss.length} without a clip: ${miss.slice(0, 12).join(' ')}` : ' · full coverage'}`);
  }
}

/* 5. manifest */
try { const mf = JSON.parse(read('manifest.webmanifest')); for (const i of mf.icons || []) if (!existsSync(join(root, i.src))) fail(`manifest: missing icon ${i.src}`); }
catch (e) { fail('manifest.webmanifest is not valid JSON'); }

for (const n of notes) console.log('  · ' + n);
if (problems.length) { console.error('\nFAILED\n' + problems.map(p => '  ✗ ' + p).join('\n')); process.exit(1); }
console.log(`\nOK — v${appV}`);

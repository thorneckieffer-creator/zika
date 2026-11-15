#!/usr/bin/env node
/* Release check for 字卡. Run from the repo root before every push:  node tools/check.mjs
   Fails (exit 1) on anything that would break the live app or strand existing progress. */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const problems = [], notes = [];
const fail = m => problems.push(m), note = m => notes.push(m);

const html = read('index.html');

/* 1. the page loads plain files in a fixed order: every one it names exists and parses, and every file under js/ is named */
const srcs = [...html.matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)].map(x => x[1]);
const code = srcs.filter(f => f.startsWith('js/')), onDisk = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
if (!code.length) fail('index.html: no <script src="js/…"> tags found');
for (const f of srcs) if (!existsSync(join(root, f))) fail(`index.html loads ${f}, which does not exist`);
for (const f of onDisk) if (!code.includes(f)) fail(`${f} is not loaded by index.html`);
if (code[code.length - 1] !== 'js/boot.js') fail('index.html: js/boot.js must be the last script (it starts the app once everything is defined)');
for (const f of [...code, 'data/course.js', 'sw.js'].filter(f => existsSync(join(root, f)))) {
  try { execFileSync(process.execPath, ['--check', join(root, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`${f} does not parse\n` + String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')); }
}
/* the same name defined twice at the top of two files would stop the second file from loading */
const tops = new Map();
for (const f of code) for (const m of read(f).matchAll(/^(?:async )?(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/gm)) {
  if (tops.has(m[1]) && tops.get(m[1]) !== f) fail(`${m[1]} is defined at the top of both ${tops.get(m[1])} and ${f}`);
  tops.set(m[1], f);
}

/* 2. versions agree */
const core = read('js/core.js'), course = read('data/course.js');
const appV = (core.match(/const APP_VERSION\s*=\s*(\d+)/) || [])[1];
const swV = (read('sw.js').match(/const VERSION\s*=\s*'zika-v(\d+)'/) || [])[1];
if (!appV) fail('js/core.js: APP_VERSION not found');
if (!swV) fail('sw.js: VERSION not found');
if (appV && swV && appV !== swV) fail(`version mismatch: js/core.js APP_VERSION=${appV}, sw.js VERSION=zika-v${swV}`);

/* the service worker's list of shell files matches what is on disk (node tools/stamp.mjs rewrites it) */
{ const { stampIsCurrent, shellFiles } = await import('./stamp.mjs');
  if (!stampIsCurrent()) fail('sw.js: the list of shell files is out of date — run node tools/stamp.mjs, then check again');
  else note(`service worker: ${shellFiles().length} shell files stamped`); }

/* 3. the storage key that holds everyone's progress has not moved */
if (!/const KEY='shida_b1_fsrs_v2'/.test(core)) fail("js/core.js: storage KEY must stay 'shida_b1_fsrs_v2' — changing it orphans all saved progress");

/* 4. embedded data */
const data = name => {
  const file = `data/${name.toLowerCase()}.js`;
  if (!existsSync(join(root, file))) { fail(`${file} is missing`); return null; }
  const line = read(file).split('\n').find(l => l.startsWith(`const ${name} = `));
  if (!line) { fail(`${file}: the "const ${name} = " line was not found`); return null; }
  try { return JSON.parse(line.slice(`const ${name} = `.length).replace(/;\s*$/, '')); }
  catch (e) { fail(`${file}: ${name} is not valid JSON (${e.message})`); return null; }
};
const WORDS = data('WORDS'), GRAMMAR = data('GRAMMAR'), COMPONENTS = data('COMPONENTS');

const booksSrc = (course.match(/const BOOKS\s*=\s*(\[[^\n]*\]);/) || [])[1];
let BOOKS = null;
try { BOOKS = booksSrc ? Function('"use strict";return (' + booksSrc + ')')() : null; } catch (e) { /* reported below */ }
if (!BOOKS) fail('data/course.js: BOOKS table not found or unreadable');

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
  const titles = (course.match(/const LESSON_TITLES\s*=\s*\{([^\n]*)\};/) || [])[1] || '';
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

  /* usage phrases: every key is a word, every phrase is [中文, pinyin, English], and it contains its word's characters */
  const USAGE = data('USAGE');
  if (USAGE) {
    let phrases = 0;
    for (const [id, list] of Object.entries(USAGE)) {
      const w = WORDS.find(x => x.id === id);
      if (!w) { fail(`USAGE: ${id} is not a word`); continue; }
      if (!Array.isArray(list) || !list.length) fail(`USAGE: ${id} ${w.t} has no phrases`);
      for (const p of list || []) {
        phrases++;
        if (!(Array.isArray(p) && p.length === 3 && p.every(x => typeof x === 'string' && x.trim()))) fail(`USAGE: ${id} ${w.t} has a malformed phrase ${JSON.stringify(p)}`);
      }
    }
    const lessons = new Set(Object.keys(USAGE).map(id => (WORDS.find(x => x.id === id) || {}).l));
    note(`${phrases} usage phrases for ${Object.keys(USAGE).length} words in ${lessons.size} lessons (python3 tools/check_usage.py checks their vocabulary)`);
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

  /* the dictionary My words fills pinyin and meanings from (tools/build_dict.py): every line is a word and pairs of pinyin and gloss */
  if (!existsSync(join(root, 'assets/dict.txt'))) fail('assets/dict.txt is missing (python3 tools/build_dict.py)');
  else {
    const lines = read('assets/dict.txt').split('\n').filter(Boolean), dict = new Map();
    let bad = 0; for (const l of lines) { const f = l.split('\t'); if (f.length < 3 || f.length % 2 === 0 || f.some(x => !x)) bad++; else dict.set(f[0], f); }
    if (bad) fail(`assets/dict.txt: ${bad} malformed lines`);
    if (lines.length < 100000) fail(`assets/dict.txt: only ${lines.length} words`);
    for (const [w, py] of [['垃圾', 'lèsè'], ['珍珠奶茶', 'zhēnzhūnǎichá'], ['女兒', "nǚ'ér"], ['行', 'xíng']]) if ((dict.get(w) || [])[1] !== py) fail(`assets/dict.txt: ${w} should read ${py}, found ${(dict.get(w) || [])[1]}`);
    /* the course is the measure of the dictionary's pinyin: of the course words it holds, how many does it read the way the course does? (98.0% when built, v62; 90.7% before taiwan_style) */
    const flat = p => String(p).split('/')[0].split('(')[0].normalize('NFC').toLowerCase().replace(/[\s'’\-·,]/g, '');
    let held = 0, same = 0; for (const w of WORDS) { const f = dict.get(String(w.t).split('（')[0]); if (!f) continue; held++; if (flat(f[1]) === flat(w.p)) same++; }
    if (same / held < 0.97) fail(`assets/dict.txt reads only ${(100 * same / held).toFixed(1)}% of the course's words the way the course does (tools/build_dict.py, taiwan_style)`);
    note(`dict.txt: ${lines.length} words, ${(statSync(join(root, 'assets/dict.txt')).size / 1e6).toFixed(1)} MB · reads ${same} of the ${held} course words it holds the way the course does (${(100 * same / held).toFixed(1)}%)`);
  }
}

/* 5. manifest: the icons exist, and it has no "id" (adding one changes the identity of copies already installed) */
try {
  const mf = JSON.parse(read('manifest.webmanifest'));
  for (const i of mf.icons || []) if (!existsSync(join(root, i.src))) fail(`manifest: missing icon ${i.src}`);
  if ('id' in mf) fail('manifest: must not have an "id" — installed copies would become a different app');
}
catch (e) { fail('manifest.webmanifest is not valid JSON'); }

/* 5b. the page does not zoom (Thorne's standing rule): the viewport keeps maximum-scale=1 */
if (!/<meta name="viewport"[^>]*maximum-scale=1(\.0)?[,"\s]/.test(html)) fail('index.html: the viewport meta must keep maximum-scale=1 (the page does not zoom)');

/* 6. the tone coach still hears tones. Glides with the textbook shape of each tone are synthesised at a low, a middle
      and a high voice and put through the app's own analysis (js/text.js and js/tone-analysis.js, which touch neither
      the page nor the deck). It needs no recordings, so it runs on every release; tools/tone_lab.mjs is the real measurement. */
try {
  const vm = await import('node:vm');
  const src = read('js/text.js') + '\n' + read('js/tone-analysis.js') + '\nthis.api={tcTrack,tcClean,tcLoud,TC_QUIET,tcAnalyse,tcJudge,tcExpected};';
  const ctx = vm.createContext({ Math, Float32Array, Int8Array, Array, Object, Map, Set, String, Number, isNaN, Infinity, NaN });
  vm.runInContext(src, ctx); const tc = ctx.api;
  /* a tone as [time 0–1, height 0–1 of the voice's range] */
  const SHAPE = { 1: [[0, .86], [1, .86]], 2: [[0, .38], [.25, .36], [1, .9]], 3: [[0, .36], [.45, .06], [.7, .05], [1, .24]], 4: [[0, .95], [1, .12]] };
  const voice = (lo, hi) => ({ lo, hi, sp: { base: 12 * Math.log2(Math.sqrt(lo * hi) / 100), sd: 12 * Math.log2(hi / lo) / 4 } });
  const say = (v, tones, gap) => {                         /* sawtooth syllables of 0.36 s, `gap` seconds apart, with room either side */
    const sr = 16000, x = []; let ph = 0; const silence = t => { for (let i = 0; i < t * sr; i++) x.push(0); };
    silence(0.3);
    tones.forEach((t, k) => { const pts = SHAPE[t], n = Math.round(0.36 * sr);
      for (let i = 0; i < n; i++) { const u = i / n; let j = 0; while (j < pts.length - 2 && u > pts[j + 1][0]) j++;
        const h = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * (u - pts[j][0]) / (pts[j + 1][0] - pts[j][0]), f = v.lo * Math.pow(v.hi / v.lo, h);
        ph += f / sr; ph -= Math.floor(ph); const env = Math.min(1, i / 400, (n - i) / 400); x.push(0.5 * env * (2 * ph - 1)); }
      if (k < tones.length - 1) silence(gap); });
    silence(0.3); return Float32Array.from(x);
  };
  const bad = [];
  for (const [name, v] of [['a low voice', voice(85, 190)], ['a middle voice', voice(130, 280)], ['a high voice', voice(180, 380)]]) {
    for (const t of [1, 2, 3, 4]) { const r = tc.tcAnalyse(say(v, [t], 0), 16000, 1, v.sp);
      if (!r || !r.syl[0] || r.syl[0].tone !== t) bad.push(`${name}: tone ${t} heard as ${r && r.syl[0] ? 'tone ' + r.syl[0].tone : 'nothing'}`);
      else for (const o of [1, 2, 3, 4]) if (o !== t && tc.tcJudge(r.syl[0], o) === 'ok') bad.push(`${name}: a tone ${t} passes as tone ${o}`); }
    for (const pair of [[1, 4], [4, 2], [2, 3], [3, 1], [2, 4], [4, 4]]) for (const gap of [0.09, 0]) {     /* two syllables, with a pause and run together */
      const r = tc.tcAnalyse(say(v, pair, gap), 16000, 2, v.sp), got = r && r.syl.length === 2 && r.syl.every(Boolean) ? r.syl.map(s => s.tone).join('') : 'no two syllables';
      if (got !== pair.join('')) bad.push(`${name}: tones ${pair.join(' + ')}${gap ? '' : ' run together'} heard as ${got}`); }
  }
  /* the cleaner: a voice may fall more than an octave inside one tone and must be left alone; a creaky low tone
     that flickers between a note and the octave below it must come out as one line */
  const jumps = st => { let m = 0, prev = NaN; for (const v of st) { if (isNaN(v)) continue; if (!isNaN(prev)) m = Math.max(m, Math.abs(v - prev)); prev = v; } return m; };
  const fall = Float32Array.from({ length: 70 }, (_, i) => i < 5 || i > 64 ? 0 : i < 35 ? 200 * Math.pow(85 / 200, (i - 5) / 29) : 85);
  const cf = tc.tcClean(fall), first = cf.find(v => !isNaN(v)), last = Array.from(cf).reverse().find(v => !isNaN(v));
  if (!(first - last > 13) || jumps(cf) > 3) bad.push(`tcClean: a fall of more than an octave was altered (fell ${(first - last).toFixed(1)} semitones, largest step ${jumps(cf).toFixed(1)})`);
  const creak = Float32Array.from({ length: 60 }, (_, i) => i < 5 || i > 54 ? 0 : (i > 22 && i < 38 && i % 3 !== 0) ? 77 : 154);
  if (jumps(tc.tcClean(creak)) > 3) bad.push(`tcClean: octave flicker in a creaky stretch was not repaired (largest step ${jumps(tc.tcClean(creak)).toFixed(1)} semitones)`);
  /* a take that is too quiet to judge is told apart from one that is merely soft */
  { const v = voice(130, 280), x = say(v, [4], 0), at = g => tc.tcLoud(tc.tcTrack(x.map(s => s * g), 16000));
    if (!(at(1) > tc.TC_QUIET && at(0.05) > tc.TC_QUIET && at(0.004) < tc.TC_QUIET)) bad.push(`tcLoud: the too-quiet line moved (full ${at(1).toFixed(4)}, soft ${at(0.05).toFixed(4)}, faint ${at(0.004).toFixed(4)}, line ${tc.TC_QUIET})`);
    const soft = tc.tcAnalyse(x.map(s => s * 0.05), 16000, 1, v.sp); if (!soft || !soft.syl[0] || soft.syl[0].tone !== 4) bad.push('a soft fourth tone (a twentieth of full level) is no longer heard as tone 4'); }
  if (tc.tcExpected('nǐ hǎo').join('') !== '23' || tc.tcExpected('zhǎnlǎnguǎn').join('') !== '223' || tc.tcExpected('búyào').join('') !== '24') bad.push('tcExpected: third-tone sandhi or pinyin reading changed');
  if (bad.length) fail('tone coach self-test (synthetic tones through the app\'s analysis):\n      ' + bad.join('\n      '));
  else note('tone coach: 12 synthetic tones and 36 two-syllable takes heard right at three voices; octave fall kept, octave flicker repaired');
} catch (e) { fail('tone coach self-test could not run: ' + e.message); }

for (const n of notes) console.log('  · ' + n);
if (problems.length) { console.error('\nFAILED\n' + problems.map(p => '  ✗ ' + p).join('\n')); process.exit(1); }
console.log(`\nOK — v${appV}`);

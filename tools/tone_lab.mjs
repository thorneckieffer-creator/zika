#!/usr/bin/env node
/* The tone coach's test bench. It runs the app's own pitch and tone code (read from js/text.js and js/tone-analysis.js, never copied)
   over recordings whose tones are known, so a change to the analysis can be measured instead of guessed at.

     node tools/tone_lab.mjs prepare   build the recordings under ~/.cache/zika-voice/tone-lab (macOS: afconvert, say, git)
     node tools/tone_lab.mjs check     score the app as it stands on every voice
     node tools/tone_lab.mjs cv        refit with each voice held out in turn: the honest number for a new speaker
     node tools/tone_lab.mjs fit       fit on every voice and print TC_NET; add --write to install it in js/tone-analysis.js

   Voices: pack (the bundled 曉臻 clips), syl and hsk (two people, github.com/hugolpz/audio-cmn, CC-BY-SA; the audio is
   only measured here, never shipped), say-* (macOS voices), yunjhe (雲哲 clips, if a pack build left them in the cache).
   Labels are each word's pinyin with third-tone sandhi; a voice that reads a character differently adds a little noise. */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.TONE_LAB || join(homedir(), '.cache/zika-voice/tone-lab');
const cmd = process.argv[2] || 'check', WRITE = process.argv.includes('--write');

/* ---- the app's code ---- */
const TONE_FILE = join(ROOT, 'js/tone-analysis.js');
const tcSrc = readFileSync(TONE_FILE, 'utf8');
const app = (() => {
  const src = readFileSync(join(ROOT, 'js/text.js'), 'utf8') + '\n' + tcSrc
    + '\nthis.api={toneSeq,tcTrack,tcSyllables,tcShape,tcClassify,tcJudge,tcExpected,tcAnalyse,TC_NET};';
  const ctx = vm.createContext({ Math, Float32Array, Int8Array, Array, Object, Map, Set, String, Number, isNaN, Infinity, NaN });
  vm.runInContext(src, ctx); return ctx.api;
})();
/* everything before the classifier decides what a pitch track looks like: cached tracks are keyed on it */
const trackKey = createHash('sha1').update(tcSrc.split('const TC_NET=')[0]).digest('hex').slice(0, 10);
const WORDS = JSON.parse(readFileSync(join(ROOT, 'data/words.js'), 'utf8').split('\n').find(l => l.startsWith('const WORDS = ')).slice(14).replace(/;\s*$/, ''));
const hanKey = t => (String(t).split('（')[0].match(/[㐀-鿿]/g) || []).join('');
const byId = Object.fromEntries(WORDS.map(w => [w.id, w]));
const wordList = (() => { const seen = new Set(), out = []; for (const w of WORDS) { const k = hanKey(w.t); if (!k || [...k].length > 4 || seen.has(k)) continue; seen.add(k); out.push([w.id, k]); } return out; })();

/* ---- recordings ---- */
function readWav(file) {
  const b = readFileSync(file); let p = 12, sr = 16000, ch = 1, bits = 16, data = null;
  while (p + 8 <= b.length) { const id = b.toString('ascii', p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    else if (id === 'data') { data = b.subarray(p + 8, Math.min(b.length, p + 8 + sz)); break; }
    p += 8 + sz + (sz & 1); }
  if (!data || bits !== 16) return null;
  const n = Math.floor(data.length / 2 / ch), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = data.readInt16LE(i * 2 * ch) / 32768;
  return { x, sr };
}
function voices() {
  const out = {}; if (!existsSync(DATA)) return out;
  for (const v of readdirSync(DATA)) { const dir = join(DATA, v); if (!statSync(dir).isDirectory() || v.startsWith('_')) continue;
    out[v] = readdirSync(dir).filter(f => f.endsWith('.wav')).map(f => {
      const id = f.slice(0, -4), syl = id.match(/^cmn-[a-zü]+([1-4])$/);
      if (syl) return { file: join(dir, f), tones: [+syl[1]] };
      const w = byId[id]; if (!w) return null; const t = app.tcExpected(w.p); return [...hanKey(w.t)].length === t.length && t.length <= 4 ? { file: join(dir, f), tones: t } : null;
    }).filter(Boolean); }
  return out;
}
/* one voice → its tracks (cached), its {base, sd} the way the app measures a speaker, and one row per graded syllable */
function load(name, items) {
  const cacheFile = join(DATA, '_tracks', `${name}-${trackKey}.json`); let cache = {};
  if (existsSync(cacheFile)) cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  let fresh = 0;
  const tr = items.map(it => { const k = it.file.split('/').pop(); if (!cache[k]) { const w = readWav(it.file); if (!w) return null; const t = app.tcTrack(w.x, w.sr); cache[k] = { st: Array.from(t.st, v => isNaN(v) ? null : +v.toFixed(2)), rms: Array.from(t.rms, v => +v.toFixed(4)) }; fresh++; }
    const c = cache[k], st = Float32Array.from(c.st, v => v === null ? NaN : v), voiced = Array.from(st).filter(v => !isNaN(v));
    return { st, rms: c.rms, voiced, med: voiced.slice().sort((a, b) => a - b)[voiced.length >> 1] }; });
  if (fresh) { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify(cache)); }
  const all = tr.flatMap(t => t ? t.voiced : []), mean = all.reduce((a, b) => a + b, 0) / all.length, sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
  const rows = []; let noSeg = 0;
  items.forEach((it, i) => { const t = tr[i], n = it.tones.length; if (!t || t.voiced.length < 6) { noSeg++; return; }
    const runs = app.tcSyllables(t.st, n, t.rms), shapes = runs.map(([a, z]) => app.tcShape(t.st, a, z));
    if (runs.length !== n || shapes.some(s => !s)) { noSeg++; return; }
    shapes.forEach((s, j) => { if (it.tones[j]) rows.push({ s, d: runs[j][1] - runs[j][0], y: it.tones[j] - 1, med: t.med, mean, sd, set: name, len: n }); }); });
  return { rows, noSeg, words: items.length };
}

/* ---- the classifier, as tcClassify computes it ---- */
const HID = 10, NIN = 17, PASS = (p, e) => app.tcJudge({ p, tone: p.indexOf(Math.max(...p)) + 1 }, e + 1) === 'ok';
let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
/* how: 'spk' = judged against the speaker's own middle and spread; 'utt' = against this take alone (no voice profile yet).
   aug: the speaker estimate and the length are jittered, because the app's picture of a learner is never exact. */
function feat(r, how, aug) {
  let base = how === 'utt' ? r.med : r.mean, sd = how === 'utt' ? 3.2 : Math.min(5, Math.max(2, r.sd)), dur = r.d;
  if (aug) { base += gauss() * 0.3 * sd; sd *= Math.exp(gauss() * 0.18); dur *= Math.exp(gauss() * 0.25); }
  const x = r.s.map(v => (v - base) / sd); x.push(Math.min(3, dur / 30)); return x;
}
function forward(net, x) {
  const h = net.W1.map((w, i) => { let s = net.b1[i]; for (let j = 0; j < NIN; j++) s += w[j] * x[j]; return Math.tanh(s); });
  const z = net.W2.map((w, k) => { let s = net.b2[k]; for (let j = 0; j < HID; j++) s += w[j] * h[j]; return s; }), m = Math.max(...z), e = z.map(v => Math.exp(v - m)), sum = e.reduce((a, b) => a + b, 0);
  return { h, p: e.map(v => v / sum) };
}
function train(rows, weightOf, epochs = 70) {
  seed = 777; const net = { W1: Array.from({ length: HID }, () => Array.from({ length: NIN }, () => gauss() * 0.3)), b1: new Array(HID).fill(0), W2: Array.from({ length: 4 }, () => Array.from({ length: HID }, () => gauss() * 0.3)), b2: [0, 0, 0, 0] };
  const flat = n => [...n.W1.flat(), ...n.b1, ...n.W2.flat(), ...n.b2], P = flat(net).length, m = new Float64Array(P), v = new Float64Array(P), idx = rows.map((_, i) => i); let t = 0;
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[idx[i], idx[j]] = [idx[j], idx[i]]; }
    const lr = 0.01 * (ep < epochs * 0.6 ? 1 : 0.3);
    for (let b = 0; b < idx.length; b += 32) {
      const g = { W1: net.W1.map(w => w.map(() => 0)), b1: net.b1.map(() => 0), W2: net.W2.map(w => w.map(() => 0)), b2: [0, 0, 0, 0] }; let wsum = 0;
      for (let q = b; q < Math.min(idx.length, b + 32); q++) {
        const r = rows[idx[q]], x = feat(r, rnd() < 0.2 ? 'utt' : 'spk', true), { h, p } = forward(net, x), wt = weightOf(r); wsum += wt;
        const dz = p.map((pv, k) => (pv - (k === r.y ? 1 : 0)) * wt), dh = new Array(HID).fill(0);
        for (let k = 0; k < 4; k++) { g.b2[k] += dz[k]; for (let j = 0; j < HID; j++) { g.W2[k][j] += dz[k] * h[j]; dh[j] += dz[k] * net.W2[k][j]; } }
        for (let j = 0; j < HID; j++) { const d = dh[j] * (1 - h[j] * h[j]); g.b1[j] += d; for (let i = 0; i < NIN; i++) g.W1[j][i] += d * x[i]; }
      }
      const G = flat(g); t++; let pi = 0;
      const upd = (arr, i) => { const gr = G[pi] / wsum + 1e-4 * arr[i]; m[pi] = 0.9 * m[pi] + 0.1 * gr; v[pi] = 0.999 * v[pi] + 0.001 * gr * gr; arr[i] -= lr * (m[pi] / (1 - 0.9 ** t)) / (Math.sqrt(v[pi] / (1 - 0.999 ** t)) + 1e-8); pi++; };
      net.W1.forEach(w => w.forEach((_, i) => upd(w, i))); net.b1.forEach((_, i) => upd(net.b1, i)); net.W2.forEach(w => w.forEach((_, i) => upd(w, i))); net.b2.forEach((_, i) => upd(net.b2, i));
    }
  }
  return net;
}
function score(net, d) {
  const by = [[0, 0], [0, 0], [0, 0], [0, 0]], conf = {}; let pass = 0, noProfile = 0, wrong = 0, wn = 0;
  for (const r of d.rows) {
    const { p } = forward(net, feat(r, 'spk', false)), k = p.indexOf(Math.max(...p));
    by[r.y][1]++; if (k === r.y) by[r.y][0]++; else { const c = (r.y + 1) + '>' + (k + 1); conf[c] = (conf[c] || 0) + 1; }
    if (PASS(p, r.y)) pass++; if (PASS(forward(net, feat(r, 'utt', false)).p, r.y)) noProfile++;
    for (let e = 0; e < 4; e++) if (e !== r.y) { wn++; if (PASS(p, e)) wrong++; }
  }
  const pc = a => a[1] ? String(Math.round(100 * a[0] / a[1])).padStart(3) + '%' : '   -', n = d.rows.length, tot = by.reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
  return `${pc(tot)} of ${String(n).padStart(4)} syllables  T1${pc(by[0])} T2${pc(by[1])} T3${pc(by[2])} T4${pc(by[3])} | graded right ${Math.round(100 * pass / n)}% (no voice profile ${Math.round(100 * noProfile / n)}%), a wrong tone let through ${(100 * wrong / wn).toFixed(1)}% | unsegmented ${d.noSeg}/${d.words} | ${Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + '×' + v).join(' ')}`;
}
/* every voice counts the same and, within a voice, every tone; the two people count double, the bundled voice one and a half */
function weights(names, data) { const cnt = {}, boost = { syl: 2, hsk: 2, pack: 1.5 }; for (const s of names) for (const r of data[s].rows) cnt[s + r.y] = (cnt[s + r.y] || 0) + 1; return r => 1000 * (boost[r.set] || 1) / cnt[r.set + r.y]; }

/* ---- prepare ---- */
function prepare() {
  const conv = (src, dst) => { if (!existsSync(dst)) spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', src, dst]); };
  const dir = n => { const d = join(DATA, n); mkdirSync(d, { recursive: true }); return d; };
  const tmp = dir('_tmp'), idx = JSON.parse(readFileSync(join(ROOT, 'assets/audio-tw-index.json'), 'utf8')), pack = readFileSync(join(ROOT, 'assets/audio-tw.pack'));
  for (const [id, k] of wordList) if (idx[k]) { const f = join(tmp, 'clip.mp3'); writeFileSync(f, pack.subarray(idx[k][0], idx[k][0] + idx[k][1])); conv(f, join(dir('pack'), id + '.wav')); }
  const repo = join(DATA, '_audio-cmn');
  if (!existsSync(repo)) { execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/hugolpz/audio-cmn.git', repo], { stdio: 'inherit' }); execFileSync('git', ['-C', repo, 'sparse-checkout', 'set', '64k/syllabs', '64k/hsk'], { stdio: 'inherit' }); }
  for (const f of readdirSync(join(repo, '64k/syllabs'))) if (/^cmn-[a-zü]+[1-4]\.mp3$/.test(f)) conv(join(repo, '64k/syllabs', f), join(dir('syl'), f.replace('.mp3', '.wav')));
  for (const [id, k] of wordList) { const f = join(repo, '64k/hsk', `cmn-${k}.mp3`); if (existsSync(f)) conv(f, join(dir('hsk'), id + '.wav')); }
  const yj = join(homedir(), '.cache/zika-voice/zh-TW-YunJheNeural_-12pct');
  if (existsSync(yj)) for (const [id, k] of wordList) { const f = join(yj, k + '.mp3'); if (existsSync(f)) conv(f, join(dir('yunjhe'), id + '.wav')); }
  /* macOS voices: `say` now and then hangs on a clip, so each call has a time limit and a re-run fills the gaps */
  for (const [voice, tag, every] of [['Meijia', 'meijia', 1], ['Tingting', 'tingting', 1], ['Eddy (Chinese (Taiwan))', 'eddy', 1], ['Grandpa (Chinese (Taiwan))', 'grandpa', 2], ['Reed (Chinese (Taiwan))', 'reed', 2], ['Sandy (Chinese (Taiwan))', 'sandy', 2]])
    wordList.forEach(([id, k], i) => { const out = join(dir('say-' + tag), id + '.wav'); if (i % every === 0 && !existsSync(out)) spawnSync('say', ['-v', voice, '--file-format=WAVE', '--data-format=LEI16@16000', '-o', out, k], { timeout: 10000 }); });
  console.log('recordings are in', DATA);
}

/* tools/voice_audit.mjs measures the voice packs with the same code: it imports these instead of keeping a copy */
export { ROOT, DATA, app, trackKey, WORDS, hanKey, byId, readWav, voices, load, feat, forward, train, weights };

/* ---- commands (only when this file is the one being run) ---- */
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) commands();
function commands() {
if (cmd === 'prepare') { prepare(); process.exit(0); }
const V = voices(), names = Object.keys(V).filter(n => V[n].length);
if (!names.length) { console.error(`No recordings under ${DATA}. Run:  node tools/tone_lab.mjs prepare`); process.exit(1); }
const data = Object.fromEntries(names.map(n => [n, load(n, V[n])]));
if (cmd === 'check') {
  console.log('the app as it stands, on each voice (these voices were all used to fit it; `cv` gives the number for a new speaker):');
  for (const n of names) console.log(n.padEnd(13), score(app.TC_NET, data[n]));
} else if (cmd === 'cv') {
  console.log('each voice scored by a classifier fitted on the others:');
  for (const held of names) { const tr = names.filter(n => n !== held); console.log(held.padEnd(13), score(train(tr.flatMap(n => data[n].rows), weights(tr, data)), data[held])); }
} else if (cmd === 'fit') {
  const net = train(names.flatMap(n => data[n].rows), weights(names, data), 80), r2 = a => a.map(v => +v.toFixed(2));
  const out = { W1: net.W1.map(r2), b1: r2(net.b1), W2: net.W2.map(r2), b2: r2(net.b2) };
  for (const n of names) console.log(n.padEnd(13), score(out, data[n]));
  const rows = m => '[\n' + m.map(r => '  [' + r.join(',') + ']').join(',\n') + ']';
  const js = `const TC_NET={\n W1:${rows(out.W1)},\n b1:[${out.b1.join(',')}],\n W2:${rows(out.W2)},\n b2:[${out.b2.join(',')}]};`;
  if (WRITE) { const a = tcSrc.indexOf('const TC_NET={'), b = tcSrc.indexOf('};', a) + 2; writeFileSync(TONE_FILE, tcSrc.slice(0, a) + js + tcSrc.slice(b)); console.log('TC_NET written to js/tone-analysis.js — run `check`, and bump the version before releasing'); }
  else console.log('\n' + js + '\n\n(not written; add --write to install it)');
} else { console.error('usage: node tools/tone_lab.mjs prepare | check | cv | fit [--write]'); process.exit(1); }
}

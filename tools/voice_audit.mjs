#!/usr/bin/env node
/* The voice packs measured against the answer key (Voice V0, docs/voice.md). Every clip of both packs is put through the
   app's own tone analysis — the functions of js/tone-analysis.js, loaded by tools/tone_lab.mjs and imported from there,
   never copied — and the tone it hears on each syllable is compared with the tone a listener should hear.

     node tools/voice_audit.mjs run            measure every clip of both packs; write the tables
     node tools/voice_audit.mjs listen         pick the listening set (40 flagged + 20 unflagged, seeded)
     node tools/voice_audit.mjs serve [port]   serve the repository and ~/.cache/zika-voice for tools/voice_listen.html
     node tools/voice_audit.mjs score <marks.json>   how often the analysis agrees with the listeners' ears
     node tools/voice_audit.mjs pagetest [v0|v1]     the listening page in headless Chrome: it loads, plays, marks, downloads

   Nothing is written inside the repository: results go to ~/.cache/zika-voice/audit (VOICE_AUDIT overrides).

   THE ANSWER KEY. A clip's key is the Han characters of a word, or one character. Its expected tones are
     • the publisher's 注音 for the word (tools/content/readings.json, tone digits, 5 = neutral), and, as a second
       witness, the course's pinyin. Where the two disagree (13 words) either is accepted and the clip is marked;
     • for a key that several words share (了 le / liǎo), any of their readings; the one the clip matches best is used;
     • for a character that is not a word on its own, any tone it takes inside the course's words (neutral ones aside).
   Then sandhi, the way speech realises it:
     • 不 before a fourth tone → second; 一 → second before a fourth, fourth before a first, second or third (not after
       第, not at the end of a word). The 注音 and the pinyin already write both this way, so this changes nothing
       today; it is here so a reading written in citation form cannot slip through. `run` prints what it changed;
     • a third tone before a third tone → second, left to right, exactly as tcExpected does in the app.
   A neutral tone (5) is NOT graded: the classifier has four classes and no neutral one. The syllable still counts
   when the clip is cut into syllables. A bare ㄦ on a non-initial 兒 (一會兒) is erhua and is treated as neutral.

   WHAT A FLAG IS. The analysis names the right tone on about 80–84% of a new voice's syllables (docs/voice.md), so a
   flag is a suspect, not a verdict. Two readings are given: the app's own classifier (which was fitted on these very
   clips, labelled with these very tones), and one fitted without either pack voice ("held out"). Only an ear decides. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, extname, normalize, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, app, trackKey, WORDS, hanKey, readWav, voices, load, feat, forward, train, weights } from './tone_lab.mjs';

export const HOME = join(homedir(), '.cache/zika-voice');
export const OUT = process.env.VOICE_AUDIT || join(HOME, 'audit');
export const PACKS = { f: { file: 'audio-tw', name: '曉臻' }, m: { file: 'audio-tw-m', name: '雲哲' } };
const READINGS = JSON.parse(readFileSync(join(ROOT, 'tools/content/readings.json'), 'utf8'));
const NAMED = ['1>3', '3>1', '4>2', '2>4'];        /* the pairs Thorne named: a third for a first, a second for a fourth, either way round */
const json = f => JSON.parse(readFileSync(f, 'utf8'));
const put = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '–';
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- the answer key ---------- */
export const digits = (syl, chars) => syl.map((s, i) => (i > 0 && chars[i] === '兒' && /^ㄦ1$/.test(s)) ? 5 : +s.slice(-1));
const SANDHI_LOG = [];
export function spoken(chars, written) {
  const t = written.slice(), n = t.length;
  for (let i = 0; i < n - 1; i++) {
    const was = t[i];
    if (chars[i] === '不' && t[i] === 4 && t[i + 1] === 4) t[i] = 2;
    if (chars[i] === '一' && t[i] === 1 && chars[i - 1] !== '第') { if (t[i + 1] === 4) t[i] = 2; else if (t[i + 1] >= 1 && t[i + 1] <= 3) t[i] = 4; }
    if (t[i] !== was) SANDHI_LOG.push(chars.join('') + ' ' + written.join('') + '→' + t.join(''));
  }
  for (let i = 0; i < n - 1; i++) if (t[i] === 3 && t[i + 1] === 3) t[i] = 2;      /* tcExpected's rule */
  return t;
}
const MARK = ['', '', 'ˊ', 'ˇ', 'ˋ', '˙'];
export const zhuyinShown = syl => syl.map(s => { const d = +s.slice(-1), b = s.slice(0, -1); return d === 5 ? '˙' + b : b + MARK[d]; }).join(' ');
/* key → { cands: [{t, from, w}], words: [w…], differ, erhua }.  cands[0] is the reading the app would look up first */
export function answerKey() {
  const keys = new Map(), inWords = new Map(), selfCheck = { same: 0, off: [] };
  const entry = k => keys.get(k) || keys.set(k, { cands: [], words: [], differ: false, erhua: false }).get(k);
  const add = (e, c) => { if (!e.cands.some(x => x.t.join() === c.t.join())) e.cands.push(c); };
  for (const w of WORDS) {
    const chars = [...hanKey(w.t)], k = chars.join(''); if (!k) continue;
    const e = entry(k), z = READINGS.words[w.id], py = Array.from(app.toneSeq(w.p), t => t || 5);
    e.words.push(w);
    const zt = z && z.length === chars.length ? digits(z, chars) : null, pt = py.length === chars.length ? py : null;
    const seen = t => chars.forEach((c, i) => { if (t[i] !== 5 && c !== '一' && c !== '不') { const s = inWords.get(c) || inWords.set(c, new Map()).get(c); s.set(t[i], (s.get(t[i]) || 0) + 1); } });
    if (zt) { add(e, { t: spoken(chars, zt), from: '注音', w: w.id, z }); seen(zt); }
    if (pt) { add(e, { t: spoken(chars, pt), from: 'pinyin', w: w.id }); if (!zt) seen(pt); }
    if (zt && pt) { if (zt.join() !== pt.join()) e.differ = true;
      else { const mine = spoken(chars, zt).map(t => t === 5 ? 0 : t).join(), apps = Array.from(app.tcExpected(w.p)).join(); mine === apps ? selfCheck.same++ : selfCheck.off.push(`${w.t} ${mine} vs ${apps}`); } }
    if (chars.length > 1 && chars[chars.length - 1] === '兒' && pt && pt[pt.length - 1] === 5) e.erhua = true;      /* yìhuǐr, not nǚ'ér */
  }
  /* a character that is not a word on its own: any tone it has inside a word; 一 and 不 in citation form */
  const one = c => { if (c === '一') return [[1]]; if (c === '不') return [[4]];
    const s = inWords.get(c); if (s) return [...s].sort((a, b) => b[1] - a[1]).map(([t]) => [t]);
    const z = READINGS.chars[c]; return z ? [[+z.slice(-1)]] : null; };
  const lookup = k => {
    if (keys.has(k)) { const e = keys.get(k); if (e.cands.length) return e; }
    const chars = [...k]; if (!chars.length || chars.some(c => !/[㐀-鿿]/.test(c))) return null;
    const e = keys.get(k) || { cands: [], words: [], differ: false, erhua: false };
    if (chars.length === 1) { const c = one(k); if (!c) return null; c.forEach(t => add(e, { t, from: 'characters' })); return e; }
    const each = chars.map(c => one(c)); if (each.some(x => !x)) return null;
    add(e, { t: spoken(chars, each.map(x => x[0][0])), from: 'characters' }); return e;
  };
  return { lookup, selfCheck, sandhiLog: SANDHI_LOG.slice() };
}

/* ---------- clips → pitch tracks (cached by the analysis's own fingerprint, as tone_lab does) ---------- */
let TMP = null;
export function decode(mp3) {
  TMP = TMP || mkdtempSync(join(tmpdir(), 'zika-audit-'));
  const src = join(TMP, 'c.mp3'), dst = join(TMP, 'c.wav'); writeFileSync(src, mp3); rmSync(dst, { force: true });
  const r = spawnSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', src, dst]);
  return r.status === 0 && existsSync(dst) ? readWav(dst) : null;
}
export function cleanup() { if (TMP) rmSync(TMP, { recursive: true, force: true }); TMP = null; }
/* name: the cache's name; clips: [{k, bytes()}] → Map k → track ({st, rms, voiced, med}) or null when it would not decode */
export function tracksFor(name, clips) {
  const file = join(OUT, '_tracks', `${name}-${trackKey}.json`), cache = existsSync(file) ? json(file) : {}; let fresh = 0;
  const out = new Map();
  for (const c of clips) {
    if (!(c.k in cache)) { const w = decode(c.bytes()); fresh++;
      if (!w) cache[c.k] = null; else { const t = app.tcTrack(w.x, w.sr); cache[c.k] = { st: Array.from(t.st, v => isNaN(v) ? null : +v.toFixed(2)), rms: Array.from(t.rms, v => +v.toFixed(4)) }; } }
    const q = cache[c.k]; if (!q) { out.set(c.k, null); continue; }
    const st = Float32Array.from(q.st, v => v === null ? NaN : v), voiced = Array.from(st).filter(v => !isNaN(v));
    out.set(c.k, { st, rms: q.rms, voiced, med: voiced.length ? voiced.slice().sort((a, b) => a - b)[voiced.length >> 1] : NaN });
  }
  if (fresh) put(file, cache);
  cleanup(); return out;
}
/* the speaker's mid pitch and spread. For a pack, the way the coach measures its native voice: a hundred clips of words
   of one to three characters, evenly spread (tcNativeStats in js/tone.js needs a browser; this is the same selection). */
export function statsOf(tracks, keys) {
  const all = []; for (const k of keys) { const t = tracks.get(k); if (t) for (const v of t.voiced) all.push(v); }
  if (all.length < 200) return { base: 14.5, sd: 3.4, frames: all.length };
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  return { base: mean, sd: Math.sqrt(all.reduce((a, b) => a + (b - mean) * (b - mean), 0) / all.length), frames: all.length };
}
function nativeKeys(idx) {
  const keys = WORDS.filter(w => { const n = [...hanKey(w.t)].length; return n >= 1 && n <= 3; }).map(w => hanKey(w.t)).filter((k, i, a) => idx[k] && a.indexOf(k) === i), out = [];
  for (let i = 0; i < keys.length && i < 100; i++) out.push(keys[Math.floor(i * keys.length / 100)]);
  return out;
}

/* ---------- one clip against its answer ---------- */
const best = p => { let k = 0; for (let i = 1; i < 4; i++) if (p[i] > p[k]) k = i; return k; };
/* tr: the track; e: the key's entry; sp: the speaker; held: a second classifier or null */
export function judgeClip(tr, n, e, sp, held) {
  if (!tr || tr.voiced.length < 6) return { status: 'no pitch' };
  const a = app.tcAnalyse(null, 0, n, sp, tr);
  if (!a || a.syl.length !== n || a.syl.some(s => !s)) return { status: 'not cut' };
  const heard = a.syl.map(s => s.tone);
  /* the second classifier is given the same syllables (tcAnalyse keeps each one's start but not its end: its `z` is the contour) */
  const heardHeld = held ? app.tcSyllables(tr.st, n, tr.rms).map(([from, to]) => best(forward(held, feat({ s: app.tcShape(tr.st, from, to), d: to - from, mean: sp.base, sd: sp.sd }, 'spk', false)).p) + 1) : null;
  const pick = h => { let c = e.cands[0], m = Infinity; for (const x of e.cands) { const d = x.t.filter((t, i) => t !== 5 && t !== h[i]).length; if (d < m) { m = d; c = x; } } return c; };
  const c = pick(heard), ch = held ? pick(heardHeld) : null;
  const syl = a.syl.map((s, i) => { const want = c.t[i], graded = want >= 1 && want <= 4;
    return { want, heard: s.tone, conf: +Math.max(...s.p).toFixed(3), pWant: graded ? +s.p[want - 1].toFixed(3) : null, verdict: graded ? app.tcJudge(s, want) : '-',
      off: graded && s.tone !== want, wantHeld: ch ? ch.t[i] : null, heardHeld: held ? heardHeld[i] : null, offHeld: held ? (ch.t[i] >= 1 && ch.t[i] <= 4 && heardHeld[i] !== ch.t[i]) : null }; });
  return { status: 'ok', from: c.from, syl, flag: syl.some(s => s.off), strong: syl.some(s => s.verdict === 'no'), flagHeld: held ? syl.some(s => s.offHeld) : null };
}

/* ---------- the analysis's own error, on people whose tones are known ---------- */
/* Three classifiers besides the app's: one fitted without either pack voice, and one each fitted without one of the two
   people (audio-cmn: `syl`, 1,660 single syllables; `hsk`, 492 course words). The last two give the confusion the
   analysis makes on a voice it has never heard, saying tones that are right. */
export function yardstick(log = () => { }) {
  const file = join(OUT, `_yardstick-${trackKey}.json`); if (existsSync(file)) return json(file);
  const V = voices(), names = Object.keys(V).filter(n => V[n].length);
  for (const need of ['syl', 'hsk']) if (!names.includes(need)) throw new Error('the tone bench has no `' + need + '` recordings: run  node tools/tone_lab.mjs prepare');
  const data = Object.fromEntries(names.map(n => [n, load(n, V[n])]));
  const fit = without => { const tr = names.filter(n => !without.includes(n)); log('fitting a classifier without ' + without.join(', ') + ' …'); return train(tr.flatMap(n => data[n].rows), weights(tr, data)); };
  const conf = (net, rows) => { const C = [0, 1, 2, 3].map(() => [0, 0, 0, 0]); for (const r of rows) C[r.y][best(forward(net, feat(r, 'spk', false)).p)]++; return C; };
  const held = { packs: fit(['pack', 'yunjhe']), syl: fit(['syl']), hsk: fit(['hsk']) };
  const out = { made: new Date().toISOString(), trackKey, voices: names, net: held.packs,
    people: { held: { syl: conf(held.syl, data.syl.rows), hsk: conf(held.hsk, data.hsk.rows) }, app: { syl: conf(app.TC_NET, data.syl.rows), hsk: conf(app.TC_NET, data.hsk.rows) } } };
  put(file, out); return out;
}
const rowRate = C => C.map((r, e) => { const n = r.reduce((a, b) => a + b, 0); return r.map(v => n ? v / n : 0); });

/* ---------- tables ---------- */
export function tally(clips) {
  const T = { clips: clips.length, ok: 0, notCut: 0, noPitch: 0, noKey: 0, graded: 0, neutral: 0, off: 0, offHeld: 0, offBoth: 0, strong: 0, clipFlag: 0, clipFlagHeld: 0, clipStrong: 0, clipBoth: 0,
    byTone: {}, pair: {}, pairHeld: {}, pos: {}, len: {}, alts: 0, differ: 0, verdict: { ok: 0, close: 0, no: 0 }, clipNotOk: 0, clipNotOk2: [0, 0], single: [0, 0, 0, 0], multi: [0, 0, 0, 0] };
  const bump = (o, k, off, offHeld) => { const x = o[k] = o[k] || { n: 0, off: 0, offHeld: 0 }; x.n++; if (off) x.off++; if (offHeld) x.offHeld++; };
  for (const c of clips) {
    if (c.status === 'not cut') { T.notCut++; continue; } if (c.status === 'no pitch') { T.noPitch++; continue; } if (c.status !== 'ok') { T.noKey++; continue; }
    T.ok++; if (c.flag) T.clipFlag++; if (c.flagHeld) T.clipFlagHeld++; if (c.strong) T.clipStrong++; if (c.flag && c.flagHeld) T.clipBoth++; if (c.alts > 1) T.alts++; if (c.differ) T.differ++;
    const n = c.syl.length, notOk = c.syl.some(s => s.verdict === 'close' || s.verdict === 'no');
    if (notOk) T.clipNotOk++; if (n === 2) { T.clipNotOk2[1]++; if (notOk) T.clipNotOk2[0]++; }
    c.syl.forEach((s, i) => {
      if (!(s.want >= 1 && s.want <= 4)) { T.neutral++; return; }
      T.graded++; T.verdict[s.verdict]++; if (s.off) T.off++; if (s.offHeld) T.offHeld++; if (s.off && s.offHeld && s.heard === s.heardHeld) T.offBoth++; if (s.verdict === 'no') T.strong++;
      (n === 1 ? T.single : T.multi)[s.want - 1]++;
      bump(T.byTone, s.want, s.off, s.offHeld);
      bump(T.pos, n === 1 ? 'alone' : i === 0 ? 'first' : i === n - 1 ? 'last' : 'middle', s.off, s.offHeld);
      bump(T.len, n >= 4 ? '4+' : String(n), s.off, s.offHeld);
      if (s.off) T.pair[s.want + '>' + s.heard] = (T.pair[s.want + '>' + s.heard] || 0) + 1;
      if (s.offHeld) T.pairHeld[s.wantHeld + '>' + s.heardHeld] = (T.pairHeld[s.wantHeld + '>' + s.heardHeld] || 0) + 1;
    });
  }
  return T;
}
/* what the analysis would report on these syllables if every one were said right, from its confusion on the two people:
   the single-syllable person for clips of one syllable, the word-reading person for the rest */
export function expectedNoise(T, people) {
  const S = rowRate(people.syl), H = rowRate(people.hsk), pair = {}; let off = 0;
  for (let e = 0; e < 4; e++) for (let m = 0; m < 4; m++) if (m !== e) { const v = T.single[e] * S[e][m] + T.multi[e] * H[e][m]; off += v; pair[(e + 1) + '>' + (m + 1)] = v; }
  return { off, rate: T.graded ? off / T.graded : 0, pair };
}
function report(name, T, Y) {
  const L = [], noiseA = expectedNoise(T, Y.people.app), noiseH = expectedNoise(T, Y.people.held), row = (...c) => L.push('| ' + c.join(' | ') + ' |');
  L.push(`### ${name}`, '');
  row('', 'the app\'s classifier', 'a classifier that never heard this voice'); row('---', '---', '---');
  row('clips measured', `${T.ok} of ${T.clips}`, '');
  row('clips that could not be cut into their syllables', String(T.notCut), ''); row('clips with no pitch found / no answer in the key', `${T.noPitch} / ${T.noKey}`, '');
  row('syllables graded (neutral tones left out: ' + T.neutral + ')', String(T.graded), '');
  row('**syllables where the tone measured is not the tone expected**', `**${T.off} (${pct(T.off, T.graded)})**`, `**${T.offHeld} (${pct(T.offHeld, T.graded)})**`);
  row('the coach\'s own verdict on these syllables, as if the clip were the learner (`tcJudge`): ok / close / no', `${pct(T.verdict.ok, T.graded)} / ${pct(T.verdict.close, T.graded)} / ${pct(T.verdict.no, T.graded)}`, '');
  row('clips the coach would not pass in full (any syllable close or no); two-character words alone', `${T.clipNotOk} (${pct(T.clipNotOk, T.ok)}); ${pct(T.clipNotOk2[0], T.clipNotOk2[1])}`, '');
  row('…where both classifiers hear the same other tone', `${T.offBoth} (${pct(T.offBoth, T.graded)})`, '');
  row('**clips with at least one such syllable (flagged)**', `**${T.clipFlag} (${pct(T.clipFlag, T.ok)})**`, `**${T.clipFlagHeld} (${pct(T.clipFlagHeld, T.ok)})**`);
  row('clips flagged by both', `${T.clipBoth} (${pct(T.clipBoth, T.ok)})`, '');
  row('what the analysis reports on a person saying these tones right', `${pct(noiseA.off, T.graded)} (it was fitted on them)`, `${pct(noiseH.off, T.graded)} (held out)`);
  L.push('', 'By expected tone (share of syllables measured as another tone):', '');
  row('expected', 'syllables', 'app', 'held out', 'most often measured as (app)'); row('---', '---', '---', '---', '---');
  for (const e of [1, 2, 3, 4]) { const x = T.byTone[e] || { n: 0, off: 0, offHeld: 0 };
    row('tone ' + e, x.n, pct(x.off, x.n), pct(x.offHeld, x.n), [1, 2, 3, 4].filter(m => m !== e).map(m => [m, T.pair[e + '>' + m] || 0]).sort((a, b) => b[1] - a[1]).map(([m, v]) => `${m} ×${v}`).join(', ')); }
  L.push('', 'By pair, expected → measured, against what the analysis does to a person saying the tone right (×: how many times more often than that):', '');
  row('pair', 'app: count', 'share of graded', 'expected from the analysis alone', '×', 'held out: count', 'expected', '×'); row('---', '---', '---', '---', '---', '---', '---', '---');
  const pairs = []; for (let e = 1; e <= 4; e++) for (let m = 1; m <= 4; m++) if (e !== m) pairs.push(e + '>' + m);
  for (const p of pairs.sort((a, b) => (T.pair[b] || 0) - (T.pair[a] || 0))) { const a = T.pair[p] || 0, h = T.pairHeld[p] || 0, na = noiseA.pair[p], nh = noiseH.pair[p];
    row((NAMED.includes(p) ? '**' + p.replace('>', ' → ') + '**' : p.replace('>', ' → ')), a, pct(a, T.graded), na.toFixed(0), na >= 0.5 ? (a / na).toFixed(1) : '–', h, nh.toFixed(0), nh >= 0.5 ? (h / nh).toFixed(1) : '–'); }
  for (const [title, o, order] of [['By place in the word', T.pos, ['alone', 'first', 'middle', 'last']], ['By length of the word (characters)', T.len, ['1', '2', '3', '4+']]]) {
    L.push('', title + ':', ''); row('', 'syllables', 'app', 'held out'); row('---', '---', '---', '---');
    for (const k of order) if (o[k]) row(k, o[k].n, pct(o[k].off, o[k].n), pct(o[k].offHeld, o[k].n)); }
  L.push('', `Clips whose key has more than one acceptable reading: ${T.alts} (of them, 注音 and pinyin disagree: ${T.differ}).`, '');
  return L.join('\n');
}

/* ---------- run ---------- */
function auditPacks() {
  mkdirSync(OUT, { recursive: true });
  const key = answerKey(), Y = yardstick(m => console.log(m)), clips = [], speakers = {};
  for (const [v, P] of Object.entries(PACKS)) {
    const idx = json(join(ROOT, 'assets', P.file + '-index.json')), pack = readFileSync(join(ROOT, 'assets', P.file + '.pack'));
    console.log(`${P.name}: ${Object.keys(idx).length} clips …`);
    const tracks = tracksFor('pack-' + v, Object.keys(idx).map(k => ({ k, bytes: () => pack.subarray(idx[k][0], idx[k][0] + idx[k][1]) })));
    const sp = statsOf(tracks, nativeKeys(idx)), every = statsOf(tracks, Object.keys(idx)); speakers[v] = { sp, every };
    for (const k of Object.keys(idx)) {
      const e = key.lookup(k), n = [...k].length, w = e && e.words[0];
      const base = { voice: v, key: k, pinyin: w ? w.p : '', id: w ? w.id : '', n, alts: e ? e.cands.length : 0, differ: !!(e && e.differ), erhua: !!(e && e.erhua) };
      clips.push(e ? Object.assign(base, judgeClip(tracks.get(k), n, e, sp, Y.net)) : Object.assign(base, { status: 'no answer' }));
    }
  }
  /* the same word in both voices, the same syllable heard as the same other tone: more likely the key or the analysis than two bad clips */
  const by = {}; for (const c of clips) if (c.status === 'ok') (by[c.key] = by[c.key] || {})[c.voice] = c;
  let shared = 0, sameOff = 0; for (const k in by) if (by[k].f && by[k].m) by[k].f.syl.forEach((s, i) => { const t = by[k].m.syl[i]; if (s.want >= 1 && s.want <= 4) { shared++; if (s.off && t.off && s.heard === t.heard) { sameOff++; by[k].f.both = by[k].m.both = true; } } });
  const T = Object.fromEntries(Object.keys(PACKS).map(v => [v, tally(clips.filter(c => c.voice === v))]));
  const csv = ['voice,key,pinyin,syllables,status,expected,measured,confidence,p_expected,verdict,flag,plainly_wrong,measured_heldout,flag_heldout,same_in_both_voices,readings_accepted,key_sources_disagree,erhua'];
  for (const c of clips) { const s = c.syl || [], j = f => s.map(f).join(' ');
    csv.push([PACKS[c.voice].name, c.key, '"' + c.pinyin.replace(/"/g, '') + '"', c.n, c.status, j(x => x.want), j(x => x.heard), j(x => x.conf), j(x => x.pWant === null ? '-' : x.pWant), j(x => x.verdict), c.flag ? 1 : 0, c.strong ? 1 : 0, j(x => x.heardHeld), c.flagHeld ? 1 : 0, c.both ? 1 : 0, c.alts, c.differ ? 1 : 0, c.erhua ? 1 : 0].join(',')); }
  put(join(OUT, 'clips.csv'), csv.join('\n') + '\n'); put(join(OUT, 'clips.json'), clips);
  const P = Y.people, acc = C => { let d = 0, n = 0; C.forEach((r, e) => r.forEach((v, m) => { n += v; if (e === m) d += v; })); return pct(d, n); };
  const md = ['# Voice V0 — the packs against the answer key', '', `Made ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by tools/voice_audit.mjs, analysis ${trackKey}. A flag is a suspect, not a verdict.`, '',
    `Answer key: ${key.selfCheck.same} words where 注音 and pinyin agree give the same tones as the app's tcExpected (${key.selfCheck.off.length} do not${key.selfCheck.off.length ? ': ' + key.selfCheck.off.join('; ') : ''}). The 一/不 rule changed ${key.sandhiLog.length} reading${key.sandhiLog.length === 1 ? '' : 's'}${key.sandhiLog.length ? ' (' + [...new Set(key.sandhiLog)].join('; ') + ')' : ''}.`, '',
    `The analysis on two people whose tones are known (share of syllables it names right): single syllables ${acc(P.app.syl)} with the app's classifier, ${acc(P.held.syl)} held out; course words ${acc(P.app.hsk)} and ${acc(P.held.hsk)}.`, '',
    `Speakers as the coach measures them: 曉臻 mid ${speakers.f.sp.base.toFixed(1)} st, spread ${speakers.f.sp.sd.toFixed(1)} (every clip: ${speakers.f.every.base.toFixed(1)}, ${speakers.f.every.sd.toFixed(1)}); 雲哲 mid ${speakers.m.sp.base.toFixed(1)}, spread ${speakers.m.sp.sd.toFixed(1)} (every clip: ${speakers.m.every.base.toFixed(1)}, ${speakers.m.every.sd.toFixed(1)}).`, '',
    `The same word in both voices: ${shared} graded syllables; on ${sameOff} of them both voices are measured as the same other tone.`, '',
    ...Object.keys(PACKS).map(v => report(`${PACKS[v].name} (${PACKS[v].file})`, T[v], Y))].join('\n');
  put(join(OUT, 'summary.md'), md + '\n'); put(join(OUT, 'summary.json'), { made: new Date().toISOString(), trackKey, speakers, tally: T, noise: Object.fromEntries(Object.keys(PACKS).map(v => [v, { app: expectedNoise(T[v], P.app), held: expectedNoise(T[v], P.held) }])), shared, sameOff, people: P });
  console.log('\n' + md + '\n\nwritten: ' + ['clips.csv', 'clips.json', 'summary.md', 'summary.json'].map(f => join(OUT, f)).join('  '));
}

/* ---------- the listening set ---------- */
/* 20 flagged and 10 unflagged per voice. Flagged: two of each pair Thorne named where the pack has them, the rest spread
   over every pair in proportion to how often it occurs. Unflagged: by length (3 of one character, 5 of two, 2 longer).
   Only clips with one acceptable reading, one flagged syllable and no erhua, so that what is being asked is plain.
   The page gets the clips in a shuffled order and without the flags; the flags are in a second file for `score`. */
function listeningSet() {
  const seed = +(process.argv.find(a => /^--seed=/.test(a)) || '--seed=20261121').slice(7), r = rng(seed);
  const clips = json(join(OUT, 'clips.json')).filter(c => c.status === 'ok' && c.alts === 1 && !c.erhua && c.n <= 4 && c.id), key = answerKey(), items = [], answers = {};
  for (const v of Object.keys(PACKS)) {
    const mine = clips.filter(c => c.voice === v), flagged = shuffle(mine.filter(c => c.flag && c.syl.filter(s => s.off).length === 1), r), plain = shuffle(mine.filter(c => !c.flag), r);
    const pairOf = c => { const s = c.syl.find(x => x.off); return s.want + '>' + s.heard; }, bucket = {}; for (const c of flagged) (bucket[pairOf(c)] = bucket[pairOf(c)] || []).push(c);
    const take = [], grab = (p, n) => { while (n-- > 0 && bucket[p] && bucket[p].length) take.push(bucket[p].shift()); };
    for (const p of NAMED) grab(p, 2);
    const left = () => Object.values(bucket).reduce((a, b) => a + b.length, 0), want = 20;
    while (take.length < want && left()) { const total = left(), need = want - take.length, order = Object.keys(bucket).sort((a, b) => bucket[b].length - bucket[a].length); let got = 0;
      for (const p of order) { const n = Math.min(bucket[p].length, Math.round(need * bucket[p].length / total)); got += n; grab(p, n); if (take.length >= want) break; }
      if (!got) grab(order[0], 1); }
    const quiet = [...plain.filter(c => c.n === 1).slice(0, 3), ...plain.filter(c => c.n === 2).slice(0, 5), ...plain.filter(c => c.n >= 3).slice(0, 2)];
    for (const c of [...take.slice(0, want), ...quiet]) { const e = key.lookup(c.key), zc = [...c.key].map(ch => READINGS.chars[ch]), z = e.cands[0].z || (zc.every(Boolean) ? zc : null), id = 'c' + String(items.length + 1).padStart(2, '0');
      items.push({ id, word: c.key, pinyin: c.pinyin, zhuyin: z ? zhuyinShown(z) : '', tones: c.syl.map(s => s.want), voice: PACKS[v].name, clips: [{ id, pack: 'assets/' + PACKS[v].file, key: c.key }] });
      answers[id] = { voice: v, key: c.key, flag: c.flag, strong: !!c.strong, flagHeld: !!c.flagHeld, pair: c.flag ? pairOf(c) : '', syllable: c.flag ? c.syl.findIndex(s => s.off) : -1, conf: c.flag ? c.syl.find(s => s.off).conf : Math.min(...c.syl.map(s => s.conf)), want: c.syl.map(s => s.want), heard: c.syl.map(s => s.heard) }; }
  }
  /* ids are given after the shuffle, so an id says nothing about a clip */
  const order = shuffle(items, r), renamed = {}; order.forEach((it, i) => { const id = 'c' + String(i + 1).padStart(2, '0'); renamed[id] = answers[it.id]; it.id = it.clips[0].id = id; });
  put(join(OUT, 'listen-v0.json'), { set: 'v0', title: 'Voice V0 — is the tone right?', seed, made: new Date().toISOString(), items: order });
  put(join(OUT, 'listen-v0-key.json'), { set: 'v0', seed, answers: renamed });
  const n = Object.values(renamed), pairs = {}; n.filter(a => a.flag).forEach(a => { pairs[a.voice + ' ' + a.pair] = (pairs[a.voice + ' ' + a.pair] || 0) + 1; });
  console.log(`${order.length} clips: ${n.filter(a => a.flag).length} flagged, ${n.filter(a => !a.flag).length} unflagged (seed ${seed})`); console.log('flagged, by voice and pair (expected>measured):', pairs);
  console.log('written:', join(OUT, 'listen-v0.json'), '(for the page) and', join(OUT, 'listen-v0-key.json'), '(the flags, for `score`)');
}

/* ---------- score a listening session ---------- */
/* marks.json is what tools/voice_listen.html downloads: { set, listeners: { name: { clipId: { v: 'right'|'wrong'|'unsure', syl: [i…], note } } } } */
function scoreMarks(file) {
  const marks = json(file), keyFile = marks.set === 'v1' ? join(HOME, 'v1', 'listen-v1-key.json') : join(OUT, 'listen-v0-key.json');
  if (!existsSync(keyFile)) { console.error('no key for set ' + marks.set + ' at ' + keyFile); process.exit(1); }
  const key = json(keyFile).answers, names = Object.keys(marks.listeners || {}).filter(n => Object.keys(marks.listeners[n]).length);
  if (!names.length) { console.error('no marks in ' + file); process.exit(1); }
  console.log(`set ${marks.set} · ${Object.keys(key).length} clips · listeners: ${names.join(', ')}\n`);
  for (const name of names) {
    const m = marks.listeners[name], done = Object.keys(key).filter(id => m[id] && m[id].v), sure = done.filter(id => m[id].v !== 'unsure');
    console.log(`— ${name}: ${done.length} clips marked, ${done.length - sure.length} "not sure" —`);
    if (marks.set === 'v1') {
      const by = {}; for (const id of done) { const s = by[key[id].source] = by[key[id].source] || { right: 0, wrong: 0, unsure: 0, flagWrong: 0, flag: 0, bad: [] }; s[m[id].v]++; if (key[id].flag) { s.flag++; if (m[id].v === 'wrong') s.flagWrong++; } if (m[id].v === 'wrong') s.bad.push(key[id].word); }
      for (const [s, x] of Object.entries(by)) console.log(`  ${s.padEnd(22)} right ${String(x.right).padStart(3)}  wrong ${String(x.wrong).padStart(3)}  not sure ${String(x.unsure).padStart(3)}  → wrong by ear ${pct(x.wrong, x.right + x.wrong)}   (of ${x.flag} the analysis flagged, the ear calls ${x.flagWrong} wrong)${x.bad.length ? '\n      wrong: ' + x.bad.join(' ') : ''}`);
      console.log(''); continue;
    }
    const t = { ff: 0, fr: 0, uf: 0, ur: 0 }; for (const id of sure) t[(key[id].flag ? 'f' : 'u') + (m[id].v === 'wrong' ? 'f' : 'r')]++;
    console.log(`                    ear: wrong   ear: right\n  analysis flagged   ${String(t.ff).padStart(7)}   ${String(t.fr).padStart(8)}\n  analysis did not   ${String(t.uf).padStart(7)}   ${String(t.ur).padStart(8)}`);
    console.log(`  the analysis and the ear agree on ${pct(t.ff + t.ur, sure.length)} of ${sure.length} clips; a flag is a wrong clip ${pct(t.ff, t.ff + t.fr)} of the time; an unflagged clip is wrong ${pct(t.uf, t.uf + t.ur)} of the time`);
    const sylHit = sure.filter(id => key[id].flag && m[id].v === 'wrong' && (m[id].syl || []).length), same = sylHit.filter(id => m[id].syl.includes(key[id].syllable));
    if (sylHit.length) console.log(`  where the ear named the syllable (${sylHit.length} clips), it was the one the analysis flagged in ${same.length}`);
    if (existsSync(join(OUT, 'summary.json'))) { const S = json(join(OUT, 'summary.json')).tally;
      for (const v of Object.keys(PACKS)) { const ids = sure.filter(id => key[id].voice === v), f = ids.filter(id => key[id].flag), u = ids.filter(id => !key[id].flag); if (!f.length || !u.length) continue;
        const pf = f.filter(id => m[id].v === 'wrong').length / f.length, pu = u.filter(id => m[id].v === 'wrong').length / u.length, share = S[v].clipFlag / S[v].ok;
        console.log(`  ${PACKS[v].name}: by this ear ${pct(pf * f.length, f.length)} of ${f.length} flagged and ${pct(pu * u.length, u.length)} of ${u.length} unflagged clips are wrong → about ${(100 * (share * pf + (1 - share) * pu)).toFixed(0)}% of the pack's clips (flagged share ${pct(S[v].clipFlag, S[v].ok)}; a small sample: read it as a rough size, not a measurement)`); } }
    const byPair = {}; for (const id of sure) if (key[id].flag) { const p = byPair[key[id].pair] = byPair[key[id].pair] || [0, 0]; p[1]++; if (m[id].v === 'wrong') p[0]++; }
    console.log('  flagged clips the ear calls wrong, by pair (expected>measured): ' + Object.entries(byPair).map(([p, [a, b]]) => `${p} ${a}/${b}`).join('  '));
    const wrong = sure.filter(id => m[id].v === 'wrong').map(id => `${key[id].key}(${PACKS[key[id].voice].name}${m[id].note ? ': ' + m[id].note : ''})`); if (wrong.length) console.log('  wrong by ear: ' + wrong.join('  '));
    console.log('');
  }
  if (names.length > 1) { const [a, b] = names.map(n => marks.listeners[n]), both = Object.keys(key).filter(id => a[id] && b[id] && a[id].v && b[id].v);
    console.log(`the two listeners marked ${both.length} clips in common and gave the same mark on ${pct(both.filter(id => a[id].v === b[id].v).length, both.length)}`); }
}

/* ---------- a server for the listening page: the repository, and ~/.cache/zika-voice under /_voice/ ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pack': 'application/octet-stream' };
export function serveVoice(port = 8791) {
  const roots = [['/_voice/', resolve(HOME)], ['/', resolve(ROOT)]];
  return new Promise((done, fail) => { const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname), [prefix, dir] = roots.find(([pre]) => p.startsWith(pre)), f = normalize(join(dir, p.slice(prefix.length)));
    if (!f.startsWith(dir + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(readFileSync(f)); });
    srv.on('error', fail); srv.listen(port, '127.0.0.1', () => done({ port: srv.address().port, close: () => new Promise(ok => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(ok); }) })); });
}

/* ---------- the listening page, driven in headless Chrome ---------- */
async function pageTest(set) {
  const { chrome } = await import('./lib/browser.mjs'), srv = await serveVoice(0), br = await chrome(), sleep = ms => new Promise(r => setTimeout(r, ms)); let failed = 0;
  const say = (ok, what) => { console.log((ok ? '  ok    ' : '  FAIL  ') + what); if (!ok) failed++; };
  try {
    const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' }), { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => br.send(m, p, sessionId), errors = []; await s('Page.enable'); await s('Runtime.enable');
    br.on(m => { if (m.sessionId === sessionId && (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error'))) errors.push(JSON.stringify(m.params).slice(0, 300)); });
    const js = async expr => { const r = await s('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const until = async (expr, ms = 15000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if (await js('return ' + expr)) return true; return false; };
    await s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await s('Page.navigate', { url: `http://127.0.0.1:${srv.port}/tools/voice_listen.html?set=${set}` });
    say(await until('window.ready===true'), `the page loads set ${set}`);
    const want = json(set === 'v1' ? join(HOME, 'v1', 'listen-v1.json') : join(OUT, 'listen-v0.json')), nClips = want.items.reduce((n, it) => n + it.clips.length, 0);
    say(await js('return document.querySelectorAll(".clip").length') === nClips, `${nClips} clips are listed, for ${want.items.length} words`);
    say(await js('return document.documentElement.scrollWidth<=window.innerWidth'), 'nothing runs off a phone-wide screen (390 px)');
    const text = await js('return document.getElementById("list").innerText'), keyFile = set === 'v1' ? join(HOME, 'v1', 'listen-v1-key.json') : join(OUT, 'listen-v0-key.json'), key = json(keyFile).answers;
    say(!/flag|held|"source"/i.test(JSON.stringify(want)) && !/flagged|elevenlabs|azure|breezy/i.test(text), 'neither the set nor the page says which clips are flagged or where a clip came from');
    let played = 0; const picks = [0, Math.floor(nClips / 2), nClips - 1];
    for (const i of picks) { await js(`window.lastPlay=null;document.querySelectorAll(".clip")[${i}].querySelector("[data-a=play]").click()`);
      if (await until('window.lastPlay&&(window.lastPlay.state==="ended"||window.lastPlay.state==="error")', 12000) && await js('return window.lastPlay.state==="ended"&&window.lastPlay.seconds>0.15')) played++; else console.log('        ', JSON.stringify(await js('return window.lastPlay'))); }
    say(played === picks.length, `${played} of ${picks.length} clips played to the end (first, middle, last)`);
    /* every clip must at least be there to play: a missing one would only show when a listener reached it */
    const ids = Object.keys(key), missing = await js(`const bad=[];for(const {clip} of clipEls){try{const u=await urlOf(clip);const r=await fetch(u);if(!r.ok||(await r.arrayBuffer()).byteLength<500)bad.push(clip.id);}catch(e){bad.push(clip.id);}}return bad`);
    say(missing.length === 0, missing.length ? 'clips that cannot be fetched: ' + missing.join(' ') : `all ${nClips} clips can be fetched`);
    say(ids.length === nClips, 'the key has an answer for every clip on the page');
    await js(`const c=document.querySelectorAll(".clip");c[0].querySelector("[data-v=right]").click();c[1].querySelector(".syl").click();c[2].querySelector("[data-v=unsure]").click();const n=c[1].querySelector(".note");n.value="heard 4";n.dispatchEvent(new Event("input",{bubbles:true}));
      document.querySelector('input[name=who][value="1"]').click();c[0].querySelector("[data-v=wrong]").click();document.getElementById("dl").click()`);
    const dl = JSON.parse(await js('return window.lastDownload')), names = Object.keys(dl.listeners), a = dl.listeners[names[0]] || {}, b = dl.listeners[names[1]] || {}, c = want.items.flatMap(it => it.clips.map(x => x.id));
    say(names.length === 2 && a[c[0]]?.v === 'right' && a[c[1]]?.v === 'wrong' && a[c[1]].syl.join() === '0' && a[c[1]].note === 'heard 4' && a[c[2]]?.v === 'unsure' && b[c[0]]?.v === 'wrong', 'marks, a tapped syllable, a note and a second listener come out in the download');
    await s('Page.reload'); await until('window.ready===true');
    say(await js('return document.getElementById("count").textContent') === `3 / ${nClips} marked`, 'the marks are still there after a reload');
    const tmp = join(OUT, '_pagetest-marks.json'); put(tmp, dl);
    const sc = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'score', tmp], { encoding: 'utf8' }); rmSync(tmp, { force: true });
    say(sc.status === 0 && /marked/.test(sc.stdout), '`score` reads the downloaded file');
    say(errors.length === 0, errors.length ? 'page errors: ' + errors.join(' | ') : 'no error on the page');
  } finally { await br.close(); await srv.close(); }
  console.log(failed ? `\n${failed} check(s) failed` : '\nthe listening page works (what a clip sounds like is not something this test can know)'); process.exit(failed ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const cmd = process.argv[2];
  if (cmd === 'run') auditPacks();
  else if (cmd === 'listen') listeningSet();
  else if (cmd === 'score' && process.argv[3]) scoreMarks(process.argv[3]);
  else if (cmd === 'pagetest') await pageTest(process.argv[3] || 'v0');
  else if (cmd === 'serve') serveVoice(+(process.argv[3] || 8791)).then(s => { const u = `http://127.0.0.1:${s.port}/tools/voice_listen.html`;
    console.log(`listening pages (Ctrl-C stops the server):\n  V0, the packs:        ${u}?set=v0\n  V1, side by side:     ${u}?set=v1`); });
  else { console.error('usage: node tools/voice_audit.mjs run | listen [--seed=N] | serve [port] | score <marks.json> | pagetest [v0|v1]'); process.exit(1); }
}

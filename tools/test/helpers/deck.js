/* Builds a deck in the shape the app keeps (`S`), for the sync tests and for tools/sync_numbers.js.
   Everything in it is made up from a seed; nothing comes from a real learner. The shapes are the ones index.html
   writes (v62): see "Key structures" in docs/architecture.md. */
'use strict';

const DAYMS = 86400000;
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

/* opt: { rng, now, words: [{id,l,t}] or a count, grammar: [ids] or a count, days: how long the learner has studied,
          started: share of the words already in the deck, my: words in My words, full: also the rarely used parts } */
function makeDeck(opt) {
  const r = opt.rng, now = opt.now || 1800000000000, days = opt.days == null ? 180 : opt.days;
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const words = Array.isArray(opt.words) ? opt.words : Array.from({ length: opt.words || 60 }, (x, i) => ({ id: 'w' + (i + 1), l: 1 + Math.floor(i / 12), t: '字' + (i + 1) }));
  const grammar = Array.isArray(opt.grammar) ? opt.grammar : Array.from({ length: opt.grammar == null ? 8 : opt.grammar }, (x, i) => (i % 2 ? 'n' : 'g') + (1 + Math.floor(i / 4)) + '-' + (1 + i % 4));
  const nStart = Math.round(words.length * (opt.started == null ? 0.9 : opt.started));

  const card = (age) => {         /* a card first seen `age` days ago, reviewed a realistic number of times since */
    const reps = 1 + Math.min(14, Math.floor(Math.log2(1 + age) * (0.8 + r())));
    let s = 0.4 + r() * 3; for (let i = 1; i < reps; i++) s *= 1.6 + r() * 1.3;
    s = Math.min(s, 365 * r() + 30);
    const last = Math.floor(now - Math.min(age, s * r()) * DAYMS - r() * DAYMS);
    const c = { st: r() < 0.06 ? (r() < 0.5 ? 'learn' : 'relearn') : 'rev', S: s, D: 1 + r() * 9, due: Math.floor(last + Math.max(1, Math.round(s)) * DAYMS), last, reps, lapses: r() < 0.25 ? int(1, 3) : 0, days: Math.min(99, int(0, reps)) };
    if (r() < 0.08) { c.known = 1; c.days = 99; }
    if (c.st === 'rev' && c.S >= 45) c.mastAt = last;
    return c;
  };

  const S = { cards: {}, settings: {
    retention: 0.9, newPerDay: 8, maxRev: 300, modes: { rec: true, prod: true }, includeNames: false, ghost: true, earlyDrill: true, writeTarget: 20,
    autoplayAudio: true, speechRate: 0.85, voiceName: '', strokeAnim: true, _a2: 1, _a3: 1, audioSpeed: 0.9, _a4: 1, curLesson: 28, _v11: 1, burySib: true,
    newUnlimited: false, revUnlimited: false, _v18: 1, haptics: true, theme: 'auto', _v25: 1, _v22: 1, gramCards: true, newGramPerDay: 4, examDay: 4, _v26: 1,
    prodScope: 'current', _v28: 1, _v30: 1, newCatchPerDay: 12, _v31: 1, _v38: 1, userName: 'Learner' },
    log: {}, intro: {}, hist: { d: [], s: [] }, pick: [], hard: [], sib: {}, cf: {}, gram: {} };

  words.forEach((w, i) => {
    if (i >= nStart) { if (i < nStart + 40) { S.cards[w.id + ':rec'] = {}; S.cards[w.id + ':prod'] = {}; S.pick.push(w.id); } return; }
    const age = Math.max(1, days * (1 - i / nStart));
    S.cards[w.id + ':rec'] = card(age); S.cards[w.id + ':prod'] = card(age);
    if (r() < 0.012) S.hard.push(w.id);
  });
  grammar.forEach((g, i) => { if (i < grammar.length * 0.9) S.cards['g:' + g] = card(Math.max(1, days * (1 - i / grammar.length))); else S.cards['g:' + g] = {}; });

  for (let d = days; d >= 1; d--) {
    const k = dayOf(now - d * DAYMS);
    if (r() < 0.9) { S.log[k] = { rev: int(20, 160), new: int(0, 20) }; S.intro[k] = int(0, 9); if (r() < 0.3) (S.cintro || (S.cintro = {}))[k] = int(1, 12); if (r() < 0.4) (S.gintro || (S.gintro = {}))[k] = int(1, 4); }
  }
  /* daily snapshots: one digit per word. Words are met in order, and settle from 1 up to 4 over a few months. */
  for (let d = Math.min(days, 180); d >= 1; d--) {
    const upto = nStart * (1 - (d - 1) / Math.max(1, days));
    let s = '';
    for (let i = 0; i < words.length; i++) { const since = (upto - i) / nStart * days; s += since <= 0 ? '0' : since < 5 ? '1' : since < 21 ? (r() < 0.85 ? '2' : '1') : since < 60 ? (r() < 0.85 ? '3' : '2') : (r() < 0.9 ? '4' : '3'); }
    S.hist.d.push(dayOf(now - d * DAYMS)); S.hist.s.push(s);
  }
  for (const off of [1, 0]) {
    const k = dayOf(now - off * DAYMS), m = S.sib[k] = {};
    for (let i = 0; i < Math.min(60, nStart); i++) { const w = words[int(0, nStart - 1)]; m[w.id] = w.id + (r() < 0.5 ? ':rec' : ':prod'); }
    if (grammar.length) m.g = 'g:' + grammar[0];
  }
  grammar.forEach(g => { if (r() < 0.7) S.gram[g] = { n: int(1, 9), ok: int(0, 5) }; });
  for (const f of ['dian', 'cause', 'cmp', 'jiucai', 'ba', 'le', 'de', 'other']) S.cf[f] = { n: int(1, 20), ok: int(0, 9), last: now - int(0, 30) * DAYMS };

  if (opt.full !== false) {
    const lessons = [...new Set(words.map(w => w.l))];
    const conf = {}; words.slice(0, nStart).forEach(w => { conf[w.t + '|B' + (1 + Math.floor((w.l - 1) / 15)) + ' L' + (1 + (w.l - 1) % 15)] = int(1, 4); });
    S.conf = { v: 1, at: new Date(now).toISOString(), scale: { 1: 'Hard', 2: 'Learning', 3: 'Know', 4: 'Mastered' }, words: conf };
    const order = words.slice(Math.floor(nStart * 0.2), Math.floor(nStart * 0.6)).map(w => w.id), res = {};
    order.slice(0, Math.floor(order.length * 0.6)).forEach(id => { res[id] = r() < 0.7 ? 'm' : r() < 0.5 ? 'l' : 'h'; });
    S.mtest = { lo: 9, hi: 21, res, order, i: Object.keys(res).length, started: now - 20 * DAYMS };
    const ids = words.slice(Math.floor(nStart * 0.5), nStart).map(w => w.id);
    S.exam = { lo: 16, hi: 31, date: dayOf(now + 14 * DAYMS), name: '大考試', run: { ids, i: Math.floor(ids.length / 3), label: 'untested', hist: ids.slice(0, Math.floor(ids.length / 3)).map(wid => ({ wid, prev: null })) } };
    S.listen = {}; lessons.forEach(l => { if (r() < 0.6) S.listen[l] = { n: int(1, 30), ok: int(0, 20) }; });
    S.us = {}; words.slice(0, nStart).forEach(w => { if (r() < 0.6) S.us[w.id] = [int(0, 6), int(0, 3), r() < 0.7 ? 1 : 0]; });
    S.read = {}; lessons.slice(-4).forEach(l => { for (let i = 0; i < 3; i++) if (r() < 0.6) S.read[l + ':' + i] = int(1, 3); });
    const tw = {}; words.slice(0, nStart).forEach(w => { if (r() < 0.3) tw[w.id] = [int(1, 8), int(40, 100)]; });
    S.tone = { v: 2, n: int(50, 900), by: { 1: [40, 52], 2: [31, 60], 3: [22, 48], 4: [50, 55] }, conf: { '2>3': 9, '3>2': 14, '1>4': 3 }, pair: { 23: [4, 9], 33: [2, 7], 41: [6, 6] }, w: tw };
    S.vp = { v: 2, n: 4210, sum: 61000.5 + r(), sq: 902113.25 + r() };
    const nm = opt.my == null ? 20 : opt.my, my = S.my = { n: nm + 1, w: {}, c: {}, intro: {}, log: {}, tp: ['Food & drink', 'Getting around', 'Shopping & money', 'Home & daily life', 'School & study', 'Work', 'People & family', 'Health & body', 'Feelings & opinions', 'Free time', 'Travel & places', 'Slang & set phrases'].map((n, i) => ({ id: 't' + (i + 1), n })), tn: 13, perDay: 5, both: false };
    for (let i = 1; i <= nm; i++) {
      my.w['u' + i] = { t: '詞語' + i, p: 'cíyǔ ' + i, m: 'a word met outside class, number ' + i, at: now - int(1, 120) * DAYMS };
      if (r() < 0.6) my.w['u' + i].g = ['t' + int(1, 12)];
      my.c['u' + i + ':rec'] = r() < 0.85 ? card(int(1, 120)) : {};
    }
    for (let d = Math.min(days, 110); d >= 1; d--) if (r() < 0.5) { const k = dayOf(now - d * DAYMS); my.intro[k] = int(1, 5); my.log[k] = int(1, 25); }
  }
  return S;
}

module.exports = { makeDeck, dayOf, DAYMS };

/* Unit tests for js/sync-records.js: one merge rule at a time.   node --test tools/test/*.test.js
   The randomised many-device run is in sim.test.js. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeRig, emptyState, normal, firstDiff, sy, clone, dayOf, memStore, tick } = require('./helpers/rig.js');
const { rng32 } = require('./helpers/cloud.js');
const { makeDeck, DAYMS } = require('./helpers/deck.js');

const ROOT = path.join(__dirname, '..', '..');
/* The app, wherever it lives: one index.html today, js/ and data/ files once it is split up. */
const APP = (() => {
  const read = f => (fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n') : []);
  const js = fs.existsSync(path.join(ROOT, 'js')) ? fs.readdirSync(path.join(ROOT, 'js')).filter(f => /\.js$/.test(f) && f !== 'sync-records.js').map(f => 'js/' + f) : [];
  const all = [].concat(read('index.html'), ...js.map(read)), data = [].concat(read('index.html'), read('data/words.js'), read('data/grammar.js'));
  const grab = n => { const l = data.find(x => x.startsWith('const ' + n + ' = ')); return l ? JSON.parse(l.slice(l.indexOf('=') + 1).trim().replace(/;$/, '')) : null; };
  return { code: all.filter(l => l.length < 3000).join('\n'), words: grab('WORDS'), grammar: grab('GRAMMAR') };
})();
const same = (a, b, o) => assert.equal(firstDiff(normal(a, o), normal(b, o)), null);

/* what the app's rate() does to the state, in short */
function review(d, cid) {
  const S = d.S, now = d.now(), day = dayOf(now);
  S.log[day] = S.log[day] || { rev: 0, new: 0 };
  const c = S.cards[cid];
  if (!c || c.st === undefined) { S.cards[cid] = { st: 'learn', S: 0.5, D: 5, due: now + 60000, last: now, reps: 1, lapses: 0, days: 0 }; S.log[day].new++; }
  else { c.reps++; c.last = now; c.S = c.S * 1.7 + 0.1; c.st = 'rev'; c.due = now + DAYMS; S.log[day].rev++; }
  d.save();
  return day;
}
const total = (S, day) => { const e = S.log[day] || {}; return (e.rev || 0) + (e.new || 0); };
const baseDeck = (rig, o) => {
  const S = makeDeck(Object.assign({ rng: rng32(5), now: rig.cloud.time, words: 30, grammar: 4, days: 10, my: 3 }, o));
  S.hard = ['w1', 'w2', 'w3']; S.pick = ['w28', 'w29', 'w30', 'w600', 'w601', 'w602', 'w603', 'w604'];
  return S;
};
/* two devices that hold the same deck and have both joined */
async function pair(opt, b) {
  const rig = makeRig(Object.assign({ dup: 0.2, rng: rng32(11) }, opt));
  const base = baseDeck(rig);
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base), b);
  rig.start(A); rig.start(B);
  await rig.settle();
  return { rig, A, B, base };
}
const started = S => Object.keys(S.cards).filter(k => S.cards[k].st !== undefined);

/* ---------------- keys, stamps, compact forms ---------------- */

test('keys: any id becomes a legal Realtime Database key and comes back unchanged', () => {
  for (const id of ['w123:rec', 'g:n22-1', 'u7:prod', '2026-11-15', 'a.b$c#d[e]f/g', '50%', 'tab\there', '陳月美|B1 L1', '', '~~', 'newPerDay', '_v38']) {
    const k = sy.syEnc(id);
    assert.ok(!/[.$#\[\]\/\u0000-\u001f\u007f]/.test(k), 'illegal character left in ' + JSON.stringify(k));
    assert.equal(sy.syDec(k), id);
  }
});

test('keys: the ids the app really uses need no escaping', { skip: !APP.words || !APP.grammar }, () => {
  const W = APP.words, G = APP.grammar, ids = [];
  for (const w of W) ids.push(w.id, w.id + ':rec', w.id + ':prod');
  for (const l in G) for (const p of G[l]) ids.push(p.id, 'g:' + p.id);
  for (const m of APP.code.matchAll(/S\.settings\.([A-Za-z_][A-Za-z0-9_]*)/g)) ids.push(m[1]);
  ids.push('u1', 'u1:rec', 'u1:prod', 't13', dayOf(Date.now()), dayOf(Date.now()) + '~w12', dayOf(Date.now()) + '~g');
  assert.ok(ids.length > 3000);
  for (const id of ids) { assert.equal(sy.syEnc(id), id, id); assert.ok(('sb~' + id + '~devaaaa1').length < 700); }
});

test('state: every field of S the app uses has a decided sync rule', { skip: !APP.code }, () => {
  /* A field this test does not know still syncs — as one whole record under x~<field> — but that is a default, not a
     decision. When this fails: decide how the new field merges (docs/sync.md, "The record model"), then add it here. */
  const DECIDED = ['cards', 'settings', 'log', 'intro', 'cintro', 'gintro', 'hard', 'pick', 'hist', 'sib', 'gram', 'cf', 'listen', 'us', 'read', 'mtest', 'exam', 'tone', 'vp', 'my', 'conf'];
  const found = new Set();
  for (const m of APP.code.matchAll(/(?<![\w$.])S\.([A-Za-z_]\w*)/g)) found.add(m[1]);
  assert.ok(found.has('cards') && found.has('settings'), 'the app\'s code was not found');
  const unknown = [...found].filter(f => !DECIDED.includes(f));
  assert.deepEqual(unknown, [], 'state fields with no decided sync rule: ' + unknown.join(', '));
});

test('settings: the engine\'s list of device-local settings is the app\'s', { skip: !APP.code }, () => {
  const code = APP.code;
  const list = n => { const m = code.match(new RegExp('const ' + n + '\\s*=\\s*(\\[[^\\]]*\\])')); return m ? JSON.parse(m[1].replace(/'/g, '"')) : null; };
  const a = list('LOCAL_SETTINGS'), b = list('STRICT_LOCAL');
  if (!a || !b) return;       /* the lists have moved: the app passes them in as env.local */
  assert.deepEqual(sy.SY_LOCAL.slice().sort(), a.concat(b).sort());
});

test('clock: stamps only go up, even when the device clock goes back or stands still', () => {
  let now = 1800000000000;
  const E = sy.syCreate({ state: () => ({}), store: memStore(), node: 'n1', now: () => now, timers: false });
  let last = '';
  for (let i = 0; i < 50000; i++) {
    if (i === 100) now -= 3 * DAYMS; if (i === 30000) now += 5;
    const s = sy.syTick(E);
    assert.ok(s > last, 'stamp went back at ' + i); assert.ok(sy.syStampOk(s)); last = s;
  }
  assert.ok(sy.syWall(last) >= 1800000000000, 'the counter overflowed into the wall part instead of wrapping');
});

test('clock: a stamp from far in the future does not move this clock, and an edit after it still wins', () => {
  const now = 1800000000000;
  const E = sy.syCreate({ state: () => ({}), store: memStore(), node: 'n1', now: () => now, timers: false });
  const future = sy.syStamp(now + 30 * DAYMS, 4, 'zzzzzzzz'), near = sy.syStamp(now + 60000, 2, 'zzzzzzzz');
  assert.equal(sy.syObserve(E, future), false);
  assert.ok(sy.syWall(sy.syTick(E)) <= now + 1);
  const mine = sy.syAfter(E, future);
  assert.ok(mine > future, 'an edit made after seeing a version must beat it');
  assert.ok(E.hw <= now + 1, 'the device clock was dragged forward');
  assert.equal(sy.syObserve(E, near), true);
  assert.ok(sy.syTick(E) > near);
});

test('compact forms: a card and a daily snapshot survive the round trip exactly', () => {
  const r = rng32(3);
  const cards = [{}, { st: 'learn', S: 0.40255, D: 7.1949, due: 0, last: 1794101476250, reps: 1, lapses: 0, days: 0 },
    { st: 'rev', S: 22.4505154590612, D: 7.391395770627261, due: 1796002276250.5, last: 1794101476250, reps: 7, lapses: 1, days: 4, known: 1, mastAt: 1794101476250 },
    { st: 'relearn', S: 1e-7, D: 10, due: 1e21, last: 5, reps: 3, lapses: 2, days: 99, susp: 1, leech: 1 },
    { st: 'rev', S: 3, D: 3, due: 9, last: 8, reps: 1, lapses: 0, days: 0, known: true, note: 'a,b', extra: { x: [1, 2] } },
    { st: 'rev', S: 3, D: 3, due: 9, last: 8, reps: 1, lapses: 0 }, { st: 'odd', S: 1 }, null, 'text', [1, 2]];
  for (let i = 0; i < 300; i++) { const c = { st: ['learn', 'rev', 'relearn'][i % 3], S: r() * 400, D: 1 + r() * 9, due: Math.floor(r() * 2e12), last: Math.floor(r() * 2e12), reps: i, lapses: i % 4, days: i % 100 }; if (r() < 0.3) c.known = 1; if (r() < 0.3) c.mastAt = Math.floor(r() * 2e12); if (r() < 0.1) c.susp = 1; cards.push(c); }
  for (const c of cards) {
    const wire = JSON.parse(JSON.stringify(sy.syPackCard(c)));
    assert.deepEqual(sy.syUnpackCard(wire), c);
  }
  for (const s of ['', '0', '0000', '00001111222233334444', '0123401234', '4'.repeat(1478), '0'.repeat(37) + '1' + '2'.repeat(36 * 36 + 5), 'not digits', '12(3)']) {
    const wire = JSON.parse(JSON.stringify(sy.syPack(s)));
    assert.equal(sy.syUnpack(wire), s);
  }
  assert.ok(sy.syPack('0'.repeat(1000) + '4'.repeat(478)).length < 20);
});

/* ---------------- cards ---------------- */

test('cards: reviews of different cards on two offline devices all survive', async () => {
  const { rig, A, B } = await pair();
  const ids = started(A.S);
  A.conn.setOnline(false); B.conn.setOnline(false);
  const day = dayOf(rig.cloud.time), before = total(A.S, day);
  for (const cid of ids.slice(0, 4)) { rig.cloud.time += 4000; review(A, cid); }
  for (const cid of ids.slice(4, 7)) { rig.cloud.time += 4000; review(B, cid); }
  const mineA = clone(ids.slice(0, 4).map(c => A.S.cards[c])), mineB = clone(ids.slice(4, 7).map(c => B.S.cards[c]));
  A.conn.setOnline(true); B.conn.setOnline(true);
  await rig.settle();
  same(A.S, B.S);
  assert.deepEqual(ids.slice(0, 4).map(c => B.S.cards[c]), mineA);
  assert.deepEqual(ids.slice(4, 7).map(c => A.S.cards[c]), mineB);
  assert.equal(total(A.S, day), before + 7);
  assert.equal(A.lost.length + B.lost.length, 0);
});

test('cards: the same card reviewed on two offline devices — the later review wins on both, whoever syncs first; both reviews are counted', async () => {
  for (const first of ['A', 'B']) {
    const { rig, A, B } = await pair();
    const cid = started(A.S)[2], day = dayOf(rig.cloud.time), before = total(A.S, day);
    A.conn.setOnline(false); B.conn.setOnline(false);
    rig.cloud.time += 60000; review(A, cid);
    rig.cloud.time += 60000; review(B, cid); B.S.cards[cid].D = 9.5; B.save();
    const later = clone(B.S.cards[cid]);
    const order = first === 'A' ? [A, B] : [B, A];
    order[0].conn.setOnline(true); await rig.settle([order[0]]);
    order[1].conn.setOnline(true); await rig.settle();
    assert.deepEqual(A.S.cards[cid], later, 'first online: ' + first);
    assert.deepEqual(B.S.cards[cid], later);
    assert.equal(total(A.S, day), before + 2, 'the review that lost the card is still a review done that day');
    assert.equal(total(B.S, day), before + 2);
    /* a device is told when a change it had not sent yet was overruled */
    assert.deepEqual(A.lost, first === 'B' ? ['c~' + cid] : []);
    same(A.S, B.S);
  }
});

test('cards: an edit made after seeing the other device\'s version wins even when this clock is hours behind', async () => {
  const { rig, A, B } = await pair({}, { skew: -5 * 3600000, knowsServerTime: false });
  const cid = started(A.S)[0];
  rig.cloud.time += 1000; review(A, cid); await rig.settle();
  assert.deepEqual(B.S.cards[cid], A.S.cards[cid]);
  rig.cloud.time += 1000; review(B, cid);
  const mine = clone(B.S.cards[cid]);
  await rig.settle();
  assert.deepEqual(A.S.cards[cid], mine);
  same(A.S, B.S);
});

test('cards: adding a lesson on one device does not wipe reviews another device did on its cards', async () => {
  const { rig, A, B } = await pair();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000;
  review(B, 'w900:rec'); review(B, 'w900:rec');                      /* B meets a new word and studies it */
  const studied = clone(B.S.cards['w900:rec']);
  rig.cloud.time += 3600000;                                         /* an hour later A queues the same lesson, blind */
  for (const cid of ['w900:rec', 'w900:prod', 'w901:rec']) A.S.cards[cid] = {};
  A.save();
  A.conn.setOnline(true); await rig.settle([A]);
  B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(A.S.cards['w900:rec'], studied);
  assert.deepEqual(B.S.cards['w900:prod'], {});
  assert.deepEqual(B.S.cards['w901:rec'], {});
  same(A.S, B.S);
});

test('cards: a deliberate reset (undo of a first review, Triage → Learning) does replace the started card', async () => {
  const { rig, A, B } = await pair();
  const cid = started(A.S)[1];
  rig.cloud.time += 1000; A.S.cards[cid] = {}; A.save();
  await rig.settle();
  assert.deepEqual(B.S.cards[cid], {});
  same(A.S, B.S);
});

test('cards: a deleted card stays deleted — a device that was offline does not bring it back', async () => {
  const { rig, A, B } = await pair();
  const cid = started(A.S)[3];
  B.conn.setOnline(false);
  rig.cloud.time += 1000; delete A.S.cards[cid]; A.save(); await rig.settle([A]);
  assert.equal(rig.rec('c~' + cid).d, 1, 'the cloud keeps a tombstone');
  rig.cloud.time += 1000; review(B, started(B.S)[5]);               /* B does something else meanwhile */
  B.conn.setOnline(true); await rig.settle();
  assert.equal(cid in B.S.cards, false);
  assert.equal(cid in A.S.cards, false);
  /* and a brand-new device does not get it either */
  const C = rig.device('devcccc3'); rig.start(C); await rig.settle();
  assert.equal(cid in C.S.cards, false);
  same(A.S, C.S);
});

test('cards: delete on one device, review on the other, both offline — the later action wins', async () => {
  const { rig, A, B } = await pair();
  const cid = started(A.S)[3];
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; delete A.S.cards[cid]; A.save();
  rig.cloud.time += 1000; review(B, cid);
  const kept = clone(B.S.cards[cid]);
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(A.S.cards[cid], kept);
  same(A.S, B.S);
});

/* ---------------- the day's counters ---------------- */

test('counters: two devices studying offline on the same day add up', async () => {
  const { rig, A, B } = await pair();
  const day = dayOf(rig.cloud.time), ids = started(A.S), b0 = clone(A.S.log[day] || { rev: 0, new: 0 });
  A.conn.setOnline(false); B.conn.setOnline(false);
  for (let i = 0; i < 5; i++) { rig.cloud.time += 1000; review(A, ids[i]); }
  for (let i = 5; i < 8; i++) { rig.cloud.time += 1000; review(B, ids[i]); }
  review(B, 'w950:rec');
  A.S.intro[day] = (A.S.intro[day] || 0) + 2; A.save();
  B.S.intro[day] = (B.S.intro[day] || 0) + 1; B.S.gintro = B.S.gintro || {}; B.S.gintro[day] = (B.S.gintro[day] || 0) + 4; B.save();
  const i0 = A.S.intro[day] - 2, g0 = B.S.gintro[day] - 4;
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  for (const d of [A, B]) {
    assert.deepEqual(d.S.log[day], { rev: b0.rev + 8, new: b0.new + 1 });
    assert.equal(d.S.intro[day], i0 + 3);
    assert.equal(d.S.gintro[day], g0 + 4);
  }
  assert.ok(rig.rec('d~' + day + '~devaaaa1') && rig.rec('d~' + day + '~devbbbb2'), 'one record per device per day');
});

test('counters: an undo takes the review back out everywhere', async () => {
  const { rig, A, B } = await pair();
  const day = dayOf(rig.cloud.time), cid = started(A.S)[0], before = total(A.S, day);
  const snap = { card: clone(A.S.cards[cid]), log: clone(A.S.log) };
  rig.cloud.time += 1000; review(A, cid); await rig.settle();
  assert.equal(total(B.S, day), before + 1);
  rig.cloud.time += 1000; A.S.cards[cid] = snap.card; A.S.log = snap.log; A.save(); await rig.settle();      /* what doUndo() does */
  assert.equal(total(B.S, day), before);
  assert.deepEqual(B.S.cards[cid], snap.card);
});

test('counters: erasing all progress on one device empties the deck and zeroes the days on every device', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000;
  A.S = { cards: {}, settings: A.S.settings, log: {}, intro: {}, hist: { d: [], s: [] }, hard: [], pick: [] };
  A.save(); await rig.settle();
  assert.deepEqual(B.S.cards, {});
  assert.deepEqual(normal(B.S).log, {});
  assert.deepEqual(B.S.hard, []);
  for (const f of ['tone', 'exam', 'mtest', 'vp']) assert.equal(f in B.S, f in A.S, f);
  /* what is left of My words, on both, is its id counters: an id is never handed out twice, even after an erase */
  assert.deepEqual(B.S.my, { w: {}, c: {}, intro: {}, log: {}, tp: [], n: 4, tn: 13 });
  assert.equal(A.S.my.n, 4);
  same(A.S, B.S);
});

/* ---------------- settings ---------------- */

test('settings: merged key by key; device-local settings never leave the device', async () => {
  const { rig, A, B } = await pair();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; A.S.settings.newPerDay = 14; A.S.settings.theme = 'dark'; A.S.settings.voiceName = 'A-voice'; A.S.settings.preloadedAt = 123; A.save();
  rig.cloud.time += 1000; B.S.settings.curLesson = 31; B.S.settings.modes = { rec: true, prod: false }; B.S.settings.theme = 'light'; B.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  for (const d of [A, B]) { assert.equal(d.S.settings.newPerDay, 14); assert.equal(d.S.settings.curLesson, 31); assert.deepEqual(d.S.settings.modes, { rec: true, prod: false }); }
  assert.equal(A.S.settings.theme, 'dark'); assert.equal(B.S.settings.theme, 'light');
  assert.equal(B.S.settings.voiceName, ''); assert.equal('preloadedAt' in B.S.settings, false);
  for (const k of sy.SY_LOCAL) assert.equal(rig.rec('s~' + k), undefined, k + ' reached the cloud');
});

test('settings: the same key changed on two offline devices — the later change wins', async () => {
  const { rig, A, B } = await pair();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; A.S.settings.newPerDay = 3; A.save();
  rig.cloud.time += 1000; B.S.settings.newPerDay = 20; B.save();
  B.conn.setOnline(true); await rig.settle([B]); A.conn.setOnline(true); await rig.settle();
  assert.equal(A.S.settings.newPerDay, 20); assert.equal(B.S.settings.newPerDay, 20);
});

test('settings: a deleted setting is deleted everywhere', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000; delete A.S.settings.userName; A.save(); await rig.settle();
  assert.equal('userName' in B.S.settings, false);
});

test('migration flags: a flag set anywhere is set everywhere and can never be unset', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000; A.S.settings._v70 = 1; A.save(); await rig.settle();
  assert.equal(B.S.settings._v70, 1);
  /* B loses the flag (an old backup restored, say), later than A set it: the flag comes back */
  rig.cloud.time += 1000; delete B.S.settings._v70; delete B.S.settings._v38; B.save(); await rig.settle();
  assert.equal(A.S.settings._v70, 1); assert.equal(B.S.settings._v70, 1);
  assert.equal(A.S.settings._v38, 1); assert.equal(B.S.settings._v38, 1);
  assert.notEqual(rig.rec('s~_v70').d, 1);
});

test('start-up housekeeping never overrules what a person did on another device', async () => {
  const { rig, A, B } = await pair();
  const cid = started(A.S)[4];
  B.conn.setOnline(false);
  rig.cloud.time += 1000; review(A, cid); A.S.settings.newPerDay = 17; A.save();
  const real = clone(A.S.cards[cid]);
  await rig.settle([A]);
  /* B opens the new version an hour later: its start-up migration rewrites the same card and the same setting */
  rig.cloud.time += 3600000;
  B.S.cards[cid].days = 99; B.S.settings.newPerDay = 8; B.S.settings._v71 = 1; B.S.settings.fresh = 'default';
  rig.reload(B); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(B.S.cards[cid], real); assert.equal(B.S.settings.newPerDay, 17);
  assert.equal(A.S.settings._v71, 1); assert.equal(A.S.settings.fresh, 'default');
  same(A.S, B.S);
});

/* ---------------- lists ---------------- */

test('lists: members are added and removed one by one; both devices\' additions stay', async () => {
  const { rig, A, B } = await pair();
  const h0 = A.S.hard.slice(), o0 = clone(rig.rec('o~h'));
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; A.S.hard.push('w801'); A.S.pick.push('w811'); A.save();
  rig.cloud.time += 1000; B.S.hard.push('w802'); B.S.hard = B.S.hard.filter(x => x !== h0[0]); B.S.pick = B.S.pick.filter(x => x !== B.S.pick[0]); B.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(A.S.hard, h0.slice(1).concat(['w801', 'w802']));
  assert.deepEqual(B.S.hard, A.S.hard); assert.deepEqual(B.S.pick, A.S.pick);
  assert.ok(A.S.pick.includes('w811'));
  assert.equal(rig.rec('h~' + h0[0]).d, 1);
  assert.deepEqual(rig.rec('o~h'), o0, 'adding and removing never rewrite the order record');
});

test('lists: removed on one device and added again later on another — the later one wins', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000; A.S.hard.push('w801'); A.save(); await rig.settle();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; A.S.hard = A.S.hard.filter(x => x !== 'w801'); A.save();
  rig.cloud.time += 1000; B.S.hard = B.S.hard.filter(x => x !== 'w801'); B.save(); B.S.hard.push('w801'); B.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.ok(A.S.hard.includes('w801')); assert.deepEqual(A.S.hard, B.S.hard);
});

test('lists: a reorder (move to top) reaches the other device, and later additions go to the end', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000;
  const w = A.S.pick.splice(5, 1)[0]; A.S.pick.unshift(w); A.save(); await rig.settle();      /* qTop */
  assert.equal(B.S.pick[0], w); assert.deepEqual(B.S.pick, A.S.pick);
  rig.cloud.time += 1000; B.S.pick.push('w990'); B.save(); await rig.settle();
  assert.equal(A.S.pick[A.S.pick.length - 1], 'w990'); assert.deepEqual(A.S.pick, B.S.pick);
  rig.cloud.time += 1000; A.S.pick = []; A.save(); await rig.settle();                           /* qClear */
  assert.deepEqual(B.S.pick, []);
});

test('lists: My words topics — rename, delete, add and the id counter', async () => {
  const { rig, A, B } = await pair();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; A.S.my.tp.find(t => t.id === 't9').n = '學'; A.S.my.tp.push({ id: 't13', n: 'Mine' }); A.S.my.tn = 14; A.save();
  rig.cloud.time += 1000; B.S.my.tp = B.S.my.tp.filter(t => t.id !== 't2'); B.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(A.S.my.tp, B.S.my.tp);
  assert.deepEqual(A.S.my.tp.map(t => t.id), ['t1', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12', 't13']);
  assert.equal(B.S.my.tp.find(t => t.id === 't9').n, '學');
  assert.ok(B.S.my.tn >= 14, 'a topic id seen from another device is never handed out again');
});

/* ---------------- time-windowed records ---------------- */

test('daily snapshots: the oldest day falls out without a tombstone; today\'s snapshot reaches the other device', async () => {
  const rig = makeRig({ rng: rng32(2) });
  const S = emptyState(), t0 = rig.cloud.time;
  for (let i = 180; i >= 1; i--) { S.hist.d.push(dayOf(t0 - i * DAYMS)); S.hist.s.push('0'.repeat(30) + (i % 5)); }
  const A = rig.device('devaaaa1', S), B = rig.device('devbbbb2');
  rig.start(A); rig.start(B); await rig.settle();
  assert.deepEqual(B.S.hist, A.S.hist);
  const oldest = A.S.hist.d[0];
  assert.ok(rig.rec('hi~' + oldest));
  A.S.hist.d.push(dayOf(t0)); A.S.hist.s.push('4'.repeat(31)); A.S.hist.d.shift(); A.S.hist.s.shift(); A.save();      /* takeSnapshot() at the cap */
  await rig.settle();
  assert.equal(rig.rec('hi~' + oldest), undefined, 'removed, not tombstoned');
  assert.equal(B.S.hist.d.length, 180); assert.deepEqual(B.S.hist, A.S.hist);
  assert.equal(rig.pending(A).length + rig.pending(B).length, 0);
});

test('sibling claims: today\'s travel, old days are never sent, and a day that has passed is removed from the cloud', async () => {
  const { rig, A, B } = await pair();
  const today = dayOf(rig.cloud.time), old = dayOf(rig.cloud.time - 6 * DAYMS);
  rig.cloud.time += 1000; A.S.sib[today] = Object.assign(A.S.sib[today] || {}, { w5: 'w5:prod', g: 'g:n1-1' }); A.S.sib[old] = { w6: 'w6:rec' }; A.save();
  await rig.settle();
  assert.equal(B.S.sib[today].w5, 'w5:prod'); assert.equal(B.S.sib[today].g, 'g:n1-1');
  assert.equal(rig.rec('sb~' + old + '~w6'), undefined);
  assert.ok(rig.rec('sb~' + today + '~w5'));
  rig.cloud.time += 4 * DAYMS; A.save(); B.save(); await rig.settle();
  assert.equal(rig.rec('sb~' + today + '~w5'), undefined);
  assert.equal(Object.keys(rig.recs()).filter(k => k.startsWith('sb~')).length, 0);
});

/* ---------------- My words, drills ---------------- */

test('My words: words, their cards, edits and deletions; the id counter only goes up', async () => {
  const { rig, A, B } = await pair();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000;
  A.S.my.w.u4 = { t: '蘋果', p: 'píngguǒ', m: 'apple', at: A.now(), g: ['t1'] }; A.S.my.c['u4:rec'] = {}; A.S.my.n = 5; A.save();
  rig.cloud.time += 1000;
  B.S.my.w.u1.m = 'edited'; delete B.S.my.w.u2; delete B.S.my.c['u2:rec']; B.S.my.perDay = 9; B.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  same(A.S, B.S);
  assert.equal(B.S.my.w.u4.t, '蘋果'); assert.deepEqual(B.S.my.w.u4.g, ['t1']); assert.equal(A.S.my.w.u1.m, 'edited');
  assert.equal('u2' in A.S.my.w, false); assert.equal(A.S.my.perDay, 9);
  assert.equal(B.S.my.n, 5);
  /* a lower counter arriving later never lowers it */
  rig.cloud.time += 1000; B.S.my.n = 2; B.save(); await rig.settle();
  assert.equal(A.S.my.n, 5); assert.equal(B.S.my.n, 5);
});

test('My words: two offline devices that hand out the same id — one word wins, and the device that lost is told (the app must allocate ids per device)', async () => {
  const { rig, A, B } = await pair();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 1000; A.S.my.w.u4 = { t: '蘋果', p: '', m: 'apple', at: A.now() }; A.S.my.n = 5; A.save();
  rig.cloud.time += 1000; B.S.my.w.u4 = { t: '香蕉', p: '', m: 'banana', at: B.now() }; B.S.my.n = 5; B.save();
  B.conn.setOnline(true); await rig.settle([B]); A.conn.setOnline(true); await rig.settle();
  assert.equal(A.S.my.w.u4.t, '香蕉'); assert.equal(B.S.my.w.u4.t, '香蕉');
  assert.deepEqual(A.lost, ['mw~u4']);
});

test('drill tallies and whole-field records travel; S.conf does not', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000;
  A.S.gram['n2-1'] = { n: 3, ok: 2 }; A.S.us.w7 = [2, 1, 1]; A.S.cf['a/b.c'] = { n: 1, ok: 1, last: 5 }; A.S.listen[33] = { n: 1, ok: 0 }; A.S.read['31:0'] = 2;
  A.S.mtest.res.w9 = 'h'; A.S.mtest.i = 77; A.S.exam.date = '2027-01-30'; A.S.exam.run.i++; A.S.tone.w.w3 = [4, 80]; A.S.tone.n++; A.S.vp.n = 9000;
  A.S.future = { anything: [1, { a: null }] };
  A.S.conf.at = 'changed'; A.save();
  await rig.settle();
  const bConf = clone(B.S.conf);
  same(A.S, B.S);
  assert.deepEqual(B.S.cf['a/b.c'], { n: 1, ok: 1, last: 5 }); assert.equal(B.S.mtest.res.w9, 'h'); assert.equal(B.S.mtest.i, 77);
  assert.equal(B.S.exam.date, '2027-01-30'); assert.deepEqual(B.S.tone.w.w3, [4, 80]); assert.equal(B.S.vp.n, 9000);
  assert.deepEqual(B.S.future, { anything: [1, { a: null }] });
  assert.deepEqual(B.S.conf, bConf); assert.notEqual(B.S.conf.at, 'changed');
  assert.ok(rig.rec('cf~a%2fb%2ec'), 'an id with illegal characters is escaped in the key');
  assert.equal(Object.keys(rig.recs()).some(k => /conf/.test(k)), false);
});

test('tone coach: per-word records wait until S.tone itself has arrived', () => {
  const now = 1800000000000, S = emptyState();
  const E = sy.syCreate({ state: () => S, store: memStore(), node: 'n1', now: () => now, day: dayOf, timers: false });
  E.joined = 1; E.uid = 'u1';
  const h = sy.syStamp(now, 0, 'other111');
  const r1 = sy.syApply(E, S, [['tw~w3', { h, m: 1, j: '[4,80]' }]]);
  assert.equal(r1.deferred, 1); assert.equal(S.tone, undefined);
  const r2 = sy.syApply(E, S, [['x~tone', { h, m: 2, j: JSON.stringify({ v: 2, n: 1, by: {}, conf: {}, pair: {} }) }]]);
  assert.equal(r2.n, 2); assert.deepEqual(S.tone, { w: { w3: [4, 80] }, v: 2, n: 1, by: {}, conf: {}, pair: {} });
  assert.equal(sy.syDiff(E, S), 0, 'what was applied is not mistaken for a change made here');
});

/* ---------------- first sync ---------------- */

test('first sync: empty cloud takes the device\'s deck; an empty device takes the cloud\'s', async () => {
  const rig = makeRig({ rng: rng32(4) });
  const base = baseDeck(rig), A = rig.device('devaaaa1', clone(base));
  rig.start(A); await rig.settle();
  same(A.S, base);
  assert.ok(Object.keys(rig.recs()).length > 200);
  const B = rig.device('devbbbb2'); B.S.settings.theme = 'dark';
  rig.start(B); await rig.settle();
  same(B.S, base);          /* including the settings: a new device's defaults do not overrule the account's */
  assert.equal(B.S.settings.theme, 'dark');
  assert.equal(B.changes, 1);
  assert.equal(rig.cloud.node('users/u1').meta.v, sy.SY_V);
});

test('first sync: two devices with the same old deck join at the same moment — nothing is counted twice', async () => {
  const { A, B, base } = await pair();
  same(A.S, base); same(B.S, base);
  assert.deepEqual(sy.syCtRead(A.S), sy.syCtRead(base));
});

test('first sync: both sides hold data — merged record by record, nobody is asked to pick a side', async () => {
  const rig = makeRig({ rng: rng32(6) });
  const base = baseDeck(rig), ids = started(base), day = dayOf(rig.cloud.time);
  const a = clone(base), b = clone(base);
  const A = rig.device('devaaaa1', a), B = rig.device('devbbbb2', b);
  /* before either has ever synced by record, each goes its own way from the common deck */
  rig.cloud.time += 60000; review(A, ids[0]); review(A, ids[1]); review(A, ids[2]); A.S.hard.push('w700'); A.S.settings.newPerDay = 11; A.S.my.w.u9 = { t: '甲', p: '', m: 'a', at: 1 };
  rig.cloud.time += 60000; review(B, ids[1]); review(B, ids[3]); B.S.hard.push('w701'); B.S.settings.curLesson = 3; delete B.S.cards[ids[7]];
  const a1 = clone(A.S.cards[ids[0]]), b1 = clone(B.S.cards[ids[1]]), b3 = clone(B.S.cards[ids[3]]), base0 = total(base, day);
  rig.start(A); await rig.settle();
  rig.start(B); await rig.settle();
  same(A.S, B.S);
  assert.deepEqual(A.S.cards[ids[0]], a1); assert.deepEqual(A.S.cards[ids[3]], b3);
  assert.deepEqual(A.S.cards[ids[1]], b1, 'the same card on both: the later review');
  assert.ok(ids[7] in B.S.cards, 'a card one side merely lacks is filled in: a deck that was never synced has no deletions to report');
  assert.ok(A.S.hard.includes('w700') && A.S.hard.includes('w701'));
  assert.equal(B.S.my.w.u9.t, '甲');
  assert.equal(B.S.settings.newPerDay, 11, 'where both have a setting, the account\'s (the first to join) stands');
  /* the documented loss: counts made before joining are compared, not added — 3 on one, 2 on the other gives 3 */
  assert.equal(total(A.S, day), base0 + 3); assert.equal(total(B.S, day), base0 + 3);
});

test('first sync with join: "cloud" drops what the device holds', async () => {
  const rig = makeRig({ rng: rng32(8) });
  const A = rig.device('devaaaa1', baseDeck(rig)); rig.start(A); await rig.settle();
  const B = rig.device('devbbbb2', baseDeck(rig, { rng: rng32(99), words: 10 })); B.S.cards['w999:rec'] = {}; B.S.settings.theme = 'dark';
  rig.start(B, { join: 'cloud' }); await rig.settle();
  same(B.S, A.S); assert.equal('w999:rec' in A.S.cards, false); assert.equal(B.S.settings.theme, 'dark');
});

test('another account\'s shadow on the device: the engine refuses until the app says what to do with the deck', async () => {
  const { rig, A } = await pair();
  sy.syStop(A.E);
  assert.equal(sy.syStart(A.E, { uid: 'u2' }), false);
  assert.equal(sy.syStatus(A.E).state, 'other-account');
  assert.equal(sy.syStart(A.E, { uid: 'u2', join: 'cloud' }), true);
  await rig.settle([A]);
  assert.deepEqual(A.S.cards, {});
  assert.equal(Object.keys(rig.cloud.node('users/u2').rec).length, 0);
});

/* ---------------- offline, reload, catch-up ---------------- */

test('offline queue: changes made offline survive a reload and go up when the device is back', async () => {
  const { rig, A, B } = await pair();
  const ids = started(A.S), day = dayOf(rig.cloud.time), before = total(A.S, day);
  A.conn.setOnline(false);
  rig.cloud.time += 1000; review(A, ids[0]); review(A, ids[1]); A.S.hard.push('w800'); delete A.S.cards[ids[9]]; A.save();
  const mine = clone(A.S.cards[ids[0]]);
  sy.syFlush(A.E);                             /* handed to the SDK, which loses it with the page */
  rig.reload(A);                               /* still offline */
  assert.ok(rig.pending(A).length >= 4);
  rig.cloud.time += 1000; review(A, ids[2]);
  rig.reload(A); A.conn.setOnline(true); await rig.settle();
  assert.equal(rig.pending(A).length, 0);
  assert.deepEqual(B.S.cards[ids[0]], mine); assert.equal(total(B.S, day), before + 3);
  assert.ok(B.S.hard.includes('w800')); assert.equal(ids[9] in B.S.cards, false);
  same(A.S, B.S);
});

test('a record changed again while its batch is on its way stays pending until the newer version is up', async () => {
  const { rig, A, B } = await pair();
  rig.cloud.time += 1000; A.S.settings.newPerDay = 21; A.save(); sy.syFlush(A.E);
  rig.cloud.time += 1000; A.S.settings.newPerDay = 22; A.save();
  A.conn.send(); A.conn.inbox = A.conn.inbox.filter(ev => ev.t === 'ack');       /* only the acknowledgement comes back */
  A.conn.deliver(); await tick();
  assert.equal(JSON.parse(rig.rec('s~newPerDay').j), 21);
  assert.deepEqual(rig.pending(A), ['s~newPerDay'], 'the acknowledgement of the older version does not clear the newer one');
  A.conn.send(); A.conn.inbox = A.conn.inbox.filter(ev => ev.t === 'ack'); A.conn.deliver(); await tick();
  assert.equal(JSON.parse(rig.rec('s~newPerDay').j), 22);
  assert.deepEqual(rig.pending(A), []);
  await rig.settle();
  assert.equal(B.S.settings.newPerDay, 22);
});

test('catch-up: a device that was away downloads what changed, not the deck', async () => {
  const { rig, A, B } = await pair();
  const full = Object.keys(rig.recs()).reduce((n, k) => n + k.length + JSON.stringify(rig.rec(k)).length, 0);
  rig.cloud.time += 600000;
  rig.reload(B); await rig.settle();          /* a first restart fetches once more what was written while B was listening */
  let d0 = rig.cloud.down;
  rig.cloud.time += 600000;
  rig.reload(B); await rig.settle();
  assert.ok(rig.cloud.down - d0 < 300, 'a restart with nothing new downloaded ' + (rig.cloud.down - d0) + ' bytes');
  B.conn.setOnline(false);
  const ids = started(A.S);
  for (let i = 0; i < 6; i++) { rig.cloud.time += 30000; review(A, ids[i]); }
  await rig.settle([A]);
  d0 = rig.cloud.down;
  rig.reload(B); B.conn.setOnline(true); await rig.settle([B]);
  const got = rig.cloud.down - d0;
  assert.ok(got > 0 && got < full / 10, 'catching up on 6 reviews downloaded ' + got + ' of ' + full + ' bytes');
  same(A.S, B.S);
});

test('apply: the same records in any order, with repeats, give the same deck', async () => {
  const { rig, A, B } = await pair();
  const seen = [], commit = rig.cloud.commit.bind(rig.cloud);
  for (const k in rig.recs()) seen.push([k, clone(rig.rec(k))]);
  rig.cloud.commit = (from, base, map) => { const e = commit(from, base, map); if (!e) for (const p in map) if (p.startsWith('rec/') && map[p]) seen.push([p.slice(4), clone(rig.rec(p.slice(4)))]); return e; };
  const ids = started(A.S), r = rng32(21);
  for (let i = 0; i < 40; i++) {
    rig.cloud.time += 7000; const d = r() < 0.5 ? A : B, cid = ids[Math.floor(r() * 8)];
    if (r() < 0.2) { if (cid in d.S.cards) delete d.S.cards[cid]; else d.S.cards[cid] = {}; d.save(); } else review(d, cid);
    if (r() < 0.3) d.S.hard.push('w8' + i); if (r() < 0.2) d.S.hard.shift(); if (r() < 0.2) d.S.settings.newPerDay = i; if (r() < 0.2) d.S.pick.reverse(); d.save();
    if (r() < 0.4) await rig.settle();
  }
  await rig.settle();
  same(A.S, B.S);
  assert.ok(seen.length > Object.keys(rig.recs()).length + 30, 'old versions are in the list');
  for (let run = 0; run < 12; run++) {
    const list = seen.concat(seen.filter(() => r() < 0.3));
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const S = { cards: {}, settings: {} }, E = sy.syCreate({ state: () => S, store: memStore(), node: 'fresh' + run, now: () => rig.cloud.time, day: dayOf, timers: false });
    E.joined = 1;
    for (let i = 0; i < list.length; i += 97) sy.syApply(E, S, list.slice(i, i + 97));
    same(S, A.S);
  }
});

/* ---------------- the one-time import ---------------- */

test('import: a whole-deck blob becomes records; importing again changes nothing', async () => {
  const rig = makeRig({ rng: rng32(9) });
  const base = baseDeck(rig), blob = JSON.stringify(base);
  const A = rig.device('devaaaa1'); rig.start(A); await rig.settle();
  const r1 = sy.syImport(A.E, { v: 18, json: blob, device: 'iPad', synced_at: 5 });      /* the old room record as it is stored */
  assert.ok(r1.taken > 200 && r1.days > 10);
  await rig.settle();
  /* the settings this device already had stand; everything else is the blob's */
  same(A.S, Object.assign({}, base, { settings: Object.assign({}, base.settings, emptyState().settings) }));
  const before = JSON.stringify(A.S), recs = JSON.stringify(rig.recs());
  for (const form of [blob, base, { json: blob }]) { const r2 = sy.syImport(A.E, form); assert.equal(r2.taken, 0); assert.equal(r2.days, 0); }
  await rig.settle();
  assert.equal(JSON.stringify(A.S), before); assert.equal(JSON.stringify(rig.recs()), recs);
  assert.throws(() => sy.syImport(A.E, '{"not":"a deck"}'), /not a deck/);
});

test('import: on two devices at once — one deck, nothing counted twice; asked for before the first sync, it runs after it', async () => {
  const rig = makeRig({ rng: rng32(10) });
  const base = baseDeck(rig), blob = JSON.stringify(base);
  const A = rig.device('devaaaa1'), B = rig.device('devbbbb2');
  rig.start(A); rig.start(B);
  assert.equal(sy.syImport(A.E, blob), null); sy.syImport(B.E, blob);
  await rig.settle();
  const want = Object.assign({}, base, { settings: Object.assign({}, base.settings, emptyState().settings) });
  same(A.S, want); same(B.S, want);
  assert.deepEqual(sy.syCtRead(A.S), sy.syCtRead(base));
});

test('import: an old blob never overrules newer progress, and fills what is missing', async () => {
  const { rig, A, B, base } = await pair();
  const ids = started(A.S), day = dayOf(rig.cloud.time);
  rig.cloud.time += 60000; review(A, ids[0]); A.S.settings.newPerDay = 2; delete A.S.cards[ids[5]]; A.S.hard = A.S.hard.filter(x => x !== base.hard[0]); A.save();
  await rig.settle();
  const kept = clone(A.S), blob = clone(base);
  blob.cards['w777:rec'] = { st: 'rev', S: 3, D: 3, due: 9, last: 1, reps: 1, lapses: 0, days: 1 };      /* something only the blob has */
  blob.cards[ids[1]].last = rig.cloud.time + 1; blob.cards[ids[1]].reps = 99;                            /* a card the blob reviewed later */
  blob.log[day] = { rev: (base.log[day] || { rev: 0 }).rev + 50, new: 0 };
  const r = sy.syImport(B.E, blob);
  assert.equal(r.taken, 2);
  await rig.settle();
  kept.cards['w777:rec'] = blob.cards['w777:rec']; kept.cards[ids[1]] = blob.cards[ids[1]]; kept.log[day] = { rev: blob.log[day].rev, new: kept.log[day].new };
  same(A.S, kept); same(B.S, kept);
  assert.equal(ids[5] in A.S.cards, false, 'a deletion made since is not undone by the blob');
});

/* ---------------- a cloud that refuses, a cloud that is overwritten, a full disk ---------------- */

test('with the newer-only rule: a refused write is isolated, the cloud\'s version is taken, the rest of the batch goes through', async () => {
  const { rig, A, B } = await pair({ rule: true }, { skew: -3600000, knowsServerTime: false });
  rig.cloud.time += 1000; A.S.settings.newPerDay = 7; A.save(); sy.syFlush(A.E); while (A.conn.send()); await tick();
  /* B's clock is an hour behind and it has not heard of A's change yet: its change to the same key carries an older stamp */
  B.S.settings.newPerDay = 5; for (let i = 0; i < 9; i++) B.S.settings['k' + i] = i; B.save();
  const refused0 = rig.cloud.refused;
  sy.syFlush(B.E); await tick(); B.conn.send();
  await rig.settle();
  assert.ok(rig.cloud.refused > refused0, 'the server refused something');
  assert.equal(A.S.settings.newPerDay, 7); assert.equal(B.S.settings.newPerDay, 7);
  for (let i = 0; i < 9; i++) assert.equal(A.S.settings['k' + i], i);
  assert.equal(Object.keys(B.E.park).length, 0); assert.equal(rig.pending(B).length, 0);
  assert.deepEqual(B.lost, ['s~newPerDay']);
});

test('without the rule: an older write that overwrites the cloud is put right by a device that holds the newer one', async () => {
  const { rig, A, B } = await pair({ rule: false }, { skew: -3600000, knowsServerTime: false });
  rig.cloud.time += 1000; A.S.settings.newPerDay = 7; A.save(); sy.syFlush(A.E); while (A.conn.send()); await tick();
  B.S.settings.newPerDay = 5; B.save(); sy.syFlush(B.E); await tick(); while (B.conn.send());
  assert.equal(JSON.parse(rig.rec('s~newPerDay').j), 5, 'the dumb server took the older write');
  await rig.settle();
  assert.equal(JSON.parse(rig.rec('s~newPerDay').j), 7);
  assert.equal(A.S.settings.newPerDay, 7); assert.equal(B.S.settings.newPerDay, 7);
});

test('a write the database refuses for good is parked: it does not block the rest', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const commit = rig.cloud.commit.bind(rig.cloud);
  rig.cloud.commit = (from, base, map) => ('rec/s~cursed' in map ? new Error('PERMISSION_DENIED: Permission denied') : commit(from, base, map));
  rig.cloud.time += 1000; A.S.settings.cursed = 1; A.S.settings.fine = 2; A.S.settings.alsoFine = 3; A.save();
  await rig.settle();
  assert.equal(B.S.settings.fine, 2); assert.equal(B.S.settings.alsoFine, 3); assert.equal('cursed' in B.S.settings, false);
  assert.deepEqual(Object.keys(A.E.park), ['s~cursed']);
  assert.equal(sy.syStatus(A.E).state, 'error');
});

test('a full disk: the shadow is dropped rather than left stale, and the next start merges again without losing anything', async () => {
  const rig = makeRig({ rng: rng32(12) });
  const base = baseDeck(rig);
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base), { cap: 2000 });
  rig.start(A); rig.start(B); await rig.settle();
  assert.equal(B.store.getItem(sy.SY_STORE), null); assert.equal(B.E.err, 'store');
  const ids = started(B.S), day = dayOf(rig.cloud.time), before = total(B.S, day);
  rig.cloud.time += 1000; review(B, ids[0]); review(A, ids[1]); await rig.settle();
  assert.equal(total(A.S, day), before + 2, 'it still syncs while the page is open');
  B.conn.setOnline(false); rig.cloud.time += 1000; review(B, ids[2]); const mine = clone(B.S.cards[ids[2]]);
  rig.reload(B); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(A.S.cards[ids[2]], mine);
  assert.equal(total(A.S, day), before + 3); assert.equal(total(B.S, day), before + 3);
  same(A.S, B.S);
});

test('the app could not store S after the engine changed it: the shadow is dropped, and the old values are not sent out as new', async () => {
  const { rig, A, B } = await pair();
  const cid = started(A.S)[2], onDisk = clone(B.S);
  rig.cloud.time += 1000; review(A, cid); A.S.settings.newPerDay = 19; A.save();
  B.cannotStore = true;
  await rig.settle();
  assert.equal(B.S.settings.newPerDay, 19, 'in memory B has it');
  assert.equal(B.store.getItem(sy.SY_STORE), null);
  /* the page is reloaded: what comes back is the S that was on disk, without A's changes */
  B.cannotStore = false; B.S = onDisk; rig.cloud.time += 60000;
  rig.reload(B); await rig.settle();
  assert.equal(A.S.settings.newPerDay, 19); assert.equal(B.S.settings.newPerDay, 19);
  assert.deepEqual(B.S.cards[cid], A.S.cards[cid]);
  same(A.S, B.S);
});

test('a cloud written by a newer version of the format: this version stops and writes nothing', async () => {
  const rig = makeRig({ rng: rng32(13) });
  rig.cloud.node('users/u1').meta = { v: sy.SY_V + 1 };
  const A = rig.device('devaaaa1', baseDeck(rig)); rig.start(A); await rig.settle();
  assert.equal(sy.syStatus(A.E).state, 'newer');
  assert.equal(Object.keys(rig.recs()).length, 0); assert.equal(rig.cloud.writes, 0);
});

test('a broken record in the cloud is skipped; the others are applied', () => {
  const now = 1800000000000, S = emptyState();
  const E = sy.syCreate({ state: () => S, store: memStore(), node: 'n1', now: () => now, day: dayOf, timers: false });
  E.joined = 1;
  const h = sy.syStamp(now, 0, 'other111');
  const res = sy.syApply(E, S, [['c~w1:rec', { h, m: 1, j: '{not json' }], ['c~w2:rec', { h: 'short', m: 1, j: '""' }], ['zz~new', { h, m: 1, j: '1' }], ['nokind', { h, m: 1, j: '1' }],
    ['c~__proto__', { h, m: 1, j: '""' }], ['c~w3:rec', null], ['s~userName', { h, m: 1, j: '"Mei"' }], ['c~w4:rec', { h, m: 1, j: '""' }]]);
  assert.equal(res.n, 2); assert.equal(res.bad, 5); assert.equal(res.unknown, 1);
  assert.equal(S.settings.userName, 'Mei'); assert.deepEqual(S.cards, { 'w4:rec': {} });
  assert.equal(({}).polluted, undefined);
});

/* ---------------- the Firebase adapter ---------------- */

test('syFirebase: the adapter drives an SDK with the modular signatures', async () => {
  const rig = makeRig({ rng: rng32(14), dup: 0 });
  /* the modular SDK's functions, over the in-memory cloud */
  const sdk = conn => {
    const subs = [];
    return {
      db: {}, ref: (db, p) => ({ path: p }), update: (ref, map) => conn.update(ref.path, map), get: ref => conn.get(ref.path).then(v => ({ val: () => v })),
      orderByChild: n => ({ ob: n }), startAt: v => ({ sa: v }), query: (ref, ...c) => ({ path: ref.path, ob: (c.find(x => x.ob) || {}).ob, sa: (c.find(x => 'sa' in x) || {}).sa }),
      onChildAdded: (q, cb) => sub(q, 'added', cb), onChildChanged: (q, cb) => sub(q, 'changed', cb),
      onValue: (q, cb, err, o) => { if (q.path === '.info/serverTimeOffset') { cb({ val: () => 0 }); return () => {}; } assert.equal(o && o.onlyOnce, true); return sub(q, 'value', cb); }
    };
    function sub(q, kind, cb) {
      let s = subs.find(x => x.path === q.path && x.sa === q.sa);
      if (!s) {
        s = { path: q.path, sa: q.sa, cbs: { added: [], changed: [], value: [] }, seen: {} }; subs.push(s);
        assert.equal(q.ob, 'm');
        s.off = conn.listen(q.path, { orderBy: q.ob, startAt: q.sa == null ? null : q.sa },
          (k, v) => { const first = !s.seen[k]; s.seen[k] = 1; for (const f of s.cbs[first ? 'added' : 'changed']) f({ key: k, val: () => v }); },
          () => { for (const f of s.cbs.value.splice(0)) f({}); });
      }
      s.cbs[kind].push(cb);
      return () => { const i = s.cbs[kind].indexOf(cb); if (i > -1) s.cbs[kind].splice(i, 1); };
    }
  };
  const base = baseDeck(rig), A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2');
  for (const d of [A, B]) { d.E.env.adapter = sy.syFirebase(sdk(d.conn)); rig.start(d); await rig.settle(); }
  same(B.S, base);
  rig.cloud.time += 1000; review(B, started(B.S)[0]); await rig.settle();
  same(A.S, B.S);
  assert.equal(typeof d0(A).serverNow(), 'number');
  function d0(d) { return d.E.env.adapter; }
});

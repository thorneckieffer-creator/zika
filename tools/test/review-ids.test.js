/* REVIEW: ids — a device id on two devices, My-words ids handed out twice, keys the database will not take. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRig, emptyState, normal, firstDiff, sy, clone, dayOf, memStore } = require('./helpers/rig.js');
const { rng32 } = require('./helpers/cloud.js');
const { makeDeck, DAYMS } = require('./helpers/deck.js');

function review(d, cid) {
  const S = d.S, now = d.now(), day = dayOf(now);
  S.log[day] = S.log[day] || { rev: 0, new: 0 };
  const c = S.cards[cid];
  if (!c || c.st === undefined) { S.cards[cid] = { st: 'learn', S: 0.5, D: 5, due: now + 60000, last: now, reps: 1, lapses: 0, days: 0 }; S.log[day].new++; }
  else { c.reps++; c.last = now; c.S = c.S * 1.7 + 0.1; c.st = 'rev'; c.due = now + DAYMS; S.log[day].rev++; }
  d.save();
}
const total = (S, day) => { const e = S.log[day] || {}; return (e.rev || 0) + (e.new || 0); };
const started = S => Object.keys(S.cards).filter(k => S.cards[k].st !== undefined);
const deck = rig => { const S = makeDeck({ rng: rng32(5), now: rig.cloud.time, words: 30, grammar: 4, days: 10, my: 3 }); S.hard = ['w1', 'w2', 'w3']; S.pick = ['w28', 'w29']; return S; };

/* DEVICE.id lives in localStorage (index.html:3323). A phone set up from a backup of another, a migrated Mac profile,
   a copied browser profile: two devices, one id, one stored shadow to start from. */
async function clones() {
  const rig = makeRig({ dup: 0.2, rng: rng32(11), rule: true });
  const base = deck(rig);
  const A = rig.device('devaaaa1', clone(base)), X = rig.device('devxxxx7', clone(base));
  rig.start(A); rig.start(X); await rig.settle();
  /* the backup: deck, shadow and device id together */
  const store = memStore(); store.setItem(sy.SY_STORE, X.store.getItem(sy.SY_STORE));
  const Y = rig.device('devxxxx7', clone(X.S), { store }); rig.start(Y); await rig.settle();
  return { rig, A, X, Y };
}
test('REVIEW 4: two devices with one device id — reviews made on both the same day are not added', async () => {
  const { rig, A, X, Y } = await clones();
  const ids = started(A.S), day = dayOf(rig.cloud.time), before = total(A.S, day);
  X.conn.setOnline(false); Y.conn.setOnline(false); rig.cloud.time += 60000;
  for (let i = 0; i < 5; i++) { rig.cloud.time += 1000; review(X, ids[i]); }
  for (let i = 5; i < 8; i++) { rig.cloud.time += 1000; review(Y, ids[i]); }
  X.conn.setOnline(true); Y.conn.setOnline(true); await rig.settle();
  assert.deepEqual([total(A.S, day), total(X.S, day), total(Y.S, day)].map(n => n - before), [8, 8, 8], '8 reviews were made today (A, X, Y show)');
});
test('REVIEW 4b: two devices with one device id — the same stamp for two different values, and the devices never agree again', async () => {
  const { rig, A, X, Y } = await clones();
  /* both are restarted with a change the engine was not attached for (signed out, or the save in the first second
     before sign-in completes): soft stamps are "the old stamp + 1" + the device id — the same on both */
  X.S.settings.newPerDay = 11; Y.S.settings.newPerDay = 22;
  rig.cloud.time += 60000; rig.reload(X); rig.reload(Y); await rig.settle();
  rig.cloud.time += 60000; for (const d of [A, X, Y]) rig.reload(d); await rig.settle();
  assert.deepEqual([rig.pending(X).length, rig.pending(Y).length], [0, 0], 'nothing is pending anywhere');
  assert.equal(X.E.sh['s~newPerDay'].slice(12), Y.E.sh['s~newPerDay'].slice(12), 'both hold "the same version"');
  assert.equal(X.S.settings.newPerDay, Y.S.settings.newPerDay, 'X has ' + X.S.settings.newPerDay + ', Y has ' + Y.S.settings.newPerDay + ', A has ' + A.S.settings.newPerDay + ' — for good');
});

/* docs/sync.md says of the u<n> collision: "keeps the later word and reports the other in lost". The word and its
   card are two records, each decided on its own. */
test('REVIEW 7: My words u<n> handed out twice — the word that survives carries the other word\'s review history', async () => {
  const rig = makeRig({ dup: 0.2, rng: rng32(11), rule: true });
  const base = deck(rig);
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base));
  rig.start(A); rig.start(B); await rig.settle();
  const n = A.S.my.n, id = 'u' + n, cid = id + ':rec';
  A.conn.setOnline(false); B.conn.setOnline(false);
  const card = (now, reps) => ({ st: 'rev', S: reps * 3, D: 5, due: now + reps * DAYMS, last: now, reps, lapses: 0, days: reps });
  /* Monday, the phone: 貓 is added. Tuesday, the iPad: 狗 is added. Wednesday the phone studies 貓 for the fourth time. */
  rig.cloud.time += DAYMS; A.S.my.w[id] = { t: '貓', p: 'māo', m: 'cat', at: A.now() }; A.S.my.c[cid] = {}; A.S.my.n = n + 1; A.save();
  rig.cloud.time += DAYMS; B.S.my.w[id] = { t: '狗', p: 'gǒu', m: 'dog', at: B.now() }; B.S.my.c[cid] = card(B.now(), 1); B.S.my.n = n + 1; B.save();
  rig.cloud.time += DAYMS; A.S.my.c[cid] = card(A.now(), 4); A.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.equal(firstDiff(normal(A.S), normal(B.S)), null, 'the devices agree');
  const w = A.S.my.w[id], c = A.S.my.c[cid];
  assert.ok(!(w.t === '狗' && c.reps === 4), 'everywhere: ' + id + ' is ' + w.t + ' (studied once) with the schedule of 貓 (reps ' + c.reps + ', due in ' + Math.round((c.due - rig.cloud.time) / DAYMS) + ' days); 貓 is gone from the phone that added it');
});
/* the same before the first sync by record: no `lost`, no trace */
test('REVIEW 7b: two decks that each hold their own u<n> meet at the first sync — one word is dropped without a word', async () => {
  const rig = makeRig({ rng: rng32(6) });
  const a = deck(rig), b = clone(a), id = 'u' + a.my.n;
  a.my.w[id] = { t: '貓', p: 'māo', m: 'cat', at: 1 }; a.my.n++;
  b.my.w[id] = { t: '狗', p: 'gǒu', m: 'dog', at: 2 }; b.my.n++;
  const A = rig.device('devaaaa1', a), B = rig.device('devbbbb2', b);
  rig.start(A); await rig.settle(); rig.start(B); await rig.settle();
  const words = Object.values(B.S.my.w).map(w => w.t);
  assert.ok(words.includes('狗'), 'B added 狗 before its first sync; after it B holds ' + JSON.stringify(words.slice(-2)) + ' and was told lost=' + JSON.stringify(B.lost));
});

/* The 500-character limit is in UTF-16 units; the database's is 768 bytes of UTF-8. And an adapter that throws
   (the SDK validates keys and sizes synchronously inside update()) is not a rejected promise. */
test('REVIEW 6: one key the database will not take stops the whole queue, with status "syncing"', async () => {
  const rig = makeRig({ rng: rng32(6), rule: true });
  const A = rig.device('devaaaa1', deck(rig)), B = rig.device('devbbbb2', deck(rig));
  rig.start(A); rig.start(B); await rig.settle();
  const up = A.conn.update.bind(A.conn);
  const bytes = s => Buffer.byteLength(s, 'utf8');
  A.conn.update = (base, map) => { for (const p in map) if (bytes(p.slice(4)) > 768) throw new Error('update failed: path specified exceeds the maximum length that can be written (768 bytes)'); return up(base, map); };
  rig.cloud.time += 60000;
  A.S.us = A.S.us || {}; A.S.us['字'.repeat(300)] = [1, 0, 1];      /* 303 characters: under the engine's limit, 903 bytes */
  A.S.settings.newPerDay = 17; A.S.cards[started(A.S)[0]].reps += 1; A.save();
  let threw = 0;
  for (let i = 0; i < 20; i++) { try { await rig.settle(); break; } catch (err) { threw++; } }
  assert.equal(B.S.settings.newPerDay, 17, 'B never received the other changes; flush threw ' + threw + ' times; A status: ' + JSON.stringify(sy.syStatus(A.E)));
});

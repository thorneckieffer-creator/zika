/* REVIEW: smaller things. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRig, sy, clone, dayOf } = require('./helpers/rig.js');
const { rng32, memStore } = require('./helpers/cloud.js');
const { makeDeck, DAYMS } = require('./helpers/deck.js');
const deck = rig => makeDeck({ rng: rng32(5), now: rig.cloud.time, words: 30, grammar: 4, days: 10, my: 3 });

/* "the engine must never make up the rest of a container (the app would take it for real)" — it does leave half of
   one. index.html:4710 mtGet() returns S.mtest when it is truthy, and :4713/:4729 read T.order.length. */
test('REVIEW 9: Erase all on one device, a writing-test mark made later on another — S.mtest is left as { res } without the fields the app reads', async () => {
  const rig = makeRig({ rng: rng32(11), rule: true });
  const base = deck(rig);
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base));
  rig.start(A); rig.start(B); await rig.settle();
  A.conn.setOnline(false); B.conn.setOnline(false);
  rig.cloud.time += 60000; A.S = { cards: {}, settings: A.S.settings, log: {}, intro: {}, hist: { d: [], s: [] }, hard: [], pick: [] }; A.save();   /* Reset */
  rig.cloud.time += 60000; B.S.mtest.res.w1 = 'h'; B.S.mtest.res.w2 = 'l'; B.save();
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.ok(!B.S.mtest || Array.isArray(B.S.mtest.order), 'B.S.mtest = ' + JSON.stringify(B.S.mtest) + ' → mtGet().order.length throws in the app');
});

/* The unit test "a full disk: the shadow is dropped rather than left stale" uses a store that refuses the very first
   write, so there never is a stale shadow to drop. Here the disk fills up later, as a disk does. */
test('REVIEW 10 (their test, done properly): the shadow stops fitting after it was stored once — it must not stay behind', async () => {
  const rig = makeRig({ rng: rng32(12) });
  const base = deck(rig);
  const store = memStore(); let full = false; const set = store.setItem; store.setItem = (k, v) => { if (full) throw new Error('QuotaExceededError'); return set(k, v); };
  const B = rig.device('devbbbb2', clone(base), { store }); rig.start(B); await rig.settle();
  assert.ok(store.getItem(sy.SY_STORE));
  full = true; rig.cloud.time += 1000; B.S.settings.newPerDay = 4; B.save();
  assert.equal(store.getItem(sy.SY_STORE), null, 'dropped');
});

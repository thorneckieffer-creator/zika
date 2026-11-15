/* REVIEW: the shadow is gone and the deck is not (sySave removes it itself when a write fails; syTell does when the
   app cannot store S), and the first sync. What the "legacy" merge silently gives up. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRig, emptyState, sy, clone, dayOf } = require('./helpers/rig.js');
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
async function pair(opt, b) {
  const rig = makeRig(Object.assign({ dup: 0.2, rng: rng32(11) }, opt));
  const base = deck(rig);
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base), b);
  rig.start(A); rig.start(B);
  await rig.settle();
  return { rig, A, B, base };
}

test('REVIEW 5: offline edits + a lost shadow — deletions come back, a reset and a suspension are undone, settings and the hard list revert, and nothing is reported', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const ids = started(B.S), gone = ids[0], reset = ids[1], parked = ids[2];
  B.conn.setOnline(false); rig.cloud.time += 60000;
  delete B.S.cards[gone];                                   /* a card removed */
  delete B.S.my.w.u2; delete B.S.my.c['u2:rec'];            /* a My word deleted */
  B.S.cards[reset] = {};                                    /* Triage → Learning: start this card again */
  B.S.cards[parked].susp = 1;                               /* gramSuspend() / a leech parked: `last` does not move */
  B.S.settings.newPerDay = 3;
  B.S.hard = B.S.hard.filter(w => w !== 'w2');
  B.save();
  const want = clone(B.S);
  B.store.removeItem(sy.SY_STORE);                          /* what sySave does when the write fails */
  B.lost.length = 0;
  rig.reload(B); B.conn.setOnline(true); await rig.settle();
  const got = [];
  if (gone in B.S.cards) got.push('deleted card is back');
  if (B.S.my.w.u2) got.push('deleted My word is back');
  if (B.S.cards[reset].st !== undefined) got.push('reset card is studied again');
  if (!B.S.cards[parked].susp) got.push('parked card is live again');
  if (B.S.settings.newPerDay !== 3) got.push('setting reverted to ' + B.S.settings.newPerDay);
  if (B.S.hard.includes('w2')) got.push('hard-list removal undone');
  assert.deepEqual(got, [], 'lost on the device that made the edits (res.lost reported: ' + JSON.stringify(B.lost) + ')');
});

test('REVIEW 5b: two devices lose their shadows on a day both studied offline — the smaller count disappears (not only "on the first sync")', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const ids = started(A.S), day = dayOf(rig.cloud.time), before = total(A.S, day);
  A.conn.setOnline(false); B.conn.setOnline(false); rig.cloud.time += 60000;
  for (let i = 0; i < 6; i++) review(A, ids[i]);
  for (let i = 6; i < 10; i++) review(B, ids[i]);
  A.store.removeItem(sy.SY_STORE); B.store.removeItem(sy.SY_STORE);
  rig.reload(A); A.conn.setOnline(true); await rig.settle([A]);
  rig.reload(B); B.conn.setOnline(true); await rig.settle();
  assert.equal(total(A.S, day), total(B.S, day));
  assert.equal(total(A.S, day), before + 10, '10 reviews were made today');
});

/* syWipe empties my.intro and my.log; syMergeLegacy then skips every day older than 119 days (syFrozen) */
test('REVIEW 5c: the first sync deletes this device\'s own My-words day counts older than 119 days', async () => {
  const rig = makeRig({ rng: rng32(4) });
  const S = deck(rig), old = dayOf(rig.cloud.time - 150 * DAYMS), recent = dayOf(rig.cloud.time - 20 * DAYMS);
  S.my.log = { [old]: 12, [recent]: 7 }; S.my.intro = { [old]: 4, [recent]: 2 };
  const A = rig.device('devaaaa1', S); rig.start(A); await rig.settle();
  assert.equal(A.S.my.log[recent], 7);
  assert.equal(A.S.my.log[old], 12, 'my.log[' + old + '] was ' + 12 + ' before the first sync');
});

/* "Safe to repeat": the cards stay erased, the day counts do not. The wiring calls syImport from fbInitial, i.e. at
   every start for as long as the device still has its room code. */
test('REVIEW 5d: Erase all progress, then the import runs again — the erased day counts are back', async () => {
  const rig = makeRig({ rng: rng32(4), rule: true });
  const blob = deck(rig), day = Object.keys(blob.log)[0], n = blob.log[day].rev;
  const A = rig.device('devaaaa1', emptyState()); rig.start(A); await rig.settle();
  sy.syImport(A.E, { json: JSON.stringify(blob) }); await rig.settle();
  assert.equal(A.S.log[day].rev, n);
  rig.cloud.time += 60000;
  A.S = { cards: {}, settings: A.S.settings, log: {}, intro: {}, hist: { d: [], s: [] }, hard: [], pick: [] };   /* index.html:2764, the Reset button */
  A.save(); await rig.settle();
  assert.deepEqual(A.S.log, {});
  rig.cloud.time += 60000; rig.reload(A); await rig.settle();
  sy.syImport(A.E, { json: JSON.stringify(blob) }); await rig.settle();
  assert.equal(Object.keys(A.S.cards).length, 0, 'the cards stay erased');
  assert.deepEqual(A.S.log, {}, 'S.log after the second import has ' + Object.keys(A.S.log).length + ' days again');
});

/* REVIEW: the deck on disk is older than the shadow (or empty) when the page starts.
   The engine cannot tell "S went backwards" from "the learner edited S", and start-up changes get a stamp just
   above the version the shadow knows — so the old deck is sent out and wins on every device. */
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
  return day;
}
const total = (S, day) => { const e = S.log[day] || {}; return (e.rev || 0) + (e.new || 0); };
const started = S => Object.keys(S.cards).filter(k => S.cards[k].st !== undefined);
async function pair(opt) {
  const rig = makeRig(Object.assign({ dup: 0.2, rng: rng32(11) }, opt));
  const base = makeDeck({ rng: rng32(5), now: rig.cloud.time, words: 30, grammar: 4, days: 10, my: 3 });
  base.hard = ['w1', 'w2', 'w3']; base.pick = ['w28', 'w29', 'w30'];
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base));
  rig.start(A); rig.start(B);
  await rig.settle();
  return { rig, A, B, base };
}

/* index.html:1021  function save(){try{store.setItem(KEY,JSON.stringify(S))}catch(e){}}  — a failed write is silent.
   syOnSave runs after it and stores the shadow (a smaller item, and one that is being replaced by one of the same
   size: it fits when the deck no longer does). */
for (const rule of [false, true]) test('REVIEW 1: the deck write failed, the shadow write did not — after a reload the old deck takes the reviews back on every device (rule: ' + rule + ')', async () => {
  const { rig, A, B } = await pair({ rule });
  const ids = started(B.S).slice(0, 5), day = dayOf(rig.cloud.time), before = total(B.S, day);
  const onDisk = clone(B.S);                                   /* the last deck that reached the disk */
  rig.cloud.time += 60000;
  for (const cid of ids) { rig.cloud.time += 5000; review(B, cid); }      /* S in memory, shadow on disk, records to the cloud */
  await rig.settle();
  const reviewed = clone(ids.map(c => B.S.cards[c]));
  assert.deepEqual(ids.map(c => A.S.cards[c]), reviewed, 'A received the five reviews');
  assert.equal(total(A.S, day), before + 5);

  B.S = clone(onDisk); rig.cloud.time += 10 * 60000;           /* the page is reloaded: the deck is the old one, the shadow is not */
  rig.reload(B); await rig.settle();

  /* what a safe engine does: the cloud holds the reviews, B takes them back. What happens: */
  assert.deepEqual(ids.map(c => A.S.cards[c]), reviewed, 'A LOST the five reviews it had already received');
  assert.equal(total(A.S, day), before + 5, 'and the day count on A went down');
});

/* S fails to load (key missing or unreadable: index.html:982 falls back to the defaults) while zika_sy_v1 is there.
   The old sync has a guard for this (localEmpty() → adopt the cloud). */
test('REVIEW 2: an empty deck with a live shadow deletes the whole account on every device', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const nCards = Object.keys(A.S.cards).length, nMy = Object.keys(A.S.my.w).length;
  assert.ok(nCards > 50);
  B.S = emptyState(); rig.cloud.time += 3600000;
  rig.reload(B); await rig.settle();
  const tomb = Object.values(rig.recs()).filter(r => r.d === 1).length;
  assert.equal(Object.keys(A.S.cards).length, nCards, 'A kept ' + Object.keys(A.S.cards).length + ' of ' + nCards + ' cards; the cloud now holds ' + tomb + ' tombstones');
  assert.equal(Object.keys((A.S.my || {}).w || {}).length, nMy);
});

/* the same with a card whose first reviews never reached the disk: the queued (blank) card replaces the reviewed one */
test('REVIEW 1b: a blank card replaces a reviewed one on every device', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const cid = Object.keys(B.S.cards).find(k => B.S.cards[k].st === undefined);
  const onDisk = clone(B.S);
  for (let i = 0; i < 3; i++) { rig.cloud.time += 600000; review(B, cid); }
  await rig.settle();
  assert.equal(A.S.cards[cid].reps, 3, 'A received the three reviews');
  B.S = clone(onDisk); rig.cloud.time += 600000; rig.reload(B); await rig.settle();
  assert.equal(A.S.cards[cid].reps, 3, 'on A the card is now ' + JSON.stringify(A.S.cards[cid]));
});

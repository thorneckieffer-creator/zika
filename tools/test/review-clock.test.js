/* REVIEW: clocks. */
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
const started = S => Object.keys(S.cards).filter(k => S.cards[k].st !== undefined);
const deck = rig => makeDeck({ rng: rng32(5), now: rig.cloud.time, words: 30, grammar: 4, days: 10, my: 3 });
async function pair(opt, b) {
  const rig = makeRig(Object.assign({ dup: 0.2, rng: rng32(11) }, opt));
  const base = deck(rig);
  const A = rig.device('devaaaa1', clone(base)), B = rig.device('devbbbb2', clone(base), b);
  rig.start(A); rig.start(B);
  await rig.settle();
  return { rig, A, B, base };
}

/* The device clock is wrong once (set ahead by hand, a dead RTC battery, a bad time zone fix), one save happens,
   and the clock is put right. E.hw never comes back down — not at the next catch-up, where the server's time is
   learned, not ever — so every stamp this device makes for the next 400 days is 400 days ahead. */
test('REVIEW 3: one save with the clock ahead poisons the device for good — afterwards its earlier review beats another device\'s later one', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const ids = started(A.S), x1 = ids[0], x2 = ids[1];
  B.conn.setOnline(false);
  B.skew = 400 * DAYMS; rig.cloud.time += 60000; review(B, x1);            /* one review with the clock a year ahead */
  B.skew = 0;                                                               /* the clock is put right */
  rig.cloud.time += 3600000; rig.reload(B); B.conn.setOnline(true); await rig.settle();
  assert.equal(B.E.off, 0, 'B knows the server time exactly');
  const ahead = Math.round((B.E.hw - rig.cloud.time) / DAYMS);

  /* weeks later, clocks right on both: the same card is reviewed on both while they cannot see each other */
  rig.cloud.time += 20 * DAYMS;
  A.conn.setOnline(false); B.conn.setOnline(false);
  review(B, x2);                                      /* B at 09:00 */
  rig.cloud.time += 12 * 3600000;
  review(A, x2); const later = clone(A.S.cards[x2]);  /* A at 21:00 */
  A.conn.setOnline(true); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(B.S.cards[x2], A.S.cards[x2], 'they agree');
  assert.deepEqual(A.S.cards[x2], later, 'the review made 12 hours LATER lost; B\'s clock (E.hw) is still ' + ahead + ' days ahead although its device clock and server offset are right');
});

/* The same without any excursion: a device whose clock is simply wrong when it first joins. syReady calls syJoin
   (which stamps) and only afterwards learns the server's time (lines 828 → 838). */
test('REVIEW 3b: a device whose clock is ahead at its first sync stamps with the raw clock before it learns the server time, and stays ahead', async () => {
  const rig = makeRig({ rng: rng32(3), rule: true });
  const base = deck(rig), day = dayOf(rig.cloud.time);
  const A = rig.device('devaaaa1', clone(base)); rig.start(A); await rig.settle();
  const mine = clone(base); mine.log[day] = { rev: 500, new: 3 };          /* B studied more today before joining: one counter to contribute */
  const B = rig.device('devbbbb2', mine, { skew: 400 * DAYMS }); rig.start(B); await rig.settle();
  assert.equal(B.E.off, -400 * DAYMS, 'B learned that its clock is 400 days ahead');
  assert.ok(B.E.hw <= rig.cloud.time + sy.SY_DRIFT, 'B.E.hw is ' + Math.round((B.E.hw - rig.cloud.time) / DAYMS) + ' days ahead of the server after the first sync');
});

/* A stamp at the top of the range (any client of the account can write one; so can a corrupt `last`) can never be
   beaten: syAfter overflows the counter, bumps the wall part, syStamp clamps it back, and the "later" stamp is lower. */
test('REVIEW 3c: a record stamped at the top of the range can never be edited again', async () => {
  const { rig, A, B } = await pair({ rule: true });
  const max = sy.syStamp(sy.SY_WMAX === undefined ? 101559956668415 : 101559956668415, 46655, 'devzzzz9');
  sy.syApply(A.E, A.S, [['s~newPerDay', { h: max, m: 1, j: '3' }]]);
  assert.equal(A.S.settings.newPerDay, 3);
  rig.cloud.node('users/u1').rec['s~newPerDay'] = { h: max, m: rig.cloud.time, j: '3' };
  rig.cloud.time += 60000; A.S.settings.newPerDay = 25; A.save();
  const st = A.E.sh['s~newPerDay'].slice(12);
  assert.ok(st > max, 'the stamp of the edit (' + st + ') is not above the stamp it was made on (' + max + ')');
});

/* sySoft takes a card's `last` raw: Date.now() of the device that reviewed, never corrected by the server offset the
   engine knows. Every "by the time of its last review" merge (first sync, a lost shadow, the import) therefore
   compares one device's wall clock with server-corrected stamps. */
test('REVIEW 3d: a slow clock + a lost shadow — the later review loses to an earlier one', async () => {
  const { rig, A, B } = await pair({ rule: true }, { skew: -3 * 3600000 });      /* B's clock is 3 hours slow; it knows (E.off) */
  assert.equal(B.E.off, 3 * 3600000);
  const x = started(A.S)[0];
  B.conn.setOnline(false);
  rig.cloud.time += 3600000; review(A, x); await rig.settle([A]);                /* A reviews at 10:00 */
  rig.cloud.time += 3600000; review(B, x); const later = clone(B.S.cards[x]);    /* B reviews at 11:00, offline */
  B.store.removeItem(sy.SY_STORE);                                               /* the shadow is lost (sySave drops it itself when the disk is full) */
  rig.reload(B); B.conn.setOnline(true); await rig.settle();
  assert.deepEqual(A.S.cards[x], later, 'the 11:00 review was dropped for the 10:00 one');
});

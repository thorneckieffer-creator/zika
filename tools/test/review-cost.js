/* REVIEW: measurements, not a test.   node tools/test/review-cost.js */
'use strict';
const { makeRig, sy, clone, dayOf } = require('./helpers/rig.js');
const { rng32, memStore } = require('./helpers/cloud.js');
const { makeDeck, DAYMS } = require('./helpers/deck.js');
const KB = n => Math.round(n / 1024) + ' KB';
(async () => {
  const rig = makeRig({ rng: rng32(1), rule: true, dup: 0 });
  const deck = makeDeck({ rng: rng32(2), now: rig.cloud.time, words: 1478, grammar: 199, days: 180, my: 150 });
  const sJson = JSON.stringify(deck);
  const snaps = {}; for (const k of ['a', 'b', 'c']) snaps['2027-01-1' + k] = sJson;
  console.log('deck JSON', KB(sJson.length), 'chars; has non-Latin-1 characters:', /[^\x00-\xff]/.test(sJson));
  console.log('zika_snap_v1 with 3 snapshots', KB(JSON.stringify(snaps).length), 'chars; with 1:', KB(JSON.stringify({ a: sJson }).length));
  /* count the shadow writes */
  const store = memStore(); let writes = 0, bytes = 0; const set = store.setItem; store.setItem = (k, v) => { if (k === sy.SY_STORE) { writes++; bytes += v.length; } return set(k, v); };
  const A = rig.device('devaaaa1', clone(deck), { store }); rig.start(A); await rig.settle();
  console.log('records', Object.keys(rig.recs()).length, ' first upload', KB(rig.cloud.up), 'in', rig.cloud.writes, 'updates; shadow', KB(store.getItem(sy.SY_STORE).length));
  const B = rig.device('devbbbb2', clone(deck)); const d0 = B.conn.down; rig.start(B); await rig.settle();
  console.log('second device, same deck: first sync downloads', KB(B.conn.down - d0));
  /* one review, live: shadow writes on the device that makes it */
  const ids = Object.keys(A.S.cards).filter(k => A.S.cards[k].st);
  const one = (d, cid) => { const S = d.S, now = d.now(), day = dayOf(now); S.log[day] = S.log[day] || { rev: 0, new: 0 }; const c = S.cards[cid]; c.reps++; c.last = now; c.S *= 1.7; c.due = now + DAYMS; S.log[day].rev++; d.save(); };
  writes = 0; bytes = 0; rig.cloud.time += 60000;
  for (let i = 0; i < 20; i++) { rig.cloud.time += 8000; one(A, ids[i]); await rig.settle(); }
  console.log('per review on the reviewing device: shadow writes', writes / 20, '=', KB(bytes / 20), 'of localStorage text, beside the deck write of', KB(sJson.length));
  /* a start with a lost shadow */
  rig.cloud.time += 3600000; let d1 = B.conn.down; rig.reload(B); await rig.settle(); d1 = B.conn.down - d1;
  B.store.removeItem(sy.SY_STORE); rig.cloud.time += 3600000; rig.reload(B); let d2 = B.conn.down; await rig.settle(); d2 = B.conn.down - d2;
  console.log('a start with the shadow:', d1, 'B;  a start without it:', KB(d2));
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 20; i++) sy.syDiff(A.E, A.S); console.log('syDiff', Number(process.hrtime.bigint() - t0) / 20e6, 'ms');
  const t1 = process.hrtime.bigint(); for (let i = 0; i < 20; i++) JSON.stringify({ sh: A.E.sh, q: A.E.q, ct: A.E.ct, ord: A.E.ord }); console.log('stringify shadow', Number(process.hrtime.bigint() - t1) / 20e6, 'ms');
})();

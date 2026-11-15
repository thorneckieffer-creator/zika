/* REVIEW: two versions of the app on one account (a PWA: every device updates when it next loads the shell).
   "Next" is this engine with one more kind — S.notes gets a kind of its own, `nt` — and the same SY_V, which is
   what the comments in the engine expect ("a kind from a later version: left alone", "any field a later version of
   the app adds before it gets a kind of its own"). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Cloud, rng32, clone, memStore, tick } = require('./helpers/cloud.js');
const { makeDeck, dayOf } = require('./helpers/deck.js');
const v1 = require('../../js/sync-records.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'sync-records.js'), 'utf8');
function patched(name, pairs) {
  let s = SRC;
  for (const [a, b] of pairs) { assert.ok(s.includes(a), 'patch target not found: ' + a); s = s.replace(a, b); }
  const f = path.join(__dirname, name); fs.writeFileSync(f, s);
  delete require.cache[require.resolve(f)];
  return require(f);
}
const next = patched('review-engine-next.generated.js', [
  ['const SY_OWNED = { cards: 1,', 'const SY_OWNED = { notes: 1, cards: 1,'],
  ["syMap('rd', sub('read')),", "syMap('rd', sub('read')), syMap('nt', sub('notes')),"]
]);

function world() {
  const cloud = new Cloud({ rng: rng32(7), rule: true, dup: 0 });
  const dev = (id, S) => { const d = { id, S, store: memStore() }; return d; };
  const boot = (d, sy) => {
    if (d.conn) d.conn.kill();
    d.sy = sy; d.conn = cloud.connect({ online: true }); d.conn.everOnline = true;
    d.E = sy.syCreate({ state: () => d.S, store: d.store, adapter: d.conn, node: d.id, now: () => cloud.time, day: dayOf, timers: false, onChange: () => {} });
    sy.syStart(d.E, { uid: 'u1' });
  };
  const settle = async devs => {
    for (let round = 0; round < 500; round++) {
      let did = false;
      for (const d of devs) {
        if (d.conn.catchUp()) did = true;
        while (d.conn.send()) did = true;
        while (d.conn.deliver()) did = true;
        await tick();
        if (d.sy.syPump(d.E)) did = true;
        d.sy.syFlush(d.E, true); await tick();
        if (d.conn.writes.length) did = true;
      }
      if (!did && devs.every(d => !d.conn.inbox.length && !d.E.inbox.length && !d.E.busy)) return;
    }
    throw new Error('did not settle');
  };
  return { cloud, dev, boot, settle };
}
const deck = cloud => makeDeck({ rng: rng32(5), now: cloud.time, words: 12, grammar: 2, days: 5, my: 2 });

test('REVIEW 8: records of a kind this version does not know are dropped and the cursor moves past them — after the update they are never fetched', async () => {
  const { cloud, dev, boot, settle } = world();
  const base = deck(cloud);
  const mac = dev('devmac01', clone(base)), phone = dev('devphone2', clone(base));
  boot(mac, next); boot(phone, v1); await settle([mac, phone]);
  cloud.time += 3600000;
  mac.S.notes = { n1: 'written on the Mac, which already runs the next version' }; next.syOnSave(mac.E); await settle([mac, phone]);
  assert.ok(cloud.node('users/u1').rec['nt~n1'], 'the note is in the cloud');
  cloud.time += 3600000; boot(phone, v1); await settle([mac, phone]);          /* the phone opens once more on the old shell (cache, slow network) */
  cloud.time += 3600000; boot(phone, next); await settle([mac, phone]);        /* the phone is updated */
  cloud.time += 3600000; boot(phone, next); await settle([mac, phone]);
  assert.deepEqual(phone.S.notes, mac.S.notes, 'the updated phone has no notes, nothing is pending (' + Object.keys(phone.E.q).length + '), and no later start will ask for them');
});

test('REVIEW 8b: a field that gets a kind of its own is deleted, whole, on every device that still runs the old version — and stays missing there after the update', async () => {
  const { cloud, dev, boot, settle } = world();
  const base = deck(cloud); base.notes = { n1: 'one', n2: 'two' };            /* a field added by some version: synced whole as x~notes */
  const mac = dev('devmac01', clone(base)), phone = dev('devphone2', clone(base));
  boot(mac, v1); boot(phone, v1); await settle([mac, phone]);
  assert.ok(cloud.node('users/u1').rec['x~notes'].j);
  cloud.time += 3600000; boot(mac, next); await settle([mac, phone]);          /* the Mac is updated; the phone is open on the old version */
  assert.deepEqual(mac.S.notes, base.notes, 'the Mac still has its notes');
  assert.deepEqual(phone.S.notes, base.notes, 'the phone (old version) had S.notes deleted by a tombstone for x~notes');
});
test('REVIEW 8c: … and after the phone is updated too, its notes are still gone', async () => {
  const { cloud, dev, boot, settle } = world();
  const base = deck(cloud); base.notes = { n1: 'one', n2: 'two' };
  const mac = dev('devmac01', clone(base)), phone = dev('devphone2', clone(base));
  boot(mac, v1); boot(phone, v1); await settle([mac, phone]);
  cloud.time += 3600000; boot(mac, next); await settle([mac, phone]);
  cloud.time += 3600000; boot(phone, v1); await settle([mac, phone]);
  cloud.time += 3600000; boot(phone, next); await settle([mac, phone]);
  cloud.time += 3600000; boot(phone, next); await settle([mac, phone]);
  assert.deepEqual(phone.S.notes, base.notes, 'phone.S.notes is ' + JSON.stringify(phone.S.notes) + ' after the update; the Mac has ' + JSON.stringify(mac.S.notes));
});

/* SY_V is only looked at before the first write of a session (syFlush). Reading is not gated at all. */
test('REVIEW 8d: a cloud marked as a newer format is still read and merged into S; only writing stops', async () => {
  const { cloud, dev, boot, settle } = world();
  const node = cloud.node('users/u1'); node.meta = { v: v1.SY_V + 1 };
  /* in "format 2" a card is, say, an array — this version unpacks whatever it finds */
  node.rec['c~w1:rec'] = { h: v1.syStamp(cloud.time, 0, 'devnew99'), m: cloud.time, j: JSON.stringify(['r', 3.2, 5, cloud.time + 86400000]) };
  const base = deck(cloud), before = clone(base.cards['w1:rec']);
  const phone = dev('devphone2', clone(base)); phone.store.setItem(v1.SY_STORE, JSON.stringify({ v: 1, uid: 'u1', node: 'devphone2', hw: 0, hc: 0, off: 0, cur: 0, joined: 1, sh: { 'c~w1:rec': 'v' + v1.syHash(JSON.stringify(before)) + v1.syStamp(1, 0, 'devphone2') }, q: {}, ct: {}, ord: {}, wait: {} }));
  boot(phone, v1); await settle([phone]);
  assert.deepEqual(phone.S.cards['w1:rec'], before, 'status ' + v1.syStatus(phone.E).state + ', but S.cards[w1:rec] is now ' + JSON.stringify(phone.S.cards['w1:rec']));
});

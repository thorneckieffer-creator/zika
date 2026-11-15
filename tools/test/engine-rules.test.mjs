/* node --test tools/test/engine-rules.test.mjs
   The sync engine (js/sync-records.js, branch users-sync) run against the rules in
   firebase/database.rules.json: does everything it really writes get through, for the owner
   and for an approved device, and does a removed device get stopped?

   The engine is not on this branch. It is taken from the working tree if it is there (after
   the branches are merged), else read out of the users-sync branch with `git show`; if neither
   exists the tests are skipped. Nothing is fetched from the network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeBackend, browser, memStorage, settle } from './fake-firebase.mjs';
import { REC_J_MAX, REC_KEY_MAX } from '../../firebase/build-rules.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fetchFile(rel, dir) {
  const out = join(dir, rel); mkdirSync(join(out, '..'), { recursive: true });
  if (existsSync(join(root, rel))) { writeFileSync(out, readFileSync(join(root, rel))); return 'the working tree'; }
  writeFileSync(out, execFileSync('git', ['show', 'users-sync:' + rel], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }));
  return 'branch users-sync';
}
let sy = null, makeDeck = null, dayOf = null, from = '';
try {
  const dir = mkdtempSync(join(tmpdir(), 'zika-sy-'));
  from = fetchFile('js/sync-records.js', dir); fetchFile('tools/test/helpers/deck.js', dir);
  const require = createRequire(join(dir, 'x.js'));
  sy = require('./js/sync-records.js'); ({ makeDeck, dayOf } = require('./tools/test/helpers/deck.js'));
} catch (e) { /* not available: skip */ }
const skip = sy ? false : 'the sync engine is not on this branch and branch users-sync is not in this clone';

/* the engine's four-function adapter, on top of one fake browser's connection */
function adapter(client, b) {
  return {
    update: (path, map) => { const m = {}; for (const k of Object.keys(map)) m[path + '/' + k] = map[k]; return client.update(m); },
    get: path => client.get(path),
    listen(path, o, onChild, onReady, onErr) {
      const last = {}; let ready = false;
      return client.listen(path, v => {
        v = v || {};
        for (const k of Object.keys(v)) { const s = JSON.stringify(v[k]); if (last[k] === s) continue; last[k] = s; if (!o || o.startAt == null || v[k].m >= o.startAt) onChild(k, v[k]); }
        if (!ready) { ready = true; onReady(); }
      }, e => onErr(e));
    },
    serverNow: () => b.now,
  };
}
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const emptyState = () => ({ cards: {}, settings: { retention: 0.9, newPerDay: 9, maxRev: 200, modes: { rec: true, prod: true } }, log: {}, intro: {}, hist: { d: [], s: [] } });

/* one copy of the app: js/account.js for who it is, the engine for the deck */
async function device(b, name, node, S) {
  const d = { name, S: S || emptyState(), client: b.client(), store: memStorage(), changes: 0, roots: [] };
  d.page = browser({ storage: memStorage() });
  d.page.acOn('root', e => d.roots.push(e.why));
  d.page.acStart(d.client, { deviceName: () => name, now: () => b.now });
  await settle();
  d.E = sy.syCreate({ state: () => d.S, store: d.store, adapter: adapter(d.client, b), node, now: () => b.now, day: dayOf, timers: false, onChange: () => { d.changes++; } });
  d.start = join => sy.syStart(d.E, Object.assign({ uid: d.page.acRoot().slice(6) }, join ? { join } : {}));
  d.status = () => sy.syStatus(d.E);
  return d;
}
async function run(devs) {
  for (let i = 0; i < 400; i++) {
    for (const d of devs) { if (!d.E.live) continue; sy.syPump(d.E); await sy.syFlush(d.E, true); await settle(2); }
    if (devs.every(d => !d.E.live || (!d.E.busy && !d.E.inbox.length && !Object.keys(d.E.q).filter(k => !d.E.park[k]).length && d.E.caught))) return i;
    b_advance(devs);
  }
  throw new Error('the devices did not settle: ' + devs.map(d => JSON.stringify(d.status())).join(' '));
}
let B = null; const b_advance = () => { B.advance(50); };

test('a whole deck goes up through the rules: nothing refused, nothing over a limit', { skip }, async () => {
  const b = B = new FakeBackend();
  const S = makeDeck({ rng: rng(7), now: b.now, words: 500, grammar: 60, days: 150, my: 40, full: true });
  const a = await device(b, 'Mac', 'k3j9x2ab', S);
  assert.equal(a.start(), true);
  await run([a]);
  const st = a.status(), recs = b.read(a.page.acRoot() + '/rec'), keys = Object.keys(recs);
  assert.equal(st.state, 'ok', JSON.stringify(st)); assert.equal(st.pending, 0); assert.equal(st.parked, 0, 'no record was refused three times and set aside');
  assert.ok(keys.length > 1200, keys.length + ' records');
  assert.equal(b.read(a.page.acRoot() + '/meta/v'), sy.SY_V);
  const longestJ = Math.max(...keys.map(k => (recs[k].j || '').length)), longestKey = Math.max(...keys.map(k => k.length)), longestH = Math.max(...keys.map(k => recs[k].h.length));
  assert.ok(longestJ <= REC_J_MAX / 4, 'the largest value, ' + longestJ + ' characters, is well inside the ' + REC_J_MAX + ' the rules allow');
  assert.ok(longestKey <= REC_KEY_MAX / 4, 'the longest key is ' + longestKey);
  assert.ok(longestH < 40, 'the longest stamp is ' + longestH);
  for (const k of keys) assert.match(recs[k].h, /^[0-9a-z]{12}[0-9A-Za-z_-]+$/, k);
  console.log('  engine from ' + from + ': ' + keys.length + ' records, largest value ' + longestJ + ' characters, longest key ' + longestKey + ', ' + b.writes.length + ' writes accepted');
});

test('an approved device pulls the deck, its review reaches the owner, and once removed it is stopped', { skip }, async () => {
  const b = B = new FakeBackend();
  const a = await device(b, 'Mac', 'k3j9x2ab', makeDeck({ rng: rng(11), now: b.now, words: 120, grammar: 12, days: 60, my: 5 }));
  a.start(); await run([a]);
  const n = await device(b, 'iPhone', 'p7q2m4zz');
  const r = await n.page.acJoinStart(); assert.equal((await a.page.acJoinApprove(r.shown)).ok, true); await settle();
  assert.equal(n.page.acRole(), 'member'); assert.equal(n.page.acRoot(), a.page.acRoot());
  assert.equal(n.start('cloud'), true);
  await run([a, n]);
  assert.equal(n.status().state, 'ok', JSON.stringify(n.status())); assert.equal(n.status().parked, 0);
  const started = S => Object.keys(S.cards).filter(k => S.cards[k] && S.cards[k].st).length;
  assert.equal(started(n.S), started(a.S)); assert.ok(started(n.S) > 150, started(n.S) + ' cards arrived on the approved device');

  const id = Object.keys(n.S.cards).find(k => n.S.cards[k].st === 'rev'), before = a.S.cards[id].reps;
  b.advance(60000);
  Object.assign(n.S.cards[id], { reps: before + 1, last: b.now, due: b.now + 5 * 86400000 });
  assert.ok(sy.syOnSave(n.E) > 0);
  await run([a, n]);
  assert.equal(a.S.cards[id].reps, before + 1, 'the review made on the approved device reached the owner');
  assert.equal(n.status().parked, 0);

  assert.equal((await a.page.acRevoke(n.page.acState().uid)).ok, true); await settle();
  b.advance(60000);
  Object.assign(n.S.cards[id], { reps: before + 2, last: b.now });
  sy.syOnSave(n.E);
  for (let i = 0; i < 12; i++) { await sy.syFlush(n.E, true); await settle(2); }
  await run([a]);
  assert.equal(a.S.cards[id].reps, before + 1, 'nothing from the removed device reached the deck');
  assert.match(n.status().err, /permission|denied/i, 'the engine reports the refusal: ' + JSON.stringify(n.status()));
  await n.page.acDenied(); await settle();
  assert.equal(n.page.acRole(), 'guest'); assert.deepEqual(n.roots.slice(-1), ['revoked']);
});

test('what a record over the size limit looks like from the engine: set aside, the rest still goes up', { skip }, async () => {
  /* the same rules with the limit on a value cut to 60 characters, so that a few real records are over it */
  const rules = JSON.parse(readFileSync(new URL('../../firebase/database.rules.json', import.meta.url), 'utf8'));
  const j = rules.rules.users.$uid.rec.$key.j;
  assert.ok(j['.validate'].includes('<= ' + REC_J_MAX)); j['.validate'] = j['.validate'].replace('<= ' + REC_J_MAX, '<= 60');
  const b = B = new FakeBackend({ rules });
  const a = await device(b, 'Mac', 'k3j9x2ab', makeDeck({ rng: rng(5), now: b.now, words: 60, grammar: 8, days: 40, full: true }));
  a.start();
  for (let i = 0; i < 300; i++) { sy.syPump(a.E); await sy.syFlush(a.E, true); await settle(2); b.advance(50); }
  const st = a.status(), recs = b.read(a.page.acRoot() + '/rec');
  assert.ok(st.parked > 0, 'some records were set aside: ' + JSON.stringify(st)); assert.equal(st.state, 'error');
  assert.ok(Object.keys(recs).length > 100, 'and the others arrived: ' + Object.keys(recs).length);
  assert.ok(Object.values(recs).every(r => !r.j || r.j.length <= 60));
});

test('the move out of a sync room, with the engine\'s own import: the deck arrives, the room is untouched, twice is once', { skip }, async () => {
  const b = B = new FakeBackend();
  const S0 = makeDeck({ rng: rng(21), now: b.now, words: 150, grammar: 16, days: 90, my: 10 });
  b.seed('rooms/zika-test01/study_state', { v: 18, json: JSON.stringify(S0), device: 'Mac', device_id: 'abc12345', synced_at: 5000, bytes: JSON.stringify(S0).length });
  const room = JSON.stringify(b.read('rooms'));
  const a = await device(b, 'Mac', 'k3j9x2ab');                        /* a device with nothing on it yet */
  a.start(); await run([a]);
  let calls = 0;
  const importRoom = async rec => { calls++; sy.syImport(a.E, rec); await run([a]); const st = a.status(); return st.state === 'ok' && !st.pending && !st.parked; };
  const r = await a.page.acMigrateRoom({ code: 'zika-test01', importRoom });
  assert.equal(r.ok, true, r.err);
  const started = S => Object.keys(S.cards).filter(k => S.cards[k] && S.cards[k].st).length;
  assert.equal(started(a.S), started(S0)); assert.ok(started(a.S) > 200);
  const tree = b.read(a.page.acRoot());
  assert.ok(Object.keys(tree.rec).filter(k => k.startsWith('c~')).length >= Object.keys(S0.cards).length, 'every card has a record');
  assert.equal(tree.meta.migration.state, 'done'); assert.equal(tree.meta.v, sy.SY_V);
  assert.equal(JSON.stringify(b.read('rooms')), room, 'the room is exactly as it was');
  const w = b.writes.length;
  assert.equal((await a.page.acMigrateRoom({ code: 'zika-test01', importRoom })).skipped, true);
  assert.equal(calls, 1); assert.equal(b.writes.length, w);

  /* a review made after the move, then the room's old blob imported again by hand: the review stands */
  const id = Object.keys(a.S.cards).find(k => a.S.cards[k].st === 'rev'), reps = a.S.cards[id].reps;
  b.advance(3600000); Object.assign(a.S.cards[id], { reps: reps + 1, last: b.now }); sy.syOnSave(a.E); await run([a]);
  sy.syImport(a.E, b.read('rooms/zika-test01/study_state')); await run([a]);
  assert.equal(a.S.cards[id].reps, reps + 1); assert.equal(a.status().parked, 0);
});

test('a second batch with the same stamps is accepted (a lost acknowledgement), an older one is not', { skip }, async () => {
  const b = B = new FakeBackend();
  const a = await device(b, 'Mac', 'k3j9x2ab', makeDeck({ rng: rng(3), now: b.now, words: 30, grammar: 4, days: 20 }));
  a.start(); await run([a]);
  const base = a.page.acRoot(), recs = b.read(base + '/rec'), key = Object.keys(recs).find(k => k.startsWith('c~') && recs[k].j && recs[k].j.length > 10);
  const again = { h: recs[key].h, m: { '.sv': 'timestamp' }, j: recs[key].j };
  b.advance(5000);
  await a.client.update({ [base + '/rec/' + key]: again });
  assert.equal(b.read(base + '/rec/' + key).m, b.now, 'accepted, and m moved to the server\'s clock');
  const older = { h: sy.syStamp(sy.syWall(recs[key].h) - 1, 0, 'k3j9x2ab'), m: { '.sv': 'timestamp' }, j: '""' };
  await assert.rejects(a.client.update({ [base + '/rec/' + key]: older }), /PERMISSION_DENIED/);
});

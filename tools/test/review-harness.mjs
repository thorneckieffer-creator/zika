/* REVIEW harness (not part of the module under review).

   One "copy of the app" = js/account.js (in its own page scope, via their fake-firebase.mjs) + the real sync
   engine from branch users-sync (tools/test/review-fixtures/sync-records.cjs, verbatim `git show
   origin/users-sync:js/sync-records.js`) + the glue docs/multi-user.md prescribes under "Plugging in":
   onRoot, and the hooks flush / stopSync / importRoom / wipeLocal, written exactly as that table words them.

   Each review-*.test.mjs asserts the behaviour a learner needs. A failing test is a reproduced defect. */
import { createRequire } from 'node:module';
import { FakeBackend, browser, memStorage, settle } from './fake-firebase.mjs';

const require = createRequire(import.meta.url);
export const sy = require('./review-fixtures/sync-records.cjs');
export { FakeBackend, browser, memStorage, settle };
export const j = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
export const KEY = 'shida_b1_fsrs_v2';

export const emptyState = () => ({ cards: {}, settings: { retention: 0.9, newPerDay: 9, maxRev: 200, modes: { rec: true, prod: true } }, log: {}, intro: {}, hist: { d: [], s: [] } });
/* a reviewed card, last reviewed `ago` ms before `now` */
export const reviewed = (now, ago, reps) => ({ st: 'rev', S: 12.5, D: 5.5, due: now + 5 * 86400000, last: now - (ago || 3600000), reps: reps || 3, lapses: 0, days: 2 });
export function deckWith(now, ids, extra) {
  const S = emptyState();
  for (const id of ids) S.cards[id] = reviewed(now, 3600000);
  return Object.assign(S, extra || {});
}

/* the engine's adapter over one fake browser connection. ctl.hold = true: nothing arrives (a slow or dropped link) */
function engineAdapter(client, b, ctl) {
  return {
    update: (path, map) => { const m = {}; for (const k of Object.keys(map)) m[path + '/' + k] = map[k]; return client.update(m); },
    get: path => client.get(path),
    listen(path, o, onChild, onReady, onErr) {
      const last = {}; let ready = false, off = false;
      const take = v => {
        if (off) return;
        v = v || {};
        for (const k of Object.keys(v)) { const s = JSON.stringify(v[k]); if (last[k] === s) continue; last[k] = s; if (!o || o.startAt == null || v[k].m >= o.startAt) onChild(k, v[k]); }
        if (!ready) { ready = true; onReady(); }
      };
      const un = client.listen(path, v => { if (ctl.hold) { ctl.held.push(() => take(v)); return; } take(v); }, e => onErr(e));
      return () => { off = true; un(); };
    },
    serverNow: () => b.now,
  };
}

/* o: { S, storage, client, owner, node, reloadOnWipe } */
export async function app(b, name, o) {
  o = o || {};
  const d = { name, b, client: o.client || b.client(), storage: o.storage || memStorage(), events: [], stops: 0, wiped: 0, status: [], ctl: o.ctl || { hold: false, held: [] }, dead: false };
  const stored = d.storage.getItem(KEY);
  d.S = o.S || (stored ? JSON.parse(stored) : emptyState());
  d.saveNow = () => { d.storage.setItem(KEY, JSON.stringify(d.S)); };
  d.save = () => { d.saveNow(); sy.syOnSave(d.E); };
  d.localEmpty = () => !Object.keys(d.S.cards || {}).length && !(d.S.hard || []).length;
  d.saveNow();
  d.E = sy.syCreate({
    state: () => d.S, store: d.storage, adapter: engineAdapter(d.client, b, d.ctl), node: o.node || name.toLowerCase().replace(/[^a-z0-9]/g, '') + 'dev', now: () => b.now, day: dayOf, timers: false,
    onChange: () => { d.saveNow(); },
    onStatus: st => { d.status.push(st.state); if (st.state === 'error' && /permission|denied/i.test(st.err)) d.page && d.page.acDenied(); },
  });
  /* "The device's tree is known or has changed" — docs/multi-user.md, Plugging in */
  d.onRoot = e => {
    d.events.push(j(e));
    if (!e.root) return;
    if (o.usesRoom && o.usesRoom()) return;                  /* "While this device still uses a room: fbStart() and return — the old sync runs as today" */
    const uid = e.root.slice(6);
    if (e.why === 'start') { if (sy.syStart(d.E, { uid }) === false) sy.syStart(d.E, { uid, join: 'merge' }); }
    else if (e.why === 'join' || e.why === 'signin') sy.syStart(d.E, { uid, join: d.localEmpty() ? 'cloud' : 'merge' });
    else if (e.why === 'reset') { sy.syStop(d.E); sy.syReset(d.E); d.storage.removeItem(sy.SY_STORE); sy.syStart(d.E, { uid, join: 'merge' }); }
    else sy.syStart(d.E, { uid, join: 'merge' });            /* leave revoked signout delete */
  };
  d.page = browser({ storage: d.storage });
  d.page.acOn('root', d.onRoot);
  d.page.acStart(d.client, {
    deviceName: () => name, ownerName: () => o.owner || '', now: () => b.now, appUrl: 'https://example.test/app/',
    deckSummary: () => ({ started: Object.values(d.S.cards).filter(c => c && c.st).length }),
    flush: () => sy.syFlush(d.E, true).then(() => !sy.syStatus(d.E).pending),
    stopSync: () => { d.stops++; sy.syStop(d.E); },
    importRoom: r => { sy.syImport(d.E, r); return sy.syFlush(d.E, true).then(() => { const st = sy.syStatus(d.E); return st.state === 'ok' && !st.pending && !st.parked; }); },
    /* "remove the deck from this device — the deck under its storage key, the rolling backups, the engine's
       shadow (SY_STORE), the room code — then reload" */
    wipeLocal: () => { d.wiped++; d.storage.removeItem(KEY); d.storage.removeItem(sy.SY_STORE); d.S = emptyState(); if (o.reloadOnWipe) o.reloadOnWipe(d); },
  });
  d.role = () => d.page.acRole(); d.uid = () => d.page.acState().uid; d.root = () => d.page.acRoot(); d.state = () => j(d.page.acState());
  await settle();
  return d;
}
/* the app is closed and opened again on the same device: same storage, same sign-in, new page, new engine */
export async function reopen(d, o) {
  try { d.page.acStop(); } catch (e) {}
  try { sy.syStop(d.E); } catch (e) {}
  return app(d.b, d.name, Object.assign({ storage: d.storage, client: d.client, S: undefined }, o || {}));
}
/* let the engines pump and flush; never throws (a held link simply does not finish) */
export async function run(devs, rounds) {
  for (let i = 0; i < (rounds || 25); i++) {
    for (const d of devs) { if (!d.E.live) continue; sy.syPump(d.E); try { await sy.syFlush(d.E, true); } catch (e) {} await settle(2); }
    devs[0].b.advance(50);
  }
}
export const recs = (b, uid) => b.read('users/' + uid + '/rec') || {};
export const hasRec = (b, uid, key) => !!(b.read('users/' + uid + '/rec') || {})[key];
/* every tree in the database that holds this record */
export const treesWith = (b, key) => Object.keys(b.read('users') || {}).filter(u => hasRec(b, u, key));
export async function joinDevices(owner, joiner) {
  const r = await joiner.page.acJoinStart(); if (!r.ok) throw new Error(r.err);
  const ok = await owner.page.acJoinApprove(r.shown); if (!ok.ok) throw new Error(ok.err);
  await settle();
  return r.code;
}
/* what real Firebase does to a session whose refresh token was revoked (password changed elsewhere, account
   deleted or disabled, an anonymous user cleaned up): the SDK signs the user out and onAuthStateChanged fires null */
export function endSession(client) { client.cur = null; client.recent = false; client._fire(); }
/* the "reset your password" email, followed by its link: new password, and every other session is revoked */
export function resetPassword(b, email, password, keep) {
  const a = b._byEmail(email); a.password = password;
  return a;
}

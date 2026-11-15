/* REVIEW — dead ends, lockouts and things that silently stop. A failing test is a reproduced defect. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FakeBackend, app, reopen, run, settle, sy, deckWith, reviewed, emptyState, hasRec, recs, joinDevices, endSession, j } from './review-harness.mjs';

const EMAIL = 'lin@example.test', PW = 'correct horse';

/* 13. A deck with no account hangs on the owner's ANONYMOUS sign-in. If that sign-in is lost while the deck on the
       device survives (Firebase's automatic clean-up of anonymous users after 30 days, if ever switched on; auth
       storage lost but localStorage kept; an old cached shell — v62 calls signInAnonymously unconditionally), the
       owner silently becomes a new guest on a new tree. Its approved devices stay on the old tree, which now has
       no owner. Both sides keep studying; nobody is told; no one can ever manage the old tree. */
test('R13 an owner that loses its anonymous sign-in does not silently part from its approved devices', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  const pad = await app(b, 'iPad'); await joinDevices(mac, pad); await run([pad, mac]);
  const old = mac.uid();
  delete b.accounts[old]; endSession(mac.client); await run([mac, pad], 40);
  mac.S.cards['w1:rec'] = reviewed(b.now, 0, 8); mac.save(); await run([mac, pad], 40);
  assert.ok(mac.root() === pad.root() || mac.state().err || pad.role() !== 'member',
    'the Mac now writes to ' + mac.root() + ' (told why=' + mac.events[mac.events.length - 1].why + '), the iPad is still role=' + pad.role() + ' on ' + pad.root() + ', and the Mac\'s new review reached the iPad: ' + (pad.S.cards['w1:rec'].reps === 8));
});

/* 14. Join is not resumable, and "already in" is a dead end. Three ways in. */
async function tryAgain(mac, pad) {            /* what the learner does next: a new code, typed on the owner's device */
  const jr = await pad.page.acJoinStart(); if (!jr.ok) return jr;
  const ap = await mac.page.acJoinApprove(jr.shown); await settle(12); return ap;
}
test('R14a the joiner closes the app before the owner types the code: opening it again finishes the join', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  let pad = await app(b, 'iPad'); const jr = await pad.page.acJoinStart();
  pad.page.acStop(); sy.syStop(pad.E);                     /* iOS suspends or kills the page; nothing is cleaned up */
  assert.equal((await mac.page.acJoinApprove(jr.shown)).ok, true, 'the owner sees "Device added — iPad now uses this deck"');
  pad = await reopen(pad); await run([pad, mac]);
  const first = pad.role(), again = first === 'member' ? { ok: true } : await tryAgain(mac, pad);
  assert.ok(pad.role() === 'member', 'after reopening role=' + first + '; a second code is answered with ' + JSON.stringify({ ok: again.ok, code: again.code, err: again.err }) + '; role is still ' + pad.role());
});
test('R14b one failed read at the moment of approval: the join can be finished', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  const pad = await app(b, 'iPad'); const jr = await pad.page.acJoinStart();
  const real = pad.client.get.bind(pad.client); let once = true;
  pad.client.get = async p => { if (once && /\/devices\//.test(p)) { once = false; throw Object.assign(new Error('Error: Client is offline.'), { code: 'unavailable' }); } return real(p); };
  assert.equal((await mac.page.acJoinApprove(jr.shown)).ok, true); await settle(12);
  const st = pad.state().join, again = pad.role() === 'member' ? { ok: true } : await tryAgain(mac, pad);
  assert.ok(pad.role() === 'member', 'join status=' + (st && st.status) + ' "' + (st && st.err) + '"; a second code is answered with ' + JSON.stringify({ ok: again.ok, code: again.code, err: again.err }));
});
test('R14c one refused read (a bad rules publish, an App Check hiccup) does not end a membership for good', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  let pad = await app(b, 'iPad'); await joinDevices(mac, pad); await run([pad, mac]);
  const real = pad.client.get.bind(pad.client); let once = true;
  pad.client.get = async p => { if (once && /\/devices\//.test(p)) { once = false; throw Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }); } return real(p); };
  await pad.page.acCheckGrant(); await settle(12);          /* what the visibilitychange hook calls */
  pad = await reopen(pad); await run([pad, mac]);           /* the glitch is over; the owner never removed anything */
  const first = pad.role(), again = first === 'member' ? { ok: true } : await tryAgain(mac, pad);
  assert.ok(pad.role() === 'member', 'the owner still lists ' + Object.keys(mac.state().devices).length + ' device, the iPad is role=' + first + ' with its own fork, and a new code is answered with ' + JSON.stringify({ ok: again.ok, code: again.code, err: again.err }));
});

/* 15. acPause() stops the engine; only a 'root' event starts it again (docs: Plugging in). Two paths stop it and
       emit nothing, so syncing is off until the app is next restarted — and nothing says so. */
test('R15a a member that signs in to the owner\'s account keeps syncing', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  const pad = await app(b, 'iPad'); await joinDevices(mac, pad); await run([pad, mac]);
  const n = pad.events.length;
  assert.equal((await pad.page.acSignIn(EMAIL, PW)).ok, true); await run([pad, mac]);
  pad.S.cards['w5:rec'] = reviewed(b.now, 0, 1); pad.save(); await run([pad, mac], 40);
  assert.ok(pad.E.live && hasRec(b, mac.uid(), 'c~w5:rec'), 'engine stopped ' + pad.stops + ' time(s), root events since: ' + (pad.events.length - n) + ', engine running: ' + pad.E.live + ', the new review reached the account: ' + hasRec(b, mac.uid(), 'c~w5:rec'));
});
test('R15b a sign-in that fails at "remove my guest tree" leaves the guest syncing as before', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  const phone = await app(b, 'iPhone', { S: deckWith(b.now, ['w9:rec']) }); await run([phone]);
  const n = phone.events.length;
  b.failWritesAfter = 0;                                   /* the connection drops on that one write */
  const r = await phone.page.acSignIn(EMAIL, PW); await run([phone]);
  assert.equal(r.ok, false); assert.equal(phone.role(), 'guest');
  phone.S.cards['w10:rec'] = reviewed(b.now, 0, 1); phone.save(); await run([phone], 40);
  assert.ok(phone.E.live && hasRec(b, phone.uid(), 'c~w10:rec'), 'acSignIn said "' + r.err + '"; engine stopped ' + phone.stops + ' time(s), root events since: ' + (phone.events.length - n) + ', engine running: ' + phone.E.live + ', the next review was backed up: ' + hasRec(b, phone.uid(), 'c~w10:rec'));
});

/* 16. First launch with no connection (a flashcard app, on the metro). signInAnonymously fails once and is never tried again. */
test('R16 a device that started offline becomes a guest when the connection returns', async () => {
  const b = new FakeBackend(); b.offline = true;
  const d = await app(b, 'iPhone');
  assert.equal(d.role(), 'error');
  b.offline = false; await d.page.acCheckGrant(); d.page.acStart(d.client, {}); await settle(12);      /* online again; the app comes to the front */
  assert.equal(d.role(), 'guest', 'still "' + d.page.acPanelHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() + '"');
});

/* 17. acBoot() in a real page. A top-level function in a classic script IS window.acBoot, so the line
       `window.acBoot = () => acBoot();` replaces the function with an arrow that calls itself. */
test('R17 acBoot() loads the SDK and starts, in a page', () => {
  const src = readFileSync(new URL('../../js/account.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  vm.runInContext('var window = this;', ctx);
  const started = [];
  const sdk = { getApps: () => [], initializeApp: c => ({ options: c }), getAuth: () => ({}), getDatabase: () => ({}), onAuthStateChanged: (a, cb) => { started.push('onAuthStateChanged'); return () => {}; } };
  /* document.head.appendChild(<script type=module>) → the module runs: it sets window.__acSDK and calls window.acBoot() */
  ctx.document = { createElement: () => ({}), getElementById: () => null, head: { appendChild: () => { ctx.__later = () => { ctx.__acSDK = sdk; vm.runInContext('window.acBoot && window.acBoot()', ctx); }; } } };
  vm.runInContext(src, ctx, { filename: 'js/account.js' });
  vm.runInContext('acBoot({ databaseURL: "https://example.test" }, {})', ctx);
  let threw = null; try { ctx.__later(); } catch (e) { threw = e; }
  assert.ok(!threw && started.length === 1, 'the SDK module\'s call to window.acBoot() ' + (threw ? 'threw ' + threw.name + ': ' + threw.message : 'returned') + '; acStart reached the adapter: ' + (started.length === 1));
});

/* 18. An account made with Google has no password. acDeleteMyData asks every account for one. */
test('R18 an account created with Google can delete itself', async () => {
  const b = new FakeBackend(), d = await app(b, 'iPhone', { S: deckWith(b.now, ['w1:rec']) });
  assert.equal((await d.page.acSignInWithIdToken('google', 'tok:sub-1:lin@example.test')).ok, true); assert.equal(d.role(), 'account');
  const tries = [await d.page.acDeleteMyData({}), await d.page.acDeleteMyData({ password: '' }), await d.page.acDeleteMyData({ password: 'anything at all' })];
  assert.ok(tries.some(r => r.ok), 'every attempt was refused: ' + tries.map(r => r.code).join(', ') + ' — and the delete sheet shows this user a password field');
});

/* 19. The move out of a room, wired as the table says. A device that still uses its room does not run the engine
       ("fbStart() and return"), and the engine is started only "on ok". But the importRoom hook needs a running,
       caught-up engine to report success. So the move cannot succeed. */
test('R19 acMigrateRoom succeeds with the documented importRoom hook on a device that still uses its room', async () => {
  const b = new FakeBackend(); let room = true;
  const S = deckWith(b.now, ['w1:rec', 'w2:rec']);
  b.seed('rooms/zika-test01/study_state', { v: 18, json: JSON.stringify(S), device: 'Mac', device_id: 'abc12345', synced_at: 5000, bytes: 10, summary: { cards: 2 } });
  const mac = await app(b, 'Mac', { S, usesRoom: () => room });
  await mac.page.acCreateAccount(EMAIL, PW);
  const r1 = await mac.page.acMigrateRoom({ code: 'zika-test01', local: { at: 5000, dirty: false } }); await run([mac]);
  const r2 = await mac.page.acMigrateRoom({ code: 'zika-test01', local: { at: 5000, dirty: false } }); await run([mac]);
  assert.ok(r1.ok || r2.ok, 'first run: ' + r1.code + ', second run: ' + r2.code + ' ("' + r2.err + '"); marker=' + JSON.stringify(b.read(mac.root() + '/meta/migration/state')) + ', engine state=' + sy.syStatus(mac.E).state);
});

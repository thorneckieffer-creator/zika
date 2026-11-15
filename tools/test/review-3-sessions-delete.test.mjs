/* REVIEW — what real Firebase Auth and the real database SDK do that the fake does not:
   sessions that end on the server, deleted accounts whose tokens live on, writes queued while offline,
   and a wipe hook that (as documented) reloads the page. A failing test is a reproduced defect.
   The fake is extended only inside this file / review-harness.mjs; each extension says what it models. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeBackend, app, reopen, run, settle, sy, deckWith, reviewed, emptyState, hasRec, recs, treesWith, joinDevices, resetPassword, endSession, j, KEY } from './review-harness.mjs';

const EMAIL = 'lin@example.test', PW = 'correct horse';
async function twoSignedIn(b) {
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec', 'w2:rec']) });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  const phone = await app(b, 'iPhone'); await phone.page.acSignIn(EMAIL, PW); await run([phone, mac], 40);
  assert.equal(phone.role(), 'account'); assert.ok(phone.S.cards['w1:rec']);
  return { mac, phone };
}

/* 9. The documented answer to a lost device is "change the password". Firebase then revokes every other session:
      on each of the learner's OTHER devices the SDK signs the user out and onAuthStateChanged fires null.
      acOnUser treats null as "a new device": it signs in anonymously, says why:'start', and the glue uploads the
      whole deck into a new anonymous tree. The learner is told nothing and studies into a fork. */
test('R9 a device whose session was ended by the server does not silently become a guest with a fork of the deck', async () => {
  const b = new FakeBackend(), { mac, phone } = await twoSignedIn(b), acct = mac.uid();
  resetPassword(b, EMAIL, 'a new password'); endSession(phone.client);          /* modelled: refresh token revoked → SDK signs out */
  await run([phone, mac], 40);
  const last = phone.events[phone.events.length - 1], forks = treesWith(b, 'c~w1:rec').filter(u => u !== acct);
  assert.ok(phone.role() !== 'guest' || last.why !== 'start' || phone.state().err,
    'the phone is now role=' + phone.role() + ' (was account), the app was told why=' + last.why + ', err="' + phone.state().err + '", and ' + forks.length + ' new anonymous tree(s) hold a copy of the deck');
});

/* 10. Delete my data. (a) Another signed-in device still holds an ID token for up to an hour; the rules know the
       uid, not that the account is gone, so its next review re-creates users/<uid>, which no one can ever reach or
       delete again. (b) When that token expires the device becomes a guest (as in R9) and uploads the "deleted"
       deck to a new tree. (c) Approved devices do the same at once. "Delete removes the online copy … straight
       away" (acPrivacyHtml) is not what happens. */
test('R10 after "Delete everything" no copy of the deck is online', async () => {
  const b = new FakeBackend(), { mac, phone } = await twoSignedIn(b), acct = mac.uid();
  const pad = await app(b, 'iPad'); await joinDevices(mac, pad); await run([pad, mac, phone], 40);
  const r = await mac.page.acDeleteMyData({ password: PW }); await settle(12);
  assert.equal(r.ok, true); assert.equal(r.signInRemoved, true); assert.equal(b.read('users/' + acct), null, '(the tree is deleted)');

  phone.S.cards['w1:rec'] = reviewed(b.now, 0, 7); phone.save(); await run([phone], 10);      /* (a) one more review within the hour */
  const resurrected = b.read('users/' + acct) !== null;
  endSession(phone.client); await run([phone, pad], 40);                                       /* (b) the token runs out; (c) the member notices */
  const copies = treesWith(b, 'c~w2:rec');
  assert.ok(!resurrected && copies.length === 0,
    'users/<deleted uid> re-created by the other device: ' + resurrected + '; trees holding the deleted deck afterwards: ' + copies.length + ' (phone role=' + phone.role() + ', iPad role=' + pad.role() + ')');
});

/* 11. The wipe hook, as docs/multi-user.md words it, ends with "then reload" (it has to: S is still in memory and
       the next save() would write the deck back). acSignOut, acDeleteMyData and the member's delete all call it
       BEFORE the step that matters. Modelled here: once the hook has reloaded, the old page never gets another turn. */
function reloading() {
  const state = { dead: false };
  return { state, hook: d => { state.dead = true; const never = () => new Promise(() => {}); for (const k of ['signOut', 'deleteUser', 'remove', 'set', 'update', 'get', 'signInAnonymously']) d.client[k] = never; } };
}
function revive(d, proto) { for (const k of ['signOut', 'deleteUser', 'remove', 'set', 'update', 'get', 'signInAnonymously']) delete d.client[k]; }
test('R11a "Sign out and remove it from this device" signs out', async () => {
  const b = new FakeBackend(), rl = reloading();
  let mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']), reloadOnWipe: rl.hook });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  mac.page.acSignOut(); await settle(12);
  revive(mac); mac = await reopen(mac); await run([mac], 30);
  assert.equal(mac.role(), 'guest', 'after the reload the device is still role=' + mac.role() + ' as ' + mac.state().email + ', and the deck is back on it: ' + !!mac.S.cards['w1:rec']);
});
test('R11b "Delete everything" removes the sign-in too', async () => {
  const b = new FakeBackend(), rl = reloading();
  let mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']), reloadOnWipe: rl.hook });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  mac.page.acDeleteMyData({ password: PW }); await settle(12);
  revive(mac); mac = await reopen(mac); await run([mac], 30);
  assert.equal(b._byEmail(EMAIL), undefined, 'the tree is ' + (b.read('users/' + mac.uid()) ? 'there' : 'gone') + ' but the account for ' + EMAIL + ' still exists, signed in on this device (role=' + mac.role() + '); nobody was told');
});
test('R11c "Remove from this device" on a member leaves the deck', async () => {
  const b = new FakeBackend(), rl = reloading();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  let pad = await app(b, 'iPad', { reloadOnWipe: rl.hook }); await joinDevices(mac, pad); await run([pad, mac]);
  pad.page.acDeleteMyData(); await settle(12);
  revive(pad); pad = await reopen(pad); await run([pad, mac], 30);
  assert.ok(pad.role() !== 'member' && !pad.S.cards['w1:rec'], 'after the reload the iPad is still role=' + pad.role() + ' and the deck it was asked to erase is back on it: ' + !!pad.S.cards['w1:rec']);
});

/* 12. The Realtime Database web SDK does not reject a write while offline: it applies it to local listeners at
       once, keeps it in memory, and resolves the promise only when the server answers. Nothing is kept on disk.
       Modelled below for one client. The fake instead rejects at once with 'unavailable', which is the branch
       acRevoke / acLeave / acJoinCleanup were written for. With the SDK's behaviour, removing a (lost) device while
       offline makes it vanish from the list, and closing the app drops the removal. */
function sdkLikeOffline(c, b) {
  const real = { set: c.set.bind(c), update: c.update.bind(c), listen: c.listen.bind(c) }, ls = [], queue = [];
  c.listen = (path, cb, onErr) => { const l = { path, cb }; ls.push(l); const un = real.listen(path, cb, onErr); return () => { ls.splice(ls.indexOf(l), 1); un(); }; };
  const local = map => { for (const l of ls) { let v = b.read(l.path), hit = false; for (const p of Object.keys(map)) if (p.startsWith(l.path + '/')) { hit = true; const k = p.slice(l.path.length + 1).split('/'); if (k.length === 1 && v) { if (map[p] === null) delete v[k[0]]; else v[k[0]] = map[p]; } } if (hit) l.cb(v && Object.keys(v).length ? v : null); } };
  c.update = map => { if (!b.offline) return real.update(map); local(map); return new Promise(() => { queue.push(map); }); };
  c.set = (path, v) => c.update({ [path]: v });
  c.remove = path => c.update({ [path]: null });
  return { queued: () => queue.length };
}
test('R12 a device removed while the owner is offline is either still listed or really removed', async () => {
  const b = new FakeBackend();
  const client = b.client(), q = sdkLikeOffline(client, b);
  let mac = await app(b, 'Mac', { client, S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  const lost = await app(b, 'iPhone'); await joinDevices(mac, lost); await run([lost, mac]);
  assert.equal(Object.keys(mac.state().devices).length, 1);
  b.offline = true;
  let answered = null; mac.page.acRevoke(lost.uid()).then(r => { answered = r; }); await settle(12);
  const listed = Object.keys(mac.state().devices).length, panel = mac.page.acPanelHtml();
  b.offline = false;                                                                 /* the app was closed in between: the queue is gone */
  const onServer = !!b.read('users/' + mac.uid() + '/devices/' + lost.uid());
  let reads = null; try { reads = await lost.client.get(mac.root() + '/rec/c~w1:rec'); } catch (e) {}
  assert.ok(listed === 1 || !onServer, 'the owner\'s panel lists ' + listed + ' devices ("' + (/Only this device uses this deck/.test(panel) ? 'Only this device uses this deck' : '…') + '"), acRevoke answered ' + JSON.stringify(answered) + ', the server still has the entry: ' + onServer + ', and the removed phone still reads the deck: ' + !!reads);
});

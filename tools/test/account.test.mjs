/* node --test tools/test/account.test.mjs
   js/account.js against a fake Firebase that enforces the real rules file (fake-firebase.mjs).
   Each "device" is the script loaded into its own global scope, as a page would load it.

   Not covered here: acFirebaseAdapter and acBoot (they need the real SDK), and the few
   functions that touch the page (acRender, acOpen, the acDo* handlers). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeBackend, browser, memStorage, settle } from './fake-firebase.mjs';

const j = v => JSON.parse(JSON.stringify(v === undefined ? null : v));   /* objects made inside a page have another realm's prototypes */
const MIN = 60 * 1000;

async function device(b, name, o) {
  o = o || {};
  const d = { name, storage: o.storage || memStorage(), client: o.client || b.client(), events: [], wiped: 0, flushed: 0 };
  d.page = browser({ storage: d.storage, globals: o.globals });
  d.page.acOn('root', e => d.events.push(j(e)));
  d.page.acStart(d.client, Object.assign({ deviceName: () => name, ownerName: () => o.owner || '', now: () => b.now, wipeLocal: () => { d.wiped++; }, flush: async () => { d.flushed++; return o.flush === undefined ? true : o.flush; }, appUrl: 'https://example.test/app/' }, o.cfg || {}));
  d.state = () => j(d.page.acState());
  d.uid = () => d.page.acState().uid;
  d.role = () => d.page.acRole();
  d.root = () => d.page.acRoot();
  await settle();
  return d;
}
const card = n => ({ m: n, v: '{"st":"rev"}' });
/* let B in to A's deck, the whole way */
async function join(a, b) {
  const r = await b.page.acJoinStart(); assert.equal(r.ok, true, r.err);
  const ok = await a.page.acJoinApprove(r.shown); assert.equal(ok.ok, true, ok.err);
  await settle();
  return r.code;
}

/* ---------------- starting ---------------- */
test('a new device becomes a guest with a tree of its own', async () => {
  const b = new FakeBackend(), d = await device(b, 'Mac');
  assert.equal(d.role(), 'guest');
  assert.equal(d.root(), 'users/' + d.uid());
  assert.deepEqual(d.events, [{ root: 'users/' + d.uid(), prev: null, why: 'start' }]);
  await d.client.set(d.root() + '/cards/w1:rec', card(1));              /* and the rules let it write there */
  assert.equal(b.read(d.root() + '/cards/w1:rec').m, 1);
});

test('before it has started, and with no connection, nothing is claimed', async () => {
  const p = browser();
  assert.equal(p.acRole(), 'off'); assert.equal(p.acRoot(), null);
  const b = new FakeBackend(); b.offline = true;
  const d = await device(b, 'Mac');
  assert.equal(d.role(), 'error'); assert.equal(d.root(), null);
  assert.match(d.state().err, /connection/i);
});

test('the same browser comes back as the same guest', async () => {
  const b = new FakeBackend(), d = await device(b, 'Mac'), uid = d.uid();
  const again = await device(b, 'Mac', { storage: d.storage, client: d.client });
  assert.equal(again.uid(), uid); assert.equal(again.role(), 'guest');
});

/* ---------------- an account ---------------- */
test('creating an account keeps the uid, so the deck does not move', async () => {
  const b = new FakeBackend(), d = await device(b, 'Mac'), uid = d.uid();
  await d.client.set(d.root() + '/cards/w1:rec', card(1));
  const r = await d.page.acCreateAccount(' lin@example.test ', 'correct horse');
  assert.equal(r.ok, true); assert.equal(r.kept, true);
  assert.equal(d.uid(), uid); assert.equal(d.role(), 'account'); assert.equal(d.state().email, 'lin@example.test');
  assert.equal(b.read('users/' + uid + '/cards/w1:rec').m, 1);
  assert.deepEqual(b.mail, [{ kind: 'verify', to: 'lin@example.test' }]);
  assert.equal(d.events.length, 1, 'the root did not change, so the sync engine is not disturbed');
});

test('creating an account refuses a bad email, a short password, and an email already taken', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), c = await device(b, 'iPad');
  assert.equal((await a.page.acCreateAccount('not an email', 'correct horse')).code, 'auth/invalid-email');
  assert.equal((await a.page.acCreateAccount('lin@example.test', 'short')).code, 'auth/weak-password');
  assert.equal(a.role(), 'guest');
  assert.equal((await a.page.acCreateAccount('lin@example.test', 'correct horse')).ok, true);
  const r = await c.page.acCreateAccount('lin@example.test', 'another password');
  assert.equal(r.code, 'auth/email-already-in-use'); assert.match(r.err, /Sign in instead/);
  assert.equal(c.role(), 'guest');
  assert.equal((await a.page.acCreateAccount('x@example.test', 'correct horse')).code, 'already');
});

test('signing in on a second device moves it to the account and clears its own online copy', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), c = await device(b, 'iPhone');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await a.client.set(a.root() + '/cards/w1:rec', card(5));
  const old = c.uid();
  await c.client.set(c.root() + '/cards/w9:rec', card(2));
  const r = await c.page.acSignIn('lin@example.test', 'correct horse'); await settle();
  assert.equal(r.ok, true, r.err);
  assert.equal(c.uid(), a.uid()); assert.equal(c.role(), 'account'); assert.equal(c.root(), a.root());
  assert.equal(b.read('users/' + old), null, 'the guest tree is gone; the deck itself is still on the device for the sync engine to merge');
  assert.deepEqual(c.events[c.events.length - 1], { root: a.root(), prev: 'users/' + old, why: 'signin' });
  assert.equal((await c.client.get(c.root() + '/cards/w1:rec')).m, 5);
});

test('a wrong password changes nothing at all', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), c = await device(b, 'iPhone');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await c.client.set(c.root() + '/cards/w9:rec', card(2));
  const before = j(b.db.root), uid = c.uid();
  const r = await c.page.acSignIn('lin@example.test', 'wrong password');
  assert.equal(r.ok, false); assert.equal(r.code, 'auth/invalid-credential'); assert.match(r.err, /email or the password/);
  assert.equal(c.uid(), uid); assert.equal(c.role(), 'guest');
  assert.deepEqual(j(b.db.root), before);
  assert.equal((await c.page.acSignIn('nobody@example.test', 'correct horse')).code, 'auth/invalid-credential', 'an unknown email reads the same as a wrong password');
});

test('a deck that other devices use is not abandoned by signing in elsewhere without saying so', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), g = await device(b, 'iPad'), m = await device(b, 'iPhone');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await join(g, m);                                                   /* the iPad's guest deck now has the iPhone on it */
  const r = await g.page.acSignIn('lin@example.test', 'correct horse');
  assert.equal(r.code, 'has-devices'); assert.equal(r.n, 1); assert.equal(g.role(), 'guest');
  const r2 = await g.page.acSignIn('lin@example.test', 'correct horse', { force: true }); await settle();
  assert.equal(r2.ok, true); assert.equal(g.uid(), a.uid());
  await m.page.acDenied(); await settle();
  assert.equal(m.role(), 'guest', 'the iPhone finds its deck gone and falls back to its own');
});

test('signing out leaves the deck in the account and makes the device a fresh guest', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  const acct = a.uid(); await a.client.set(a.root() + '/cards/w1:rec', card(5));
  const r = await a.page.acSignOut(); await settle();
  assert.equal(r.ok, true); assert.equal(a.wiped, 1); assert.equal(a.flushed, 1);
  assert.equal(a.role(), 'guest'); assert.notEqual(a.uid(), acct);
  assert.equal(a.events[a.events.length - 1].why, 'signout');
  assert.equal(b.read('users/' + acct + '/cards/w1:rec').m, 5);
  assert.equal((await a.page.acSignIn('lin@example.test', 'correct horse')).ok, true);
  assert.equal(a.uid(), acct);
});

test('signing out can keep a copy, and will not erase one that has unsent changes', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  assert.equal((await a.page.acSignOut({ keepLocal: true })).ok, true); assert.equal(a.wiped, 0);
  const c = await device(b, 'iPad', { flush: false });
  await c.page.acSignIn('lin@example.test', 'correct horse'); await settle();
  const r = await c.page.acSignOut();
  assert.equal(r.code, 'unsynced'); assert.equal(c.wiped, 0); assert.equal(c.role(), 'account');
  const g = await device(b, 'Web');
  assert.equal((await g.page.acSignOut()).code, 'not-account', 'a guest has nothing to sign out of');
});

test('password reset says the same thing whether or not the address has an account', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), c = await device(b, 'iPad');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  const yes = await c.page.acSendReset('lin@example.test'), no = await c.page.acSendReset('nobody@example.test');
  assert.equal(yes.ok, true); assert.deepEqual(j(yes), j(no));
  assert.equal(b.mail.filter(m => m.kind === 'reset').length, 1);
  assert.equal((await c.page.acSendReset('nonsense')).ok, false);
});

/* ---------------- letting a device in ---------------- */
test('a device is let in with a code: it shows one, the owner types it, and it uses the owner\'s deck', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac', { owner: 'Lin' }), n = await device(b, 'iPhone');
  await a.client.set(a.root() + '/cards/w1:rec', card(5));
  await n.client.set(n.root() + '/cards/w9:rec', card(2));
  const old = n.uid();
  const r = await n.page.acJoinStart();
  assert.equal(r.ok, true); assert.match(r.code, /^[a-z2-9]{8}$/); assert.match(r.shown, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(r.link, 'https://example.test/app/#join=' + r.code);
  assert.equal(n.state().join.status, 'waiting');
  assert.deepEqual(b.read('joins/' + r.code), { uid: old, name: 'iPhone', at: b.now });

  const look = await a.page.acJoinLookup(' ' + r.shown.toLowerCase() + ' ');
  assert.deepEqual(j(look), { ok: true, code: r.code, uid: old, name: 'iPhone' });
  assert.equal(n.role(), 'guest', 'looking is not approving');
  const ok = await a.page.acJoinApprove(r.shown); await settle();
  assert.equal(ok.ok, true);

  assert.equal(n.role(), 'member'); assert.equal(n.root(), a.root()); assert.equal(n.uid(), old, 'it is still itself');
  assert.equal(n.state().ownerName, 'Lin'); assert.equal(n.state().join.status, 'approved');
  assert.deepEqual(n.events[n.events.length - 1], { root: a.root(), prev: 'users/' + old, why: 'join' });
  assert.equal(b.read('joins/' + r.code), null, 'the request is cleared');
  assert.equal(b.read('users/' + old), null, 'its own online copy and pointer are cleared');
  assert.equal((await n.client.get(a.root() + '/cards/w1:rec')).m, 5, 'it reads the deck');
  await n.client.set(a.root() + '/cards/w9:rec', card(7));                                    /* and writes to it */
  const devs = a.state().devices;
  assert.deepEqual(Object.keys(devs), [old]); assert.equal(devs[old].name, 'iPhone'); assert.equal(devs[old].seen, b.now);
  assert.deepEqual(j(n.storage._all), { zika_account: JSON.stringify({ root: a.uid(), ownerName: 'Lin', uid: old }) });
});

test('a member is still a member after the app is closed and opened again', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await join(a, n);
  const again = await device(b, 'iPhone', { storage: n.storage, client: n.client });
  assert.equal(again.role(), 'member'); assert.equal(again.root(), a.root());
  assert.equal(again.events[0].why, 'start');
});

test('a member whose browser lost its sign-in is not mistaken for one', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await join(a, n);
  const again = await device(b, 'iPhone', { storage: n.storage });     /* same storage, new anonymous user */
  assert.equal(again.role(), 'guest'); assert.equal(again.root(), 'users/' + again.uid());
  assert.equal(again.storage._all.zika_account, undefined);
  assert.deepEqual(again.events, [{ root: 'users/' + again.uid(), prev: null, why: 'start' }], 'it never points the sync engine at the old deck, not even for a moment');
});

/* The rules already make these two impossible; the script checks anyway, so that it does not
   lean on a rule staying as it is. With rules that allow everything, the checks are all there is. */
const OPEN = { rules: { '.read': true, '.write': true } };
test('without the rules to lean on: an answer that names a deck which has not let this device in is not followed', async () => {
  const b = new FakeBackend({ rules: OPEN }), n = await device(b, 'iPhone');
  const r = await n.page.acJoinStart();
  b.seed('joins/' + r.code + '/ans', { owner: 'uSomeoneElse', name: 'Mallory' }); b._notify(); await settle();
  assert.equal(n.role(), 'guest'); assert.equal(n.root(), 'users/' + n.uid());
  assert.equal(n.state().join.status, 'error'); assert.equal(n.storage._all.zika_account, undefined);
});
test('without the rules to lean on: a member whose approval is gone still finds out', async () => {
  const b = new FakeBackend({ rules: OPEN }), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await join(a, n); assert.equal(n.role(), 'member');
  b.seed(a.root() + '/devices/' + n.uid(), null);
  assert.equal(await n.page.acCheckGrant(), false);
  assert.equal(n.role(), 'guest'); assert.equal(n.events[n.events.length - 1].why, 'revoked');
});

for (const cancel of [true, false]) {
  test('removing a device stops it at once' + (cancel ? '' : ' (even if the service does not cancel its listeners)'), async () => {
    const b = new FakeBackend({ cancelOnRevoke: cancel }), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
    await join(a, n);
    assert.equal((await a.page.acRevoke(n.uid())).ok, true); await settle();
    await assert.rejects(n.client.set(a.root() + '/cards/w9:rec', card(9)), /PERMISSION_DENIED/);
    await assert.rejects(n.client.get(a.root() + '/cards'), /PERMISSION_DENIED/);
    if (!cancel) { assert.equal(n.role(), 'member', 'it has not noticed yet'); await n.page.acDenied(); await settle(); }
    assert.equal(n.role(), 'guest'); assert.equal(n.root(), 'users/' + n.uid());
    assert.deepEqual(n.events[n.events.length - 1], { root: 'users/' + n.uid(), prev: a.root(), why: 'revoked' });
    assert.equal(n.storage._all.zika_account, undefined);
    assert.deepEqual(a.state().devices, {});
  });
}

test('a member that is merely offline stays a member', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await join(a, n);
  b.offline = true;
  assert.equal(await n.page.acCheckGrant(), true); assert.equal(n.role(), 'member');
  const again = await device(b, 'iPhone', { storage: n.storage, client: n.client });
  assert.equal(again.role(), 'member', 'starting up offline does not throw the membership away');
});

test('a member can leave; what it holds stays its own', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await join(a, n);
  assert.equal((await n.page.acLeave()).ok, true); await settle();
  assert.equal(n.role(), 'guest'); assert.deepEqual(n.events.map(e => e.why), ['start', 'join', 'leave']); assert.equal(n.wiped, 0);
  assert.deepEqual(a.state().devices, {});
  assert.equal((await n.page.acLeave()).code, 'not-member');
});

test('only the owner adds or removes devices', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone'), x = await device(b, 'iPad');
  await join(a, n);
  const r = await x.page.acJoinStart();
  assert.equal((await n.page.acJoinLookup(r.shown)).code, 'not-owner');
  assert.equal((await n.page.acJoinApprove(r.shown)).code, 'not-owner');
  assert.equal((await n.page.acRevoke('whoever')).code, 'not-owner');
  assert.equal((await n.page.acCreateAccount('m@example.test', 'correct horse')).code, 'member');
  assert.equal((await n.page.acJoinStart()).code, 'member');
  assert.equal(x.role(), 'guest');
});

test('codes: mistyped, unknown, one\'s own, used, run out', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone'), x = await device(b, 'iPad');
  assert.equal((await a.page.acJoinLookup('12')).code, 'format');
  assert.equal((await a.page.acJoinLookup('abcd-2345')).code, 'none');
  const r = await n.page.acJoinStart();
  assert.equal((await n.page.acJoinLookup(r.shown)).code, 'self');
  b.advance(11 * MIN);
  const late = await a.page.acJoinApprove(r.shown);
  assert.equal(late.code, 'expired'); assert.match(late.err, /new one/);
  assert.equal(n.role(), 'guest'); assert.deepEqual(a.state().devices, {});
  n.page.acJoinTick(); await settle();
  assert.equal(n.state().join.status, 'expired'); assert.equal(b.read('joins/' + r.code), null); assert.equal(b.read('users/' + n.uid()), null);
  const r2 = await n.page.acJoinStart(); await join(a, x).catch(() => {});
  await a.page.acJoinApprove(r2.shown); await settle();
  assert.equal(n.role(), 'member');
  assert.equal((await a.page.acJoinLookup(r2.shown)).code, 'none', 'a used code is gone');
});

test('asking again withdraws the earlier request, and cancelling clears it', async () => {
  const b = new FakeBackend(), n = await device(b, 'iPhone');
  const r1 = await n.page.acJoinStart(), r2 = await n.page.acJoinStart();
  assert.notEqual(r1.code, r2.code);
  assert.equal(b.read('joins/' + r1.code), null); assert.ok(b.read('joins/' + r2.code));
  assert.equal(b.read('users/' + n.uid() + '/joining'), r2.code);
  await n.page.acJoinCancel(); await settle();
  assert.equal(b.read('joins'), null); assert.equal(b.read('users/' + n.uid()), null); assert.equal(n.state().join, null);
});

test('a request left behind by a crash does not block the next one', async () => {
  const b = new FakeBackend(), n = await device(b, 'iPhone');
  const r1 = await n.page.acJoinStart();
  const again = await device(b, 'iPhone', { storage: n.storage, client: n.client });     /* reloaded: the page has forgotten the request */
  const r2 = await again.page.acJoinStart();
  assert.equal(r2.ok, true, r2.err); assert.equal(b.read('joins/' + r1.code), null);
});

test('a deck with devices on it, or an account, does not join another deck', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone'), c = await device(b, 'iPad');
  await join(a, n);
  assert.equal((await a.page.acJoinStart()).code, 'has-devices');
  await c.page.acCreateAccount('lin@example.test', 'correct horse');
  assert.equal((await c.page.acJoinStart()).code, 'account');
});

test('an account owner can let devices in too, and signing in elsewhere keeps them', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone'), c = await device(b, 'iPad');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await join(a, n);
  await c.page.acSignIn('lin@example.test', 'correct horse'); await settle();
  assert.deepEqual(Object.keys(c.state().devices), [n.uid()], 'the iPad, signed in, sees the iPhone on the deck');
  assert.equal((await c.page.acRevoke(n.uid())).ok, true);
});

test('a member that signs in to the owner\'s account gives up its place as a device', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await join(a, n);
  const r = await n.page.acSignIn('lin@example.test', 'correct horse'); await settle();
  assert.equal(r.ok, true); assert.equal(n.role(), 'account'); assert.equal(n.uid(), a.uid());
  assert.deepEqual(a.state().devices, {}); assert.equal(n.storage._all.zika_account, undefined);
  assert.deepEqual(n.events.map(e => e.why), ['start', 'join'], 'the tree it uses is the same one before and after, so the sync engine hears nothing — and it never stops at a tree of its own on the way');
  assert.equal(n.root(), a.root());
});

/* ---------------- delete, export ---------------- */
test('delete my data, as a guest: the tree, the sign-in and the local copy go', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), uid = a.uid();
  await a.client.set(a.root() + '/cards/w1:rec', card(5));
  await a.page.acJoinStart();
  const r = await a.page.acDeleteMyData(); await settle();
  assert.equal(r.ok, true); assert.equal(r.what, 'deleted'); assert.equal(r.signInRemoved, true);
  assert.equal(b.read('users/' + uid), null); assert.equal(b.read('joins'), null); assert.equal(b.accounts[uid], undefined);
  assert.equal(a.wiped, 1); assert.equal(a.role(), 'guest'); assert.notEqual(a.uid(), uid);
  assert.equal(a.events[a.events.length - 1].why, 'delete');
});

test('delete my data, with an account: the password is asked first, and a wrong one deletes nothing', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await a.client.set(a.root() + '/cards/w1:rec', card(5));
  await join(a, n);
  const uid = a.uid(), before = j(b.db.root);
  assert.equal((await a.page.acDeleteMyData()).code, 'auth/requires-recent-login');
  assert.equal((await a.page.acDeleteMyData({ password: 'wrong' })).code, 'auth/invalid-credential');
  assert.deepEqual(j(b.db.root), before); assert.equal(a.wiped, 0);
  const r = await a.page.acDeleteMyData({ password: 'correct horse' }); await settle();
  assert.equal(r.ok, true); assert.equal(r.devices, 1);
  assert.equal(b.read('users/' + uid), null); assert.equal(b._byEmail('lin@example.test'), undefined);
  assert.equal(a.wiped, 1); assert.equal(a.role(), 'guest');
  await n.page.acDenied(); await settle();
  assert.equal(n.role(), 'guest', 'the other device finds the deck gone and keeps what it holds');
  const c = await device(b, 'iPad');
  assert.equal((await c.page.acSignIn('lin@example.test', 'correct horse')).code, 'auth/invalid-credential', 'the account no longer exists');
});

test('delete, on a member: it leaves and erases its copy; the owner\'s deck is untouched', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await a.client.set(a.root() + '/cards/w1:rec', card(5));
  await join(a, n);
  const r = await n.page.acDeleteMyData(); await settle();
  assert.equal(r.what, 'left'); assert.equal(n.wiped, 1); assert.equal(n.role(), 'guest');
  assert.equal(b.read(a.root() + '/cards/w1:rec').m, 5); assert.deepEqual(a.state().devices, {});
});

test('export gives back everything the service holds for the deck', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  await a.client.set(a.root() + '/cards/w1:rec', card(5));
  await join(a, n);
  const r = await a.page.acExportData();
  assert.equal(r.ok, true); assert.equal(r.data.format, 'zika-account-export'); assert.equal(r.data.email, 'lin@example.test');
  assert.deepEqual(j(r.data.cloud), b.read(a.root()));
  const m = await n.page.acExportData();
  assert.equal(m.data.role, 'member'); assert.deepEqual(j(m.data.cloud.cards), { 'w1:rec': card(5) });
});

/* ---------------- moving a deck out of a sync room ---------------- */
function deck(nCards) {
  const cards = {};
  for (let i = 1; i <= nCards; i++) { cards['w' + i + ':rec'] = { st: 'rev', S: 22.4505154590612, D: 7.391395770627261, due: 1796002276250 + i, last: 1794101476250 + i, reps: 7, lapses: 1, days: 4 }; cards['w' + i + ':prod'] = {}; }
  cards['g:n22-1'] = { st: 'learn', due: 5, last: 3 };
  return {
    cards,
    settings: { retention: 0.9, newPerDay: 20, modes: { rec: true, prod: true }, curLesson: 22, userName: 'Lin', _v38: 1, theme: 'dark', voiceName: 'x', preloadedAt: 5 },
    log: { '2026-11-13': { rev: 25, new: 20 }, '2026-11-14': { rev: 15, new: 20 } },
    hard: ['w3', 'w9'], pick: [], hist: { d: [1, 2, 3], s: [4, 5] }, sib: { 'w1': 5 }, exam: { day: '2026-11-18' },
    my: { n: 3, w: { u1: { t: '珍珠奶茶', p: 'zhēnzhū nǎichá', m: 'bubble tea', at: 1794000000000 } }, c: { 'u1:rec': { st: 'rev', last: 1794000000001 } }, intro: {}, log: {}, perDay: 5, both: true, tp: [{ id: 't1', n: 'Food & drink' }], tn: 1 },
  };
}
const CODE = 'zika-test01';
function seedRoom(b, state, at) {
  b.seed('rooms/' + CODE + '/study_state', { v: 18, json: JSON.stringify(state), device: 'Mac', device_id: 'abc12345', synced_at: at, bytes: JSON.stringify(state).length, summary: { cards: Object.keys(state.cards).length } });
  b.seed('rooms/' + CODE + '/sync_log/-Na', { device: 'Mac', at });
}
const LOCAL = ['voiceName', 'audioSrc', 'theme', 'lastBackup', 'bkName', 'autoBackup', 'haptics', '_bkWarned', 'preloadedAt'];

test('migration: the deck is copied record by record, the room is only read, and running it again does nothing', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac', { cfg: { localSettings: LOCAL } }), state = deck(1000);
  seedRoom(b, state, 5000);
  const room = b.read('rooms'), w0 = b.writes.length;
  const r = await a.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: false } });
  assert.equal(r.ok, true, r.err); assert.equal(r.from, 'room'); assert.equal(r.src_at, 5000);
  assert.equal(r.written, r.records); assert.equal(r.kept, 0);
  const tree = b.read(a.root());
  assert.equal(Object.keys(tree.cards).length, 2001);
  assert.deepEqual(JSON.parse(tree.cards['w7:rec'].v), state.cards['w7:rec']); assert.equal(tree.cards['w7:rec'].m, state.cards['w7:rec'].last);
  assert.deepEqual(tree.cards['w7:prod'], { m: 5000, v: '{}' }, 'a card that is queued but not started still travels');
  assert.equal(JSON.parse(tree.settings.curLesson.v), 22); assert.equal(JSON.parse(tree.settings._v38.v), 1, 'migration flags travel');
  for (const k of ['theme', 'voiceName', 'preloadedAt']) assert.equal(tree.settings[k], undefined, k + ' belongs to the device and stays there');
  assert.deepEqual(JSON.parse(tree.log['2026-11-14'].all.v), { rev: 15, new: 20 });
  assert.deepEqual(JSON.parse(tree.lists.hard.v), ['w3', 'w9']);
  assert.equal(JSON.parse(tree.my.w.u1.v).t, '珍珠奶茶'); assert.equal(JSON.parse(tree.my.s.perDay.v), 5);
  assert.equal(tree.meta.migration.state, 'done'); assert.equal(tree.meta.migration.from, 'room'); assert.equal(tree.meta.migration.records, r.records);
  assert.deepEqual(b.read('rooms'), room, 'the room is exactly as it was');
  assert.ok(b.writes.slice(w0).every(w => w.paths.every(p => p.startsWith('users/' + a.uid() + '/'))), 'every write went under the user\'s own tree');
  assert.ok(!JSON.stringify(b.read('users')).includes(CODE), 'the sync code is not stored anywhere in the tree');

  const w1 = b.writes.length;
  const again = await a.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: false } });
  assert.equal(again.ok, true); assert.equal(again.skipped, true); assert.equal(b.writes.length, w1);
});

test('migration: an interrupted run is finished by the next one, without rewriting what arrived', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac', { cfg: { localSettings: LOCAL } }), state = deck(600);
  seedRoom(b, state, 5000);
  b.failWritesAfter = 3;                                  /* the marker and two chunks land, the third chunk fails */
  const r = await a.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: false } });
  assert.equal(r.ok, false); assert.equal(r.code, 'network');
  assert.equal(b.read(a.root() + '/meta/migration/state'), 'copying');
  const half = Object.keys(b.read(a.root() + '/cards')).length; assert.ok(half > 0 && half < 1201, 'part of the deck arrived: ' + half);
  const r2 = await a.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: false } });
  assert.equal(r2.ok, true, r2.err); assert.ok(r2.kept >= 400, 'kept ' + r2.kept); assert.equal(r2.written + r2.kept, r2.records);
  assert.equal(Object.keys(b.read(a.root() + '/cards')).length, 1201);
  assert.equal(b.read(a.root() + '/meta/migration/state'), 'done');
});

test('migration: a record that is already newer in the tree is left alone', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac', { cfg: { localSettings: LOCAL } }), state = deck(5);
  seedRoom(b, state, 5000);
  const newer = { m: state.cards['w2:rec'].last + 1000, v: '{"st":"rev","reps":8}' };
  await a.client.set(a.root() + '/cards/w2:rec', newer);
  const r = await a.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: false } });
  assert.equal(r.ok, true); assert.equal(r.kept, 1);
  assert.deepEqual(b.read(a.root() + '/cards/w2:rec'), newer);
});

test('migration: it waits for a settled deck, and refuses on a device that uses someone else\'s', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), n = await device(b, 'iPhone'), state = deck(3);
  seedRoom(b, state, 5000);
  assert.equal((await a.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: true } })).code, 'unsynced');
  assert.equal((await a.page.acMigrateRoom({ code: CODE, local: { state, at: 4000, dirty: false } })).code, 'behind');
  assert.equal((await a.page.acMigrateRoom({ code: 'zika-nothing' })).code, 'nothing');
  assert.equal(b.read(a.root()), null, 'nothing was written by the refusals');
  await join(a, n);
  assert.equal((await n.page.acMigrateRoom({ code: CODE, local: { state, at: 5000, dirty: false } })).code, 'not-owner');
  b.seed('rooms/zika-broken/study_state', { json: '{not json', synced_at: 1 });
  assert.equal((await a.page.acMigrateRoom({ code: 'zika-broken' })).code, 'unreadable');
});

test('migration: with no room, the deck on the device is what moves', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), state = deck(2);
  const r = await a.page.acMigrateRoom({ code: '', local: { state, at: 0, dirty: false }, localSettings: LOCAL });
  assert.equal(r.ok, true); assert.equal(r.from, 'local');
  assert.equal(Object.keys(b.read(a.root() + '/cards')).length, 5);
});

test('migration: a part of the deck that is over the size limit stops the move with the marker left at copying', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), state = deck(2);
  state.sib = { big: 'x'.repeat(70000) };
  seedRoom(b, state, 5000);
  const r = await a.page.acMigrateRoom({ code: CODE, localSettings: LOCAL });
  assert.equal(r.ok, false); assert.equal(r.code, 'denied');
  assert.equal(b.read(a.root() + '/meta/migration/state'), 'copying');
});

/* ---------------- Google, by a trip there and back ---------------- */
const token = p => 'h.' + Buffer.from(JSON.stringify(p)).toString('base64url') + '.s';
test('Google: the address to go to, and the checks on what comes back', async () => {
  const b = new FakeBackend(), d = await device(b, 'Mac', { cfg: { googleClientId: 'client-1.apps.example' } });
  const off = await device(b, 'iPad'); assert.equal(off.page.acGoogleUrl(), '', 'not offered without a client id');
  const url = new URL(d.page.acGoogleUrl()), q = url.searchParams, nonce = q.get('nonce');
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(q.get('response_type'), 'id_token'); assert.equal(q.get('client_id'), 'client-1.apps.example');
  assert.equal(q.get('redirect_uri'), 'https://example.test/app/'); assert.equal(q.get('scope'), 'openid email');
  assert.ok(nonce.length >= 24); assert.equal(d.storage._all.zika_ac_nonce, nonce);
  const good = { iss: 'https://accounts.google.com', aud: 'client-1.apps.example', nonce, exp: b.now / 1000 + 600, email: 'lin@example.test' };
  assert.deepEqual(j(d.page.acGoogleToken(token(good))), { ok: true, email: 'lin@example.test' });
  assert.equal(d.page.acGoogleToken(token(good)).code, 'nonce', 'a token is accepted once');
  const fresh = k => { d.storage.setItem('zika_ac_nonce', nonce); return d.page.acGoogleToken(token(Object.assign({}, good, k))).code; };
  assert.equal(fresh({ nonce: 'other' }), 'nonce'); assert.equal(fresh({ aud: 'someone-else' }), 'audience');
  assert.equal(fresh({ iss: 'https://evil.example' }), 'issuer'); assert.equal(fresh({ exp: b.now / 1000 - 1 }), 'expired');
  d.storage.setItem('zika_ac_nonce', nonce); assert.equal(d.page.acGoogleToken('garbage').code, 'unreadable');
});

test('Google: a new identity is attached to the guest; a known one signs the device in', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac'), c = await device(b, 'iPhone'), uid = a.uid();
  const r = await a.page.acSignInWithIdToken('google', 'tok:sub1:lin@example.test');
  assert.equal(r.ok, true); assert.equal(r.linked, true); assert.equal(a.uid(), uid); assert.equal(a.role(), 'account');
  const old = c.uid(); await c.client.set(c.root() + '/cards/w9:rec', card(2));
  const r2 = await c.page.acSignInWithIdToken('google', 'tok:sub1:lin@example.test'); await settle();
  assert.equal(r2.ok, true); assert.equal(r2.linked, false); assert.equal(c.uid(), uid);
  assert.equal(b.read('users/' + old), null); assert.equal(c.events[c.events.length - 1].why, 'signin');
});

/* ---------------- small things ---------------- */
test('codes are 8 symbols without look-alikes, and what is typed is read generously', () => {
  const p = browser(), seen = new Set();
  for (let i = 0; i < 2000; i++) { const c = p.acNewCode(); assert.match(c, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/); seen.add(c); }
  assert.equal(seen.size, 2000);
  assert.equal(p.acNormCode('ABCD-2345'), 'abcd2345'); assert.equal(p.acNormCode(' abcd 2345 '), 'abcd2345');
  assert.equal(p.acNormCode('https://example.test/app/#join=abcd2345'), 'abcd2345');
  for (const bad of ['', 'abcd234', 'abcd23456', 'abcd234!', 'abcd2340', 'abcd2341']) assert.equal(p.acNormCode(bad), '', bad);
  assert.equal(p.acShowCode('abcd2345'), 'ABCD-2345');
  assert.deepEqual(j(p.acFromHash('#join=ABCD-2345')), { join: 'abcd2345' });
  assert.deepEqual(j(p.acFromHash('#id_token=aa.bb.cc&state=1')), { idToken: 'aa.bb.cc' });
  assert.equal(p.acFromHash('#sync=zika-abc123'), null); assert.equal(p.acFromHash('#join=nope'), null);
});

test('the time limit here matches the one in the rules', async () => {
  const { JOIN_TTL } = await import('../../firebase/build-rules.mjs');
  const here = Number(/const AC_JOIN_TTL = ([0-9 *]+);/.exec(readFileSync(new URL('../../js/account.js', import.meta.url), 'utf8'))[1].split('*').reduce((a, x) => a * Number(x), 1));
  assert.equal(here, JOIN_TTL); assert.equal(here, 10 * MIN);
});

/* ---------------- what it looks like ---------------- */
const NO_COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
test('the Account panel says the right thing for a guest, an account, a member and no connection', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac', { owner: 'Lin' }), n = await device(b, 'iPhone <img src=x onerror=alert(1)>');
  assert.match(browser().acPanelHtml(), /Not connected/);
  let h = a.page.acPanelHtml();
  assert.match(h, /^<div class="card" id="acCard"><div class="lab">Account<\/div>/);
  assert.match(h, /No account yet/); assert.match(h, /acOpen\('create'\)/); assert.match(h, /acOpen\('approve'\)/); assert.match(h, /acOpen\('join'\)/); assert.match(h, /Only this device uses this deck/);
  await join(a, n);
  h = a.page.acPanelHtml();
  assert.match(h, /One other device uses this deck/); assert.match(h, /acDoRevoke\(/);
  assert.ok(!h.includes('<img'), 'a device name is escaped'); assert.match(h, /iPhone &lt;img/);
  const m = n.page.acPanelHtml();
  assert.match(m, /This device uses Lin’s deck/); assert.match(m, /acOpen\('leave'\)/); assert.match(m, /Remove from this device/);
  assert.ok(!/acDoRevoke|acOpen\('approve'\)|acOpen\('create'\)/.test(m), 'a member is not offered what only the owner can do');
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  h = a.page.acPanelHtml();
  assert.match(h, /Signed in as lin@example\.test/); assert.match(h, /Not confirmed yet/); assert.match(h, /acOpen\('signout'\)/);
  assert.ok(!/acOpen\('join'\)|No account yet/.test(h));
  for (const html of [h, m, browser().acPanelHtml()]) { assert.ok(!NO_COLOUR.test(html), 'colours come from variables'); assert.ok(!/\b(alert|confirm|prompt)\(/.test(html.replace(/onerror=alert\(1\)/g, ''))); }
});

test('every sheet renders, in the app\'s own pieces, with no colour of its own', async () => {
  const b = new FakeBackend(), a = await device(b, 'Mac', { owner: 'Lin', cfg: { googleClientId: 'cid' } }), n = await device(b, 'iPhone');
  const sheet = (d, kind, extra) => { d.page.AC_.sheet = Object.assign({ kind, step: '', msg: '', bad: false, busy: false }, extra || {}); const h = d.page.acSheetHtml(); d.page.AC_.sheet = null; return h; };
  const all = [];
  for (const kind of ['create', 'signin', 'join', 'approve', 'signout', 'leave', 'delete', 'privacy']) {
    const h = sheet(a, kind); all.push(h);
    assert.match(h, /^<div class="modal-card"><div class="sheet-h"><b>[^<]+<\/b><button class="xbtn" onclick="acClose\(\)" aria-label="close">✕<\/button><\/div>/, kind);
  }
  assert.match(sheet(a, 'create'), /id="acEmail"[\s\S]*id="acPass"[\s\S]*acDoCreate\(\)[\s\S]*Continue with Google/);
  assert.ok(!sheet(n, 'create').includes('Google'), 'no Google button until a client id is configured');
  assert.match(sheet(a, 'create', { msg: 'Nope <b>', bad: true }), /class="ac-msg bad" role="status">Nope &lt;b&gt;/);
  assert.match(sheet(a, 'create', { busy: true }), /<button class="btn big" disabled/);
  assert.match(sheet(a, 'approve'), /id="acCode"[\s\S]*acDoLookup\(\)/);
  const conf = sheet(a, 'approve', { step: 'confirm', data: { code: 'abcd2345', name: '<script>x</script>', uid: 'u' }, summary: { started: 0 } });
  assert.ok(!conf.includes('<script>')); assert.match(conf, /ABCD-2345/); assert.match(conf, /Nothing has been studied in this browser/);
  assert.ok(!sheet(a, 'approve', { step: 'confirm', data: { code: 'abcd2345', name: 'iPad', uid: 'u' }, summary: { started: 310 } }).includes('Nothing has been studied'));
  const r = await n.page.acJoinStart();
  const wait = sheet(n, 'join'); all.push(wait);
  assert.match(wait, new RegExp('<div class="ac-code" aria-label="code">' + r.shown + '</div>')); assert.match(wait, /ten minutes/);
  await a.page.acJoinApprove(r.shown); await settle();
  all.push(sheet(n, 'join')); assert.match(sheet(n, 'join'), /This device is in/);
  assert.match(sheet(n, 'delete'), /The deck itself belongs to the device that owns it/);
  assert.match(sheet(a, 'delete'), /disconnects the other device/);
  await a.page.acCreateAccount('lin@example.test', 'correct horse');
  assert.match(sheet(a, 'delete'), /id="acPass"/);
  const privacy = sheet(a, 'privacy');
  for (const must of ['Singapore', 'email address', 'devices you approve', 'not uploaded', 'moedict.tw', 'Export', 'Delete']) assert.ok(privacy.includes(must), 'the privacy note mentions ' + must);
  for (const h of all.concat([privacy, a.page.acCss()])) { assert.ok(!NO_COLOUR.test(h), 'colours come from variables: ' + (NO_COLOUR.exec(h) || [''])[0]); assert.ok(!/\b(alert|confirm|prompt)\(/.test(h)); }
  assert.ok(!/text-transform:\s*uppercase[^}]*letter-spacing|letter-spacing:[^;}]*;[^}]*text-transform:\s*uppercase/.test(a.page.acCss().replace(/\.ac-in\{[^}]*\}/, '')), 'no letter-spaced capitals outside the code box');
});

/* ---------------- the file itself ---------------- */
test('the script keeps to its prefix, never writes to a room, and asks nothing with alert or confirm', () => {
  const src = readFileSync(new URL('../../js/account.js', import.meta.url), 'utf8');
  const names = [...src.matchAll(/^(?:async )?function (\w+)|^(?:const|let|var) (\w+)/gm)].map(m => m[1] || m[2]);
  assert.ok(names.length > 60);
  for (const n of names) assert.match(n, /^(ac[A-Z]|AC(_|$))/, n + ' is not prefixed');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(code));
  const rooms = code.split('\n').filter(l => l.includes("'rooms/"));
  assert.equal(rooms.length, 1, 'one place mentions a room'); assert.match(rooms[0], /ad\.get\('rooms\/' \+ code \+ '\/study_state'\)/, 'and it reads');
  assert.ok(!/zika-[a-z0-9]{6}(?![a-z0-9])/.test(src), 'no sync code in the file');
  assert.ok(!/shida_b1_fsrs_v2/.test(src), 'the deck\'s storage key is the app\'s business');
  new Function(src);                                                   /* parses as a classic script */
});

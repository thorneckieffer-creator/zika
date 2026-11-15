/* REVIEW — ways a learner's review history ends up nowhere.
   Each test states what the learner needs; a failure is the defect. Harness: review-harness.mjs
   (js/account.js + the real engine from users-sync + the glue of docs/multi-user.md "Plugging in"). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeBackend, app, reopen, run, settle, sy, deckWith, reviewed, treesWith, hasRec, recs, joinDevices, KEY } from './review-harness.mjs';

const EMAIL = 'lin@example.test', PW = 'correct horse';

/* 1. Sign in on a phone that has its own reviews, on a slow link; the deck looks wrong, so sign out again.
      acSignIn deleted the phone's online copy BEFORE anything was merged; the documented flush hook says
      "nothing unsent" because an engine that has not joined yet has an empty pending set; acSignOut wipes. */
test('R1 a guest deck survives "sign in, then sign out again" when the first merge has not finished', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  const phone = await app(b, 'iPhone', { S: deckWith(b.now, ['w9:rec', 'w10:rec']) });
  await run([phone]);
  const guest = phone.uid();
  assert.ok(hasRec(b, guest, 'c~w9:rec'), 'the phone\'s reviews were backed up in its guest tree');

  phone.ctl.hold = true;                                   /* the link stalls from here: the account deck does not arrive */
  const r = await phone.page.acSignIn(EMAIL, PW); await run([phone, mac]);
  assert.equal(r.ok, true, r.err);
  assert.equal(b.read('users/' + guest), null, '(the guest tree is already gone)');
  assert.equal(sy.syStatus(phone.E).joined, false, '(and the merge into the account has not happened)');

  const out = await phone.page.acSignOut();                /* the default button: "Sign out and remove it from this device" */
  await run([phone, mac]);
  const where = treesWith(b, 'c~w9:rec');
  const onDevice = !!(JSON.parse(phone.storage.getItem(KEY) || '{}').cards || {})['w9:rec'];
  assert.ok(out.ok === false || where.length || onDevice,
    'sign-out reported ok=' + out.ok + ', wiped=' + phone.wiped + '; the phone\'s reviews now exist in ' + where.length + ' online trees and ' + (onDevice ? 'on' : 'not on') + ' the device');
});

/* 2. The app is closed (or iOS kills it) between "remove my guest tree" and "signed in". Nothing records that
      the tree was removed. At the next start the device is the same guest, the engine's shadow says every record
      is in the cloud, and nothing is sent again: the "backup" the panel promises is empty. */
test('R2 a guest whose sign-in was interrupted after its tree was removed still has an online copy afterwards', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  let phone = await app(b, 'iPhone', { S: deckWith(b.now, ['w9:rec', 'w10:rec']) });
  await run([phone]);
  const guest = phone.uid();
  assert.equal(Object.keys(recs(b, guest)).filter(k => k.startsWith('c~')).length, 2);

  const real = phone.client.signInEmail;
  phone.client.signInEmail = () => new Promise(() => {});  /* the page dies here: this call never comes back */
  phone.page.acSignIn(EMAIL, PW); await settle(12);
  assert.equal(b.read('users/' + guest), null, '(the tree was removed before the sign-in)');
  phone.client.signInEmail = real;

  phone = await reopen(phone); await run([phone], 40);
  assert.equal(phone.uid(), guest); assert.equal(phone.role(), 'guest');
  assert.deepEqual(phone.events.map(e => e.why), ['start'], '(the app is told nothing but "start")');
  const st = sy.syStatus(phone.E);
  assert.ok(hasRec(b, guest, 'c~w9:rec'),
    'engine says state=' + st.state + ' pending=' + st.pending + ', yet the guest tree holds ' + Object.keys(recs(b, guest)).filter(k => k.startsWith('c~')).length + ' of the 2 cards on the device');
});

/* 3. Same hole on the join path: acJoinSeen removes the tree, then saves the membership. Killed in between,
      the device restarts as a guest with no online copy, while the owner's list says it is in. */
test('R3 a join interrupted after the joiner\'s tree was removed leaves the joiner with an online copy or a membership', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  let pad = await app(b, 'iPad', { S: deckWith(b.now, ['w9:rec']) }); await run([pad]);
  const guest = pad.uid();
  const jr = await pad.page.acJoinStart();
  const realUpdate = pad.client.update.bind(pad.client);
  pad.client.update = async map => { await realUpdate(map); if (('users/' + guest) in map) return new Promise(() => {}); };   /* the write lands; the page is gone before it hears */
  assert.equal((await mac.page.acJoinApprove(jr.shown)).ok, true); await settle(12);
  assert.equal(b.read('users/' + guest), null, '(the joiner\'s tree was removed)');
  pad.client.update = realUpdate;

  pad = await reopen(pad); await run([pad, mac], 40);
  const member = pad.role() === 'member', backed = hasRec(b, guest, 'c~w9:rec') || hasRec(b, mac.uid(), 'c~w9:rec');
  assert.ok(member || backed, 'after reopening: role=' + pad.role() + ', the owner lists ' + Object.keys(mac.state().devices).length + ' device(s), and the iPad\'s reviews are in ' + treesWith(b, 'c~w9:rec').length + ' online trees');
});

/* 4. "Remove from this device" on a member wipes before anything is flushed. Reviews made offline on that
      device never reach the owner's deck, and nobody is asked. (Sign-out refuses in the same situation.) */
test('R4 a member with unsent reviews is not wiped without them reaching the deck', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  const pad = await app(b, 'iPad'); await joinDevices(mac, pad); await run([pad, mac]);
  assert.equal(pad.role(), 'member'); assert.ok(pad.S.cards['w1:rec'], '(the member has the deck)');
  /* a review made a moment ago: the engine sends 1.5 s after a save, so it is still pending (offline does the same) */
  pad.S.cards['w1:rec'] = reviewed(b.now, 0, 9); pad.S.cards['w77:rec'] = reviewed(b.now, 0, 1); pad.save();
  assert.ok(sy.syStatus(pad.E).pending > 0, '(two reviews wait to be sent)');
  const r = await pad.page.acDeleteMyData(); await run([pad, mac]);
  assert.ok(pad.wiped === 0 || hasRec(b, mac.uid(), 'c~w77:rec'), 'acDeleteMyData returned ok=' + r.ok + ' (' + (r.what || r.code) + '), wiped=' + pad.wiped + ', and the owner\'s deck never received the review');
});

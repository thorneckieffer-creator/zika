/* REVIEW — a deck attached to, mixed into, or readable by the wrong person; an account's tree deleted by a join.
   A failing test is a reproduced defect. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeBackend, app, run, settle, sy, deckWith, reviewed, emptyState, hasRec, recs, joinDevices, resetPassword, endSession, j } from './review-harness.mjs';

const EMAIL = 'lin@example.test', PW = 'correct horse';

/* 5. A guest shows a join code, closes the sheet (acClose keeps a waiting request alive) and creates an account
      instead. The request stays in the database for ten minutes. If the code is then typed on another deck's
      device, acJoinSeen — which never looks at the role again — deletes users/<me>, which is now the ACCOUNT's
      tree, and makes this signed-in device a "member" of the other deck. */
test('R5 a join request left waiting cannot delete the tree of the account created meanwhile', async () => {
  const b = new FakeBackend();
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec']) }); await run([mac]);
  const pad = await app(b, 'iPad', { S: deckWith(b.now, ['w9:rec']) }); await run([pad]);
  const jr = await pad.page.acJoinStart(); assert.equal(jr.ok, true);
  pad.page.acOpen('join'); pad.page.acClose();             /* the learner changes their mind: closes the sheet … */
  const cr = await pad.page.acCreateAccount(EMAIL, PW);    /* … and makes an account instead */
  assert.equal(cr.ok, true); assert.equal(pad.role(), 'account'); await run([pad]);
  const acct = pad.uid();
  assert.ok(hasRec(b, acct, 'c~w9:rec'));
  assert.equal(b.read('joins/' + jr.code + '/uid'), acct, '(the request is still live, now pointing at an account)');

  const ap = await mac.page.acJoinApprove(jr.shown); await settle(12);      /* the code, typed on the Mac a minute later */
  assert.ok(ap.ok === false || (b.read('users/' + acct) !== null && pad.role() === 'account'),
    'approve ok=' + ap.ok + '; the account\'s tree is ' + (b.read('users/' + acct) === null ? 'DELETED' : 'there') + ' and the signed-in device now has role=' + pad.role() + ' with root ' + pad.root());
});

/* 6. Whose deck is on the device is never asked. A family iPad that was let in to Dad's deck holds a full copy of
      it; when the daughter signs in to her own account there, acSignIn says 'signin', the device is not empty, so
      the glue merges — Dad's cards and reviews go into her account, for good, on all her devices.
      The same happens after "sign out and keep a copy" followed by another person's sign-in, and on join. */
test('R6 signing in to an account on a device that holds another person\'s deck does not pour that deck into the account', async () => {
  const b = new FakeBackend();
  const dad = await app(b, 'Dad Mac', { S: deckWith(b.now, ['w500:rec', 'w501:rec']), owner: 'Dad' }); await run([dad]);
  const kid = await app(b, 'Kid phone', { S: deckWith(b.now, ['w1:rec']) });
  await kid.page.acCreateAccount(EMAIL, PW); await run([kid]);
  const pad = await app(b, 'Family iPad'); await joinDevices(dad, pad); await run([pad, dad]);
  assert.equal(pad.role(), 'member'); assert.ok(pad.S.cards['w500:rec'], '(the iPad holds Dad\'s deck)');

  const r = await pad.page.acSignIn(EMAIL, PW); await run([pad, kid, dad], 40);
  const dads = Object.keys(recs(b, kid.uid())).filter(k => /w50[01]/.test(k));
  assert.ok(r.ok === false || dads.length === 0, 'acSignIn ok=' + r.ok + ' with no question asked; the daughter\'s account now holds Dad\'s records ' + JSON.stringify(dads) + ', and her phone has ' + (kid.S.cards['w500:rec'] ? 'received' : 'not received') + ' them');
});

/* 7. The ordinary case: one learner, two devices used separately as guests, each with words in My words. Ids are
      u1, u2 … on both. Create the account on one, sign in on the other: the merge keeps one word per id and
      discards the other device's, silently, while its card state may be kept for the surviving, different word. */
test('R7 signing in keeps the My words of both devices', async () => {
  const b = new FakeBackend();
  const my = (word, now) => ({ n: 2, w: { u1: { t: word, p: 'x', m: word, at: now - 86400000 } }, c: { 'u1:rec': reviewed(now, 3600000) }, intro: {}, log: {}, tp: [], tn: 1, perDay: 5, both: false });
  const mac = await app(b, 'Mac', { S: deckWith(b.now, ['w1:rec'], { my: my('貓', b.now) }) });
  await mac.page.acCreateAccount(EMAIL, PW); await run([mac]);
  const phone = await app(b, 'iPhone', { S: deckWith(b.now, ['w2:rec'], { my: my('狗', b.now) }) }); await run([phone]);
  const r = await phone.page.acSignIn(EMAIL, PW); await run([phone, mac], 40);
  assert.equal(r.ok, true, r.err);
  const words = d => Object.values((d.S.my || {}).w || {}).map(w => w.t).sort();
  assert.deepEqual({ phone: words(phone), mac: words(mac) }, { phone: ['狗', '貓'], mac: ['狗', '貓'] }, 'one device\'s own words were discarded by the sign-in');
});

/* 8. Nothing waits for the email to be confirmed. Someone who knows a learner's address makes the account first
      and lets a second, anonymous device of their own in. The learner later finds "that email already has an
      account", resets the password and signs in: their deck is merged into that account. The reset ends the
      attacker's email session, but the approved anonymous device is not a session of the account: it stays in. */
test('R8 an account made by someone else for my email gives them no way to my deck after I reset the password', async () => {
  const b = new FakeBackend();
  const evil = await app(b, 'x', { S: emptyState() });
  assert.equal((await evil.page.acCreateAccount(EMAIL, 'attacker password')).ok, true);
  assert.equal(evil.state().verified, false);
  const spy = await app(b, 'iPad');                         /* named to look like one of the learner's own */
  await joinDevices(evil, spy); await run([evil, spy]);

  const me = await app(b, 'iPhone', { S: deckWith(b.now, ['w9:rec']) }); await run([me]);
  assert.equal((await me.page.acCreateAccount(EMAIL, PW)).code, 'auth/email-already-in-use');
  assert.equal((await me.page.acSendReset(EMAIL)).ok, true);
  resetPassword(b, EMAIL, PW); endSession(evil.client);    /* the link in the email; Firebase revokes the other sessions */
  const r = await me.page.acSignIn(EMAIL, PW); await run([me, spy], 40);
  assert.equal(r.ok, true, r.err);
  let leaked = null; try { leaked = await spy.client.get(me.root() + '/rec/c~w9:rec'); } catch (e) {}
  assert.equal(leaked, null, 'the attacker\'s approved device (role ' + spy.role() + ') still reads the learner\'s deck, and holds a copy: ' + !!spy.S.cards['w9:rec']);
});

/* 21. docs/multi-user.md: "a code gives no access to anything". It does, the other way round: whoever answers a code
       first owns the deck the new device pours itself into. The joiner is never asked which deck it is joining, the
       name it is shown is the answerer's own choice, and its own online copy is deleted. A code is on screen (and in
       a QR) for ten minutes; `#join=<code>` links make answering one tap easier. */
test('R21 a join code seen by someone else does not hand them the joiner\'s deck', async () => {
  const b = new FakeBackend();
  const me = await app(b, 'iPad', { S: deckWith(b.now, ['w9:rec']) }); await run([me]);
  const mine = me.uid();
  const evil = await app(b, 'x', { owner: 'Your Mac' }); await run([evil]);
  const jr = await me.page.acJoinStart();
  const ap = await evil.page.acJoinApprove(jr.link); await run([me, evil], 40);          /* photographed QR, or the code read off the screen */
  assert.ok(!evil.S.cards['w9:rec'] && b.read('users/' + mine) !== null,
    'approve ok=' + ap.ok + '; the joiner is told "' + me.page.acPanelHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/This device uses [^.]*/)[0] + '", its own tree is ' + (b.read('users/' + mine) === null ? 'deleted' : 'there') + ', and the stranger\'s device now holds its reviews: ' + !!evil.S.cards['w9:rec']);
});

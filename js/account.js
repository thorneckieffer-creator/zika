/* ============================================================
   js/account.js — accounts (ac*)

   Who this device is, whose deck it uses, and how another device gets in.
   The decided design, with the reasons, is docs/multi-user.md; the security
   rules this code relies on are firebase/database.rules.json.

   A classic script: it shares the page's global scope, has no build step and
   no dependency. Nothing here runs until acStart() is called, and nothing in
   index.html calls it yet.

   The words
     guest    signed in anonymously and using its own tree. The deck is backed
              up online, but only this device holds the key to it.
     account  the same tree with an email and password attached, so the deck
              can be reached again from anywhere.
     member   a device the owner let in. It uses the owner's tree (users/<owner>)
              and can be removed by the owner at any time.
     root     the uid whose tree this device reads and writes: its own for a
              guest or an account, the owner's for a member.

   For the sync engine (sy*, js/sync-records.js) — the wiring is listed under
   "Plugging in" in docs/multi-user.md
     acRoot()            'users/<uid>' to read and write, or null while not ready
     acOn('root', fn)    fn({root, prev, why}) whenever that changes; why is one of
                         start join leave revoked signin signout delete reset
     acDenied()          call it when a read or write under acRoot() is refused;
                         it checks whether this device was removed
     cfg.flush           send what is unsent           (asked before a copy is erased)
     cfg.stopSync        stop the engine               (before a tree is removed or left)
     cfg.importRoom      take in a sync room's deck    (the one-time move, acMigrateRoom)
   Everything goes through an adapter (acFirebaseAdapter for the real service, a
   fake in tools/test/) so the logic can be tested without Firebase.
   ============================================================ */

const AC_STORE_KEY = 'zika_account';      /* device-local, never synced: {root, ownerName, uid} while this device is a member */
const AC_NONCE_KEY = 'zika_ac_nonce';
const AC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   /* 31 symbols: no i l o 0 1 */
const AC_JOIN_TTL = 10 * 60 * 1000;       /* keep in step with JOIN_TTL in firebase/build-rules.mjs */
const AC_MIN_PASSWORD = 8;

const AC = {
  cfg: {
    appUrl: '',                 /* where the app is served; used for the join link */
    googleClientId: '',         /* empty: the Google button is not offered */
    deviceName: null,           /* () => 'iPad' */
    ownerName: null,            /* () => the learner's name, shown to a device that joins */
    deckSummary: null,          /* () => {started: 1234} — lets the approve sheet warn about an empty deck */
    flush: null,                /* async () => send what this device has not synced yet; false if it could not */
    stopSync: null,             /* () => stop the sync engine: called before this device's online tree is removed or left */
    wipeLocal: null,            /* () => remove the deck from this device (the app owns that storage, the engine's included) */
    importRoom: null,           /* async (roomRecord) => hand a sync room's deck to the sync engine; false if it could not */
    now: () => Date.now(),
  },
  ad: null, phase: 'off', user: null, root: null, ownerName: '', devices: {}, join: null,
  err: '', why: '', subs: {}, un: {}, timer: null, sheet: null, seenStamped: false, leaving: false, boot: null, loading: false,
};

/* ---------- small things ---------- */
function acEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function acStore() { try { if (typeof store !== 'undefined' && store) return store; } catch (e) {} try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) {} return null; }
function acLoad() { try { const s = acStore(), r = s && s.getItem(AC_STORE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
function acSave(v) { try { const s = acStore(); if (!s) return; if (v) s.setItem(AC_STORE_KEY, JSON.stringify(v)); else s.removeItem(AC_STORE_KEY); } catch (e) {} }
function acOn(name, fn) { (AC.subs[name] = AC.subs[name] || []).push(fn); return () => { AC.subs[name] = (AC.subs[name] || []).filter(f => f !== fn); }; }
function acEmit(name, arg) { (AC.subs[name] || []).slice().forEach(fn => { try { fn(arg); } catch (e) {} }); if (name !== 'change') acEmit('change'); else acRender(); }
function acDeviceName() { try { if (AC.cfg.deviceName) return String(AC.cfg.deviceName() || 'Device').slice(0, 40); } catch (e) {} try { if (typeof DEVICE !== 'undefined') return String(DEVICE.name).slice(0, 40); } catch (e) {} return 'Device'; }
function acOwnerName() { try { if (AC.cfg.ownerName) return String(AC.cfg.ownerName() || '').slice(0, 60); } catch (e) {} try { if (typeof S !== 'undefined' && S.settings && S.settings.userName) return String(S.settings.userName).slice(0, 60); } catch (e) {} return ''; }

function acRole() {
  if (AC.phase !== 'ready' || !AC.user) return AC.phase === 'error' ? 'error' : AC.phase === 'starting' ? 'starting' : 'off';
  if (AC.root && AC.root !== AC.user.uid) return 'member';
  return AC.user.anon ? 'guest' : 'account';
}
function acRoot() { return AC.phase === 'ready' && AC.root ? 'users/' + AC.root : null; }
function acIsOwner() { const r = acRole(); return r === 'guest' || r === 'account'; }
function acState() { return { role: acRole(), uid: AC.user ? AC.user.uid : null, email: AC.user ? AC.user.email : '', verified: !!(AC.user && AC.user.verified), root: AC.root, ownerName: AC.ownerName, devices: AC.devices, join: AC.join, err: AC.err }; }

/* what went wrong, in a short code and in plain words */
function acErrCode(e) {
  const c = String((e && e.code) || ''), m = String((e && e.message) || e || '');
  if (/permission[_ -]?denied/i.test(c + ' ' + m)) return 'denied';
  if (/network|offline|unavailable|timeout/i.test(c + ' ' + m)) return 'network';
  return c || 'unknown';
}
const AC_WORDS = {
  'denied': 'The server refused that. This device may have been removed, or the code is no longer valid.',
  'network': 'No connection. Try again when you are online.',
  'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/invalid-email': 'That does not look like an email address.',
  'auth/weak-password': 'Choose a longer password.',
  'auth/invalid-credential': 'The email or the password is wrong.',
  'auth/wrong-password': 'The email or the password is wrong.',
  'auth/user-not-found': 'The email or the password is wrong.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.',
  'auth/requires-recent-login': 'For this, type your password again.',
  'auth/operation-not-allowed': 'Signing in this way is not switched on yet.',
  'auth/credential-already-in-use': 'That account already exists. Sign in instead.',
  'auth/user-disabled': 'This account has been disabled.',
};
function acWords(e) { const c = typeof e === 'string' ? e : acErrCode(e); return AC_WORDS[c] || 'Something went wrong (' + c + '). Nothing was changed.'; }
function acFail(e, extra) { const code = typeof e === 'string' ? e : acErrCode(e); return Object.assign({ ok: false, code, err: acWords(code) }, extra || {}); }

/* ---------- codes ---------- */
function acNewCode() {
  let out = '';
  const pick = () => {
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { const b = new Uint8Array(1); for (;;) { crypto.getRandomValues(b); if (b[0] < 248) return b[0] % 31; } } } catch (e) {}
    return Math.floor(Math.random() * 31);
  };
  while (out.length < 8) out += AC_ALPHABET[pick()];
  return out;
}
/* what someone typed or scanned, reduced to a code — or '' */
function acNormCode(t) {
  t = String(t || '');
  const m = /[#&?]join=([A-Za-z0-9-]+)/.exec(t);
  const c = (m ? m[1] : t).toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^[a-z2-9]{8}$/.test(c) ? c : '';
}
function acShowCode(c) { c = String(c || '').toUpperCase(); return c.slice(0, 4) + '-' + c.slice(4); }
function acJoinLink(code) {
  let base = AC.cfg.appUrl;
  if (!base) try { base = location.origin + location.pathname.replace(/index\.html$/, ''); } catch (e) { base = ''; }
  return base + '#join=' + code;
}
/* read what a link brought in: {join: code}, {idToken: '…'} or null. The caller clears the hash. */
function acFromHash(hash) {
  hash = String(hash || '');
  const j = /[#&]join=([A-Za-z0-9-]+)/.exec(hash);
  if (j) { const c = acNormCode(j[1]); return c ? { join: c } : null; }
  const t = /[#&]id_token=([A-Za-z0-9._-]+)/.exec(hash);
  if (t) return { idToken: t[1] };
  return null;
}

/* ---------- starting, and following who is signed in ---------- */
function acStart(adapter, cfg) {
  if (AC.ad) return;
  Object.assign(AC.cfg, cfg || {});
  AC.ad = adapter; AC.phase = 'starting'; AC.err = '';
  AC.un.auth = adapter.onAuth(u => { acOnUser(u); });
  acEmit('change');
}
function acStop() {
  Object.keys(AC.un).forEach(k => { try { AC.un[k] && AC.un[k](); } catch (e) {} });
  if (AC.timer) { try { clearTimeout(AC.timer); } catch (e) {} }
  AC.ad = null; AC.un = {}; AC.timer = null; AC.phase = 'off'; AC.user = null; AC.root = null; AC.devices = {}; AC.join = null; AC.subs = {}; AC.sheet = null; AC.seenStamped = false; AC.ownerName = ''; AC.why = '';
}
async function acOnUser(u) {
  if (!u) {
    /* nobody signed in: every device is at least a guest */
    AC.user = null;
    try { await AC.ad.signInAnonymously(); }
    catch (e) { AC.phase = 'error'; AC.err = acWords(e); acEmit('change'); }
    return;
  }
  const first = AC.phase !== 'ready', changed = !AC.user || AC.user.uid !== u.uid;
  AC.user = u; AC.leaving = false;
  if (!first && !changed) { acEmit('change'); return; }
  const saved = acLoad();
  let root = u.uid;
  if (saved && saved.root && saved.uid === u.uid && saved.root !== u.uid) { root = saved.root; AC.ownerName = saved.ownerName || ''; }
  else { if (saved) acSave(null); AC.ownerName = ''; }
  AC.phase = 'ready'; AC.err = ''; AC.seenStamped = false;
  acSetRoot(root, AC.why || 'start'); AC.why = '';
  if (root !== u.uid) acCheckGrant();
}
function acSetRoot(root, why) {
  const prev = AC.root;
  AC.root = root;
  acWatchDevices();
  if (prev !== root || why === 'start') acEmit('root', { root: root ? 'users/' + root : null, prev: prev ? 'users/' + prev : null, why });
  else acEmit('change');
}
function acWatchDevices() {
  if (AC.un.devices) { try { AC.un.devices(); } catch (e) {} AC.un.devices = null; }
  AC.devices = {};
  if (!AC.ad || !AC.root) return;
  const root = AC.root;
  AC.un.devices = AC.ad.listen('users/' + root + '/devices', v => { if (AC.root !== root) return; AC.devices = v && typeof v === 'object' ? v : {}; acEmit('change'); },
    e => { if (AC.root === root && acErrCode(e) === 'denied') acDenied(); });
}

/* A member checks that it is still let in. Refused means removed (or the deck was deleted):
   the device goes back to its own tree and keeps what it holds. Anything else (offline, a
   timeout) proves nothing, so nothing changes. */
async function acCheckGrant() {
  if (acRole() !== 'member') return true;
  const root = AC.root, me = AC.user.uid;
  try {
    const g = await AC.ad.get('users/' + root + '/devices/' + me);
    if (AC.root !== root) return true;
    if (!g) { acDropMembership('revoked'); return false; }
    if (!AC.seenStamped) { AC.seenStamped = true; AC.ad.set('users/' + root + '/devices/' + me + '/seen', AC.ad.serverTimestamp()).catch(() => {}); }
    return true;
  } catch (e) {
    if (AC.root === root && acErrCode(e) === 'denied') { acDropMembership('revoked'); return false; }
    return true;
  }
}
function acDenied() { if (acRole() === 'member' && !AC.leaving) return acCheckGrant(); return Promise.resolve(true); }
function acDropMembership(why) {
  acSave(null); AC.ownerName = '';
  if (AC.user) acSetRoot(AC.user.uid, why);
}

/* ---------- an account for a guest ---------- */
function acCheckEmail(email, password) {
  email = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return acFail('auth/invalid-email');
  if (password !== undefined && String(password).length < AC_MIN_PASSWORD) return Object.assign(acFail('auth/weak-password'), { err: 'Use at least ' + AC_MIN_PASSWORD + ' characters for the password.' });
  return { ok: true, email };
}
/* Attach an email and password to this device's own tree. The uid does not change, so nothing moves. */
async function acCreateAccount(email, password) {
  const role = acRole();
  if (role === 'member') return { ok: false, code: 'member', err: 'This device uses someone else\'s deck. Create the account on the device that owns it.' };
  if (role === 'account') return { ok: false, code: 'already', err: 'This deck already has an account.' };
  if (role !== 'guest') return acFail('network');
  const c = acCheckEmail(email, password); if (!c.ok) return c;
  const before = AC.user.uid;
  try {
    const u = await AC.ad.linkEmail(c.email, String(password));
    AC.user = u;
    if (u.uid !== before) acSetRoot(u.uid, 'signin');   /* not expected: linking keeps the uid */
    AC.ad.sendVerification().catch(() => {});
    acEmit('change');
    return { ok: true, uid: u.uid, kept: u.uid === before };
  } catch (e) { return acFail(e); }
}

/* What has to go before this device takes on another identity: a guest's own online copy
   (the deck itself stays on the device and is merged into the new tree by the sync engine),
   or a member's place in someone else's deck. Returns a reason when it should not go ahead. */
async function acBeforeSwitch(force) {
  const role = acRole(), me = AC.user.uid;
  if (role === 'member') { acPause(); AC.leaving = true; try { await AC.ad.remove('users/' + AC.root + '/devices/' + me); } catch (e) {} acSave(null); return null; }
  if (role === 'guest') {
    const others = Object.keys(AC.devices || {}).length;
    if (others && !force) return { ok: false, code: 'has-devices', n: others, err: (others === 1 ? 'One other device uses' : others + ' other devices use') + ' this deck. They will stop syncing if this device moves to another account.' };
    try { await acRemoveOwnTree(); } catch (e) { return acFail(e); }
  }
  return null;
}
async function acRemoveOwnTree() {
  const me = AC.user.uid, map = {};
  acPause();                         /* or the engine would write the tree back record by record */
  const code = await AC.ad.get('users/' + me + '/joining');
  if (code && await AC.ad.get('joins/' + code)) map['joins/' + code] = null;
  map['users/' + me] = null;
  await AC.ad.update(map);
}

/* Sign this device in to an account that already exists. The password is checked first,
   on the side, so that a typing mistake changes nothing. */
async function acSignIn(email, password, opts) {
  const role = acRole();
  if (role !== 'guest' && role !== 'member') return role === 'account' ? { ok: false, code: 'already', err: 'Sign out first.' } : acFail('network');
  const c = acCheckEmail(email); if (!c.ok) return c;
  let uid;
  try { uid = await AC.ad.probeEmail(c.email, String(password || '')); } catch (e) { return acFail(e); }
  if (uid === AC.user.uid) return { ok: true, uid, same: true };
  const stop = await acBeforeSwitch(opts && opts.force); if (stop) return stop;
  try {
    AC.why = 'signin';
    await acOnUser(await AC.ad.signInEmail(c.email, String(password)));
    return { ok: true, uid };
  } catch (e) { return acSwitchFailed(e); }
}
/* The password was right a moment ago and the sign-in still failed (the connection dropped,
   say). This device is who it was, but its online copy or its place in a deck is already gone:
   say so, so that the sync engine sends the deck up again. */
function acSwitchFailed(e) {
  AC.why = ''; AC.leaving = false;
  if (AC.user) { const prev = AC.root; AC.root = AC.user.uid; AC.ownerName = ''; acWatchDevices(); acEmit('root', { root: 'users/' + AC.root, prev: prev ? 'users/' + prev : null, why: 'reset' }); }
  return acFail(e);
}

/* A provider's ID token (Google today): attach it to a guest, or sign in if that account exists. */
async function acSignInWithIdToken(provider, idToken, opts) {
  const role = acRole();
  if (role === 'account') return { ok: false, code: 'already', err: 'Sign out first.' };
  if (role !== 'guest' && role !== 'member') return acFail('network');
  const before = AC.user.uid;
  if (role === 'guest') {
    try { const u = await AC.ad.linkIdToken(provider, idToken); AC.user = u; acEmit('change'); return { ok: true, uid: u.uid, kept: u.uid === before, linked: true }; }
    catch (e) { if (!/credential-already-in-use|email-already-in-use/.test(acErrCode(e))) return acFail(e); }
    /* the account exists, and the refusal has just proved the token is good */
  }
  const stop = await acBeforeSwitch(opts && opts.force); if (stop) return stop;
  try { AC.why = 'signin'; const u = await AC.ad.signInIdToken(provider, idToken); await acOnUser(u); return { ok: true, uid: u.uid, linked: false }; }
  catch (e) { return acSwitchFailed(e); }
}

async function acSendReset(email) {
  const c = acCheckEmail(email); if (!c.ok) return c;
  try { await AC.ad.sendReset(c.email); } catch (e) { if (acErrCode(e) === 'network') return acFail(e); }
  return { ok: true, msg: 'If that address has an account, an email with a reset link is on its way.' };
}
async function acResendVerification() { try { await AC.ad.sendVerification(); return { ok: true }; } catch (e) { return acFail(e); } }
async function acReloadUser() { try { const u = await AC.ad.reloadUser(); if (u) { AC.user = u; acEmit('change'); } return { ok: true, verified: !!(u && u.verified) }; } catch (e) { return acFail(e); } }

/* Sign out on this device. The deck stays in the account; opts.keepLocal says whether a copy
   stays on the device (it then lives on as a new guest deck) or is removed. */
async function acSignOut(opts) {
  if (acRole() !== 'account') return { ok: false, code: 'not-account', err: 'There is no account to sign out of on this device.' };
  /* everything this device has not sent yet goes up first; only then may its copy be erased */
  if (!(await acFlush())) return { ok: false, code: 'unsynced', err: 'This device has changes that have not reached your account yet. Go online and try again, so nothing is lost.' };
  acPause();
  if (!(opts && opts.keepLocal)) await acWipe();
  try {
    AC.why = 'signout';
    const next = acNextRoot();
    await AC.ad.signOut();
    await next;                       /* the device is a guest again, with a tree of its own */
    return { ok: true };
  } catch (e) { AC.why = ''; return acFail(e); }
}
/* the app's hooks: send what is unsent (false = could not), stop syncing, and erase the deck from this device */
async function acFlush() { if (!AC.cfg.flush) return true; try { return (await AC.cfg.flush()) !== false; } catch (e) { return false; } }
function acPause() { if (AC.cfg.stopSync) { try { AC.cfg.stopSync(); } catch (e) {} } }
async function acWipe() { if (AC.cfg.wipeLocal) { try { await AC.cfg.wipeLocal(); } catch (e) {} } }
function acNextRoot(ms) {
  return new Promise(res => {
    let t = null;
    const off = acOn('root', () => { off(); if (t) clearTimeout(t); res(true); });
    try { t = setTimeout(() => { off(); res(false); }, ms || 10000); if (t && t.unref) t.unref(); } catch (e) {}
  });
}

/* ---------- letting a device in ---------- */
/* On the new device: show a code. Only a guest may ask — an account signs in instead, and a
   deck that other devices use must let them go first. */
async function acJoinStart() {
  const role = acRole();
  if (role === 'member') return { ok: false, code: 'member', err: 'This device already uses another deck. Leave it first.' };
  if (role === 'account') return { ok: false, code: 'account', err: 'This device is signed in to an account. Sign out first to join another deck.' };
  if (role !== 'guest') return acFail('network');
  if (Object.keys(AC.devices || {}).length) return { ok: false, code: 'has-devices', err: 'Other devices use this deck. Remove them first.' };
  const me = AC.user.uid;
  await acJoinCancel(true);
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = acNewCode(), map = {};
    try {
      const old = await AC.ad.get('users/' + me + '/joining');
      if (old && await AC.ad.get('joins/' + old)) map['joins/' + old] = null;
      map['users/' + me + '/joining'] = code;
      map['joins/' + code] = { uid: me, name: acDeviceName(), at: AC.ad.serverTimestamp() };
      await AC.ad.update(map);
    } catch (e) {
      if (acErrCode(e) === 'denied' && attempt < 2) continue;      /* the code was taken: draw another */
      return acFail(e);
    }
    AC.join = { code, status: 'waiting', since: AC.cfg.now(), err: '' };
    AC.un.join = AC.ad.listen('joins/' + code, v => { acJoinSeen(code, v); }, e => { if (AC.join && AC.join.code === code) { AC.join.status = 'error'; AC.join.err = acWords(e); acEmit('change'); } });
    try { AC.timer = setTimeout(acJoinTick, AC_JOIN_TTL + 1000); if (AC.timer && AC.timer.unref) AC.timer.unref(); } catch (e) {}   /* unref: only so a Node test can exit */
    acEmit('change');
    return { ok: true, code, shown: acShowCode(code), link: acJoinLink(code) };
  }
  return acFail('denied');
}
function acJoinTick() {
  if (AC.join && AC.join.status === 'waiting' && AC.cfg.now() - AC.join.since >= AC_JOIN_TTL) { AC.join.status = 'expired'; acJoinCleanup(AC.join.code); acEmit('change'); }
}
async function acJoinCleanup(code) {
  if (AC.un.join) { try { AC.un.join(); } catch (e) {} AC.un.join = null; }
  if (AC.timer) { try { clearTimeout(AC.timer); } catch (e) {} AC.timer = null; }
  if (!AC.user || !code) return;
  try { await AC.ad.update({ ['joins/' + code]: null, ['users/' + AC.user.uid + '/joining']: null }); }
  catch (e) { try { await AC.ad.remove('users/' + AC.user.uid + '/joining'); } catch (e2) {} }
}
async function acJoinCancel(quiet) {
  const j = AC.join; AC.join = null;
  if (j && (j.status === 'waiting' || j.status === 'error')) await acJoinCleanup(j.code);
  if (!quiet) acEmit('change');
  return { ok: true };
}
async function acJoinSeen(code, v) {
  const j = AC.join;
  if (!j || j.code !== code || j.status !== 'waiting') return;
  if (!v) { j.status = 'cancelled'; acEmit('change'); return; }
  if (!v.ans || !v.ans.owner) return;
  const owner = String(v.ans.owner), me = AC.user.uid;
  j.status = 'finishing';
  try {
    /* the answer is only a pointer; what counts is that the owner's tree really lets this device in */
    const g = await AC.ad.get('users/' + owner + '/devices/' + me);
    if (!g) throw { code: 'PERMISSION_DENIED' };
    acPause();
    try { await AC.ad.update({ ['joins/' + code]: null, ['users/' + me]: null }); } catch (e) {}    /* this device's own online copy and the request go */
    if (AC.un.join) { try { AC.un.join(); } catch (e) {} AC.un.join = null; }
    if (AC.timer) { try { clearTimeout(AC.timer); } catch (e) {} AC.timer = null; }
    AC.ownerName = String(v.ans.name || '').slice(0, 60);
    acSave({ root: owner, ownerName: AC.ownerName, uid: me });
    j.status = 'approved'; j.owner = owner;
    AC.seenStamped = true;
    AC.ad.set('users/' + owner + '/devices/' + me + '/seen', AC.ad.serverTimestamp()).catch(() => {});
    acSetRoot(owner, 'join');
  } catch (e) { j.status = 'error'; j.err = acWords(e); acEmit('change'); }
}

/* On a device that owns the deck: look a code up, then approve it. Two steps, so the person
   sees which device they are letting in. */
async function acJoinLookup(text) {
  if (!acIsOwner()) return { ok: false, code: 'not-owner', err: acRole() === 'member' ? 'Only the device that owns this deck can add another. Do this there.' : acWords('network') };
  const code = acNormCode(text);
  if (!code) return { ok: false, code: 'format', err: 'A code is 8 letters and digits, like ' + acShowCode('abcd2345') + '.' };
  let v;
  try { v = await AC.ad.get('joins/' + code); } catch (e) { return acFail(e); }
  if (!v || !v.uid) return { ok: false, code: 'none', err: 'No device is showing that code right now. Check it, or get a new one on the other device.' };
  if (v.uid === AC.user.uid) return { ok: false, code: 'self', err: 'That is this device\'s own code. Type it on the device that has the deck.' };
  if (v.ans) return { ok: false, code: 'used', err: 'That code has already been used.' };
  if (AC.devices && AC.devices[v.uid]) return { ok: false, code: 'already', err: 'That device is already in.' };
  return { ok: true, code, uid: String(v.uid), name: String(v.name || 'Device').slice(0, 40) };
}
async function acJoinApprove(text) {
  const look = await acJoinLookup(text); if (!look.ok) return look;
  const me = AC.user.uid, ans = { owner: me }, name = acOwnerName();
  if (name) ans.name = name;
  try {
    await AC.ad.update({
      ['users/' + me + '/devices/' + look.uid]: { name: look.name, at: AC.ad.serverTimestamp() },
      ['joins/' + look.code + '/ans']: ans,
    });
    return { ok: true, uid: look.uid, name: look.name };
  } catch (e) {
    if (acErrCode(e) === 'denied') return { ok: false, code: 'expired', err: 'That code has run out or was just used. Get a new one on the other device.' };
    return acFail(e);
  }
}
async function acRevoke(deviceUid) {
  if (!acIsOwner()) return { ok: false, code: 'not-owner', err: 'Only the device that owns this deck can remove a device.' };
  try { await AC.ad.remove('users/' + AC.user.uid + '/devices/' + deviceUid); return { ok: true }; } catch (e) { return acFail(e); }
}
/* a member steps out; what it holds stays on it, as a guest deck of its own */
async function acLeave() {
  if (acRole() !== 'member') return { ok: false, code: 'not-member', err: 'This device is not using someone else\'s deck.' };
  await acFlush();                   /* what it has not sent yet goes to the deck first, if it can */
  acPause();
  AC.leaving = true;                 /* the refusals that follow its own removal are not news */
  try { await AC.ad.remove('users/' + AC.root + '/devices/' + AC.user.uid); }
  catch (e) { if (acErrCode(e) === 'network') { AC.leaving = false; return acFail(e); } }
  AC.leaving = false;
  acDropMembership('leave');
  return { ok: true };
}

/* ---------- delete, export ---------- */
/* Delete my data. An owner: the online tree, the sign-in, and (through the app's hook) the copy
   on this device. A member: only its own place and its own copy — the deck is not its to delete.
   An account types its password first, so that the server will accept deleting the sign-in
   BEFORE anything is removed. */
async function acDeleteMyData(opts) {
  const role = acRole(); opts = opts || {};
  if (role === 'member') {
    /* the copy goes first: once this device has left it is a guest, and a guest's deck is sent up */
    acPause();
    await acWipe();
    const r = await acLeave(); if (!r.ok) return r;
    return { ok: true, what: 'left' };
  }
  if (role !== 'guest' && role !== 'account') return acFail('network');
  if (role === 'account') {
    if (!opts.password) return acFail('auth/requires-recent-login');
    try { await AC.ad.reauthEmail(String(opts.password)); } catch (e) { return acFail(e); }
  }
  const n = Object.keys(AC.devices || {}).length;
  if (AC.join) await acJoinCancel(true);
  try { await acRemoveOwnTree(); } catch (e) { return acFail(e); }
  acSave(null);
  await acWipe();
  let signIn = true;
  try { AC.why = 'delete'; const next = acNextRoot(); await AC.ad.deleteUser(); await next; }
  catch (e) { AC.why = ''; signIn = false; }
  return { ok: true, what: 'deleted', devices: n, signInRemoved: signIn, note: signIn ? '' : 'The deck is deleted. The sign-in itself could not be removed; sign in again and delete once more to finish.' };
}
/* Everything the service holds for this deck, as one object the app can offer as a file. */
async function acExportData() {
  const root = acRoot(); if (!root) return acFail('network');
  try {
    const cloud = await AC.ad.get(root);
    return { ok: true, data: { format: 'zika-account-export', v: 1, exported_at: new Date(AC.cfg.now()).toISOString(), role: acRole(), uid: AC.user.uid, email: AC.user.email || null, root: AC.root, cloud: cloud || {} } };
  } catch (e) { return acFail(e); }
}

/* ---------- moving a deck from a sync room to this account ----------
   Designed and tested against a fake; never run against the live project.

   This function is the order of events and the safeguards. Turning the room's one blob into
   records is the sync engine's work (syImport), handed in as o.importRoom: it stamps what it
   imports as old, so anything studied since, on any device, wins over it — which is what makes
   running the move twice harmless.

   It only ever READS the room, and it stores the sync code nowhere.
     a finished move is skipped                  (the marker at meta/migration says done)
     an interrupted one is simply done again     (the marker says copying)
     it starts only from a settled deck          (nothing unsent, and level with the room)

   o.code        the sync code of the room
   o.local       {at, dirty} — this device's sync marks (SYNC.at, SYNC.dirty); leave it out on a
                 device that never used the room
   o.importRoom  async (roomRecord) => truthy when the engine has taken the deck in AND sent it;
                 defaults to cfg.importRoom */
async function acMigrateRoom(o) {
  o = o || {};
  if (!acIsOwner()) return { ok: false, code: 'not-owner', err: 'Move the deck from a device that is not using someone else\'s.' };
  const imp = o.importRoom || AC.cfg.importRoom;
  if (typeof imp !== 'function') return { ok: false, code: 'no-import', err: 'Syncing by record is not switched on in this version.' };
  const me = AC.user.uid, at = 'users/' + me + '/meta/migration', ad = AC.ad;
  try {
    const marker = await ad.get(at);
    if (marker && marker.state === 'done') return { ok: true, skipped: true, marker };
    const code = String(o.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
    const r = code ? await ad.get('rooms/' + code + '/study_state') : null;
    if (!r || !r.json) return { ok: false, code: 'nothing', err: 'There is no deck in that room to move.' };
    if (o.local) {
      if (o.local.dirty) return { ok: false, code: 'unsynced', err: 'This device has changes the room has not received yet. Let it finish syncing, then try again.' };
      if ((o.local.at || 0) !== r.synced_at) return { ok: false, code: 'behind', err: 'Another device saved more recently. Open the app there, or let this one catch up, then try again.' };
    }
    let state = null;
    try { state = JSON.parse(r.json); } catch (e) {}
    if (!state || typeof state !== 'object' || !state.cards) return { ok: false, code: 'unreadable', err: 'The deck in the room could not be read. Nothing was changed.' };
    const srcAt = Number(r.synced_at) || 0, cards = Object.keys(state.cards).length;
    await ad.set(at, { state: 'copying', from: 'room', src_at: srcAt, records: cards, started: ad.serverTimestamp(), device: acDeviceName() });
    let took = false;
    try { took = await imp(r); } catch (e) { took = false; }
    if (!took) return { ok: false, code: 'import', err: 'The deck could not be sent just now. Nothing is lost: the room is untouched. Try again when you are online.' };
    await ad.update({ [at + '/state']: 'done', [at + '/finished']: ad.serverTimestamp() });
    return { ok: true, from: 'room', src_at: srcAt, cards };
  } catch (e) { return acFail(e); }
}

/* ---------- Google, by a full-page trip there and back (not offered until cfg.googleClientId is set) ----------
   The page goes to Google and comes back to the app's own address with an ID token in the
   fragment. No pop-up, no third-party storage, no script from Google in the page. */
function acGoogleUrl() {
  if (!AC.cfg.googleClientId) return '';
  const nonce = acNewCode() + acNewCode() + acNewCode();
  try { const s = acStore(); if (s) s.setItem(AC_NONCE_KEY, nonce); } catch (e) {}
  let back = AC.cfg.appUrl; if (!back) try { back = location.origin + location.pathname.replace(/index\.html$/, ''); } catch (e) { back = ''; }
  const q = { client_id: AC.cfg.googleClientId, redirect_uri: back, response_type: 'id_token', scope: 'openid email', nonce, prompt: 'select_account' };
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(q).map(k => k + '=' + encodeURIComponent(q[k])).join('&');
}
/* Check what came back before handing it to Firebase (which checks the signature). */
function acGoogleToken(idToken) {
  try {
    const part = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? decodeURIComponent(Array.prototype.map.call(atob(part), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')) : Buffer.from(part, 'base64').toString('utf8');
    const p = JSON.parse(json), s = acStore(), want = s && s.getItem(AC_NONCE_KEY);
    try { if (s) s.removeItem(AC_NONCE_KEY); } catch (e) {}
    if (!want || p.nonce !== want) return { ok: false, code: 'nonce', err: 'That sign-in did not start on this device. Try again.' };
    if (p.aud !== AC.cfg.googleClientId) return { ok: false, code: 'audience', err: 'That sign-in was meant for another app.' };
    if (!/^(https:\/\/)?accounts\.google\.com$/.test(String(p.iss))) return { ok: false, code: 'issuer', err: 'That sign-in did not come from Google.' };
    if (!(p.exp * 1000 > AC.cfg.now())) return { ok: false, code: 'expired', err: 'That sign-in ran out. Try again.' };
    return { ok: true, email: p.email || '' };
  } catch (e) { return { ok: false, code: 'unreadable', err: 'That sign-in could not be read. Try again.' }; }
}

/* What to do with a link that opened the app: #join=<code> opens the approve sheet with the code
   filled in, #id_token=… finishes a Google sign-in. Waits until the device knows who it is. */
function acHandleLink(hash) {
  const h = acFromHash(hash); if (!h) return Promise.resolve(null);
  const go = async () => {
    if (h.join) { acOpen('approve', { code: acShowCode(h.join) }); return { ok: true, join: h.join }; }
    const chk = acGoogleToken(h.idToken);
    const r = chk.ok ? await acSignInWithIdToken('google', h.idToken) : chk;
    acSay(r.ok ? (r.linked ? 'Account created with Google.' : 'Signed in with Google.') : r.err);
    return r;
  };
  if (AC.phase === 'ready' && AC.user) return go();
  return new Promise(res => { const off = acOn('root', () => { off(); res(go()); }); });
}

/* ============================================================
   The real adapter. fb = {app, auth, db} plus the SDK functions named in
   acSdkSource(). This is the one part no test here runs.
   ============================================================ */
function acFirebaseAdapter(fb) {
  const U = u => (u ? { uid: u.uid, anon: !!u.isAnonymous, email: u.email || '', verified: !!u.emailVerified, providers: (u.providerData || []).map(p => p.providerId) } : null);
  const ref = p => (p ? fb.ref(fb.db, p) : fb.ref(fb.db));
  const cred = (provider, token) => { if (provider === 'google') return fb.GoogleAuthProvider.credential(token); throw { code: 'auth/operation-not-allowed' }; };
  return {
    onAuth: cb => fb.onAuthStateChanged(fb.auth, u => cb(U(u))),
    signInAnonymously: async () => U((await fb.signInAnonymously(fb.auth)).user),
    linkEmail: async (email, pw) => U((await fb.linkWithCredential(fb.auth.currentUser, fb.EmailAuthProvider.credential(email, pw))).user),
    signInEmail: async (email, pw) => U((await fb.signInWithEmailAndPassword(fb.auth, email, pw)).user),
    /* check a password without touching who is signed in: a second, throw-away app that keeps nothing */
    probeEmail: async (email, pw) => {
      const app2 = fb.initializeApp(fb.app.options, 'ac-probe-' + Date.now());
      try { const a2 = fb.initializeAuth(app2, { persistence: fb.inMemoryPersistence }); const c = await fb.signInWithEmailAndPassword(a2, email, pw); const uid = c.user.uid; await fb.signOut(a2); return uid; }
      finally { try { await fb.deleteApp(app2); } catch (e) {} }
    },
    linkIdToken: async (provider, token) => U((await fb.linkWithCredential(fb.auth.currentUser, cred(provider, token))).user),
    signInIdToken: async (provider, token) => U((await fb.signInWithCredential(fb.auth, cred(provider, token))).user),
    reauthEmail: async pw => { const u = fb.auth.currentUser; await fb.reauthenticateWithCredential(u, fb.EmailAuthProvider.credential(u.email, pw)); },
    sendVerification: async () => { if (fb.auth.currentUser) await fb.sendEmailVerification(fb.auth.currentUser); },
    sendReset: email => fb.sendPasswordResetEmail(fb.auth, email),
    reloadUser: async () => { if (!fb.auth.currentUser) return null; await fb.reload(fb.auth.currentUser); return U(fb.auth.currentUser); },
    signOut: () => fb.signOut(fb.auth),
    deleteUser: () => fb.deleteUser(fb.auth.currentUser),
    get: async p => (await fb.get(ref(p))).val(),
    set: (p, v) => fb.set(ref(p), v),
    update: map => fb.update(ref(''), map),
    remove: p => fb.remove(ref(p)),
    listen: (p, cb, onErr) => fb.onValue(ref(p), s => cb(s.val()), e => { if (onErr) onErr(e); }),
    serverTimestamp: () => fb.serverTimestamp(),
  };
}
/* the module the page injects to load the SDK, the way fbLoad() does; appCheck adds that library */
function acSdkSource(base, appCheck) {
  const A = 'initializeApp,getApp,getApps,deleteApp';
  const D = 'getDatabase,ref,set,get,update,remove,onValue,push,serverTimestamp';
  const U = 'getAuth,initializeAuth,inMemoryPersistence,onAuthStateChanged,signInAnonymously,linkWithCredential,EmailAuthProvider,GoogleAuthProvider,signInWithEmailAndPassword,signInWithCredential,reauthenticateWithCredential,sendEmailVerification,sendPasswordResetEmail,reload,signOut,deleteUser';
  const C = 'initializeAppCheck,ReCaptchaEnterpriseProvider';
  return `import{${A}}from'${base}firebase-app.js';\nimport{${D}}from'${base}firebase-database.js';\nimport{${U}}from'${base}firebase-auth.js';\n` +
    (appCheck ? `import{${C}}from'${base}firebase-app-check.js';\n` : '') +
    `window.__acSDK={${A},${D},${U}${appCheck ? ',' + C : ''}};\nwindow.acBoot&&window.acBoot();`;
}
/* Load the SDK and start. firebaseConfig is the public web config; o.appCheckKey (a reCAPTCHA
   Enterprise site key) switches App Check on; the rest of o is acStart's cfg. */
function acBoot(firebaseConfig, o) {
  o = o || {};
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (firebaseConfig) AC.boot = { cfg: firebaseConfig, o };
  const b = AC.boot; if (!b) return false;
  const sdk = window.__acSDK;
  if (!sdk) {
    if (AC.loading) return true; AC.loading = true;
    const s = document.createElement('script'); s.type = 'module';
    s.textContent = acSdkSource(b.o.sdkBase || (typeof FB_SDK !== 'undefined' ? FB_SDK : 'https://www.gstatic.com/firebasejs/10.12.0/'), !!b.o.appCheckKey);
    window.acBoot = () => acBoot();
    document.head.appendChild(s);
    return true;
  }
  const app = sdk.getApps().length ? sdk.getApp() : sdk.initializeApp(b.cfg);
  if (b.o.appCheckKey) { try { sdk.initializeAppCheck(app, { provider: new sdk.ReCaptchaEnterpriseProvider(b.o.appCheckKey), isTokenAutoRefreshEnabled: true }); } catch (e) {} }
  const fb = Object.assign({}, sdk, { app, auth: sdk.getAuth(app), db: sdk.getDatabase(app) });
  acStart(acFirebaseAdapter(fb), b.o);
  return true;
}

/* ============================================================
   What it looks like. Strings only: Settings shows acPanelHtml(), and a
   sheet shows acSheetHtml(). Colours come from the app's variables
   (docs/design.md); the few new classes are in acCss().
   ============================================================ */
function acCss() {
  return `.ac-code{font-size:30px;font-weight:700;letter-spacing:.08em;font-variant-numeric:tabular-nums;text-align:center;padding:14px 10px;border:1px solid var(--line2);border-radius:12px;background:var(--tint);color:var(--ink);user-select:all;-webkit-user-select:all}
.ac-in{text-align:center;font-size:22px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.ac-dev{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--tint);font-size:14px}
.ac-dev:last-child{border-bottom:0}
.ac-dev .d{font-size:12px;color:var(--mut)}
.ac-msg{font-size:13px;margin:0 0 12px;color:var(--mut)}
.ac-msg.bad{color:var(--red)}
.ac-msg.good{color:var(--acc)}
.ac-qr{display:flex;justify-content:center;margin:12px 0}
.ac-note h4{font-size:14px;font-weight:700;margin:14px 0 4px}
.ac-note p{font-size:13.5px;line-height:1.5;margin:0 0 8px;color:var(--ink)}`;
}
function acAgo(t) {
  if (!t) return '';
  const s = Math.max(0, Math.floor((AC.cfg.now() - t) / 1000));
  if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago';
  const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago';
}
function acDevicesHtml(canRemove) {
  const ids = Object.keys(AC.devices || {}).sort((a, b) => (AC.devices[a].at || 0) - (AC.devices[b].at || 0));
  if (!ids.length) return '';
  const me = AC.user && AC.user.uid;
  return ids.map(id => {
    const d = AC.devices[id] || {};
    const when = d.seen ? 'last here ' + acAgo(d.seen) : d.at ? 'added ' + acAgo(d.at) : '';
    return `<div class="ac-dev"><div><b>${acEsc(d.name || 'Device')}</b>${id === me ? ' <span class="d">this device</span>' : ''}<div class="d">${acEsc(when)}</div></div>` +
      (canRemove ? `<button class="btn ghost sm" onclick="acDoRevoke('${acEsc(id)}')">Remove</button>` : '') + `</div>`;
  }).join('');
}
function acPanelHtml() {
  const role = acRole(), u = AC.user || {}, n = Object.keys(AC.devices || {}).length;
  const row = (title, text, right) => `<div class="set-row"><div><b>${title}</b><div class="d">${text}</div></div>${right ? `<div class="row" style="gap:6px;justify-content:flex-end">${right}</div>` : ''}</div>`;
  const btn = (label, call, kind) => `<button class="btn ${kind === 'main' ? '' : 'ghost '}sm"${kind === 'danger' ? ' style="color:var(--red)"' : ''} onclick="${call}">${label}</button>`;
  let h = `<div class="card" id="acCard"><div class="lab">Account</div>`;
  if (role === 'off' || role === 'starting') return h + row(role === 'off' ? 'Not connected' : 'Connecting…', 'Your deck is on this device. Accounts and other devices need a connection.', '') + `</div>`;
  if (role === 'error') return h + row('Could not connect', acEsc(AC.err || 'Try again when you are online.'), '') + `</div>`;
  const data = row('Your data', 'What is kept, where, and who can read it.', btn('Privacy', "acOpen('privacy')") + btn('Export', 'acDoExport()') + btn(role === 'member' ? 'Remove from this device' : 'Delete', "acOpen('delete')", 'danger'));
  if (role === 'member') {
    h += row('This device uses ' + acEsc(AC.ownerName ? AC.ownerName + '’s deck' : 'a deck from another device'), 'It was let in from the device that owns the deck, and can be removed from there. Leaving keeps a copy here.', btn('Leave', "acOpen('leave')"));
    if (n) h += `<div class="set-row" style="display:block"><b>Devices on this deck</b>${acDevicesHtml(false)}</div>`;
    return h + data + `</div>`;
  }
  if (role === 'guest') {
    h += row('No account yet', 'The deck is backed up online, but only this device holds the key to it. If the device is lost or its browser data is cleared, nothing can bring the deck back. An email and a password fix that.', btn('Create account', "acOpen('create')", 'main'));
  } else {
    h += row('Signed in as ' + acEsc(u.email || 'your account'), u.verified ? 'Sign in with this email on any device to reach your deck.' : 'Not confirmed yet: open the link in the email we sent. Until then a forgotten password cannot be reset safely.',
      (u.verified ? '' : btn('Send again', 'acDoResend()') + btn('I have confirmed', 'acDoReload()')) + btn('Sign out', "acOpen('signout')"));
  }
  h += row('Devices', n ? (n === 1 ? 'One other device uses' : n + ' other devices use') + ' this deck. Removing one stops it at once.' : 'Only this device uses this deck.', btn('Add a device', "acOpen('approve')"));
  if (n) h += `<div class="set-row" style="display:block">${acDevicesHtml(true)}</div>`;
  if (role === 'guest') h += row('Already have a deck?', 'Sign in to your account, or let a device that has the deck approve this one with a code.', btn('Sign in', "acOpen('signin')") + btn('Join with a code', "acOpen('join')"));
  return h + data + `</div>`;
}

function acPrivacyHtml() {
  return `<div class="ac-note">
<h4>What is kept</h4><p>Your study progress: which cards you have seen, how you graded them and when they are due; your daily counts; your settings; the words you add to My words; and the name you give each device. If you create an account, your email address. Nothing else — no contacts, no location, no advertising or tracking.</p>
<h4>Where</h4><p>On this device, and in a database run by Google (Firebase) in Singapore, so your other devices can stay in step. Sign-in is handled by Google's Firebase Authentication; your password is never seen or stored by this app.</p>
<h4>Who can read it</h4><p>You, and the devices you approve. Nobody else who uses the app can. The person who runs this app can see the database when maintaining it, and does not share or sell it.</p>
<h4>Your voice</h4><p>Recordings made for the tone coach are analysed on this device and are not uploaded. A voice pack made from your own voice stays on your devices.</p>
<h4>Other services the app talks to</h4><p>The app's files come from GitHub Pages and the sign-in library from Google, and both see your internet address as any website does. Looking a character up in 萌典 sends that character to moedict.tw, and the stroke order of a character the app does not carry is fetched from jsDelivr.</p>
<h4>Taking it with you, or away</h4><p>Export gives you a file with everything kept for you. Delete removes the online copy and your sign-in straight away, and the copy on this device.</p>
</div>`;
}

/* one sheet at a time: AC.sheet = {kind, step, msg, bad, busy, data} */
function acSheetHtml() {
  const s = AC.sheet; if (!s) return '';
  const role = acRole(), u = AC.user || {};
  const head = t => `<div class="sheet-h"><b>${t}</b><button class="xbtn" onclick="acClose()" aria-label="close">✕</button></div>`;
  const msg = s.msg ? `<div class="ac-msg ${s.bad ? 'bad' : 'good'}" role="status">${acEsc(s.msg)}</div>` : '';
  const dis = s.busy ? ' disabled' : '';
  const field = (id, label, type, extra) => `<div class="frow"><label for="${id}">${label}</label><input id="${id}" class="myin" type="${type}" ${extra || ''}></div>`;
  const email = field('acEmail', 'Email', 'email', `autocomplete="email" autocapitalize="off" spellcheck="false" value="${acEsc(s.email || '')}"`);
  let body = '';
  if (s.kind === 'create') {
    body = head('Create account') + `<p class="ac-msg">Your deck stays exactly as it is. The email and password are how you get back to it from another device, or after losing this one.</p>` + msg + email +
      field('acPass', 'Password', 'password', `autocomplete="new-password" placeholder="At least ${AC_MIN_PASSWORD} characters"`) +
      `<button class="btn big"${dis} onclick="acDoCreate()">Create account</button>` +
      (AC.cfg.googleClientId ? `<button class="btn big ghost" style="margin-top:8px"${dis} onclick="acDoGoogle()">Continue with Google</button>` : '') +
      `<div class="small muted" style="margin-top:12px;text-align:center">Already have one? <span class="link" onclick="acOpen('signin')">Sign in</span> · <span class="link" onclick="acOpen('privacy')">Privacy</span></div>`;
  } else if (s.kind === 'signin') {
    body = head('Sign in') + `<p class="ac-msg">This device will use the deck in your account. What it has studied on its own is added to that deck.</p>` + msg + email +
      field('acPass', 'Password', 'password', 'autocomplete="current-password"') +
      (s.force ? `<button class="btn big" style="color:var(--red)"${dis} onclick="acDoSignIn(true)">Sign in anyway</button>` : `<button class="btn big"${dis} onclick="acDoSignIn()">Sign in</button>`) +
      (AC.cfg.googleClientId ? `<button class="btn big ghost" style="margin-top:8px"${dis} onclick="acDoGoogle()">Continue with Google</button>` : '') +
      `<div class="small muted" style="margin-top:12px;text-align:center"><span class="link" onclick="acDoReset()">Forgot the password?</span> · <span class="link" onclick="acOpen('join')">Use a code instead</span></div>`;
  } else if (s.kind === 'join') {
    const j = AC.join;
    if (j && j.status === 'approved') body = head('This device is in') + `<div class="ac-msg good">It now uses ${acEsc(AC.ownerName ? AC.ownerName + '’s deck' : 'the deck from your other device')}.</div><button class="btn big" onclick="acClose()">Done</button>`;
    else if (j && j.status === 'waiting') {
      let qr = ''; try { if (typeof qrSvg === 'function') qr = qrSvg(acJoinLink(j.code), 4); } catch (e) {}
      body = head('Join with a code') + `<p class="ac-msg">On the device that has your deck, open Settings → Account → Add a device, and type this code.</p>
        <div class="ac-code" aria-label="code">${acEsc(acShowCode(j.code))}</div>
        ${qr ? `<div class="ac-qr" title="A link to the same code, for a computer or an Android phone"><div class="qrbox">${qr}</div></div>` : ''}
        <div class="ac-msg" style="text-align:center;margin-top:12px">Waiting for the other device… The code works for ten minutes.</div>
        <button class="btn big ghost" onclick="acDoJoinCancel()">Cancel</button>`;
    } else {
      const why = j ? (j.status === 'expired' ? 'That code ran out.' : j.status === 'cancelled' ? 'That code was withdrawn.' : j.err || '') : '';
      body = head('Join with a code') + `<p class="ac-msg">This device will show a code. Typing it on the device that has your deck lets this one in — no email or password needed. What this device has studied on its own is added to that deck.</p>` +
        (why ? `<div class="ac-msg bad">${acEsc(why)}</div>` : '') + msg + `<button class="btn big"${dis} onclick="acDoJoinStart()">${j ? 'Get a new code' : 'Show a code'}</button>`;
    }
  } else if (s.kind === 'approve') {
    if (s.step === 'confirm') {
      const sum = s.summary, empty = sum && sum.started === 0;
      body = head('Let this device in?') + `<div class="ac-dev"><div><b>${acEsc(s.data.name)}</b><div class="d">code ${acEsc(acShowCode(s.data.code))}</div></div></div>
        <p class="ac-msg" style="margin-top:12px">It will be able to read and change this deck${sum && sum.started ? ' (' + sum.started + ' cards started)' : ''} until you remove it here.</p>` +
        (empty ? `<div class="ac-msg bad">Nothing has been studied in this browser. If your deck is in the app on your Home Screen, cancel and type the code there instead.</div>` : '') + msg +
        `<div class="row" style="gap:8px"><button class="btn" style="flex:1"${dis} onclick="acDoApprove()">Let it in</button><button class="btn ghost"${dis} onclick="acOpen('approve')">Cancel</button></div>`;
    } else if (s.step === 'done') {
      body = head('Device added') + `<div class="ac-msg good">${acEsc(s.data.name)} now uses this deck.</div><button class="btn big" onclick="acClose()">Done</button>`;
    } else {
      body = head('Add a device') + `<p class="ac-msg">On the new device, open 字卡 → Settings → Account → Join with a code. Type the code it shows here.</p>` + msg +
        `<div class="frow"><label for="acCode">Code from the new device</label><input id="acCode" class="myin ac-in" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="ABCD-2345" value="${acEsc(s.code || '')}" onkeydown="if(event.key==='Enter'){event.preventDefault();acDoLookup();}"></div>
        <button class="btn big"${dis} onclick="acDoLookup()">Continue</button>` +
        (role === 'guest' ? '' : `<div class="small muted" style="margin-top:12px;text-align:center">Or sign in on the new device with ${acEsc(u.email || 'your email')}.</div>`);
    }
  } else if (s.kind === 'signout') {
    body = head('Sign out') + `<p class="ac-msg">Your deck stays in your account. What should happen to the copy on this device?</p>` + msg +
      `<button class="btn big"${dis} onclick="acDoSignOut(false)">Sign out and remove it from this device</button>
       <button class="btn big ghost" style="margin-top:8px"${dis} onclick="acDoSignOut(true)">Sign out and keep a copy here</button>`;
  } else if (s.kind === 'leave') {
    body = head('Leave this deck') + `<p class="ac-msg">This device stops syncing with ${acEsc(AC.ownerName ? AC.ownerName + '’s deck' : 'the deck')}. What it holds now stays on it as a deck of its own.</p>` + msg +
      `<button class="btn big"${dis} onclick="acDoLeave()">Leave</button>`;
  } else if (s.kind === 'delete') {
    const n = Object.keys(AC.devices || {}).length;
    if (role === 'member') body = head('Remove from this device') + `<p class="ac-msg">This device leaves the deck and its copy is erased. The deck itself belongs to the device that owns it and is not touched.</p>` + msg +
      `<button class="btn big" style="color:var(--red)"${dis} onclick="acDoDelete()">Remove from this device</button>`;
    else body = head('Delete my data') + `<p class="ac-msg">This erases the online copy of your deck${role === 'account' ? ', your account' : ''} and the copy on this device${n ? ', and disconnects ' + (n === 1 ? 'the other device' : 'the ' + n + ' other devices') : ''}. It cannot be undone. Export first if you want a file to keep.</p>` + msg +
      (role === 'account' ? field('acPass', 'Your password, to confirm', 'password', 'autocomplete="current-password"') : '') +
      `<div class="row" style="gap:8px"><button class="btn ghost" style="flex:1;color:var(--red)"${dis} onclick="acDoDelete()">Delete everything</button><button class="btn"${dis} onclick="acClose()">Keep it</button></div>`;
  } else if (s.kind === 'privacy') {
    body = head('Privacy') + acPrivacyHtml() + `<button class="btn big" onclick="acClose()">Done</button>`;
  }
  return `<div class="modal-card">${body}</div>`;
}

/* ---------- the little that touches the page (not covered by the Node tests) ---------- */
function acHost() {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('acStyle')) { const st = document.createElement('style'); st.id = 'acStyle'; st.textContent = acCss(); document.head.appendChild(st); }
  try { if (typeof shHost === 'function') return shHost(); } catch (e) {}
  let m = document.getElementById('acSheet');
  if (!m) { m = document.createElement('div'); m.id = 'acSheet'; m.className = 'modal'; m.addEventListener('click', e => { if (e.target === m) acClose(); }); document.body.appendChild(m); }
  return m;
}
function acRender() {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('acCard'); if (card) card.outerHTML = acPanelHtml();
  if (AC.sheet) { const m = acHost(); if (m) { m.innerHTML = acSheetHtml(); m.style.display = 'flex'; } }
}
function acOpen(kind, extra) { AC.sheet = Object.assign({ kind, step: '', msg: '', bad: false, busy: false }, extra || {}); acRender(); }
function acClose() {
  const s = AC.sheet; AC.sheet = null;
  if (s && s.kind === 'join' && AC.join && AC.join.status !== 'waiting') AC.join = null;
  if (typeof document === 'undefined') return;
  const m = acHost(); if (m) { m.style.display = 'none'; m.innerHTML = ''; }
}
function acVal(id) { if (typeof document === 'undefined') return ''; const el = document.getElementById(id); return el ? el.value : ''; }
function acSay(t) { try { if (typeof toast === 'function') toast(acEsc(t)); } catch (e) {} }
async function acRun(fn, keep) {
  const s = AC.sheet; if (s) { Object.assign(s, keep || {}); s.busy = true; s.msg = ''; acRender(); }
  const r = await fn();
  if (AC.sheet === s && s) { s.busy = false; if (!r.ok) { s.msg = r.err || ''; s.bad = true; } acRender(); }
  return r;
}
async function acDoCreate() { const email = acVal('acEmail'); const r = await acRun(() => acCreateAccount(email, acVal('acPass')), { email }); if (r.ok) { acClose(); acSay('Account created. Check your email to confirm the address.'); } }
async function acDoSignIn(force) {
  const email = acVal('acEmail'); const r = await acRun(() => acSignIn(email, acVal('acPass'), { force: !!force }), { email });
  if (r.ok) { acClose(); acSay('Signed in.'); } else if (r.code === 'has-devices' && AC.sheet) { AC.sheet.force = true; acRender(); }
}
async function acDoReset() { const email = acVal('acEmail'); const r = await acRun(() => acSendReset(email), { email }); if (r.ok && AC.sheet) { AC.sheet.msg = r.msg; AC.sheet.bad = false; acRender(); } }
async function acDoResend() { const r = await acResendVerification(); acSay(r.ok ? 'Sent. Look for an email from the app.' : r.err); }
async function acDoReload() { const r = await acReloadUser(); if (r.ok && !r.verified) acSay('Not confirmed yet. Open the link in the email first.'); }
function acDoGoogle() { const url = acGoogleUrl(); if (url && typeof location !== 'undefined') location.href = url; }
async function acDoJoinStart() { await acRun(() => acJoinStart()); }
async function acDoJoinCancel() { await acJoinCancel(); acClose(); }
async function acDoLookup() {
  const code = acVal('acCode'); const r = await acRun(() => acJoinLookup(code), { code });
  if (r.ok) { let summary = null; try { if (AC.cfg.deckSummary) summary = AC.cfg.deckSummary(); } catch (e) {} acOpen('approve', { step: 'confirm', data: r, summary }); }
}
async function acDoApprove() { const d = AC.sheet && AC.sheet.data; if (!d) return; const r = await acRun(() => acJoinApprove(d.code)); if (r.ok) acOpen('approve', { step: 'done', data: r }); }
async function acDoRevoke(id) { const d = (AC.devices || {})[id]; const r = await acRevoke(id); acSay(r.ok ? (d && d.name ? d.name : 'The device') + ' was removed.' : r.err); }
async function acDoSignOut(keep) { const r = await acRun(() => acSignOut({ keepLocal: !!keep })); if (r.ok) { acClose(); acSay('Signed out.'); } }
async function acDoLeave() { const r = await acRun(() => acLeave()); if (r.ok) { acClose(); acSay('This device left the deck.'); } }
async function acDoDelete() { const pw = acVal('acPass'); const r = await acRun(() => acDeleteMyData({ password: pw })); if (r.ok) { acClose(); acSay(r.note || (r.what === 'left' ? 'Removed from this device.' : 'Your data was deleted.')); } }
async function acDoExport() {
  const r = await acExportData(); if (!r.ok) { acSay(r.err); return; }
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return r;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 1)], { type: 'application/json' }));
  a.download = 'zika-account-' + r.data.exported_at.slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return r;
}

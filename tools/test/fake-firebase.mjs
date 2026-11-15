/* A stand-in for Firebase Authentication and the Realtime Database, for the tests of js/account.js.

   One FakeBackend is "the project": one database, one list of sign-ins. backend.client() is one
   browser (one device): it has its own signed-in user and speaks the adapter interface that
   acFirebaseAdapter() provides for the real service.

   Every read and write goes through the real rules file, evaluated by rules-eval.mjs, so a
   flow that passes here is a flow the rules allow — as far as that evaluator can be trusted
   (firebase/README.md). What this fake cannot tell you is how the real SDK behaves: timing,
   offline queues, token refresh, the exact error objects. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RulesDb } from './rules-eval.mjs';

const RULES = JSON.parse(readFileSync(new URL('../../firebase/database.rules.json', import.meta.url), 'utf8'));
const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const err = (code, message) => Object.assign(new Error(message || code), { code });
const DENIED = () => err('PERMISSION_DENIED', 'PERMISSION_DENIED: Permission denied');

export class FakeBackend {
  constructor(opts) {
    opts = opts || {};
    this.db = new RulesDb(opts.rules || RULES, null, { now: opts.now || 1_800_000_000_000 });
    this.accounts = {};          /* uid → {uid, anon, email, password, verified, ids:[…]} */
    this.n = 0;
    this.listeners = new Set();
    this.mail = [];              /* what would have been emailed */
    this.writes = [];            /* every accepted write: {uid, paths} */
    this.cancelOnRevoke = opts.cancelOnRevoke !== false;   /* does losing permission cancel a listener? (see README: not verified on the real service) */
    this.failWritesAfter = Infinity;                        /* make the Nth accepted write from now fail, to test an interrupted run */
    this.offline = false;
  }
  get now() { return this.db.now; }
  set now(t) { this.db.now = t; }
  advance(ms) { this.db.now += ms; }
  /* put data in place without asking the rules (what was there before the test starts) */
  seed(path, value) { const r = new RulesDb({ rules: { '.write': true } }, this.db.root, { now: this.now }); r.write(null, path, value); this.db.root = r.root; }
  read(path) { return clone(this.db.get(path)); }
  _newUser(extra) { const uid = 'u' + (++this.n) + 'x' + Math.random().toString(36).slice(2, 8); return (this.accounts[uid] = Object.assign({ uid, anon: true, email: '', password: '', verified: false, ids: [] }, extra)); }
  _byEmail(email) { return Object.values(this.accounts).find(a => a.email && a.email.toLowerCase() === String(email).toLowerCase()); }
  _notify() {
    for (const l of Array.from(this.listeners)) {
      if (!this.listeners.has(l)) continue;
      const r = this.db.read(l.client._auth(), l.path);
      if (!r.allowed) { if (this.cancelOnRevoke) { this.listeners.delete(l); l.onErr && l.onErr(DENIED()); } continue; }
      const j = JSON.stringify(r.value);
      if (j !== l.last) { l.last = j; l.cb(clone(r.value)); }
    }
  }
  client() { return new FakeClient(this); }
}

class FakeClient {
  constructor(b) { this.b = b; this.cur = null; this.cbs = new Set(); this.recent = false; }
  _auth() { return this.cur ? { uid: this.cur.uid } : null; }
  _user() { const c = this.cur; return c ? { uid: c.uid, anon: c.anon, email: c.email, verified: c.verified, providers: c.anon ? [] : c.ids.length ? ['google.com'] : ['password'] } : null; }
  _fire() { const u = this._user(); for (const cb of Array.from(this.cbs)) cb(u); this.b._notify(); }
  _net() { if (this.b.offline) throw err('unavailable', 'Error: Client is offline.'); }

  onAuth(cb) { this.cbs.add(cb); Promise.resolve().then(() => { if (this.cbs.has(cb)) cb(this._user()); }); return () => this.cbs.delete(cb); }
  async signInAnonymously() { this._net(); if (this.cur && this.cur.anon) return this._user(); this.cur = this.b._newUser(); this._fire(); return this._user(); }
  async linkEmail(email, password) {
    this._net(); if (!this.cur) throw err('auth/no-current-user');
    if (this.b._byEmail(email)) throw err('auth/email-already-in-use');
    Object.assign(this.cur, { anon: false, email, password, verified: false });
    this.recent = true;
    return this._user();                                   /* like the real SDK, linking does not fire the auth-state listener */
  }
  _check(email, password) { const a = this.b._byEmail(email); if (!a || a.password !== password) throw err('auth/invalid-credential'); return a; }
  async signInEmail(email, password) { this._net(); this.cur = this._check(email, password); this.recent = true; this._fire(); return this._user(); }
  async probeEmail(email, password) { this._net(); return this._check(email, password).uid; }
  /* an "ID token" here is just 'provider:subject:email' */
  _byId(id) { return Object.values(this.b.accounts).find(a => a.ids.includes(id)); }
  async linkIdToken(provider, token) {
    this._net(); const id = provider + ':' + String(token).split(':')[1];
    if (this._byId(id)) throw err('auth/credential-already-in-use');
    Object.assign(this.cur, { anon: false, email: String(token).split(':')[2] || '', verified: true }); this.cur.ids.push(id); this.recent = true;
    return this._user();
  }
  async signInIdToken(provider, token) {
    this._net(); const id = provider + ':' + String(token).split(':')[1];
    this.cur = this._byId(id) || this.b._newUser({ anon: false, email: String(token).split(':')[2] || '', verified: true, ids: [id] });
    this.recent = true; this._fire(); return this._user();
  }
  async reauthEmail(password) { this._net(); if (!this.cur || this.cur.password !== password) throw err('auth/invalid-credential'); this.recent = true; }
  async sendVerification() { this._net(); this.b.mail.push({ kind: 'verify', to: this.cur && this.cur.email }); }
  async sendReset(email) { this._net(); if (this.b._byEmail(email)) this.b.mail.push({ kind: 'reset', to: email }); }
  async reloadUser() { this._net(); return this._user(); }
  async signOut() { this.cur = null; this.recent = false; this._fire(); }
  async deleteUser() {
    this._net(); if (!this.cur) throw err('auth/no-current-user');
    if (!this.cur.anon && !this.recent) throw err('auth/requires-recent-login');
    delete this.b.accounts[this.cur.uid]; this.cur = null; this._fire();
  }

  async get(path) { this._net(); const r = this.b.db.read(this._auth(), path); if (!r.allowed) throw DENIED(); return clone(r.value); }
  _wrote(paths) {
    if (--this.b.failWritesAfter < 0) { this.b.failWritesAfter = Infinity; throw err('unavailable', 'the connection dropped'); }
    this.b.writes.push({ uid: this.cur && this.cur.uid, paths });
  }
  async set(path, value) {
    this._net();
    if (!this.b.db.check(this._auth(), path, value).allowed) throw DENIED();
    this._wrote([path]); this.b.db.write(this._auth(), path, value); this.b._notify();
  }
  async update(map) {
    this._net();
    if (!this.b.db.checkUpdate(this._auth(), map).allowed) throw DENIED();
    this._wrote(Object.keys(map)); this.b.db.update(this._auth(), map); this.b._notify();
  }
  remove(path) { return this.set(path, null); }
  listen(path, cb, onErr) {
    const l = { client: this, path, cb, onErr, last: undefined };
    Promise.resolve().then(() => {
      if (l.off) return;
      const r = this.b.db.read(this._auth(), path);
      if (!r.allowed) { onErr && onErr(DENIED()); return; }
      this.b.listeners.add(l); l.last = JSON.stringify(r.value); cb(clone(r.value));
    });
    return () => { l.off = true; this.b.listeners.delete(l); };
  }
  serverTimestamp() { return { '.sv': 'timestamp' }; }
}

/* ---------- one "browser": js/account.js loaded the way a page loads it ---------- */
/* ZIKA_ACCOUNT_SRC points the tests at another copy of the script: tools/test/account-mutate.mjs
   uses it to check that the tests notice when the script is broken on purpose. */
const SOURCE = readFileSync(process.env.ZIKA_ACCOUNT_SRC || new URL('../../js/account.js', import.meta.url), 'utf8');
export function memStorage(init) {
  const m = Object.assign({}, init || {});
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _all: m };
}
/* Returns the page's global scope with every ac* function on it. storage survives a "reload"
   when the same object is passed again. */
export function browser(opts) {
  opts = opts || {};
  const ctx = vm.createContext(Object.assign({ console, setTimeout, clearTimeout, Buffer, localStorage: opts.storage || memStorage() }, opts.globals || {}));
  vm.runInContext(SOURCE, ctx, { filename: 'js/account.js' });
  ctx.AC_ = vm.runInContext('AC', ctx);          /* top-level const is not a property of the global object */
  return ctx;
}
/* let pending promises and listener callbacks run */
export async function settle(n) { for (let i = 0; i < (n || 6); i++) await new Promise(r => setImmediate(r)); }

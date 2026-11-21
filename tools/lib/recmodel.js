/* 字卡 — the record store, as a model in plain JavaScript.

   What db/0001_records.sql and db/0002_signed_in.sql do on the Supabase project, written out again with no
   database, no network and no clock of its own, so that the sync engine, the accounts module and the screen
   harness can all be tested against one stand-in that is held to the real thing: the protocol groups of
   tools/dbtest.mjs run on both, and the model is right when they pass on both.

     node tools/dbtest.mjs            the real project
     node tools/dbtest.mjs --model    this file

   The protocol it models is in docs/backend.md; the contract the engine and the adapter are built against is in
   docs/sync.md. When the SQL changes, this file changes with it, in the same commit, and both runs stay green.

   Two faces:
   - the doors, as the service answers them: signIn, signOut, refresh, head, write, rows, channel. Each returns
     { status, json } like an HTTP answer, never throws, and is synchronous;
   - adapter(token): the four functions docs/sync.md gives the engine (head, read, write, listen), with its typed
     errors. It is what sySupabase() is over the real doors, and what tests hand to syConnect().
   And what a test needs to stage: a clock it can move (advance), a join that is refused the first time (cold),
   an answer that is lost on the way back (lose), a line that is down (adapter.online), a token past its hour
   (expire), a cloud put back to an earlier day (snapshot, restore), signals held back or dropped (hold, deliver).

   No Node-only API is used: this file loads with require() in Node, and as a plain <script> in a page, where it
   defines one global, recModel. */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.recModel = make();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* the constants at the top of rec_write(), and the cut the data API makes on every answer */
  const LIM = Object.freeze({
    call: 1000,            /* records in one call */
    value: 65536,          /* bytes in one value */
    key: 512,              /* bytes in one key */
    ahead: 300000,         /* ms a stamp may be ahead of the server's clock */
    rows: 40000,           /* rows one person may hold */
    bytes: 8388608,        /* and their size */
    minute: 30000,         /* records one person may send in a minute */
    ttlMin: 60,            /* seconds */
    ttlMax: 34560000,      /* 400 days */
    overhead: 64,          /* counted per row on top of key, stamp and value */
    page: 1000,            /* rows in one answer of the data API */
    fmtMax: 32767          /* the record format is a smallint */
  });
  const KEY_OK = /^[a-z]{1,3}~[\s\S]/, KEY_CTRL = /[\x01-\x1f\x7f]/;
  const STAMP_OK = /^[0-9]{13}[0-9a-z]{3}[0-9A-Za-z_-]{1,47}$/;
  const SERVED = { k: 1, h: 1, j: 1, d: 1, n: 1 };          /* the columns anyone is granted */

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /* the length of a string in UTF-8 bytes, which is what the database counts */
  function bytes(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n++;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  /* what the database cannot hold in a text at all: U+0000, and half of a surrogate pair. One of these anywhere in
     a call fails the whole call before rec_write() runs. Returns '' when the string is fine. */
  function unstorable(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0) return 'U+0000';
      if (c >= 0xd800 && c < 0xdc00) { if (i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) i++; else return 'half a surrogate pair'; }
      else if (c >= 0xdc00 && c < 0xe000) return 'half a surrogate pair';
    }
    return '';
  }
  function poison(v) {
    if (typeof v === 'string') return unstorable(v);
    if (!v || typeof v !== 'object') return '';
    if (Array.isArray(v)) { for (const x of v) { const p = poison(x); if (p) return p; } return ''; }
    for (const k in v) if (has(v, k)) { const p = unstorable(k) || poison(v[k]); if (p) return p; }
    return '';
  }
  const answer = (status, json) => ({ status, json, text: json === undefined || json === null ? '' : JSON.stringify(json) });
  const refuse = (status, message, code) => answer(status, { code: code || 'PT' + status, message, details: null, hint: null });
  function syncError(type, status, message) {
    const e = new Error(message || type);
    e.name = 'SyncError'; e.type = type; e.status = status || 0;
    return e;
  }
  /* an HTTP answer as the typed error docs/sync.md names, or null when it is not an error */
  function typed(r) {
    if (r.status >= 200 && r.status < 300) return null;
    const m = (r.json && r.json.message) || '';
    if (r.status === 401) return syncError('signin', 401, m);
    if (r.status === 403) return syncError(m === 'rec:unconfirmed' ? 'unconfirmed' : 'signin', 403, m);
    if (r.status === 409) return syncError('newer', 409, m);
    if (r.status === 429) return syncError('slow', 429, m);
    if (r.status >= 400 && r.status < 500) return syncError('bad', r.status, m);
    return syncError('net', r.status, m);
  }

  /* opt: { now: () => ms            the clock (Date.now when left out); advance() moves the model's own on from it
            setTimeout               when given, waits are real timers; otherwise they run from advance() and tick()
            signals: 'sync'|'held'   'held' keeps signals back until deliver() (see hold) } */
  function recModel(opt) {
    opt = opt || {};
    const clock = opt.now || Date.now;
    let ahead = 0;                         /* what advance() has added */
    const users = new Map();               /* id → { id, email, password, confirmed, anonymous } */
    const sessions = new Map();            /* session id → user id */
    const tokens = new Map();              /* token → { sid, uid, expired } */
    const owners = new Map();              /* user id → { n, fmt, nrows, bytes, win, winN, rows: Map(k → row) } */
    let channels = [];                     /* joined: { topic, priv, uid, token, got, on, open } */
    let waits = [];                        /* { at, fn } when no setTimeout was given */
    let held = opt.signals === 'held', queue = [];
    let cold = 0, losing = 0, seq = 0, online = true;
    const stats = { calls: 0, writes: 0, reads: 0, heads: 0, signals: 0 };

    const now = () => Math.floor(clock() + ahead);
    const uuid = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
    function later(ms, fn) {
      if (opt.setTimeout) { opt.setTimeout(fn, ms); return; }
      waits.push({ at: now() + ms, fn });
    }
    /* run what is due on the model's clock (only needed when the clock was moved from outside) */
    function tick() {
      for (;;) {
        const t = now(); let i = -1;
        for (let j = 0; j < waits.length; j++) if (waits[j].at <= t && (i < 0 || waits[j].at < waits[i].at)) i = j;
        if (i < 0) return;
        const w = waits.splice(i, 1)[0];
        w.fn();
      }
    }
    function advance(ms) { ahead += ms; tick(); }

    /* ---------- people and sessions (the sign-in service) ---------- */

    function addUser(u) {
      const id = (u && u.id) || uuid(++seq);
      users.set(id, { id, email: String((u && u.email) || id + '@zika.invalid').toLowerCase(), password: (u && u.password) || '', confirmed: !u || u.confirmed !== false, anonymous: !!(u && u.anonymous) });
      return id;
    }
    function confirm(id) { const u = users.get(id); if (u) u.confirmed = true; }
    /* a session for a person whatever their state: how a test reaches rec:unconfirmed, which the real sign-in
       door never lets happen */
    function session(uid) {
      const sid = uuid(++seq), token = 'tok.' + (++seq).toString(36) + '.' + sid.slice(-6);
      sessions.set(sid, uid); tokens.set(token, { sid, uid, expired: false });
      return { token, id: uid, sid };
    }
    function signIn(email, password) {
      stats.calls++;
      let u = null;
      for (const x of users.values()) if (x.email === String(email || '').toLowerCase()) u = x;
      if (!u || !password || u.password !== password) return answer(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (!u.confirmed) return answer(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      const s = session(u.id);
      return answer(200, { access_token: s.token, token_type: 'bearer', expires_in: 3600, user: { id: u.id, email: u.email } });
    }
    /* scope 'local': this session; 'others': every other session of the person; 'global': all of them */
    function signOut(token, scope) {
      stats.calls++;
      const t = tokens.get(token);
      if (!t || t.expired || !sessions.has(t.sid)) return refuse(401, 'invalid JWT', 'bad_jwt');
      for (const [sid, uid] of [...sessions]) {
        if (uid !== t.uid) continue;
        if (scope === 'global' || (scope === 'others' ? sid !== t.sid : sid === t.sid)) sessions.delete(sid);
      }
      return answer(204, null);
    }
    /* a token lasts an hour and is then exchanged for a new one, for as long as its session exists */
    function expire(token) { const t = tokens.get(token); if (t) t.expired = true; }
    function refresh(token) {
      stats.calls++;
      const t = tokens.get(token);
      if (!t || !sessions.has(t.sid)) return answer(400, { code: 400, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' });
      const fresh = 'tok.' + (++seq).toString(36) + '.' + t.sid.slice(-6);
      tokens.set(fresh, { sid: t.sid, uid: t.uid, expired: false });
      return answer(200, { access_token: fresh, token_type: 'bearer', expires_in: 3600, user: { id: t.uid } });
    }
    /* the account is deleted: its records go with it (on delete cascade), and its sessions */
    function deleteUser(id) {
      users.delete(id); owners.delete(id);
      for (const [sid, uid] of [...sessions]) if (uid === id) sessions.delete(sid);
    }

    /* Who a token is. gate: what the data API itself refuses before any SQL runs (no token: the anonymous role is
       granted nothing; a token nobody issued; a token past its hour). me: private.me(), the caller's id while the
       session exists, the email is confirmed and the person is not anonymous. */
    function who(token) {
      if (!token) return { gate: refuse(401, 'permission denied', '42501') };
      const t = tokens.get(token);
      if (!t) return { gate: refuse(401, 'JWSError JWSInvalidSignature', 'PGRST301') };
      if (t.expired) return { gate: refuse(401, 'JWT expired', 'PGRST303') };
      const u = users.get(t.uid), alive = sessions.has(t.sid) && !!u;
      return { uid: t.uid, user: u || null, me: alive && u.confirmed && !u.anonymous ? t.uid : null };
    }
    /* private.need_me(): the same, saying why not */
    function need(w) {
      if (w.me) return null;
      if (w.user && !w.user.confirmed) return refuse(403, 'rec:unconfirmed');
      return refuse(401, 'rec:signin');
    }

    /* ---------- rec_head() ---------- */

    function head(token) {
      stats.calls++; stats.heads++;
      const w = who(token); if (w.gate) return w.gate;
      const no = need(w); if (no) return no;
      const o = owners.get(w.me);
      return answer(200, { now: now(), n: o ? o.n : 0, v: o ? o.fmt : 0 });
    }

    /* ---------- rec_write(v, recs) ---------- */

    const rowBytes = r => LIM.overhead + bytes(r.k) + bytes(r.h) + (r.j === null ? 0 : bytes(r.j));
    function write(token, v, recs) {
      stats.calls++; stats.writes++;
      const w = who(token); if (w.gate) return w.gate;
      /* the call's JSON is read before the function runs, and a text the database cannot hold fails it there: U+0000
         when the body becomes jsonb (22P05), half a surrogate pair already in the data API (PGRST102). Both are a
         400 with no "rec:" message, as seen on the real project on 21 November 2026. */
      const p = poison(recs);
      if (p) return p === 'U+0000' ? refuse(400, 'unsupported Unicode escape sequence', '22P05') : refuse(400, 'Empty or invalid json', 'PGRST102');
      const no = need(w); if (no) return no;
      const uid = w.me;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > LIM.fmtMax || !Array.isArray(recs)) return refuse(400, 'rec:shape');
      if (recs.length > LIM.call) return refuse(400, 'rec:batch');

      /* the owner's row. Everything below is one transaction: a refusal of the whole call leaves nothing behind,
         not the row, not the format, not the minute's count. */
      const o = owners.get(uid) || { n: 0, fmt: 1, nrows: 0, bytes: 0, win: now(), winN: 0, rows: new Map() };
      const t = now();
      if (v < o.fmt) return refuse(409, 'rec:newer');
      let win = o.win, winN = o.winN;
      if (t - win > 60000) { win = t; winN = 0; }
      if (winN + recs.length > LIM.minute) return refuse(429, 'rec:slow');
      o.fmt = v; o.win = win; o.winN = winN + recs.length;
      owners.set(uid, o);

      /* forget what is due */
      for (const [k, r] of [...o.rows]) if (r.x !== null && r.x <= t) { o.rows.delete(k); o.nrows = Math.max(0, o.nrows - 1); o.bytes = Math.max(0, o.bytes - rowBytes(r)); }

      const out = []; let took = false;
      for (const el of recs) {
        if (!el || typeof el !== 'object' || Array.isArray(el)) { out.push({ no: 'shape' }); continue; }
        const k = typeof el.k === 'string' ? el.k : null, h = typeof el.h === 'string' ? el.h : null;
        const j = typeof el.j === 'string' ? el.j : null, d = el.d === true;
        if (k === null || bytes(k) < 3 || bytes(k) > LIM.key || !KEY_OK.test(k) || KEY_CTRL.test(k)) { out.push({ no: 'key' }); continue; }
        if (h === null || !STAMP_OK.test(h)) { out.push({ no: 'stamp' }); continue; }
        if (+h.slice(0, 13) > t + LIM.ahead) { out.push({ no: 'future' }); continue; }
        /* a value or the deleted mark, never both and never neither */
        if ((d && has(el, 'j')) || (!d && j === null) || (has(el, 'd') && typeof el.d !== 'boolean')) { out.push({ no: 'shape' }); continue; }
        if (j !== null && bytes(j) > LIM.value) { out.push({ no: 'size' }); continue; }
        let x = null;
        if (has(el, 't')) {
          const s = typeof el.t === 'number' && isFinite(el.t) ? el.t : null;
          if (s === null || s !== Math.trunc(s) || s < LIM.ttlMin || s > LIM.ttlMax) { out.push({ no: 'ttl' }); continue; }
          x = t + s * 1000;
        }
        const row = { k, h, j, d, n: 0, at: t, x }, sz = rowBytes(row), cur = o.rows.get(k);
        if (!cur) {
          if (o.nrows + 1 > LIM.rows || o.bytes + sz > LIM.bytes) { out.push({ no: 'full' }); continue; }
          row.n = ++o.n; o.rows.set(k, row); o.nrows++; o.bytes += sz; took = true;
          out.push({ n: row.n });
        } else if (h > cur.h) {
          const was = rowBytes(cur);
          if (sz > was && o.bytes - was + sz > LIM.bytes) { out.push({ no: 'full' }); continue; }
          row.n = ++o.n; o.rows.set(k, row); o.bytes = Math.max(0, o.bytes - was + sz); took = true;
          out.push({ n: row.n });
        } else if (h === cur.h && d === cur.d && j === cur.j) {
          out.push({ n: cur.n, same: true });
        } else {
          out.push({ old: cur.d ? { h: cur.h, d: true, n: cur.n } : { h: cur.h, j: cur.j, n: cur.n } });
        }
      }
      /* the signal: the new change number and nothing else, on the owner's private channel */
      if (took) signal('rec:' + uid, { event: 'n', type: 'broadcast', payload: { id: uuid(++seq), n: o.n } });
      return answer(200, { now: t, n: o.n, r: out });
    }

    /* ---------- reading the table ----------
       q: { cols: ['k','h','j','d','n'], after: n, k, keys: [k…], like: 'zt~abc*', owner, limit }
       A person reads their own rows that have not expired, in order of change number. A session that has ended,
       or a person whose email is not confirmed, is NOT refused here: the policy simply matches no row, and the
       answer is an empty list. (docs/sync.md: an empty page proves nothing.) */
    function rows(token, q) {
      stats.calls++; stats.reads++;
      q = q || {};
      const w = who(token); if (w.gate) return w.gate;
      const cols = q.cols || ['k', 'h', 'j', 'd', 'n'];
      for (const c of cols) if (!SERVED[c]) return refuse(403, 'permission denied for table rec', '42501');
      if (q.owner !== undefined) return refuse(403, 'permission denied for table rec', '42501');      /* a filter on a column nobody is granted */
      const o = w.me ? owners.get(w.me) : null, t = now(), list = [];
      if (o) for (const r of o.rows.values()) {
        if (r.x !== null && r.x <= t) continue;
        if (q.after !== undefined && !(r.n > q.after)) continue;
        if (q.k !== undefined && r.k !== q.k) continue;
        if (q.keys && q.keys.indexOf(r.k) < 0) continue;
        if (q.like !== undefined) { const star = q.like.indexOf('*'); if (star < 0 ? r.k !== q.like : !r.k.startsWith(q.like.slice(0, star))) continue; }
        list.push(r);
      }
      list.sort((a, b) => a.n - b.n);
      const cut = Math.min(LIM.page, q.limit === undefined ? LIM.page : Math.max(0, q.limit));
      return answer(200, list.slice(0, cut).map(r => { const x = {}; for (const c of cols) x[c] = r[c]; return x; }));
    }

    /* ---------- the signal: Realtime channels ----------
       A private channel `rec:<id>` can be joined by that person's signed-in device and nobody else; nobody can
       send on it. A public channel of the same name is another channel: anyone may join it and talk on it, and
       nothing said there reaches the private one. */
    function signal(topic, msg) {
      stats.signals++;
      if (held) { queue.push({ topic, msg }); return; }
      for (const c of channels.slice()) if (c.open && c.priv && c.topic === topic) take(c, msg);
    }
    function take(c, msg) { const m = JSON.parse(JSON.stringify(msg)); c.got.push(m); if (c.on) c.on(m); }
    /* hold(true): signals wait in a queue until deliver(); deliver(n) lets the first n through, drop() loses them */
    function hold(on) { held = on !== false; if (!held) deliver(); }
    function deliver(n) {
      const q = queue.splice(0, n === undefined ? queue.length : n);
      for (const s of q) for (const c of channels.slice()) if (c.open && c.priv && c.topic === s.topic) take(c, s.msg);
      return q.length;
    }
    function drop() { const n = queue.length; queue = []; return n; }
    /* o: { token, priv (true unless false), on(message) }. The answer is settled at once: status 'ok' or 'refused'. */
    function channel(topic, o) {
      o = o || {};
      const priv = o.priv !== false;
      const ch = { topic, priv, token: o.token || null, got: [], on: o.on || null, open: false, status: null, reason: '', uid: null };
      ch.close = () => { ch.open = false; channels = channels.filter(c => c !== ch); };
      ch.send = (event, payload) => {
        if (!ch.open) return false;
        if (priv) return false;                 /* there is no policy that lets anyone send: the message is dropped */
        for (const c of channels.slice()) if (c !== ch && c.open && !c.priv && c.topic === topic) take(c, { event, type: 'broadcast', payload });
        return true;
      };
      const w = o.token ? who(o.token) : { me: null };
      ch.uid = w.me || null;
      let reason = '';
      if (!online) reason = 'socket closed';
      else if (o.token && w.gate) reason = 'InvalidJWTToken: ' + w.gate.json.message;
      else if (priv && !(w.me && topic === 'rec:' + w.me)) reason = 'Unauthorized: You do not have permissions to read from this Channel topic: ' + topic;
      else if (cold > 0) { cold--; reason = 'MissingPartition: the partition for today\'s messages does not exist yet'; }
      if (reason) { ch.status = 'refused'; ch.reason = reason; }
      else { ch.status = 'ok'; ch.open = true; channels.push(ch); }
      ch.joined = Promise.resolve(ch.status);
      ch.wait = pred => Promise.resolve(ch.got.some(pred));
      return ch;
    }

    /* ---------- the adapter (docs/sync.md, "The adapter") ----------
       What the engine is given by syConnect(): four functions over the doors above, answering with promises and
       refusing with typed errors. sySupabase() is the same four over the real doors. */
    function adapter(token, ao) {
      ao = ao || {};
      const t0 = tokens.get(token);
      let tok = token, up = ao.online !== false;
      const listeners = [];
      /* one call to a door: the line may be down, the token may be past its hour (exchanged once, then tried
         again), the answer may be lost on the way back */
      function call(door) {
        return new Promise((resolve, reject) => {
          if (!up || !online) { reject(syncError('net', 0, 'offline')); return; }
          let r = door(tok);
          if (r.status === 401 && r.json && r.json.message === 'JWT expired') {
            const f = refresh(tok);
            if (f.status === 200) { tok = f.json.access_token; r = door(tok); }
            else { reject(syncError('signin', 401, 'the session has ended')); return; }
          }
          if (losing > 0) { losing--; reject(syncError('net', 0, 'the answer was lost')); return; }
          const e = typed(r);
          if (e) reject(e); else resolve(r.json);
        });
      }
      const A = {
        uid: t0 ? t0.uid : null,
        head: () => call(k => head(k)),
        /* one page: the rows after a change number, in order, at most LIM.page of them */
        read: after => call(k => rows(k, { after: after || 0, limit: LIM.page })),
        write: (v, recs) => call(k => write(k, v, recs)),
        /* onSignal(n) for every signal; onState('joined') each time the channel is joined, onState('down', why)
           when it is not (the adapter goes on trying), onState('signin' | 'unconfirmed') when it has stopped
           because the person is no longer signed in. Returns the function that stops it. */
        listen(onSignal, onState) {
          const L = { stopped: false, ch: null, tries: 0 };
          const say = (s, why) => { Promise.resolve().then(() => { if (!L.stopped && onState) onState(s, why); }); };
          const join = () => {
            if (L.stopped || L.ch) return;
            if (!up || !online) { say('down', 'offline'); return; }       /* joins again when the line is back */
            const ch = channel('rec:' + A.uid, { token: tok, on: m => { if (!L.stopped && m && m.event === 'n' && m.payload && typeof m.payload.n === 'number') onSignal(m.payload.n); } });
            if (ch.status === 'ok') { L.ch = ch; L.tries = 0; say('joined'); return; }
            /* refused: because the person is signed out (then stop), or for a reason that passes (then try again) */
            let h = head(tok);
            if (h.status === 401 && h.json.message === 'JWT expired') { const f = refresh(tok); if (f.status === 200) { tok = f.json.access_token; h = head(tok); } }
            const e = typed(h);
            if (e && (e.type === 'signin' || e.type === 'unconfirmed')) { say(e.type, ch.reason); return; }
            say('down', ch.reason);
            L.tries++;
            later(Math.min(60000, 1000 * Math.pow(2, L.tries)), join);
          };
          L.rejoin = () => { if (L.ch) { L.ch.close(); L.ch = null; } join(); };
          L.down = why => { if (L.ch) { L.ch.close(); L.ch = null; say('down', why); } };
          listeners.push(L);
          join();
          return () => { L.stopped = true; if (L.ch) L.ch.close(); L.ch = null; };
        },
        /* for tests: this device's line goes down, or comes back (the channel is joined again) */
        online(on) {
          up = on !== false;
          for (const L of listeners) { if (L.stopped) continue; if (up) L.rejoin(); else L.down('offline'); }
        },
        /* for tests: the socket drops and is joined again, as after a sleeping phone wakes */
        rejoin() { for (const L of listeners) if (!L.stopped) { L.down('socket closed'); L.rejoin(); } }
      };
      return A;
    }

    /* ---------- staging ---------- */

    return {
      LIM, now, advance, tick, stats,
      addUser, confirm, deleteUser, session, signIn, signOut, expire, refresh,
      head, write, rows, channel, adapter,
      hold, deliver, drop,
      /* the next n joins that would be taken are refused once, as on a project nobody has listened to for days */
      cold(n) { cold = n === undefined ? 1 : n; },
      /* the next n adapter calls reach the store and their answers are lost on the way back */
      lose(n) { losing = n === undefined ? 1 : n; },
      /* the whole service is unreachable, or back */
      online(on) { online = on !== false; if (!online) for (const c of channels.slice()) c.close(); },
      /* a person's records as they are, and put back as they were: a cloud restored from an earlier day */
      snapshot(uid) { const o = owners.get(uid); return o ? JSON.stringify({ n: o.n, fmt: o.fmt, nrows: o.nrows, bytes: o.bytes, win: o.win, winN: o.winN, rows: [...o.rows.values()] }) : null; },
      restore(uid, snap) {
        if (!snap) { owners.delete(uid); return; }
        const p = JSON.parse(snap);
        owners.set(uid, { n: p.n, fmt: p.fmt, nrows: p.nrows, bytes: p.bytes, win: p.win, winN: p.winN, rows: new Map(p.rows.map(r => [r.k, r])) });
      },
      /* every row a person holds, expired or not, with the columns nobody is served: for a test's own eyes */
      peek(uid) { const o = owners.get(uid); return o ? { n: o.n, fmt: o.fmt, nrows: o.nrows, bytes: o.bytes, rows: [...o.rows.values()].sort((a, b) => a.n - b.n).map(r => Object.assign({}, r)) } : null; }
    };
  }

  recModel.LIM = LIM;
  recModel.bytes = bytes;
  recModel.unstorable = unstorable;
  recModel.typed = typed;
  recModel.error = syncError;
  return recModel;
});

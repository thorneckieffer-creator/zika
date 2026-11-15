/* An in-memory Realtime Database for the sync tests, and the adapter the engine talks to it through.

   It behaves like the real one where that matters to the engine:
   - the server is dumb: a write replaces what is there, in the order writes arrive, and stamps `m` with its own clock;
   - with { rule: true } it applies the one rule docs/sync.md asks for: a record whose stamp `h` is older than the
     stored one is refused, and one refused record refuses the whole multi-path update;
   - a client's writes go up in the order it made them, are queued while it is offline, and are sent again after a
     disconnect if their acknowledgement had not arrived;
   - a client hears its own writes at once (with its own guess at the server time) and everyone's once committed.
   And it is worse than the real one where that makes a better test: events and acknowledgements are delivered one
   at a time in random order, some twice, and everything undelivered is dropped when a client goes offline.

   Nothing here runs by itself. The test decides what happens next: conn.send(), conn.deliver(), conn.catchUp(). */
'use strict';

/* a small seeded generator: the same seed replays the same run */
function rng32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isTs = v => v && typeof v === 'object' && v['.sv'] === 'timestamp';

class Cloud {
  constructor(opt) {
    opt = opt || {};
    this.rng = opt.rng || Math.random;
    this.rule = !!opt.rule;
    this.dup = opt.dup == null ? 0.15 : opt.dup;      /* chance that a delivered event is delivered again later */
    this.time = opt.time || 1800000000000;            /* the true time; the test moves it */
    this.lastM = 0;
    this.tree = {};                                   /* 'users/<uid>' → { rec: {key: record}, meta: {...} } */
    this.conns = [];
    this.up = 0; this.down = 0; this.writes = 0; this.refused = 0;
  }
  node(base) { return this.tree[base] || (this.tree[base] = { rec: {}, meta: null }); }
  connect(opt) { const c = new Conn(this, opt || {}); this.conns.push(c); return c; }
  read(path) {
    const p = path.split('/'), n = this.tree[p[0] + '/' + p[1]];
    if (!n) return null;
    if (p.length === 2) return clone({ rec: n.rec, meta: n.meta });
    if (p[2] === 'meta') return clone(n.meta);
    if (p[2] === 'rec') return p.length === 3 ? clone(n.rec) : clone(n.rec[p.slice(3).join('/')] || null);
    return null;
  }
  /* one multi-path update arrives. Returns null, or the error that refuses it. */
  commit(from, base, map) {
    const n = this.node(base);
    this.up += JSON.stringify(map).length; this.writes++;
    for (const path in map) {
      const v = map[path];
      if (path.slice(0, 4) !== 'rec/' || v === null) continue;
      if (!v || typeof v.h !== 'string' || !isTs(v.m)) { this.refused++; return new Error('PERMISSION_DENIED: record must carry h and the server time'); }
      const old = n.rec[path.slice(4)];
      if (this.rule && old && old.h > v.h) { this.refused++; return new Error('PERMISSION_DENIED: Permission denied'); }
    }
    for (const path in map) {
      const v = map[path];
      if (path === 'meta/v') { n.meta = Object.assign({}, n.meta, { v }); continue; }
      if (path.slice(0, 4) !== 'rec/') continue;
      const key = path.slice(4);
      if (v === null) { delete n.rec[key]; continue; }
      const rec = clone(v);
      rec.m = this.lastM = Math.max(this.lastM + 1, Math.floor(this.time));
      n.rec[key] = rec;
      for (const c of this.conns) if (c.online) for (const l of c.listeners)
        if (l.ready && l.path === base + '/rec' && (l.startAt == null || rec.m >= l.startAt)) c.inbox.push({ t: 'child', l, key, val: clone(rec), size: key.length + JSON.stringify(rec).length });
    }
    return null;
  }
  /* is anything still on its way? */
  idle() { return this.conns.every(c => c.dead || (!c.writes.length && !c.inbox.length && c.listeners.every(l => l.ready || !c.online))); }
}

class Conn {
  constructor(cloud, opt) {
    this.cloud = cloud; this.online = opt.online !== false; this.dead = false;
    this.clock = opt.clock || (() => cloud.time);      /* this device's own idea of the time */
    this.knowsServerTime = opt.knowsServerTime !== false;
    this.writes = [];        /* made, not yet at the server */
    this.inbox = [];         /* events and acknowledgements, not yet delivered */
    this.listeners = [];
    this.everOnline = false;
    this.down = 0;           /* bytes this client has been sent */
  }
  /* ---- the adapter (docs/sync.md) ---- */
  update(base, map) {
    return new Promise((resolve, reject) => {
      if (this.dead) return;
      this.writes.push({ base, map: clone(map), resolve, reject });
      for (const l of this.listeners) if (l.path === base + '/rec') for (const path in map) {      /* the client hears itself first */
        const v = map[path];
        if (path.slice(0, 4) === 'rec/' && v !== null) { const rec = clone(v); rec.m = Math.floor(this.clock()); this.inbox.push({ t: 'child', l, key: path.slice(4), val: rec, size: 0 }); }
      }
    });
  }
  get(path) {
    if (this.dead) return new Promise(() => {});
    if (!this.online) return Promise.reject(new Error('Error: Client is offline.'));
    const v = this.cloud.read(path);
    this.got(v == null ? 4 : JSON.stringify(v).length);
    return Promise.resolve(v);
  }
  listen(path, o, onChild, onReady, onErr) {
    const l = { path, startAt: o && o.startAt != null ? o.startAt : null, onChild, onReady, onErr, ready: false, off: false };
    this.listeners.push(l);
    return () => { l.off = true; const i = this.listeners.indexOf(l); if (i > -1) this.listeners.splice(i, 1); };
  }
  serverNow() { return this.knowsServerTime && this.everOnline ? this.cloud.time : null; }
  got(n) { this.down += n; this.cloud.down += n; }

  /* ---- what the test makes happen ---- */
  /* the oldest queued write reaches the server */
  send() {
    if (this.dead || !this.online || !this.writes.length) return false;
    const w = this.writes.shift();
    const err = this.cloud.commit(this, w.base, w.map);
    this.inbox.push({ t: 'ack', w, err });
    return true;
  }
  /* one waiting event or acknowledgement is delivered — any one, not the oldest */
  deliver() {
    if (this.dead || !this.inbox.length) return false;
    const r = this.cloud.rng, i = Math.floor(r() * this.inbox.length), ev = this.inbox.splice(i, 1)[0];
    if (ev.t === 'ack') { if (ev.err) ev.w.reject(ev.err); else ev.w.resolve(); return true; }
    if (!ev.again && r() < this.cloud.dup) this.inbox.push(Object.assign({}, ev, { again: true, size: 0 }));
    if (!ev.l.off) { this.got(ev.size); ev.l.onChild(ev.key, clone(ev.val)); }
    return true;
  }
  /* a listener that is not caught up gets everything from its starting point, in any order, then "ready" */
  catchUp() {
    if (this.dead || !this.online) return false;
    let did = false;
    for (const l of this.listeners.slice()) {
      if (l.ready || l.off) continue;
      const p = l.path.split('/'), n = this.cloud.node(p[0] + '/' + p[1]), r = this.cloud.rng, list = [];
      for (const key in n.rec) if (l.startAt == null || n.rec[key].m >= l.startAt) list.push(key);
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      for (const key of list) {
        if (l.off) break;
        this.got(key.length + JSON.stringify(n.rec[key]).length);
        l.onChild(key, clone(n.rec[key]));
        if (r() < this.cloud.dup / 3) l.onChild(key, clone(n.rec[key]));
      }
      l.ready = true; did = true;
      if (!l.off) l.onReady();
    }
    return did;
  }
  setOnline(on) {
    if (this.dead || this.online === on) return;
    this.online = on;
    if (on) { this.everOnline = true; return; }
    /* the line drops: events on their way are lost; writes whose acknowledgement was on its way will be sent again */
    const again = this.inbox.filter(ev => ev.t === 'ack').map(ev => ev.w);
    this.inbox = [];
    this.writes = again.concat(this.writes);
    for (const l of this.listeners) l.ready = false;
  }
  /* the page is closed: nothing queued in memory survives, no callback fires again */
  kill() { this.dead = true; this.writes = []; this.inbox = []; this.listeners.forEach(l => { l.off = true; }); this.listeners = []; }
}

/* a localStorage stand-in. cap: fail like a full disk once the stored text is longer than this */
function memStore(cap) {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { v = String(v); if (cap && v.length > cap) throw new Error('QuotaExceededError'); m.set(k, v); },
    removeItem: k => { m.delete(k); },
    size: () => { let n = 0; for (const [k, v] of m) n += k.length + v.length; return n; }
  };
}

/* let promise callbacks run */
const tick = () => new Promise(r => setImmediate(r));

module.exports = { Cloud, Conn, rng32, clone, memStore, tick };

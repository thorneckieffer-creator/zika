/* Devices for the sync tests: each is a state, a localStorage stand-in, a connection to the in-memory cloud and an
   engine, the way one copy of the app would hold them. */
'use strict';
const sy = require(process.env.SY_FILE || '../../../js/sync-records.js');      /* SY_FILE: run the tests against another copy of the engine */
const { Cloud, clone, memStore, tick } = require('./cloud.js');
const { dayOf } = require('./deck.js');

const emptyState = () => ({ cards: {}, settings: { retention: 0.9, newPerDay: 9, maxRev: 200, modes: { rec: true, prod: true } }, log: {}, intro: {}, hist: { d: [], s: [] } });

function makeRig(opt) {
  opt = opt || {};
  const cloud = new Cloud(opt);
  const rig = { cloud, devs: [], uid: opt.uid || 'u1' };

  /* o: { skew: ms this device's clock is off by, online, knowsServerTime, store, cap } */
  rig.device = (id, S, o) => {
    o = o || {};
    const d = { id, S: S || emptyState(), skew: o.skew || 0, store: o.store || memStore(o.cap), changes: 0, lost: [], undo: [], opt: o };
    d.now = () => cloud.time + d.skew;
    d.save = () => sy.syOnSave(d.E);
    rig.devs.push(d);
    rig.boot(d, o.online);
    return d;
  };
  /* a fresh page: new connection, new engine, same state and same stored shadow */
  rig.boot = (d, online) => {
    if (d.conn) d.conn.kill();
    d.conn = cloud.connect({ online: online !== false, clock: d.now, knowsServerTime: d.opt.knowsServerTime });
    if (d.conn.online) d.conn.everOnline = true;
    d.undo = [];
    d.E = sy.syCreate({
      state: () => d.S, store: d.store, adapter: d.conn, node: d.id, now: d.now, day: dayOf, timers: false, local: d.opt.local,
      onChange: res => { d.changes++; d.undo.length = 0; if (res.lost) d.lost.push(...res.lost); if (d.cannotStore) return false; }
    });
    return d;
  };
  rig.start = (d, o) => sy.syStart(d.E, Object.assign({ uid: rig.uid }, o));
  rig.reload = (d, o) => { rig.boot(d, d.conn.online); return rig.start(d, o); };

  /* run the network and the engines until nothing is left to do */
  rig.settle = async (devs, max) => {
    devs = devs || rig.devs;
    for (let round = 0; round < (max || 3000); round++) {
      let did = false;
      for (const d of devs) {
        if (!d.E.live) continue;
        if (d.conn.catchUp()) did = true;
        while (d.conn.send()) did = true;
        while (d.conn.deliver()) did = true;
        await tick();
        if (sy.syPump(d.E)) did = true;
        sy.syFlush(d.E, true);
        await tick();
        if (d.conn.writes.length && d.conn.online) did = true;
      }
      if (!did && devs.every(d => !d.E.live || !d.conn.online || (!d.conn.inbox.length && !d.E.inbox.length && !d.E.busy))) return round;
    }
    throw new Error('the devices did not settle');
  };
  rig.pending = d => Object.keys(d.E.q).filter(k => !d.E.park[k]);
  rig.rec = key => cloud.node('users/' + rig.uid).rec[key];
  rig.recs = () => cloud.node('users/' + rig.uid).rec;
  return rig;
}

/* ---- comparing states ---- */
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
/* What "the same deck" means: device-local settings and the derived snapshot aside, and without the differences the
   app itself cannot see (a day counted as zero and a day not listed; an empty container and a missing one).
   sibFrom: sibling claims are compared from this day on. */
function normal(S, o) {
  o = o || {};
  const t = clone(S), local = o.local || sy.SY_LOCAL;
  delete t.conf;
  t.settings = t.settings || {}; for (const k of local) delete t.settings[k];
  const zero = m => { const out = {}; if (m && typeof m === 'object') for (const k in m) if (m[k]) out[k] = m[k]; return out; };
  const log = {}; for (const d in t.log || {}) { const e = t.log[d] || {}; if (e.rev || e.new) log[d] = { rev: e.rev || 0, new: e.new || 0 }; }
  t.log = log; t.intro = zero(t.intro); t.cintro = zero(t.cintro); t.gintro = zero(t.gintro);
  const sib = {}; for (const d in t.sib || {}) if (!(o.sibFrom && d < o.sibFrom) && Object.keys(t.sib[d] || {}).length) sib[d] = t.sib[d];
  t.sib = sib;
  for (const f of ['gram', 'cf', 'listen', 'us', 'read', 'cards']) t[f] = t[f] || {};
  for (const f of ['hard', 'pick']) t[f] = t[f] || [];
  /* a day listed twice counts once (its later entry), and the days are compared in order */
  const hd = {}; if (t.hist && t.hist.d) t.hist.d.forEach((d, i) => { hd[d] = t.hist.s[i]; });
  t.hist = { d: Object.keys(hd).sort(), s: Object.keys(hd).sort().map(d => hd[d]) };
  if (t.my) {
    const my = t.my; my.w = my.w || {}; my.c = my.c || {}; my.tp = my.tp || []; my.intro = zero(my.intro); my.log = zero(my.log);
    if (!Object.keys(my.w).length && !Object.keys(my.c).length && !my.tp.length && !Object.keys(my.intro).length && !Object.keys(my.log).length && Object.keys(my).every(k => ['w', 'c', 'tp', 'intro', 'log', 'n', 'tn'].includes(k)) && !(my.n > 1) && !my.tn) delete t.my;
  }
  if (t.mtest && !Object.keys(t.mtest.res || {}).length && Object.keys(t.mtest).length <= 1) delete t.mtest;
  if (t.mtest) t.mtest.res = t.mtest.res || {};
  if (t.tone) t.tone.w = t.tone.w || {};
  return sortKeys(t);
}
/* the first place two normalised states differ, for a failure message */
function firstDiff(a, b, path) {
  path = path || 'S';
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return path + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b);
  for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) { const d = firstDiff(a[k], b[k], path + '.' + k); if (d) return d.slice(0, 400); }
  return path;
}

module.exports = { makeRig, emptyState, normal, firstDiff, sortKeys, sy, clone, tick, dayOf, memStore };

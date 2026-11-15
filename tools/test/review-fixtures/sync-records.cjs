/* 字卡 — sync by record (sy*), js/sync-records.js.  Notes: docs/sync.md.  Not loaded by the app yet.
   (js/sync.js is, or will be, the old whole-deck sync, fb*: this file replaces what that one does, not the file.)

   The deck stays exactly as the app keeps it: one object `S`, saved under the same key. This file works beside it.
   It keeps a *shadow* — for every record, the stamp and a hash of the value it last agreed with the cloud — and
     syDiff   compares S with the shadow and stamps what changed (those records are then pending),
     syApply  takes records from the cloud and writes the ones that win into S,
     syJoin   is the first sync of a device: cloud and device are merged record by record,
     syImport merges an old whole-deck blob the same way.
   The cloud is reached only through an adapter (update / get / listen), so the same code runs against the in-memory
   cloud in tools/test/ and against the Firebase SDK (syFirebase).

   Classic script: everything here is a global named sy… / SY_…, nothing runs at load, and the file ends with a
   guarded module.exports so Node can load it for the tests. */
'use strict';

const SY_V = 1;                          /* version of the record format, stored at users/<uid>/meta/v */
const SY_STORE = 'zika_sy_v1';           /* where the shadow, the pending set and the clock are kept on the device */
const SY_TS = { '.sv': 'timestamp' };    /* Realtime Database's placeholder: the server writes its own clock here */
const SY_DRIFT = 5 * 60 * 1000;          /* a stamp further ahead of this device than this never moves its clock */
const SY_BATCH = 400;                    /* records per multi-path update */
const SY_LAZY = 60 * 1000;               /* bulky session records (a test run in progress) go up at most this often */
const SY_DEBOUNCE = 1500;                /* a save is pushed this long after the last one */
const SY_OVERLAP = 1000;                 /* catch-up starts this far before the cursor */
const SY_SLACK = 60 * 1000;              /* how far the server-time estimate is trusted when the cursor moves on it */
const SY_HIST_CAP = 180;                 /* the app keeps this many daily snapshots */
const SY_SIB_DAYS = 2;                   /* sibling claims older than this are forgotten */
const SY_MY_DAYS = 119;                  /* My words prunes its day counters at 120 entries: older days are left alone */
const SY_WMAX = 101559956668415;         /* 36^9 - 1: the largest wall-clock value a stamp can hold */
const SY_LOCAL = ['voiceName', 'audioSrc', 'theme', 'lastBackup', 'bkName', 'autoBackup', 'haptics', '_bkWarned', 'preloadedAt'];
const SY_DERIVED = ['conf'];             /* rebuilt by the app on every save: never synced */
const SY_E = Object.freeze({});
const SY_DEAD = 'd00000000000';          /* shadow entry of a tombstone, before its stamp */

const syHas = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const syEmpty = v => v == null || (typeof v === 'object' && !Object.keys(v).length);

/* ---------- small tools ---------- */

/* A 55-bit string hash (the cyrb53 mix), written as 11 characters 0-9a-v: enough that a changed value is never
   taken for an unchanged one. It runs over every record on every save, hence the hand-built string. */
const syC = x => x + (x < 10 ? 48 : 87);
function syHash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return String.fromCharCode(syC(h1 & 31), syC(h1 >>> 5 & 31), syC(h1 >>> 10 & 31), syC(h1 >>> 15 & 31), syC(h1 >>> 20 & 31), syC(h1 >>> 25 & 31),
    syC(h2 & 31), syC(h2 >>> 5 & 31), syC(h2 >>> 10 & 31), syC(h2 >>> 15 & 31), syC(h2 >>> 20 & 31));
}

/* Realtime Database keys cannot hold . $ # [ ] / or control characters; % is ours */
const SY_BAD = /[.$#\[\]\/%\u0000-\u001f\u007f]/;
function syEnc(id) {
  id = String(id);
  return SY_BAD.test(id) ? id.replace(/[.$#\[\]\/%\u0000-\u001f\u007f]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')) : id;
}
function syDec(k) { return k.indexOf('%') < 0 ? k : k.replace(/%([0-9a-f]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); }

/* the day a moment falls on, written the way the app writes it (local time) */
function syDay(E, ms) {
  if (E.env.day) return E.env.day(ms);
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------- the clock: a hybrid logical clock ----------
   A stamp is  <wall-clock ms, 9 digits base 36><counter, 3 digits><node>  and stamps are compared as plain strings.
   The wall part follows the device's clock (corrected by the server's, once known) but never goes backwards; the
   counter orders events inside one millisecond; the node (the device id) makes every stamp unique. */
function syP36(n, w) { return Math.floor(n).toString(36).padStart(w, '0'); }
function syStamp(wall, ctr, node) { return syP36(Math.min(SY_WMAX, Math.max(0, wall || 0)), 9) + syP36(ctr, 3) + node; }
function syWall(st) { return parseInt(st.slice(0, 9), 36); }
function syCtr(st) { return parseInt(st.slice(9, 12), 36); }
function syStampOk(st) { return typeof st === 'string' && st.length > 12 && st.length < 64 && /^[0-9a-z]{12}[0-9A-Za-z_-]+$/.test(st); }
function syNow(E) { return E.env.now() + (E.off || 0); }
function syTick(E) {
  const p = Math.floor(syNow(E));
  if (p > E.hw) { E.hw = p; E.hc = 0; } else if (++E.hc > 46655) { E.hw++; E.hc = 0; }
  return syStamp(E.hw, E.hc, E.node);
}
/* the stamp for a change to a record whose current stamp is `base`: later than now and later than `base`.
   When `base` is ahead of this device's clock (it came from a device whose clock runs fast) only this record's
   time moves on: the device's own clock is not dragged forward. */
function syAfter(E, base) {
  const t = syTick(E);
  if (!base || t > base) return t;
  let w = syWall(base), c = syCtr(base) + 1;
  if (c > 46655) { w++; c = 0; }
  return syStamp(w, c, E.node);
}
/* a stamp seen from another device moves this clock on, unless it is implausibly far ahead */
function syObserve(E, st) {
  const w = syWall(st);
  if (!(w <= syNow(E) + SY_DRIFT)) return false;
  const c = syCtr(st);
  if (w > E.hw) { E.hw = w; E.hc = c; } else if (w === E.hw && c > E.hc) E.hc = c;
  return true;
}
/* a stamp for a change that is not the learner acting now: start-up housekeeping and migrations, a deck that was
   never synced, an imported blob. It sits just after the version it replaced (or at the beginning of time when
   there was none), so anything a person did since, on any device, beats it. A card carries its own evidence: the
   time of its last review. */
function sySoft(E, kind, v, e, h) {
  let st;
  if (e) { const b = e.slice(12); let w = syWall(b), c = syCtr(b) + 1; if (c > 46655) { w++; c = 0; } st = syStamp(w, c, E.node); }
  else st = syStamp(0, 0, '0' + h.slice(0, 7));
  if (kind && kind.card && v && typeof v.last === 'number' && v.last > 0 && v.last < SY_WMAX) {
    const t = syStamp(v.last, 0, e ? E.node : '0' + h.slice(0, 7));
    if (t > st) st = t;
  }
  return st;
}

/* ---------- compact forms ---------- */

/* A card is most of the deck, so it travels as one short line:  st,S,D,due,last,reps,lapses,days[,flags[,mastAt[,{extras}]]]
   ('' is a card that is queued but not started). Anything that does not fit the usual shape goes through untouched. */
const SY_ST = { learn: 'l', rev: 'r', relearn: 'x' }, SY_STR = { l: 'learn', r: 'rev', x: 'relearn' };
const SY_CNUM = ['S', 'D', 'due', 'last', 'reps', 'lapses', 'days'];
function syPackCard(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { $: c };
  const keys = Object.keys(c);
  if (!keys.length) return '';
  const st = SY_ST[c.st];
  if (!st) return { $: c };
  for (const f of SY_CNUM) if (typeof c[f] !== 'number' || !isFinite(c[f]) || Object.is(c[f], -0)) return { $: c };
  let s = st; for (const f of SY_CNUM) s += ',' + c[f];
  let fl = ''; if (c.known === 1) fl += 'k'; if (c.susp === 1) fl += 's'; if (c.leech === 1) fl += 'h';
  const m = typeof c.mastAt === 'number' && isFinite(c.mastAt) && !Object.is(c.mastAt, -0) ? String(c.mastAt) : '';
  let ex = null;
  for (const k of keys) {
    if (k === 'st' || SY_CNUM.indexOf(k) > -1) continue;
    if ((k === 'known' || k === 'susp' || k === 'leech') && c[k] === 1) continue;
    if (k === 'mastAt' && m) continue;
    if (c[k] === undefined) continue;
    (ex || (ex = {}))[k] = c[k];
  }
  if (fl || m || ex) s += ',' + fl;
  if (m || ex) s += ',' + m;
  if (ex) s += ',' + JSON.stringify(ex);
  return s;
}
function syUnpackCard(x) {
  if (x === '') return {};
  if (typeof x !== 'string') return x && typeof x === 'object' && syHas(x, '$') ? x.$ : x;
  const p = x.split(',');
  const c = { st: SY_STR[p[0]], S: +p[1], D: +p[2], due: +p[3], last: +p[4], reps: +p[5], lapses: +p[6], days: +p[7] };
  if (p.length > 8) { const fl = p[8]; if (fl.indexOf('k') > -1) c.known = 1; if (fl.indexOf('s') > -1) c.susp = 1; if (fl.indexOf('h') > -1) c.leech = 1; }
  if (p.length > 9 && p[9] !== '') c.mastAt = +p[9];
  if (p.length > 10) Object.assign(c, JSON.parse(p.slice(10).join(',')));
  return c;
}
/* A daily snapshot is one digit per word, mostly long runs: 0000000 becomes 0(7) */
function syPack(s) {
  if (typeof s !== 'string' || !/^[0-9]*$/.test(s)) return { $: s };
  let o = '', i = 0;
  while (i < s.length) { let j = i + 1; while (j < s.length && s[j] === s[i]) j++; const n = j - i; o += n > 3 ? s[i] + '(' + n.toString(36) + ')' : s.slice(i, j); i = j; }
  return o;
}
function syUnpack(x) {
  if (typeof x !== 'string') return x && typeof x === 'object' && syHas(x, '$') ? x.$ : x;
  return x.replace(/([0-9])\(([0-9a-z]+)\)/g, (m, c, n) => c.repeat(Math.min(100000, parseInt(n, 36))));
}

/* ---------- the record kinds: where each part of S lives as records ----------
   A kind says how to read its records out of a state (`all`: id → value) and how to write one back (`put`; a value
   of undefined deletes). Optional: enc/dec (compact form), cur (one value, when `all` would be wasteful),
   rank (see syRank), stale (records that are forgotten instead of deleted), lazy, card. */
function syMap(k, get, extra) {
  return Object.assign({
    k,
    all(S) { return get(S, false); },
    put(S, id, v) { const m = get(S, v !== undefined); if (!m) return; if (v === undefined) delete m[id]; else m[id] = v; }
  }, extra || {});
}
function syInside(k, f, sub) {
  return { k,
    all(S) { const t = S[f]; return t && typeof t === 'object' && t[sub] && typeof t[sub] === 'object' ? t[sub] : null; },
    put(S, id, v) { const t = S[f]; if (!t || typeof t !== 'object') return v === undefined ? undefined : false; if (v === undefined) { if (t[sub]) delete t[sub][id]; } else (t[sub] || (t[sub] = {}))[id] = v; } };
}
const syMyNew = () => ({ n: 1, w: {}, c: {}, intro: {}, log: {}, tp: [] });
function syMy(S, make) { return S.my && typeof S.my === 'object' ? S.my : (make ? (S.my = syMyNew()) : null); }
function syOmit(v, keys) { const o = {}; let n = 0; for (const f in v) if (keys.indexOf(f) < 0 && v[f] !== undefined) { o[f] = v[f]; n++; } return n ? o : null; }

/* An ordered list (the hard list, the up-next list, the topics) is a set of member records plus one order record.
   A member's value carries `a`, the stamp it was added with; the list's order is: the members named in the order
   record, in its order, then the rest by `a`. So adding and removing touch one record each, and only a deliberate
   reorder rewrites the order record. */
function syList(k, arr, idOf, mk, pay, pre) {
  return {
    k, list: true, arr, id: idOf, pay: !!pay,
    val(a, item) { return pay ? Object.assign({ a }, pay(item)) : a; },
    cur(S, E, id) {
      const A = E.ord[k]; if (!A || !syHas(A.a, id)) return undefined;
      const L = arr(S, false); if (!L) return undefined;
      const it = L.find(x => idOf(x) === id);
      return it === undefined ? undefined : this.val(A.a[id], it);
    },
    put(S, id, v, E) {
      const A = E.ord[k] || (E.ord[k] = { o: null, a: {} }), L = arr(S, v !== undefined);
      E.dl[k] = 1;
      if (pre) pre(S, id, v);
      if (v === undefined) { delete A.a[id]; if (L) { const i = L.findIndex(x => idOf(x) === id); if (i > -1) L.splice(i, 1); } return; }
      A.a[id] = typeof v === 'string' ? v : (v && typeof v.a === 'string' ? v.a : '');
      const it = mk(id, v), i = L.findIndex(x => idOf(x) === id);
      if (i > -1) L[i] = it; else L.push(it);
    }
  };
}
function syCanon(A, ids) {
  const pos = Object.create(null);
  if (A.o) A.o.forEach((id, i) => { if (!(id in pos)) pos[id] = i; });
  return ids.slice().sort((x, y) => {
    const px = x in pos ? pos[x] : 1e9, py = y in pos ? pos[y] : 1e9;
    if (px !== py) return px - py;
    const ax = A.a[x] || '', ay = A.a[y] || '';
    return ax < ay ? -1 : ax > ay ? 1 : x < y ? -1 : x > y ? 1 : 0;
  });
}

const SY_OWNED = { cards: 1, settings: 1, log: 1, intro: 1, cintro: 1, gintro: 1, hard: 1, pick: 1, hist: 1, sib: 1, gram: 1, cf: 1, listen: 1, us: 1, read: 1 };
const SY_SPLIT = { mtest: ['res'], tone: ['w'], my: ['w', 'c', 'intro', 'log', 'tp', 'n', 'tn'] };
const SY_SPLIT_NEW = { mtest: () => ({ res: {} }), tone: () => ({ w: {} }), my: syMyNew };

function syKinds(E) {
  const loc = E.local, der = E.derived;
  const card = { card: true, enc: syPackCard, dec: syUnpackCard };
  const sub = f => (S, mk) => { const o = S[f] && typeof S[f] === 'object' ? S[f] : null; return o || (mk ? (S[f] = {}) : null); };
  const K = [
    /* c  the course's cards, `w123:rec`, `w123:prod`, `g:n22-1` */
    syMap('c', sub('cards'), card),
    /* s  one record per setting; device-local settings never leave the device */
    { k: 's',
      all(S) { const s = S.settings; if (!s || typeof s !== 'object') return null; const o = {}; for (const k in s) if (!loc[k]) o[k] = s[k]; return o; },
      cur(S, E2, id) { return loc[id] || !S.settings ? undefined : S.settings[id]; },
      put(S, id, v) { if (loc[id]) return; const s = S.settings || (S.settings = {}); if (v === undefined) delete s[id]; else s[id] = v; },
      /* a migration flag (a setting starting with `_`) that is set outranks one that is not: flags only ever get set */
      rank(id, v) { return id.charCodeAt(0) === 95 ? (v ? 2 : 0) : 1; } },
    /* d  the day's counters, one record per device per day: handled by syDiffCt / syApplyCt */
    { k: 'd', special: true },
    syList('h', (S, mk) => Array.isArray(S.hard) ? S.hard : (mk ? (S.hard = []) : null), x => x, id => id, null),
    syList('p', (S, mk) => Array.isArray(S.pick) ? S.pick : (mk ? (S.pick = []) : null), x => x, id => id, null),
    syList('mp', (S, mk) => { const my = syMy(S, mk); return my ? (Array.isArray(my.tp) ? my.tp : (mk ? (my.tp = []) : null)) : null; },
      t => t && t.id, (id, v) => { const o = Object.assign({ id }, v); delete o.a; return o; }, t => { const o = Object.assign({}, t); delete o.id; return o; },
      (S, id, v) => { const my = v === undefined ? null : syMy(S, true), m = /^t(\d+)$/.exec(id); if (my && m && !(my.tn > +m[1])) my.tn = +m[1] + 1; }),   /* a topic id seen from anywhere is never handed out again here */
    /* o  the order record of each list (ids: h, p, mp): written by syDiffList */
    { k: 'o', special: true,
      all(S, E2) { const o = {}; for (const k in E2.ord) if (E2.ord[k].o) o[k] = E2.ord[k].o; return o; },
      cur(S, E2, id) { const A = E2.ord[id]; return A && A.o ? A.o : undefined; },
      put(S, id, v, E2) { if (!E2.kind[id] || !E2.kind[id].list) return; const A = E2.ord[id] || (E2.ord[id] = { o: null, a: {} }); A.o = Array.isArray(v) ? v : null; E2.dl[id] = 1; } },
    /* hi  the Brain's daily snapshots: the newest SY_HIST_CAP days are kept, older ones are forgotten. Should a day be
           listed twice (takeSnapshot only looks at the last entry), the later entry is that day's snapshot. */
    { k: 'hi', enc: syPack, dec: syUnpack,
      all(S) { const H = S.hist; if (!H || !Array.isArray(H.d) || !Array.isArray(H.s)) return null; const o = {}; H.d.forEach((d, i) => { o[d] = H.s[i]; }); return o; },
      cur(S, E2, id) { const H = S.hist; if (!H || !Array.isArray(H.d)) return undefined; const i = H.d.lastIndexOf(id); return i < 0 ? undefined : H.s[i]; },
      put(S, id, v) {
        let H = S.hist; if (!H || !Array.isArray(H.d) || !Array.isArray(H.s)) { if (v === undefined) return; H = S.hist = { d: [], s: [] }; }
        let i = H.d.lastIndexOf(id);
        for (let j = H.d.indexOf(id); j > -1 && j < i; j = H.d.indexOf(id)) { H.d.splice(j, 1); H.s.splice(j, 1); i--; }
        if (v === undefined) { if (i > -1) { H.d.splice(i, 1); H.s.splice(i, 1); } return; }
        if (i > -1) { H.s[i] = v; return; }
        i = 0; while (i < H.d.length && H.d[i] < id) i++;
        H.d.splice(i, 0, id); H.s.splice(i, 0, v);
        while (H.d.length > SY_HIST_CAP) { H.d.shift(); H.s.shift(); }
      },
      stale(E2, S, id) { const H = S.hist; return !!(H && Array.isArray(H.d) && H.d.length >= SY_HIST_CAP && id < H.d[0]); } },
    /* sb  which card owns a word today (`<day>~<word>` → card id): only the last two days matter */
    { k: 'sb',
      all(S) { const m = S.sib; if (!m || typeof m !== 'object') return null; const o = {}; for (const d in m) { const x = m[d]; if (x && typeof x === 'object') for (const w in x) o[d + '~' + w] = x[w]; } return o; },
      cur(S, E2, id) { const i = id.indexOf('~'), x = S.sib && S.sib[id.slice(0, i)]; return x && syHas(x, id.slice(i + 1)) ? x[id.slice(i + 1)] : undefined; },
      put(S, id, v) {
        const i = id.indexOf('~'); if (i < 1) return; const d = id.slice(0, i), w = id.slice(i + 1);
        const m = S.sib && typeof S.sib === 'object' ? S.sib : (v !== undefined ? (S.sib = {}) : null); if (!m) return;
        if (v === undefined) { if (m[d]) { delete m[d][w]; if (!Object.keys(m[d]).length) delete m[d]; } } else (m[d] || (m[d] = {}))[w] = v;
      },
      /* past for this device after two days; cleared out of the cloud on sight only when long past, so that a device
         whose clock runs a day ahead does not delete what is still today for the others */
      stale(E2, S, id) { return id.slice(0, id.indexOf('~')) < E2.cutSib; },
      purge(E2, S, id) { return id.slice(0, id.indexOf('~')) < E2.cutOld; } },
    /* drill tallies: one record per item */
    syMap('g', sub('gram')), syMap('cf', sub('cf')), syMap('li', sub('listen')), syMap('us', sub('us')), syMap('rd', sub('read')),
    /* mr tw  writing-test result per word, tone-coach tally per word. Their containers' other fields travel as x~mtest
       and x~tone, and these records wait until that one has arrived: the engine must never make up the rest of a
       container (the app would take it for real, and so would the next diff), and the app resets a S.tone it does
       not recognise. */
    syInside('mr', 'mtest', 'res'), syInside('tw', 'tone', 'w'),
    /* mw mc  My words: the words and their cards */
    { k: 'mw',
      all(S) { const my = syMy(S, false); return my && my.w && typeof my.w === 'object' ? my.w : null; },
      put(S, id, v) {
        const my = syMy(S, v !== undefined); if (!my) return;
        if (v === undefined) { if (my.w) delete my.w[id]; return; }
        (my.w || (my.w = {}))[id] = v;
        const m = /^u(\d+)$/.exec(id); if (m && !(my.n > +m[1])) my.n = +m[1] + 1;      /* an id seen from anywhere is never handed out again here */
      } },
    syMap('mc', (S, mk) => { const my = syMy(S, mk); return my ? (my.c && typeof my.c === 'object' ? my.c : (mk ? (my.c = {}) : null)) : null; }, card),
    /* mn  the counters My words hands out ids from (ids: n, tn). They only ever go up: the larger number outranks the smaller */
    { k: 'mn',
      all(S) { const my = syMy(S, false); if (!my) return null; const o = {}; for (const f of ['n', 'tn']) if (typeof my[f] === 'number') o[f] = my[f]; return o; },
      put(S, id, v) { if (id !== 'n' && id !== 'tn') return; if (v === undefined) return; const my = syMy(S, true); if (!(my[id] >= v)) my[id] = v; },
      rank(id, v) { return typeof v === 'number' && v > 0 ? v : 0; } },
    /* x  everything else at the top level of S, one record per field: exam, vp, what is left of mtest / tone / my once
          their big maps are taken out, and any field a later version of the app adds before it gets a kind of its own */
    { k: 'x',
      all(S) {
        const o = {};
        for (const f in S) {
          if (der[f] || SY_OWNED[f] || S[f] === undefined) continue;
          if (SY_SPLIT[f]) { const v = S[f]; if (v && typeof v === 'object') { const c = syOmit(v, SY_SPLIT[f]); if (c) o[f] = c; } }
          else o[f] = S[f];
        }
        return o;
      },
      put(S, id, v) {
        if (der[id] || SY_OWNED[id]) return;
        if (!SY_SPLIT[id]) { if (v === undefined) delete S[id]; else S[id] = v; return; }
        const cur = S[id], keep = {}; let any = false;
        if (cur && typeof cur === 'object') for (const f of SY_SPLIT[id]) if (f in cur) { keep[f] = cur[f]; if (!syEmpty(cur[f])) any = true; }
        if (v === undefined) { if (any) S[id] = keep; else delete S[id]; }
        else if (v && typeof v === 'object' && !Array.isArray(v)) S[id] = Object.assign(SY_SPLIT_NEW[id](), v, keep);
      },
      lazy(id) { return id === 'exam' || id === 'mtest'; } }
  ];
  return K;
}

/* How two versions of one record are ordered: by rank where the kind has one (a set flag over an unset one, a
   larger id counter over a smaller), then by stamp. Almost every record has no rank: the later stamp wins. */
function syRank(kind, id, v) { return kind.rank ? kind.rank(id, v) : 1; }
/* A card that is merely queued (`{}`) on a device that has never heard of that card — adding a lesson does this to
   every card in it — is stamped as old as a stamp can be, whenever it happens. So it fills a gap and never replaces
   anything: not the reviews another device already did on that card, not a deletion it has not heard of yet. */
const syBlind = (kind, v, e) => !e && !!kind.card && !!v && typeof v === 'object' && !Array.isArray(v) && v.st === undefined;

/* ---------- the engine object ---------- */

/* env: { state: () => S, store: {getItem,setItem,removeItem}, adapter, node (device id), now: () => ms,
          local: [device-local setting names], onChange(res), onStatus(status), timers: false to drive it by hand } */
function syCreate(env) {
  const E = { env: Object.assign({ now: Date.now }, env) };
  E.node = String(env.node || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 16) || 'dev';
  if (E.node === '0') E.node = 'dev0';
  E.local = {}; (env.local || SY_LOCAL).forEach(k => { E.local[k] = 1; });
  E.derived = {}; (env.derived || SY_DERIVED).forEach(k => { E.derived[k] = 1; });
  E.kinds = syKinds(E); E.kind = {};
  for (const kind of E.kinds) E.kind[kind.k] = kind;
  E.timers = env.timers !== false && typeof setTimeout === 'function';
  E.uid = null; E.live = false; E.caught = false; E.status = 'off';
  syReset(E);
  return E;
}
function syReset(E) {
  E.sh = {};      /* key → flag (v live, d tombstone) + hash of the value (11) + stamp */
  E.q = {};       /* key → 1 pending upload, 2 pending removal from the cloud */
  E.ct = {};      /* day → device → {field: count}: every device's share of the day's counters ('0' is the shared base) */
  E.ord = {};     /* list code → { o: order record or null, a: { member id: add stamp } } */
  E.wait = {};    /* records that could not be applied yet */
  E.hw = 0; E.hc = 0; E.off = 0; E.cur = 0; E.joined = 0;
  E.memo = {}; E.dl = {}; E.sent = {}; E.deny = {}; E.park = {}; E.dirty = 0;
}
function syCuts(E) {
  const now = syNow(E);
  E.cutSib = syDay(E, now - SY_SIB_DAYS * 86400000);
  E.cutOld = syDay(E, now - (SY_SIB_DAYS + 7) * 86400000);
  E.cutMy = syDay(E, now - SY_MY_DAYS * 86400000);
}

/* ---------- diff: what changed on this device since the shadow ---------- */

function syDiff(E, S, opt) {
  const soft = !!(opt && opt.soft);
  let n = 0;
  const views = {};
  syCuts(E);
  for (const kind of E.kinds) {
    if (kind.list) { n += syDiffList(E, S, kind, soft); continue; }
    if (kind.special) continue;
    const m = kind.all(S, E); views[kind.k] = m || SY_E;
    if (!m) continue;
    const pre = kind.k + '~';
    for (const id in m) {
      if (!syHas(m, id) || id === '__proto__') continue;
      const v = m[id];
      if (v === undefined || typeof v === 'function') continue;
      if (kind.stale && kind.stale(E, S, id)) continue;
      const key = pre + syEnc(id);
      if (key.length > 500) continue;
      let h;
      if (typeof v === 'string' && v.length > 64) {       /* long strings (daily snapshots) are hashed once, not on every save */
        const mm = E.memo[key];
        if (mm && mm[0] === v) h = mm[1]; else { h = syHash(JSON.stringify(v)); E.memo[key] = [v, h]; }
      } else {
        const j = JSON.stringify(v);      /* the hash is of the value as S holds it; the compact form is for the wire only */
        if (j === undefined) continue;
        h = syHash(j);
      }
      const e = E.sh[key];
      if (e !== undefined && e.charCodeAt(0) !== 100 && e.startsWith(h, 1)) continue;
      E.sh[key] = 'v' + h + (soft || syBlind(kind, v, e) ? sySoft(E, kind, v, e, h) : syAfter(E, e && e.slice(12)));
      E.q[key] = 1; n++;
    }
  }
  /* what the shadow has and S no longer does: a tombstone — or, for a record whose time has passed, nothing at all */
  for (const key in E.sh) {
    const i = key.indexOf('~'), kind = E.kind[key.slice(0, i)];
    if (!kind || kind.list || kind.special) continue;
    const id = syDec(key.slice(i + 1)), e = E.sh[key];
    if (kind.stale && kind.stale(E, S, id)) { delete E.sh[key]; delete E.memo[key]; E.q[key] = 2; n++; continue; }
    if (e.charCodeAt(0) === 100) continue;
    const m = views[kind.k];
    if (m && syHas(m, id) && m[id] !== undefined && typeof m[id] !== 'function') continue;
    E.sh[key] = SY_DEAD + (soft ? sySoft(E, null, undefined, e, '') : syAfter(E, e.slice(12)));
    delete E.memo[key];
    E.q[key] = 1; n++;
  }
  n += syDiffCt(E, S);
  if (n) E.dirty = 1;
  return n;
}

function syDiffList(E, S, kind, soft) {
  const k = kind.k, arr = kind.arr(S, false) || [], A = E.ord[k] || (E.ord[k] = { o: null, a: {} });
  const ids = [], seen = Object.create(null);
  let n = 0;
  for (const it of arr) { const id = kind.id(it); if (typeof id !== 'string' || id === '__proto__' || id in seen) continue; seen[id] = it; ids.push(id); }
  for (const id of ids) {
    const key = k + '~' + syEnc(id), e = E.sh[key], live = e !== undefined && e.charCodeAt(0) !== 100;
    if (live && !kind.pay) continue;
    if (!live) {
      /* a new member. Its add stamp `a` is the stamp of this very record, except where the record is not the learner
         acting now (soft): then `a` is empty and the member sorts by its id */
      if (soft) { const j = JSON.stringify(kind.val('', seen[id])), h = syHash(j); A.a[id] = ''; E.sh[key] = 'v' + h + sySoft(E, kind, null, e, h); }
      else { const st = syAfter(E, e && e.slice(12)); A.a[id] = st; E.sh[key] = 'v' + syHash(JSON.stringify(kind.val(st, seen[id]))) + st; }
      E.q[key] = 1; n++;
    } else {
      const h = syHash(JSON.stringify(kind.val(A.a[id] || '', seen[id])));
      if (e.startsWith(h, 1)) continue;
      E.sh[key] = 'v' + h + (soft ? sySoft(E, kind, null, e, h) : syAfter(E, e.slice(12)));
      E.q[key] = 1; n++;
    }
  }
  for (const id in A.a) {
    if (!syHas(A.a, id) || id in seen) continue;
    const key = k + '~' + syEnc(id), e = E.sh[key];
    delete A.a[id];
    if (e === undefined || e.charCodeAt(0) === 100) continue;
    E.sh[key] = SY_DEAD + (soft ? sySoft(E, null, undefined, e, '') : syAfter(E, e.slice(12)));
    E.q[key] = 1; n++;
  }
  const canon = syCanon(A, ids);
  let same = true; for (let i = 0; i < ids.length; i++) if (canon[i] !== ids[i]) { same = false; break; }
  if (!same) {
    const key = 'o~' + k, e = E.sh[key], h = syHash(JSON.stringify(ids));
    A.o = ids.slice();
    E.sh[key] = 'v' + h + (soft ? sySoft(E, null, null, e, h) : syAfter(E, e && e.slice(12)));
    E.q[key] = 1; n++;
  }
  return n;
}

/* ---------- the day's counters ----------
   S keeps one number per day (reviews, new cards, intake per lane, My words). Two devices that study on the same
   day must add up, so the cloud holds one record per day *per device* — each device writes only its own — and the
   number in S is their sum. The shadow keeps every device's share (E.ct), so what S holds beyond the known sum is
   what this device did since, and goes into its own record. Device '0' is the shared base: counts from before the
   deck was synced by record. It is merged by taking the larger number, so two devices that bring the same old
   deck do not count it twice. */
const SY_CFS = ['r', 'n', 'i', 'c', 'g', 'mi', 'ml'];
function syCtRead(S) {
  const out = {};
  const put = (d, f, x) => { if (typeof x === 'number' && x && isFinite(x)) (out[d] || (out[d] = {}))[f] = x; };
  const L = S.log;
  if (L && typeof L === 'object') for (const d in L) { const e = L[d]; if (e && typeof e === 'object') { put(d, 'r', e.rev); put(d, 'n', e.new); } }
  const my = S.my && typeof S.my === 'object' ? S.my : SY_E;
  for (const [f, m] of [['i', S.intro], ['c', S.cintro], ['g', S.gintro], ['mi', my.intro], ['ml', my.log]])
    if (m && typeof m === 'object') for (const d in m) put(d, f, m[d]);
  return out;
}
function syCtTotal(S, d, f) {
  let x;
  if (f === 'r' || f === 'n') { const e = S.log && S.log[d]; x = e && typeof e === 'object' ? e[f === 'r' ? 'rev' : 'new'] : 0; }
  else { const my = S.my && typeof S.my === 'object' ? S.my : SY_E; const m = f === 'i' ? S.intro : f === 'c' ? S.cintro : f === 'g' ? S.gintro : f === 'mi' ? my.intro : my.log; x = m && typeof m === 'object' ? m[d] : 0; }
  return typeof x === 'number' && isFinite(x) ? x : 0;
}
function syCtWrite(S, d, f, x) {
  if (f === 'r' || f === 'n') {
    if (!S.log || typeof S.log !== 'object') S.log = {};
    const e = S.log[d] && typeof S.log[d] === 'object' ? S.log[d] : (S.log[d] = { rev: 0, new: 0 });
    e[f === 'r' ? 'rev' : 'new'] = x;
    if (!e.rev && !e.new && Object.keys(e).length <= 2) delete S.log[d];
    return;
  }
  let m;
  if (f === 'mi' || f === 'ml') { const my = syMy(S, true), n = f === 'mi' ? 'intro' : 'log'; m = my[n] && typeof my[n] === 'object' ? my[n] : (my[n] = {}); }
  else { const n = f === 'i' ? 'intro' : f === 'c' ? 'cintro' : 'gintro'; m = S[n] && typeof S[n] === 'object' ? S[n] : (S[n] = {}); }
  if (x) m[d] = x; else delete m[d];
}
const syFrozen = (E, f, d) => (f === 'mi' || f === 'ml') && d < E.cutMy;
function syCtSame(a, b) { for (const f of SY_CFS) if ((a[f] || 0) !== (b[f] || 0)) return false; return true; }
function syCtClean(v) { const o = {}; if (v && typeof v === 'object') for (const f of SY_CFS) if (typeof v[f] === 'number' && isFinite(v[f]) && v[f]) o[f] = v[f]; return o; }
function syCtStamp(E, d, dv, after) {
  const key = 'd~' + syEnc(d) + '~' + dv, e = E.sh[key], base = e && e.slice(12);
  E.sh[key] = 'v' + syHash(JSON.stringify(E.ct[d][dv])) + syAfter(E, after && (!base || after > base) ? after : base);
  E.q[key] = 1;
}
function syDiffCt(E, S) {
  const cur = syCtRead(S), ct = E.ct, me = E.node, days = {};
  let n = 0;
  for (const d in cur) days[d] = 1;
  for (const d in ct) days[d] = 1;
  for (const d in days) {
    if (d === '__proto__') continue;
    const have = cur[d] || SY_E, devs = ct[d];
    let own = null;
    for (const f of SY_CFS) {
      let known = 0;
      if (devs) for (const dv in devs) known += devs[dv][f] || 0;
      const t = have[f] || 0;
      if (t === known || syFrozen(E, f, d)) continue;
      if (!own) own = Object.assign({}, devs && devs[me]);
      own[f] = (own[f] || 0) + (t - known);
      if (!own[f]) delete own[f];
    }
    if (own) { (ct[d] || (ct[d] = {}))[me] = own; syCtStamp(E, d, me); n++; }
  }
  return n;
}
function syApplyCt(E, S, key, id, rec, res) {
  const i = id.lastIndexOf('~'); if (i < 1) { res.bad++; return; }
  const d = id.slice(0, i), dv = id.slice(i + 1), e = E.sh[key], lh = e ? e.slice(12) : '';
  if (d === '__proto__' || dv === '__proto__') { res.bad++; return; }
  if (e && rec.h === lh) return;
  const v = rec.d === 1 ? {} : syCtClean(JSON.parse(rec.j));
  const devs = E.ct[d] || (E.ct[d] = {}), old = devs[dv] || SY_E;
  let nv = v, rewrite = false;
  if (dv === '0') {                 /* the shared base: the larger number wins, field by field */
    nv = {}; for (const f of SY_CFS) { const x = Math.max(old[f] || 0, v[f] || 0); if (x) nv[f] = x; }
    rewrite = !syCtSame(nv, v);
  } else if (e && rec.h < lh) { E.q[key] = 1; res.kept++; return; }      /* the cloud is behind what this device knows: send ours again */
  for (const f of SY_CFS) {
    const delta = (nv[f] || 0) - (old[f] || 0);
    if (delta && !syFrozen(E, f, d)) { syCtWrite(S, d, f, syCtTotal(S, d, f) + delta); res.n++; res.kinds.d = 1; }
  }
  devs[dv] = nv;
  if (rewrite) syCtStamp(E, d, dv, rec.h);
  else { E.sh[key] = 'v' + syHash(JSON.stringify(nv)) + (rec.h > lh ? rec.h : lh); if (E.q[key] === 1 && dv !== '0') res.lost.push(key); delete E.q[key]; }
}

/* ---------- apply: records from the cloud into S ---------- */

/* list: [[key, record], …] in any order, with repeats. Returns what happened:
   n records written into S, kinds touched, lost: keys where a change made here and not yet sent was overruled. */
function syApply(E, S, list) {
  const res = { n: 0, kept: 0, bad: 0, unknown: 0, deferred: 0, lost: [], kinds: {} };
  syDiff(E, S);                                 /* whatever changed here gets its stamp first */
  const held = Object.keys(E.wait).map(k => [k, E.wait[k]]);
  E.wait = {}; E.dl = {};
  const one = pair => { try { syApplyOne(E, S, pair[0], pair[1], res); } catch (err) { res.bad++; } };
  /* whole-field records first, so that a container exists before the records that live inside it */
  for (const p of held) if (p[0].charCodeAt(0) === 120) one(p);
  for (const p of list) if (p[0].charCodeAt(0) === 120) one(p);
  for (const p of held) if (p[0].charCodeAt(0) !== 120) one(p);
  for (const p of list) if (p[0].charCodeAt(0) !== 120) one(p);
  syLists(E, S);
  E.dirty = 1;
  return res;
}
/* put the lists that were touched into their agreed order; drop a container that has nothing left in it */
function syLists(E, S) {
  for (const f in SY_SPLIT) {
    const t = S[f]; if (!t || typeof t !== 'object') continue;
    let empty = true; for (const k in t) if (SY_SPLIT[f].indexOf(k) < 0 || !syEmpty(t[k])) { empty = false; break; }
    if (empty) delete S[f];
  }
  for (const k in E.dl) {
    const kind = E.kind[k], L = kind && kind.list ? kind.arr(S, false) : null;
    if (!L || L.length < 2) continue;
    const A = E.ord[k] || (E.ord[k] = { o: null, a: {} }), at = Object.create(null);
    syCanon(A, L.map(kind.id)).forEach((id, i) => { at[id] = i; });
    L.sort((x, y) => at[kind.id(x)] - at[kind.id(y)]);
  }
  E.dl = {};
}
function syApplyOne(E, S, key, rec, res) {
  if (!rec || typeof rec !== 'object' || !syStampOk(rec.h)) { res.bad++; return; }
  const i = key.indexOf('~'); if (i < 1) { res.bad++; return; }
  const kind = E.kind[key.slice(0, i)];
  if (!kind) { res.unknown++; return; }           /* a kind from a later version: left alone */
  const id = syDec(key.slice(i + 1)); if (id === '__proto__') { res.bad++; return; }
  syObserve(E, rec.h);
  if (kind.k === 'd') return syApplyCt(E, S, key, id, rec, res);
  const e = E.sh[key];
  if (kind.stale && kind.stale(E, S, id)) { if (!e && (kind.purge || kind.stale)(E, S, id)) E.q[key] = 2; return; }       /* its time has passed */
  const lh = e ? e.slice(12) : '';
  if (e && rec.h === lh) return;                  /* the version this device already has */
  const rtomb = rec.d === 1;
  let rv;
  if (!rtomb) { if (typeof rec.j !== 'string') { res.bad++; return; } rv = JSON.parse(rec.j); if (kind.dec) rv = kind.dec(rv); if (rv === undefined) { res.bad++; return; } }
  const get = () => kind.cur ? kind.cur(S, E, id) : (m => (m && syHas(m, id) ? m[id] : undefined))(kind.all(S, E));
  if (e) {
    const rr = syRank(kind, id, rv), lr = kind.rank ? syRank(kind, id, e.charCodeAt(0) !== 100 ? get() : undefined) : 1;
    if (!(rr !== lr ? rr > lr : rec.h > lh)) {
        /* this device's version stands. Make sure the cloud ends up holding it: send it again — with a stamp above
         the one that just lost, where it won on rank */
      if (rec.h > lh) E.sh[key] = e.slice(0, 12) + syAfter(E, rec.h);
      E.q[key] = 1; res.kept++; return;
    }
  }
  if (kind.put(S, id, rv, E) === false) { E.wait[key] = rec; res.deferred++; return; }
  if (rtomb) E.sh[key] = SY_DEAD + rec.h;
  else {
    const cv = get();
    if (cv === undefined) { res.bad++; return; }                  /* nowhere to put it in this version of the app */
    E.sh[key] = 'v' + syHash(JSON.stringify(cv)) + rec.h;
  }
  delete E.memo[key];
  if (E.q[key] === 1 && e && e.slice(0, 12) !== E.sh[key].slice(0, 12)) res.lost.push(key);      /* a change not yet sent was overruled by a different value */
  delete E.q[key];
  res.n++; res.kinds[kind.k] = 1;
}

/* ---------- a state that was never synced by record: first sync, and the one-time import ---------- */

/* the records a whole state amounts to */
function syLegacy(E, P) {
  const recs = [];
  for (const kind of [E.kind.x].concat(E.kinds)) {        /* whole-field records first: containers before their contents */
    if (kind.k === 'd' || kind.k === 'o' || (kind.k === 'x' && recs.length)) continue;
    if (kind.list) {
      const L = kind.arr(P, false); if (!L) continue;
      const ids = [], seen = Object.create(null);
      for (const it of L) { const id = kind.id(it); if (typeof id !== 'string' || id === '__proto__' || id in seen) continue; seen[id] = 1; ids.push(id); recs.push([kind, id, kind.val('', it)]); }
      if (ids.length) recs.push([E.kind.o, kind.k, ids]);
      continue;
    }
    const m = kind.all(P, E); if (!m) continue;
    for (const id in m) { if (!syHas(m, id) || id === '__proto__') continue; const v = m[id]; if (v !== undefined && typeof v !== 'function') recs.push([kind, id, v]); }
  }
  return { recs, days: syCtRead(P) };
}
/* Merge them into (S, shadow) with soft stamps: a card by the time of its last review, everything else as "older
   than anything synced" — so the legacy state fills what is missing and wins a card only where it was reviewed
   later. A day's count becomes the larger of the two totals; the difference goes into the shared base record. */
function syMergeLegacy(E, S, L, res) {
  syCuts(E);
  for (const [kind, id, v] of L.recs) {
    try {
      if (kind.stale && kind.stale(E, S, id)) continue;
      const key = kind.k + '~' + syEnc(id); if (key.length > 500) continue;
      const j = JSON.stringify(v); if (j === undefined) continue;
      const h = syHash(j), e = E.sh[key];
      const get = () => kind.cur ? kind.cur(S, E, id) : (m => (m && syHas(m, id) ? m[id] : undefined))(kind.all(S, E));
      if (e && e.charCodeAt(0) !== 100 && e.startsWith(h, 1)) continue;         /* the same value is already here */
      let st = sySoft(E, kind, v, undefined, h);
      if (e) {
        /* against a record that is already here the legacy value wins only on time (a card reviewed later), never on
           the tie-break: where neither side has a time to show, what the account already holds stands */
        const lh = e.slice(12), rr = syRank(kind, id, v), lr = kind.rank ? syRank(kind, id, e.charCodeAt(0) !== 100 ? get() : undefined) : 1;
        if (!(rr !== lr ? rr > lr : st.slice(0, 12) > lh.slice(0, 12))) continue;
        if (!(st > lh)) st = syAfter(E, lh);
      }
      if (kind.put(S, id, v, E) === false) continue;
      const cv = get(); if (cv === undefined) continue;
      E.sh[key] = 'v' + syHash(JSON.stringify(cv)) + st;
      E.q[key] = 1; res.taken++;
    } catch (err) { res.bad++; }
  }
  for (const d in L.days) {
    if (d === '__proto__') continue;
    let base = null;
    for (const f of SY_CFS) {
      const want = L.days[d][f] || 0, t = syCtTotal(S, d, f);
      if (!(want > t) || syFrozen(E, f, d)) continue;
      if (!base) base = Object.assign({}, E.ct[d] && E.ct[d]['0']);
      base[f] = (base[f] || 0) + (want - t);
      syCtWrite(S, d, f, want); res.days++;
    }
    if (base) { (E.ct[d] || (E.ct[d] = {}))['0'] = base; syCtStamp(E, d, '0'); }
  }
  syLists(E, S);
  E.dirty = 1;
}
function syWipe(E, T) {
  for (const f of ['log', 'intro', 'cintro', 'gintro']) if (T[f] && typeof T[f] === 'object') T[f] = {};
  if (T.my && typeof T.my === 'object') { if (T.my.intro) T.my.intro = {}; if (T.my.log) T.my.log = {}; delete T.my.n; delete T.my.tn; }
  for (const kind of E.kinds) {
    if (kind.k === 'd' || kind.k === 'o') continue;
    if (kind.list) { const L = kind.arr(T, false); if (L) L.length = 0; continue; }
    const m = kind.all(T, E); if (!m) continue;
    for (const id of Object.keys(m)) kind.put(T, id, undefined, E);
  }
  E.dl = {};
}
const SY_PARTS = ['sh', 'q', 'ct', 'ord', 'wait', 'hw', 'hc', 'joined'];
/* run fn on a copy of S and of the shadow; S and the shadow change only if it finishes */
function syAtomic(E, S, fn) {
  const bak = {}; for (const k of SY_PARTS) bak[k] = E[k];
  const T = JSON.parse(JSON.stringify(S));
  E.sh = Object.assign({}, E.sh); E.q = Object.assign({}, E.q); E.ct = JSON.parse(JSON.stringify(E.ct)); E.ord = JSON.parse(JSON.stringify(E.ord)); E.wait = Object.assign({}, E.wait);
  let out;
  try { out = fn(T); } catch (err) { Object.assign(E, bak); throw err; }
  for (const k of Object.keys(S)) if (!syHas(T, k)) delete S[k];
  for (const k of Object.keys(T)) S[k] = T[k];
  E.memo = {};
  return out;
}
/* The first sync of a device. `list` is everything the cloud holds. The cloud's records are laid down first, then
   the device's own state is merged in as a legacy state — so an empty cloud takes the device's deck, an empty device
   takes the cloud's, and where both hold something each record is decided on its own. mode 'cloud' drops what the
   device holds instead of merging it. */
function syJoin(E, S, list, mode) {
  return syAtomic(E, S, T => {
    const local = mode === 'cloud' ? null : syLegacy(E, T);
    syWipe(E, T);
    E.sh = {}; E.q = {}; E.ct = {}; E.ord = {}; E.wait = {};
    const res = syApply(E, T, list);
    res.taken = 0; res.days = 0; res.join = 1;
    if (local) syMergeLegacy(E, T, local, res);
    E.joined = 1;
    return res;
  });
}
/* the whole-deck blob of the old sync: the `json` field of rooms/<code>/study_state, that whole record, or a state */
function syBlob(x) {
  if (typeof x === 'string') x = JSON.parse(x);
  if (x && typeof x === 'object' && typeof x.json === 'string') x = JSON.parse(x.json);
  if (!x || typeof x !== 'object' || !x.cards || typeof x.cards !== 'object') throw new Error('sync import: this is not a deck');
  return x;
}
/* The one-time import. Safe to repeat and safe to run on several devices: the same blob always yields the same
   records with the same stamps. */
function syImportInto(E, S, blob) {
  const P = syBlob(blob);
  if (!E.joined) throw new Error('sync import: join first');
  syDiff(E, S);
  return syAtomic(E, S, T => { const res = { taken: 0, days: 0, bad: 0 }; syMergeLegacy(E, T, syLegacy(E, P), res); return res; });
}

/* ---------- what goes on the wire ---------- */

/* one record: { h: stamp, m: server time, j: the value as JSON }  or a tombstone { h, m, d: 1 } */
function syWire(E, S, key) {
  const e = E.sh[key]; if (!e) return undefined;
  const h = e.slice(12);
  if (e.charCodeAt(0) === 100) return { h, m: SY_TS, d: 1 };
  const i = key.indexOf('~'), kind = E.kind[key.slice(0, i)], id = syDec(key.slice(i + 1));
  let v;
  if (kind.k === 'd') { const p = id.lastIndexOf('~'); v = (E.ct[id.slice(0, p)] || SY_E)[id.slice(p + 1)] || {}; }
  else if (kind.cur) v = kind.cur(S, E, id);
  else { const m = kind.all(S, E); v = m && syHas(m, id) ? m[id] : undefined; }
  if (v === undefined) return undefined;
  return { h, m: SY_TS, j: JSON.stringify(kind.enc ? kind.enc(v) : v) };
}

/* ---------- on the device: persistence ---------- */

function sySave(E) {
  if (!E.uid) return false;
  try {
    E.env.store.setItem(SY_STORE, JSON.stringify({ v: SY_V, uid: E.uid, node: E.node, hw: E.hw, hc: E.hc, off: E.off, cur: E.cur, joined: E.joined, sh: E.sh, q: E.q, ct: E.ct, ord: E.ord, wait: E.wait }));
    E.dirty = 0; return true;
  } catch (err) {
    /* no room: a stale shadow would be worse than none, so drop it. The next start joins again, record by record. */
    try { E.env.store.removeItem(SY_STORE); } catch (e2) { /* nothing more to do */ }
    E.err = 'store'; return false;
  }
}
/* true: loaded · false: nothing usable · 'other': the device holds another account's shadow */
function syLoad(E) {
  let p = null;
  try { const raw = E.env.store.getItem(SY_STORE); if (raw) p = JSON.parse(raw); } catch (err) { p = null; }
  if (!p || p.v !== SY_V || !p.uid || !p.sh) return false;
  if (p.uid !== E.uid) return 'other';
  E.sh = p.sh; E.q = p.q || {}; E.ct = p.ct || {}; E.ord = p.ord || {}; E.wait = p.wait || {};
  E.hw = +p.hw || 0; E.hc = +p.hc || 0; E.off = +p.off || 0; E.cur = +p.cur || 0; E.joined = p.joined ? 1 : 0;
  return true;
}

/* ---------- on the device: the running engine ---------- */

function syNote(E, status) { if (status) E.status = status; if (E.env.onStatus) { try { E.env.onStatus(syStatus(E)); } catch (err) { /* the app's business */ } } }
function syStatus(E) {
  let pending = 0; for (const k in E.q) pending++;
  return { state: E.status, joined: !!E.joined, pending, parked: Object.keys(E.park).length, cursor: E.cur, err: E.err || '' };
}
/* opt: { uid, join: 'merge' | 'cloud' }. Call it once the app's own start-up code has run: what start-up changed
   (migrations, defaults, pruning) is recognised as housekeeping and stamped soft. Returns false when the device
   still holds another account's shadow and `join` does not say what to do with the deck on it. */
function syStart(E, opt) {
  syStop(E);
  const uid = opt && opt.uid; if (!uid) throw new Error('syStart: uid');
  E.uid = String(uid); E.base = 'users/' + E.uid; E.joinMode = (opt && opt.join) || 'merge';
  const got = syLoad(E);
  if (got === 'other' && !(opt && opt.join)) { E.uid = null; syNote(E, 'other-account'); return false; }
  if (got !== true) syReset(E);
  E.err = ''; E.inbox = []; E.maxM = 0; E.caught = false; E.metaOk = false; E.metaNew = false; E.metaBusy = false;
  E.busy = null; E.batch = SY_BATCH; E.backoff = 0; E.deny = {}; E.park = {}; E.sent = {}; E.live = true;
  E.t0 = E.env.now();
  if (E.joined) { if (syDiff(E, E.env.state(), { soft: true })) sySave(E); }
  syNote(E, 'connecting');
  const A = E.env.adapter, gen = E.gen = (E.gen || 0) + 1;
  E.unsub = A.listen(E.base + '/rec', { orderBy: 'm', startAt: E.joined && E.cur ? Math.max(0, E.cur - SY_OVERLAP) : null },
    (k, v) => { if (E.gen === gen) syReceive(E, k, v); },
    () => { if (E.gen === gen) syReady(E); },
    err => { if (E.gen === gen) { E.err = String((err && err.message) || err); syNote(E, 'error'); } });
  return true;
}
function syStop(E) {
  if (E.unsub) { try { E.unsub(); } catch (err) { /* already gone */ } E.unsub = null; }
  if (E.tm) { clearTimeout(E.tm); E.tm = null; }
  if (E.pt) { clearTimeout(E.pt); E.pt = null; }
  if (E.live && E.dirty) sySave(E);
  E.live = false; E.caught = false; E.gen = (E.gen || 0) + 1;
  syNote(E, 'off');
}
function syReceive(E, key, val) {
  if (!E.live) return;
  E.inbox.push([key, val]);
  if (!E.caught) { if (val && typeof val.m === 'number' && val.m > E.maxM) E.maxM = val.m; return; }
  if (E.timers && !E.pt) E.pt = setTimeout(() => { E.pt = null; syPump(E); }, 30);
}
/* the cloud has sent everything from the cursor on: merge it, move the cursor, and only now start sending */
function syReady(E) {
  if (!E.live || E.caught) return;
  const S = E.env.state(), list = E.inbox;
  let res;
  try { res = E.joined ? syApply(E, S, list) : syJoin(E, S, list, E.joinMode); }
  catch (err) { E.err = String((err && err.message) || err); syNote(E, 'error'); return; }
  E.inbox = [];
  /* The cursor moves only here, where a batch has come from the server in one piece: to the newest server time in
     it, or to the moment this session began listening if that is later (everything older was in the batch). Records
     that arrive afterwards, while listening, never move it: the next start fetches them once more, so nothing can
     slip past, whatever order they arrived in and whatever was lost on the way. */
  let m = E.maxM;
  const A = E.env.adapter, sn = A.serverNow ? A.serverNow() : null;
  if (typeof sn === 'number' && isFinite(sn)) {
    E.off = Math.round(sn - E.env.now());
    m = Math.min(sn, Math.max(m, E.t0 + E.off - SY_SLACK));
  }
  if (m > E.cur) E.cur = m;
  E.caught = true;
  syTell(E, res.n || res.join, res);
  if (E.todo) { const t = E.todo; E.todo = null; for (const b of t) { try { syImport(E, b); } catch (err) { E.err = String(err.message || err); } } }
  syNote(E, 'syncing');
  syFlush(E);
}
/* S was changed by the engine: first the app stores S (onChange must do that before it returns), then the shadow is
   stored. A shadow that claims versions S never got is the one dangerous state — the next start would send the old
   values out as if they were new — so if onChange says S could not be stored (it returns false, or throws), the
   stored shadow is dropped instead and the next start joins again. */
function syTell(E, changed, res) {
  let ok = true;
  if (changed && E.env.onChange) { try { ok = E.env.onChange(res) !== false; } catch (err) { ok = false; } }
  if (ok) { sySave(E); return; }
  try { E.env.store.removeItem(SY_STORE); } catch (err) { /* nothing more to do */ }
  E.err = 'store';
}
/* apply what has arrived since (the app calls nothing: a timer does, or a test by hand) */
function syPump(E) {
  if (!E.live || !E.caught || !E.inbox.length) return null;
  const list = E.inbox; E.inbox = [];
  const res = syApply(E, E.env.state(), list);
  syTell(E, res.n, res);
  syFlush(E);
  return res;
}
/* the app's save() calls this: stamp what changed, remember it, send it soon */
function syOnSave(E) {
  if (!E.joined || !E.uid) return 0;
  const n = syDiff(E, E.env.state());
  if (n) { sySave(E); if (E.timers) { if (E.tm) clearTimeout(E.tm); E.tm = setTimeout(() => { E.tm = null; syFlush(E); }, SY_DEBOUNCE); } }
  return n;
}
function syImport(E, blob) {
  if (!E.joined || !E.caught) { (E.todo || (E.todo = [])).push(blob); return null; }
  const res = syImportInto(E, E.env.state(), blob);
  syTell(E, res.taken || res.days, res);
  syFlush(E);
  return res;
}
/* Send what is pending. Nothing is sent before the catch-up of this session has been merged (pull before push).
   One batch is in flight at a time; a record changed while its batch is in flight stays pending and goes in the next.
   force: also send the lazy records now (the app is being hidden). Returns a promise for tests to wait on. */
function syFlush(E, force) {
  if (!E.live || !E.caught || E.halt) return Promise.resolve(false);
  if (E.busy) { E.again = force ? 2 : (E.again || 1); return E.busy; }
  const A = E.env.adapter, S = E.env.state();
  if (!E.metaOk) {            /* a newer app may have changed the format: check once per session before writing */
    if (E.metaBusy) return E.metaBusy;
    return (E.metaBusy = A.get(E.base + '/meta').then(m => {
      E.metaBusy = null;
      if (m && typeof m.v === 'number' && m.v > SY_V) { E.halt = 'newer'; syNote(E, 'newer'); return false; }
      E.metaOk = true; E.metaNew = !m || !m.v;
      return syFlush(E, force);
    }, err => { E.metaBusy = null; E.err = String((err && err.message) || err); syRetry(E); return false; }));
  }
  if (syDiff(E, S)) sySave(E);
  const now = E.env.now(), keys = [], later = [];
  let due = 0;
  for (const key in E.q) {
    if (E.park[key]) continue;
    const i = key.indexOf('~'), kind = E.kind[key.slice(0, i)];
    if (!force && kind && kind.lazy && E.q[key] === 1 && kind.lazy(syDec(key.slice(i + 1)))) {
      const wait = (E.sent[key] || 0) + SY_LAZY - now;
      if (wait > 0) { if (!due || wait < due) due = wait; continue; }
    }
    if (key.charCodeAt(0) === 120) keys.push(key); else later.push(key);       /* whole-field records lead */
  }
  for (const k of later) keys.push(k);
  if (keys.length > E.batch) keys.length = E.batch;
  if (due && E.timers && !E.tm) E.tm = setTimeout(() => { E.tm = null; syFlush(E); }, due + 50);
  if (!keys.length) { syNote(E, Object.keys(E.park).length ? 'error' : 'ok'); return Promise.resolve(true); }
  const map = {}, sent = {};
  for (const key of keys) {
    if (E.q[key] === 2) { map['rec/' + key] = null; sent[key] = 2; continue; }
    const rec = syWire(E, S, key);
    if (rec === undefined) { delete E.q[key]; continue; }
    map['rec/' + key] = rec; sent[key] = rec.h; E.sent[key] = now;
  }
  if (E.metaNew) map['meta/v'] = SY_V;
  const gen = E.gen;
  syNote(E, 'syncing');
  E.busy = A.update(E.base, map).then(() => {
    if (E.gen !== gen) return false;
    E.busy = null; E.metaNew = false; E.backoff = 0; E.err = '';
    if (E.batch < SY_BATCH) E.batch = Math.min(SY_BATCH, E.batch * 2);
    for (const key in sent) {
      if (sent[key] === 2) { if (E.q[key] === 2) delete E.q[key]; }
      else if (E.q[key] === 1 && E.sh[key] && E.sh[key].slice(12) === sent[key]) delete E.q[key];
      delete E.deny[key];
    }
    sySave(E);
    const f = E.again === 2; E.again = 0;
    return syFlush(E, f);
  }, err => {
    if (E.gen !== gen) return false;
    E.busy = null;
    const msg = String((err && (err.code || err.message)) || err), list = Object.keys(sent);
    E.err = msg;
    if (!/permission|denied/i.test(msg)) { syRetry(E); return false; }
    /* The database refused the batch: one of its records is older than what the cloud holds (or the rules do not
       know this path). Halve the batch until the record is alone, then look at what the cloud has for it. */
    if (list.length > 1) { E.batch = Math.max(1, list.length >> 1); return syFlush(E, force); }
    const key = list[0];
    E.deny[key] = (E.deny[key] || 0) + 1;
    if (E.deny[key] >= 3) { E.park[key] = 1; syNote(E, 'error'); return syFlush(E, force); }
    return A.get(E.base + '/rec/' + key).then(v => {
      if (E.gen !== gen) return false;
      if (v) { const res = syApply(E, E.env.state(), [[key, v]]); syTell(E, res.n, res); }
      return syFlush(E, force);
    }, () => { syRetry(E); return false; });
  });
  return E.busy;
}
function syRetry(E) {
  syNote(E, 'error');
  if (!E.timers) return;
  E.backoff = Math.min(60000, (E.backoff || 1000) * 2);
  if (E.tm) clearTimeout(E.tm);
  E.tm = setTimeout(() => { E.tm = null; syFlush(E); }, E.backoff);
}

/* ---------- the Firebase SDK behind the adapter ----------
   f: the modular SDK's functions plus the database: { db, ref, update, get, query, orderByChild, startAt,
   onChildAdded, onChildChanged, onValue }. Not exercised against the real service by the tests (they have no
   network): tools/test/sync.test.js runs it against a stand-in with the same signatures. */
function syFirebase(f) {
  let offset = null;
  try { f.onValue(f.ref(f.db, '.info/serverTimeOffset'), s => { offset = s.val(); }); } catch (err) { /* serverNow stays unknown */ }
  return {
    update: (path, map) => f.update(f.ref(f.db, path), map),
    get: path => f.get(f.ref(f.db, path)).then(s => s.val()),
    listen(path, o, onChild, onReady, onErr) {
      let q = f.ref(f.db, path);
      if (o && o.orderBy) { const c = [f.orderByChild(o.orderBy)]; if (o.startAt != null) c.push(f.startAt(o.startAt)); q = f.query(q, ...c); }
      const cb = s => onChild(s.key, s.val());
      const u1 = f.onChildAdded(q, cb, onErr), u2 = f.onChildChanged(q, cb, onErr);
      /* a value listener fires after the child events of the first load: that is "caught up" */
      const u3 = f.onValue(q, () => onReady(), onErr, { onlyOnce: true });
      return () => { for (const u of [u1, u2, u3]) { try { u(); } catch (err) { /* already off */ } } };
    },
    serverNow: () => (typeof offset === 'number' ? Date.now() + offset : null)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SY_V, SY_STORE, SY_TS, SY_DRIFT, SY_BATCH, SY_LAZY, SY_HIST_CAP, SY_LOCAL,
    syHash, syEnc, syDec, syStamp, syWall, syCtr, syStampOk, syTick, syAfter, syObserve, sySoft,
    syPackCard, syUnpackCard, syPack, syUnpack, syCanon, syRank,
    syCreate, syReset, syDiff, syApply, syJoin, syLegacy, syMergeLegacy, syBlob, syImportInto, syWire, syCtRead,
    sySave, syLoad, syStatus, syStart, syStop, syReceive, syReady, syPump, syOnSave, syImport, syFlush, syFirebase
  };
}

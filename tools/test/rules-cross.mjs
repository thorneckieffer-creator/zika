#!/usr/bin/env node
/* Cross-check of the security rules with a second, independent evaluator.

     npm install --prefix tools/test/.cross --no-audit --no-fund --ignore-scripts --no-package-lock targaryen@3.1.0
     node tools/test/rules-cross.mjs            the case table through both evaluators, then 20,000 random operations
     node tools/test/rules-cross.mjs 100000     more random operations

   targaryen is a pure-JavaScript implementation of the Realtime Database rules language (ISC
   licence, last released 2018). It is installed into tools/test/.cross, which is git-ignored;
   nothing in the app depends on it. Two implementations written apart agreeing on every case
   is stronger evidence than either alone, and weaker than the official emulator: see
   firebase/README.md.

   Exit code 0: both evaluators agree with the expected answer on every case and with each
   other on every random operation. 1: a disagreement (printed). 2: targaryen is not installed. */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { RulesDb } from './rules-eval.mjs';
import { CASES, BASE, NOW, TS, H } from './rules-cases.mjs';

const require = createRequire(import.meta.url);
let targaryen;
try { targaryen = require('./.cross/node_modules/targaryen'); }
catch (e) {
  console.error('targaryen is not installed. Run:\n  npm install --prefix tools/test/.cross --no-audit --no-fund --ignore-scripts --no-package-lock targaryen@3.1.0');
  process.exit(2);
}
const RULES = JSON.parse(readFileSync(new URL('../../firebase/database.rules.json', import.meta.url), 'utf8'));

function mine(c) {
  const db = new RulesDb(RULES, c.data || BASE, { now: NOW });
  return (c.op === 'read' ? db.read(c.auth, c.path) : c.op === 'set' ? db.write(c.auth, c.path, c.value) : db.update(c.auth, c.map)).allowed;
}
function theirs(c) {
  const db = targaryen.database(RULES, c.data || BASE, NOW).as(c.auth);
  const p = '/' + (c.path || '');
  try {
    if (c.op === 'read') return db.read(p, { now: NOW }).allowed;
    if (c.op === 'set') return db.write(p, c.value, { now: NOW }).allowed;
    return db.update('/', c.map, { now: NOW }).allowed;
  } catch (e) { return 'threw: ' + e.message; }
}

let bad = 0;
console.log('1. the case table (' + CASES.length + ' cases)');
for (const c of CASES) {
  const a = mine(c), b = theirs(c);
  if (a !== c.allow || b !== c.allow) { bad++; console.log('  DISAGREE  ' + c.name + '\n     expected ' + c.allow + ' · rules-eval ' + a + ' · targaryen ' + b); }
}
console.log(bad ? '   ' + bad + ' disagreement(s)' : '   both evaluators give the expected answer on every case');

/* ---- random operations: no expected answer, only "do the two agree" ---- */
let seed = 20261115;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const UIDS = ['uOwner', 'uDev', 'uOther', 'uNew', 'uOld', 'uSlow', 'uFresh'];
const AUTHS = UIDS.map(uid => ({ uid })).concat([null, null]);
const CODES = ['aaaa2222', 'bbbb3333', 'cccc4444', 'dddd5555', 'BAD-CODE', 'zzzz9999'];
const KEYS = ['c~w1:rec', 'c~w2:prod', 'c~g:n22-1', 'h~w3', 's~curLesson', 'x~' + 'x'.repeat(499), 'd~2026-11-14~k3j9x2ab', 'h', 'm', 'j', 'd', 'v', 'seen', 'name', 'at', 'uid', 'ans', 'owner', 'state'];
const BRANCHES = ['rec', 'rec', 'rec', 'meta', 'meta/v', 'meta/migration', 'profile', 'devices', 'joining', 'voice'];
const DAY = NOW - 86400000;
/* stamps around the ones in the fixture (c~w1:rec holds H(DAY, 4)): equal, either side, malformed, not a string */
const STAMPS = () => pick([H(DAY, 4), H(DAY, 4), H(DAY, 3), H(DAY, 5), H(DAY, 0), H(DAY, 1), H(DAY, 2), H(NOW), H(DAY - 5000), H(0, 0, '0a1b2c3d'), H(DAY, 4, 'a0000000'), H(DAY, 4, 'zzzzzzzz'), H(DAY, 4, 'K3J9X2AB'), 'zzzzzzzzz000k3j9x2ab', 'bad stamp', '0n1x8k2ab004', '0n1x8k2ab004' + 'x'.repeat(52), 12345, null]);
const SCALARS = () => pick([null, null, 1, 0, 2, -5, NOW, NOW - 1, NOW + 5, true, false, 'x', '', '"r,1,2"', 'uOwner', 'uNew', 'uFresh', 'aaaa2222', 'dddd5555', 'x'.repeat(41), 'x'.repeat(61), 'x'.repeat(100001), TS, 'done']);
function value(depth) {
  const r = rnd();
  if (depth > 2 || r < 0.25) return rnd() < 0.2 ? STAMPS() : SCALARS();
  if (r < 0.6) { const o = { h: STAMPS(), m: pick([TS, TS, TS, NOW, NOW - 1, '1', null]) }; const k = rnd(); if (k < 0.6) o.j = pick(['"r,1,2"', '""', '22', 5, null, 'x'.repeat(100001)]); else if (k < 0.85) o.d = pick([1, 1, 2, true]); else if (k < 0.93) { o.j = '1'; o.d = 1; } if (rnd() < 0.05) o.z = 1; return o; }
  if (r < 0.7) return { uid: pick(UIDS), name: pick(['iPad', 'x'.repeat(41), 5]), at: pick([TS, NOW, NOW - 5, 'now']) };
  if (r < 0.8) return { name: pick(['iPad', 'x'.repeat(41), 7]), at: pick([TS, 1, 'one']), seen: pick([null, 1, 'x']) };
  if (r < 0.87) return { owner: pick(UIDS), name: pick(['Lin', null, 'x'.repeat(61)]) };
  if (r < 0.92) return { state: pick(['copying', 'done', 5, 'x'.repeat(11)]), from: pick(['room', null]), records: pick([1, 'x', null]) };
  const o = {}; const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) o[pick(KEYS)] = value(depth + 1);
  return o;
}
function path() {
  const r = rnd();
  if (r < 0.1) return 'rooms/' + pick(['zika-test01', 'zika-new']) + pick(['', '/study_state', '/study_state/synced_at', '/sync_log', '/sync_log/-Nz', '/else']);
  if (r < 0.3) return 'joins' + pick(['', '/' + pick(CODES), '/' + pick(CODES) + '/' + pick(['uid', 'name', 'at', 'ans', 'ans/owner', 'ans/name', 'zz'])]);
  if (r < 0.34) return pick(['', 'users', 'rooms', 'other', 'other/x']);
  let p = 'users/' + pick(UIDS);
  if (rnd() < 0.12) return p;
  p += '/' + pick(BRANCHES);
  const depth = Math.floor(rnd() * 4);
  for (let i = 0; i < depth; i++) p += '/' + pick(rnd() < 0.3 ? UIDS : KEYS);
  return p;
}
const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/') || a === '' || b === '';
/* three starting databases: the fixture, the fixture after an approval and an answer, and an empty one */
const DATAS = [BASE, (() => { const d = JSON.parse(JSON.stringify(BASE)); d.joins.aaaa2222.ans = { owner: 'uOwner', name: 'Lin' }; d.users.uOwner.devices.uNew = { name: 'iPhone', at: 7 }; d.users.uOwner.devices.uDev.seen = 3; d.users.uOwner.meta.migration = { state: 'copying', from: 'room' }; return d; })(), null];

const N = Number(process.argv[2]) || 20000;
let diff = 0, allowed = 0, threw = 0;
const byOp = { read: [0, 0], set: [0, 0], update: [0, 0] };
console.log('2. ' + N + ' random operations through both evaluators');
for (let i = 0; i < N; i++) {
  const r = rnd(), c = { auth: pick(AUTHS), data: pick(DATAS) };
  if (r < 0.2) { c.op = 'read'; c.path = path(); }
  else if (r < 0.65) { c.op = 'set'; c.path = path(); c.value = value(0); }
  else {
    c.op = 'update'; c.map = {};
    const n = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) { const p = path(); if (p && !Object.keys(c.map).some(q => overlaps(p, q))) c.map[p] = value(0); }
    if (Object.keys(c.map).length < 2) { i--; continue; }
  }
  if (c.op !== 'update' && c.op !== 'read' && c.path === '') { i--; continue; }
  const a = mine(c), b = theirs(c);
  byOp[c.op][0]++; if (a === true) { allowed++; byOp[c.op][1]++; }
  if (typeof b === 'string') { threw++; if (threw <= 3) console.log('  targaryen ' + b + '\n     ' + JSON.stringify(c).slice(0, 300)); continue; }
  if (a !== b) { diff++; if (diff <= 12) console.log('  DISAGREE  rules-eval ' + a + ' · targaryen ' + b + '\n     ' + JSON.stringify({ auth: c.auth, op: c.op, path: c.path, value: c.value, map: c.map, data: c.data === BASE ? 'BASE' : c.data ? 'ANSWERED' : 'EMPTY' }).slice(0, 600)); }
}
console.log('   ' + (diff ? diff + ' disagreement(s)' : 'no disagreement') + ' · ' + allowed + ' of ' + N + ' allowed by both (read ' + byOp.read[1] + '/' + byOp.read[0] + ', set ' + byOp.set[1] + '/' + byOp.set[0] + ', update ' + byOp.update[1] + '/' + byOp.update[0] + ')' + (threw ? ' · targaryen threw on ' + threw : ''));

/* ---- the cases themselves, each nudged at random: this stays close to the boundaries the
        rules draw, where blind random operations almost never land ---- */
function nudge(c) {
  const n = JSON.parse(JSON.stringify(c));
  const leaves = [];
  (function walk(o, set) {
    if (o === null || typeof o !== 'object' || (Object.keys(o).length === 1 && o['.sv'])) { leaves.push(set); return; }
    for (const k of Object.keys(o)) walk(o[k], v => { if (v === undefined) delete o[k]; else o[k] = v; });
  })(n.op === 'update' ? n.map : { value: n.value }, () => {});
  const times = 1 + Math.floor(rnd() * 2);
  for (let t = 0; t < times; t++) {
    const r = rnd();
    if (r < 0.3) n.auth = pick(AUTHS);
    else if (r < 0.6 && leaves.length) pick(leaves)(rnd() < 0.2 ? undefined : SCALARS());
    else if (r < 0.7 && n.op === 'update') { const ks = Object.keys(n.map); if (ks.length > 1) delete n.map[pick(ks)]; }
    else if (r < 0.8 && n.op === 'update') { const p = path(); if (p && !Object.keys(n.map).some(q => overlaps(p, q))) n.map[p] = value(0); }
    else if (r < 0.9) n.data = pick(DATAS);
    else if (n.op !== 'update') n.path = path() || n.path;
  }
  if (n.op === 'set' && n.value === undefined) n.value = null;
  if (n.op === 'update' && !Object.keys(n.map).length) return null;
  return n;
}
let diff2 = 0, allowed2 = 0, ran2 = 0; const M = Math.max(2000, Math.round(N / 2));
const by2 = { read: [0, 0], set: [0, 0], update: [0, 0] };
console.log('3. ' + M + ' nudged cases through both evaluators');
while (ran2 < M) {
  const c = nudge(pick(CASES)); if (!c) continue;
  const a = mine(c), b = theirs(c); ran2++;
  by2[c.op][0]++; if (a === true) { allowed2++; by2[c.op][1]++; }
  if (typeof b === 'string') { threw++; continue; }
  if (a !== b) { diff2++; if (diff2 <= 12) console.log('  DISAGREE  rules-eval ' + a + ' · targaryen ' + b + '\n     ' + JSON.stringify({ auth: c.auth, op: c.op, path: c.path, value: c.value, map: c.map }).slice(0, 600)); }
}
console.log('   ' + (diff2 ? diff2 + ' disagreement(s)' : 'no disagreement') + ' · ' + allowed2 + ' of ' + M + ' allowed by both (read ' + by2.read[1] + '/' + by2.read[0] + ', set ' + by2.set[1] + '/' + by2.set[0] + ', update ' + by2.update[1] + '/' + by2.update[0] + ')');

/* ---- can this script see a difference at all? Give targaryen a weakened copy of the rules
        and count how often the two now disagree. Zero would mean the comparison is blind. ---- */
const weak = JSON.parse(JSON.stringify(RULES));
weak.rules.users.$uid['.read'] = 'auth != null';
weak.rules.users.$uid.rec.$key['.validate'] = weak.rules.users.$uid.rec.$key['.validate'].replace(">= data.child('h').val()", "!== data.child('h').val()");
weak.rules.joins.$code.ans['.write'] = weak.rules.joins.$code.ans['.write'].replace(/ && newData\.parent\(\)\.parent\(\)\.parent\(\).*$/, '');
let seen = 0;
for (const c of CASES) {
  const db = targaryen.database(weak, c.data || BASE, NOW).as(c.auth), p = '/' + (c.path || '');
  const b = c.op === 'read' ? db.read(p, { now: NOW }).allowed : c.op === 'set' ? db.write(p, c.value, { now: NOW }).allowed : db.update('/', c.map, { now: NOW }).allowed;
  if (b !== mine(c)) seen++;
}
console.log('4. self-test: with three rules weakened on one side, ' + seen + ' cases disagree' + (seen >= 3 ? ' (the comparison can see a difference)' : ' — THE COMPARISON IS BLIND'));
process.exit(bad || diff || diff2 || seen < 3 ? 1 : 0);

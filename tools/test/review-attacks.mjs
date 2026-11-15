#!/usr/bin/env node
/* An independent, adversarial review of firebase/database.rules.json. Not written by the authors of the rules.

   Four parts:
     1. ATTACKS   concrete attacks on the rules, each with the verdict the rules SHOULD give.
     2. PROBES    small rule sets that pin down one point of the rules language each, to find
                  where tools/test/rules-eval.mjs and the real thing differ.
     3. FUZZ      random operations against the real rules, then the authors' own cases and the
                  attacks nudged at random (which stays near the boundaries): evaluator against emulator.
     4. LISTEN    does a device that was removed keep receiving through a listener it already had?
     5. FIXES     the rules with the changes this review proposes (fixedRules() below): which attacks
                  close, and whether any of the authors' 184 cases changes its answer.

   Evaluator only (parts 1 and 2, the evaluator's column):
       node tools/test/review-attacks.mjs

   Evaluator and the official emulator side by side (all four parts). Needs Java, and
   firebase-tools, @firebase/rules-unit-testing and firebase in tools/test/.cross:
       cd firebase && ../tools/test/.cross/node_modules/.bin/firebase emulators:exec --only database \
           --project demo-zika "node ../tools/test/review-attacks.mjs [fuzz count]"

   It talks to nothing but the emulator on this machine. Exit code: 0 always (it is a report). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { RulesDb } from './rules-eval.mjs';
import { BASE, NOW, TS, H, CASES } from './rules-cases.mjs';

const RULES_TEXT = readFileSync(new URL('../../firebase/database.rules.json', import.meta.url), 'utf8');
const RULES = JSON.parse(RULES_TEXT);
const EMU = !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

const owner = { uid: 'uOwner' }, device = { uid: 'uDev' }, other = { uid: 'uOther' }, fresh = { uid: 'uFresh' }, asking = { uid: 'uNew' };
const MIN = 60000, T0 = NOW - 86400000;
const S = n => 'x'.repeat(n);
const R = 'users/uOwner/rec/';
const rec = (h, j) => ({ h, m: TS, j: j === undefined ? '"r,1,2"' : j });
const clone = o => JSON.parse(JSON.stringify(o));
const edit = fn => { const d = clone(BASE); fn(d); return d; };
const MAXSTAMP = 'z'.repeat(63);                       /* the largest stamp the rule accepts: nothing is >= it but itself */
const ANSWERED = edit(d => { d.joins.aaaa2222.ans = { owner: 'uOwner', name: 'Lin' }; d.users.uOwner.devices.uNew = { name: 'iPhone', at: 7 }; });
const WITH_THIRD = edit(d => { d.users.uOwner.devices.uThird = { name: 'Mac', at: 6 }; });
const NO_DEV = edit(d => { delete d.users.uOwner.devices; });

/* A case: { id, sev, name, steps: [{auth, op, path, value | map}], data?, should }
   The verdict is the LAST step's; the steps before it are set-up and must be allowed.
   should: what a safe set of rules would answer. A case where the rules answer otherwise is a finding. */
const one = (auth, op, path, value) => (op === 'update' ? [{ auth, op, map: path }] : [{ auth, op, path, value }]);
export const ATTACKS = [
  /* ---------- holes: the rules allow what they should refuse ---------- */
  { id: 'V1', sev: 'denial', name: 'an approved device raises meta/v: every client of the deck halts ("newer")',
    steps: one(device, 'set', 'users/uOwner/meta/v', 2), should: false },
  { id: 'V2', sev: 'denial', name: '…and the owner cannot put it back (only deleting the whole account does)',
    steps: [{ auth: device, op: 'set', path: 'users/uOwner/meta/v', value: 1e300 }, { auth: owner, op: 'set', path: 'users/uOwner/meta/v', value: 1 }], should: true },
  { id: 'V3', sev: 'denial', name: 'a brand-new tree: the first writer may set meta/v to anything',
    steps: one(fresh, 'set', 'users/uFresh/meta/v', 1e300), should: false },
  { id: 'F1', sev: 'denial', name: 'an approved device writes the largest possible stamp (clock in the year 5188)',
    steps: one(device, 'set', R + 'c~w1:rec', rec(MAXSTAMP, '"poison"')), should: false },
  { id: 'F2', sev: 'denial', name: '…after which the owner can never write that record again, even with the device removed',
    steps: [{ auth: device, op: 'set', path: R + 'c~w1:rec', value: rec(MAXSTAMP, '"poison"') }, { auth: owner, op: 'set', path: 'users/uOwner/devices/uDev', value: null }, { auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(NOW, 0)) }], should: true },
  { id: 'F3', sev: 'denial', name: '…and one write freezes the whole deck that way',
    steps: [{ auth: device, op: 'set', path: 'users/uOwner/rec', value: Object.fromEntries(Object.keys(BASE.users.uOwner.rec).map(k => [k, rec(MAXSTAMP, '"poison"')])) }], should: false },
  { id: 'N1', sev: 'hardening', name: 'newer-only is not a boundary: remove the record, then write an older stamp',
    steps: [{ auth: device, op: 'set', path: R + 'c~w1:rec', value: null }, { auth: device, op: 'set', path: R + 'c~w1:rec', value: rec(H(0, 0, '0a1b2c3d')) }], should: false },
  { id: 'N2', sev: 'hardening', name: 'an approved device removes every record in one write, with no tombstone for the other devices to see',
    steps: one(device, 'set', 'users/uOwner/rec', null), should: false },
  { id: 'P1', sev: 'cost', name: 'a megabyte rides on a join request as a priority (a stranger, one write)',
    steps: one(fresh, 'update', { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: TS, '.priority': S(1000000) } }), should: false },
  { id: 'P2', sev: 'cost', name: 'a megabyte rides on a record field as a priority, past the 100,000 limit on j',
    steps: one(owner, 'set', R + 'c~w9:rec', { h: H(NOW), m: TS, j: { '.value': '1', '.priority': S(1000000) } }), should: false },
  { id: 'P3', sev: 'cost', name: 'a megabyte rides on the 60-character profile name as a priority',
    steps: one(owner, 'set', 'users/uOwner/profile/name', { '.value': 'Lin', '.priority': S(1000000) }), should: false },
  { id: 'P4', sev: 'cost', name: 'a megabyte rides on the join pointer as a priority',
    steps: one(fresh, 'set', 'users/uFresh/joining', { '.value': 'dddd5555', '.priority': S(1000000) }), should: false },
  { id: 'A1', sev: 'hardening', name: 'a request is filed with its answer already in it, naming any uid as the owner (the answer rule is skipped: the parent grants)',
    steps: one(fresh, 'update', { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: TS, ans: { owner: 'uOwner', name: 'Lin' } } }), should: false },
  { id: 'A2', sev: 'takeover', name: 'anyone who learns a standing code answers it first and pulls the new device into THEIR deck',
    steps: one(other, 'update', { 'users/uOther/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOther', name: 'Lin' } }), should: false },
  { id: 'A3', sev: 'leak', name: 'an answered request shows the owner\'s uid and name to anyone who has the code',
    steps: one(other, 'read', 'joins/aaaa2222/ans'), data: ANSWERED, should: false },
  { id: 'A4', sev: 'hardening', name: 'a code is reused: clear an expired request, file your own under the same code',
    steps: [{ auth: other, op: 'set', path: 'joins/bbbb3333', value: null }, { auth: other, op: 'update', map: { 'users/uOther/joining': 'bbbb3333', 'joins/bbbb3333': { uid: 'uOther', name: 'Old phone', at: TS } } }], should: false },
  { id: 'C1', sev: 'cost', name: 'an anonymous stranger stores 5 MB in one write under its own tree (50 records of 100,000)',
    steps: one(fresh, 'update', Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['users/uFresh/rec/x~' + i, rec(H(NOW, i), S(100000))]))), should: false },
  { id: 'C2', sev: 'cost', name: 'legacy, as today: an anonymous stranger makes a new room and stores 5 MB in it',
    steps: one(fresh, 'set', 'rooms/zz-stranger/blob', S(5000000)), should: false },
  { id: 'C3', sev: 'cost', name: 'an owner lists thousands of devices (each a uid nobody checked)',
    steps: one(fresh, 'update', Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['users/uFresh/devices/d' + i, { name: S(40), at: 1 }]))), should: false },
  { id: 'I1', sev: 'hardening', name: 'the server increment is accepted where a number is (meta/v raised without reading it)',
    steps: one(device, 'set', 'users/uOwner/meta/v', { '.sv': { increment: 5 } }), should: false },
  { id: 'X1', sev: 'hardening', name: 'a join pointer with a line break after the code',
    steps: one(fresh, 'set', 'users/uFresh/joining', 'dddd5555\n'), should: false },
  { id: 'X2', sev: 'hardening', name: 'a stamp with a line break after it',
    steps: one(owner, 'set', R + 'c~w2:rec', rec(H(NOW) + '\n')), should: false },
  { id: 'X3', sev: 'hardening', name: 'a record key the engine cannot place (no kind, no ~)',
    steps: one(device, 'set', R + 'constructor', rec(H(NOW))), should: false },
  { id: 'X4', sev: 'hardening', name: 'a value that is not JSON in j',
    steps: one(device, 'set', R + 'c~w1:rec', rec(H(NOW), '{not json')), should: false },
  { id: 'X5', sev: 'hardening', name: 'the approval time of a device is any number, not the server\'s clock',
    steps: one(owner, 'set', 'users/uOwner/devices/uThird', { name: 'iPhone', at: -1 }), should: false },

  /* ---------- controls: attacks the rules must refuse (and do, if the semantics are as assumed) ---------- */
  { id: 'K01', name: 'a stranger reads another deck\'s device list', steps: one(other, 'read', 'users/uOwner/devices'), should: false },
  { id: 'K02', name: 'a stranger reads another user\'s join pointer (the code)', steps: one(other, 'read', 'users/uNew/joining'), should: false },
  { id: 'K03', name: 'a stranger reads one field of one record', steps: one(other, 'read', R + 'c~w1:rec/j'), should: false },
  { id: 'K04', name: 'a stranger reads the format version', steps: one(other, 'read', 'users/uOwner/meta/v'), should: false },
  { id: 'K05', name: 'nobody signed in reads a join request', steps: one(null, 'read', 'joins/aaaa2222/uid'), should: false },
  { id: 'K06', name: 'a stranger approves itself, the pieces written as separate paths', steps: one(other, 'update', { 'users/uOwner/devices/uOther/name': 'x', 'users/uOwner/devices/uOther/at': 1, 'users/uOwner/devices/uOther/seen': 1 }), should: false },
  { id: 'K07', name: 'a stranger hides a write to another deck among writes to its own', steps: one(other, 'update', { 'users/uOther/profile': { name: 'x' }, [R + 'c~w1:rec']: rec(H(NOW)) }), should: false },
  { id: 'K08', name: 'a stranger writes the whole users branch', steps: one(other, 'set', 'users', { uOwner: { devices: { uOther: { name: 'x', at: 1 } } } }), should: false },
  { id: 'K09', name: 'a stranger writes the root', steps: one(other, 'update', { users: null, rooms: null, joins: null }), should: false },
  { id: 'K10', name: 'a stranger empties another deck branch by branch', steps: one(other, 'update', { 'users/uOwner/rec': null, 'users/uOwner/meta': null, 'users/uOwner/profile': null, 'users/uOwner/devices': null }), should: false },
  { id: 'K11', name: 'an approved device empties the deck branch by branch (the delete-my-data rule, reached from below)', steps: one(device, 'update', { 'users/uOwner/rec': null, 'users/uOwner/meta': null, 'users/uOwner/profile': null, 'users/uOwner/devices': null }), should: false },
  { id: 'K12', name: 'an approved device removes another approved device', steps: one(device, 'set', 'users/uOwner/devices/uThird', null), data: WITH_THIRD, should: false },
  { id: 'K13', name: 'an approved device removes the whole device list', steps: one(device, 'set', 'users/uOwner/devices', null), data: WITH_THIRD, should: false },
  { id: 'K14', name: 'an approved device stamps another device\'s seen', steps: one(device, 'set', 'users/uOwner/devices/uThird/seen', 5), data: WITH_THIRD, should: false },
  { id: 'K15', name: 'a removed device lets itself back in', steps: one(device, 'set', 'users/uOwner/devices/uDev', { name: 'iPad', at: 5 }), data: NO_DEV, should: false },
  { id: 'K16', name: 'a removed device lets itself back in through seen', steps: one(device, 'update', { 'users/uOwner/devices/uDev/seen': 5, 'users/uOwner/devices/uDev/name': 'iPad', 'users/uOwner/devices/uDev/at': 5 }), data: NO_DEV, should: false },
  { id: 'K17', name: 'a removed device reads one record', steps: one(device, 'read', R + 'c~w1:rec'), data: NO_DEV, should: false },
  { id: 'K18', name: 'a removed device raises meta/v', steps: one(device, 'set', 'users/uOwner/meta/v', 9), data: NO_DEV, should: false },
  { id: 'K19', name: 'a forged m, written alone under an existing record', steps: one(device, 'set', R + 'c~w1:rec/m', NOW + 9e9), should: false },
  { id: 'K20', name: 'm removed from a record, leaving it invisible to the catch-up query', steps: one(device, 'set', R + 'c~w1:rec/m', null), should: false },
  { id: 'K21', name: 'j removed from a record, leaving {h, m}', steps: one(device, 'set', R + 'c~w1:rec/j', null), should: false },
  { id: 'K22', name: 'a record made of a forged m in the same update as its other fields', steps: one(device, 'update', { [R + 'c~w7:rec/h']: H(NOW), [R + 'c~w7:rec/j']: '1', [R + 'c~w7:rec/m']: T0 }), should: false },
  { id: 'K23', name: 'a branch written under j', steps: one(device, 'set', R + 'c~w1:rec/j/deep', S(1000)), should: false },
  { id: 'K24', name: 'a branch written under meta/v', steps: one(owner, 'set', 'users/uOwner/meta/v/x', 1), should: false },
  { id: 'K25', name: 'a second answer to an answered request', steps: one(other, 'update', { 'users/uOther/devices/uNew': { name: 'i', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOther' } }), data: ANSWERED, should: false },
  { id: 'K26', name: 'the answer of an answered request is rewritten field by field', steps: one(other, 'update', { 'users/uOther/devices/uNew': { name: 'i', at: TS }, 'joins/aaaa2222/ans/owner': 'uOther' }), data: ANSWERED, should: false },
  { id: 'K27', name: 'the asking device removes the answer to be answered again', steps: one(asking, 'set', 'joins/aaaa2222/ans', null), data: ANSWERED, should: false },
  { id: 'K28', name: 'a stranger changes the uid of a standing request', steps: one(other, 'update', { 'users/uOther/joining': 'aaaa2222', 'joins/aaaa2222/uid': 'uOther' }), should: false },
  { id: 'K29', name: 'a stranger replaces a standing request whole', steps: one(other, 'update', { 'users/uOther/joining': 'aaaa2222', 'joins/aaaa2222': { uid: 'uOther', name: 'iPhone', at: TS } }), should: false },
  { id: 'K30', name: 'a stranger answers for another owner (approval written into its own tree)', steps: one(other, 'update', { 'users/uOther/devices/uNew': { name: 'i', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner' } }), should: false },
  { id: 'K31', name: 'an expired request is answered by someone who refreshes its time', steps: one(other, 'update', { 'users/uOther/devices/uSlow': { name: 'i', at: TS }, 'joins/cccc4444/at': TS, 'joins/cccc4444/ans': { owner: 'uOther' } }), should: false },
  { id: 'K32', name: 'one account holds two requests by pointing at the second and filing both', steps: one(asking, 'update', { 'users/uNew/joining': 'eeee6666', 'joins/eeee6666': { uid: 'uNew', name: 'i', at: TS }, 'joins/ffff7777': { uid: 'uNew', name: 'i', at: TS } }), should: false },
  { id: 'K33', name: 'the pointer is dropped by deleting the tree from below while the request stands', steps: one(asking, 'set', 'users/uNew/joining', null), should: false },
  { id: 'K34', name: 'the list of rooms', steps: one(other, 'read', 'rooms'), should: false },
  { id: 'K35', name: 'the list of users, shallow', steps: one(owner, 'read', 'users'), should: false },
  { id: 'K36', name: 'room: a field of the deck changed without a newer stamp', steps: one(fresh, 'set', 'rooms/zika-test01/study_state/json', '{}'), should: false },
  { id: 'K37', name: 'room: the stamp removed from the deck', steps: one(fresh, 'set', 'rooms/zika-test01/study_state/synced_at', null), should: false },
  { id: 'K38', name: 'room: an older deck slipped in by writing the room whole', steps: one(fresh, 'set', 'rooms/zika-test01', { study_state: { json: '{}', synced_at: 1 } }), should: false },
  { id: 'K39', name: 'an unlisted top-level branch', steps: one(owner, 'set', 'scratch', S(1000)), should: false },
  { id: 'K40', name: 'a device entry for a key longer than a uid', steps: one(owner, 'set', 'users/uOwner/devices/' + S(129), { name: 'x', at: 1 }), should: false },

  /* ---------- must keep working ---------- */
  { id: 'L1', name: 'legacy: an anonymous device saves a newer deck into its room', steps: one(fresh, 'set', 'rooms/zika-test01/study_state', { v: 18, json: '{}', synced_at: 6000 }), should: true },
  { id: 'L2', name: 'legacy: an anonymous device reads its room', steps: one(fresh, 'read', 'rooms/zika-test01'), should: true },
  { id: 'L3', name: 'legacy: an anonymous device starts a new room', steps: one(fresh, 'set', 'rooms/zika-new001/study_state', { v: 18, json: '{}', synced_at: 1 }), should: true },
];

/* ------------------------------------------------------------------ the evaluator */
function evalCase(c) {
  const db = new RulesDb(RULES, c.data || BASE, { now: NOW });
  let last = null;
  for (let i = 0; i < c.steps.length; i++) {
    const s = c.steps[i];
    try { last = (s.op === 'read' ? db.read(s.auth, s.path) : s.op === 'set' ? db.write(s.auth, s.path, s.value) : db.update(s.auth, s.map)).allowed; }
    catch (e) { return 'threw: ' + e.message; }
    if (i < c.steps.length - 1 && !last) return 'set-up step ' + (i + 1) + ' refused';
  }
  return last;
}

/* ------------------------------------------------------------------ the emulator */
let rut = null, fdb = null;
if (EMU) {
  const require = createRequire(new URL('./.cross/', import.meta.url));
  rut = require('@firebase/rules-unit-testing');
  fdb = require('firebase/database');
}
const shift = Date.now() - NOW;
const move = v => {
  if (typeof v === 'number') return Math.abs(v - NOW) < 86400000 * 2 ? v + shift : v;
  if (v === null || typeof v !== 'object') return v;
  const o = {}; for (const k of Object.keys(v)) o[k] = move(v[k]); return o;
};
const denied = e => /permission[_ ]denied/i.test(String(e && (e.code || '') + ' ' + (e.message || '')));
async function emuOp(env, s) {
  const db = (s.auth ? env.authenticatedContext(s.auth.uid) : env.unauthenticatedContext()).database();
  try {
    if (s.op === 'read') await fdb.get(s.path ? fdb.ref(db, s.path) : fdb.ref(db));
    else if (s.op === 'set') await fdb.set(fdb.ref(db, s.path), move(s.value));
    else await fdb.update(fdb.ref(db), move(s.map));
    return true;
  } catch (e) { if (denied(e)) return false; return 'error: ' + String(e && e.message).slice(0, 120); }
}
async function emuCase(env, c) {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(ctx => fdb.set(fdb.ref(ctx.database()), move(c.data || BASE)));
  let last = null;
  for (let i = 0; i < c.steps.length; i++) {
    last = await emuOp(env, c.steps[i]);
    if (i < c.steps.length - 1 && last !== true) return 'set-up step ' + (i + 1) + ' refused';
  }
  return last;
}

/* ------------------------------------------------------------------ probes of the rules language
   Each: a rule set, the data before, one write as uid u1, and nothing expected: the two columns are compared. */
const D = { s: 'a', t: 'b', K: 'K', k: 'k', n: 1800000300000, f: 1.5, one: 1, str1: '1', obj: { a: 1 }, smile: '\u{1F600}', yes: true };
const w = expr => ({ rules: { probe: { '.write': expr }, d: { '.read': true } } });
const d = p => "root.child('d/" + p + "').val()";
export const PROBES = [
  ['null < 1', w(d('missing') + ' < 1'), 1],
  ['null + 1 > 0', w(d('missing') + ' + 1 > 0'), 1],
  ['null < null', w(d('missing') + ' < ' + d('missing2')), 1],
  ['null <= null', w(d('missing') + ' <= ' + d('missing2')), 1],
  ['null >= null', w(d('missing') + ' >= ' + d('missing2')), 1],
  ['null === null (two missing nodes)', w(d('missing') + ' === ' + d('missing2')), 1],
  ["'a' < 'b'", w(d('s') + ' < ' + d('t')), 1],
  ["'a' >= 'a'", w(d('s') + ' >= ' + d('s')), 1],
  ["'K' < 'k' (code-unit order)", w(d('K') + ' < ' + d('k')), 1],
  ["'a' < 5 (string against number)", w(d('s') + ' < 5'), 1],
  ["'a' >= null (string against a missing node: the newer-only rule on a record without h)", w(d('s') + ' >= ' + d('missing')), 1],
  ["number + '' gives plain digits", w('(' + d('n') + " + '') === '1800000300000'"), 1],
  ["'' + 1.5 === '1.5'", w("('' + " + d('f') + ") === '1.5'"), 1],
  ["'' + now has 13 characters", w("('' + now).length === 13"), 1],
  ["length of one emoji is 2 (UTF-16 units)", w(d('smile') + '.length === 2'), 1],
  ["length of one emoji is 1 (code points)", w(d('smile') + '.length === 1'), 1],
  ['regex $ refuses a trailing line break', w("!newData.child('x').val().matches(/^[a-z]{3}$/)"), 'abc\n'],
  ['regex $ refuses a trailing CR', w("!newData.child('x').val().matches(/^[a-z]{3}$/)"), 'abc\r'],
  ['regex without anchors matches inside', w("newData.child('x').val().matches(/b/)"), 'abc'],
  ['regex i flag', w("newData.child('x').val().matches(/^ABC$/i)"), 'abc'],
  ['regex . does not cross a line break', w("!newData.child('x').val().matches(/^a.c$/)"), 'a\nc'],
  ['hasChildren() of a branch', w("root.child('d/obj').hasChildren()"), 1],
  ['hasChildren() of a string is false', w("!root.child('d/s').hasChildren()"), 1],
  ['hasChildren() of nothing is false', w("!root.child('d/missing').hasChildren()"), 1],
  ['hasChildren([]) (empty list)', w("root.child('d/obj').hasChildren([])"), 1],
  ['the timestamp placeholder === now', w("newData.child('x').val() === now"), TS],
  ["== is strict: 1 == '1' is false", w('!(' + d('one') + ' == ' + d('str1') + ')'), 1],
  ['val() of a missing node === null', w(d('missing') + ' === null'), 1],
  ['val() of a branch !== null', w(d('obj') + ' !== null'), 1],
  ['val() of a branch === val() of the same branch', w(d('obj') + ' === ' + d('obj')), 1],
  ['! of a non-boolean (null)', w('!' + d('missing')), 1],
  ['&& of a non-boolean (number)', w(d('one') + ' && true'), 1],
  ['|| short-circuits past an error on the right', w('true || ' + d('missing') + '.length > 0'), 1],
  ['|| with an error on the left', w(d('missing') + '.length > 0 || true'), 1],
  ['&& with false first skips an error on the right', w('!(false && ' + d('missing') + '.length > 0)'), 1],
  ['1 + 2 * 3 === 7', w('1 + 2 * 3 === 7'), 1],
  ['7 % 3 === 1', w('7 % 3 === 1'), 1],
  ['7 / 2 === 3.5', w('7 / 2 === 3.5'), 1],
  ['-1 < 0', w('-1 < 0'), 1],
  ['ternary', w('(1 < 2 ? 5 : 6) === 5'), 1],
  ['=== binds tighter than &&, && than ||', w('false && false || true'), 1],
  ['!== between two booleans', w("newData.child('x').exists() !== newData.child('y').exists()"), 1],
  ['replace replaces every occurrence', w("'a.b.c'.replace('.', '') === 'abc'"), 1],
  ['contains / beginsWith / endsWith', w("'abc'.contains('b') && 'abc'.beginsWith('a') && 'abc'.endsWith('c')"), 1],
  ['toUpperCase', w("'abc'.toUpperCase() === 'ABC'"), 1],
  ['length of a number is an error', w(d('one') + '.length === 1'), 1],
  ["child('a/b') goes two levels", w("root.child('d').child('obj/a').val() === 1"), 1],
  ['parent() above the written path sees the old sibling', w("newData.parent().child('d/s').val() === 'a'"), 1],
  ['data.parent() works', w("data.parent().child('d/s').val() === 'a'"), 1],
  ['auth.uid', w("auth.uid === 'u1'"), 1],
  ['auth.token exists', w('auth.token !== null'), 1],
  ['auth.token.email_verified is absent or false for a plain uid', w('auth.token.email_verified !== true'), 1],
  ["auth.token.firebase.sign_in_provider", w("auth.token.firebase.sign_in_provider === 'anonymous'"), 1],
  ['auth.provider', w("auth.provider === 'anonymous'"), 1],
  ['an unknown property of auth is null', w('auth.nope === null'), 1],
  ['isNumber of a numeric string is false', w("!newData.child('x').isNumber()"), '5'],
  ['a server increment is a number to the rule', w("newData.child('x').isNumber()"), { '.sv': { increment: 1 } }],
  ['a value with a priority is still its value', w("newData.child('x').isNumber()"), { '.value': 1, '.priority': 'p' }],
  ['getPriority() sees the priority', w("newData.child('x').getPriority() === 'p'"), { '.value': 1, '.priority': 'p' }],
  ['getPriority() of a plain value is null', w("newData.child('x').getPriority() === null"), 1],
  ['a priority is not a child ($other does not see it)', { rules: { probe: { '.write': true, x: { '.validate': 'newData.hasChildren([\'a\'])', a: { '.validate': true }, $other: { '.validate': false } } } } }, { a: 1, '.priority': 'p' }],
];
/* writes that are not "set probe/x" */
export const PROBES2 = [
  { name: 'validate on the parent runs when one child is deleted and the parent remains', rules: { rules: { probe: { '.write': true, rec: { '.validate': "newData.hasChildren(['a', 'b'])" } } } }, data: { probe: { rec: { a: 1, b: 1 } } }, path: 'probe/rec/b', value: null },
  { name: 'validate does not run when the node itself is deleted', rules: { rules: { probe: { '.write': true, rec: { '.validate': "newData.hasChildren(['a', 'b'])" } } } }, data: { probe: { rec: { a: 1, b: 1 } } }, path: 'probe/rec', value: null },
  { name: 'validate on the parent runs when one child is written', rules: { rules: { probe: { '.write': true, rec: { '.validate': "newData.hasChildren(['a', 'b'])" } } } }, data: null, path: 'probe/rec/a', value: 1 },
  { name: 'validate on a child is skipped when the write is granted above? (it must not be)', rules: { rules: { probe: { '.write': true, rec: { a: { '.validate': 'newData.isNumber()' } } } } }, data: null, path: 'probe', value: { rec: { a: 'x' } } },
  { name: 'a .write below cannot take back a grant above', rules: { rules: { probe: { '.write': true, rec: { '.write': false } } } }, data: null, path: 'probe/rec/a', value: 1 },
  { name: 'a .write true below does not help a write to the parent', rules: { rules: { probe: { rec: { '.write': true } } } }, data: null, path: 'probe', value: { rec: 1 } },
  { name: 'newData in a multi-path update is the merged result (sibling path seen)', rules: { rules: { probe: { a: { '.write': "newData.parent().child('b').val() === 2" }, b: { '.write': true } } } }, data: null, map: { 'probe/a': 1, 'probe/b': 2 } },
  { name: 'data in a multi-path update is the state before (sibling path not seen)', rules: { rules: { probe: { a: { '.write': "!data.parent().child('b').exists() && !root.child('probe/b').exists()" }, b: { '.write': true } } } }, data: null, map: { 'probe/a': 1, 'probe/b': 2 } },
  { name: 'a multi-path update is refused whole when one path is refused', rules: { rules: { probe: { a: { '.write': true }, b: { '.write': false } } } }, data: null, map: { 'probe/a': 1, 'probe/b': 2 } },
  { name: 'a literal child wins over a wildcard', rules: { rules: { probe: { '.write': true, lit: { '.validate': true }, $w: { '.validate': false } } } }, data: null, path: 'probe/lit', value: 1 },
  { name: 'a wildcard validate applies to an unknown child of a write made above', rules: { rules: { probe: { '.write': true, $w: { '.validate': false } } } }, data: null, path: 'probe', value: { zz: 1 } },
  { name: 'writing an empty object is a deletion (no validate)', rules: { rules: { probe: { '.write': true, rec: { '.validate': false } } } }, data: { probe: { rec: 1 } }, path: 'probe/rec', value: {} },
];

async function probeEmu(rules, data, op) {
  let env;
  try { env = await rut.initializeTestEnvironment({ projectId: 'demo-zika-probe', database: { rules: JSON.stringify(rules) } }); }
  catch (e) { return 'rules refused at upload: ' + String(e && e.message).replace(/\s+/g, ' ').slice(0, 160); }
  try {
    await env.clearDatabase();
    if (data) await env.withSecurityRulesDisabled(ctx => fdb.set(fdb.ref(ctx.database()), data));
    return await emuOp(env, Object.assign({ auth: { uid: 'u1' } }, op));
  } finally { await env.cleanup(); }
}
function probeEval(rules, data, op) {
  try {
    const db = new RulesDb(rules, data, { now: NOW });
    return (op.op === 'set' ? db.write({ uid: 'u1' }, op.path, op.value) : db.update({ uid: 'u1' }, op.map)).allowed;
  } catch (e) { return 'threw: ' + String(e.message).slice(0, 100); }
}

/* ------------------------------------------------------------------ random operations */
function fuzzer(seed) {
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const UIDS = ['uOwner', 'uDev', 'uOther', 'uNew', 'uOld', 'uSlow', 'uFresh'];
  const AUTHS = UIDS.map(uid => ({ uid })).concat([null]);
  const CODES = ['aaaa2222', 'bbbb3333', 'cccc4444', 'dddd5555', 'BAD-CODE', 'zzzz9999'];
  const KEYS = ['c~w1:rec', 'c~w2:prod', 'h~w3', 's~curLesson', 'h', 'm', 'j', 'd', 'v', 'seen', 'name', 'at', 'uid', 'ans', 'owner', 'state'];
  const BRANCHES = ['rec', 'rec', 'rec', 'meta', 'meta/v', 'meta/migration', 'profile', 'devices', 'joining', 'voice'];
  const STAMP = () => pick([H(T0, 4), H(T0, 3), H(T0, 5), H(NOW), H(T0 - 5000), H(0, 0, '0a1b2c3d'), H(T0, 4, 'zzzzzzzz'), H(T0, 4, 'K3J9X2AB'), 'zzzzzzzzz000k3j9x2ab', 'bad stamp', 5, null, MAXSTAMP, H(NOW) + '\n']);
  /* no number equal to NOW: the emulator's clock is the real one, so only the placeholder can equal now */
  const SCALAR = () => pick([null, null, 1, 0, 2, -5, 12345, true, false, 'x', '', '"r,1,2"', 'uOwner', 'uNew', 'uFresh', 'aaaa2222', 'dddd5555', 'dddd5555\n', S(41), S(61), S(100001), TS, 'done', { '.sv': { increment: 1 } }, { '.value': 1, '.priority': 'p' }, { '.value': 'x', '.priority': 1 }]);
  function value(depth) {
    const r = rnd();
    if (depth > 2 || r < 0.25) return rnd() < 0.2 ? STAMP() : SCALAR();
    if (r < 0.6) { const o = { h: STAMP(), m: pick([TS, TS, TS, 12345, '1', null]) }; const k = rnd(); if (k < 0.6) o.j = pick(['"r,1,2"', '""', '22', 5, null, S(100001)]); else if (k < 0.85) o.d = pick([1, 1, 2, true]); else if (k < 0.93) { o.j = '1'; o.d = 1; } else o[pick(['x', '.priority'])] = 'x'; return o; }
    if (r < 0.7) return { uid: pick(UIDS), name: pick(['iPad', S(41), 5]), at: pick([TS, 12345, 'now']), ...(rnd() < 0.3 ? { ans: { owner: pick(UIDS) } } : {}) };
    if (r < 0.8) return { name: pick(['iPad', S(41), 7]), at: pick([TS, 1, 'one']), seen: pick([null, 1, 'x']) };
    if (r < 0.87) return { owner: pick(UIDS), name: pick(['Lin', null, S(61)]) };
    if (r < 0.92) return { state: pick(['copying', 'done', 5, S(11)]), from: pick(['room', null]), records: pick([1, 'x', null]) };
    const o = {}; const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) o[pick(KEYS)] = value(depth + 1);
    return o;
  }
  function path() {
    const r = rnd();
    if (r < 0.1) return 'rooms/' + pick(['zika-test01', 'zika-new']) + pick(['', '/study_state', '/study_state/synced_at', '/sync_log', '/sync_log/-Nz', '/else']);
    if (r < 0.3) return 'joins' + pick(['', '/' + pick(CODES), '/' + pick(CODES) + '/' + pick(['uid', 'name', 'at', 'ans', 'ans/owner', 'ans/name', 'zz'])]);
    if (r < 0.34) return pick(['users', 'rooms', 'other', 'other/x']);
    let p = 'users/' + pick(UIDS);
    if (rnd() < 0.12) return p;
    p += '/' + pick(BRANCHES);
    const depth = Math.floor(rnd() * 4);
    for (let i = 0; i < depth; i++) p += '/' + pick(rnd() < 0.3 ? UIDS : KEYS);
    return p;
  }
  const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  const DATAS = [BASE, ANSWERED];
  return function next() {
    for (;;) {
      const r = rnd(), c = { data: pick(DATAS) }, s = { auth: pick(AUTHS) };
      if (r < 0.15) { s.op = 'read'; s.path = path(); }
      else if (r < 0.6) { s.op = 'set'; s.path = path(); s.value = value(0); }
      else {
        s.op = 'update'; s.map = {};
        const n = 2 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) { const p = path(); if (!Object.keys(s.map).some(q => overlaps(p, q))) s.map[p] = value(0); }
        if (Object.keys(s.map).length < 2) continue;
      }
      c.steps = [s];
      return c;
    }
  };
}


/* the authors' cases and the single-step attacks, each changed a little: a leaf given a priority, a number
   turned into a server increment, another scalar, another user, a path dropped */
function nudger(seed) {
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const pool = CASES.map(c => ({ data: c.data, steps: [{ auth: c.auth, op: c.op, path: c.path, value: c.value, map: c.map }] })).concat(ATTACKS.filter(c => c.steps.length === 1));
  const AUTHS = ['uOwner', 'uDev', 'uOther', 'uNew', 'uFresh'].map(uid => ({ uid })).concat([null]);
  const SCALARS = [null, 1, 0, 2, 'x', '', 'uOwner', 'uNew', 'aaaa2222', S(41), S(61), TS, true, H(T0, 4), H(NOW, 1), MAXSTAMP, 'dddd5555\n'];
  return function next() {
    for (;;) {
      const c = clone(pick(pool)), s = c.steps[0];
      if (!c.data) delete c.data;
      const leaves = [];
      (function walk(o, k) {
        const v = o[k];
        if (v === null || typeof v !== 'object' || v['.sv']) { leaves.push([o, k]); return; }
        for (const kk of Object.keys(v)) walk(v, kk);
      })(s, s.op === 'update' ? 'map' : 'value');
      const times = 1 + Math.floor(rnd() * 2);
      for (let t = 0; t < times; t++) {
        const r = rnd(), leaf = leaves.length ? pick(leaves) : null;
        if (r < 0.2) s.auth = pick(AUTHS);
        else if (r < 0.45 && leaf && leaf[0][leaf[1]] !== null && typeof leaf[0][leaf[1]] !== 'object') leaf[0][leaf[1]] = { '.value': leaf[0][leaf[1]], '.priority': pick(['p', 7]) };
        else if (r < 0.55 && leaf && typeof leaf[0][leaf[1]] === 'number') leaf[0][leaf[1]] = { '.sv': { increment: pick([0, 1, -1]) } };
        else if (r < 0.85 && leaf && leaf[1] !== 'value' && leaf[1] !== 'map') leaf[0][leaf[1]] = pick(SCALARS);
        else if (s.op === 'update' && Object.keys(s.map).length > 1) delete s.map[pick(Object.keys(s.map))];
        else if (rnd() < 0.5) c.data = pick([undefined, ANSWERED, NO_DEV]);
      }
      if (s.op === 'set' && s.value === undefined) s.value = null;
      if (s.op === 'update' && (!s.map || !Object.keys(s.map).length)) continue;
      return c;
    }
  };
}

/* ------------------------------------------------------------------ a removed device and its open listener */
async function listenAfterRevoke(env, form) {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(ctx => fdb.set(fdb.ref(ctx.database()), move(BASE)));
  const dev = env.authenticatedContext('uDev').database(), own = env.authenticatedContext('uOwner').database();
  const got = []; let cancelled = null;
  const target = form === 'query' ? fdb.query(fdb.ref(dev, 'users/uOwner/rec'), fdb.orderByChild('m'), fdb.startAt(0)) : fdb.ref(dev, 'users/uOwner/rec');
  const add = s => got.push(s.key), err = e => { cancelled = String(e && e.message).slice(0, 80); };
  const offs = form === 'query' ? [fdb.onChildAdded(target, add, err), fdb.onChildChanged(target, add, err)] : [fdb.onValue(target, s => { got.push(...Object.keys(s.val() || {})); }, err)];
  await new Promise(r => setTimeout(r, 400));
  const before = got.length;
  await fdb.remove(fdb.ref(own, 'users/uOwner/devices/uDev'));                                   /* the owner removes the device */
  await new Promise(r => setTimeout(r, 300));
  await fdb.set(fdb.ref(own, 'users/uOwner/rec/c~secret'), { h: H(NOW, 9), m: TS, j: '"written after the removal"' });
  await new Promise(r => setTimeout(r, 700));
  const leaked = got.slice(before).includes('c~secret');
  let fresh = null;
  try { await fdb.get(fdb.ref(dev, 'users/uOwner/rec/c~secret')); fresh = true; } catch (e) { fresh = false; }
  offs.forEach(o => { try { o(); } catch (e) {} });
  return { before, leaked, cancelled, freshReadAllowed: fresh };
}


/* ------------------------------------------------------------------ the rules with the proposed changes
   Not a replacement for editing firebase/build-rules.mjs: it shows that each change is accepted by the
   emulator, closes its attack and leaves the authors' cases alone. The stamp bound (F1-F3) is not here:
   it needs the stamp's time written in decimal, which is the engine's format to change (see FIX_STAMP). */
export function fixedRules() {
  const r = clone(RULES), u = r.rules.users.$uid, j = r.rules.joins.$code;
  /* meta/v: an approved device may only write the first format, 1, and only where there is none or 1 already;
     raising it, and lowering it again after a mistake, is the owner's */
  u.meta.v['.validate'] = "newData.isNumber() && (auth.uid === $uid ? newData.val() >= 1 : newData.val() === 1 && (!data.exists() || data.val() === 1))";
  /* a request cannot be filed with an answer in it */
  j['.write'] = j['.write'].replace('(!data.exists() && ', "(!data.exists() && !newData.child('ans').exists() && ");
  /* once answered, a request is read only by the two devices it concerns */
  j['.read'] = "auth != null && (!data.child('ans').exists() || data.child('uid').val() === auth.uid || data.child('ans').child('owner').val() === auth.uid)";
  /* an approval carries the server's time when it is made, and keeps it */
  u.devices.$dev.at['.validate'] = 'newData.isNumber() && (data.exists() ? newData.val() === data.val() : newData.val() === now)';
  /* no priorities: every rule that accepts a value also refuses a priority on it */
  (function walk(node, inRooms) {
    for (const k of Object.keys(node)) {
      if (k === '.validate' && typeof node[k] === 'string' && !inRooms) node[k] = '(' + node[k] + ') && newData.getPriority() === null';
      else if (node[k] && typeof node[k] === 'object' && !Array.isArray(node[k])) walk(node[k], inRooms || k === 'rooms');
    }
  })(r.rules, false);
  return r;
}
/* the stamp bound, on its own: thirteen decimal digits of time, and not more than a day ahead of the server */
const FIX_STAMP = { rules: { probe: { '.write': true, x: { '.validate': "newData.isString() && newData.val().length < 64 && newData.val().matches(/^[0-9]{13}[0-9a-z]{3}[0-9A-Za-z_-]+$/) && newData.val() < '' + (now + 86400000)" } } } };

/* ------------------------------------------------------------------ run */
const show = v => (v === true ? 'ALLOW' : v === false ? 'deny ' : String(v));
const N_FUZZ = Number(process.argv[2]) || 1500;
let env = null;
if (EMU) env = await rut.initializeTestEnvironment({ projectId: 'demo-zika', database: { rules: RULES_TEXT } });

console.log('\n=== 1. attacks (' + ATTACKS.length + ') — rules-eval' + (EMU ? ' | emulator' : '') + ' | should ===');
let holesEval = 0, holesEmu = 0, split = 0;
for (const c of ATTACKS) {
  const a = evalCase(c), b = EMU ? await emuCase(env, c) : null;
  const hole = (EMU ? b : a) !== c.should, differ = EMU && a !== b;
  if (a !== c.should) holesEval++; if (EMU && b !== c.should) holesEmu++; if (differ) split++;
  console.log((hole ? 'HOLE ' : 'ok   ') + (differ ? 'SPLIT ' : '      ') + c.id.padEnd(4) + show(a).padEnd(7) + (EMU ? '| ' + show(b).padEnd(7) : '') + '| ' + show(c.should) + '  ' + (c.sev ? '[' + c.sev + '] ' : '') + c.name);
}
console.log('rules-eval: ' + holesEval + ' verdicts differ from "should"' + (EMU ? ' · emulator: ' + holesEmu + ' · the two disagree on ' + split : ''));

console.log('\n=== 2. probes of the rules language — rules-eval' + (EMU ? ' | emulator' : '') + ' ===');
let pdiff = 0;
const allProbes = PROBES.map(([name, rules, value]) => ({ name, rules, data: { d: D }, path: 'probe/x', value })).concat(PROBES2);
for (const p of allProbes) {
  const op = p.map ? { op: 'update', map: p.map } : { op: 'set', path: p.path, value: p.value };
  const a = probeEval(p.rules, p.data, op), b = EMU ? await probeEmu(p.rules, p.data, op) : null;
  const differ = EMU && a !== b; if (differ) pdiff++;
  console.log((differ ? 'SPLIT ' : '      ') + show(a).padEnd(7) + (EMU ? '| ' + show(b) : '') + '  ' + p.name);
}
if (EMU) console.log(pdiff + ' of ' + allProbes.length + ' probes: evaluator and emulator disagree');

if (EMU) {
  console.log('\n=== 3. random operations against the real rules: rules-eval against the emulator ===');
  for (const [label, next, n] of [['blind', fuzzer(20261115), N_FUZZ], ['nudged cases', nudger(7), N_FUZZ]]) {
    let diff = 0, allowed = 0, errors = 0; const kinds = {};
    for (let i = 0; i < n; i++) {
      const c = next(), a = evalCase(c), b = await emuCase(env, c);
      if (typeof b === 'string') { errors++; continue; }
      if (b === true) allowed++;
      if (a !== b) {
        diff++;
        const text = JSON.stringify(c.steps[0]);
        const kind = /\.priority/.test(text) ? 'priority' : /increment/.test(text) ? 'increment' : /\\n/.test(text) ? 'line break' : 'OTHER';
        kinds[kind] = (kinds[kind] || 0) + 1;
        if (kind === 'OTHER' || kinds[kind] <= 2) console.log('  SPLIT [' + kind + '] rules-eval ' + show(a) + ' · emulator ' + show(b) + '\n     ' + JSON.stringify({ data: !c.data || c.data === BASE ? 'BASE' : c.data === ANSWERED ? 'ANSWERED' : 'other', ...c.steps[0] }).slice(0, 420));
      }
    }
    console.log(label + ': ' + diff + ' disagreement(s) ' + JSON.stringify(kinds) + ' · ' + allowed + ' of ' + n + ' allowed by the emulator · ' + errors + ' not comparable (the SDK or server refused the value for another reason)');
  }

  console.log('\n=== 4. a removed device and the listener it already had (emulator) ===');
  for (const form of ['value', 'query']) {
    const r = await listenAfterRevoke(env, form);
    console.log('  ' + (form === 'query' ? 'onChildAdded(orderByChild(m))' : 'onValue(rec)').padEnd(30) + ' received before removal: ' + r.before + ' · record written AFTER removal delivered: ' + r.leaked + ' · listener cancelled: ' + (r.cancelled || 'no') + ' · a fresh read allowed: ' + r.freshReadAllowed);
  }
  console.log('\n=== 5. the rules with the proposed changes (emulator) ===');
  let fenv;
  try { fenv = await rut.initializeTestEnvironment({ projectId: 'demo-zika-fixed', database: { rules: JSON.stringify(fixedRules()) } }); }
  catch (e) { console.log('  the changed rules were REFUSED at upload: ' + String(e && e.message).slice(0, 300)); }
  if (fenv) {
    let changed = 0;
    for (const c of CASES) {
      const b = await emuCase(fenv, { data: c.data, steps: [{ auth: c.auth, op: c.op, path: c.path, value: c.value, map: c.map }] });
      if (b !== c.allow) { changed++; console.log('  AUTHORS\' CASE CHANGES  ' + c.name + ': was ' + show(c.allow) + ', now ' + show(b)); }
    }
    console.log('  the authors\' ' + CASES.length + ' cases: ' + changed + ' change their answer');
    for (const c of ATTACKS) {
      const before = await emuCase(env, c), after = await emuCase(fenv, c);
      if (before !== after) console.log('  ' + c.id.padEnd(4) + show(before) + ' -> ' + show(after) + (after === c.should || typeof after === 'string' ? '  closed  ' : '  STILL WRONG  ') + c.name);
      else if (after !== c.should) console.log('  ' + c.id.padEnd(4) + 'still ' + show(after) + '  (not a rules change: see the report)  ' + c.name);
    }
    /* a priority set on its own, the other way to attach one */
    const odb = fenv.authenticatedContext('uOwner').database();
    await fenv.clearDatabase(); await fenv.withSecurityRulesDisabled(ctx => fdb.set(fdb.ref(ctx.database()), move(BASE)));
    let pr; try { await fdb.setPriority(fdb.ref(odb, 'users/uOwner/profile/name'), S(1000)); pr = true; } catch (e) { pr = denied(e) ? false : String(e.message); }
    let pr0; const odb0 = env.authenticatedContext('uOwner').database();
    await env.clearDatabase(); await env.withSecurityRulesDisabled(ctx => fdb.set(fdb.ref(ctx.database()), move(BASE)));
    try { await fdb.setPriority(fdb.ref(odb0, 'users/uOwner/profile/name'), S(1000)); pr0 = true; } catch (e) { pr0 = denied(e) ? false : String(e.message); }
    console.log('  setPriority() on an existing profile name: today ' + show(pr0) + ' -> with the change ' + show(pr));
    await fenv.cleanup();
  }
  const dec = (ms, c) => String(ms).padStart(13, '0') + (c || '000') + 'k3j9x2ab';
  for (const [name, v] of [['a decimal stamp at the server\'s time', dec(Date.now())], ['a decimal stamp two days ahead', dec(Date.now() + 2 * 86400000)], ['the largest decimal stamp', '9999999999999zzzzzzz'], ['today\'s base-36 stamp', H(Date.now())]])
    console.log('  stamp bound: ' + show(await probeEmu(FIX_STAMP, null, { op: 'set', path: 'probe/x', value: v })) + '  ' + name);
  await env.cleanup();
}
process.exit(0);

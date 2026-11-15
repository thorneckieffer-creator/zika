/* The permission cases for firebase/database.rules.json, as data, so that the same table can be
   run through tools/test/rules-eval.mjs (always), through targaryen (tools/test/rules-cross.mjs)
   and through the official emulator (tools/test/rules-emulator.mjs).

   A case: { name, auth, op, path, value | map, allow, data? }
     op     'read' | 'set' | 'update' (a multi-path update from the root; map is {path: value})
     data   the database before the operation; BASE when left out
     allow  what the rules must answer */
import { REC_J_MAX, REC_KEY_MAX } from '../../firebase/build-rules.mjs';

export const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
export const TS = { '.sv': 'timestamp' };

const owner = { uid: 'uOwner' }, device = { uid: 'uDev' }, other = { uid: 'uOther' }, fresh = { uid: 'uFresh' }, asking = { uid: 'uNew' };
const nobody = null;

/* a stamp as the sync engine writes one (syStamp): 9 base-36 digits of time, 3 of counter, the device */
export const H = (wall, ctr, node) => Math.floor(wall).toString(36).padStart(9, '0') + (ctr || 0).toString(36).padStart(3, '0') + (node || 'k3j9x2ab');
const T0 = NOW - 86400000;                         /* "yesterday": when the records in the fixture were written */
const rec = (h, j) => ({ h, m: TS, j: j === undefined ? '"r,22.45,7.39,1796002276250,1794101476250,7,1,4"' : j });
const tomb = h => ({ h, m: TS, d: 1 });
const stored = (h, j) => ({ h, m: T0, j: j === undefined ? '"r,22.45,7.39,1796002276250,1794101476250,7,1,4"' : j });

export const BASE = {
  rooms: {
    'zika-test01': {
      study_state: { v: 18, json: '{"cards":{}}', device: 'Mac', device_id: 'abc12345', synced_at: 5000, bytes: 12, summary: { cards: 0, due: 0 } },
      sync_log: { '-Na': { device: 'Mac', device_id: 'abc12345', at: 5000, bytes: 12, due: 0 } },
    },
  },
  users: {
    uOwner: {
      profile: { name: 'Lin', since: 1 },
      meta: { v: 1 },
      devices: { uDev: { name: 'iPad', at: 5 } },
      rec: {
        'c~w1:rec': stored(H(T0, 4)),
        'c~g:n22-1': stored(H(T0, 0), '""'),
        's~curLesson': stored(H(T0, 1), '22'),
        'd~2026-11-14~k3j9x2ab': stored(H(T0, 2), '{"r":25,"n":20}'),
        'h~w3': { h: H(T0, 3), m: T0, d: 1 },
      },
    },
    uOther: { rec: { 'c~w1:rec': stored(H(T0, 0)) } },
    uNew: { joining: 'aaaa2222' },
    uOld: { joining: 'bbbb3333' },
  },
  joins: {
    aaaa2222: { uid: 'uNew', name: 'iPhone', at: NOW - MIN },        /* standing */
    bbbb3333: { uid: 'uOld', name: 'Old phone', at: NOW - 20 * MIN }, /* past both limits */
    cccc4444: { uid: 'uSlow', name: 'Slow', at: NOW - 12 * MIN },    /* too old to answer, too young to clear */
  },
};

const clone = o => JSON.parse(JSON.stringify(o));
const edit = fn => { const d = clone(BASE); fn(d); return d; };
const S = n => 'x'.repeat(n);
const room = 'rooms/zika-test01';
const R = 'users/uOwner/rec/';
const OLD = H(T0, 4), NEWER = H(NOW, 0), OLDER = H(T0 - 5000, 0);     /* against c~w1:rec, which holds H(T0, 4) */

export const CASES = [
  /* ---------------- legacy rooms: exactly what the shipped client does ---------------- */
  { name: 'room: a signed-in device reads the deck', auth: fresh, op: 'read', path: room + '/study_state', allow: true },
  { name: 'room: nobody signed in cannot read', auth: nobody, op: 'read', path: room + '/study_state', allow: false },
  { name: 'room: the list of rooms cannot be read, so codes cannot be found', auth: fresh, op: 'read', path: 'rooms', allow: false },
  { name: 'room: a newer save is accepted', auth: fresh, op: 'set', path: room + '/study_state', value: { v: 18, json: '{}', device: 'iPad', device_id: 'zz', synced_at: 5001, bytes: 2 }, allow: true },
  { name: 'room: an older save is refused (fbPush relies on this)', auth: fresh, op: 'set', path: room + '/study_state', value: { v: 18, json: '{}', device: 'iPad', device_id: 'zz', synced_at: 4999, bytes: 2 }, allow: false },
  { name: 'room: a save with the same stamp is refused', auth: fresh, op: 'set', path: room + '/study_state', value: { v: 18, json: '{}', synced_at: 5000 }, allow: false },
  { name: 'room: a save with no stamp is refused once a deck is there', auth: fresh, op: 'set', path: room + '/study_state', value: { v: 18, json: '{}' }, allow: false },
  { name: 'room: the first save into an empty room is accepted', auth: fresh, op: 'set', path: 'rooms/zika-brandnew/study_state', value: { v: 18, json: '{}', synced_at: 1 }, allow: true },
  { name: 'room: a sync-log entry is accepted', auth: fresh, op: 'set', path: room + '/sync_log/-Nb', value: { device: 'iPad', device_id: 'zz', at: 5001, bytes: 2, due: 3 }, allow: true },
  { name: 'room: the sync log can be rewritten (fbPruneLog)', auth: fresh, op: 'set', path: room + '/sync_log', value: { '-Nb': { device: 'iPad', at: 5001 } }, allow: true },
  { name: 'room: the sync log can be read', auth: fresh, op: 'read', path: room + '/sync_log', allow: true },
  { name: 'room: nobody signed in cannot write', auth: nobody, op: 'set', path: room + '/study_state', value: { json: '{}', synced_at: 9999 }, allow: false },
  { name: 'room: (as today) the deck can be deleted by any device that knows the code', auth: fresh, op: 'set', path: room + '/study_state', value: null, allow: true },

  /* ---------------- a person's own tree ---------------- */
  { name: 'own: the owner reads the whole tree', auth: owner, op: 'read', path: 'users/uOwner', allow: true },
  { name: 'own: the owner reads the records (the catch-up query listens here)', auth: owner, op: 'read', path: 'users/uOwner/rec', allow: true },
  { name: 'own: the owner reads one record (after a refused write)', auth: owner, op: 'read', path: R + 'c~w1:rec', allow: true },
  { name: 'own: the owner reads meta', auth: owner, op: 'read', path: 'users/uOwner/meta', allow: true },
  { name: 'own: another signed-in user cannot read it', auth: other, op: 'read', path: 'users/uOwner', allow: false },
  { name: 'own: another signed-in user cannot read the records', auth: other, op: 'read', path: 'users/uOwner/rec', allow: false },
  { name: 'own: another signed-in user cannot read one record', auth: other, op: 'read', path: R + 'c~w1:rec', allow: false },
  { name: 'own: nobody signed in cannot read it', auth: nobody, op: 'read', path: 'users/uOwner', allow: false },
  { name: 'own: the list of users cannot be read, even by an owner', auth: owner, op: 'read', path: 'users', allow: false },
  { name: 'own: the owner writes a new record', auth: owner, op: 'set', path: R + 'c~w2:prod', value: rec(H(NOW)), allow: true },
  { name: 'own: another signed-in user cannot write a record', auth: other, op: 'set', path: R + 'c~w2:prod', value: rec(H(NOW)), allow: false },
  { name: 'own: nobody signed in cannot write a record', auth: nobody, op: 'set', path: R + 'c~w2:prod', value: rec(H(NOW)), allow: false },
  { name: 'own: the owner removes a record', auth: owner, op: 'set', path: R + 'c~w1:rec', value: null, allow: true },
  { name: 'own: another user cannot remove a record', auth: other, op: 'set', path: R + 'c~w1:rec', value: null, allow: false },
  { name: 'own: a batch as the sync engine sends it: records, a removal and the format version', auth: owner, op: 'update', map: { [R + 'c~w3:rec']: rec(H(NOW, 1)), [R + 's~newPerDay']: rec(H(NOW, 2), '20'), [R + 'h~w3']: null, [R + 'd~2026-11-15~k3j9x2ab']: rec(H(NOW, 3), '{"r":1}'), 'users/uOwner/meta/v': 1 }, allow: true },
  { name: 'own: the first batch into an empty tree', auth: fresh, op: 'update', map: { 'users/uFresh/rec/c~w1:rec': rec(H(0, 0, '0a1b2c3d')), 'users/uFresh/meta/v': 1 }, allow: true },
  { name: 'own: one bad record refuses the whole batch (the engine then halves it)', auth: owner, op: 'update', map: { [R + 'c~w3:rec']: rec(H(NOW, 1)), [R + 's~newPerDay']: { h: H(NOW, 2), j: '20' } }, allow: false },
  { name: 'own: the owner deletes everything in one write (delete my data)', auth: owner, op: 'set', path: 'users/uOwner', value: null, allow: true },
  { name: 'own: another user cannot delete the tree', auth: other, op: 'set', path: 'users/uOwner', value: null, allow: false },
  { name: 'own: the tree cannot be replaced wholesale, only branch by branch', auth: owner, op: 'set', path: 'users/uOwner', value: { rec: { 'c~w1:rec': rec(NEWER) } }, allow: false },
  { name: 'own: profile', auth: owner, op: 'set', path: 'users/uOwner/profile', value: { name: 'Lin Mei', since: 2 }, allow: true },
  { name: 'own: another user cannot write the profile', auth: other, op: 'set', path: 'users/uOwner/profile/name', value: 'Mallory', allow: false },
  { name: 'own: the migration marker', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: { state: 'copying', from: 'room', src_at: 5000, records: 12, started: TS, device: 'Mac' }, allow: true },
  { name: 'own: a migration marker needs a state', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: { from: 'room' }, allow: false },

  /* ---------------- newer only: the stamp h, compared as a string ---------------- */
  { name: 'newer: a later stamp replaces the record', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(NEWER), allow: true },
  { name: 'newer: the same stamp is accepted again (a batch re-sent after a lost acknowledgement)', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(OLD), allow: true },
  { name: 'newer: an earlier stamp is refused', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(OLDER), allow: false },
  { name: 'newer: one counter step earlier is refused', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(T0, 3)), allow: false },
  { name: 'newer: one counter step later is accepted', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(T0, 5)), allow: true },
  { name: 'newer: with time and counter equal, the device part decides — a later one is accepted', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(T0, 4, 'zzzzzzzz')), allow: true },
  { name: 'newer: with time and counter equal, the device part decides — an earlier one is refused', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(T0, 4, 'a0000000')), allow: false },
  { name: 'newer: a stamp from a clock far in the future is accepted (the engine contains it; the rules do not judge clocks)', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec('zzzzzzzzz000k3j9x2ab'), allow: true },
  { name: 'newer: the comparison is character by character, so an upper-case device part sorts before a lower-case one', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(T0, 4, 'K3J9X2AB')), allow: false },
  { name: 'newer: the oldest possible stamp (an import) does not replace a record', auth: owner, op: 'set', path: R + 'c~w1:rec', value: rec(H(0, 0, '0a1b2c3d')), allow: false },
  { name: 'newer: a tombstone with a later stamp replaces the record', auth: owner, op: 'set', path: R + 'c~w1:rec', value: tomb(NEWER), allow: true },
  { name: 'newer: a tombstone with an earlier stamp is refused', auth: owner, op: 'set', path: R + 'c~w1:rec', value: tomb(OLDER), allow: false },
  { name: 'newer: a record with a later stamp replaces a tombstone', auth: owner, op: 'set', path: R + 'h~w3', value: rec(H(NOW), '1'), allow: true },
  { name: 'newer: a record with an earlier stamp does not replace a tombstone', auth: owner, op: 'set', path: R + 'h~w3', value: rec(H(T0, 2), '1'), allow: false },
  { name: 'newer: removing a record is not held to the stamp', auth: owner, op: 'set', path: R + 'c~w1:rec', value: null, data: edit(d => { d.users.uOwner.rec['c~w1:rec'].h = 'zzzzzzzzz000k3j9x2ab'; }), allow: true },
  { name: 'newer: one stale record refuses the whole batch', auth: owner, op: 'update', map: { [R + 'c~w3:rec']: rec(H(NOW, 1)), [R + 'c~w1:rec']: rec(OLDER) }, allow: false },
  { name: 'newer: an approved device is held to it too — later is accepted', auth: device, op: 'set', path: R + 'c~w1:rec', value: rec(NEWER), allow: true },
  { name: 'newer: an approved device is held to it too — earlier is refused', auth: device, op: 'set', path: R + 'c~w1:rec', value: rec(OLDER), allow: false },
  { name: 'newer: an approved device may re-send the same stamp', auth: device, op: 'set', path: R + 'c~w1:rec', value: rec(OLD), allow: true },
  { name: 'newer: the stamp cannot be changed on its own (m would stand still, and other devices would miss it)', auth: owner, op: 'set', path: R + 'c~w1:rec/h', value: NEWER, allow: false },
  { name: 'newer: the value cannot be changed on its own', auth: owner, op: 'set', path: R + 'c~w1:rec/j', value: '"x"', allow: false },
  { name: 'newer: stamp, value and time written as three paths of one update are a whole record', auth: owner, op: 'update', map: { [R + 'c~w1:rec/h']: NEWER, [R + 'c~w1:rec/j']: '"x"', [R + 'c~w1:rec/m']: TS }, allow: true },

  /* ---------------- the three shapes of a record, and its sizes ---------------- */
  { name: 'shape: m must be the server\'s clock, not the device\'s', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: NOW - 5000, j: '1' }, allow: false },
  { name: 'shape: m cannot be in the future either', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: NOW + 5000, j: '1' }, allow: false },
  { name: 'shape: a record needs m', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), j: '1' }, allow: false },
  { name: 'shape: a record needs h', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { m: TS, j: '1' }, allow: false },
  { name: 'shape: a record needs a value or the deleted mark', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: TS }, allow: false },
  { name: 'shape: a record cannot have both a value and the deleted mark', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: TS, j: '1', d: 1 }, allow: false },
  { name: 'shape: the deleted mark is the number 1', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: TS, d: true }, allow: false },
  { name: 'shape: a tombstone', auth: owner, op: 'set', path: R + 'c~w2:rec', value: tomb(H(NOW)), allow: true },
  { name: 'shape: the value is a string (JSON), not a branch', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: TS, j: { st: 'rev', pad: S(5000) } }, allow: false },
  { name: 'shape: the value is a string, not a number', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: H(NOW), m: TS, j: 22 }, allow: false },
  { name: 'shape: a value of ' + REC_J_MAX + ' characters fits', auth: owner, op: 'set', path: R + 'x~exam', value: rec(H(NOW), S(REC_J_MAX)), allow: true },
  { name: 'shape: a value of ' + (REC_J_MAX + 1) + ' characters does not', auth: owner, op: 'set', path: R + 'x~exam', value: rec(H(NOW), S(REC_J_MAX + 1)), allow: false },
  { name: 'shape: a record takes no other field', auth: owner, op: 'set', path: R + 'c~w2:rec', value: Object.assign(rec(H(NOW)), { extra: S(5000) }), allow: false },
  { name: 'shape: a record cannot be a bare value', auth: owner, op: 'set', path: R + 'c~w2:rec', value: S(5000), allow: false },
  { name: 'shape: the records cannot be overwritten with one big string', auth: owner, op: 'set', path: 'users/uOwner/rec', value: S(5000), allow: false },
  { name: 'shape: the stamp is text', auth: owner, op: 'set', path: R + 'c~w2:rec', value: { h: 12345678901234, m: TS, j: '1' }, allow: false },
  { name: 'shape: the stamp has the engine\'s form', auth: owner, op: 'set', path: R + 'c~w2:rec', value: rec('not a stamp at all'), allow: false },
  { name: 'shape: the stamp\'s time and counter are lower-case base 36', auth: owner, op: 'set', path: R + 'c~w2:rec', value: rec('0N1X8K2AB004k3j9x2ab'), allow: false },
  { name: 'shape: a stamp needs a device part', auth: owner, op: 'set', path: R + 'c~w2:rec', value: rec('0n1x8k2ab004'), allow: false },
  { name: 'shape: a stamp of 63 characters fits', auth: owner, op: 'set', path: R + 'c~w2:rec', value: rec('0n1x8k2ab004' + S(51)), allow: true },
  { name: 'shape: a stamp of 64 characters does not', auth: owner, op: 'set', path: R + 'c~w2:rec', value: rec('0n1x8k2ab004' + S(52)), allow: false },
  { name: 'shape: a key of ' + REC_KEY_MAX + ' characters fits', auth: owner, op: 'set', path: R + 'x~' + S(REC_KEY_MAX - 2), value: rec(H(NOW)), allow: true },
  { name: 'shape: a key of ' + (REC_KEY_MAX + 1) + ' characters does not', auth: owner, op: 'set', path: R + 'x~' + S(REC_KEY_MAX - 1), value: rec(H(NOW)), allow: false },
  { name: 'shape: a key with escaped characters, as the engine writes them', auth: owner, op: 'set', path: R + 'us~a%2eb%2fc', value: rec(H(NOW)), allow: true },
  { name: 'shape: an unknown branch is refused (a voice, for one)', auth: owner, op: 'set', path: 'users/uOwner/voice/clip1', value: rec(H(NOW)), allow: false },
  { name: 'shape: an unknown branch is refused inside a batch too', auth: owner, op: 'update', map: { [R + 'c~w9:rec']: rec(H(NOW)), 'users/uOwner/audio': 'x' }, allow: false },
  { name: 'shape: a profile name is at most 60 characters', auth: owner, op: 'set', path: 'users/uOwner/profile/name', value: S(61), allow: false },
  { name: 'shape: a profile takes no unlisted field', auth: owner, op: 'set', path: 'users/uOwner/profile/email', value: 'a@b.c', allow: false },
  { name: 'shape: a profile cannot be a bare value', auth: owner, op: 'set', path: 'users/uOwner/profile', value: S(5000), allow: false },
  { name: 'shape: nothing can be written at the top', auth: owner, op: 'set', path: 'scratch/x', value: 1, allow: false },
  { name: 'shape: nothing can be read at the top', auth: owner, op: 'read', path: '', allow: false },

  /* ---------------- a device the owner approved ---------------- */
  { name: 'device: an approved device reads the tree', auth: device, op: 'read', path: 'users/uOwner', allow: true },
  { name: 'device: an approved device reads the records', auth: device, op: 'read', path: 'users/uOwner/rec', allow: true },
  { name: 'device: an approved device writes a new record', auth: device, op: 'set', path: R + 'c~w2:prod', value: rec(H(NOW)), allow: true },
  { name: 'device: an approved device sends a batch', auth: device, op: 'update', map: { [R + 'c~w3:rec']: rec(H(NOW, 1)), [R + 'h~w3']: null, [R + 'c~w1:rec']: rec(NEWER) }, allow: true },
  { name: 'device: an approved device removes a record', auth: device, op: 'set', path: R + 'd~2026-11-14~k3j9x2ab', value: null, allow: true },
  { name: 'device: a removed device cannot read', auth: device, op: 'read', path: 'users/uOwner/rec', data: edit(d => { delete d.users.uOwner.devices; }), allow: false },
  { name: 'device: a removed device cannot write', auth: device, op: 'set', path: R + 'c~w2:prod', value: rec(H(NOW)), data: edit(d => { delete d.users.uOwner.devices; }), allow: false },
  { name: 'device: a removed device cannot remove a record', auth: device, op: 'set', path: R + 'c~w1:rec', value: null, data: edit(d => { delete d.users.uOwner.devices; }), allow: false },
  { name: 'device: approval for one deck is not approval for another', auth: device, op: 'read', path: 'users/uOther/rec', allow: false },
  { name: 'device: an approved device cannot approve another device', auth: device, op: 'set', path: 'users/uOwner/devices/uOther', value: { name: 'x', at: 1 }, allow: false },
  { name: 'device: an approved device cannot rename itself', auth: device, op: 'set', path: 'users/uOwner/devices/uDev/name', value: 'Mac', allow: false },
  { name: 'device: an approved device cannot write the profile', auth: device, op: 'set', path: 'users/uOwner/profile/name', value: 'x', allow: false },
  { name: 'device: an approved device cannot write the migration marker', auth: device, op: 'set', path: 'users/uOwner/meta/migration', value: { state: 'done' }, allow: false },
  { name: 'device: an approved device cannot delete the tree', auth: device, op: 'set', path: 'users/uOwner', value: null, allow: false },
  { name: 'device: a device removes its own approval (leave)', auth: device, op: 'set', path: 'users/uOwner/devices/uDev', value: null, allow: true },
  { name: 'device: a device cannot remove another device', auth: other, op: 'set', path: 'users/uOwner/devices/uDev', value: null, allow: false },
  { name: 'device: a device stamps when it was last here', auth: device, op: 'set', path: 'users/uOwner/devices/uDev/seen', value: 123, allow: true },
  { name: 'device: nobody else can stamp it', auth: other, op: 'set', path: 'users/uOwner/devices/uDev/seen', value: 123, allow: false },
  { name: 'device: a stranger cannot approve itself', auth: other, op: 'set', path: 'users/uOwner/devices/uOther', value: { name: 'x', at: 1 }, allow: false },
  { name: 'device: a stranger cannot slip in through the stamp', auth: other, op: 'set', path: 'users/uOwner/devices/uOther/seen', value: 1, allow: false },
  { name: 'device: the owner approves a device', auth: owner, op: 'set', path: 'users/uOwner/devices/uThird', value: { name: 'iPhone', at: TS }, allow: true },
  { name: 'device: the owner removes a device', auth: owner, op: 'set', path: 'users/uOwner/devices/uDev', value: null, allow: true },
  { name: 'device: an approval needs a name', auth: owner, op: 'set', path: 'users/uOwner/devices/uThird', value: { at: 1 }, allow: false },
  { name: 'device: an approval takes no other fields', auth: owner, op: 'set', path: 'users/uOwner/devices/uThird', value: { name: 'x', at: 1, admin: true }, allow: false },
  { name: 'device: a device name is at most 40 characters', auth: owner, op: 'set', path: 'users/uOwner/devices/uThird', value: { name: S(41), at: 1 }, allow: false },
  { name: 'device: the time of approval is a number', auth: owner, op: 'set', path: 'users/uOwner/devices/uThird', value: { name: 'iPhone', at: 'now' }, allow: false },
  { name: 'device: the last-here stamp is a number', auth: device, op: 'set', path: 'users/uOwner/devices/uDev/seen', value: 'today', allow: false },
  { name: 'device: a device key is at most 128 characters', auth: owner, op: 'set', path: 'users/uOwner/devices/' + S(129), value: { name: 'iPhone', at: 1 }, allow: false },
  { name: 'device: the list of devices cannot be overwritten with one value', auth: owner, op: 'set', path: 'users/uOwner/devices', value: S(5000), allow: false },

  /* ---------------- meta ---------------- */
  { name: 'meta: the format version is written by the owner', auth: fresh, op: 'set', path: 'users/uFresh/meta/v', value: 1, allow: true },
  { name: 'meta: or by an approved device, if it syncs first', auth: device, op: 'set', path: 'users/uOwner/meta/v', value: 1, data: edit(d => { delete d.users.uOwner.meta; }), allow: true },
  { name: 'meta: not by anyone else', auth: other, op: 'set', path: 'users/uOwner/meta/v', value: 2, allow: false },
  { name: 'meta: the format version can go up', auth: owner, op: 'set', path: 'users/uOwner/meta/v', value: 2, allow: true },
  { name: 'meta: writing the same version again is fine', auth: device, op: 'set', path: 'users/uOwner/meta/v', value: 1, allow: true },
  { name: 'meta: the format version cannot go down', auth: owner, op: 'set', path: 'users/uOwner/meta/v', value: 0, allow: false },
  { name: 'meta: the format version is a number', auth: owner, op: 'set', path: 'users/uOwner/meta/v', value: 'two', allow: false },
  { name: 'meta: the format version is a number, the first time too', auth: fresh, op: 'set', path: 'users/uFresh/meta/v', value: 'one', allow: false },
  { name: 'meta: an approved device cannot remove the format version', auth: device, op: 'set', path: 'users/uOwner/meta/v', value: null, allow: false },
  { name: 'meta: cannot be a bare value', auth: owner, op: 'set', path: 'users/uOwner/meta', value: S(5000), allow: false },
  { name: 'meta: takes no unlisted field', auth: owner, op: 'set', path: 'users/uOwner/meta/notes', value: 'x', allow: false },
  { name: 'meta: a finished migration marker', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: { state: 'done', from: 'room', src_at: 5000, records: 12, started: 1, finished: TS, device: 'Mac' }, allow: true },
  ...[['state', 5], ['state', S(11)], ['from', 5], ['from', S(11)], ['src_at', 'x'], ['records', 'x'], ['started', 'x'], ['finished', 'x'], ['device', 5], ['device', S(41)], ['room', 'zika-test01']].map(([k, v]) => (
    { name: 'meta: a migration marker with ' + k + ' = ' + (typeof v === 'string' && v.length > 20 ? v.length + ' characters' : JSON.stringify(v)) + ' is refused', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: Object.assign({ state: 'done' }, { [k]: v }), allow: false })),
  { name: 'profile: since is a number', auth: owner, op: 'set', path: 'users/uOwner/profile/since', value: 'yesterday', allow: false },

  /* ---------------- joining: a new device asks, the owner answers ---------------- */
  { name: 'join: a device files a request and its pointer together', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: TS } }, allow: true },
  { name: 'join: a request without the pointer is refused', auth: fresh, op: 'set', path: 'joins/dddd5555', value: { uid: 'uFresh', name: 'iPad', at: TS }, allow: false },
  { name: 'join: a request in someone else\'s name is refused', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uOwner', name: 'iPad', at: TS } }, allow: false },
  { name: 'join: the time on a request is the server\'s', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: NOW + 60 * MIN } }, allow: false },
  { name: 'join: a code is eight characters from a-z and 2-9', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'DDDD-555', 'joins/DDDD-555': { uid: 'uFresh', name: 'iPad', at: TS } }, allow: false },
  { name: 'join: a request takes no unlisted field', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: TS, note: S(5000) } }, allow: false },
  { name: 'join: a device name is at most 40 characters', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: S(41), at: TS } }, allow: false },
  { name: 'join: a request needs a device name', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', at: TS } }, allow: false },
  { name: 'join: a request needs its time', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad' } }, allow: false },
  { name: 'join: a code in use cannot be taken over', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'aaaa2222', 'joins/aaaa2222': { uid: 'uFresh', name: 'iPad', at: TS } }, allow: false },
  { name: 'join: one account cannot hold two requests', auth: asking, op: 'update', map: { 'users/uNew/joining': 'eeee6666', 'joins/eeee6666': { uid: 'uNew', name: 'iPhone', at: TS } }, allow: false },
  { name: 'join: a second request is fine once the first is withdrawn in the same write', auth: asking, op: 'update', map: { 'joins/aaaa2222': null, 'users/uNew/joining': 'eeee6666', 'joins/eeee6666': { uid: 'uNew', name: 'iPhone', at: TS } }, allow: true },
  { name: 'join: the pointer cannot be cleared while the request stands', auth: asking, op: 'set', path: 'users/uNew/joining', value: null, allow: false },
  { name: 'join: the pointer and the request are cleared together', auth: asking, op: 'update', map: { 'joins/aaaa2222': null, 'users/uNew/joining': null }, allow: true },
  { name: 'join: a tree cannot be deleted while its request stands', auth: asking, op: 'set', path: 'users/uNew', value: null, allow: false },
  { name: 'join: a tree and its request are deleted together', auth: asking, op: 'update', map: { 'joins/aaaa2222': null, 'users/uNew': null }, allow: true },
  { name: 'join: a pointer on its own is allowed', auth: fresh, op: 'set', path: 'users/uFresh/joining', value: 'dddd5555', allow: true },
  { name: 'join: a pointer is a well-formed code', auth: fresh, op: 'set', path: 'users/uFresh/joining', value: 'not a code', allow: false },
  { name: 'join: a pointer is text', auth: fresh, op: 'set', path: 'users/uFresh/joining', value: 12345678, allow: false },
  { name: 'join: nobody else can set an account\'s pointer', auth: other, op: 'set', path: 'users/uFresh/joining', value: 'dddd5555', allow: false },
  { name: 'join: anyone signed in who knows the code reads the request', auth: owner, op: 'read', path: 'joins/aaaa2222', allow: true },
  { name: 'join: nobody signed in cannot read a request', auth: nobody, op: 'read', path: 'joins/aaaa2222', allow: false },
  { name: 'join: the list of requests cannot be read', auth: owner, op: 'read', path: 'joins', allow: false },
  { name: 'join: the owner approves and answers in one write', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', name: 'Lin' } }, allow: true },
  { name: 'join: an answer may leave the owner\'s name out', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner' } }, allow: true },
  { name: 'join: an answer without the approval is refused', auth: owner, op: 'set', path: 'joins/aaaa2222/ans', value: { owner: 'uOwner', name: 'Lin' }, allow: false },
  { name: 'join: an answer naming someone else is refused', auth: other, op: 'update', map: { 'users/uOther/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner' } }, allow: false },
  { name: 'join: a request older than ten minutes cannot be answered', auth: owner, op: 'update', map: { 'users/uOwner/devices/uSlow': { name: 'Slow', at: TS }, 'joins/cccc4444/ans': { owner: 'uOwner' } }, allow: false },
  { name: 'join: a request is answered once', auth: other, op: 'update', map: { 'users/uOther/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOther' } }, data: edit(d => { d.joins.aaaa2222.ans = { owner: 'uOwner' }; d.users.uOwner.devices.uNew = { name: 'iPhone', at: 1 }; }), allow: false },
  { name: 'join: an answer to a code nobody filed is refused', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/zzzz9999/ans': { owner: 'uOwner' } }, allow: false },
  { name: 'join: the owner\'s name in an answer is at most 60 characters', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', name: S(61) } }, allow: false },
  { name: 'join: the owner\'s name in an answer is text', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', name: { a: S(5000) } } }, allow: false },
  { name: 'join: an answer takes no unlisted field', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', note: S(5000) } }, allow: false },
  { name: 'join: nobody else can change who is asking', auth: other, op: 'set', path: 'joins/aaaa2222/uid', value: 'uOther', allow: false },
  { name: 'join: the asking device cannot change who is asking either', auth: asking, op: 'set', path: 'joins/aaaa2222/uid', value: 'uOther', allow: false },
  { name: 'join: the asking device withdraws its request', auth: asking, op: 'set', path: 'joins/aaaa2222', value: null, allow: true },
  { name: 'join: a stranger cannot remove a standing request', auth: other, op: 'set', path: 'joins/aaaa2222', value: null, allow: false },
  { name: 'join: the account that answered may remove the request', auth: owner, op: 'set', path: 'joins/aaaa2222', value: null, data: edit(d => { d.joins.aaaa2222.ans = { owner: 'uOwner' }; }), allow: true },
  { name: 'join: anyone signed in clears a request older than fifteen minutes', auth: other, op: 'set', path: 'joins/bbbb3333', value: null, allow: true },
  { name: 'join: but not one that is only twelve minutes old', auth: other, op: 'set', path: 'joins/cccc4444', value: null, allow: false },
  { name: 'join: nobody signed in clears nothing', auth: nobody, op: 'set', path: 'joins/bbbb3333', value: null, allow: false },
];

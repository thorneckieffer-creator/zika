/* The permission cases for firebase/database.rules.json, as data, so that the same table can be
   run through tools/test/rules-eval.mjs (always) and through targaryen (tools/test/rules-cross.mjs).

   A case: { name, auth, op, path, value | map, allow, data? }
     op     'read' | 'set' | 'update' (a multi-path update from the root; map is {path: value})
     data   the database before the operation; BASE when left out
     allow  what the rules must answer */

import { COLLECTIONS, STAMP } from '../../firebase/build-rules.mjs';

export const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;
export const TS = { '.sv': 'timestamp' };

const owner = { uid: 'uOwner' }, device = { uid: 'uDev' }, other = { uid: 'uOther' }, fresh = { uid: 'uFresh' }, asking = { uid: 'uNew' };
const nobody = null;

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
      meta: { schema: 1 },
      devices: { uDev: { name: 'iPad', at: 5 } },
      cards: { 'w1:rec': { m: 10, v: '{"st":"rev"}' }, 'g:n22-1': { m: 11, v: '{}' } },
      settings: { curLesson: { m: 10, v: 22 } },
      log: { '2026-11-14': { mac: { m: 9, v: '{"rev":3}' } } },
    },
    uOther: { cards: { 'w1:rec': { m: 1, v: 'x' } } },
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
const card = (extra) => Object.assign({ m: 20, v: '{"st":"learn"}' }, extra || {});
const room = 'rooms/zika-test01';

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
  { name: 'own: the owner reads one card', auth: owner, op: 'read', path: 'users/uOwner/cards/w1:rec', allow: true },
  { name: 'own: another signed-in user cannot read it', auth: other, op: 'read', path: 'users/uOwner', allow: false },
  { name: 'own: another signed-in user cannot read one card', auth: other, op: 'read', path: 'users/uOwner/cards/w1:rec', allow: false },
  { name: 'own: nobody signed in cannot read it', auth: nobody, op: 'read', path: 'users/uOwner', allow: false },
  { name: 'own: the list of users cannot be read, even by an owner', auth: owner, op: 'read', path: 'users', allow: false },
  { name: 'own: the owner writes a card', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:prod', value: card(), allow: true },
  { name: 'own: another signed-in user cannot write a card', auth: other, op: 'set', path: 'users/uOwner/cards/w2:prod', value: card(), allow: false },
  { name: 'own: nobody signed in cannot write a card', auth: nobody, op: 'set', path: 'users/uOwner/cards/w2:prod', value: card(), allow: false },
  { name: 'own: the owner deletes a card', auth: owner, op: 'set', path: 'users/uOwner/cards/w1:rec', value: null, allow: true },
  { name: 'own: another user cannot delete a card', auth: other, op: 'set', path: 'users/uOwner/cards/w1:rec', value: null, allow: false },
  { name: 'own: the owner writes several records in one update', auth: owner, op: 'update', map: { 'users/uOwner/cards/w3:rec': card(), 'users/uOwner/settings/newPerDay': { m: 21, v: 20 }, 'users/uOwner/log/2026-11-15/mac': { m: 21, v: '{"rev":1}' } }, allow: true },
  { name: 'own: one bad record refuses the whole update', auth: owner, op: 'update', map: { 'users/uOwner/cards/w3:rec': card(), 'users/uOwner/settings/newPerDay': { v: 20 } }, allow: false },
  { name: 'own: the owner deletes everything in one write (delete my data)', auth: owner, op: 'set', path: 'users/uOwner', value: null, allow: true },
  { name: 'own: another user cannot delete the tree', auth: other, op: 'set', path: 'users/uOwner', value: null, allow: false },
  { name: 'own: the tree cannot be replaced wholesale, only branch by branch', auth: owner, op: 'set', path: 'users/uOwner', value: { cards: { 'w1:rec': card() } }, allow: false },
  { name: 'own: profile', auth: owner, op: 'set', path: 'users/uOwner/profile', value: { name: 'Lin Mei', since: 2 }, allow: true },
  { name: 'own: another user cannot write the profile', auth: other, op: 'set', path: 'users/uOwner/profile/name', value: 'Mallory', allow: false },
  { name: 'own: the migration marker', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: { state: 'copying', from: 'room', src_at: 5000, records: 12, started: TS, device: 'Mac' }, allow: true },
  { name: 'own: a migration marker needs a state', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: { from: 'room' }, allow: false },

  /* ---------------- a device the owner approved ---------------- */
  { name: 'device: an approved device reads the tree', auth: device, op: 'read', path: 'users/uOwner', allow: true },
  { name: 'device: an approved device writes a card', auth: device, op: 'set', path: 'users/uOwner/cards/w2:prod', value: card(), allow: true },
  { name: 'device: an approved device deletes a record', auth: device, op: 'set', path: 'users/uOwner/log/2026-11-14/mac', value: null, allow: true },
  { name: 'device: a removed device cannot read', auth: device, op: 'read', path: 'users/uOwner', data: edit(d => { delete d.users.uOwner.devices; }), allow: false },
  { name: 'device: a removed device cannot write', auth: device, op: 'set', path: 'users/uOwner/cards/w2:prod', value: card(), data: edit(d => { delete d.users.uOwner.devices; }), allow: false },
  { name: 'device: approval for one deck is not approval for another', auth: device, op: 'read', path: 'users/uOther', allow: false },
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

  /* ---------------- sizes and types ---------------- */
  { name: 'shape: a record needs its stamp', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { v: 'x' }, allow: false },
  { name: 'shape: the stamp is a number', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { m: '20', v: 'x' }, allow: false },
  { name: 'shape: a card payload of 400 characters fits', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { m: 20, v: S(400) }, allow: true },
  { name: 'shape: a card payload of 401 characters does not', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { m: 20, v: S(401) }, allow: false },
  { name: 'shape: a payload may be a number or a boolean', auth: owner, op: 'update', map: { 'users/uOwner/settings/retention': { m: 20, v: 0.9 }, 'users/uOwner/settings/haptics': { m: 20, v: true } }, allow: true },
  { name: 'shape: a payload cannot be a branch', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { m: 20, v: { deep: S(5000) } }, allow: false },
  { name: 'shape: a record takes no unlisted field', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { m: 20, v: 'x', extra: S(5000) }, allow: false },
  { name: 'shape: a record with only a stamp is accepted (a tombstone)', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: { m: 20 }, allow: true },
  { name: 'shape: a record cannot be a bare value', auth: owner, op: 'set', path: 'users/uOwner/cards/w2:rec', value: S(5000), allow: false },
  { name: 'shape: a key over 24 characters is refused', auth: owner, op: 'set', path: 'users/uOwner/cards/' + S(25), value: card(), allow: false },
  { name: 'shape: a key with a space is refused', auth: owner, op: 'set', path: 'users/uOwner/cards/w1 rec', value: card(), allow: false },
  { name: 'shape: a collection cannot be overwritten with one big string', auth: owner, op: 'set', path: 'users/uOwner/cards', value: S(5000), allow: false },
  { name: 'shape: a day of the log cannot be overwritten with one big string', auth: owner, op: 'set', path: 'users/uOwner/log/2026-11-15', value: S(5000), allow: false },
  { name: 'shape: a log entry needs a real day', auth: owner, op: 'set', path: 'users/uOwner/log/tomorrow/mac', value: { m: 1, v: 'x' }, allow: false },
  { name: 'shape: a log entry', auth: owner, op: 'set', path: 'users/uOwner/log/2026-11-15/mac', value: { m: 1, v: '{"rev":4,"new":2}' }, allow: true },
  { name: 'shape: a setting of 2,000 characters fits', auth: owner, op: 'set', path: 'users/uOwner/settings/examPlan', value: { m: 1, v: S(2000) }, allow: true },
  { name: 'shape: a setting of 2,001 characters does not', auth: owner, op: 'set', path: 'users/uOwner/settings/examPlan', value: { m: 1, v: S(2001) }, allow: false },
  { name: 'shape: a list of 60,000 characters fits', auth: owner, op: 'set', path: 'users/uOwner/lists/hard', value: { m: 1, v: S(60000) }, allow: true },
  { name: 'shape: a list of 60,001 characters does not', auth: owner, op: 'set', path: 'users/uOwner/lists/hard', value: { m: 1, v: S(60001) }, allow: false },
  { name: 'shape: a My-words entry', auth: owner, op: 'set', path: 'users/uOwner/my/w/u12', value: { m: 1, v: '{"t":"珍珠奶茶","p":"zhēnzhū nǎichá","m":"bubble tea"}' }, allow: true },
  { name: 'shape: a My-words kind is a short lower-case name', auth: owner, op: 'set', path: 'users/uOwner/my/Words!/u12', value: { m: 1, v: 'x' }, allow: false },
  { name: 'shape: an unknown branch is refused (a voice, for one)', auth: owner, op: 'set', path: 'users/uOwner/voice/clip1', value: { m: 1, v: 'x' }, allow: false },
  { name: 'shape: an unknown branch is refused inside an update too', auth: owner, op: 'update', map: { 'users/uOwner/cards/w9:rec': card(), 'users/uOwner/audio': 'x' }, allow: false },
  { name: 'shape: a profile name is at most 60 characters', auth: owner, op: 'set', path: 'users/uOwner/profile/name', value: S(61), allow: false },
  { name: 'shape: a profile takes no unlisted field', auth: owner, op: 'set', path: 'users/uOwner/profile/email', value: 'a@b.c', allow: false },
  { name: 'shape: a profile cannot be a bare value', auth: owner, op: 'set', path: 'users/uOwner/profile', value: S(5000), allow: false },
  { name: 'shape: nothing can be written at the top', auth: owner, op: 'set', path: 'scratch/x', value: 1, allow: false },
  { name: 'shape: nothing can be read at the top', auth: owner, op: 'read', path: '', allow: false },

  /* ---------------- joining: a new device asks, the owner answers ---------------- */
  { name: 'join: a device files a request and its pointer together', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: TS } }, allow: true },
  { name: 'join: a request without the pointer is refused', auth: fresh, op: 'set', path: 'joins/dddd5555', value: { uid: 'uFresh', name: 'iPad', at: TS }, allow: false },
  { name: 'join: a request in someone else\'s name is refused', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uOwner', name: 'iPad', at: TS } }, allow: false },
  { name: 'join: the time on a request is the server\'s', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: NOW + 60 * MIN } }, allow: false },
  { name: 'join: a code is eight characters from a-z and 2-9', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'DDDD-555', 'joins/DDDD-555': { uid: 'uFresh', name: 'iPad', at: TS } }, allow: false },
  { name: 'join: a request takes no unlisted field', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad', at: TS, note: S(5000) } }, allow: false },
  { name: 'join: a device name is at most 40 characters', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: S(41), at: TS } }, allow: false },
  { name: 'join: a code in use cannot be taken over', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'aaaa2222', 'joins/aaaa2222': { uid: 'uFresh', name: 'iPad', at: TS } }, allow: false },
  { name: 'join: one account cannot hold two requests', auth: asking, op: 'update', map: { 'users/uNew/joining': 'eeee6666', 'joins/eeee6666': { uid: 'uNew', name: 'iPhone', at: TS } }, allow: false },
  { name: 'join: a second request is fine once the first is withdrawn in the same write', auth: asking, op: 'update', map: { 'joins/aaaa2222': null, 'users/uNew/joining': 'eeee6666', 'joins/eeee6666': { uid: 'uNew', name: 'iPhone', at: TS } }, allow: true },
  { name: 'join: the pointer cannot be cleared while the request stands', auth: asking, op: 'set', path: 'users/uNew/joining', value: null, allow: false },
  { name: 'join: the pointer and the request are cleared together', auth: asking, op: 'update', map: { 'joins/aaaa2222': null, 'users/uNew/joining': null }, allow: true },
  { name: 'join: a tree cannot be deleted while its request stands', auth: asking, op: 'set', path: 'users/uNew', value: null, allow: false },
  { name: 'join: a tree and its request are deleted together', auth: asking, op: 'update', map: { 'joins/aaaa2222': null, 'users/uNew': null }, allow: true },
  { name: 'join: anyone signed in who knows the code reads the request', auth: owner, op: 'read', path: 'joins/aaaa2222', allow: true },
  { name: 'join: nobody signed in cannot read a request', auth: nobody, op: 'read', path: 'joins/aaaa2222', allow: false },
  { name: 'join: the list of requests cannot be read', auth: owner, op: 'read', path: 'joins', allow: false },
  { name: 'join: the owner approves and answers in one write', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', name: 'Lin' } }, allow: true },
  { name: 'join: an answer without the approval is refused', auth: owner, op: 'set', path: 'joins/aaaa2222/ans', value: { owner: 'uOwner', name: 'Lin' }, allow: false },
  { name: 'join: an answer naming someone else is refused', auth: other, op: 'update', map: { 'users/uOther/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner' } }, allow: false },
  { name: 'join: a request older than ten minutes cannot be answered', auth: owner, op: 'update', map: { 'users/uOwner/devices/uSlow': { name: 'Slow', at: TS }, 'joins/cccc4444/ans': { owner: 'uOwner' } }, allow: false },
  { name: 'join: a request is answered once', auth: other, op: 'update', map: { 'users/uOther/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOther' } }, data: edit(d => { d.joins.aaaa2222.ans = { owner: 'uOwner' }; d.users.uOwner.devices.uNew = { name: 'iPhone', at: 1 }; }), allow: false },
  { name: 'join: an answer to a code nobody filed is refused', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/zzzz9999/ans': { owner: 'uOwner' } }, allow: false },
  { name: 'join: nobody else can change who is asking', auth: other, op: 'set', path: 'joins/aaaa2222/uid', value: 'uOther', allow: false },
  { name: 'join: the asking device cannot change who is asking either', auth: asking, op: 'set', path: 'joins/aaaa2222/uid', value: 'uOther', allow: false },
  { name: 'join: the asking device withdraws its request', auth: asking, op: 'set', path: 'joins/aaaa2222', value: null, allow: true },
  { name: 'join: a stranger cannot remove a standing request', auth: other, op: 'set', path: 'joins/aaaa2222', value: null, allow: false },
  { name: 'join: the account that answered may remove the request', auth: owner, op: 'set', path: 'joins/aaaa2222', value: null, data: edit(d => { d.joins.aaaa2222.ans = { owner: 'uOwner' }; }), allow: true },
  { name: 'join: anyone signed in clears a request older than fifteen minutes', auth: other, op: 'set', path: 'joins/bbbb3333', value: null, allow: true },
  { name: 'join: but not one that is only twelve minutes old', auth: other, op: 'set', path: 'joins/cccc4444', value: null, allow: false },
  { name: 'join: nobody signed in clears nothing', auth: nobody, op: 'set', path: 'joins/bbbb3333', value: null, allow: false },
  { name: 'join: a request needs a device name', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', at: TS } }, allow: false },
  { name: 'join: a request needs its time', auth: fresh, op: 'update', map: { 'users/uFresh/joining': 'dddd5555', 'joins/dddd5555': { uid: 'uFresh', name: 'iPad' } }, allow: false },
  { name: 'join: an answer may leave the owner\'s name out', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner' } }, allow: true },
  { name: 'join: the owner\'s name in an answer is at most 60 characters', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', name: S(61) } }, allow: false },
  { name: 'join: the owner\'s name in an answer is text', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', name: { a: S(5000) } } }, allow: false },
  { name: 'join: an answer takes no unlisted field', auth: owner, op: 'update', map: { 'users/uOwner/devices/uNew': { name: 'iPhone', at: TS }, 'joins/aaaa2222/ans': { owner: 'uOwner', note: S(5000) } }, allow: false },
  { name: 'join: a pointer on its own is allowed', auth: fresh, op: 'set', path: 'users/uFresh/joining', value: 'dddd5555', allow: true },
  { name: 'join: a pointer is a well-formed code', auth: fresh, op: 'set', path: 'users/uFresh/joining', value: 'not a code', allow: false },
  { name: 'join: a pointer is text', auth: fresh, op: 'set', path: 'users/uFresh/joining', value: 12345678, allow: false },
  { name: 'join: nobody else can set an account\'s pointer', auth: other, op: 'set', path: 'users/uFresh/joining', value: 'dddd5555', allow: false },

  /* ---------------- the small branches the owner alone writes ---------------- */
  { name: 'meta: the schema number', auth: owner, op: 'set', path: 'users/uOwner/meta/schema', value: 2, allow: true },
  { name: 'meta: the schema is a number', auth: owner, op: 'set', path: 'users/uOwner/meta/schema', value: 'two', allow: false },
  { name: 'meta: cannot be a bare value', auth: owner, op: 'set', path: 'users/uOwner/meta', value: S(5000), allow: false },
  { name: 'meta: takes no unlisted field', auth: owner, op: 'set', path: 'users/uOwner/meta/notes', value: 'x', allow: false },
  { name: 'meta: a finished migration marker', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: { state: 'done', from: 'room', src_at: 5000, records: 12, started: 1, finished: TS, device: 'Mac' }, allow: true },
  ...[['state', 5], ['state', S(11)], ['from', 5], ['from', S(11)], ['src_at', 'x'], ['records', 'x'], ['started', 'x'], ['finished', 'x'], ['device', 5], ['device', S(41)], ['room', 'zika-test01']].map(([k, v]) => (
    { name: 'meta: a migration marker with ' + k + ' = ' + (typeof v === 'string' && v.length > 20 ? v.length + ' characters' : JSON.stringify(v)) + ' is refused', auth: owner, op: 'set', path: 'users/uOwner/meta/migration', value: Object.assign({ state: 'done' }, { [k]: v }), allow: false })),
  { name: 'profile: since is a number', auth: owner, op: 'set', path: 'users/uOwner/profile/since', value: 'yesterday', allow: false },
  { name: 'device: the time of approval is a number', auth: owner, op: 'set', path: 'users/uOwner/devices/uThird', value: { name: 'iPhone', at: 'now' }, allow: false },
  { name: 'device: the last-here stamp is a number', auth: device, op: 'set', path: 'users/uOwner/devices/uDev/seen', value: 'today', allow: false },
  { name: 'device: a device key is at most 128 characters', auth: owner, op: 'set', path: 'users/uOwner/devices/' + S(129), value: { name: 'iPhone', at: 1 }, allow: false },
  { name: 'device: the list of devices cannot be overwritten with one value', auth: owner, op: 'set', path: 'users/uOwner/devices', value: S(5000), allow: false },
];

/* ---------------- every collection in firebase/build-rules.mjs gets the same battery ---------------- */
const SAMPLE = { $id: 'w5:rec', $day: '2026-11-16', $device: 'mac', $key: 'newPerDay', $name: 'hard', $kind: 'w' };
for (const c of COLLECTIONS) {
  const label = c.path.join('/');
  const at = (over) => 'users/uOwner/' + c.path.map(p => (p[0] === '$' ? (over && over[p]) || SAMPLE[p] : p)).join('/');
  const rec = (extra) => Object.assign({ [STAMP]: 30 }, extra || {});
  const add = (name, auth, path, value, allow) => CASES.push({ name: label + ': ' + name, auth, op: 'set', path, value, allow });
  for (const p of c.path) if (p[0] === '$' && !SAMPLE[p]) throw new Error('rules-cases.mjs needs a sample key for ' + p + ' in ' + label);
  add('the owner writes a record', owner, at(), rec(), true);
  add('an approved device writes a record', device, at(), rec(), true);
  add('another user cannot', other, at(), rec(), false);
  add('nobody signed in cannot', nobody, at(), rec(), false);
  add('a removed device cannot', { uid: 'uGone' }, at(), rec(), false);
  add('a record needs its stamp', owner, at(), Object.keys(c.fields).length ? { [Object.keys(c.fields)[0]]: 1 } : { x: 1 }, false);
  add('the stamp is a number', owner, at(), rec({ [STAMP]: 'now' }), false);
  add('a record takes no unlisted field', owner, at(), rec({ zz: 1 }), false);
  add('a record cannot be a bare value', owner, at(), S(5000), false);
  for (let i = 1; i < c.path.length; i++) add('the branch ' + c.path.slice(0, i).join('/') + ' cannot be one big value', owner, 'users/uOwner/' + c.path.slice(0, i).map(p => SAMPLE[p] || p).join('/'), S(5000), false);
  for (const w of c.path.filter(p => p[0] === '$')) {
    add('a ' + w + ' with a space and a ! is refused', owner, at({ [w]: 'bad key!' }), rec(), false);
    add('a ' + w + ' of 25 characters is refused', owner, at({ [w]: S(25) }), rec(), false);
  }
  for (const [f, t] of Object.entries(c.fields)) {
    const m = /^(s|any):(\d+)$/.exec(t);
    if (t === 'n') { add(f + ' takes a number', owner, at(), rec({ [f]: 1 }), true); add(f + ' refuses text', owner, at(), rec({ [f]: 'x' }), false); }
    else if (t === 'b') { add(f + ' takes a boolean', owner, at(), rec({ [f]: true }), true); add(f + ' refuses a number', owner, at(), rec({ [f]: 1 }), false); }
    else {
      const n = Number(m[2]);
      add(f + ' takes ' + n + ' characters', owner, at(), rec({ [f]: S(n) }), true);
      add(f + ' refuses ' + (n + 1) + ' characters', owner, at(), rec({ [f]: S(n + 1) }), false);
      add(f + ' refuses a branch', owner, at(), rec({ [f]: { a: S(5000) } }), false);
      add(f + (m[1] === 'any' ? ' takes a number' : ' refuses a number'), owner, at(), rec({ [f]: 7 }), m[1] === 'any');
      add(f + (m[1] === 'any' ? ' takes a boolean' : ' refuses a boolean'), owner, at(), rec({ [f]: false }), m[1] === 'any');
    }
  }
}

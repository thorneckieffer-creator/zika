#!/usr/bin/env node
/* Builds firebase/database.rules.json.

   node firebase/build-rules.mjs            write the file
   node firebase/build-rules.mjs --check    exit 1 if the committed file is not what this script produces

   The rules are generated rather than typed because the same expressions repeat in every
   collection and a regular expression inside a JSON string is easy to get wrong by hand.
   The explanation of every branch is in firebase/README.md. Nothing here talks to Firebase. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------
   1. The sync engine's collections. THIS TABLE IS THE PLACE TO EXTEND.
      One row per kind of record under users/<uid>/.

      path    the path under users/<uid>/, wildcards included
      keys    a regular expression for each wildcard (Firebase's regex subset: see README)
      fields  the children a record may have besides the stamp, each with a type:
                'n'      number
                'b'      boolean
                's:N'    string of at most N characters
                'any:N'  number, boolean, or string of at most N characters
      index   false to leave out the index on the stamp

      A record is refused unless it has the stamp, every other child is listed here and of the
      listed type, and its key matches. Anything not in this table is refused outright.
   ------------------------------------------------------------------ */
export const STAMP = 'm';            /* the "modified" stamp every record carries, in milliseconds */

const ID = '/^[A-Za-z0-9:_-]{1,24}$/';          /* w123:rec, g:n22-1, u7:prod, t12 … */
const DAY = '/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/';   /* 2026-11-15 */
const NAME = '/^[A-Za-z0-9_-]{1,24}$/';         /* setting names, list names, device ids */

export const COLLECTIONS = [
  { path: ['cards', '$id'],           keys: { $id: ID },                fields: { v: 'any:400' } },
  { path: ['log', '$day', '$device'], keys: { $day: DAY, $device: NAME }, fields: { v: 'any:400' } },
  { path: ['settings', '$key'],       keys: { $key: NAME },             fields: { v: 'any:2000' } },
  { path: ['lists', '$name'],         keys: { $name: NAME },            fields: { v: 'any:60000' } },
  { path: ['my', '$kind', '$id'],     keys: { $kind: '/^[a-z]{1,8}$/', $id: ID }, fields: { v: 'any:1200' } },
];

/* ------------------------------------------------------------------
   2. Who may do what
   ------------------------------------------------------------------ */
const SIGNED = 'auth != null';
const OWNER = 'auth != null && auth.uid === $uid';
/* a device the owner has approved: one existence check in the owner's own tree */
const GRANTED = "root.child('users').child($uid).child('devices').child(auth.uid).exists()";
const OWNER_OR_DEVICE = `auth != null && (auth.uid === $uid || ${GRANTED})`;

export const JOIN_TTL = 10 * 60 * 1000;   /* a join request can be answered for ten minutes */
export const JOIN_GC = 15 * 60 * 1000;    /* after fifteen, anyone signed in may clear it away */
const CODE = '/^[a-z2-9]{8}$/';

/* ------------------------------------------------------------------
   3. Helpers
   ------------------------------------------------------------------ */
function type(t) {
  if (t === 'n') return 'newData.isNumber()';
  if (t === 'b') return 'newData.isBoolean()';
  const m = /^(s|any):(\d+)$/.exec(t);
  if (!m) throw new Error('unknown field type ' + t);
  const str = `newData.isString() && newData.val().length <= ${m[2]}`;
  return m[1] === 's' ? str : `newData.isNumber() || newData.isBoolean() || (${str})`;
}
const leaf = t => ({ '.validate': type(t) });
const NOTHING_ELSE = { '.validate': false };

/* a branch must be a branch: without this a single 10 MB string could be written where a
   collection belongs, because a rule that only names children says nothing about a scalar */
const BRANCH = 'newData.hasChildren()';

/* a closed object: the listed children with their types, nothing else */
function shape(required, fields, extra) {
  const node = {};
  node['.validate'] = required.length ? `newData.hasChildren([${required.map(r => `'${r}'`).join(', ')}])` : BRANCH;
  for (const [k, t] of Object.entries(fields)) node[k] = typeof t === 'string' ? leaf(t) : t;
  Object.assign(node, extra || {});
  node.$other = NOTHING_ELSE;
  return node;
}

function collection(c) {
  const wild = c.path.filter(p => p[0] === '$');
  if (!wild.length) throw new Error('a collection needs a wildcard: ' + c.path.join('/'));
  for (const w of wild) if (!c.keys[w]) throw new Error('no key pattern for ' + w + ' in ' + c.path.join('/'));
  if (STAMP in c.fields) throw new Error('the stamp is added automatically: ' + c.path.join('/'));
  const record = shape([STAMP], Object.assign({ [STAMP]: 'n' }, c.fields));
  record['.validate'] = wild.map(w => `${w}.matches(${c.keys[w]})`).join(' && ') + ' && ' + record['.validate'];
  /* nest from the record outwards; the write rule sits on the collection's first segment */
  let node = record;
  for (let i = c.path.length - 1; i >= 1; i--) {
    const outer = { '.validate': BRANCH, [c.path[i]]: node };
    /* the index belongs on the parent of the records */
    if (i === c.path.length - 1 && c.index !== false) outer['.indexOn'] = [STAMP];
    node = outer;
  }
  node['.write'] = OWNER_OR_DEVICE;
  return [c.path[0], node];
}

/* ------------------------------------------------------------------
   4. The rules
   ------------------------------------------------------------------ */
export function buildRules() {
  const user = {
    /* the owner and the devices the owner approved read the whole tree */
    '.read': OWNER_OR_DEVICE,
    /* "delete my data": the owner may remove the whole tree in one write, but not while a join
       request of theirs is still standing (that would let one account leave requests behind) */
    '.write': `${OWNER} && !newData.exists() && (!data.child('joining').exists() || !newData.parent().parent().child('joins').child(data.child('joining').val()).exists())`,

    profile: Object.assign(shape([], { name: 's:60', since: 'n' }), { '.write': OWNER }),

    meta: Object.assign(shape([], {
      schema: 'n',
      migration: shape(['state'], { state: 's:10', from: 's:10', src_at: 'n', records: 'n', started: 'n', finished: 'n', device: 's:40' }),
    }), { '.write': OWNER }),

    /* grants: devices/<the device's own uid>. Only the owner adds or removes one;
       a device may remove its own (leave), and may stamp when it was last here. */
    devices: {
      $dev: Object.assign(shape(['name', 'at'], {
        name: 's:40',
        at: 'n',
        seen: { '.write': 'auth != null && auth.uid === $dev && data.parent().exists()', '.validate': 'newData.isNumber()' },
      }), { '.write': `auth != null && (auth.uid === $uid || (auth.uid === $dev && !newData.exists()))` }),
    },

    /* the code of this user's one standing join request (see joins below); it can only be
       changed or cleared once the request it names is gone */
    joining: {
      '.write': `${OWNER} && (!data.exists() || !newData.parent().parent().parent().child('joins').child(data.val()).exists())`,
      '.validate': `newData.isString() && newData.val().matches(${CODE})`,
    },
  };
  for (const c of COLLECTIONS) {
    const [name, node] = collection(c);
    if (user[name]) throw new Error('collection name already used: ' + name);
    user[name] = node;
  }
  user.$other = NOTHING_ELSE;

  return {
    rules: {
      /* ---- legacy: one shared deck per sync code. Kept exactly as the shipped client expects. ---- */
      rooms: {
        $room: {
          '.read': SIGNED,
          '.write': SIGNED,
          study_state: {
            '.validate': "!data.exists() || newData.child('synced_at').val() > data.child('synced_at').val()",
          },
        },
      },

      /* ---- a device asking to be added to someone's deck ---- */
      joins: {
        $code: Object.assign(shape(['uid', 'name', 'at'], {
          uid: 's:128',
          name: 's:40',
          at: { '.validate': 'newData.val() === now' },
          /* the answer: written once, by an account that has just granted this device */
          ans: Object.assign(shape(['owner'], { owner: 's:128', name: 's:60' }), {
            '.write': `auth != null && !data.exists() && data.parent().child('uid').exists() && data.parent().child('at').val() + ${JOIN_TTL} > now && newData.child('owner').val() === auth.uid && newData.parent().parent().parent().child('users').child(auth.uid).child('devices').child(data.parent().child('uid').val()).exists()`,
          }),
        }), {
          '.read': SIGNED,
          '.write': `auth != null && ((!data.exists() && newData.child('uid').val() === auth.uid && newData.parent().parent().child('users').child(auth.uid).child('joining').val() === $code) || (data.exists() && !newData.exists() && (data.child('uid').val() === auth.uid || data.child('ans').child('owner').val() === auth.uid || data.child('at').val() + ${JOIN_GC} < now)))`,
        }),
      },

      /* ---- one tree per person ---- */
      users: { $uid: user },
    },
  };
}

/* shape() puts hasChildren first; the join code pattern is added in front of it */
function finish(rules) {
  const j = rules.rules.joins.$code;
  j['.validate'] = `$code.matches(${CODE}) && ` + j['.validate'];
  const d = rules.rules.users.$uid.devices.$dev;
  d['.validate'] = '$dev.length <= 128 && ' + d['.validate'];
  return rules;
}

export function rulesText() { return JSON.stringify(finish(buildRules()), null, 2) + '\n'; }

const here = fileURLToPath(new URL('.', import.meta.url));
const out = here + 'database.rules.json';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = rulesText();
  if (process.argv.includes('--check')) {
    let cur = '';
    try { cur = readFileSync(out, 'utf8'); } catch (e) {}
    if (cur !== text) { console.error('firebase/database.rules.json is out of date: run node firebase/build-rules.mjs'); process.exit(1); }
    console.log('firebase/database.rules.json is current (' + text.length + ' bytes)');
  } else {
    writeFileSync(out, text);
    console.log('wrote firebase/database.rules.json (' + text.length + ' bytes)');
  }
}

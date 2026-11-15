#!/usr/bin/env node
/* Builds firebase/database.rules.json.

   node firebase/build-rules.mjs            write the file
   node firebase/build-rules.mjs --check    exit 1 if the committed file is not what this script produces

   The rules are generated rather than typed because the same expressions repeat and a regular
   expression inside a JSON string is easy to get wrong by hand. Every branch is explained in
   firebase/README.md. Nothing here talks to Firebase. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------------
   1. Numbers that other code repeats. Change one here, change it there.
   ------------------------------------------------------------------ */
export const JOIN_TTL = 10 * 60 * 1000;   /* a join request can be answered for ten minutes   (AC_JOIN_TTL in js/account.js) */
export const JOIN_GC = 15 * 60 * 1000;    /* after fifteen, anyone signed in may clear it away */
export const REC_J_MAX = 100000;          /* characters in a record's value. The largest the sync engine makes today is about 15,000 */
export const REC_KEY_MAX = 500;           /* characters in a record's key           (the sync engine does not sync a longer one) */
export const REC_H_MAX = 64;              /* a stamp is shorter than this                         (syStampOk in js/sync-records.js) */
const STAMP = '/^[0-9a-z]{12}[0-9A-Za-z_-]+$/';   /* nine base-36 digits of time, three of counter, the device   (the same pattern as syStampOk) */
const CODE = '/^[a-z2-9]{8}$/';

/* ------------------------------------------------------------------
   2. Who may do what
   ------------------------------------------------------------------ */
const SIGNED = 'auth != null';
const OWNER = 'auth != null && auth.uid === $uid';
/* a device the owner has approved: one existence check in the owner's own tree */
const GRANTED = "root.child('users').child($uid).child('devices').child(auth.uid).exists()";
const OWNER_OR_DEVICE = `auth != null && (auth.uid === $uid || ${GRANTED})`;

/* ------------------------------------------------------------------
   3. Helpers
   ------------------------------------------------------------------ */
function type(t) {
  if (t === 'n') return 'newData.isNumber()';
  if (t === 'b') return 'newData.isBoolean()';
  const m = /^s:(\d+)$/.exec(t);
  if (!m) throw new Error('unknown field type ' + t);
  return `newData.isString() && newData.val().length <= ${m[1]}`;
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

    /* ---- the deck: the sync engine's records (docs/sync.md on the users-sync branch) ----
       rec/<kind>~<id> is {h, m, j} or a tombstone {h, m, d: 1}:
         h  the version's stamp, compared as a string; a write may not carry an older one
            than the record already has (equal is allowed: a batch can be sent twice)
         m  the server's clock at the moment of writing, which the catch-up query is ordered on
         j  the value, as a JSON string
       Removing a record (null) is always allowed to those who may write. */
    rec: {
      '.write': OWNER_OR_DEVICE,
      '.validate': BRANCH,
      '.indexOn': ['m'],
      $key: {
        /* m is checked here and not on the child: a rule on m would not run when only h or j is
           written, and a record whose value changed while its m stood still would be missed by
           every other device's catch-up */
        '.validate': `$key.length <= ${REC_KEY_MAX} && newData.child('m').val() === now && newData.child('h').isString() && newData.child('j').exists() !== newData.child('d').exists() && (!data.exists() || newData.child('h').val() >= data.child('h').val())`,
        h: { '.validate': `newData.isString() && newData.val().length < ${REC_H_MAX} && newData.val().matches(${STAMP})` },
        m: { '.validate': 'newData.isNumber()' },
        j: { '.validate': `newData.isString() && newData.val().length <= ${REC_J_MAX}` },
        d: { '.validate': 'newData.val() === 1' },
        $other: NOTHING_ELSE,
      },
    },

    meta: {
      /* the version of the record format: written by whichever device syncs first, and it only goes up */
      v: { '.write': `${OWNER_OR_DEVICE} && newData.exists()`, '.validate': 'newData.isNumber() && (!data.exists() || newData.val() >= data.val())' },
      /* where the move out of a sync room stands (js/account.js); there is no field for the sync code */
      migration: Object.assign(shape(['state'], { state: 's:10', from: 's:10', src_at: 'n', records: 'n', started: 'n', finished: 'n', device: 's:40' }), { '.write': OWNER }),
      $other: NOTHING_ELSE,
    },

    profile: Object.assign(shape([], { name: 's:60', since: 'n' }), { '.write': OWNER }),

    /* approvals: devices/<the device's own uid>. Only the owner adds or removes one;
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

    $other: NOTHING_ELSE,
  };

  const rules = {
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
          /* the answer: written once, by an account that has just approved this device */
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
  /* shape() puts hasChildren first; a key's own pattern goes in front of it */
  const j = rules.rules.joins.$code;
  j['.validate'] = `$code.matches(${CODE}) && ` + j['.validate'];
  const d = user.devices.$dev;
  d['.validate'] = '$dev.length <= 128 && ' + d['.validate'];
  return rules;
}

export function rulesText() { return JSON.stringify(buildRules(), null, 2) + '\n'; }

const out = fileURLToPath(new URL('./database.rules.json', import.meta.url));
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

#!/usr/bin/env node
/* Do the tests of js/account.js notice when it is broken?

     node tools/test/account-mutate.mjs

   Each entry below breaks one safeguard in a copy of the script (in the system's temporary
   folder; js/account.js is not touched) and runs tools/test/account.test.mjs against the copy.
   A break the tests do not notice is printed as SURVIVED and the exit code is 1.
   This takes about a minute, so it is a tool, not part of `node --test`. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const src = readFileSync(new URL('../../js/account.js', import.meta.url), 'utf8');
const testFile = fileURLToPath(new URL('./account.test.mjs', import.meta.url));

/* [what is broken, the text to find, what replaces it] */
const BREAKS = [
  ['signing in without checking the password first', "try { uid = await AC.ad.probeEmail(c.email, String(password || '')); } catch (e) { return acFail(e); }", "uid = 'unchecked';"],
  ['leaving the guest tree behind when a device signs in', "try { await acRemoveOwnTree(); } catch (e) { return acFail(e); }\n  }\n  return null;", "}\n  return null;"],
  ['moving to another account although other devices use this deck', 'if (others && !force) return', 'if (false) return'],
  ['trusting a saved membership that belongs to another sign-in', 'saved.uid === u.uid && ', ''],
  ['treating "offline" as "removed"', "if (AC.root === root && acErrCode(e) === 'denied') { acDropMembership('revoked'); return false; }\n    return true;", "acDropMembership('revoked'); return false;"],
  ['not noticing a removal', "if (!g) { acDropMembership('revoked'); return false; }", ''],
  ['joining without checking the owner really let this device in', "if (!g) throw { code: 'PERMISSION_DENIED' };", ''],
  ['keeping the guest tree after joining', "try { await AC.ad.update({ ['joins/' + code]: null, ['users/' + me]: null }); } catch (e) {}", ''],
  ['forgetting the membership on reload', "acSave({ root: owner, ownerName: AC.ownerName, uid: me });", ''],
  ['letting a member approve devices', "if (!acIsOwner()) return { ok: false, code: 'not-owner', err: acRole() === 'member'", "if (false) return { ok: false, code: 'not-owner', err: acRole() === 'member'"],
  ['approving its own code', "if (v.uid === AC.user.uid) return", 'if (false) return'],
  ['a second request without withdrawing the first', "if (old && await AC.ad.get('joins/' + old)) map['joins/' + old] = null;\n      map['users/' + me + '/joining'] = code;", "map['users/' + me + '/joining'] = code;"],
  ['an account joining another deck', "if (role === 'account') return { ok: false, code: 'account'", "if (false) return { ok: false, code: 'account'"],
  ['a deck with devices joining another deck', "if (Object.keys(AC.devices || {}).length) return { ok: false, code: 'has-devices'", "if (false) return { ok: false, code: 'has-devices'"],
  ['a request that never runs out on the device', "AC.cfg.now() - AC.join.since >= AC_JOIN_TTL", 'false'],
  ['leaving reported as being removed', "AC.leaving = true;                 /* the refusals", "/* the refusals"],
  ['erasing a copy that has unsent changes', "if (!(await acFlush())) return", 'if (false) return'],
  ['keeping the copy when asked to remove it', "if (!(opts && opts.keepLocal)) await acWipe();", ''],
  ['deleting an account without the password', "if (!opts.password) return acFail('auth/requires-recent-login');\n    try { await AC.ad.reauthEmail(String(opts.password)); } catch (e) { return acFail(e); }", ''],
  ['delete that leaves the online tree', "try { await acRemoveOwnTree(); } catch (e) { return acFail(e); }\n  acSave(null);", 'acSave(null);'],
  ['delete that leaves the copy on the device', "acSave(null);\n  await acWipe();", 'acSave(null);'],
  ['delete that leaves the sign-in', "await AC.ad.deleteUser(); await next;", ''],
  ['a member deleting without erasing its copy', "await acWipe();\n    const r = await acLeave();", 'const r = await acLeave();'],
  ['running a finished migration again', "if (marker && marker.state === 'done') return { ok: true, skipped: true, marker };", ''],
  ['migrating a deck with unsent changes', "if (o.local.dirty) return", 'if (false) return'],
  ['migrating a deck that is behind the room', "if ((o.local.at || 0) !== r.synced_at) return", 'if (false) return'],
  ['migration overwriting newer records', "if (cur && typeof cur.m === 'number' && cur.m >= recs[p].m) { kept++; continue; }", ''],
  ['migration that never marks itself finished', "await ad.update({ [base + '/meta/migration/state']: 'done', [base + '/meta/migration/finished']: ad.serverTimestamp() });", ''],
  ['migration from a member device', "if (!acIsOwner()) return { ok: false, code: 'not-owner', err: 'Move the deck", "if (false) return { ok: false, code: 'not-owner', err: 'Move the deck"],
  ['migration that writes to the room', "const have = (await ad.get(base)) || {};", "const have = (await ad.get(base)) || {}; if (code) await ad.set('rooms/' + code + '/moved', { at: 1 });"],
  ['migration that stores the sync code', "records: paths.length, started: ad.serverTimestamp(), device: acDeviceName() }", "records: paths.length, started: ad.serverTimestamp(), device: code }"],
  ['device-only settings travelling with the deck', "if (ok(k) && !local.includes(k) && v !== undefined) put('settings/' + k, v);", "if (ok(k) && v !== undefined) put('settings/' + k, v);"],
  ['cards losing their own stamp', "put('cards/' + id, c, (c && c.last) || stamp)", "put('cards/' + id, c, stamp)"],
  ['unescaped names in the page', "function acEsc(s) { return String(s == null ? '' : s).replace(", "function acEsc(s) { return String(s == null ? '' : s); ("],
  ['a Google token for another app', "if (p.aud !== AC.cfg.googleClientId) return", 'if (false) return'],
  ['a Google token that did not start here', "if (!want || p.nonce !== want) return", 'if (false) return'],
  ['an expired Google token', "if (!(p.exp * 1000 > AC.cfg.now())) return", 'if (false) return'],
  ['a Google token from somewhere else', "if (!/^(https:\\/\\/)?accounts\\.google\\.com$/.test(String(p.iss))) return", 'if (false) return'],
  ['a look-alike symbol in codes', "const AC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';", "const AC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz2345678o';"],
  ['a reset message that gives an account away', "try { await AC.ad.sendReset(c.email); } catch (e) { if (acErrCode(e) === 'network') return acFail(e); }\n  return { ok: true, msg:", "try { await AC.ad.sendReset(c.email); } catch (e) { if (acErrCode(e) === 'network') return acFail(e); }\n  return { ok: true, sent: c.email.startsWith('lin'), msg:"],
  ['the Google button offered with nothing configured', "(AC.cfg.googleClientId ? `<button class=\"btn big ghost\" style=\"margin-top:8px\"${dis} onclick=\"acDoGoogle()\">Continue with Google</button>` : '') +\n      `<div class=\"small muted\" style=\"margin-top:12px;text-align:center\">Already have one?", "`<button class=\"btn big ghost\" style=\"margin-top:8px\"${dis} onclick=\"acDoGoogle()\">Continue with Google</button>` +\n      `<div class=\"small muted\" style=\"margin-top:12px;text-align:center\">Already have one?"],
  ['a member offered the owner\'s controls', "if (role === 'member') {\n    h += row('This device uses '", "if (false) {\n    h += row('This device uses '"],
];

const dir = mkdtempSync(join(tmpdir(), 'zika-ac-'));
let survived = 0, missing = 0;
try {
  for (const [what, find, put] of BREAKS) {
    if (!src.includes(find)) { missing++; console.log('NOT FOUND  ' + what + '  (the script changed: update this entry)'); continue; }
    const file = join(dir, 'account.js');
    writeFileSync(file, src.replace(find, put));
    const r = spawnSync(process.execPath, ['--test', '--test-timeout=20000', testFile], { env: Object.assign({}, process.env, { ZIKA_ACCOUNT_SRC: file }), encoding: 'utf8' });
    const failed = (/^ℹ fail (\d+)/m.exec(r.stdout) || [0, '?'])[1];
    if (r.status === 0) { survived++; console.log('SURVIVED   ' + what); } else console.log('noticed    ' + what + '  (' + failed + ' test' + (failed === '1' ? '' : 's') + ' failed)');
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('\n' + (BREAKS.length - survived - missing) + ' of ' + BREAKS.length + ' breaks noticed' + (survived ? ', ' + survived + ' survived' : '') + (missing ? ', ' + missing + ' not found' : ''));
process.exit(survived || missing ? 1 : 0);

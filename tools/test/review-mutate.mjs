#!/usr/bin/env node
/* REVIEW — the reviewer's own breaks, run against THEIR suite (tools/test/account.test.mjs), the way
   account-mutate.mjs does. node tools/test/review-mutate.mjs */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const src = readFileSync(new URL('../../js/account.js', import.meta.url), 'utf8');
const testFile = fileURLToPath(new URL('./account.test.mjs', import.meta.url));
const BREAKS = [
  ['a failed switch never tells the engine its online copy is gone (no "reset")', "acWatchDevices(); acEmit('root', { root: 'users/' + AC.root, prev: prev ? 'users/' + prev : null, why: 'reset' }); }", "acWatchDevices(); }"],
  ['join codes from Math.random only', "try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) { const b = new Uint8Array(1); for (;;) { crypto.getRandomValues(b); if (b[0] < 248) return b[0] % 31; } } } catch (e) {}", ""],
  ['join codes with 3 symbols of entropy (5 fixed)', "while (out.length < 8) out += AC_ALPHABET[pick()];", "while (out.length < 3) out += AC_ALPHABET[pick()]; out += 'aaaaa';"],
  ['the join answer handled twice at once (no "finishing" guard)', "j.status = 'finishing';", ""],
  ['delete with a join request left behind in memory', "if (AC.join) await acJoinCancel(true);", ""],
  ['a member allowed to create an account on its anonymous uid', "if (role === 'member') return { ok: false, code: 'member', err: 'This device uses someone else\\'s deck. Create the account on the device that owns it.' };", ""],
  ['a member that signs in elsewhere stays on the old owner\'s device list', "try { await AC.ad.remove('users/' + AC.root + '/devices/' + me); } catch (e) {} acSave(null); return null; }", "acSave(null); return null; }"],
  ['Google sign-in to an existing account leaves the guest tree behind / ignores other devices', "const stop = await acBeforeSwitch(opts && opts.force); if (stop) return stop;\n  try { AC.why = 'signin'; const u = await AC.ad.signInIdToken", "try { AC.why = 'signin'; const u = await AC.ad.signInIdToken"],
  ['leaving while offline drops the membership anyway', "catch (e) { if (acErrCode(e) === 'network') { AC.leaving = false; return acFail(e); } }\n  AC.leaving = false;", "catch (e) { }\n  AC.leaving = false;"],
  ['a refused devices listener is ignored', "e => { if (AC.root === root && acErrCode(e) === 'denied') acDenied(); });", "e => { });"],
  ['sign-out does not wait to become a guest again', "await AC.ad.signOut();\n    await next;", "await AC.ad.signOut();"],
  ['sign-out with a copy kept skips the flush', "if (!(await acFlush())) return { ok: false, code: 'unsynced'", "if (!(opts && opts.keepLocal) && !(await acFlush())) return { ok: false, code: 'unsynced'"],
  ['delete: the sign-in is removed before the tree (a failure leaves the data with no owner)', "try { await acRemoveOwnTree(); } catch (e) { return acFail(e); }\n  acSave(null);\n  await acWipe();", "try { await AC.ad.deleteUser(); } catch (e) {}\n  try { await acRemoveOwnTree(); } catch (e) { }\n  acSave(null);\n  await acWipe();"],
  ['a link with #id_token is acted on without the nonce/audience check', "const r = chk.ok ? await acSignInWithIdToken('google', h.idToken) : chk;", "const r = await acSignInWithIdToken('google', h.idToken);"],
  ['the withdrawn-request notice is lost', "if (!v) { j.status = 'cancelled'; acEmit('change'); return; }", "if (!v) return;"],
  ['the migration reads a room under an un-normalised code', "const code = String(o.code || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);", "const code = String(o.code || '');"],
  ['acDenied on an owner drops nothing — but on a member that is leaving it now does', "if (acRole() === 'member' && !AC.leaving) return acCheckGrant();", "if (acRole() === 'member') return acCheckGrant();"],
  ['a stale AC.why is reported for the next start', "acSetRoot(root, AC.why || 'start'); AC.why = '';", "acSetRoot(root, AC.why || 'start');"],
];
const dir = mkdtempSync(join(tmpdir(), 'zika-rv-'));
const runOne = ([what, find, put], i) => new Promise(res => {
  if (!src.includes(find)) return res('NOT FOUND  ' + what);
  const file = join(dir, 'account-' + i + '.js'); writeFileSync(file, src.replace(find, put));
  let out = ''; const p = spawn(process.execPath, ['--test', '--test-timeout=20000', testFile], { env: Object.assign({}, process.env, { ZIKA_ACCOUNT_SRC: file }) });
  p.stdout.on('data', d => { out += d; }); p.on('close', code => res((code === 0 ? 'SURVIVED   ' : 'noticed    ') + what + (code === 0 ? '' : '  (' + ((/^ℹ fail (\d+)/m.exec(out) || [0, '?'])[1]) + ' failed)')));
});
const results = await Promise.all(BREAKS.map(runOne));
rmSync(dir, { recursive: true, force: true });
console.log(results.join('\n'));
console.log('\n' + results.filter(r => r.startsWith('SURVIVED')).length + ' of ' + BREAKS.length + ' survived');

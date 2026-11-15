/* REVIEW — the move out of a room, step 7 of docs/multi-user.md: "The way back, at any time: the room still holds
   the deck as it was at step 3. Clearing the retired mark on each device resumes the old sync."
   Step 5 of the same list says a device on the old version "keeps writing to the room". Put together:
   the Mac moved (and studied for a week in users/<uid>); the iPhone, not yet updated, kept pushing to the room;
   the retired mark is cleared on the Mac. This runs the app's OWN fbInitial (cut out of index.html, v62) on that
   state and records what it decides. A failing test is the defect. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('R20 clearing the "retired" mark does not replace the moved device\'s deck with what an old device left in the room', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const a = html.indexOf('function fbInitial(r){'), z = html.indexOf('function fbOnRemote(r){');
  assert.ok(a > 0 && z > a);
  const calls = [];
  const ctx = vm.createContext({
    calls, fmtT: () => '', fbLogLocal() {}, syncUI() {},
    localEmpty: () => false,                                        /* the Mac holds the deck, with a week of new reviews */
    DEVICE: { id: 'mac00001', name: 'Mac' },
    SYNC: { dirty: false, at: 5000, remoteAt: 5000, remoteDev: 'Mac' }, /* its room marks, frozen at the move: level and clean, as acMigrateRoom demanded.
                                                                         Since the move, saves go to syOnSave and no longer set SYNC.dirty (docs/sync.md, "Every save") */
    fbAdopt: (r, how) => calls.push('fbAdopt:' + how), fbConflict: (r, why) => calls.push('fbConflict:' + why), fbPush: () => calls.push('fbPush'),
  });
  vm.runInContext(html.slice(a, z), ctx);
  /* what the room holds now: the iPhone's last push, newer than the move */
  vm.runInContext('fbInitial({ json: "{}", device: "iPhone", device_id: "phone001", synced_at: 9000 })', ctx);
  assert.ok(!calls.some(c => c.startsWith('fbAdopt')), 'fbInitial decided ' + JSON.stringify(calls) + ': S is replaced by the room\'s blob with no question (a "quiet" adopt has no Undo), and an engine still attached then sends every regressed record up as a fresh edit');
});

# The independent review of the two user branches

15 November 2026. Three reviewers that did not write the code were each given one piece and told to break it: the sync engine (`origin/users-sync`, `js/sync-records.js` at 2e2e8c0), the accounts module (`origin/users-accounts`, `js/account.js` at 8ab6e65) and the security rules (`firebase/database.rules.json`, same commit). This is what they found and what has to change before either branch is wired into the app. It closes step 1 of the backend's build order in [roadmap.md](roadmap.md).

## The result

**Neither branch can be wired in as it is.** No stranger can read or write another learner's deck: that part of the rules held on the official emulator. But a learner's own progress can be lost or attached to the wrong person in ordinary situations (a failed save, a restored phone, signing in on a slow connection, a second person signing in on a shared tablet), and a device that was ever approved can disable an account for good.

| Piece | Verdict | Reproduced | Their own tests |
|---|---|---|---|
| Sync engine | Safe after fixes, four of them the size of a redesign | 22 failing reproductions | 53 pass; 7 of 24 deliberate breakages of the engine go unnoticed by every test |
| Accounts module | Not safe; every change of identity needs redesigning | 26 failing reproductions | 251 pass; 11 of 18 deliberate breakages go unnoticed |
| Security rules | Safe after fixes | 23 of 68 attacks get through on the emulator | 184 of 184 agree with the emulator |

The reproductions are kept on two branches, with the code under review unchanged: `origin/review/users-sync` (`node --test tools/test/review-*.test.js`) and `origin/review/users-accounts` (`node --test tools/test/review-*.test.mjs`; `tools/test/review-attacks.mjs` holds the rules attacks and `fixedRules()`, the corrected rules as tested). Every test there fails today, on purpose: a fix is done when its reproduction passes.

Neither branch has run against real Firebase, in a browser or on an iPhone. The reviews did not change that; what they say about the real SDK and iOS storage is reasoned, and marked so below.

## Sync engine

Numbering is the reviewer's. "Lines" are in `js/sync-records.js`.

| # | What goes wrong | Why | The fix |
|---|---|---|---|
| F1 | **Reviews lost on every device.** A deck on disk that is older than the engine's shadow (a save that failed silently, a restored deck, an empty default deck) is sent out at start-up as housekeeping and wins everywhere. In the empty case the other device keeps 0 of 64 cards. | The shadow and the deck are stored separately and nothing ties them; `syOnSave` is never told whether the deck was stored (lines 800, 104–113, 404–416, 869–874). The old sync has a guard for the empty deck; the engine has none. | A generation number written into both deck and shadow, a rejoin when the deck's is lower; `syOnSave` told whether the save succeeded; a start-up diff that blanks or deletes more than a few records is never sent. |
| F2 | **Two My words merged into one.** Two devices offline each create `u4`; after sync one word carries the other's schedule and the other word is gone. | A word and its cards are decided independently (289–297, 654–662). The notes knew of the collision, not that it corrupts. | Ids that include the device, before wiring; a word and its cards treated as one unit. |
| F3 | **The earlier review wins.** One save while a device's clock is ahead leaves that device winning every conflict for good; a clock wrong at the first sync does the same. A stamp at the top of the range freezes its record. | The engine's high-water mark only rises and the server's time is learned after the first stamps are made (77–99, 824–841). | Learn server time before applying; clamp the clock to server time plus the drift allowance; refuse stamps far in the future. |
| F4 | **Day counts too low, and two devices that never agree again.** Two devices with the same device id (a restored phone) each count the day; every device shows the smaller number. | One record per device per day, last writer wins (540–547, 106, 596). Whether an iOS restore really copies the id was not checked. | A device that sees a stamp under its id that it never issued takes a new id; equal stamps are broken by the value. |
| F5 | **Offline edits undone silently.** If the shadow is lost while offline (the engine drops it itself when a write fails), every delete, reset and setting change made offline is reverted at the next sync, and nothing is reported. | The pending changes live inside the shadow (645–680, 758–768, 852–858). | Keep the pending set in its own small store and replay it after a rejoin. |
| F6 | **Breaks at the first format change.** A device on an older version drops records of a kind it does not know and never fetches them again; a field moved to its own kind is deleted on older devices. | The cursor moves past what was skipped; the format marker is read only before the first write (589, 889–897). | Hold unknown records back; refetch from the start when the list of kinds changes; read the marker before applying. |
| F7 | **Sync stops.** One key the database refuses blocks the whole queue. Latent: no id the app makes today is long enough. | Length counted in characters, not bytes; no catch around the write (388, 650, 924, 941). | Count bytes; catch, split the batch and set the bad record aside. |
| F8 | Old My-words day counts deleted at the first sync; counts return after an erase. | 669–686. | Do not wipe frozen days; record the erase. |
| F9 | **The app throws** after an erase on one device and a writing-test mark on another. | 315–322. | Deleting a container deletes its contents. |
| F10 | **Storage.** The shadow is written three times per review, about 800 KB of text each time beside the deck's own write; deck, snapshots and shadow together are 3.8 million characters in one localStorage. If Safari counts such text double against its 5 MB (not checked on a device), the shadow will not fit once Book 3 is complete, and then every start is a full first sync. | 872, 933, 855. | Move the shadow to IndexedDB before wiring; write it once per tick. |

The randomised simulation checks that devices end up agreeing, not that nothing was lost, for every kind of record but cards; it never lets the deck and the shadow part, never fails a save, and gives every device a correct clock. It needs those before it can be trusted on the fixes.

## Accounts module

"Lines" are in `js/account.js`. R-numbers are the reviewer's reproductions.

| # | What goes wrong | The fix |
|---|---|---|
| R1–R3 | **A deck exists nowhere.** Signing in removes the device's online copy before the merge into the account is confirmed. Sign out in that gap, or close the app, and the reviews are neither online nor on the device (235–252, 305–320). | A note on the device, written before anything is removed and cleared only when the engine says the merge is done; no wipe while it is set. |
| R4 | A member's "Remove from this device" wipes before sending what is unsent (455–461). | Send first; refuse if it cannot. |
| R5 | **A join code left waiting deletes an account.** A guest shows a code, then creates an account instead; when the old code is approved the account's deck is deleted (378–400). | Cancel the request when an account is created; check again before deleting. |
| R6 | **The wrong person's deck.** On a shared tablet, a second person signing in gets the first person's cards merged into their account (237, 256–269). | When the deck on the device came from someone else, ask: replace or add. |
| R7 | My words lost at sign-in (the same collision as the engine's F2, met by every new learner). | The engine's F2 fix. |
| R8 | **An account made in advance for someone else's email.** Nothing waits for the email to be verified; the attacker approves a device of their own, the real owner later resets the password, and the attacker's device still reads the deck (215–230, 416–430). | No approvals from an unverified account; show the device list at sign-in from a new device; clear devices on password reset. |
| R21 | **A join code seen by someone else.** Whoever answers first gets the joining device's deck; its own copy is deleted. The design's "a code gives no access to anything" is wrong. A `#join=` link also opens the approve sheet with a name the sender chose (564). | The joining device shows who answered and a short check value, and waits for a tap before deleting or merging. |
| R10 | "Delete everything" leaves copies: another signed-in device re-creates the deleted tree, and members upload it again (453–476). | Deletion that the other devices honour. |
| R12 | "Remove device" while offline shows the device as gone when the server still lists it (431–434). Modelled, not seen on the real SDK. | Refuse offline, or show it as pending. |
| R9, R13 | **Any sign-out the app did not ask for makes a new guest** and uploads a copy under a new identity: password changed elsewhere, account deleted, storage cleared (150–156). | Remember the last identity; say "signed out, sign in again" and upload nothing. |
| R11 | The wipe runs before the step it depends on (310, 458, 471). | Wipe last. |
| R14 | Joining cannot be resumed; "already in" is a dead end. | Resume from the stored request. |
| R15 | The sync engine is paused and never restarted on two paths (172, 237, 241). | Restart on every path; test it. |
| R17 | **`acBoot` calls itself forever** (631). | One line. |
| R19, R20 | **The move out of the room cannot work as written**, and "the way back, at any time" replaces the deck without an Undo. | The move needs the engine running; the way back is an export and a restore. |
| R16, R18 | A first start offline never retries; an account made with Google cannot delete itself. | |

The fake Firebase the module is tested against is kinder than the real one in the ways that matter here: it refuses offline writes at once, sessions never end, and there is one clock. The tests of sign-out, deletion and the move pass only because of that.

## Security rules

Run on the official emulator (it needs a Java runtime; the reviewer put a portable one in the git-ignored `tools/test/.cross`). "Line" is in `firebase/build-rules.mjs`.

**Held:** no reading or writing across users; no listing of users, rooms, join codes; no approving yourself or returning after removal; the server timestamp cannot be forged; the legacy `rooms` path behaves exactly as today; a removed device's open listener stops at once.

| # | What gets through | The fix (emulator-tested unless said) |
|---|---|---|
| F-1 | **An approved device raises the format marker and every client halts.** The owner cannot lower it; only deleting the account undoes it (line 97). | A device may only write the first format; raising is the owner's. |
| F-2 | **An approved device writes the largest possible stamp** and the record can never be written again, even after the device is removed (86–87, 21). | Write the stamp's time as 13 decimal digits and bound it by the server's clock. A format change; nothing has shipped. |
| F-3 | **The join code is a bearer secret** (the rules side of R21): the rules cannot tell the real owner from anyone holding the code (146). Guessing a code is not practical; seeing one is. | The protocol fix under R21. |
| F-4 | **Priorities are unvalidated**, so any size cap can be passed with a megabyte in a priority (36–58). | `newData.getPriority() === null` on every validate outside `rooms`. |
| F-5 | **Any anonymous stranger can fill the database**: 5 MB a write, unbounded, under their own tree or a new room (18, 128–136). | Enforce App Check before inviting anyone; lower the record cap to about 20,000; close creation of new rooms after the exam. |
| F-6, F-7 | A join request can be filed with its answer inside; an answered request shows the owner's uid and name to anyone with the code (146–150). | Two one-line rules. |
| F-8 | Delete-then-rewrite gets round "newer only"; a device can delete all records in one write (79); `at` is any number (110). | Move `.write` down to the record; `at === now`. |

The home-made rules evaluator differs from Firebase on priorities and on increments, so every test named "takes no other field" and every length cap passes for the wrong reason. Run the suite on the emulator from now on.

## What this changes in the plan

- The design stands: Firebase Realtime Database, a person is a uid, one record per card, later stamp wins. The reviews found no reason to change stores.
- Three things in the design are wrong and are corrected here: a join code **does** give access (to the joining device's deck) until the joiner confirms who answered; the shadow cannot live in localStorage beside the deck; and a stamp must be a form the rules can bound by the server's clock.
- Before wiring (roadmap step 4), in this order: the engine's F1, F2, F3, F5 and F10; the accounts module's identity changes rebuilt around a "merge pending" note (R1–R6, R9–R15); the rule fixes; then the simulation and the fake made strict enough to have caught these. Each fix is done when its reproduction on the review branches passes.
- Nothing here touches the live app or the live Firebase project. v63 uses the old sync, unchanged.

# The database rules

The security rules for the Firebase Realtime Database, for the day the app has accounts. The design they serve is in [docs/multi-user.md](../docs/multi-user.md).

**Nothing in this folder has been sent to Firebase.** The live project still runs whatever rules were published by hand. Before these are ever published, the live rules must be read in the console and compared with the `rooms` branch here ([Publishing](#publishing-a-person-does-this-not-a-script)).

| File | What |
|---|---|
| `database.rules.json` | The rules. Strict JSON, no comments: this file is what gets published. **Generated — do not edit by hand.** |
| `build-rules.mjs` | Builds that file. `node firebase/build-rules.mjs` writes it; `--check` fails if the committed file is stale. Change the rules here. |
| `firebase.json` | Tells the Firebase tools where the rules are and how to run the emulator. There is deliberately no `.firebaserc`: no command has a default project. |
| `README.md` | The comments the JSON cannot hold. |

## What is in the database

```
rooms/<sync code>/study_state      the whole deck as one blob          legacy: today's app
rooms/<sync code>/sync_log/…       the last pushes                     legacy

users/<uid>/rec/<kind>~<id>        one record of the deck: {h, m, j}, or {h, m, d: 1} when deleted
users/<uid>/meta/v                 the version of the record format
users/<uid>/meta/migration         where the move out of a room stands (never the sync code)
users/<uid>/profile                {name, since}
users/<uid>/devices/<device uid>   {name, at, seen}: a device the owner has approved
users/<uid>/joining                the code of this user's one standing join request

joins/<code>                       {uid, name, at}: a device asking to be let in; ans: {owner, name} once answered
```

`rec` and `meta/v` belong to the sync engine (`js/sync-records.js`); its notes, `docs/sync.md` on branch `users-sync`, define the record. The rest belongs to `js/account.js`.

## The rules, branch by branch

**`rooms`** is word for word what `README.md` at the top of the repository publishes, and what the shipped client relies on: anyone signed in who knows a code reads and writes that room; a `study_state` is refused unless its `synced_at` is greater than the one stored (`fbPush` treats that refusal as "another device is ahead"); the list of rooms cannot be read, so a code cannot be found, only known. A test compares this branch with the README's text. It is not tightened here on purpose: the exam comes first.

**`users/<uid>` — reading.** The owner (`auth.uid === $uid`) and every device listed under `devices` read the whole tree. The check for a device is one lookup, `root.child('users').child($uid).child('devices').child(auth.uid).exists()`. Lookups inside rules are not billed as downloads.

**`users/<uid>` — writing.** There is no general permission to write at this level, because a permission given high up cannot be taken back lower down, and `devices` must stay the owner's. Each branch has its own:

| Branch | Who writes | What is accepted |
|---|---|---|
| the whole tree | the owner, **to delete it only** | "Delete my data" is one write. Refused while a join request of this user still stands. |
| `rec/<key>` | owner and approved devices | exactly `{h, m, j}` or `{h, m, d: 1}`, or a removal. See below. |
| `meta/v` | owner and approved devices | a number that never goes down; cannot be removed on its own |
| `meta/migration` | owner | `state` (required), `from`, `src_at`, `records`, `started`, `finished`, `device`; nothing else, so there is nowhere to put a sync code |
| `profile` | owner | `name` up to 60 characters, `since` a number |
| `devices/<device uid>` | owner; a device may delete its own entry (leave) and write its own `seen` | `name` up to 40 characters, `at` a number, `seen` a number |
| `joining` | owner | a well-formed code; can change or go only once the request it names is gone |
| anything else | nobody | refused. A cloned voice, for one, has no place to be written. |

**A record (`rec/<key>`).** The rule is the one the sync engine asked for, with the limits added:

- `m` must be the server's clock at the moment of the write (`newData.child('m').val() === now`). The catch-up query is ordered on `m`, so a record cannot be written into the past where no device would look. This is checked on the record, not on the field: a rule on the field would not run when only `h` or `j` is written, and a value could then change while its `m` stood still.
- `h`, the version's stamp, is a string in the engine's form (twelve lower-case base-36 characters, then the device), shorter than 64 characters.
- **Newer only:** where a record exists, the new `h` must be greater than **or equal to** the stored one, compared as strings. Equal is allowed because a batch is sent again when its acknowledgement is lost. This holds for the owner and for approved devices alike. Removing a record is not held to it.
- exactly one of `j` (a string of at most 100,000 characters) and `d` (the number 1), and no other field.
- the key is at most 500 characters.
- `.indexOn: ["m"]` sits on `rec`, where the engine's query runs.

A whole batch is one multi-path update; one refused record refuses the batch, and the engine halves the batch until it has found the record.

**`joins/<code>`** is how a new device asks to be let in ([docs/multi-user.md](../docs/multi-user.md#how-a-second-device-joins)):

- A device creates `joins/<code>` with its own uid, a name, and the server's time — only in the same write that points its `users/<uid>/joining` at that code. One user therefore has one standing request, which is what stops one account from leaving millions of them behind.
- Anyone signed in who knows the code can read that one request. The list cannot be read.
- The answer, `ans`, can be written once, within ten minutes, by an account that names itself as owner **and has approved the asking device in the same write**. So an answer always points at a deck that really lets the device in.
- The asking device, or the account that answered, can delete the request; after fifteen minutes anyone signed in can.

## What the rules cap, and what they cannot

Capped: the size and type of every field, the length of every key, the shape of every record, and every branch that is not listed is refused. No single write can put a megabyte-sized string anywhere.

**Not capped, and not cappable in this rules language: how much one account stores in total.** Realtime Database rules cannot count children or add up sizes. The ways around that were considered and rejected:

- *A counter the client must keep in step.* A rule can check a counter rose by one for one new record; it cannot check it rose by four hundred for a batch of four hundred, because each record's rule sees the same before and after and has no way to know how many siblings are new. Making it work means one write per record (four hundred round trips for a first sync) or a slot scheme that doubles every write.
- *Keys from a closed list.* The engine's keys are open by design (`x~<any field>`, one record per list member).
- *A rate limit* (a time field that must move forward by a second between batches) slows a script down and does not bound the total.

And the cap would not stop the attack it is for: anonymous sign-in is free, so a script that is limited per account makes more accounts (Firebase allows 100 new accounts an hour from one address). What actually protects the 1 GB plan:

1. **App Check, enforced on the database** — a script outside the app gets no access at all ([docs/multi-user.md](../docs/multi-user.md#before-launch-a-checklist-for-a-person)).
2. The per-address sign-up limit.
3. The plan itself: on the free plan the worst case is the database refusing writes until someone cleans up, not a bill.
4. Looking: the console's usage graph, once a week while the app is new.

For scale: the engine measures a full deck at 785 KB in 5,830 records, the largest record about 15 KB (`docs/sync.md` on `users-sync`). The 100,000-character limit on `j` is six times the largest real record; it exists to stop one absurd write, not to budget an account.

**What the sync engine has to know about these rules**

1. Nothing it does today is refused: `tools/test/engine-rules.test.mjs` runs the engine itself through these rules (a whole deck, an approved device, a re-sent batch, the import of a room).
2. A value over 100,000 characters in `j` is refused. The engine then sets that one record aside ("parked") and reports an error while the rest syncs — the same test shows it. A part of the deck that could grow past that must be split before it gets there.
3. `meta/v` cannot go down and cannot be removed by a device.
4. An approved device writes with the **owner's** uid in the path: the engine is started with the uid from `acRoot()`, not with the signed-in user's.
5. If the real service turns out not to compare strings with `>=` (see below), the fallback is for the engine to write the time-and-counter part of the stamp as a number as well and for the rule to compare that; equal stamps from two devices would then both pass, and the engine sorts them out when it reads.

## Changing the rules

1. Edit `build-rules.mjs`, then `node firebase/build-rules.mjs`.
2. Add cases to `tools/test/rules-cases.mjs`: at least one that the change allows and one that it refuses.
3. `node --test tools/test/*.test.mjs`. `rules-mutation.test.mjs` then removes every condition in turn and fails if no case notices; a condition that truly cannot change an answer is listed in its `EQUIVALENT` table with the reason.
4. `node tools/test/rules-cross.mjs` if targaryen is installed (below).

Numbers that other code repeats are exported from `build-rules.mjs` (`JOIN_TTL`, `REC_J_MAX`, …); a test checks `js/account.js` uses the same ten minutes.

## The tests, and how far to trust them

This machine has no Java, so the official emulator does not run on it. The rules are tested three ways that do:

```bash
node --test tools/test/*.test.mjs        # everything below except the cross-check; a few seconds
node tools/test/rules-cross.mjs          # the second evaluator; needs the install in the next line
npm install --prefix tools/test/.cross --no-audit --no-fund --ignore-scripts --no-package-lock targaryen@3.1.0
node tools/test/account-mutate.mjs       # breaks js/account.js 45 ways and checks the tests notice; about a minute
```

| | What it is | What it shows |
|---|---|---|
| `rules-eval.mjs` | An evaluator for the rules language, written for this project: no dependencies. Strict where the service is strict (a type error makes a rule false). | — |
| `rules.test.mjs` | 184 cases (`rules-cases.mjs`) through that evaluator: owner, another user, nobody, approved device, removed device, sizes, types, the newer-only rule, joining, the legacy rooms. Plus tests of the evaluator itself. | The rules say what was intended, if the evaluator is right. |
| `rules-mutation.test.mjs` | Every condition in the rules removed in turn (196 changes). | 161 are noticed by a case; 35 cannot change an answer, each with its reason. No condition is untested. |
| `rules-cross.mjs` | The same cases, 20,000 random operations and 10,000 nudged cases through **targaryen**, an independent implementation (not committed; installed into a git-ignored folder). It ends by weakening three rules on one side to prove the comparison can see a difference. | Two implementations written apart agree everywhere tried — including on the string comparison. |
| `account.test.mjs` | `js/account.js` against a fake Firebase that enforces these rules. | The client's flows are flows the rules allow. |
| `engine-rules.test.mjs` | The sync engine from branch `users-sync` against the same fake. Skipped if that branch is not in the clone. | The engine's real writes pass; a removed device's do not. |

**What none of this can show.** Both evaluators are other people's or my reading of the documentation, not Google's code. These points rest on that reading and are the first things to check on the emulator or in the console's Rules Playground:

1. **Strings compare with `>=`, character by character.** The official reference shows the comparison operators only with numbers. targaryen allows them on two strings, and its authors checked their evaluator against the live service when they wrote it (2015–2018); that is evidence, not proof. The stamps are plain ASCII, so any character-by-character order gives the same answer; only an outright refusal to compare strings would matter, and it would show at once: every second write to an existing record would be refused.
2. `newData.parent()` climbs above the path being written and sees the other paths of the same multi-path update (the join request and its pointer; the answer and the approval).
3. `.validate` rules on the ancestors of a written path are evaluated (the record's rule when only `h` is written).
4. `.validate` is not run for a deletion.
5. `{".sv": "timestamp"}` equals `now` inside the rule.
6. `hasChildren()` with no argument means "is a branch".
7. Whether a listener is cancelled when the data its permission depends on changes (a device removed while it is connected). The client does not rely on it: a removed device's writes are refused at once, and it checks its approval at every start and whenever a write is refused.
8. **The index.** A test checks that `.indexOn: ["m"]` is in the file on `rec`. Whether the service uses it cannot be seen from here: a query on a missing index still answers, by sending the whole collection, with a warning in the browser console. The emulator does not enforce indexes either. Look for that warning on the first real run.

### The official emulator, when there is a machine with Java

`tools/test/rules-emulator.mjs` runs the same case table against it. **It has never been run**; expect to fix small things the first time.

```bash
brew install openjdk                    # any current JDK; the emulator is a Java program
npm install --prefix tools/test/.cross --no-audit --no-fund firebase-tools @firebase/rules-unit-testing firebase
cd firebase
../tools/test/.cross/node_modules/.bin/firebase emulators:exec --only database --project demo-zika \
    "node ../tools/test/rules-emulator.mjs"
```

The project name starts with `demo-`, which the Firebase tools never connect to a real project. Block every host except 127.0.0.1 while running anything like this, all the same.

## Publishing (a person does this, not a script)

Not before the exam. In this order:

1. Console → Realtime Database → Rules. Copy what is there now into a file and keep it: it is the way back.
2. Compare its `rooms` branch with the one here. They must be the same. If the live rules hold anything else — another branch, a `.read` at the top, a test-mode expiry — stop and decide what to do with it; do not publish over it.
3. In the console's Rules Playground, with the new text pasted but **not published**, try: a signed-in read of `rooms/<any>/study_state` (allowed), a signed-out one (refused), and a write to `users/<some uid>/rec/c~w1:rec` as that uid with an `h` equal to, then greater than, then less than a stored one (allowed, allowed, refused). That settles point 1 above.
4. Publish from the console, or `firebase deploy --only database --project <the project>` from this folder after `firebase login`.
5. Open the live app on one device: the sync pill must reach "synced" as before. If it does not, paste the saved rules back.

# Sync by record

Step 4 of [multi-user.md](multi-user.md): the deck is synced one record at a time — a card, a day's counters, a setting, a list member — instead of as one blob. The engine is `js/sync-records.js`. **Nothing loads it yet**: `index.html` and `sw.js` are untouched, and the old whole-deck sync (`fb*`, `rooms/<code>/study_state`) still runs the live app. This file is what the next engineer needs to plug it in and to change it.

The name: on the restructure branch `js/sync.js` is the old whole-deck code. This engine replaces what that code does, not the file, so it has a name of its own. None of its 96 global names is used anywhere in the app, on `main` or on `next` (checked by script, not by a test).

| File | What |
|---|---|
| `js/sync-records.js` | The engine. A classic script: every global is `sy…` / `SY_…`, nothing runs at load, and it ends with a guarded `module.exports` so Node can load it. No dependencies. |
| `tools/test/sync.test.js` | One test per merge rule and per failure case (52). Three of them read the app's own code and data, from `index.html` or from `js/` and `data/`, whichever is there. |
| `tools/test/sim.test.js` | The many-device run: random devices, clocks, edits, outages and delivery order, checked at the end. |
| `tools/test/helpers/` | `cloud.js` an in-memory Realtime Database and its adapter; `deck.js` builds a deck in the app's shape; `rig.js` devices for the tests. |
| `tools/sync_numbers.js` | Measures bytes, storage and time on a deck of the real size. |

```bash
node --test tools/test/*.test.js                                      # everything: about 45 s, 300 seeds
SIM_SEEDS=3000 node --test tools/test/sim.test.js                     # more seeds
SIM_FIRST=1234 SIM_SEEDS=1 node --test tools/test/sim.test.js         # one seed again (a failure names its seed)
node tools/sync_numbers.js                                            # the figures under "What it costs"
```

## The idea

The app does not change. `S` keeps its shape and is still saved whole under `shida_b1_fsrs_v2`. The engine sits beside it and keeps a **shadow**: for every record, the stamp of the version this device last agreed on with the cloud, and a hash of its value.

- **Diff** (`syDiff`): compare `S` with the shadow. Whatever differs was changed on this device: it gets a new stamp and joins the **pending** set.
- **Flush** (`syFlush`): send the pending records, a few hundred per multi-path update. A record leaves the pending set when the database acknowledges the version that was sent.
- **Apply** (`syApply`): a record arrives from the cloud. If it beats the shadow's version it is written into `S`; if the device's version beats it, the device sends its own again.
- **Join** (`syJoin`): the first sync of a device, and **import** (`syImport`): an old whole-deck blob. Both merge a state that has no stamps into one that has.

The shadow, the pending set and the clock are stored together under `zika_sy_v1` in localStorage, so unsent changes survive a reload.

## The record model

Everything a person owns is under `users/<uid>/`:

```
users/<uid>/meta/v            1                      the format version (SY_V)
users/<uid>/rec/<kind>~<id>   { h, m, j }            a record
                              { h, m, d: 1 }         a deleted record (tombstone)
```

- `h` — the stamp of this version (see *Clocks*). It decides which version wins.
- `m` — the server's time when the record was written (`{".sv":"timestamp"}`). It is only used to ask for "everything since".
- `j` — the value, as a JSON **string**. A string because the database drops empty objects, turns objects with numeric keys into arrays, and refuses keys with certain characters; values here contain all three (`{}` is a queued card).

All records sit in one flat collection so that one query and one index serve every kind.

**Keys.** A key is `<kind>~<id>`. Realtime Database keys cannot contain `. $ # [ ] /` or control characters; `syEnc` writes those (and `%`) as `%xx`. The ids the app really uses — every word, grammar and card id in the file, the setting names, day keys — need no escaping (a test checks them against `index.html`). An id that would make a key longer than 500 characters is not synced.

| Kind | Part of `S` | Id | Merge |
|---|---|---|---|
| `c` | `cards` | card id (`w123:rec`, `g:n22-1`) | later stamp wins; a blind queued card never replaces anything |
| `mc` | `my.c` | `u7:rec` | as `c` |
| `s` | `settings`, without the device-local ones | setting name | later stamp wins; a flag (`_…`) that is set always beats one that is not |
| `d` | `log`, `intro`, `cintro`, `gintro`, `my.intro`, `my.log` | `<day>~<device>` | one record per device per day, **summed** |
| `h` `p` `mp` | `hard`, `pick`, `my.tp` | member id | per member, later stamp wins, tombstone on removal |
| `o` | the order of those lists | `h`, `p`, `mp` | later stamp wins |
| `hi` | `hist` | day | later stamp wins; only the newest 180 days are kept |
| `sb` | `sib` | `<day>~<word>` | later stamp wins; forgotten after two days |
| `g` `cf` `li` `us` `rd` | `gram`, `cf`, `listen`, `us`, `read` | item | later stamp wins |
| `mr` `tw` | `mtest.res`, `tone.w` | word id | later stamp wins |
| `mw` | `my.w` | `u7` | later stamp wins |
| `mn` | `my.n`, `my.tn` | `n`, `tn` | the larger number wins |
| `x` | every other top-level field, whole: `exam`, `vp`, what is left of `mtest`, `tone` and `my` | field name | later stamp wins |

`conf` is not synced: the app rebuilds it on every save. A field a later version adds to `S` is synced automatically as `x~<field>`, whole — a safe default, not a decision: the test *"every field of S the app uses has a decided sync rule"* fails until someone decides.

**Compact values.** A card travels as one line, `st,S,D,due,last,reps,lapses,days[,flags[,mastAt[,{anything else}]]]` (`""` is a queued card), and a daily snapshot is run-length packed (`0(15o)12…`). Both are exact; a card that does not have the usual shape goes through untouched. Everything else is plain JSON. The hash in the shadow is of the value as `S` holds it, so the compact form can change without anything looking edited.

## Clocks

Devices' clocks disagree, so a stamp is a hybrid logical clock value, not a wall-clock time:

```
<wall-clock ms, 9 digits base 36> <counter, 3 digits> <device id>      e.g. 0n1x8k2ab 004 k3j9x2ab
```

Stamps are compared as plain strings. The rules:

1. **A device's stamps only go up**, even if its clock is set back (`syTick`).
2. **An edit beats the version it was made on top of.** The new stamp is later than now *and* later than the record's current stamp (`syAfter`). This is what makes "the iPad's clock is three hours behind" harmless: an edit made after seeing a version always wins over it.
3. **The wall part follows the server once known.** At every catch-up the engine learns the server's time from the adapter and keeps the offset, so a wrong device clock stops mattering after the first sync.
4. **A clock far in the future is contained.** A stamp more than 5 minutes ahead of this device (`SY_DRIFT`) is applied — order by stamp must be the same everywhere — but does not move this device's clock (`syObserve`). So a device whose clock says next month does not drag everyone's stamps into next month. What it costs: on the records that device wrote, its version wins against edits made *at the same time* elsewhere until real time catches up. Edits made after seeing its version still win (rule 2), and no other record is affected.
5. **Changes that are not a person acting now get a soft stamp** (`sySoft`): just after the version they replaced, or the oldest possible stamp when there was none. That covers what start-up does (migrations, defaults, pruning: the first diff of a session), a deck that was never synced, and an imported blob. Anything a person did since, on any device, beats them. A card is the exception: it carries the time of its last review, and that time is its stamp.

## What each merge does, and what it loses

**Cards.** Each card is its own record, so a review on one device can never be lost to a review of a *different* card on another. If the **same card** is reviewed on two devices that have not heard of each other's review, the later stamp wins — on every device, whoever syncs first — and the other review's effect on that card's scheduling (stability, difficulty, due date, lapse count) is lost. The review itself is still counted in the day's numbers. This is the single conflict rule; it applies to any two edits of one record made without knowledge of each other (a delete against a review: the later one).

A card that is merely **queued** (`{}`) on a device that has never heard of that card — adding a lesson does this to every card in it — is stamped as old as a stamp can be. It fills a gap and never replaces anything, so adding a lesson on one device cannot wipe the reviews another device already did on those cards. A deliberate reset (undo of a first review, Triage → Learning) is made on top of a known version and wins normally. What it loses: if a lesson was removed on one device and is added on another that has not heard of the removal yet, the removal wins; add it again.

**The day's counters** (the streak, Today, the weekly numbers: `log`, and the intake counters). `S` holds one number per day. The cloud holds one record per day *per device*, each device writes only its own, and the number in `S` is their sum. The shadow keeps every device's share (`E.ct`), so `S` minus the known sum is what this device did since, and goes into its own record. Two devices studying offline on the same day add up; an undo subtracts; *Erase all progress* writes this device's share negative so that the sum is zero everywhere.
- Counts from before the deck was synced by record go into a shared base record (device `0`) that is merged by taking the larger number, so two devices that bring the same old deck do not count it twice. **Loss:** on the first sync, a day's total becomes the *larger* of the device's and the cloud's, not their sum — if two devices studied the same day separately before either had ever synced by record, the smaller count disappears into the larger.
- **The app must clear its undo stack when the engine changes `S`** (it does, in `rerenderAfterSync`): `doUndo()` puts back a whole copy of `S.log`, which would also take back what arrived from another device in between.
- `my.intro` / `my.log` older than 119 days are left alone (the app prunes them at 120 entries; without this a pruned day would read as "set to zero").
- Per-device day records are never merged together or deleted: about 60 bytes per device per day studied.

**Settings.** One record per setting, later stamp wins; deleting a setting deletes it everywhere. `LOCAL_SETTINGS` and `STRICT_LOCAL` never leave the device (the engine's own copy of the list, `SY_LOCAL`, is checked against `index.html` by a test; pass `env.local` to override). Unlike today, a new device does not inherit them either.

**Migration flags** (`_v38` …) are synced and are set-only: a flag set on any device is set on every device and cannot be unset, the same as `fbAdopt` does today. The reason: a migration's *result* arrives as records, so a device that receives the flag has received the migrated data and must not run the migration on top of it. A device that does run a migration at start-up produces soft-stamped changes (clock rule 5), so a migration never overrules a review. The loss: where an unmigrated edit made elsewhere beats the migrated version of a record, that record stays unmigrated although the flag is set. A migration that changes *device-local* settings must not rely on a synced flag.

**Lists** (`hard`, `pick`, My words topics). A list is a set of member records plus one order record. Adding or removing touches one record; both devices' additions survive; remove-then-add elsewhere is decided by stamp. A member's value carries the stamp it was added with, and the order is: members named in the order record, in its order, then the rest by add stamp. Only a deliberate reorder (*Top* in the up-next list) rewrites the order record. Two reorders at once: the later one wins.

**Daily snapshots and sibling claims** are kept for a time and then forgotten, so they do not leave tombstones: a snapshot that falls out of the newest 180, or a sibling claim more than two days old, is removed from the cloud outright and ignored if it turns up again. Sibling claims are judged by each device's own clock: a device whose clock is days off will not share them correctly. That only affects which of a word's two cards is shown today.

**Drill tallies** (`gram`, `cf`, `listen`, `us`, `read`, `mtest.res`, `tone.w`) are one record per item, later stamp wins. **Loss:** if the same item is drilled on two offline devices, one device's tally for that item replaces the other's; they are not added. These numbers order quizzes and draw progress bars; they do not schedule cards.

**Whole fields** (`exam`, `vp`, the rest of `mtest`, `tone`, `my`) are one record each, because the app expects their fields to be there together. `exam` and `mtest` change on every answer of a test in progress and are a few KB, so they are *lazy*: sent at most once a minute, and when the app is hidden. The per-item records that live inside `mtest` and `tone` wait until the container's own record has arrived; the engine never makes up the rest of a container.

**My words.** Words, cards and topics are records like any other. The id counters `my.n` and `my.tn` only go up (larger wins), and an id seen from another device is never handed out again here. **This is not enough**: see *Not done* — two offline devices still hand out the same id.

## First sync and import

`syStart` listens from the beginning when the device has no shadow for this account. When everything has arrived, `syJoin`:

1. lays the cloud's records down on a copy of `S` emptied of everything that syncs;
2. merges the device's own state in as a **legacy state** (`syLegacy`, `syMergeLegacy`): each card is stamped with the time of its last review, everything else as "older than anything synced";
3. only then replaces `S` and the shadow. If anything throws, neither has changed.

So: an **empty cloud** takes the device's deck; an **empty device** takes the cloud's; where **both hold data**, each record is decided on its own and nobody is asked to pick a side. A card is won by the later review. For everything without a time of its own (settings, list members, tallies), what the account already holds stands, and the device fills in what is missing — a new device's default settings never overrule the account's. Two devices joining an empty account at the same moment with different values are settled by a fixed tie-break (the hash of the value): arbitrary, but the same on both.

A deck that was never synced has no deletions to report: a card one side lacks is filled in from the other.

`syStart(E, {uid, join: 'cloud'})` drops what the device holds instead of merging it. If the device holds the shadow of *another* account, `syStart` returns `false` (status `other-account`) until the app passes `join` — the engine will not quietly merge one person's deck into another's.

**The one-time import.** `syImport(E, blob)` takes the old whole-deck blob — the `json` string of `rooms/<code>/study_state`, that whole record, or a state object — and merges it as a legacy state, exactly like step 2 above. The same blob always yields the same records with the same stamps, so importing twice, or on two devices at once, changes nothing the second time and counts nothing twice. An old blob never overrules newer progress; it only adds what is missing and cards it reviewed later. The engine never writes, renames or deletes anything under `rooms/`; the app reads the blob and hands it over. Called before the first sync has finished, the import waits for it.

## The engine at run time

**Pull before push.** In every session nothing is sent until the catch-up of that session has been merged. Most stale writes die here.

**The cursor.** `m` is indexed, and the engine listens with `orderByChild('m').startAt(cursor)`. The cursor moves only when a catch-up batch has arrived whole (`syReady`): to the newest server time in the batch, or to the moment the session began listening if that is later. Records that arrive afterwards, while listening, are applied but never move it. So nothing can slip past, whatever order events arrive in and whatever was dropped — and the price is that what was written during a session (by anyone, this device included) is fetched once more at this device's next start. On a deck of the real size that is about 220 bytes per review. *An optimisation that was left out on purpose:* moving the cursor on acknowledged writes would remove that second download, but it relies on telling the SDK's local guess at the server time from the real one.

**The cloud is dumb.** The database keeps whatever was written last. Two things make the right version stand:
- the rule under *What the rules must allow* — a record with an older stamp is refused. A refused batch is halved until the record is alone, the cloud's version of it is fetched and merged, and the rest goes through. A record refused three times for no reason the engine can see is *parked* (status `error`) so it cannot block the others.
- read repair, which needs no rule: a device that sees an older version arrive than the one it holds sends its own again. The tests run with and without the rule. Without it there is a window in which the cloud holds the older version and a new device would start from it, so **the rule is wanted**, not optional.

**On the device.** `zika_sy_v1` holds the shadow (about 50 bytes a record: 290 KB for the deck measured below), the pending set, the clock and the cursor, rewritten on every save that changed something. If it cannot be written (storage full), it is *removed*: a stale shadow would mistake old values for new edits. The engine keeps working in memory, and the next start joins again from scratch — correct, but a full download. `S` and the shadow are two writes, always `S` first. A shadow ahead of `S` is the dangerous state (old values would go out as new), so when the app reports that `S` could not be stored the shadow is dropped. What is left is a crash exactly between the two writes after records arrived from elsewhere: cards and settings come out right at the next start, but that moment's day counts from the other device can be counted twice.

One copy of the app per device: two tabs share one device id and one stored shadow and will confuse each other (the app has the same problem with `S` itself).

## The adapter

The engine talks to the cloud through four functions, so the tests can stand in an in-memory one:

```js
adapter = {
  update(path, map),          // multi-path update relative to path; a null value removes. → Promise; a refusal by the
                              // rules rejects with an error whose code or message contains "permission"
  get(path),                  // → Promise of the value, or null
  listen(path, {orderBy: 'm', startAt: n | null}, onChild(key, value), onReady(), onError(err)),
                              // every child of path with m >= startAt, now and as it changes; onReady once, after the
                              // children that already existed have been delivered. → a function that stops it
  serverNow()                 // the server's time in ms, or null if not known yet
};
```

`syFirebase(f)` builds it from the modular SDK: `f = {db, ref, update, get, query, orderByChild, startAt, onChildAdded, onChildChanged, onValue}`. The app's SDK loader (`fbLoad`) imports only some of these today. **`syFirebase` has never run against the real service** — the tests have no network. A test runs it against a stand-in with the same signatures, which checks the wiring and nothing else.

## How the app plugs it in

Not done. The hook points below are named against the restructured layout (`origin/next` at 6c200c4: `js/core.js`, `js/sync.js`, `js/boot.js`); on `main` the same functions are layers inside `index.html`.

| When | Where | What to call |
|---|---|---|
| The page loads | `index.html`: a `<script src="js/sync-records.js">` after `js/sync.js` and before `js/boot.js`; then `node tools/stamp.mjs` | Nothing: the file only defines names. **`tools/check.mjs` on `next` fails for a file under `js/` that the page does not name**, so the tag has to arrive with the file. |
| The SDK is imported | `fbLoad()` in `js/sync.js`: the import list and `window.__fbSDK` | Add `update, query, orderByChild, startAt, onChildAdded, onChildChanged` from `firebase-database.js`. |
| Start-up has finished | The last line of `js/boot.js` | `SY = syCreate({…})` (below). It does no I/O. Declare `let SY = null` beside `SYNC`. |
| **Sign-in** | `fbBoot()` in `js/sync.js`, the `onAuthStateChanged` callback that calls `fbStart()` today | `SY.env.adapter = syFirebase(SYNC.fb); syStart(SY, {uid: u.uid});` — `SYNC.fb` already has the shape `syFirebase` wants. The SDK loads after `boot.js` has run, so this is always after start-up, which matters: the first diff of a session treats what it finds as start-up housekeeping. |
| **Every save** | `saveNow()` in `js/core.js`, in place of its last line `SYNC.dirty=true;syncMetaSave();fbSchedulePush();` | `if (SY) syOnSave(SY);` — it diffs, stores the shadow, and sends 1.5 s later. `saveNow()` already runs once per tick, after `S` is stored. |
| **The engine changed `S`** (what `fbAdopt` was) | the `onChange` passed to `syCreate` | `saveNow(); rerenderAfterSync(); shLook();` — exactly what `fbAdopt` does after it has replaced `S`. **`onChange` must store `S` before it returns**: call `saveNow()`, not `save()` (which waits for the end of the tick). The engine stores its shadow only after `onChange` returns; the other order would, after a crash, send old values out as new. It should return `false` if `S` could not be stored (today `saveNow()` swallows that error): the engine then drops its stored shadow rather than keep one that is ahead of `S`. `rerenderAfterSync()` clears `undoStack`, which the counters depend on. |
| **A whole-deck blob is in hand** (the one-time import) | `fbInitial(r)` and `fbPullNow()` in `js/sync.js`, where they call `fbAdopt(r, …)` or `fbConflict(r, …)` | `syImport(SY, r)` — `r` is the `rooms/<code>/study_state` record as read. Then stop listening to the room (`SYNC.unsub()`); `fbAdopt`, `fbRevert`, `fbConflict` and `fbPush` are no longer called. |
| The app is hidden | the `pagehide` / `beforeunload` / `visibilitychange` handlers in `js/boot.js` that call `fbPush()` | `if (SY) syFlush(SY, true);` |
| The device is back online | the `online` handler in `js/boot.js` | `if (SY) syFlush(SY);` |
| Sign-out | the accounts code | `syStop(SY);` Signing in as someone else on the same device: decide what happens to the deck on it, then `syStart(SY, {uid, join: 'cloud'})` (take the account's) or `join: 'merge'`. Without `join` it returns `false`. |
| The sync pill | the `onStatus` passed to `syCreate` | `syncUI(st.state)` for `connecting`, `syncing`, `ok`, `error`, `off`; `other-account` and `newer` (the cloud was written by a newer version of the app: update) need words of their own. |

```js
SY = syCreate({
  state: () => S,                               // S is reassigned by import and restore: always through a getter
  store,                                        // the app's safe localStorage
  node: DEVICE.id,
  local: LOCAL_SETTINGS.concat(STRICT_LOCAL),
  onChange(res) { saveNow(); rerenderAfterSync(); try { shLook(); } catch (e) {} },
  onStatus(st) { syncUI(st.state === 'other-account' || st.state === 'newer' ? 'error' : st.state); }
});
```

Things to know while wiring:

- **The old sync goes off when this goes on.** `fbAdopt` replaces `S` with the room's blob, which the engine would read as "this device just edited every record". The room is read once, for the import.
- `syOnSave` costs about 7 ms on a laptop for the full deck (measured below). If that shows on a phone, call it from `requestIdleCallback` — and then also from the `pagehide` handler, before `syFlush`.
- **Restoring a backup or a snapshot** (`importState`, `snapRestore`) needs nothing special, but know what it means: it is an edit made now, so the restored state wins on every device.
- Add `node --test tools/test/*.test.js` to the release check.
- `res` in `onChange` says what happened: `n` records written into `S`, `kinds` touched, and `lost` — keys where a change made on this device and not yet sent was overruled by a different value from elsewhere. That is the same-record conflict made visible; the app can ignore it or say so.

## What the rules must allow

For the rules being written on `users-accounts`. The engine reads and writes only these paths, as the signed-in user:

| Path | Access |
|---|---|
| `users/<uid>/rec` | listen with `orderByChild('m').startAt(n)`: child added, child changed, one value event |
| `users/<uid>/rec/<key>` | read (after a refused write); written and removed through multi-path updates at `users/<uid>` |
| `users/<uid>/meta` | read once per session; `meta/v` written once |
| `rooms/<code>/study_state` | read by the app for the one-time import; never written by the engine |

```json
"users": { "$uid": {
  ".read":  "auth != null && auth.uid === $uid",
  ".write": "auth != null && auth.uid === $uid",
  "rec": {
    ".indexOn": ["m"],
    "$key": { ".validate": "newData.child('h').isString() && newData.child('h').val().length < 64 && newData.child('m').val() === now && (newData.child('j').isString() || newData.child('d').val() === 1) && (!data.exists() || newData.child('h').val() >= data.child('h').val())" }
  },
  "meta": { "v": { ".validate": "newData.isNumber()" } }
} }
```

- **`.indexOn: ["m"]` is required.** Without it the query still works, but the server sends the whole collection and the SDK filters it: every start would download the deck.
- **`m === now`** makes the cursor trustworthy: a client cannot write a record into the past where no catch-up would find it.
- **`h` newer-or-equal** is the newer-only rule. It must allow *equal* (a batch is sent again after a lost acknowledgement). It compares strings, which the rules language is documented to do; **this has not been tried against the real rules engine** — check it in the rules simulator. The in-memory cloud applies the same rule in half the test runs.
- A size cap on `j` is sensible (the largest real record is a test run in progress, about 15 KB).
- Removals (`null`) are not validated and must be allowed: they are how forgotten snapshots and sibling claims leave.

## What it costs

`node tools/sync_numbers.js`, on a deck built from the content in `index.html` at commit d533d46: 1,478 words and 199 grammar points, so 3,155 course cards, every one studied; 180 days of history; 150 My words. Sizes are JSON bytes as the database stores and sends them.

| | Whole deck (today) | By record |
|---|---|---|
| Written per review | 981 KB | 352 B (2.9 records: the card, the day's counters, sometimes a sibling claim) |
| Downloaded per review, by each other device | 981 KB, if it is open | 311 B, when it is open or next starts |
| Downloaded per review, by the device that made it | nothing | 311 B back with the server's time (assumed whole) + 222 B at its next start |
| A start with nothing new | 981 KB | 7 B |
| First download on a new device | 981 KB | 761 KB |
| Stored per learner | 981 KB | 785 KB in 5,830 records |
| On the device | the deck, 869 KB | the deck + a 290 KB shadow; 6 to 7 ms diff + 0.8 ms store per save (Node, Apple silicon) |

The whole-deck write is larger than the deck (869 KB) because the JSON travels as a string inside JSON, and a mirror of `conf` rides along. With Book 3 complete (an estimate: 12 lessons at the rate of its first four, 1,978 words and 261 grammar points) the whole deck is 1,294 KB and by record stores 1,022 KB; a review is still about 350 bytes.

**The free plan** (1 GB stored, 10 GB downloaded a month, 100 connections at once), for a learner who does 150 reviews a day, opens the app 6 times a day over 2 devices, makes 10% of reviews while the other device is open, and sets up a device every 6 months. Each connection is taken to cost 5 KB of TLS and handshake and each message 60 B of envelope — assumptions, not measurements.

- Whole deck: 180 opens × 981 KB + 450 live reviews × 981 KB + overhead = **605 MB a learner-month → 16 learners** on 10 GB. Downloads are the limit; storage would carry 1,068.
- By record: 4,500 reviews × 1,024 B (311 + 222 + 311 + three envelopes) + ⅙ × 800 KB + 0.86 MB of connections = **5.4 MB a learner-month → 1,900 learners** on 10 GB.
- Storage: 1 GB ÷ 785 KB = **1,336 learners** (1,026 with Book 3 complete). This is the limit in bytes.
- Connections: 100 at once carries 100 ÷ p learners, where p is the share connected at the busiest moment: 2,000 if 5%, 800 if everyone studies half an hour in the same four hours. **This binds first or about level with storage: roughly 800 to 1,300 active learners on the free plan, against 16 today.** Disconnecting while the app is hidden is the lever.

What would stretch storage, in order of yield: shorter card records (the stability and difficulty are stored to 17 digits: about 20 bytes a card), bundling the small tallies per lesson (a `us` record is 70 bytes for 7 bytes of value), and folding old per-device day records into the base.

## What is tested, and what is not

Tested (`node --test tools/test/*.test.js`): every rule above has its own test, including each stated loss; refusals, parking, read repair, a full disk, another account, a newer format, broken records. The simulation runs 300 seeds by default (seeds 1 to 3,300 were run on the committed code, none failed): 2–4 devices plus one that joins late, clocks off by seconds, hours or days either way, random offline periods and reloads, events and acknowledgements delivered one at a time in random order with repeats, undelivered ones dropped when a device goes offline, with and without the newer-only rule. At the end: every device and a fresh device from the cloud hold the same deck; every day's counters equal the reviews made minus the undos, exactly; no card ends in a version some device had already replaced; local settings stayed local; nothing unsent. Broken on purpose in six ways (no per-record stamps, no read repair, cursor moved on live events, counters in one shared record, push before pull, tombstones dropped), the simulation failed each time.

Not tested:
- **The real Firebase SDK and the real rules.** No network, no emulator (no Java on this machine). `syFirebase` and the rule text are unverified.
- **The real app.** The tests drive a short imitation of `rate`, `doUndo`, `trackWord`, `myRate` and friends. Nothing has run in a browser, and `index.html` does not call the engine.
- **Time on a phone**, and **localStorage room** next to the deck and the app's three in-browser snapshots.
- In the simulation: devices that study before their first sync, a lost shadow, import and *Erase all* — those have unit tests only.
- The order of events *before* a catch-up is ready is not shuffled against later ones, because the SDK delivers a listener's first load in one piece.

## Not done

- **Wiring into the app** (above), and the UI: status, the first-sync moment, what to say when `lost` is not empty.
- **My words and topic ids.** `myAdd` takes the next id from a counter in the deck (`u` + `my.n`). Two offline devices will give the same id to two different words; the engine then sees one record edited twice, keeps the later word and reports the other in `lost`. Before two devices can be trusted with My words, new ids must include the device (`u<device>-<n>`; existing ids stay). The same for topics (`t` + `my.tn`). A test shows the collision as it stands.
- **`takeSnapshot()`** only looks at the last entry of `S.hist` to decide whether today is there. Once a snapshot from a device with a fast clock sits at the end, it appends today again at every start. The engine reads the later entry of a repeated day and drops the earlier one when it next writes that day; the app should look the day up.
- **The tone coach's version marker.** `tcState()` resets `S.tone` when its `v` is not the one it knows. Two app versions with different markers would reset each other's data in turn. Today's sync has the same problem.
- **Tombstones are never collected.** They are bounded by the number of ids ever used (cards, list members, settings, My words), not by time, so this is a few tens of KB — but there is no collector.
- **Per-device day records are never folded**, and there is no list of an account's devices.
- **The shadow in IndexedDB** instead of localStorage, if room turns out to be short.
- **Deleting an account's data**, export from the cloud, App Check: with accounts.

## Decisions a reviewer might dispute

1. **One flat collection, values as JSON strings.** No per-field validation in the rules and no querying by field; in return one index, one listener, and no value shape the database can mangle.
2. **Last stamp wins for a card**, rather than merging two reviews of one card. Replaying both through FSRS needs the review history, which the app does not keep.
3. **A blind queued card gets the oldest stamp.** It makes "add a lesson" unable to destroy reviews; the price is that a blind add loses to a removal it has not heard of.
4. **Flags are synced, set-only**, and start-up changes are soft. The alternative — flags per device — lets every device's migration overwrite newer reviews.
5. **Drill tallies are not summed across devices.** Summing would double the record count for numbers that only order quizzes.
6. **On the first sync a day's count is the larger, not the sum.** The sum double-counts the common case (the same old deck on every device); the larger loses the rare one.
7. **The cursor does not move on live events.** Robust to anything the transport does, at the price of fetching a session's records once more.
8. **Storage is not minimised.** Records keep full precision and are a few bytes larger than the same data inside the blob; the win is in traffic.
9. **Soft stamps for whatever the first diff of a session finds.** If the engine was not attached while the learner made changes (signed out), those changes — other than cards and counters — lose to anything done elsewhere since.
10. **The hash-only shadow.** A changed value whose 55-bit hash equals the old one would not be sent until it changes again. Keeping whole values would triple the shadow.

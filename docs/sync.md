# Sync by record: the contract

Step 4a of the backend's build order ([roadmap.md](roadmap.md#app)). The deck is synced one record at a time (a card, a setting, a day's counts, a list member) between one person's devices, through the record store on Supabase ([backend.md](backend.md)). This file is what four pieces of work are built against at the same time, by people who do not talk to each other: the engine (4b), the adapter (5), the app-readying release (6) and the accounts module (7). **Where one of them finds this file wrong or silent, the file is changed first, in a commit of its own, and the others are told**; nobody codes round it.

**Nothing in the app uses any of this yet.** The live app syncs through the room code ([architecture.md](architecture.md#sync)). The engine's code as it stood before this contract is `js/sync-records.js` on `origin/users-sync` (995 lines, Firebase-shaped, written against the single-file app of v62), with its design notes in `docs/sync.md` on that branch and its review in [review-users-branches.md](review-users-branches.md). This file replaces those notes: what is kept from them is restated here against the database's protocol and today's files.

| Where | What |
|---|---|
| [The idea](#the-idea) | One paragraph each on the shadow, the outbox, the cursor. |
| [The adapter](#the-adapter) | The four functions between the engine and the cloud, and their errors. |
| [The cursor](#the-cursor) | When a device's last change number moves, and what a number that went backwards means. |
| [The engine's calls](#the-engines-calls) | What the app and the accounts module call, and what the engine is given. |
| [The save hook and start-up](#the-save-hook-and-start-up) | What `saveNow()` passes on; which changes are start-up's and which are the learner's. |
| [Record format 1](#record-format-1) | Keys, kinds, the stamp, values, times to live, limits. It only ever goes up. |
| [The day's counts](#the-days-counts) | One record per device per day, summed on the device; what Erase writes. |
| [What each merge does, and what it loses](#what-each-merge-does-and-what-it-loses) | The merge rules, with their losses. |
| [Joining](#joining) | The first sync of a device, and the three ways of joining again. |
| [Storage on the device](#storage-on-the-device) | The shadow, the outbox and the meta row in IndexedDB; the generation number. |
| [Who owns what](#who-owns-what) | The files of each of the four pieces, and what each stands in for the others with. |
| [Open points](#open-points) | What is not settled, each with a recommendation. |

The executable half of this contract is `tools/lib/recmodel.js`, a model of the database in plain JavaScript that passes the same protocol checks as the real project (`node tools/dbtest.mjs --model`; [backend.md](backend.md#the-model)). Its `adapter()` is the adapter below; every test of the engine and of the accounts module stands on it.

## The idea

The app does not change shape. `S` is still one object, saved whole under `shida_b1_fsrs_v2`. The engine sits beside it and keeps three things on the device, in IndexedDB:

- the **shadow**: for every record, the stamp of the version this device last agreed on with the cloud or made itself, and a hash of its value. Comparing `S` with the shadow says what changed on this device (**diff**); a record from the cloud is written into `S` when its stamp beats the shadow's (**apply**).
- the **outbox**: every record this device has changed and the cloud has not yet acknowledged, as the complete record that goes on the wire. It can be sent without the deck, and it survives the loss of everything else.
- the **meta row**: the cursor (the last change number this device holds), the clock, and the generation number that ties the shadow to the deck.

The cloud is one table of records per person and one function that changes it. It decides nothing but "is this stamp later than the stored one", numbers what it takes, and tells the person's other devices that there is something new. Everything else is decided on the device.

## The adapter

The engine reaches the cloud only through an object with four functions and one property. `sySupabase(client)` (step 5) builds it over the real project; `recModel().adapter(token)` builds it over the model.

```js
adapter = {
  uid,                               // the signed-in person's id, a string. Never changes for one adapter.
  head(),                            // → Promise of { now, n, v }
  read(after),                       // → Promise of an array: ONE page of rows
  write(v, recs),                    // → Promise of { now, n, r }
  listen(onSignal, onState)          // → a function that stops it
};
```

**`head()`** is `rec_head()`: `now` is the server's clock in milliseconds, `n` the person's last change number, `v` the newest record format that has written to the account. `n` and `v` are 0 for an account that has never written; an account that has only ever sent an empty write has `v` set and `n` 0. An adapter passes on any further field the answer carries (see [open point 2](#open-points)).

**`read(after)`** is one page of `select k,h,j,d,n from rec where n > after order by n limit 1000`: an array of at most 1,000 rows `{ k, h, j, d, n }`, ascending by `n`. A deleted record is `{ k, h, j: null, d: true, n }`. The engine pages, not the adapter:

- A page of fewer than 1,000 rows is the last one. A page of **exactly 1,000 is never the last**: the engine asks again from its last `n`, and the page after may be empty.
- **An empty page proves nothing.** The table does not refuse a caller whose session has ended, or whose email is not confirmed: its policy matches no row and the answer is an empty list with no error (seen on the real project, 21 November 2026). So `read` can resolve with `[]` for a device that has in fact been signed out. This is why [the cursor](#the-cursor) never moves on an empty page, and why a catch-up begins with `head()`, which does refuse.
- Rows come under their newest number only. A record changed twice since `after` is one row; a record changed while the engine is between two pages turns up on a later page under its new number. The numbers on a page are not consecutive: superseded and expired versions leave gaps.
- An expired record (see [times to live](#times-to-live)) is simply absent. Nothing says it has gone.

**`write(v, recs)`** is `rec_write(v, recs)`. `v` is the record format the engine speaks (`SY_V`); it is an argument, not something the adapter keeps, so that an adapter can never disagree with the engine it serves. `recs` is 0 to 1,000 of `{ k, h, j }` or `{ k, h, d: true }`, each with `t` (seconds to live) where [its kind has one](#times-to-live). The answer is `{ now, n, r }`: the server's clock, the person's change number after the call, and one entry in `r` per record sent, in order.

| Entry | Meaning | What the engine does |
|---|---|---|
| `{ n: 124 }` | Taken as the person's 124th change. | Removes the record from the outbox, if the outbox still holds that stamp. |
| `{ n: 97, same: true }` | Exactly this version is already stored. This is what a batch gets when it is **sent again because its answer was lost**: the numbers are the ones the lost answer carried. | The same as taken. It never moves the cursor. |
| `{ old: { h, j, n } }` or `{ old: { h, d: true, n } }` | Not taken: the stored version is later, or has the same stamp and another value. Here it is. | Applies the stored version as if it had been read. Where the stamps are equal and the values differ, see [two devices with one id](#two-devices-with-one-id). |
| `{ no: 'future' }` | The stamp is more than five minutes ahead of the server. | Corrects its clock from `now`, stamps the record again and sends it once more; a second `future` parks it. |
| `{ no: 'full' }` | The account's room is used up. | Stops sending; state `full`. The record stays in the outbox and is tried at the next connect. |
| `{ no: 'shape' \| 'key' \| 'stamp' \| 'size' \| 'ttl' }` | Refused for its form. | **Parks** the record: it stays in the outbox marked with the reason, is listed in `syStatus()`, and is never sent again as it is. A later change to the same record replaces it and is sent. |

One record's refusal does not hold up the others, and is an answer, not an error.

**Errors.** A function that cannot answer rejects with an `Error` whose `type` is one of six words (`name` is `'SyncError'`; `status` and `message` are for a log, not for code to read):

| `type` | From | Means | What the engine does |
|---|---|---|---|
| `signin` | 401 `rec:signin`, any other 401 or 403, a token that can no longer be exchanged | Nobody is signed in on this device any more: signed out here or from another device, the account deleted. | Stops calling. State `signed-out`. Stays attached: edits are still stamped into the outbox. Nothing is uploaded and nobody new is made (the review's R9, R13). |
| `unconfirmed` | 403 `rec:unconfirmed` | The email is not confirmed. | The same, with state `unconfirmed`. |
| `newer` | 409 `rec:newer` (a write only) | A newer app has written to this account. | State `newer`; see [format changes](#what-a-format-change-is). |
| `slow` | 429 `rec:slow` (a write only) | More than 30,000 records sent in a minute. | Sends the same batch again after 60 seconds. |
| `bad` | any other 4xx: `rec:shape`, `rec:batch`, and a call the database could not read at all | The call was refused whole for its form. The one case that can be met in use is a text the database cannot hold (`U+0000`, half of a surrogate pair) somewhere in the batch: the whole call fails with a 400 that is not one of `rec_write`'s own (seen on the real project: code `22P05` for the first, `PGRST102` for the second) and does not say which record it was. | Halves the batch and sends the halves; a record refused alone is parked as `bad`. The [limits checked on the device](#limits-checked-on-the-device) keep such a record out of a batch in the first place. |
| `net` | no connection, no answer in 30 seconds, a 5xx, an answer that is not what it should be | Nothing is known about whether the call took effect. | State `offline`. A write is sent again unchanged (the records are answered `same` if the first one landed). |

A token lasts an hour and is exchanged for a new one by the adapter; the engine never sees a token. Only when the exchange is refused does a call reject with `signin`.

**`listen(onSignal, onState)`** joins the person's private channel `rec:<uid>` and keeps it joined.

- `onSignal(n)` is called for every signal: `n` is the person's new change number, and nothing else travels on the channel. A device hears its own writes too. Signals can be lost, repeated, or arrive out of order.
- `onState('joined')` is called **every time** a join is taken, the first and every later one. A signal sent while the channel was not joined is gone, so this is the engine's cue to ask for the head.
- `onState('down', why)` is called when the channel is not joined: the socket closed, the line dropped, or a join was refused. The adapter goes on trying by itself, with a delay that doubles from 2 seconds to a minute. **A refused first join is one of these and not an error**: a project nobody has listened to for a few days refuses the first join of the day and takes the second ([backend.md](backend.md#what-the-adapter-must-do-learnt-from-the-real-project)).
- `onState('signin')` or `onState('unconfirmed')` is called when a join was refused and `head()` then refused too: the person is no longer signed in, and the adapter has stopped trying. An adapter tells the two refusals apart by asking the head, never by reading the reason text.
- `onState` is never called from inside `listen()` itself. `onSignal` can be called at any moment, including before a write of this device's own has been answered.

**Nothing asks on a timer.** The engine asks for the head when it connects, on `joined`, when a signal names a number it does not hold, when a write's answer shows a gap, and when the app comes back to the front ([`syWake`](#the-engines-calls)). The timers that exist are for giving up and for trying again: a call's 30 seconds, the adapter's rejoin, and the engine's retry of *its own unsent writes* ([open point 3](#open-points)).

What the model's adapter adds for tests, and the real one does not have: `online(false)` and `online(true)` (this device's line), `rejoin()` (the socket drops and comes back), and on the model itself `lose(n)` (the next n answers are lost on the way back), `cold(n)` (the next n joins are refused once), `hold()` / `deliver(n)` / `drop()` (signals kept back, let through, lost), `expire(token)`, `signOut(token, 'others')`, `snapshot(uid)` / `restore(uid, snap)` (a cloud put back to an earlier day), `advance(ms)`. Unless held, the model delivers a signal inside the write that caused it, before the writer has its answer: the harder of the two orders.

## The cursor

A device holds one number per account, the **cursor**: every version numbered at or below it has been applied to this device's deck and stored. It lives in the meta row. The rules:

1. **After a page of rows has been applied and stored** (the deck first, then the engine's transaction: [storage](#storage-on-the-device)), the cursor is the `n` of that page's last row. During a first join the pages are collected and the cursor moves once, when the join is stored.
2. **Never on an empty page, and never to the head's `n`.** The newest numbers of an account often belong to versions that can no longer be read (a sibling claim that expired), so the cursor is commonly a little below the head for good. That is correct. Raising it to the head's number would be wrong the one time an empty page was a signed-out session's.
3. **After a write, only when nothing can lie in between.** If the entries of the answer that were taken (those with `n` and without `same`) carry exactly the numbers `cursor + 1` to `answer.n`, with none missing, the cursor becomes `answer.n`. In any other case it stays where it is; and if `answer.n` is beyond what `seen` (below) accounts for, that is a signal like any other: read.
4. **Never on a signal alone, and never from `old.n` or a `same`.**

Beside it the engine keeps, in memory only, **`seen`**: the largest change number it knows itself to be level with in this connection. It exists to avoid reading for nothing: a signal or a head at or below `max(cursor, seen)` starts no read. It is set to a head's `n` when the catch-up that head began has ended on a short page, and to `answer.n` when the numbers a write was given run from `max(cursor, seen) + 1` to `answer.n` with none missing. That second case is the common one in which rule 3 cannot move the cursor: the cursor sits below the head because the newest version expired, the device writes, and its numbers start one past the head, not one past the cursor. `seen` then saves the read, and the cursor catches up from the rows of the next start's read. **Only the cursor is stored, and only the cursor says where a read begins**; `seen` is forgotten at every `syConnect` and whenever a call rejects with `signin` or `unconfirmed`, so a lie told by an empty page costs one read and nothing else.

A **catch-up** is always the same: `head()`; correct the clock from `now`; stop if `v` is newer than the engine; compare `n` with the cursor; if `n` is beyond `max(cursor, seen)`, `read` page after page until one is short, applying and storing each; then send what is in the outbox. One catch-up runs at a time; a signal that arrives during one is remembered and looked at when it ends.

**A change number that has gone backwards.** If a head's `n`, or a write's `answer.n`, is *lower than the cursor*, the cloud has been restored from an earlier copy or rebuilt. The device then holds versions the cloud has lost. It **joins again by re-seeding**: the cursor and `seen` go to 0, every record in the shadow goes back into the outbox under the stamp it has (a tombstone as a tombstone), and a normal catch-up runs from 0. The later stamp wins record by record, in both directions. **Nothing is ever deleted on a device because the cloud does not have it: a missing row is not a tombstone.** What this cannot see is a cloud that went backwards and was then written past the device's cursor before the device next connected; see [open point 2](#open-points).

## The engine's calls

Everything the app and the accounts module call. All are plain functions over the engine object `E` (the app keeps one, `SY`). None of them throws for something the network or the device's storage did; they report through `onStatus`.

| Call | What it does |
|---|---|
| `syCreate(env)` → `E` | Makes the engine. No reading, no network. |
| `syAttach(E, { uid })` | **Local only: no network, no library.** From this call on the engine tracks this person's deck on this device: it takes the picture of `S` described under [start-up](#the-save-hook-and-start-up), loads the shadow, and stamps every change into the outbox. Synchronous; the loading goes on behind it. Called on every start of a device that has an account, signed-in session or not, connection or not, so that an edit made on an offline start is stamped as the edit it is. |
| `syConnect(E, adapter, { join })` → Promise of `true` or `false` | Starts talking to the cloud: `listen`, then a catch-up. `adapter.uid` must be the attached `uid`, or nothing happens and the answer is `false`. `join` is `'merge'` or `'cloud'` and matters only on a device that has not joined this account ([joining](#joining)); on a start-up connect pass `'merge'`. Resolves `true` when the device has joined and caught up once, `false` when it could not (`syStatus` says why; the engine goes on trying where trying makes sense). |
| `syDisconnect(E)` | Stops listening and sending. The engine stays attached and goes on stamping. |
| `syDetach(E)` → Promise | Stops tracking. Resolves when the engine's last transaction is stored. What it has stored stays on the device. |
| `syForget(E)` → Promise | Detaches if need be and removes everything the engine has stored on this device: the shadow, the outbox, the meta row. Never touches `S`. This is the engine's part of `wipeLocal`. |
| `syOnSave(E, stored)` → number | The app stored the deck, or tried to ([the save hook](#the-save-hook-and-start-up)). Returns how many records were stamped. |
| `syReplaced(E, why)` | The app has put another deck in place of `S`, on the learner's word: `why` is `'import'`, `'restore'` or `'erase'`. Called after `S` is replaced and before the `save()` that stores it ([below](#when-the-deck-is-replaced)). |
| `syWake(E)` | The app is at the front again, or the device is online again: one catch-up, if connected. |
| `syHide(E)` | The app is being hidden or closed: send what is waiting now, the records that are otherwise held back for a minute included. Best effort, no answer. |
| `syDrain(E, { ms })` → Promise of `true` or `false` | Sends what is waiting and resolves `true` when the outbox holds nothing that can be sent (parked records do not count; `syStatus` lists them). `false` when `ms` (default 15,000) has passed or the engine cannot send (offline, signed out, `newer`, `full`). The accounts module calls it before anything is removed from a device: send first, refuse if it cannot (R4). |
| `syStatus(E)` → object | `{ state, uid, joined, pending, parked, cursor, lost, err }`: see below. |

```js
env = {
  state: () => S,                    // always through a function: import and restore put another object in S
  store: syIdb(),                    // where the shadow, the outbox and the meta row are kept (syMem() in tests)
  node: DEVICE.id,                   // the device's id, [0-9A-Za-z_-], at most 16 characters, never '0'
  now: () => Date.now(),             // the device's clock; the engine corrects it by the server's
  day: ms => dkey(new Date(ms)),     // the day a moment falls on, as the app writes it (local date, 'YYYY-MM-DD')
  local: LOCAL_SETTINGS.concat(STRICT_LOCAL),   // setting names that never leave the device
  onChange(res),                     // the engine changed S. Store it, repaint, and RETURN whether it was stored.
  onStatus(status),                  // the state changed: the same object syStatus() gives
  onNode(id),                        // the engine has taken a new device id; store it before returning
  derived: ['conf', '_g'],           // optional: top-level fields of S that are never synced (this is the default)
  timers: true,                      // optional: false makes the engine wait for its test to drive it
  rand: Math.random                  // optional: where a new device id comes from
};
```

**`onChange(res)`** must store the deck before it returns and return what `deckStore()` returned; the engine stores its own side only after a `true`. In the app it is `res => { if (res.erase || res.join === 'cloud') DECK_EMPTY_OK = true; const ok = saveNow(); rerenderAfterSync(); try { shLook(); } catch (e) {} return ok; }`. Three things in that line are load-bearing: `saveNow()` and not `save()`, which waits for the end of the tick; `rerenderAfterSync()`, which empties the undo stack (an undo would otherwise put back a day's count from before another device's reviews arrived); and `DECK_EMPTY_OK`, because the deck refuses to store an empty deck over a full one unless the learner asked for it, and an erase made on another device, or the choice to take an account's empty deck, is the learner asking. `saveNow()` reaches `syOnSave` on its way; the engine expects that and finds nothing to stamp. `res` is `{ n, kinds, lost, join, erase }`: records written into `S`, the kinds touched, the keys where a change made here and not yet sent was overruled by a different value from elsewhere, `'merge'` or `'cloud'` when this was a join (a first one or [joining again](#joining), where taking the cloud's copy is `'cloud'`), and `true` when an [erase mark](#erase-all-progress) was applied.

**`syStatus(E).state`** is one of: `off` (not attached); `attached` (tracking, not talking: never connected, or disconnected); `connecting`; `syncing`; `ok` (caught up, nothing waiting); `offline` (a call failed for the network; it will be tried again); `signed-out`; `unconfirmed`; `newer` (update the app); `full`; `other-account` (the device's store belongs to another person: nothing is tracked until `syForget`); `nostore` (the device's storage cannot be used: [sync is off on this device](#when-indexeddb-cannot-be-used)). `joined` says whether this device has finished a first sync with this account. `pending` is the number of records waiting, `parked` a list of `{ k, why }`, `lost` the keys reported in `res.lost` since the last connect, `err` the last error's text.

### What became of the old calls

For whoever ports `js/sync-records.js`. "Inside" means the function stays but is no longer something the app calls.

| On `origin/users-sync` | Here |
|---|---|
| `syCreate(env)` | Stays. `env.store` is the asynchronous store, not localStorage; `env.adapter` is gone (it comes with `syConnect`); `env.onNode`, `env.rand` are new. |
| `syStart(E, { uid, join })` | Split in two: `syAttach` (its `syLoad` and soft first diff) and `syConnect` (its `listen`). It no longer returns `false` for another account's shadow: loading is asynchronous, so that is the state `other-account`. |
| `syStop(E)` | Split in two: `syDisconnect`, `syDetach`. |
| `syOnSave(E)` | `syOnSave(E, stored)`. |
| `syFlush(E, force)` | Inside. The app calls `syHide` (was `syFlush(E, true)` on `pagehide`), `syWake` (was `syFlush(E)` on `online`) and `syDrain`. |
| `syReceive`, `syReady`, `syPump` | Inside, as the catch-up. Tests drive it by hand with `timers: false`. |
| `sySave`, `syLoad`, `SY_STORE` (`zika_sy_v1`) | Gone: `env.store`. Nothing of the engine's is in localStorage. |
| `syImport`, `syImportInto`, `syBlob` | **Gone.** They merged the old room's whole-deck blob. Thorne's deck moves from his devices, each joining by merging, not from the room ([decisions.md](decisions.md), 16 November 2026). |
| `syLegacy`, `syMergeLegacy`, `syJoin`, `syAtomic`, `syWipe` | Inside: they are the join. |
| `syFirebase(f)`, `SY_TS`, the `m` field, `SY_OVERLAP`, `SY_SLACK` | Gone. The adapter is `sySupabase(client)`, in step 5's file; the server's time on a record and the overlap were how the old cursor worked. |
| `syEnc`, `syDec` | Stay, and escape less ([keys](#keys)). |
| `syStamp`, `syWall`, `syCtr`, `syStampOk`, `syTick`, `syAfter`, `syObserve`, `sySoft` | Stay, in [the decimal form](#the-stamp). |
| `syHash`, `syPackCard`, `syUnpackCard`, `syPack`, `syUnpack`, `syCanon`, `syRank`, `syDiff`, `syApply`, `syWire`, `syCtRead` | Stay. `syWire` no longer writes `m`, and adds `t`. |
| `E.q[key] = 2` (remove from the cloud) | Gone: the database has no "remove". [Times to live](#times-to-live). |
| (none) | New: `syReplaced`, `syDrain`, `syForget`, `syWake`, `syHide`, `syIdb`, `syMem`. |

## The save hook and start-up

### What the app tells the engine about a save

Every time the app stores the deck, it tells the engine whether the deck was really stored. That is the whole hook:

```js
function saveNow(){
  QV++; try{S.conf=confSnapshot();}catch(e){}
  if(!DECK_READY)return false;
  const stored=deckStore();          /* true: the deck is on the device. false: refused or failed. */
  if(SY)syOnSave(SY,stored);         /* every time, stored or not */
  if(DECK_HELD)return false;
  bkQueue();
  return stored;                     /* (on a device without an account the room-code lines follow, as today) */
}
function saveLocal(){const stored=deckStore();if(SY)syOnSave(SY,stored);if(stored)bkQueue();}
```

- **`stored === true`**: the engine compares `S` with the shadow, stamps what differs, and writes the changed shadow entries, the new outbox records and the meta row in **one** transaction ([storage](#storage-on-the-device)). Sending follows 1.5 seconds after the last save.
- **`stored === false`** (the device is full; an empty deck was refused, `DECK_HELD`): the engine stamps nothing and stores nothing. What is already in the outbox still goes out. The deck in memory is ahead of the one on the device, and the next save that succeeds picks up everything at once. This is what F1 asked for: the engine never again stores a shadow for a deck that did not reach the device.
- `deckStore()` already answers `true` or `false` (`js/core.js`); the warning on screen when it answers `false` is step 6's. The call to `syOnSave` arrives with step 8.
- `bkWrite()` in `js/backup.js` stores the deck directly after writing the backup file, to keep `lastBackup`. That is a device-local setting; the call need not report. It leaves the deck [one generation ahead](#the-generation-number), which is harmless.
- `save()` runs `saveNow()` at the end of the tick, so many changes are one `syOnSave`. The engine does its own work at most once per tick too.

### When the deck is replaced

Import (`js/settings.js`), snapshot restore and Erase all progress (`js/backup.js`) put a new object in `S` and then call `save()`. Between the two they call `syReplaced(SY, why)`:

- `'import'`, `'restore'`: the difference the next save finds is the learner's doing, however large, and is stamped as a change made now. So the imported deck wins on every device, as an import does under the room code today, deletions included. The day's counts follow: this device's share becomes whatever makes the sum the imported number.
- `'erase'`: as above, and the engine writes the [erase mark](#erase-all-progress).
- In every case the engine sets the generation in the new `S` to its own (a backup file carries the number of the device that made it).

### Start-up: which changes are start-up's

Start-up changes the deck by itself: migrations, defaults, the pruning of old sibling claims, today's time-lapse entry, the deck My words creates the first time it is read. None of that is the learner acting now, and none of it may overrule a review made on another device. Such changes get a **soft stamp** ([the stamp](#the-stamp)). The question is how the engine knows them, since the shadow it would compare with loads asynchronously and the page is in use before it has loaded.

**The rule: `syAttach` takes a picture of `S` at the moment it is called, and it is called as the last statement of start-up.**

- Whatever differs between **the picture and the shadow** is start-up's doing, or happened while the engine was not attached, and is stamped soft.
- Whatever differs between **`S` and the picture**, at any later moment, is the learner acting, and is stamped as the edit it is, with the time the engine stamps it (a moment after the edit, when the shadow has loaded; never before it).
- A day's counts need no stamp to be right: they are sums ([the day's counts](#the-days-counts)).
- **The soft comparison never deletes in bulk.** What start-up removes by itself is old sibling claims, which are ignored once past and never tombstoned, and at most one snapshot a day that fell out of the 180 ([times to live](#times-to-live)). If the comparison of the picture with the shadow would write more than 50 tombstones (`SY_SOFT_DEL`), the picture is not believed: the deck is treated as one that regressed, and the device takes the cloud's copy and replays its outbox ([joining again](#joining)). This is the review's second guard for F1, beside the generation number: it costs a download and can lose nothing, where sending the tombstones could empty an account. A version of the app whose migration really must delete in bulk says so with `syReplaced`.

Checked against `js/boot.js` as it stands on `main` (v65):

- The order is `bootLoad(); DECK_READY=true; bootMigrate(); bootMount(); bootListen(); bootStart();`, then the welcome sheet, then `window.zikaStarted=true`. `syAttach` goes after the welcome-sheet line and before `window.zikaStarted=true`. Everything start-up changes in `S` happens synchronously before that point: the flags and defaults of `bootMigrate`, `pruneSib`, the mastery backfill, `exGet()` (which creates `S.exam`), `takeSnapshot(true)` in `bootStart`, and `myBadge()` at its end (which creates `S.my` with its twelve topics).
- **The saves of `bootMigrate` have not happened yet at that point.** `save()` only queues `saveNow()` for the end of the tick, which is after `js/boot.js` has finished. So "what start-up changed" cannot be read from the stored deck, and the engine cannot wait for the first save to know it: the picture has to be taken synchronously, of `S` in memory, at the end of `js/boot.js`. The queued `saveNow()` then calls `syOnSave` on an engine that is attached and still loading; the engine notes it and does its diff when the shadow is in.
- What `bootStart` leaves running afterwards does not change synced state: the backup file's `lastBackup` (device-local), the in-browser snapshots (not in `S`), the voice pack, the dictionary. The welcome sheet is the learner acting.
- Fields the app creates the first time a screen is opened (`S.tone` and `S.vp` by the tone coach, `S.mtest` by the writing test) are created after the picture and so are stamped as edits. They are created only where the field is missing, so there is nothing for them to overrule; two devices that create one at the same moment hold the same defaults.
- How the engine keeps the picture is its own business (the stored JSON, or a hash per record); it is dropped once the shadow has loaded and the first diff is done.

A device **signs in while the app is open**: the accounts module calls `syCreate` and `syAttach` then, and the picture is of `S` at that moment. Such a device has not joined yet, and everything it holds goes in by the rules of [joining](#joining), where the picture plays no part.

`syAttach` needs the person's id without a network and without the client library. The accounts module keeps it in a note of its own on the device, written at sign-in and removed at sign-out, and gives it through `acUid()` ([who owns what](#who-owns-what)).

## Record format 1

`SY_V = 1`. This is what is written into the database, and it only ever goes up: the database remembers the newest format that has written to an account and refuses an older app from then on.

### Keys

A key is `<kind>~<id>`: one to three lower-case letters, a tilde, the id. The database takes 3 to 512 bytes and refuses the control characters U+0001 to U+001F and U+007F.

- `syEnc(id)` writes `%` and the control characters U+0000 to U+001F and U+007F as `%xx` (two lower-case hex digits) and leaves everything else alone; `syDec` reverses it. (The Firebase escapes for `. $ # [ ] /` are gone: every id the app makes today is its own key.) An id that is not well-formed Unicode is not synced.
- Ids that contain a tilde: `d` is `<day>~<device>`, split at the **last** tilde (a device id has none); `sb` is `<day>~<word id>`, split at the **first** (a day has none).
- The length that counts is the key's length in UTF-8 bytes (F7). A record whose key would pass 512 bytes is not synced, and is listed as parked `key`.

### The kinds

Checked on 21 November 2026 against every top-level field of `S` that `js/*.js` on `main` reads or writes (v65: `cards`, `settings`, `log`, `intro`, `cintro`, `gintro`, `hard`, `pick`, `hist`, `sib`, `gram`, `cf`, `listen`, `us`, `read`, `mtest`, `tone`, `vp`, `exam`, `my`, `conf`). The dictionary (v65), the usage phrases and the stories added no field the table of the old notes did not have: the dictionary keeps nothing in the deck, the phrases keep `us`, the stories `read`. Two things are new here: `er`, and `_g`, which is the engine's own and never synced.

| Kind | Part of `S` | Id | Value (`j` is its JSON) | Merge |
|---|---|---|---|---|
| `c` | `cards` | card id (`w123:rec`, `w123:prod`, `g:n22-1`) | the [card line](#values) | later stamp wins; a blind queued card never replaces anything |
| `mc` | `my.c` | `u7:rec`, `uk3j9x2a-12:prod` | the card line | as `c` |
| `s` | `settings`, without the device-local ones | setting name | the setting | later stamp wins; a flag (a name starting `_`) that is set always beats one that is not |
| `d` | `log`, `intro`, `cintro`, `gintro`, `my.intro`, `my.log` | `<day>~<device>`; device `0` is the shared base | `{ r, n, i, c, g, mi, ml }`, zero fields left out | one record per device per day, **summed**; the base by the larger number ([the day's counts](#the-days-counts)) |
| `er` | none | `all` | `{ d: '<day>' }` | later stamp wins ([Erase all progress](#erase-all-progress)) |
| `h`, `p` | `hard`, `pick` | word id | the stamp it was added with, a string (empty when added by a soft change) | per member, later stamp wins, tombstone on removal |
| `mp` | `my.tp` | topic id (`t3`, `tk3j9x2a-14`) | `{ a, n }`: the add stamp and the topic's fields without its id | as `h` |
| `o` | the order of those lists | `h`, `p`, `mp` | an array of member ids | later stamp wins |
| `hi` | `hist` | day | the [packed snapshot](#values) | later stamp wins; only the newest 180 days are kept |
| `sb` | `sib` | `<day>~<word id>` | the card id that owns the word that day | later stamp wins; forgotten after two days |
| `g`, `cf`, `li`, `us`, `rd` | `gram`, `cf`, `listen`, `us`, `read` | grammar id, family, lesson, word id, story | the tally as the app holds it | later stamp wins |
| `mr`, `tw` | `mtest.res`, `tone.w` | word id | the mark, the tally | later stamp wins; waits for its container |
| `mw` | `my.w` | `u7`, `uk3j9x2a-12` | the word | later stamp wins |
| `mn` | `my.n`, `my.tn` | `n`, `tn` | a number | the larger number wins |
| `x` | every other top-level field, whole: `exam`, `vp`, and what is left of `mtest`, `tone` and `my` once the maps above are taken out | field name | the field | later stamp wins |
| `zt` | none | anything | anything | the database's test writes these. The app never writes one and ignores any it reads. |

- **Not synced**: `conf` (rebuilt on every save) and `_g` ([the generation](#the-generation-number)); the settings in `LOCAL_SETTINGS` and `STRICT_LOCAL` (today `voiceName`, `audioSrc`, `theme`, `lastBackup`, `bkName`, `autoBackup`, `haptics`, `_bkWarned`, `preloadedAt`). Unlike under the room code, a new device does not inherit the first group either.
- **A top-level field a later version adds to `S`** travels as `x~<field>`, whole, without anyone deciding. That is a safe default and not a decision: the engine's test "every field of `S` the app uses has a decided sync rule" fails until someone decides, and giving the field a kind of its own is a [format change](#what-a-format-change-is). The my-mistakes deck on the roadmap is the first that will meet this.
- **`mr` and `tw` live inside `x~mtest` and `x~tone`.** The engine never makes up the rest of a container: such a record waits (in the meta row's waiting list) until its container's own record has arrived. A container's tombstone removes the records inside it on the device that applies it, and they are tombstoned by the device that deleted the container (F9).
- **`x~exam` and `x~mtest` are lazy**: they change on every answer of a test in progress and are a few KB, so they are sent at most once a minute, and when the app is hidden (`syHide`).
- **My words ids** are `u<n>` for words made before step 6 and `u<device>-<n>` after it; topics `t<n>` and `t<device>-<n>`. Two offline devices can then no longer give one id to two words (F2). `my.n` and `my.tn` stay one counter each, the larger winning: with the device in the id they only have to keep a device from reusing its own.
- **`vp`**, the tone coach's picture of the learner's voice, is synced whole. It describes the person more than the microphone; see [open point 8](#open-points).

### The stamp

A stamp says which of two versions of one record is the later. It is a hybrid logical clock value:

```
<wall-clock ms: 13 decimal digits><counter: 3 characters 0-9a-z><device id: 1 to 47 of 0-9A-Za-z_->
1795680000123 004 k3j9x2ab          written without the spaces: 1795680000123004k3j9x2ab
```

```js
const SY_WMAX = 9999999999999, SY_CMAX = 46655;      /* the largest wall-clock and counter a stamp holds */
function syStamp(wall, ctr, node) { return String(Math.min(SY_WMAX, Math.max(0, Math.floor(wall || 0)))).padStart(13, '0') + Math.floor(ctr).toString(36).padStart(3, '0') + node; }
function syWall(st) { return +st.slice(0, 13); }
function syCtr(st) { return parseInt(st.slice(13, 16), 36); }
function syStampOk(st) { return typeof st === 'string' && /^[0-9]{13}[0-9a-z]{3}[0-9A-Za-z_-]{1,47}$/.test(st); }
```

**Two stamps are compared as plain strings** (`a < b`, `a === b`), which for these characters is the byte-by-byte order the database uses. The decimal form is what lets the database hold a stamp to its own clock (F3, F-2): it refuses one more than five minutes ahead of it. The engine's device id is at most 16 characters; the pattern allows 47 so that it need never change.

1. **A device's clock only goes up between two answers of the server** (`syTick`): the wall part is the corrected time or the last one used, whichever is later, and the counter orders events inside one millisecond.
2. **An edit beats the version it was made on top of** (`syAfter(E, base)`): later than now and later than the record's current stamp. Where the current stamp is ahead of this device (it came from a device whose clock runs fast) only the counter moves on, and the device's own clock is not dragged forward.
3. **The wall part follows the server.** Every `head` and every `write` answer carries `now`; the engine keeps the difference to its own clock in the meta row and stamps with the corrected time, offline too, from the last difference it learned. **When a server time arrives and the engine's own clock is more than five minutes past it, the clock comes back down to the server's**, and records in the outbox stamped beyond it are stamped again (each still after the version it replaced) before they are sent. This is the fix for F3: one save under a wrong clock no longer leaves a device winning every conflict for good. The first write of a connection never leaves before that connection's `head` has answered.
4. **A stamp from another device that is more than five minutes ahead of this device's corrected time is applied and does not move this device's clock** (`syObserve`, `SY_DRIFT = 300000`, the same five minutes the server allows).
5. **A change that is not the learner acting now gets a soft stamp** (`sySoft`): the stamp of the version it replaced with the counter moved on by one, under this device's id; or, where there was none, the oldest stamp there is, `0000000000000` `000` and a device part of `0` followed by the first seven characters of the value's hash. Anything a person did since, on any device, beats it, and two devices that soft-stamp different values settle on the same one. **A card is the exception: it carries the time of its last review, and that time, never later than the corrected now, is its wall part.** Soft stamps are for start-up's changes, a deck that is joining, and a blind queued card.
6. **A blind queued card** (a card object with no `st`, on a device whose shadow has never heard of that card: adding a lesson does this to every card in it) is always stamped as old as a stamp can be. It fills a gap and never replaces anything.

#### Two devices with one id

A phone restored from another's backup can share its device id (F4). Then two different versions can carry one stamp, and one record per device per day is written by two devices. The engine knows it in two ways: a write is answered `old` with **the stamp it sent and another value**; or a record arrives under its own device id with a stamp it never made (later than its own clock). In both cases the engine takes a new id (eight characters `0-9a-z` from `env.rand`), tells the app through `onNode(id)`, which stores it in place of `DEVICE.id` before returning, stamps its own version again after the one that stood, and sends it. Its day's counts from then on go under the new id; the share it had written under the old one stays where it is and is still summed.

### Values

`j` is always a JSON text: `JSON.stringify` of the value in the table, after the kind's compact form where it has one. Both compact forms are exact, and a value that does not have the usual shape goes through untouched, wrapped as `{ "$": value }`.

- **The card line** (`syPackCard`, `syUnpackCard`): one string, `st,S,D,due,last,reps,lapses,days[,flags[,mastAt[,extras]]]`. `st` is `l`, `r` or `x` for `learn`, `rev`, `relearn`; the seven numbers are written as JavaScript writes them; `flags` is some of `k` (`known`), `s` (`susp`), `h` (`leech`), each set to 1 on the card; `mastAt` a number or empty; `extras` the JSON of every other field. A queued card (`{}`) is the empty string. So `j` for a card is, with its quotes, `"r,3.17,5.2,1795680000000,1795593600000,7,1,20"`.
- **The packed snapshot** (`syPack`, `syUnpack`): a daily snapshot is one digit per word; a run of more than three equal digits is written as the digit and its length in base 36 in brackets, `0(15o)12…`.
- Everything else is the value as `S` holds it.
- The hash in the shadow is of the value as `S` holds it, not of its wire form, so a compact form could change without anything looking edited. (Changing one is still a format change.)

### Times to live

`rec_write` has no way to remove a row. A record written once without `t` is in the database for good, and so is its tombstone: tombstones are how a deletion is remembered, and their number is bounded by the ids ever used. For the two kinds the app itself forgets, the server is told to forget too. **`t` is set on every write of such a record, value or tombstone**: a later version sent without it would make the record permanent again, and sending the same version again does not give it more time.

| Kind | `t` on a value | `t` on a tombstone | Why |
|---|---|---|---|
| `sb` | 259,200 (3 days) | 259,200 | A claim matters on its day and the day after. The device ignores one more than two days old (`SY_SIB_DAYS`), by its own clock. |
| `hi` | none | 2,592,000 (30 days) | A snapshot is kept while it is among the newest 180 a device holds, however long ago that is (the server's longest `t` is 400 days, and 180 snapshots can span more). When one falls out, or a device reads one that is older than its 180, the device writes a tombstone that the server forgets a month later. |
| every other | none | none | |

- A record the device counts as past (`stale`: a claim more than two days old, a snapshot older than the oldest of the 180 it holds) is ignored when it arrives and never written into `S`; a past snapshot that arrives as a value is also answered with the tombstone of the table, so that the server forgets it. This is what makes forgetting safe: after the server has forgotten a record, an old version of it can be written again by a device that was away, and nobody takes it for news.
- The server counts `t` from when it took the record, by its own clock, and a record past its time is no longer read by anyone, though it may sit in the table until the person's next write.
- 60 seconds to 34,560,000 (400 days), a whole number; anything else is refused `ttl`.

### Limits checked on the device

Before a record enters a batch (F7). The database enforces each of these too; the point is that the device finds the one bad record instead of losing the batch.

| Limit | Value | When passed |
|---|---|---|
| Key | 512 bytes of UTF-8, 3 at least | not synced; parked `key` |
| Value (`j`) | 65,536 bytes of UTF-8 | parked `size` (the largest real value is a test in progress, about 15 KB) |
| Text | no `U+0000` and no half surrogate pair, in `k`, `h` or `j` | parked `bad`: one of these fails the whole call. (A value never holds one in practice: `JSON.stringify` writes both as escapes inside `j`. The check is for the key and for the day that stops being true.) |
| Stamp | the pattern above; not more than five minutes ahead of the corrected now | stamped again |
| Records in one call | 1,000 by the database; the engine sends at most 500 (`SY_BATCH`) | |
| Records in a minute | 30,000 by the database | `slow` |

Counting bytes: `recModel.bytes(s)` and `recModel.unstorable(s)` in `tools/lib/recmodel.js` are the two functions, written without anything a browser lacks; the engine has its own copies and a test holds them equal.

### What a format change is

`SY_V` goes up, and the release that raises it says so in [decisions.md](decisions.md), when a version of the app writes something an older engine would get wrong: a new kind; a field of `S` moved out of `x` into a kind of its own; a change to a key's form, a compact form or a merge rule; a kind's time to live.

It does not go up for a new setting, a new id, or a new top-level field of `S` that travels as `x~<field>`.

**An engine that meets a newer format stops.** When a head says `v > SY_V`, or a write is refused `newer`, the engine reads nothing more and sends nothing more; the state is `newer` and the app says "update". It stays attached, so nothing studied meanwhile is lost: it goes out after the update. (The database would still let it read. It does not, because a newer format may mean something else by a value it thinks it understands: the review's 8d.) Since it reads nothing, its cursor never passes a record it does not understand (F6). **An engine that finds its own stored shadow written by an older format** (`v` in the meta row) starts its cursor again from 0 and reads everything once, so that records of a kind the old one ignored are fetched.

## The day's counts

The streak, Today and the weekly numbers come from `S.log` (reviews and new cards per day) and the intake counters (`intro`, `cintro`, `gintro`, `my.intro`, `my.log`). `S` holds one number per day. Two devices that study on the same day must add up, and "later stamp wins" cannot add.

**Decided: one record per device per day, `d~<day>~<device>`, each device writing only its own, and the number in `S` is their sum, worked out on the device.** The shadow keeps every device's share. What `S` holds beyond the known sum is what this device did since, and goes into its own record; a share that arrives from another device changes `S` by the difference to that device's last known share.

Why not rows the database sums, the alternative left open on 16 November: the database never looks inside a value, and that is worth keeping (one table, one function, one policy, no per-field validation). It could not do the adding anyway: a device that is offline has to hold its own share until it is back, and has to show a right total meanwhile, so the shares and the adding are on the device whatever the database does. A sum on the server would be a second place for the same number, and a second answer to disagree with.

What it costs: about 130 bytes in the database per device per day studied, for ever. Three devices for ten years are 1.4 MB of the 8 MB and 11,000 of the 40,000 rows. Folding old days together is not done ([open point 7](#open-points)).

**The shared base, and the loss at a first sync.** A deck that joins brings day totals that are not anyone's share: they were counted before the device synced by record. They go into the base record of that day, device `0`, which is merged by taking the **larger** number field by field, so two devices that bring the same old deck do not count it twice. The loss is exactly this: **when a device joins, a day's total becomes the larger of the device's and the account's, not their sum.** If two devices studied on the same day, apart, before either had joined, the smaller count disappears into the larger. For Thorne's move it will not happen if the three devices agree through the room first, which is the first step of the move ([roadmap.md](roadmap.md#app)); the rehearsal prints each day's total before and after so that it can be seen not to have happened.

Smaller print:

- `my.intro` and `my.log` older than 119 days are left alone in both directions (My words prunes them at 120 entries; without this a pruned day would read as "set to zero"). They are neither wiped nor written at a join (F8).
- An undo subtracts, because the device's share is whatever makes the sum right.
- **The app must empty its undo stack when the engine changes `S`** (`rerenderAfterSync` does): `doUndo()` puts back a whole copy of `S.log`.
- A device that takes a [new id](#two-devices-with-one-id) leaves its old share where it is.

### Erase all progress

*Erase all progress* (`js/backup.js`) replaces `S` with an empty deck that keeps the settings. With `syReplaced(SY, 'erase')` before the `save()`, the engine writes:

1. **A tombstone for every record the erase removed**, under a stamp made now: every card, list member, tally, snapshot, My word. They go out like any other change, 500 to a call. (Settings are kept by the erase and are not touched.)
2. **One erase mark, `er~all`, with the value `{ d: '<today>' }`**, the erasing device's day, under a stamp made now. It says: every count for a day up to and including `d` is void unless its record was stamped after this mark. The day records themselves are left as they are: the mark is what voids them.

On every device, from the moment it holds the mark: a `d` record for a day at or before the mark's `d` counts only if its stamp is later than the mark's stamp, the base record included. A device that learns of the mark drops every share it holds for those days, its own too, and sets those days' numbers in `S` to the sum of what is left; if it had stamped its own share after the mark without knowing of it, it writes that share again, empty. A deck that joins later brings no counts for days at or before `d`. So the counts do not come back when an old device turns up (F8, the review's 5d), which writing a negative share, as the engine did, could not promise.

What the mark does **not** do is void other records. A card reviewed on a device that had not heard of the erase carries a later stamp than its tombstone and comes back, by the one conflict rule; its review is not counted. And an erase is not atomic: a device that goes offline half-way through sending its tombstones leaves the others with part of the deck gone until it is back. [Open point 4](#open-points).

`res.erase` is `true` in the `onChange` of a device that applies a mark, so that the app may store the emptied deck.

## What each merge does, and what it loses

**Cards.** Each card is its own record, so a review on one device is never lost to a review of a *different* card on another. If the **same card** is reviewed on two devices that have not heard of each other, the later stamp wins, on every device, whoever syncs first, and the other review's effect on that card's schedule is lost. The review is still counted in the day. This is the one conflict rule; it holds for any two changes to one record made without knowledge of each other (a delete against a review: the later one).

A card that is merely queued on a device that has never heard of it fills a gap and replaces nothing ([the stamp](#the-stamp), rule 6). A deliberate reset (the undo of a first review, Triage → Learning) is made on top of a known version and wins as any edit does. The loss: a lesson removed on one device and added on another that has not heard of the removal stays removed; add it again.

**Settings.** One record per setting; deleting a setting deletes it everywhere. Migration flags (`_v38` …) are synced and set-only, as `fbAdopt` carries them today: a migration's result arrives as records, so a device that receives the flag has received the migrated data and must not migrate on top of it. A device that does run a migration at start-up produces soft changes, so a migration never overrules a review. The loss: where an unmigrated edit made elsewhere beats the migrated version of a record, that record stays unmigrated though the flag is set. A migration that changes *device-local* settings must not rely on a synced flag.

**Lists** (`hard`, `pick`, the topics of My words). A list is a set of member records and one order record. Adding or removing touches one record; both devices' additions survive; remove-then-add elsewhere is decided by stamp. The order is: members named in the order record, in its order, then the rest by the stamp they were added with. Only a deliberate reorder (*Top* in the up-next list) writes the order record; two reorders at once, the later wins.

**Daily snapshots and sibling claims** are kept for a time and then forgotten ([times to live](#times-to-live)). Sibling claims are judged by each device's own clock: a device whose clock is days off will not share them correctly, which only affects which of a word's two cards is shown today. `takeSnapshot()` looks at the last entry of `S.hist` only; step 6 makes it find today by date. Until then the engine reads the later entry of a repeated day and drops the earlier one.

**Drill tallies** (`gram`, `cf`, `listen`, `us`, `read`, `mtest.res`, `tone.w`): one record per item, later stamp wins. The loss: the same item drilled on two offline devices keeps one device's tally, not the sum. These numbers order quizzes and draw progress bars; they schedule nothing. (The "which pattern?" drill of v66 marks `gram` and falls under this.)

**Whole fields** (`exam`, `vp`, the rest of `mtest`, `tone` and `my`): one record each, because the app expects their fields to be there together. The tone coach resets `S.tone` when its version marker is not the one it knows; step 6 gives it one marker, and two versions of the app with different markers would otherwise reset each other's in turn.

## Joining

A device **has joined** an account when its shadow says so (`joined` in the meta row). Until then nothing it holds has a stamp.

**The first sync.** `syConnect(E, adapter, { join })` on a device that has not joined reads everything the account holds, all pages, and then, in one step that changes `S` and the shadow only if it finishes:

1. lays the account's records down on a copy of `S` emptied of everything that syncs;
2. with `join: 'merge'`, merges the device's own deck in as a deck that was never synced: each card stamped with the time of its last review, everything else as older than anything synced, the day's totals by the larger number;
3. hands the result to `onChange` with `res.join`, and stores its own side when the app has stored the deck.

So with `'merge'`: an **empty account** takes the device's deck; an **empty device** takes the account's; where **both hold something**, each record is decided on its own. A card is won by the later review. For everything without a time of its own (settings, list members, tallies), what the account already holds stands and the device fills in what is missing. A deck that was never synced has no deletions to report: a card one side lacks is filled in from the other.

With `'cloud'` step 2 is left out: the device ends with the account's deck and nothing of its own (device-local settings aside). **`'cloud'` on an account that holds no records is treated as `'merge'`**: there is nothing to take, and the other reading would empty the device.

Which of the two is the accounts module's to decide, and it decides before it calls:

- A device that holds a deck someone has studied: the learner is asked, add it (`'merge'`) or replace it (`'cloud'`), before anything is removed (R6).
- A device nobody has studied on (the test the room sync uses today for "adopt silently"): `'cloud'`, without asking. **Not `'merge'`**: a new device's deck carries `born` and `welcome` in its settings, and merged into Thorne's account they would hide his Notion links and open the welcome sheet on his other devices.
- A new account, made on this device: either; the account is empty.
- Every later start of a device that has an account: `'merge'`. It only matters if the device's shadow was lost, and then the deck must be merged, never dropped.

**Joining again.** Four situations put a device that has joined through a join again. None of them removes anything from a deck because the cloud lacks it.

| Found | Means | What the engine does |
|---|---|---|
| The deck's generation is **behind** the meta row's | The deck regressed: a store that failed and was not reported, a deck restored from an older copy, the empty default deck over a lost one (F1). | **Takes the cloud's copy, then replays the outbox.** It reads everything from 0 and lays it down as in step 1; then the outbox's records are applied on top and stay in the outbox. The picture of the regressed deck is never sent. Changes the learner makes between the start and that moment are kept: they are differences from the picture, stamped as edits into the outbox. Until it has a connection the device shows the deck it has. |
| The deck's generation is **more than one ahead** | The deck was stored with records from the cloud in it, or several times, and none of it reached the engine's store. | **Joins again by merging**: reads everything from 0, merges the deck as in step 2, then replays the outbox on top. Day totals go by the larger number, so nothing is counted twice. |
| The shadow is **gone** and the device has an account | The browser dropped the engine's database. | The same merge. The outbox went with it: what was stamped and not sent comes back as part of the deck, cards by their own time, and a deletion made offline is undone. That is the size of F5 once the outbox is a store of its own: it takes losing IndexedDB, not one failed write. |
| A change number that went **backwards** | The cloud was restored or rebuilt. | **Re-seeds** ([the cursor](#the-cursor)): everything in the shadow goes out again under its own stamp. The shadow is right; it is the cloud that forgot. |

The outbox is replayed in every one of them. It is the only place a deletion or a reset made offline is written down, and a join by itself cannot know of one.

## Storage on the device

The deck stays in localStorage under its key. **Everything of the engine's is in IndexedDB** (F10): about 300 KB of shadow for a deck of 5,800 records, which does not fit beside the deck and its three snapshots in localStorage's 5 MB, and which the old engine rewrote whole three times per review.

`env.store` is three functions, so that tests can stand in memory for it and make it fail:

```js
store = {
  load(),            // → Promise of { sh, out, ct, meta } (four plain objects, key → value), or null when nothing is stored
  commit(changes),   // → Promise. changes: { sh: {…}, out: {…}, ct: {…}, meta: {…} }, each key → new value, or null to remove.
                     //   ONE transaction: all of it is stored or none of it.
  clear()            // → Promise. Removes everything.
};
```

`syIdb(name)` is the IndexedDB one (database `zika-sync`, one object store for each of the four); `syMem()` the one for tests, with switches to fail a commit, lose the lot, or go slow. Both are the engine's (step 4b). A store rejects with an `Error` whose `type` is `'nostore'`.

| Part | Holds |
|---|---|
| `sh` | The shadow: key → one character (`v` a value, `d` a tombstone), the 11-character hash of the value, the stamp. |
| `out` | The outbox: key → the complete record to send, `{ k, h, j }` or `{ k, h, d: true }`, with `t` where its kind has one, and `p` (the reason) when parked. One entry per key: a newer change replaces an unsent older one. |
| `ct` | Every device's share of each day's counts: the `d` key → `{ r, n, … }`. |
| `meta` | Small named values: `v` (the format), `uid`, `node`, `g` (the generation), `cur` (the cursor), the clock (`hw`, `hc`, `off`), `joined`, `er` (the erase mark's stamp and day), the order records of the lists, the records waiting for a container. |

The rules that make it safe:

1. **One transaction per tick.** A save, or a page of rows applied, is one `commit`, issued after the deck has been stored for that tick, and only then. If the deck was not stored, nothing is committed (the engine goes on in memory and commits everything at the next store that succeeds).
2. **A record is sent only after the commit that put it in the outbox has finished**, and it is sent from the outbox as it lies there. It leaves the outbox in a later commit, when the server has answered for that stamp. A device that is closed between the answer and that commit sends the record again and is told `same`.
3. **The deck is stored before the engine's side, always.** The dangerous order is the other one, a shadow that claims versions the deck never got; the generation number is how the engine notices when the two have parted either way.

### The generation number

`S._g` is a whole number inside the deck's own JSON, and `g` in the meta row is the generation of the deck the engine's store was last written for. The engine keeps `S._g`; the app never reads or writes it and never syncs it (`derived`). It travels in backup files and means nothing there.

- In memory, `S._g` is always the number **the next store will write**. At `syAttach` the engine reads the number the deck came off the device with, `disk`, and sets `S._g = disk + 1`. Each `syOnSave(E, true)` makes `disk` the number just written and adds one to `S._g`; `syOnSave(E, false)` changes nothing, so the next try writes the same number.
- **The engine adds one more itself each time it changes `S`** (records applied, a join, an outbox replayed, a replaced deck's number set), before it calls `onChange`. So a deck that was stored with the cloud's records in it is never exactly one ahead of the meta row.
- Each commit writes `g = disk`.

When the shadow has loaded, the engine compares the deck's `disk` with the meta row's `g`:

| Deck | Means | Then |
|---|---|---|
| equal | In step. | The picture is compared with the shadow; what differs is stamped soft. |
| **one ahead** | The deck was stored once and the engine's commit did not follow: the app was closed between the two writes, or the store was one the engine is not told about (`bkWrite`). What the deck holds beyond the shadow is this device's own doing. | **Recover**: the same soft comparison. A card keeps its own time and a day's count is a sum, so a review made in the last instant before the app closed is neither lost nor counted twice; a setting changed in that instant loses to one changed elsewhere since. |
| **more than one ahead** | The engine changed the deck, or it was stored several times, and the commit did not follow. Records from the cloud may be in the deck without being in the shadow, and comparing would send them out as this device's own and count another device's reviews twice. | [Join again by merging](#joining). |
| **behind** (or no `_g` in the deck at all) | The deck regressed. | [Take the cloud's copy, replay the outbox](#joining). |

The engine's tests must be able to make each of these happen: `syMem()` fails a commit on request, and the rig stores or fails the deck on request and reloads.

### When IndexedDB cannot be used

A browser can refuse IndexedDB altogether (some private windows; storage turned off), and WebKit on iOS is known to lose its connection to the database after the app has been in the background, after which every transaction fails until the database is opened again.

- A failed `load` or `commit` is tried once more on a freshly opened database.
- If that fails too, **sync is off on this device** for the rest of this run of the app: the state is `nostore`, the engine stops listening, sending and stamping, and the app says so in words ("Sync is off on this device: its storage is not available. Your progress is still saved here. Close the app and open it again."). The deck goes on being stored in localStorage as always; studying is not interrupted.
- **Nothing of the engine's falls back to localStorage**, and the engine does not carry on in memory without its store ([open point 6](#open-points)).
- At the next start the deck is several generations ahead of the meta row, or the shadow is gone: either way the device joins again by merging, and nothing studied meanwhile is lost.

One copy of the app per device: two tabs of one browser share a device id, a deck and a store, and will confuse each other. The app has the same problem with `S` itself.

## Who owns what

Four pieces, each in a worktree of its own, each from `main`. A piece changes only its own files. `tools/lib/recmodel.js`, `tools/dbtest.mjs`, `db/` and this file are shared: a change to one of them is a change to the contract, made first and by itself.

| Piece | Owns | Stands in for the others with |
|---|---|---|
| **4b. The engine** | `js/sync-records.js`: everything named `sy…` and `SY_…` except `sySupabase`, the two stores `syIdb` and `syMem`, and `let SY = null`. `tools/test/sync.test.js`, `sim.test.js`, `review-*.test.js`, `tools/test/helpers/deck.js` and `rig.js`, `tools/sync_numbers.js`. | **The cloud**: `recModel()` and its `adapter(token)`. `tools/test/helpers/cloud.js`, the Firebase-shaped one, is not brought over. **The app**: the rig's few lines that imitate `saveNow()` (store or fail the deck, then `syOnSave(E, stored)`), `rate`, `doUndo` and the rest, as on `origin/users-sync`. **Accounts**: the rig calls `syAttach` and `syConnect` itself, with `M.session(uid)` for a session. |
| **5. The adapter** | `js/sync-supabase.js`: `sbLoad()` → Promise of the one Supabase client (it loads the pinned library when first asked, never at start-up, and picks the project by where the app is served from), and `sySupabase(client)` → the adapter. The pinned library under `assets/`, with its line in `sw.js`'s list of assets. `tools/adaptertest.mjs`: the checks of the group "the adapter over the model" in `tools/dbtest.mjs` that can be staged on a real project, by the same names, against `zika-dev`, from Node and from two browsers. | **The engine**: none needed; the test calls the four functions. **Accounts**: it signs the test accounts in through the client library directly. |
| **6. Ready the app (v67)** | The app files as they are, and only what [roadmap.md](roadmap.md#app) lists for it: `LOCAL_SETTINGS`, `STRICT_LOCAL`, `DEVICE` and the like moved from `js/sync.js` to `js/core.js` and `js/shell.js`; My-words and topic ids with the device in them; the warning when `deckStore()` answers `false`; `takeSnapshot()` by date; one version marker for the tone coach; the manual export's name. | Nothing: it ships under the room code and calls nothing of the other three. **It does not add `S._g`, `SY`, or a call to `syOnSave`**: those arrive with step 8, so that the harness finds v67's stored deck the same as v66's. |
| **7. Accounts** | `js/account.js`: everything named `ac…`, among it `acUid()` (the signed-in person's id from a note on the device: synchronous, no library, no network; `''` when there is none) and `acBoot()` (below). `db/0003_account_delete.sql` with its group in `tools/dbtest.mjs` and its door on the model (`deleteUser` is there; the door a signed-in person calls is added with the SQL). `tools/test/account*.test.js`. | **The engine**: a fake with the calls of [the engine's calls](#the-engines-calls) and nothing else, which records what it was asked and answers as the test says. **The client library**: a fake `auth` over the model's doors (`signIn`, `signOut`, `refresh`, `session`, `addUser`, `confirm`, `expire`, `deleteUser`), which are where the account states come from. **The app**: `wipeLocal` and the Settings section are step 8's; until then the module is driven by its tests. |

Names, so that two pieces never define one (the release check fails on a name at the top of two files): `sy…`/`SY…` the engine; `sb…` and the one name `sySupabase` the adapter's file; `ac…` accounts.

Each new file under `js/` is named in `index.html` by the piece that adds it (the release check refuses a file the page does not name), ends with the line every file there ends with, and only defines. The order when they meet: `js/sync.js`, `js/sync-records.js`, `js/sync-supabase.js`, `js/account.js`, the rest as now, `js/boot.js` last. `index.html` and `sw.js` will then differ between the branches only in lines `tools/stamp.mjs` writes; run it again after merging.

What the accounts module promises the engine, since both sides code against it:

- `acBoot()` is called by `js/boot.js` as its last statement before `window.zikaStarted=true`. On a device with an account (`acUid()` is not empty) it makes the engine and attaches it, synchronously: `SY = syCreate(…); syAttach(SY, { uid: acUid() })`. Then, without holding start-up, it asks `sbLoad()` for the client, lets the library restore the session, and calls `syConnect(SY, sySupabase(client), { join: 'merge' })`.
- A device with an account never loads Firebase and never runs the room code; a device without one never loads the Supabase library and runs exactly as today. One test decides, and it is `acUid()`.
- **Signing out, when the learner asks for it**: `syDrain` (refuse, or ask, when it answers `false`), `syDetach`, `syForget`, then the session, then the note. The engine's store is not kept across a sign-out: signing in again is a first sync, and asks again what to do with a deck on the device.
- **Signed out without asking** (the state `signed-out`: the password was changed elsewhere, the session ended): nothing is removed and nothing is detached. The module says "signed out, sign in again"; signing in as the same person makes a new adapter and `syConnect`s it; as another person, it is a different person's device and goes through the sign-in on a device that holds a deck.
- The "merge pending" note the review asked for (R1 to R3) is the module's own. It is cleared when `syConnect` has resolved `true`, never before.

What step 8 adds to the app, for which the four leave room: the hook in `saveNow()` and `saveLocal()`; `syReplaced` in import, restore and erase; `syWake` on `visibilitychange` to visible and on `online`, `syHide` on `pagehide`, `beforeunload` and `visibilitychange` to hidden; `acBoot()`; the sync pill fed from `onStatus`; `wipeLocal`.

## Open points

Each with what is recommended, so that they can be settled in one pass. None of them stops 4b, 5, 6 or 7 from starting: the contract above is written to stand whichever way they go, except where a point says otherwise.

1. **Reading through a function that says who is asking (`db/0003`).** Today a signed-out device's read is an empty list, not an error; the contract works round it (an empty page proves nothing; a catch-up starts with the head). A function `rec_read(after, lim)` that refuses as `rec_head()` does, and returns the head with the page, would make "nothing new" and "signed out" different answers and save a call per catch-up. *Recommended: add it with `account_delete()` in `db/0003`, and change `read` to use it. The adapter's contract does not change: `read` then rejects with `signin` where it now resolves `[]`, and the engine's rules stay right.*
2. **A cloud that went backwards and was written again before a device noticed.** The device compares the head with its cursor; if the restored cloud has since passed the cursor, the numbers look fine and the device has silently parted from it. *Recommended: an `epoch` number per person in `db/0003`, returned as `e` by `rec_head()` and `rec_write()`, raised by hand for everyone after any restore; the engine keeps it in the meta row and treats a change of it as a change number gone backwards. Until then, a restore of the real project is followed by an instruction to every device, which with one learner is possible.* The adapter already passes on fields it does not know.
3. **Trying an unsent write again on a timer.** Thorne's rule is that nothing asks a server for data on a timer. The engine never does. But a write that failed for the network has to go out without waiting for the learner's next save. *Recommended: it is tried again on `joined`, on `syWake`, on the next save, and on a delay that doubles from 2 seconds to a minute, **only while the outbox is not empty**; a device with nothing to send calls nothing. This is sending, not asking.* If that is still too much timer, drop the delay: the other three cover every case but a server that answers 5xx while the socket stays up.
4. **How far an erase reaches.** As written the mark voids the day's counts, and the cards go as tombstones, one by one. The other design is a mark that voids *every* record stamped before it: one record, atomic, nothing to half-send. It was not chosen because it changes the merge of every kind and has no test behind it, and the simulation on `origin/users-sync` covers tombstones. *Recommended: as written for format 1; make the many-device simulation erase, and if it shows the half-sent erase to be a real nuisance, the wider mark is format 2.*
5. **The two times to live** (3 days for a sibling claim, 30 days for a snapshot's tombstone) are judgements, not measurements. They can be changed without harm before anything real is written, and only with a format change after.
6. **Sync off when IndexedDB fails, or carry on in memory?** The engine could go on syncing for the rest of the run without its store, and join again by merging at the next start. *Recommended: off, as written. It is one state to test instead of a second way of running; if a real iPhone shows the lost connection often, revisit with numbers.* Whether the reopen cures WebKit's lost connection has not been tried on a device.
7. **Old day records are never folded together, and there is no list of an account's devices.** Neither is needed yet. Folding would be a format change (the base is merged by the larger number, so it cannot simply be added to).
8. **`vp`, the voice picture, synced whole.** Two devices' microphones differ, and the later device's picture replaces the other's. *Recommended: leave it; the tone coach is to be measured first ([voice.md](voice.md), V4), and nothing larger is done to it before that.*
9. **The format can only go up, and one write raises it.** A device of the person's own, on a version that says `v: 32767`, would lock every older app out of that account until someone lowers it in SQL. Only the person's own signed-in devices can do it. (The test raises account b's by one every run.) *Recommended: leave it, and know the statement that fixes it.*
10. **A signed-out device's open socket** may go on hearing signals until its token's hour is up; not tested on the real service. What it hears is a number. The model assumes it does hear.
11. **The page size is the project's "max rows" setting**, 1,000 by default, and the engine reads "fewer than 1,000" as "the last page". A project set lower would look, page after page, like a device that has caught up; the cursor rule keeps that from losing anything, but such a device would only ever advance one short page per catch-up. `tools/dbtest.mjs` checks that the project cuts at exactly 1,000. *Keep that check in the rebuild steps of the project for real decks.*
12. **Where a branch's new files stand with the checker.** `js/sync-records.js`, `js/sync-supabase.js` and `js/account.js` are app files: the release check wants them named in `index.html`, and the review gate fingerprints them. On their branches nothing calls them. *Recommended: the gate is met once, at step 8, on the merged result; the three branches are held to their own tests and to `node tools/check.mjs`.*

## What is checked, and what is not

Checked:

- **The model against the real project.** `node tools/dbtest.mjs` and `node tools/dbtest.mjs --model` run the same checks through the same doors: every answer of `rec_write`, every refusal of a record and of a call, the head, reading after a number in pages, two devices at once, the limits, the flood, expiry, the format, signing out, the signal and forged signals. What only the real service can answer (token signatures, the HTTP doors beside `rec_write`, raw table writes) is left out of the model's run and listed by it.
- **The adapter's contract on the model**: the group "the adapter over the model" in the same file. Step 5 runs what can be staged of it on the real project.
- **The app's fields against the kinds**, by reading `js/*.js` on `main` at v65 (above).
- **The start-up order**, by reading `js/boot.js` and `js/core.js` on `main` at v65 (above).

Not checked, and to be said so wherever this is passed on:

- **No engine speaks this contract yet.** The engine on `origin/users-sync` is the Firebase-shaped one; its 53 tests and the 22 failing reproductions on `origin/review/users-sync` are 4b's starting point. The rules here for the generation number, the outbox, the erase mark, the clock that comes down and a device that takes a new id are designed and reasoned, not run.
- **The model's account of states the real test cannot reach**: an unconfirmed person who holds a session, a token past its hour, "sign out my other devices", a deleted account, a restored cloud. They follow the SQL as read.
- **IndexedDB on a real iPhone**, in the Home Screen app: room, speed, the lost connection.
- **Bytes and time** on a deck of the real size. The figures of the old notes (352 bytes written per review instead of 981 KB; a 290 KB shadow; 6 to 7 ms a save on a laptop) were measured against Firebase's shapes and are to be measured again by `tools/sync_numbers.js` once the engine is ported.

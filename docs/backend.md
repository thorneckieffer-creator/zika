# The backend: the record store on Supabase

What the database is, the protocol a device speaks to it, how it is tested and how to rebuild it. The decision behind it is the entry of 16 November 2026 in [decisions.md](decisions.md); the build order it belongs to is in [roadmap.md](roadmap.md#app) (this is step 3). What the app's side does with the protocol (the adapter, the cursor, the record format, what is kept on the device) is the contract in [sync.md](sync.md), written as step 4a. **Nothing in the app uses it yet.** The live app still syncs through the room code in Firebase ([architecture.md](architecture.md)).

| File | What |
|---|---|
| `db/0001_records.sql` | The table, its access rules, `rec_write()`, `rec_head()` and the signal. Migration `records`. |
| `db/0002_signed_in.sql` | Every door asks whether the session still exists (`private.me()`). Migration `signed_in`. |
| `tools/dbtest.mjs` | The store's promises and the attacks it must refuse, run against the real project, and against the model. |
| `tools/lib/recmodel.js` | [The model](#the-model): the two SQL files again in plain JavaScript, for tests that cannot have a database. |

The project is `zika-dev` (Supabase, free plan, Tokyo), made on 16 November 2026 for building and testing. It holds test accounts and nothing of anyone's. Real decks, Thorne's first, go in a second project made before the accounts release ([roadmap.md](roadmap.md#app), step 8), so that nobody's progress sits in the one this test fills and floods; it is built by running the files in `db/` in order on an empty project and setting what is listed under [Rebuilding](#rebuilding).

## The shape

A person owns **records**. A record is a key, a stamp and a value:

| Column | What |
|---|---|
| `owner` | The person (`auth.users`). Deleting the account deletes its records. |
| `k` | The key, `<kind>~<id>`: `c~w123:rec` is a card. One to three lower-case letters, a tilde, then the id. 3 to 512 bytes, no control characters. |
| `h` | The stamp, which decides which version is the later one. 13 decimal digits of milliseconds, 3 characters of counter (`0-9a-z`), then the device's id (1 to 47 of `0-9A-Za-z_-`). Compared byte by byte, as the app compares strings. |
| `j` | The value, a string, exactly as the app sent it. The database never looks inside. At most 65,536 bytes. Null when deleted. |
| `d` | The deleted mark. A deleted record keeps its stamp, so an older version cannot come back. |
| `n` | The change number: this is the owner's nth accepted version. |
| `at`, `x` | When the server took it; when the server may forget it (null: never). Not served to anyone. |

The record kinds, what each merges like, which of them carry a time to live and how a value is written are the engine's business: [sync.md](sync.md#record-format-1), record format 1.

The stamp's form is not the one the engine on `origin/users-sync` writes today (nine digits in base 36). The decimal form is what lets the database hold a stamp to its own clock, which the review asked for (F3, F-2 in [review-users-branches.md](review-users-branches.md)). The functions that make and compare it are in [sync.md](sync.md#the-stamp); the engine changes to it in step 4b.

## The protocol

A device does four things. All of them need a signed-in person whose email is confirmed and whose session still exists; there is no anonymous door. This section is what the database promises. What a device does with each answer (when its cursor moves, what it sends again, what it sets aside) is [sync.md](sync.md#the-adapter): the adapter's four functions are these four things, and its rules are written against the answers below.

**1. Ask for the head**: `rec_head()` answers `{now, n, v}`: the server's clock in milliseconds, the owner's last change number, and the newest record format that has written to the account (`n` and `v` are 0 for an account that has never written). A device asks this first, every time it connects: it learns what time it really is before it stamps anything, whether there is anything to fetch, and whether a newer app has written here.

**2. Read everything after a number**: `select k,h,j,d,n from rec where n > <the last number this device holds> order by n`. The server cuts any answer at 1,000 rows, so the device pages until a page comes back short. A person reads only their own rows; the owner, time and expiry columns are not served. **A read is the one door that does not say "you are signed out"**: the table's policy matches no row for a session that has ended, and the answer is an empty list with no error (seen on 21 November 2026). A device must therefore never take an empty page as proof of anything ([sync.md](sync.md#the-cursor)); a function that reads and refuses is proposed for `db/0003` ([sync.md](sync.md#open-points), point 1).

**3. Write**: `rec_write(v, recs)`, the only way a record changes. `v` is the record format the app speaks (1 today); `recs` is at most 1,000 of `{k, h, j}` or `{k, h, d: true}`, each optionally with `t`, the seconds after which the server may forget it (60 seconds to 400 days: for what the app itself forgets, such as sibling claims and old daily snapshots). The answer is `{now, n, r}`, with one entry in `r` per record sent, in order:

| Answer | Meaning | What the device does |
|---|---|---|
| `{"n": 124}` | Taken. This version is the owner's 124th change. | Marks it sent. |
| `{"n": 97, "same": true}` | Exactly this version is already stored (a batch sent twice). | Marks it sent. |
| `{"old": {h, j or d, n}}` | Not taken: the stored version is later, or has the same stamp and another value. Here it is. | Merges the stored version, as if it had arrived. |
| `{"no": "<why>"}` | Refused for its form: `shape`, `key`, `stamp`, `future` (more than five minutes ahead of the server), `size`, `ttl`, `full`. | Sets the record aside and reports it. Never sends it again as it is. |

One record's refusal does not hold up the others. What refuses the whole call comes back as an error: `rec:signin` (401), `rec:unconfirmed` (403), `rec:shape` and `rec:batch` (400), `rec:newer` (409: a newer app has written to this account, and this one must update before it writes; it can still read), `rec:slow` (429). A text the database cannot hold fails the whole call, good records with it, and the answer does not say which record it was: the character U+0000 (a 400 with code `22P05`), and half of a surrogate pair (a 400 with code `PGRST102`, refused by the data API before the function runs). Neither is a `rec:` error. The device keeps such a text out of a batch ([sync.md](sync.md#limits-checked-on-the-device)).

Everything one person writes passes through one lock, so their change numbers are given and committed in order with none missing. A device that holds 41 and is told 42 has missed nothing.

**4. Listen**: a private Realtime channel per person, `rec:<their id>`. When `rec_write()` takes anything it sends one message there, event `n`, carrying the new change number and nothing else. The device then reads everything after the number it holds (2). The records themselves never travel on the channel. Nobody can send on it: not another person, not a client that is not signed in, not the owner's own device.

**Nothing asks on a timer.** A device reads when it connects (1, then 2) and when the signal arrives.

### What the adapter must do, learnt from the real project

- **A refused join is tried again.** A project nobody has listened to for a few days has no place for the day's signals: the first join is refused with `MissingPartition`, Realtime then makes the place, and the next join is taken. Seen on 21 November 2026, five days after the previous run. A signal sent in between is gone.
- **So after every join, ask for the head once.** The same covers a phone that was asleep: when the socket comes back, one `rec_head()`, and a read if `n` has moved.
- **Page every read**, and treat a page of exactly 1,000 as not the last.
- **A token outlives its session nowhere.** Signing out, on this device or from another, stops the token at once on every door. A device that gets `rec:signin` says "signed out, sign in again" and sends nothing.

## The limits

In `rec_write()`, as constants at its top:

| Limit | Value | For scale |
|---|---|---|
| Records in one call | 1,000 | A whole deck goes up in about six calls |
| Bytes in one value | 65,536 | The largest real value is about 15 KB |
| A stamp ahead of the server | 5 minutes | |
| Rows one person may hold | 40,000 | A full deck is about 6,000 |
| Bytes one person may hold | 8 MB | A full deck is under 1 MB |
| Records one person may send in a minute | 30,000 | |

## The test

```bash
node tools/dbtest.mjs                    # the real project, everything: about three minutes
node tools/dbtest.mjs --model            # the model (below): a second
node tools/dbtest.mjs --quick            # without the waits: skips expiry, the full account and the flood
node tools/dbtest.mjs --only realtime    # the groups whose name contains the text
```

It speaks to the real project over the same three doors the app will use (the sign-in service, the data API, the Realtime socket), with no library. It covers: who may come in; the protocol above, answer by answer; a batch sent twice; two devices writing at once (numbers in one unbroken run); a whole deck up and down in pages; every reason a record or a call is refused; another person's records; getting round `rec_write()`; a client that is not signed in, and one that signed out and kept its token; the signal, and forged signals; a full account; a flood; a record's time to live; the record format.

**Last run, 21 November 2026: 97 checks, all passing** on the real project: the 93 of that morning's run (whose first try had failed the two signal checks on the cold start described above; the test joins again as the adapter must, and says when it had to), and four added with the contract: a whole batch sent again is answered `same` with its numbers; the last page of exactly 1,000 is followed by an empty one; half of a surrogate pair fails a call as U+0000 does; neither failure is one of `rec_write`'s own. On the model the same day: 122, all passing.

## The model

`tools/lib/recmodel.js` is the two SQL files again, as a model in plain JavaScript with no database, no network and a clock a test can move: `rec_write` with every answer and every refusal, `rec_head`, reading after a number with the cut at 1,000 rows, a person's change numbers, expiry, the record format, the limits and the flood, who is signed in, and the signal on a person's channel. It is the one stand-in for the cloud that the engine's tests, the accounts tests and the screen harness use ([sync.md](sync.md#who-owns-what)), in place of the Firebase-shaped one on `origin/users-sync`.

**It is held to the real project by the test.** `tools/dbtest.mjs` reaches whatever it tests through a few doors (sign in and out, the head, a write, a read, a channel), written once over HTTP and the socket and once over the model, and the checks do not know which they are speaking to. The model is right when the checks both runs share pass on both. **A change to the SQL is a change to the model in the same commit, with both runs green.**

| Run | Groups |
|---|---|
| Both | signing in · writing and reading · two devices writing at once · a whole deck · what one record can be refused for · what refuses the whole call · another person's records · a client that is not signed in · the realtime signal · an account that is full · a flood of writes · a record with a time to live · the record format |
| The real project only | getting round `rec_write` (raw inserts, updates and deletes on the table), and five single checks inside the shared groups: the project's sign-in settings, anonymous sign-up, the counters table, a token signed by someone else, a signal forged through the HTTP broadcast door. The model's run lists them as left out. |
| The model only | states only the model can stage (a person who is not confirmed and holds a session; a token past its hour; "sign out my other devices"; a call refused whole leaving nothing behind; a store put back to an earlier copy; a deleted account; expiry against a version sent twice), and the adapter over the model (the four functions of [sync.md](sync.md#the-adapter) and their typed errors). These are the model's own reading of the SQL, not checked against the service. |

It loads with `require()` in Node (the engine's tests are CommonJS) and as a plain `<script>` in a page, where it defines one global, `recModel`; it uses nothing a browser lacks.

```js
const recModel = require('./tools/lib/recmodel.js');
const M = recModel({ now: () => clock });           // the clock is the test's; M.advance(ms) moves the model's own on from it
const uid = M.addUser({ email: 'a@zika.invalid', password: 'pw' });
const s = M.session(uid);                           // or M.signIn(email, password), which answers as the sign-in door does
M.write(s.token, 1, [{ k: 'c~w1:rec', h: '1795680000000000dev1', j: '""' }]);   // → { status: 200, json: { now, n: 1, r: [{ n: 1 }] } }
const adapter = M.adapter(s.token);                 // head(), read(after), write(v, recs), listen(onSignal, onState)
```

What a test can stage with it is listed at the top of the file: a join refused the first time (`cold`), an answer lost on the way back (`lose`), a line that is down, a token past its hour, signals held back or dropped, a cloud put back to an earlier day.

It needs three accounts that exist only for it, read from a file kept **outside the repository**, `~/.config/zika/db-test.json` (or the path in `ZIKA_DB_TEST`):

```json
{ "url": "https://<project>.supabase.co", "key": "<the publishable key>",
  "a": {"email": "…", "password": "…"},
  "b": {"email": "…", "password": "…"},
  "c": {"email": "…", "password": "…"} }
```

`a` and `b` are confirmed accounts; `c` is one whose email was never confirmed. On `zika-dev` they were made by inserting three rows into `auth.users` and `auth.identities` through the SQL editor, with addresses under `zika.invalid` so that no mail is ever sent, passwords made at random on this Mac, and `email_confirmed_at` set for the first two only. On a new project, make them the same way and write the file. Their passwords are not in the repository, a commit message or these notes, and must not be.

What the test writes does not outlive it by long: every record carries a time to live, under a kind (`zt~`) the app never uses, and an account's expired rows are removed at its next write.

## Rebuilding

On an empty Supabase project:

1. Run `db/0001_records.sql`, then `db/0002_signed_in.sql`, as migrations named `records` and `signed_in`.
2. In the project's sign-in settings: email sign-in on, **confirm email on**, **anonymous sign-in off**. The test's first check reads these and fails if they are otherwise.
3. Make the three test accounts and run `node tools/dbtest.mjs` until it is green.

The two files are kept as two because that is what was applied, in that order. `0002` restates `rec_write()` and `rec_head()` whole.

## What Supabase's adviser says, and why it stands

Read on 21 November 2026:

- *Signed-in users can execute a `SECURITY DEFINER` function* (`rec_write`, `rec_head`): that is the design. The table grants no insert, update or delete to anyone; the function is the one way in, and it is the function that checks who is asking.
- *Row-level security on with no policy* (`private.rec_owner`): on purpose. Nobody reaches the counters through the API.
- *Leaked-password protection is off*: to be turned on in the project real learners use.

## Keys

The project's address and its publishable key are public by design and go in the code when the adapter is written (step 5), as the Firebase web config does today. The service-role key and the database password never go in the repository, the app or a commit message ([CLAUDE.md](../CLAUDE.md), rule 5).

## Not here yet

- The adapter (`sySupabase()`), the pinned client library, and a first run from a browser: step 5, against [sync.md](sync.md#the-adapter).
- The engine that speaks this protocol: `js/sync-records.js` on `origin/users-sync`, ported to the contract and with its review findings fixed: step 4b.
- Deleting an account: the rows go with the account (`on delete cascade`), but there is no function a signed-in person can call to do it yet (`db/0003`, step 7). The confirmation and reset emails (the built-in sender is for testing only) belong to steps 7 and 12.
- Proposed for the same `db/0003`, not applied: `rec_read()`, a read that refuses a signed-out caller and returns the head with the page; and an `epoch` number per person, raised by hand after a restore, so that a device can tell a cloud that went backwards even after it has been written past ([sync.md](sync.md#open-points), points 1 and 2). The engine can be built without either.
- Decided on 21 November with the contract: the day's counts stay one record per device per day, summed on the device ([sync.md](sync.md#the-days-counts)).

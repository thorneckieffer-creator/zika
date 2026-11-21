# The backend: the record store on Supabase

What the database is, the protocol a device speaks to it, how it is tested and how to rebuild it. The decision behind it is the entry of 16 November 2026 in [decisions.md](decisions.md); the build order it belongs to is in [roadmap.md](roadmap.md#app) (this is step 3). **Nothing in the app uses it yet.** The live app still syncs through the room code in Firebase ([architecture.md](architecture.md)).

| File | What |
|---|---|
| `db/0001_records.sql` | The table, its access rules, `rec_write()`, `rec_head()` and the signal. Migration `records`. |
| `db/0002_signed_in.sql` | Every door asks whether the session still exists (`private.me()`). Migration `signed_in`. |
| `tools/dbtest.mjs` | The store's promises and the attacks it must refuse, run against the real project. |

The project is `zika-dev` (Supabase, free plan, Tokyo), made on 16 November 2026 for building and testing. It holds test accounts and nothing of anyone's. Real learners get a separate project on a plan that does not pause ([roadmap.md](roadmap.md#app), step 12); it is built by running the files in `db/` in order on an empty project and setting what is listed under [Rebuilding](#rebuilding).

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

The record kinds, and what each merges like, are the engine's business and are described with it (`docs/sync.md` on `origin/users-sync`, to be brought to `main` with the engine).

The stamp's form is not the one the engine on `origin/users-sync` writes today (nine digits in base 36). The decimal form is what lets the database hold a stamp to its own clock, which the review asked for (F3, F-2 in [review-users-branches.md](review-users-branches.md)). The engine changes to it in step 4.

## The protocol

A device does four things. All of them need a signed-in person whose email is confirmed and whose session still exists; there is no anonymous door.

**1. Ask for the head**: `rec_head()` answers `{now, n, v}`: the server's clock in milliseconds, the owner's last change number, and the newest record format that has written to the account (`n` and `v` are 0 for an account that has never written). A device asks this first, every time it connects: it learns what time it really is before it stamps anything, whether there is anything to fetch, and whether a newer app has written here.

**2. Read everything after a number**: `select k,h,j,d,n from rec where n > <the last number this device holds> order by n`. The server cuts any answer at 1,000 rows, so the device pages until a page comes back short. A person reads only their own rows; the owner, time and expiry columns are not served.

**3. Write**: `rec_write(v, recs)`, the only way a record changes. `v` is the record format the app speaks (1 today); `recs` is at most 1,000 of `{k, h, j}` or `{k, h, d: true}`, each optionally with `t`, the seconds after which the server may forget it (60 seconds to 400 days: for what the app itself forgets, such as sibling claims and old daily snapshots). The answer is `{now, n, r}`, with one entry in `r` per record sent, in order:

| Answer | Meaning | What the device does |
|---|---|---|
| `{"n": 124}` | Taken. This version is the owner's 124th change. | Marks it sent. |
| `{"n": 97, "same": true}` | Exactly this version is already stored (a batch sent twice). | Marks it sent. |
| `{"old": {h, j or d, n}}` | Not taken: the stored version is later, or has the same stamp and another value. Here it is. | Merges the stored version, as if it had arrived. |
| `{"no": "<why>"}` | Refused for its form: `shape`, `key`, `stamp`, `future` (more than five minutes ahead of the server), `size`, `ttl`, `full`. | Sets the record aside and reports it. Never sends it again as it is. |

One record's refusal does not hold up the others. What refuses the whole call comes back as an error: `rec:signin` (401), `rec:unconfirmed` (403), `rec:shape` and `rec:batch` (400), `rec:newer` (409: a newer app has written to this account, and this one must update before it writes; it can still read), `rec:slow` (429). A value holding the character U+0000 fails the whole call, good records with it, so the device must keep such a value out of a batch.

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
node tools/dbtest.mjs                    # everything: about two and a half minutes
node tools/dbtest.mjs --quick            # without the waits: skips expiry, the full account and the flood
node tools/dbtest.mjs --only realtime    # the groups whose name contains the text
```

It speaks to the real project over the same three doors the app will use (the sign-in service, the data API, the Realtime socket), with no library. It covers: who may come in; the protocol above, answer by answer; two devices writing at once (numbers in one unbroken run); a whole deck up and down; every reason a record or a call is refused; another person's records; getting round `rec_write()`; a client that is not signed in, and one that signed out and kept its token; the signal, and forged signals; a full account; a flood; a record's time to live; the record format.

**Last run, 21 November 2026: 93 checks, all passing** (the first run that day failed the two signal checks on the cold start described above; the test now joins again as the adapter must, and says when it had to).

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

- The adapter (`sySupabase()`), the pinned client library, and a first run from a browser: step 5.
- The engine that speaks this protocol: `js/sync-records.js` on `origin/users-sync`, with its review findings to fix first: step 4.
- Deleting an account and its rows from the app; the confirmation and reset emails (the built-in sender is for testing only): steps 7 and 12.
- Not decided, because it needs the engine in front of it: whether the day's counts stay one record per device, summed on the device, or become rows the database sums.

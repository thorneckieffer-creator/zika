# Handoff — 22 November 2026

Read [master-plan.md](master-plan.md) first; this file says where its "Order of work" stands. Replace it at the end of each session.

**v66 and v67 are live** (pushed on 22 November on Thorne's "yes to both"; `main` on GitHub at `2ef1bd9`; after each push the site's `sw.js` and the changed scripts were byte for byte the local ones). The tag `single-user-v65` and the branch `archive/single-user` are on GitHub too. Anything committed after `2ef1bd9` is local and waits for a yes of its own, as before.

Not tested by anyone, still: real Safari, an iPhone or iPad, touch, sound by ear. Thorne's report from his devices is the open item.

## Where each piece of work is

| Order of work | State | Where |
|---|---|---|
| 1–3 notes, archive, cleanup | done 21 November | `main` |
| 4 v66 | **released 22 November** (checker PASS on its second pass) | `main` |
| 5 Voice V0, V1 (tools) | done as far as tools go; no V1 winner | `main` |
| 6 backend 4a, the contract | done | `main` (`docs/sync.md`, `tools/lib/recmodel.js`) |
| 6 backend 4b, the engine | done 22 November; its first real run was stopped part-way (below) | branch `engine`, worktree `.claude/worktrees/engine` |
| 6 backend 5, the adapter | done 22 November; no client library | merged into `engine` (`e4529e8`); the branch `backend` is contained in it |
| 6 backend 6, **v67** "ready the app" | **released 22 November** (checker PASS on its first pass); its worktree and branch are removed | `main` |
| 7 the 7 November merge | the tool is written and self-tested (`tools/merge_deck.mjs`); **the file has not been found** | `main` |
| 8 the rest of the backend, Voice V2 | from 8 December | — |

`engine` cannot go to `main` yet: it adds two files under `js/` that the page does not load, which fails the release check until the accounts release wires them in (step 8). It was cut before v67, so it takes `main` in (a merge, notes and v67's files) before its next piece of work.

## Stopped part-way: the engine's first real run

Stopped at Thorne's word on 22 November, and committed where it stood, on `engine`:

| Commit | What | Tests when committed |
|---|---|---|
| `26a2a97` | One model of the database instead of two: the tests' cloud uses the model's own epoch and refusing read | green |
| `b2b42d7` | **The first run against the real database**: `tools/enginetest.mjs` takes two engines through the real adapter to `zika-dev` as two devices of one person | green |
| `e973234` | **Two devices with one id, made exact**: a device's share of a day is kept and sent by run of the app | green |
| `196801c` | WIP: the engine's store against real IndexedDB in headless Chrome (`tools/enginetest.mjs --store`) | its own message says where it stood |
| `b61bf46` | **WIP, not in a known-good state**: erase brought into the simulation, `tools/sync_numbers.js` ported, notes begun. 128 of 129 tests pass; **the simulation (300 seeds) fails**. The database model's 154 checks pass. | one failing |

The helper was stopped before it reported, so its own account of the real run, of what it decided about the shared id, and of what rows it left in `zika-dev` was never written. Read the messages of those commits (`git log -5 --format=%B b61bf46`) and `docs/sync.md` on that branch before continuing. First thing to do there: `node --test tools/test/*.test.js`, find why the simulation fails (the erase oracle is the newest thing in it), and either finish it or take it back out.

## The next steps

1. Thorne's word on how v66 and v67 behave on his devices; fix what he reports first.
2. `engine`: merge `main` in; get the tests green again (above); then what the stopped run had left: the store in a real browser, the two-page exchange, the numbers in `docs/sync.md`. Check what the run left in `zika-dev` under the test accounts.
3. Until 1 December nothing else in the backend is due. Unblocked and useful: the repairs the checker listed on the roadmap, as one small release (Today's greeting among them).
4. From 8 December: the accounts module (step 7), the independent break-it review of engine, adapter and accounts (7b), the accounts release v68. Two things for step 8 found on the way: a device-local mark so a My word's id is never handed out twice after an import; the real-decks project, without which the adapter refuses at the live address.

## Questions for Thorne

1. **How do v66 and v67 behave on the iPhone and iPad?** Open the app twice on each (the first open fetches the release, the second runs it); Settings shows the version at the bottom.
2. **The 7 November backup is not where it was said to be.** The backup folder is in the work Google account (thornek@archsolar.net); its trash is the one place not yet looked in, and only he can open it. Nothing else holds a copy: not the personal account's trash, not the current file's history (one version), not this Mac. Where did the note about that file come from?
3. **Read the drill's sentences**: `~/Desktop/zika-which-pattern-list.txt`, all 222 with the answer filled in. Mark any where another choice also fits. Least sure: 趟／遍／次／下 and 其他／別的／另外.
4. **Voice V1** needs an Azure key (the full set costs under $8), a yes to the other 53 ElevenLabs test words (106 free credits), and the listening session: `node tools/voice_audit.mjs serve` in the main folder, then `http://127.0.0.1:8791/tools/voice_listen.html?set=v0` and `?set=v1`.
5. **Thirteen words have two readings on file** (背包, 暑假, 天分, 只要, 古蹟, 待, 除了, 為了, 瓶子, 剛剛, 餓死了, 一會兒, 餡兒): which is right for each?

## What to know

- **Decisions made on 22 November** are in [decisions.md](decisions.md): the adapter speaks to Supabase by hand, with no client library, and makes one request by a timer, once per join; the engine's record format gained one field; what is not right yet in the engine.
- **The room-code sync still swaps whole decks**, so a device with unsent changes can still put an older deck over a newer one ([roadmap.md](roadmap.md), "The 7 November backup file"). If a deck is ever imported: sync and close the iPad and iPhone first, import on the Mac, then open them one at a time; if asked, **Use theirs**.
- **The tone coach does not grade against the clip**; the master plan says it does ([voice.md](voice.md#v0--what-the-audit-found)).
- **The Mac is short of memory** (swap about 22 of 23.5 GB all day). One browser job at a time; a harness run takes about seven minutes.
- **`zika-dev`** now has four migrations (`records`, `signed_in`, `read_epoch_delete`, `signal`, then `signal_event`) and was last used on 22 November. `node tools/dbtest.mjs` on the `engine` branch is the test that matches it (125 checks); the copy on `main` is older and expects the database before `db/0003`.
- Files outside the repository: `~/Desktop/zika-archive/`, `~/Desktop/zika-which-pattern-list.txt`, `~/.cache/zika-voice/audit/` and `v1/`, recordings in `~/.cache/zika-snap/`.

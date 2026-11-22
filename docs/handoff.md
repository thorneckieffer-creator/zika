# Handoff — 22 November 2026

Read [master-plan.md](master-plan.md) first; this file says where its "Order of work" stands. Replace it at the end of each session.

**Nothing has been pushed since the no-push rule of 21 November.** `main` is ahead of GitHub by everything below (`git log origin/main..main`). The branch `backend` is on GitHub at `33ea621` from before the rule.

## Waiting for Thorne's yes to push

| What | Tested | Checker |
|---|---|---|
| **v66**, the drill 句型 "Which pattern?" (`main`; app files as of `1277d75`, fingerprint `172ec434b4f3`). 25 pairs, 222 sentences, in place of the old "Which one?" drill. | Release check, pairs check, the harness (only the intended screens differ), every sentence of every pair answered once, phone, tablet and iPad landscape, day and night | **PASS** on its second pass, 22 November. The first pass failed it on eleven points; all are fixed. |
| **v67**, "ready the app" (branch `ready`, worktree `.claude/worktrees/ready`; app files as of `711665e`, fingerprint `465bebb4611b`). Groundwork with the room-code sync untouched: My-words ids that include the device, a banner when the browser refuses to save, the Brain's snapshot found by date, one tone-coach marker, a manual export named with its date and device (the automatic backup is still `zika-progress.json`), and the **Sounds wrong** button beside the speaker, with its list in Settings → Audio. | Release check; the harness (the move alone identical to v66 in all 509 steps; every later difference accounted for); the upgrade test from v66 with a deck, a sync code and stored audio (22 checks); three sizes, day and night | **PASS** on its first pass, 22 November. Its verdict is recorded in that worktree, so v67 is pushed from there (`git push origin ready:main`), after v66. |
| The tag `single-user-v65` and the branch `archive/single-user` (both at `7d26dc5`) | The zip of the same commit opens on a local port and is v65 | not needed |

Pushing `main` releases v66 and carries every notes and tools commit since v65. `ready` holds `main` plus v67, so pushing it afterwards releases v67; pushing only `ready` would take the devices from v65 straight to v67, which the checker also tried (a v65 deck opens in v67 unchanged). Not tested by anyone: real Safari, an iPhone or iPad, touch, sound by ear.

## Where each piece of work is

| Order of work | State | Where |
|---|---|---|
| 1–3 notes, archive, cleanup | done 21 November | `main` |
| 4 v66 | built, checker PASS, waiting for a yes | `main` |
| 5 Voice V0, V1 (tools) | done as far as tools go; no V1 winner | `main` |
| 6 backend 4a, the contract | done | `main` (`docs/sync.md`, `tools/lib/recmodel.js`) |
| 6 backend 4b, the engine | done 22 November; one weakness left (two devices sharing a device id), being worked on | branch `engine`, worktree `.claude/worktrees/engine` |
| 6 backend 5, the adapter | done 22 November; no client library | merged into `engine` (`e4529e8`); the branch `backend` is contained in it |
| 6 backend 6, **v67** "ready the app" | built 22 November (`711665e`), checker PASS, waiting for a yes | branch `ready`, worktree `.claude/worktrees/ready` |
| 7 the 7 November merge | the tool is written and self-tested (`tools/merge_deck.mjs`); **the file has not been found** | `main` |
| 8 the rest of the backend, Voice V2 | from 8 December | — |

`engine` and `ready` cannot go to `main` yet. `engine` adds two files under `js/` that the page does not load, which fails the release check until the accounts release wires them in (step 8). `ready` is v67 and follows v66.

## Running when this was written

- **The engine's first real run**, in `.claude/worktrees/engine`: one model instead of two, the engine through the adapter against `zika-dev` with a deck of real size, its store in a real browser's IndexedDB, the shared-device-id weakness, erase in the simulation, real numbers.

If it had not reported before the session ended, look at that folder's `git log` and `git status` first.

## The next steps

1. When Thorne says yes: push `main` (v66) with the tag and the archive branch, check the live copy is the one pushed, then v67 from `ready` when he says yes to that. After v67 is on `main`, remove the `ready` worktree.
2. The engine's real run: read its report into `docs/decisions.md` and the roadmap.
3. Then, until 1 December: nothing else in the backend is due (the master plan gives 4b, 5 and 6 until 30 November, and the rest starts on 8 December). Useful and unblocked: the repairs the checker listed on the roadmap as a small release; the Taiwan-wording scan for Voice V2 (`tools/check_register.py`, tools only).
4. From 8 December: the accounts module (step 7), the independent break-it review of engine, adapter and accounts (7b), the accounts release v68.

## Questions for Thorne

1. **Yes or no to pushing v66** (and the archive tag and branch), **and to v67** after it.
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

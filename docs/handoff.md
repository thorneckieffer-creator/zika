# Handoff — night of 21 November 2026

Written at 23:25 when Thorne said to stop for the night. Read [master-plan.md](master-plan.md) first; this file says where its "Order of work" stands. Replace this file at the end of the next session.

**Nothing is uncommitted, in any folder. Nothing was pushed after the no-push rule was given.** `main` is 12 commits ahead of GitHub.

One thing was pushed earlier the same evening, before the rule existed: the branch `backend`, twice (`f9f7158`, then `33ea621`). It is on GitHub at `33ea621`. It holds notes, SQL and a test; no app file.

## Done tonight

| Order of work | What | Commit |
|---|---|---|
| — | The database work of 16 November saved: `db/`, `tools/dbtest.mjs`, `docs/backend.md`; the roadmap's build order | `f9f7158`, `33ea621` |
| 1 | The master plan and the notes brought into line with it; no push without a yes | `8b71ed9` |
| 1 | "Toward a real product" folded in: the address rule (rule 7 in `CLAUDE.md`), step 12's list, `docs/costs.md` | `4107abc`, `542f3d1` |
| 2 | The archive: tag `single-user-v65` and branch `archive/single-user` on `7d26dc5` (local only); `~/Desktop/zika-archive/zika-v65-single-user.zip` with a `README.txt`. Opened on a local port: it is v65 and starts. | no commit: a tag, a branch, a zip |
| 3 | Cleanup: eight worktrees pruned (five `agent-*`, `app`, `dev`, `usage`) and their eight merged branches deleted. All were clean but for three throw-away files; two of them are kept in `~/Desktop/zika-archive/worktree-leftovers/`. | no commit |
| 4 | **v66, the "which pattern?" drill**: 24 pairs, 215 sentences, in place of the old "Which one?" drill | `ca44542` |
| 5 | Voice V0 and V1, tools only (by an agent, merged) | `24c42f7`, `a841c39`, merge `f0a0713` |
| 6 | Backend 4a, the contract: `docs/sync.md`, `tools/lib/recmodel.js`, the test run against both (by an agent, merged) | `5df9099`, merge `a9ea342` |
| — | The decisions of 4a and the findings of V0 written into `decisions.md`, `costs.md`, `CLAUDE.md` | `e5a9b32` |
| — | This file, and three entries I had dated the 22nd put back to the 21st | this commit |

## Half-done

**Nothing is half-written on disk.** Three agents were running when the stop came and were stopped:

| What | Branch | State |
|---|---|---|
| The independent check of v66 (`verify-app`) | `main` | **Stopped after a few minutes. No verdict.** It had served the folder and opened the app; it recorded nothing. `.claude/review/` (git-ignored) holds its probe file and the old v65 report. |
| Backend 4b, the engine port | `engine` (worktree `.claude/worktrees/engine`) | Stopped two minutes in, while still reading. It wrote nothing: the branch equals `main`. |
| Backend 5, the adapter and `db/0003` | `backend` (worktree `.claude/worktrees/backend`) | Stopped two minutes in. It wrote nothing and applied nothing: `zika-dev` still has only the migrations `records` and `signed_in`. The branch equals `main`. |

So there is no WIP commit: there was no work in progress to save.

## The next step, exactly

1. **Run the `verify-app` checker on v66** in the main folder (`ca44542`; fingerprint `a7c43de1b132`). Tell it: the drill 句型 "Which pattern?" was added and replaces "辨析 Which one?"; tallies in `S.cf` must carry over; no new field in the deck; choice-button text takes the ink colour; check phone, tablet and iPad landscape, day and night, and an upgrade from v65 with a deck. It takes 30 to 60 minutes. On a FAIL, fix and run again.
2. **Start backend 4b again** in `.claude/worktrees/engine`: bring `js/sync-records.js` and its tests over from `origin/users-sync` and the reproductions from `origin/review/users-sync`; port to the protocol in [sync.md](sync.md) first and alone, with the list of failing reproductions recorded; then F10+F1+F5, F3, F2, F4, F7, F6, F8, F9; then the strict simulation. It owns `js/sync-records.js`, `tools/test/` and small corrections to `docs/sync.md`.
3. **Start backend 5 again** in `.claude/worktrees/backend`: `db/0003` (`rec_read`, an `epoch` per person, `account_delete`) applied to `zika-dev` with its checks in the test and the model; then `js/sync-supabase.js` to the contract; then `tools/adaptertest.mjs` from Node and two real browsers.
4. **v67, "ready the app"** (step 6), in a worktree from `main`, only once v66 has its PASS. It takes the "sounds wrong" button of Voice V0, which did not go into v66.
5. Steps 2 and 3 can run side by side. Keep to one browser job at a time: see "The Mac" below.

## Ready for a yes to push

| What | Tested | Checker | Ready? |
|---|---|---|---|
| The tag `single-user-v65` and the branch `archive/single-user` | Both point at `7d26dc5`; the zip opens and is v65 | not needed: no file changes | **Yes** |
| **v66** (`main`, which also carries every notes and tools commit above) | `node tools/check.mjs` passes. `python3 tools/check_pairs.py` passes. The harness, against v65's code labelled 66, differs only in the Drill menu, the Grammar tab's "Which one?" buttons, the drill's own screens and the colour of choice text. Driven in headless Chrome at 390 × 844, 820 × 1180 and 1180 × 820, day and night: no error, no sideways scroll, a double tap grades once, keys 1–4, Enter and Escape work, no key reaches the drill under the dictionary sheet. | **None. The check was stopped part-way.** | **No, not until the checker has passed it**, or Thorne says to push without it. Not tested by anyone: real Safari, an iPhone or iPad. |

`main` cannot be pushed without v66 going live: the notes and tools commits sit on top of it. If the notes should reach GitHub before v66 is checked, say so and they can go on a branch.

## Questions for Thorne

1. **Read the drill's sentences.** `~/Desktop/zika-which-pattern-list.txt` lists all 215 with the answer filled in. A tool cannot tell whether two choices both fit a sentence; only a reader can. Mark any where the "wrong" choice is also right. Two pairs I am least sure of: 趟／遍／次／下 and 其他／別的／另外, where your test separates one choice cleanly and the others lean on the English.
2. **Five of your older sentences were reworded** because they used characters the course does not teach (抽菸 → 拍照, 聰明 → 高, and three more). Say if you want the originals back; the sentence would then wait until its characters are taught, which for those is never.
3. **Voice V1 needs three things from you to produce a winner**: an Azure key (a Speech resource on the paid tier; the whole set costs under $8, the 62 test words under $1); a yes to the other 53 ElevenLabs test words (106 free credits; its free queue refused them tonight); and the listening session with your girlfriend. The pages: `node tools/voice_audit.mjs serve` in the main folder, then `http://127.0.0.1:8791/tools/voice_listen.html?set=v0` and `?set=v1`.
4. **Thirteen words have one reading in the 注音 file and another in the course's pinyin** (背包, 暑假, 天分, 只要, 古蹟, 待, 除了, 為了, 瓶子, 剛剛, 餓死了, 一會兒, 餡兒). Which is right for each, before a voice is pinned to it?
5. Still open from the master plan: restoring the 7 November `zika-progress.json` from Drive's trash before about 7 December.

## What to know before the next session

- **The tone coach does not grade against the clip.** The audit found its verdict is its own classifier against the tone the word should have; the clip is only drawn. The master plan says it compares with the clip. A wrong clip teaches a wrong sound but does not mark a right tone wrong ([decisions.md](decisions.md), 21 November; [voice.md](voice.md#v0--what-the-audit-found)).
- **V0's numbers cannot yet name a bad clip.** The analysis disagrees with 13.5% of 曉臻's syllables and 26.3% of 雲哲's, and is itself wrong 12 to 15% of the time on people saying the tones right. The one thing that stands out is 雲哲's one-character clips: 207 first tones measured as falling.
- **The Mac was short of memory all evening**: swap was 23.2 of 23.5 GB at 23:10. BreezyVoice was not run for that reason. One harness run takes about seven minutes; do not run two at once.
- **`zika-dev` was last used at about 23:00 on 21 November.** It pauses after about a week idle; `node tools/dbtest.mjs` wakes it (97 checks; `--model` runs 122 against the model).
- **Port 8765 on this Mac belongs to another project.** The archive's README names another port.
- Stopped before finishing: caffeinate was not running; the checker's local server on port 8793 was stopped. If a browser tab is still open at `127.0.0.1:8793`, it is the checker's and can be closed.
- Files made outside the repository tonight: `~/Desktop/zika-archive/`, `~/Desktop/zika-which-pattern-list.txt`, `~/.cache/zika-voice/audit/` and `~/.cache/zika-voice/v1/` (the audit's tables and the listening sets), recordings in `~/.cache/zika-snap/zika/`. On the ElevenLabs account: one flow with nine clips and two empty ones.

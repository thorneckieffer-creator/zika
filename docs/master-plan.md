# 字卡 master plan — read this first

Written 21 November 2026 for Thorne, as the brief every session reads before working. It merges two plans:

- the developer's plan of 21 November, as committed on `backend` at `33ea621` (`docs/roadmap.md`, `docs/decisions.md`, `docs/backend.md`) and in `~/.claude/plans/based-off-of-what-tingly-lollipop-…md`;
- Thorne's changes from the same evening, which that plan does not yet carry: the archive of the single-user version, the corrected "which pattern?" drill, the backup file's name, a check before the 7 November merge, and the Voice section.

**Where this file and the roadmap disagree, this file wins.** The first commit brings `docs/roadmap.md`, `docs/decisions.md`, `docs/voice.md` and `CLAUDE.md` into line with it. The roadmap stays the detailed build order for the backend; this file does not repeat what the roadmap already says correctly.

## How to work

- **Proceed without asking.** Edits, new files, local commits, branches, worktrees, tests, local servers, browser checks, the Supabase test project `zika-dev`, the ElevenLabs connector for the Voice V1 test, reading Drive: all of it, without check-ins. Make the call, write it in `docs/decisions.md`, and keep going.
- **Do not push to GitHub without asking.** No `git push` of any branch or tag, to any remote, until Thorne says yes in chat. When something is ready, stop and say: what it is, the version number, what was tested, and "ready to push". Commit locally in the meantime and carry on with the next item. This replaces the line in `CLAUDE.md` that says to push once work reaches a good point; change that line in the first commit.
- **Still stop and ask for these two**, because they cannot be undone or they cost money: (1) deleting data that cannot be got back — the Firebase room, a Supabase project, any row of Thorne's real deck, anything on his devices; applying the merged deck or moving his deck; (2) spending money — a paid plan, ElevenLabs credits beyond the V1 test, an Azure resource.
- **Report briefly.** When a step finishes, a few lines: what changed, what was tested, what is next. No questions unless one of the stops above applies.

## Two lines of code, and an archive of what works today

Thorne's study app stays on `main`. The multi-user work already lives apart from it: `backend`, the `engine` and `accounts` worktrees, and `users-sync` / `users-accounts` with their review branches. Nothing of it reaches `main` before v68. So the "new line of code for the multi-user base" exists already; the job is to keep it that way and to archive today's working version before anything changes.

1. **Tag today's live app**: an annotated tag `single-user-v65` on the commit that is live now (`7d26dc5`, v65), and a branch `archive/single-user` at the same commit. Never move or delete either. Pushed with the next push Thorne approves.
2. **A zip of the site as it is served** (every file Pages serves at v65) in `~/Desktop/zika-archive/zika-v65-single-user.zip`, outside the repository, with a short `README.txt` beside it saying what it is and the commit it came from.
3. **Never serve an archived copy from the live address.** A copy under `thorneckieffer-creator.github.io` shares the browser storage key `shida_b1_fsrs_v2` and the room sync with the real app, and could overwrite the deck. To look at the old version, open the zip on this Mac on a local port.
4. **Tag again before each release that changes how the deck is stored or synced**: `single-user-final` on the last commit before v68 (accounts), and one before v69 (the room code removed).
5. **One codebase, not two apps.** A separate product (another name, no publisher wording) is a decision for step 12 of the backend, not now.

## Where things stand (21 November)

- **v65 is live** (the dictionary) and passed the checker. No branch holds unreleased app work.
- **The database (step 3) is done and saved**: `backend` at `33ea621`, 93 of 93 checks against `zika-dev`. After a few idle days Supabase refuses the first join to a channel; the adapter joins again and asks for the head once.
- **The developer's check of the build order found** (already in the roadmap on `backend`): a second Supabase project for real decks before v68, so Thorne's deck never lands in the test project; signing in removes the room code from the device, so a later sign-out cannot let the old sync take the room's older copy; `db/0003 account_delete()` is missing and comes with the accounts module; every copy holding a deck is listed before the move (on iPad and iPhone the Home Screen app and any Safari tab keep separate storage); the move happens in one sitting; an old Safari copy is replaced, not merged.
- **The audio is wrong too often to trust.** Thorne hears the wrong tone about a third of the time (3rd for 1st, 2nd for 4th). Not yet known whether the clip plays it wrong, the tone coach grades him wrong, or both. The Voice section fixes them together.
- **Releases**: v66 the drill, v67 "ready the app", v68 accounts, v69 the room code removed. The Voice V2 release takes the next free number when it is ready.

## Dates

| Date | What |
|---|---|
| about 23 November | `zika-dev` pauses if nothing uses it |
| 27 November | v66, the "which pattern?" drill, ready to push |
| 30 November | v67 ready to push; the engine ported onto the database protocol; the adapter talking to `zika-dev`; Voice V0 and V1 done (tools only) |
| 1 December | Thorne's new term starts |
| 1–7 December | Backend steps not finished pause |
| about 7 December | The 7 November `zika-progress.json` leaves Drive's trash for good |
| week of 8 December | Backend resumes; Voice V2 (rebuilt packs) ready to push |

## Order of work

Top to bottom. Items marked *parallel* can run in their own worktrees at the same time.

1. **Notes to `main`** (one local commit, no release): the `backend` notes; this file as `docs/master-plan.md`; `docs/roadmap.md`, `docs/decisions.md`, `docs/voice.md` changed to match it; `CLAUDE.md`'s push line changed as above.
2. **The archive**: tag, branch and zip, as above.
3. **Cleanup**: delete the local branches fully merged into `main` (`app`, `dev`, `usage`, the five `worktree-agent-*`); then prune those worktrees after listing anything uncommitted (`agent-aab6d95217983788c` has an untracked `.claude/` folder: list it first). `next` and `backend` stay. From now on, prune each step's worktree when its step is merged.
4. **v66, the drill, as corrected below.** Ready to push by 27 November.
5. *parallel* **Voice V0 and V1** (tools only), done by 30 November.
6. *parallel* **Backend 4a** (the contract), then **4b**, **5** and **6 (v67)** side by side, as the roadmap on `backend` says.
7. **The 7 November merge**, as soon as Thorne has restored the file, with the extra check below.
8. From 8 December: the rest of the backend in the roadmap's order (7, 7b, 8, 9, 10, 11), Voice V2, then V3 and V4 as the speaker is ready.

## v66 — the "which pattern?" drill (corrected)

The roadmap on `backend` describes it as "a sentence from the course's grammar examples, four patterns to choose from". **That tests recognising, and it can be answered by spotting the keyword**: if 才 is in the sentence, pick 才. Thorne's weak point is choosing between patterns that both look like they fit, which is what MTC tests. So the sentence has a blank:

- Not this: 他十點**才**來。 Which pattern? → he sees 才 and picks it.
- This: 他十點___來。 就 / 才 → he has to know that "later than expected" is 才.

- **A card**: a course example sentence with the marker word blanked; the patterns of one pair as the choices (2–4). The answer side shows the right word, **the one-line test that decides it**, and a minimal pair: the same frame with the other choice used correctly (搬到樓上 vs 放在樓上). Characters tappable for the dictionary.
- **Content**: the pairs and tests in the appendix, from Thorne's teacher-checked notes, stored as a data file in `tools/content/` so pairs can be added without code. Sentences come from `GRAMMAR` by blanking the marker; where a pair has too few, new ones are written: original, only characters learned by that lesson (`check_usage.py`), Taiwan wording, plain English, no linguistics terms.
- **Unchanged from the developer's plan**: `wp*` functions in `js/grammar.js`; `DMODES` and `DRILL_SCREENS`; scope by book and by lesson range; tallies with `gMark`/`gStat` on the grammar points the pair joins, so **no new field in the deck**; `tgtIn` keeps out a wrong choice that also fits; `dcZh` on the answer side only.
- **Checked**: every sentence has exactly one choice that fits, listed so Thorne can read the list; every sentence passes `check_usage.py`; phone, tablet and iPad landscape; the checker's PASS.
- **If it is small**, the "sounds wrong" button from Voice V0 rides along; otherwise it goes in v67.

## The backup file keeps its name

The automatic backup file is always `zika-progress.json`. Thorne's nightly Notion job finds it in Drive by that exact name. Only manual exports get device-and-date names (`zika-progress-2026-12-14-iPhone.json`), as step 6 (v67) plans. Add this to step 6 in the roadmap and to `docs/decisions.md`.

## The 7 November merge — one check first

The roadmap's merge (compare, merge on copies by rule, show the counts, apply on the Mac) stands. Before applying it:

1. **Say plainly what the room-code sync does today when a device holding older unsent changes reconnects after an import**, and whether the clash behind the three rollbacks (seen 8, 11 and 14 November) is fixed or only less likely.
2. **Import with the iPad and iPhone closed.** Then Thorne opens them one at a time and compares counts with the Mac before studying on either.

## Voice — one answer key for the clips and the tone coach

**Why these go together.** The tone coach grades Thorne by comparing his pitch with the native clip. A clip with the wrong tone teaches the wrong sound and marks his correct tone as wrong. The goal is one verified native recording for every word, character and phrase, used for listening and as the coach's reference.

**How it fits the rest.** Voice packs are static files, not database records: none of this touches the engine, the adapter or accounts, so it runs beside the backend. Where it meets the plan: the "sounds wrong" log is kept on the device, outside the deck (no synced field); v66's answer side plays phrase clips once V2 ships; a licensed rebuild and a speaker's written agreement close step 12's voice-rights item; the personal cloned voice stays on the device only. API keys (Azure, ElevenLabs) live in `~/.config/zika/`, never in the repository.

| # | Step | Done when |
|---|---|---|
| V0 | **Find out what is wrong, before changing anything** (tools only). Run the app's own tone analysis over every clip in both packs (曉臻, 雲哲) against the expected tones (`readings.json`'s 注音 plus sandhi); list every clip whose measured tones disagree. Pick 40 flagged and 20 unflagged clips for Thorne and his girlfriend to mark right or wrong by ear. Add a **"sounds wrong"** action on the speaker button that logs the word and the voice, kept on the device, with a "copy list" button. | a table: the clips' real error rate, and how often the analysis agrees with a native ear. By 30 Nov |
| V1 | **Side-by-side test on about 60 hard words**: Taiwan readings (星期 xīngqí, 垃圾 lèsè, 和 hàn, 企業 qìyè), the heteronyms (得, 了, 當, 行), third-tone sandhi, the tone pairs Thorne misses most. Four sources: (a) the current packs; (b) **Azure Speech, licensed**, the same zh-TW voices, each syllable pinned with SSML `<phoneme alphabet="sapi" ph="…">` from `readings.json`'s 注音; (c) **ElevenLabs'** best Mandarin voice, through the connector; (d) BreezyVoice. Scored by `tone_lab` and by Thorne's girlfriend listening blind. Report each source's cost for the full set (words, characters, all usage phrases). | a winner by both scores, with its cost. By 30 Nov |
| V2 | **Rebuild from the winner**: every word, every character, a per-reading clip for each heteronym (`字@pinyin`), and **a new pack for the usage phrases** (system voice today). Covers the 338 words 曉臻 lacks. `ASSETS` bumped; old packs kept until the new one is checked on all three devices. **Before the phrases are recorded**, run a Taiwan-wording scan over the usage phrases, stories and grammar examples (`tools/check_register.py`: 視頻, 信息, 軟件, 出租車, 自行車, 地鐵, 摩托車, 網絡, erhua 兒 …), flagged for review, never replaced automatically, so no mainland wording gets a native recording. | V0's check on the new pack, and a native ear on a fresh sample of 60, find no wrong clip. Week of 8 Dec |
| V3 | **Human recordings as the answer key.** A Taiwanese speaker (Thorne's girlfriend if she agrees in writing, otherwise a paid speaker) records every word on a recorder page like `voice.html`, in short sessions. Three uses: a "native recording" choice when listening; the tone coach's reference; human voices for `tone_lab`. A male speaker later. Estimate the session time first. | every course word recorded and checked, in a pack with the same layout |
| V4 | **The tone coach, measured on a learner.** Re-measure on the human set. Then Thorne records about 100 words, his girlfriend labels the tones he said, and the coach's grades are compared with hers. Add a **"not sure"** verdict and grade only when confident; the pitch curve shows either way. Nothing larger on the coach before this. | agreement with a native ear on Thorne's own voice, as a number |

## Waiting on Thorne

1. **Restore the 7 November `zika-progress.json`** (244,791 bytes) from Drive's trash before about 7 December.
2. **Say yes to each push** when one is ready.
3. **When a tone sounds wrong**, note the word and whether it was the speaker or the coach's grade.
4. **Ask his girlfriend** whether she will record (V3) and agrees in writing to her voice being used in the app, including for other learners later.
5. **One listening session (about 30 minutes)** with her for V0 and V1.
6. **An Azure account with a Speech resource**, if V1 picks Azure.
7. Later: a dated backup from each device, the three-device check after the move, the tone coach verdict (now V4), Book 3 volumes 009 and 010 in the DangDai app, how v63–v65 behave on the real iPhone and iPad, and before anyone outside: the paid Supabase project, a mail service, the rights questions.

## Decisions to add to `docs/decisions.md` (21 November)

- Today's working app is archived before anything changes: tag `single-user-v65`, branch `archive/single-user`, a zip outside the repository. No archived copy is ever served from the live address. The multi-user work stays off `main` until v68; one codebase, not two apps.
- No push to GitHub without Thorne's yes. Everything else proceeds without asking, except deleting unrecoverable data and spending money.
- The "which pattern?" drill is a choice between competing patterns with the blank in the sentence, built from Thorne's pairs and tests, not recognition of a finished sentence.
- The automatic backup file is always named `zika-progress.json`; device-and-date names are for manual exports only.
- Before the 7 November merge is applied, the room sync's reconnect behaviour is stated, and the import runs with the iPad and iPhone closed.
- The native clip is the tone coach's answer key; clips and coach are verified together (V0–V4). Audio is chosen by measured tone accuracy and a native ear, not by how natural it sounds. A rebuilt pack is licensed; a speaker's recordings are used only with their written agreement.

## Verification, added to the roadmap's

- **Archive**: the tag and branch point at `7d26dc5`; the zip opens on a local port and shows v65.
- **v66**: the one-choice check per sentence; `check_usage.py`; three screen sizes; the checker's PASS.
- **Voice**: V0's and V1's tables shown to Thorne before V2 is built; V2 checked by the analysis over every clip and by a native ear on a fresh sample; V4's agreement number on Thorne's voice.

## Appendix — the pairs for v66 (Thorne's, from his teacher-checked notes)

| Pair | Lessons | The test |
|---|---|---|
| 到 / 在 | B1 L5–6 → B2 L6 | Moving verbs take 到, placing verbs take 在. 坐、拿、走、放 take both and the meaning flips |
| 就 / 才 | B1 L11 → B2 L11 | 就 = sooner or more than expected, 才 = later or less. 才 also = "only if". 才 refuses a final 了 |
| 被 / 讓 | B2 L11 → B2 L12 | Where does the verb land? On the front noun → 被. On the second noun → 讓 |
| 又 / 再 | B2 L11 | Already happened → 又. Not yet → 再. Complaining is always 又 |
| 完 / 好 | B2 L8 → B2 L9 | 完 = it's over, 好 = done properly and ready. 報告寫完了，可是還沒寫好 |
| 不 / 沒 | B1 L13 → B2 L7 | 有 → 沒有; Vs → 不; didn't happen → 沒 |
| 先…再 / 然後 | B1 L12 → B2 L11 | Can a new subject follow? Yes → 然後. No → 再 |
| 趟 / 遍 / 次 / 下 | B2 L11 | Out and back → 趟; start to finish → 遍; bare count → 次; one quick action → 下 |
| 其他 / 別的 / 另外 | B2 L11 | Can a number go before the noun? Yes → 另外 |
| V上 / V著 | B1 L5 → B2 L11 | 上 = the moment it connects, 著 = the state. 穿上鞋子 vs 穿著鞋子 |
| 會 / 能 / 可以 | B1 L4–7 → B2 L8 | Learned skill → 會; circumstances allow → 能; someone permits → 可以 |
| 一點 / 有一點 | B1 L5 → B2 L2 | 有一點 before Vs = mild complaint; Vs + 一點 = comparison or request |
| 因為…所以 / 為了 | B1 L10 → B2 L7 | 因為 takes a cause, 為了 takes a goal |
| 注意 / 小心 | B2 L11 | Could something hurt you? Yes → 小心 |
| 趁 / 順便 / 的時候 | B2 L10 → B2 L11 | Window closing → 趁; passing anyway → 順便; just a time → 的時候 |
| Time-when / duration | B1 L9 → B1 L14 | When → before the verb; how long → after it. ✗我看書三個鐘頭 |
| 跟…一樣 / 像…一樣 | B1 L13 → B2 L9 | The same as vs. like |
| 變 / bare 了 | B1 L10 → B2 L12 | 變 when the change itself is the news (她變胖了) |

## Toward a real product (added 21 November, later the same evening)

None of this comes before the backend's own steps. These are rules for now, so nothing built this month blocks a real product later, and items for step 12. Fold each into the roadmap where it belongs.

**Rules for now**

- **Do not change the app's web address before accounts exist (v68).** The deck lives in each browser's storage, and that storage belongs to the address: a device opening the app at a new address starts empty. Moving the app to another host (see "code and hosting" below) happens only once decks come back through signing in, and gets its own rehearsal.
- **Every running cost goes in `docs/costs.md`** as it appears: Supabase, Azure Speech, ElevenLabs, a mail service, any domain or host. The monthly figure, what it pays for, and when it would start. Thorne reads it before any of them is switched on.
- **No tracking of learners without a privacy note.** Error reports and usage counts come with step 12, never record audio or what is in a deck, and say plainly what they collect.

**Add to step 12 (before anyone outside)**

- **Error reports**: a way to know when the app fails on someone else's device; today only Thorne would notice. Small, no audio, no deck content.
- **The few numbers a business needs** (learners signed up, who came back after a week, reviews a day), counted in the database, not by a third-party tracker.
- **Database backups**: until the real project is on a plan with automatic backups, a nightly export of it to a file Thorne owns.
- **Code and hosting**: decide whether the repository goes private. Pages from a private repository needs a paid GitHub plan; Vercel or Cloudflare Pages can host a private repository. Bound by the address rule above.
- **Personal data**: emails and any voice recordings are personal data. A privacy note, delete-my-data (step 7's account delete), and where the data is kept (the project is in Tokyo).
- **A human engineer's review** of the database rules, the accounts flow and the keys before the first outside learner. Write a short brief (what is stored, who can reach what, how a deck moves between devices) that a software engineer can read in an hour.
- **A closed beta**: three to five classmates at MTC, after v69 and after the rights question has an answer. An invite list, a feedback button, and Thorne's own deck untouched by it.

**Thorne's decisions, not the agents'** (listed so no session decides them):

- Who the app is for: students of this one textbook series (needs the publisher's permission) or any learner bringing their own words.
- Asking NTNU MTC / Linking Publishing about the word lists. It is the longest wait in the whole plan and needs no code, so it can start now.
- The name, the price, and whether payments come at all.

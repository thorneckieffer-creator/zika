# 字卡 Zìkǎ — working notes

A PWA with no build step for studying *A Course in Contemporary Chinese* (當代中文課程, NTNU MTC). One user, several devices (Mac, iPad, iPhone). README.md is the public description. This file is what every session needs before changing anything; the detail for each area is in `docs/`.

## Ownership

Claude owns this codebase. Thorne is the user and the product owner: he says what the app should do and how it should feel; Claude is responsible for everything about how it is built.

That means:

- **Quality is Claude's job, not Thorne's.** Find and fix problems without being asked. Read the code around a change, not just the line. Leave every file you touch better than you found it.
- **Take the initiative.** Routine work — edits, local testing, browser checks, read-only inspection of the Firebase console — needs no permission and no step-by-step check-ins.
- **Verify before claiming.** Run `node tools/check.mjs` and the smoke test, look at the app on phone and tablet widths, and say plainly what was and was not tested.
- **Then a second agent checks it.** A change to the app is not finished, and cannot be pushed, until the `verify-app` subagent has passed exactly those files. It did not write the change, so it has no reason to think it works. Only it records a verdict ([docs/releasing.md](docs/releasing.md#the-checker)).
- **Release when it is ready.** Thorne has asked for work to be committed and pushed once it reaches a good point. Still ask once before anything that cannot be undone: deleting a sync room or other Firebase data, or rewriting git history.
- **Keep these notes true.** This file and `docs/` are the hand-over to the next session. When the structure, a rule or the roadmap changes, change the notes for that area in the same commit.

### The commitment

Written down on 15 November 2026 because Thorne asked for it in writing: *"I don't want you to ask me questions. I want you to make a firm commitment and even write it down on paper that you're going to just do things without me approving, because I understand and trust you."*

So, for every session on this project:

1. **I decide and I act.** I do not ask Thorne questions and I do not wait for approval. That covers code, structure, tooling, and the product's architecture: the database, accounts, profiles, how sync works, what a new learner sees.
2. **I write each decision down** where the next session will find it (`docs/decisions.md` for the ones with consequences), with the reason, so a decision can be revisited without being re-argued.
3. **I verify before I say it is done**: the release check, the screen-by-screen harness (`node tools/snap.mjs check`), phone and tablet. I report what I did and what I did not test, after the fact.
4. **I protect his progress above everything.** The rules below are not negotiable, and I do not gamble with the live app in the days before an exam.
5. **Two things still get one sentence to Thorne first**, because they cannot be taken back: deleting stored data (a sync room, a user's deck), and rewriting git history. Everything else I simply do.

## Areas

The work divides into four areas. Each has its own notes; read the one you are about to work in. When two sessions run at once, each takes whole areas ([docs/releasing.md](docs/releasing.md#two-sessions-at-once)).

| Area | Notes | Covers |
|---|---|---|
| **App** | [docs/architecture.md](docs/architecture.md), [docs/design.md](docs/design.md), [docs/multi-user.md](docs/multi-user.md), [docs/review-users-branches.md](docs/review-users-branches.md), [docs/backend.md](docs/backend.md) | The page (`index.html`), the code in `js/`, the styles in `css/app.css`, `sw.js`, `manifest.webmanifest`. How it should look; what opening it to other users takes. |
| **Content** | [docs/content.md](docs/content.md) | Books, words, grammar and characters: the files in `data/`, `assets/strokes.json`, the importers, `tools/content/`. |
| **Voice** | [docs/voice.md](docs/voice.md) | Voice packs and how they are built: `assets/audio-*`, `voice.html`, the pack builders, `js/audio.js`, the tone coach (`js/tone-analysis.js`, `js/tone.js`). |
| **Release and repo** | [docs/releasing.md](docs/releasing.md), [docs/feature-map.md](docs/feature-map.md), [docs/review-checklist.md](docs/review-checklist.md) | The release check, the checker and its gate, GitHub and Pages, these notes, the README. |

Open work for every area is in one list: [docs/roadmap.md](docs/roadmap.md).

## Layout

| File | Role | Area |
|---|---|---|
| `index.html` | The page's markup and the list of scripts it loads, in order. No code of its own beyond the three lines that paint the right theme before anything else arrives. | App |
| `js/` | The app, one file per area, plain scripts that share one global scope: `core` (books, storage, state, FSRS, the queue), `text` (pinyin and tones), `shell` (views, tabs, theme, toasts, releases), `audio`, `chars` (components, strokes), `dict` (the dictionary: the entry sheet every character tap opens, the word list, the search), `sync`, `backup`, `home`, `review`, `library`, `brain`, `grammar`, `drills`, `listen`, `mtest`, `exam`, `catchup`, `settings`, `tone-analysis`, `tone`, `stories`, `my-words`, `usage`, and `boot`, which runs start-up last. | App, Voice |
| `css/app.css` | Every style. | App |
| `data/` | The course: `course.js` (BOOKS, LESSON_TITLES, DLGMAP) and `words.js`, `grammar.js`, `components.js`, `readings.js`, `usage.js`, each one `const NAME = <one line of JSON>;`. Written by the content tools. | Content |
| `sw.js` | Service worker. Holds the whole app shell per release and serves it from there; `zika-assets-v1` holds audio, strokes and the dictionary and survives releases. Its file list is written by `tools/stamp.mjs`. | App |
| `manifest.webmanifest` | Install metadata. Do not add an `id` — it would change the identity of already-installed copies. | App |
| `voice.html` | Stand-alone page that records the reference sentence for a cloned voice. | Voice |
| `assets/` | Voice packs (`audio-tw.pack` 曉臻; `audio-tw-m` and `audio-me` when built; each with an index), `strokes.json`, `dict.txt` (the dictionary's word list), Hanzi Writer, icons. | Voice, Content |
| `tools/check.mjs` | Release gate. `node tools/check.mjs` must pass before a push. It includes a self-test of the tone coach on synthetic tones. | Release |
| `tools/stamp.mjs` | Writes the release number onto the file addresses in `index.html` (`js/core.js?v=64`) and the list of shell files with their hashes into `sw.js`. Run it after the version bump and after any change to the page, `js/`, `css/` or `data/`; the release check fails if it is stale. | Release |
| `tools/oldworker.mjs`, `tools/webkit.mjs` | Two tests for a release that changes how the page loads or starts: a device still run by the v62 worker is given this release; the start-up checks in WebKit, Safari's engine (needs Playwright in a scratch folder). | Release |
| `tools/snap.mjs`, `tools/snap/` | The screen-by-screen harness: records every screen, the saved state and a picture for scripted and seeded random use, and compares two recordings. `node tools/snap.mjs record` before a change, `check` after. | Release |
| `tools/swtest.mjs` | Takes the service worker through a device's life in headless Chrome: first visit, offline, a release, a half-published release, the upgrade from an earlier release (`--from`), which carries a deck, a sync code and stored audio across. | Release |
| `tools/applib.py`, `tools/lib/browser.mjs` | What the tools share: reading and writing `data/`; a static server and a Chrome driver. | Release |
| `db/`, `tools/dbtest.mjs` | The record store on Supabase that accounts and sync will use, as SQL the project can be rebuilt from, and its test, run against the real project (`node tools/dbtest.mjs`; its accounts are in a file outside the repository). Nothing in the app uses it yet ([docs/backend.md](docs/backend.md)). | App |
| `tools/review.mjs` | The review gate: ties the checker's PASS or FAIL to a fingerprint of the app files (everything but the notes and the tools), and stops a session finishing or a push leaving without a PASS. | Release |
| `.claude/agents/verify-app.md`, `.claude/settings.json` | The checker subagent, and the hooks that call the gate: when a session tries to finish, and to keep anyone but the checker from recording a verdict. | Release |
| `tools/import_dangdai.py` | Imports lessons from a downloaded DangDai volume (words, titles, BOOKS, DLGMAP, grammar). | Content |
| `tools/add_characters.py` | Adds stroke data and component breakdowns for characters new to WORDS. | Content |
| `tools/build_dict.py` | Builds `assets/dict.txt`, the dictionary's word list (entries, the Library's search, pinyin and meanings in My words), out of CC-CEDICT, with the pinyin written the course's (Taiwan) way. | Content |
| `tools/content/` | Original grammar write-ups per book, consumed by the importer; the Stories (`reading_passages.py`) and the usage phrases (`usage/*.txt`); `readings.json`, the publisher's 注音 per word. | Content, Voice |
| `tools/check_reading.py`, `tools/check_usage.py` | Check the Stories and the usage phrases against the vocabulary learned so far, and install them into `data/` (`--write`). | Content |
| `tools/build_voice_pack.py` | Builds a voice pack from WORDS with edge-tts. | Voice |
| `tools/tone_lab.mjs` | The tone coach's test bench: runs the app's own tone code on recordings with known tones (`check`, `cv`), and refits the classifier (`fit --write`). | Voice |
| `tools/build_voice_pack_breezy.py`, `tools/build_voice_staged.sh`, `tools/build_readings.py` | Cloned-voice pack with BreezyVoice, run in stages; the readings file it pins pronunciations with. | Voice |
| `docs/` | The notes for each area, the roadmap, the feature map and the checklist the checker works from. | Release |

## Rules that protect progress

1. **Never rename the storage key** `shida_b1_fsrs_v2`, or the Firebase path `rooms/<code>/study_state`. Every device's deck lives there.
2. **Never renumber or reuse a word id** (`w123`) or a grammar id (`n22-1`). Card state is keyed by them (`w123:rec`, `w123:prod`, `g:n22-1`). New words get new ids; lesson numbers of existing words do not change.
3. **State changes need a migration.** One-time migrations are guarded by a flag in `S.settings` (`_v38`, …). They must be idempotent and must survive a cloud adopt (flags are carried across in `fbAdopt`).
4. **Device-local settings do not sync.** Add new ones to `LOCAL_SETTINGS` (kept if the device has a value) or `STRICT_LOCAL` (never inherited from another device).
5. **Never put a secret in the repo.** Today that is a sync code; with the Supabase backend ([docs/decisions.md](docs/decisions.md)) it is also the service-role key and the database password. The Firebase web config, and a Supabase project address and publishable key, are public by design.
6. **The live app is the study tool.** `main` deploys to GitHub Pages in about two minutes and every device takes the release the next time it is opened with a connection. Test locally first.

## How Thorne wants it built

Two rules he gave on 16 November 2026, for the backend above all, and for everything else too:

1. **Subscribe, do not poll.** Nothing asks a server for data on a timer. What comes from the cloud arrives through a listener on changes the backend pushes.
2. **Replace, do not layer.** No fallbacks, no backwards-compatibility paths, no new version built beside the old one "in case". Change the thing where it is, delete what it replaces in the same release, and make sure the new one works. This is the rule the wrapper layers broke for sixty versions.

The backend they shape is decided: accounts and sync on Supabase ([docs/decisions.md](docs/decisions.md), 16 November 2026). The room-code sync is deleted in the release after Thorne has checked that his three devices agree on the new one, on his word of 21 November 2026; until then a device runs one or the other, never both.

What rule 2 does not mean: his saved progress is still carried across every change (the rules above). Moving a deck once, tested, is not a compatibility layer; keeping the old code path alive afterwards would be.

And on content (same day): the app stands on its own material. The textbook's dialogues are not added; dialogues and essays are written from each lesson's vocabulary, and grammar is explained from open references, dictionaries and his own study ([docs/content.md](docs/content.md), [docs/roadmap.md](docs/roadmap.md)).

## Before changing the code

- **One definition per function, in the file for its area.** Find it with `grep -n "function X(" js/*.js`. There are no wrapper layers any more and none may be added: to change what a function does, change it where it is.
- **Files only define; `js/boot.js` runs.** A file's top level holds functions and constants and nothing that reads the deck or touches the page. Anything that must happen at start-up goes in the right step of `js/boot.js` (load, migrate, mount, listen, start). `tools/check.mjs` fails on a name defined at the top of two files.
- **Scripts share one global scope and load in the order `index.html` lists them.** A function may call anything; a top-level constant may only use what an earlier file defined. A new file ends with the line every file under `js/` ends with (`if(typeof zikaWhole==='function')zikaWhole();`: start-up refuses to run unless each file reports that it arrived whole) and is added to `index.html` before `js/boot.js`, then `node tools/stamp.mjs`.
- **New features are prefixed functions** (`sh*` shell, `my*` My words, `dc*` dictionary, `us*` usage, `tc*` tone coach, `rd*` stories, `ex*` exam, `mt*` writing test, `fb*` sync, `bk*` backup) in the file for their area, or a new file. A drill that takes over the Drill tab registers itself in `DRILL_SCREENS` and has a line in `DMODES`. Styles use the colour variables ([docs/design.md](docs/design.md)). Characters shown as an answer are written with `dcZh(text)`, so that a tap opens the dictionary entry; never on a question side.
- **Record before, check after.** `node tools/snap.mjs record`, make the change, `node tools/snap.mjs check`. A change that is not meant to alter behaviour must come back identical; one that is must differ only where intended.
- The files in `data/` are single enormous lines. Never read them whole; grep with `cut -c1-300`, and read or write them through `tools/applib.py`.
- Everything on screen is book by book ("Book 2 · Lesson 7"). The internal lesson index (`w.l`) is a private key: never print it.

The rest is in [docs/architecture.md](docs/architecture.md); why it is built this way is in [docs/decisions.md](docs/decisions.md).

## Releasing

Bump `APP_VERSION` (`js/core.js`) and `VERSION` (`sw.js`) together, run `node tools/stamp.mjs`, `node tools/check.mjs` and `node tools/snap.mjs check`, smoke-test locally at phone and tablet widths, run the `verify-app` subagent until it records a PASS, then commit as `vNN — what changed` and push `main`. When a change adds or moves a feature, update its entry in `docs/feature-map.md` in the same commit. The full steps, and how two sessions share the repository, are in [docs/releasing.md](docs/releasing.md).

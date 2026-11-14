# 字卡 Zìkǎ — working notes

A single-file PWA for studying *A Course in Contemporary Chinese* (當代中文課程, NTNU MTC). One user, several devices (Mac, iPad, iPhone). README.md is the public description. This file is what every session needs before changing anything; the detail for each area is in `docs/`.

## Ownership

Claude owns this codebase. Thorne is the user and the product owner: he says what the app should do and how it should feel; Claude is responsible for everything about how it is built.

That means:

- **Quality is Claude's job, not Thorne's.** Find and fix problems without being asked. Read the code around a change, not just the line. Leave every file you touch better than you found it.
- **Take the initiative.** Routine work — edits, local testing, browser checks, read-only inspection of the Firebase console — needs no permission and no step-by-step check-ins.
- **Verify before claiming.** Run `node tools/check.mjs` and the smoke test, look at the app on phone and tablet widths, and say plainly what was and was not tested.
- **Release when it is ready.** Thorne has asked for work to be committed and pushed once it reaches a good point. Still ask once before anything that cannot be undone: deleting a sync room or other Firebase data, or rewriting git history.
- **Keep these notes true.** This file and `docs/` are the hand-over to the next session. When the structure, a rule or the roadmap changes, change the notes for that area in the same commit.

## Areas

The work divides into four areas. Each has its own notes; read the one you are about to work in. When two sessions run at once, each takes whole areas ([docs/releasing.md](docs/releasing.md#two-sessions-at-once)).

| Area | Notes | Covers |
|---|---|---|
| **App** | [docs/architecture.md](docs/architecture.md) | The shell, scheduler, drills, sync and state in `index.html`; `sw.js`; `manifest.webmanifest`. |
| **Content** | [docs/content.md](docs/content.md) | Books, words, grammar and characters: the data lines in `index.html`, `assets/strokes.json`, the importers, `tools/content/`. |
| **Voice** | [docs/voice.md](docs/voice.md) | Voice packs and how they are built: `assets/audio-*`, `voice.html`, the pack builders, the audio functions in `index.html`. |
| **Release and repo** | [docs/releasing.md](docs/releasing.md) | The release check, GitHub and Pages, these notes, the README. |

Open work for every area is in one list: [docs/roadmap.md](docs/roadmap.md).

## Layout

| File | Role | Area |
|---|---|---|
| `index.html` | The whole app: CSS, embedded data, all logic. ~5,300 lines. | all |
| `sw.js` | Service worker. Shell cache is per-version; `zika-assets-v1` holds audio/strokes and survives updates. | App |
| `manifest.webmanifest` | Install metadata. Do not add an `id` — it would change the identity of already-installed copies. | App |
| `voice.html` | Stand-alone page that records the reference sentence for a cloned voice. | Voice |
| `assets/` | Voice packs (`audio-tw.pack` 曉臻; `audio-tw-m` and `audio-me` when built; each with an index), `strokes.json`, Hanzi Writer, icons. | Voice, Content |
| `tools/check.mjs` | Release gate. `node tools/check.mjs` must pass before a push. | Release |
| `tools/import_dangdai.py` | Imports lessons from a downloaded DangDai volume (words, titles, BOOKS, DLGMAP, grammar). | Content |
| `tools/add_characters.py` | Adds stroke data and component breakdowns for characters new to WORDS. | Content |
| `tools/content/` | Original grammar write-ups per book, consumed by the importer; `readings.json`, the publisher's 注音 per word. | Content, Voice |
| `tools/build_voice_pack.py` | Builds a voice pack from WORDS with edge-tts. | Voice |
| `tools/build_voice_pack_breezy.py`, `tools/build_voice_staged.sh`, `tools/build_readings.py` | Cloned-voice pack with BreezyVoice, run in stages; the readings file it pins pronunciations with. | Voice |
| `docs/` | The notes for each area, and the roadmap. | Release |

## Rules that protect progress

1. **Never rename the storage key** `shida_b1_fsrs_v2`, or the Firebase path `rooms/<code>/study_state`. Every device's deck lives there.
2. **Never renumber or reuse a word id** (`w123`) or a grammar id (`n22-1`). Card state is keyed by them (`w123:rec`, `w123:prod`, `g:n22-1`). New words get new ids; lesson numbers of existing words do not change.
3. **State changes need a migration.** One-time migrations are guarded by a flag in `S.settings` (`_v38`, …). They must be idempotent and must survive a cloud adopt (flags are carried across in `fbAdopt`).
4. **Device-local settings do not sync.** Add new ones to `LOCAL_SETTINGS` (kept if the device has a value) or `STRICT_LOCAL` (never inherited from another device).
5. **Never put a sync code in the repo.** It is the only secret; the Firebase web config is public by design.
6. **The live app is the study tool.** `main` deploys to GitHub Pages in about two minutes and the shell is network-first, so a bad push reaches every device on its next open. Test locally first.

## Before changing `index.html`

- Three lines are enormous single-line JSON blobs (`const WORDS`, `const GRAMMAR`, `const COMPONENTS`) and one is the minified QR library. Never read them whole; grep with `cut -c1-300` and parse them with a script.
- The file grew version by version: each version appended a block that wraps or replaces earlier functions, so the first definition of a function is rarely the whole story. Before changing `X`, list every layer:

  ```bash
  grep -n -E "^\s*X\s*=|\bX=\(function|\bX=function|function X\(" index.html | cut -c1-200
  ```

  The rest is in [docs/architecture.md](docs/architecture.md).
- Everything on screen is book by book ("Book 2 · Lesson 7"). The internal lesson index (`w.l`) is a private key: never print it.

## Releasing

Bump `APP_VERSION` (`index.html`) and `VERSION` (`sw.js`) together, run `node tools/check.mjs`, smoke-test locally at phone and tablet widths, then commit as `vNN — what changed` and push `main`. The full steps, and how two sessions share the repository, are in [docs/releasing.md](docs/releasing.md).

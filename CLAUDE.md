# 字卡 Zìkǎ — working notes

A single-file PWA for studying *A Course in Contemporary Chinese* (當代中文課程, NTNU MTC). One user, several devices (Mac, iPad, iPhone). README.md is the public description; this file is what you need before changing code.

## Ownership

Claude owns this codebase. Thorne is the user and the product owner: he says what the app should do and how it should feel; Claude is responsible for everything about how it is built.

That means:

- **Quality is Claude's job, not Thorne's.** Find and fix problems without being asked. Read the code around a change, not just the line. Leave every file you touch better than you found it.
- **Take the initiative.** Routine work — edits, local testing, browser checks, read-only inspection of the Firebase console — needs no permission and no step-by-step check-ins.
- **Verify before claiming.** Run `node tools/check.mjs` and the smoke test, look at the app on phone and tablet widths, and say plainly what was and was not tested.
- **Release when it is ready.** Thorne has asked for work to be committed and pushed once it reaches a good point. Still ask once before anything that cannot be undone: deleting a sync room or other Firebase data, or rewriting git history.
- **Keep this file true.** It is the hand-over note to the next session. When the structure, a rule or the roadmap changes, change it here in the same commit.

## Layout

| File | Role |
|---|---|
| `index.html` | The whole app: CSS, embedded data, all logic. ~5,000 lines. |
| `sw.js` | Service worker. Shell cache is per-version; `zika-assets-v1` holds audio/strokes and survives updates. |
| `manifest.webmanifest` | Install metadata. Do not add an `id` — it would change the identity of already-installed copies. |
| `assets/` | Voice packs (`audio-tw.pack` female, `audio-tw-m.pack` male when built, each with an index), `strokes.json`, Hanzi Writer, icons. |
| `tools/check.mjs` | Release gate. `node tools/check.mjs` must pass before a push. |
| `tools/build_voice_pack.py` | Builds a voice pack from WORDS with edge-tts. |

Three lines of `index.html` are enormous single-line JSON blobs (`const WORDS`, `const GRAMMAR`, `const COMPONENTS`) and one is the minified QR library. Never read them whole; grep with `cut -c1-300` and parse them with a script.

## Rules that protect progress

1. **Never rename the storage key** `shida_b1_fsrs_v2`, or the Firebase path `rooms/<code>/study_state`. Every device's deck lives there.
2. **Never renumber or reuse a word id** (`w123`) or a grammar id (`n22-1`). Card state is keyed by them (`w123:rec`, `w123:prod`, `g:n22-1`). New words get new ids; lesson numbers of existing words do not change.
3. **State changes need a migration.** One-time migrations are guarded by a flag in `S.settings` (`_v38`, …). They must be idempotent and must survive a cloud adopt (flags are carried across in `fbAdopt`).
4. **Device-local settings do not sync.** Add new ones to `LOCAL_SETTINGS` (kept if the device has a value) or `STRICT_LOCAL` (never inherited from another device).
5. **Never put a sync code in the repo.** It is the only secret; the Firebase web config is public by design.
6. **The live app is the study tool.** `main` deploys to GitHub Pages in about two minutes and the shell is network-first, so a bad push reaches every device on its next open. Test locally first.

## How the code is organised

`index.html` grew version by version. Each version appended a block that wraps or replaces earlier functions:

```js
renderHome = (function (orig) { return function () { orig.apply(this, arguments); /* add a card */ }; })(renderHome);
```

So the first definition of a function is rarely the whole story. Before changing `X`, list every layer:

```bash
grep -n -E "^\s*X\s*=|\bX=\(function|\bX=function|function X\(" index.html | cut -c1-200
```

The most-wrapped functions are `renderHome`, `renderSet`, `renderDrill`, `renderRev`, `buildQueue`, `go`, `save` and `rate`. The order of the `save` wrappers matters: confidence snapshot → backup → sync push → queue-cache invalidation → coalescing (one write per tick).

New work should edit a function where it is defined when that is practical, and only add a wrapper when the change is genuinely a separate concern. Folding the old layers together is on the roadmap; do it one function at a time with the smoke test below, never as a big-bang rewrite.

### Key structures

- `BOOKS` — `[{n, zh, first, count}]`. **Everything on screen is book by book** ("Book 2 · Lesson 7", `lnLabel` → "B2 L7"); Thorne does not want a running total of lessons anywhere. Pickers use `lessonPick()` (book, then lesson) and `bookButtons()`. Internally a lesson is still one index (`w.l`, Book 1 = 1–15, Book 2 = 16–30) because saved progress and ordering depend on it — treat that index as a private key and never print it. `bookOf`, `lnInBook`, `lnLabel`, `lessonsOf`, `bookRange` and `MAX_LN` derive from `BOOKS`. **Adding a book = one entry here plus data.**
- `WORDS` — `{id, l, t, p, pos, m, s?}`: lesson, traditional, pinyin, part of speech, meaning, simplified if different.
- `GRAMMAR` — `{ "<lesson>": [{id, t, e, pat, tgt, alt, s:[{zh, en, py}], …}] }`.
- `COMPONENTS` — per character `{p, g, d:[parts], t:type, s:semantic, ph:phonetic}`.
- `S` (state) — `cards`, `settings`, `log` (per-day counts), `intro`/`cintro`/`gintro` (per-day intake by lane), `hard`, `pick`, `sib`, `hist`, `mtest` (writing-test results `m`/`l`/`h`), `exam`, `gram`, `cf`, `conf`, `listen`.
- A card: `{st:'learn'|'rev'|'relearn', S, D, due, last, reps, lapses, days, known?, susp?, leech?, mastAt?}`. A card object with no `st` is queued but not started.

### App shell

- Phones (≤700 px): the tab bar is fixed to the bottom — Today, Review, Drill, 大考試, More. The other tabs carry class `t2` and sit behind More. Tablets and desktop keep the top bar.
- The page never zooms (`maximum-scale=1`, `touch-action: pan-x pan-y`): it is an app, not a document.
- Refresh: the ↻ button, pull-down inside the Home Screen app, and `checkForUpdate()` when the app returns to the foreground (it compares `sw.js` on the server with `APP_VERSION`).

### Scheduler

FSRS-5 with the default weights. Words have two cards, `rec` and `prod`; `prod` cards are forced back on days 1/2/3 before FSRS takes over (`capEarly`). `buildQueue()` returns `{learn, rev, fresh}` and is cached for 400 ms (`QV` is bumped by every `save`). Lanes (`laneOf`): `live` = lessons ≥ `curLesson − 1`; `catch` = writing-test `l`/`h` results or the hard list; `maint` = the rest.

### Sync

Whole-state, last-write-wins. `save()` → debounce 700 ms → `set(rooms/<code>/study_state, {json, synced_at, device, …})`. The database rejects a write whose `synced_at` is not newer. A device with no study history adopts silently; otherwise a conflict modal blocks pushes until the user picks. `rooms/<code>/sync_log` keeps the last 50 pushes.

### Audio

`playAudio(text)` → bundled pack (the voice chosen in Settings: 曉臻 female or 雲哲 male) → system `speechSynthesis` as fallback. A pack is one file of concatenated MP3s plus `{key: [offset, length]}`; `audioKey()` reduces a word to its Han characters. Rebuild or extend a pack with `tools/build_voice_pack.py`; it reads WORDS, so new lessons are covered automatically.

### Known leftovers

Verified dead or superseded code that is still in the file, to be removed one piece at a time with the smoke test:

- `TIERS`, `RECUR_TGT`, `CATCHUP_SCHED`, `tierWords`, `recurPoints`, `drillTier` and the `drillScope==='tier'` branch (the tier card was stubbed out in v33).
- The first `renderLib` body, the first `buildQueue` body and the first `compLines` body (each replaced wholesale by a later layer).
- The `dict` branch of the first `renderDrill`, and the write-card front in the first `renderRev`.
- `NOTION.hub/.catchup/.prep/.book1/.chars`, CSS `.complines`, `.gres`, `.serif-en`, `.kai`.

Known behaviour gaps, not yet fixed:

- Heteronyms share one clip (得 de/děi, 了 le/liǎo) because clips are keyed by characters alone.
- The Today hero says "Deck cleared" from the live lane alone, even when catch-up or maintenance cards are due.
- The Up-next panel's "will start now" count ignores the per-lane intake.
- Turning a card type on in Settings does not create that card for words already in the deck.
- The exam clock in the 口試 drill is not tied to the recording.

## Releasing

1. Make the change. Bump `APP_VERSION` in `index.html` and `VERSION` in `sw.js` to the same number. Bump `ASSETS` in `sw.js` only if a file under `assets/` changed.
2. `node tools/check.mjs`
3. Serve locally (`python3 -m http.server 8791 --bind 127.0.0.1`; port 8765 is taken by another project on this Mac) and smoke-test: open every tab, start a review, grade a card, run one drill, check the console. Check a 390-px-wide frame for iPhone and ~820 px for iPad.
4. Commit as `vNN — what changed` and push `main`.

## Adding a book (Books 3 and 4 are next)

### Where the content comes from

1. **The publisher's 當代中文 (DangDai) app, installed on Thorne's Mac.** It is the authoritative source. Each downloaded volume is a folder of local files, not just screens:
   - Find the folder with `mdfind -name ".syd" | grep SoyongMebook` → `…/Application Support/SoyongMebook/MBLCECC00N/`.
   - A volume holds five lessons. `MBLCECC002–004` are Book 1 (L1–5, 6–10, 11–15), `005–007` are Book 2, `008–010` are Book 3, and so on.
   - `*-01-03.sqlite` → table `newwords`: `id` (`b02u11_d2v003` = book 2, lesson 11, dialogue 2, item 3), `entry`, `pinyin`, `zhuyin`, `partofspeech`, `explantion` (sic), `category` (Vocabulary / Phrases / Names), `vocorder`. Table `menu` has lesson titles; `chinesecharacter` has radical and stroke count.
   - Dialogue and essay pages are images (`bNNuNN_tNNpNN.png`); audio is per-syllable MP3.
   - As of v40 only Books 1–2 are downloaded. Book 3's volumes show a cover image only: **Thorne has to download them inside the app** before anything can be read.
2. **Zhong Chinese** (app.zhongchinese.com) for cross-checking. The Chrome extension currently blocks that domain for Claude; Thorne has to allow it in the extension's site permissions.

The app's Books 1–2 word list has been checked against the publisher's table: 1,228 entries on both sides, same order, pinyin identical apart from nine cosmetic differences.

### What may be copied

Word lists and their metadata (pinyin, part of speech, a short gloss, which dialogue a word belongs to) go into the app. **The textbook's dialogues, essays and example sentences do not** — this repository is public and those texts are the publisher's. Read them to learn how the vocabulary and grammar are used, then write original sentences and short essays that use the same words and patterns. That is also what Thorne asked for: new short essays built from each lesson's vocabulary and grammar.

### Steps

1. Add the book to `BOOKS` (use the real lesson count from the app's `menu` tables).
2. Append words to `WORDS` with new ids continuing from the current maximum, in `vocorder`. Never interleave: snapshots are positional.
3. Add `LESSON_TITLES`, the lesson's `DLGMAP` string (from the `_d1` / `_d2` part of each id; later books pair a dialogue with an essay), and `GRAMMAR` entries with original example sentences.
4. Add any new characters to `assets/strokes.json` (Hanzi Writer data format) and `COMPONENTS`.
5. Rebuild the voice packs with `tools/build_voice_pack.py` and bump `ASSETS` in `sw.js`.
6. `node tools/check.mjs` reports any lesson without words, character without strokes, or word without a clip.

## External services

- **Firebase** project `zika-sync` (Realtime Database, asia-southeast1, anonymous auth, Spark plan). Rules are in README.md.
- **Notion** is not connected by API. The app holds page links (`NOTION`, `NOTION_LESSON`) and exports a confidence snapshot that is applied to Notion by hand.
- **萌典** (moedict.tw) is fetched live for the dictionary panel and cached locally.

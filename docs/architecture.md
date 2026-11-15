# How the app is built

The app area: `index.html`, `js/`, `css/app.css`, `sw.js`, `manifest.webmanifest`. Read this before changing code. The rules that protect saved progress are in [CLAUDE.md](../CLAUDE.md) and apply to every change; why things are built this way is in [decisions.md](decisions.md).

## How it loads

There is no build step. `index.html` is the page's markup and a list of plain scripts, loaded in order into one shared global scope:

1. `data/*.js` — the course (see [content.md](content.md)); each file is one or a few `const` lines.
2. `assets/qrcode.min.js` — the QR library for the sync link.
3. `js/<area>.js` — the app. Every file only defines: functions, constants, tables. Nothing at the top level reads the deck or touches the page.
4. `js/boot.js` — start-up, the one file that runs.

Because the scope is shared, a function in any file can call a function in any other; only a top-level constant is limited to what earlier files defined. `tools/check.mjs` checks that every file under `js/` is loaded, that `boot.js` is last, and that no name is defined at the top of two files.

| File | Holds |
|---|---|
| `core.js` | Version, books and lessons, storage, the state `S`, `save`, FSRS-5 (`rate`), cards and modes, the queue (`buildQueue` and its steps), the hard list, lanes, leeches, `normalizeState`. |
| `text.js` | Pinyin: tone marks, syllable splitting, tone colouring, tone sequences. No page, no deck: the tools load it as it is. |
| `shell.js` | The view switch `go`, tab badges, theme and look (`sh*`), toasts, the *Where you are* sheet, icons, the keyboard map, the service worker and releases, the install hint, Notion links. |
| `audio.js` | Voice packs, `playAudio`, the system voice as fallback. |
| `chars.js` | Character components and etymology, the anatomy line on card backs, look-up links, 萌典, stroke order (Hanzi Writer). |
| `sync.js` | Cloud sync: config, device identity, connect, reconcile, push, the sync code and link, the Settings panel. |
| `backup.js` | The backup file (File System Access) and the in-browser snapshots. |
| `home.js` | Today: the hero, lanes panel, plan, Up next queue, paper list, statistics, heatmap. |
| `review.js` | The review sitting: queue for the session, the card, grading, undo, the session summary. |
| `library.js` | Library search and lesson lists, triage, word rows, confidence levels, the dialogue map. |
| `brain.js` | The Brain views, the time-lapse, word-type categories, phonetic series. |
| `grammar.js` | Grammar tab and quiz, grammar cards in the queue, families and the grasp map. |
| `drills.js` | The Drill tab: `DMODES`, `DRILL_SCREENS`, recognition, tones, dictation, sentences, speaking, which-one, reading sprint, sentence dictation, 口試. |
| `listen.js`, `mtest.js`, `exam.js`, `catchup.js`, `stories.js`, `usage.js` | The listening player, the writing mastery test, 大考試, the Catch-up tab, Stories, usage phrases. |
| `settings.js` | Settings and its panels, export and import. |
| `tone-analysis.js`, `tone.js` | The tone coach: pitch tracking and tone classification (pure, loaded by the tools as it is), then the coach itself. |
| `my-words.js` | My words and the dictionary. |
| `boot.js` | Start-up. |

## Start-up

`js/boot.js` runs five steps in order: `bootLoad` (the saved deck, where sync stood), `bootMigrate` (one-time changes to older decks, each behind a flag in `S.settings`), `bootMount` (the parts of the page built by script: sync pill, the Catch-up, 大考試 and My words tabs, More, icons), `bootListen` (keyboard, touch, page lifecycle), `bootStart` (theme, the first paint, sync, the service worker, audio warm-up).

- A new one-time migration goes at the end of `bootMigrate` with a new flag ([CLAUDE.md](../CLAUDE.md), rule 3).
- **What start-up writes by itself must not look like work the learner did.** The day's time-lapse entry and the three oldest migrations store the deck with `saveLocal()`, which writes to the device and queues the backup but does not mark the device as holding unsent changes. A start-up `save()` on an idle linked device raises a sync conflict when another device is ahead; the harness's `open-*` scenarios hold this in place.

## Saving

Every change to `S` ends in `save()`. Many changes in one tick make one write (`saveNow`): the cached queue is dropped, the confidence snapshot refreshed, the deck stored, the backup file queued, and the device marked dirty with a cloud push scheduled (unless the change is the cloud's own copy being adopted).

## One definition per function

Until November 2026 the app was version blocks, each wrapping or replacing earlier functions; fifty functions carried 129 layers. Every function now has one definition. `renderHome`, `renderSet`, `renderRev` and `renderDrill` still read as steps in the order the versions added them (build the page, then insert, move or remove parts of it); rewriting each as one direct build is on the [roadmap](roadmap.md). Do not add a wrapper again: change the function, or add a step to it.

**A drill that takes over the Drill tab** (Stories, 用法) registers once: `DRILL_SCREENS[mode] = {start, render}` at the end of its file, plus its line in `DMODES` (`js/drills.js`). `start()` sets `drillMode` and calls `go('drill')`; `render()` paints `#vDrill` while `dq` is null.

## The service worker and releases

`sw.js` stores the whole app shell (the page, `js/`, `css/`, `data/`, the manifest; 34 files) once per release and serves it from that store, so opening never waits for the network and a page never runs with scripts from two versions.

- `node tools/stamp.mjs` writes the file list and a hash of each file into `sw.js`. A device installing a release copies unchanged files from the release it already holds and downloads the rest, checking each against its hash; any mismatch (the host still serving part of the previous release) refuses the install, and the device keeps what it has.
- The page hears when a new release has taken over (`swUpdated` in `js/shell.js`): it reloads at once if nothing has been touched since the app opened, otherwise it offers **Refresh**. The ↻ button and pull-to-refresh (`appRefresh`) push unsent work, ask for the newest release, wait for it to finish storing, and reload. `checkForUpdate()` runs when the app returns to the foreground.
- Audio packs, stroke data, the dictionary and the pinned Firebase SDK are in `zika-assets-v1`, cache-first, kept across releases. Bump `ASSETS` only when a file under `assets/` changes.
- On `localhost` and `127.0.0.1` the worker stays off, so an edit shows on reload; add `?sw` to the address to try it. `node tools/swtest.mjs` tests it for real.

## Key structures

- `BOOKS` — `[{n, zh, first, count}]`. **Everything on screen is book by book** ("Book 2 · Lesson 7", `lnLabel` → "B2 L7"); Thorne does not want a running total of lessons anywhere. Pickers use `lessonPick()` (book, then lesson) and `bookButtons()`. Internally a lesson is still one index (`w.l`, Book 1 = 1–15, Book 2 = 16–30) because saved progress and ordering depend on it — treat that index as a private key and never print it. `bookOf`, `lnInBook`, `lnLabel`, `lessonsOf`, `bookRange` and `MAX_LN` derive from `BOOKS`. **Adding a book = one entry here plus data.**
- `WORDS` — `{id, l, t, p, pos, m, s?}`: lesson, traditional, pinyin, part of speech, meaning, simplified if different.
- `GRAMMAR` — `{ "<lesson>": [{id, t, e, pat, tgt, alt, s:[{zh, en, py}], …}] }`.
- `COMPONENTS` — per character `{p, g, d:[parts], t:type, s:semantic, ph:phonetic}`.
- `S` (state) — `my` (the personal deck, see My words), `cards`, `settings`, `log` (per-day counts), `intro`/`cintro`/`gintro` (per-day intake by lane), `hard`, `pick`, `sib`, `hist`, `mtest` (writing-test results `m`/`l`/`h`), `exam`, `gram`, `cf`, `conf`, `listen`, `read` (stories read), `us` (usage-phrase practice per word, see [content.md](content.md#usage-phrases-用法)), `tone` and `vp` (the tone coach's results and its picture of the learner's voice, each with its own version marker, see [voice.md](voice.md)).
- A card: `{st:'learn'|'rev'|'relearn', S, D, due, last, reps, lapses, days, known?, susp?, leech?, mastAt?}`. A card object with no `st` is queued but not started.

## App shell

How it should look and why is in [design.md](design.md). The pieces:

- `.mast` is the sticky top bar; `shLook()` applies the palette (`html[data-pal]`), the accent (`html[data-accent]`) and the character face (`html[data-zh]`) from `S.settings.palette`, `S.settings.accent` and `S.settings.zhFont`, and writes `zika_look` to localStorage so a one-line script in `<head>` can paint the right theme before the deck is parsed.
- `shHome()` runs after every `renderHome` layer: it adds the greeting, the course chip and the two deck tiles, and moves every card below the lanes into one `<details class="fold">` (open or closed is remembered per device in `zika_home_more`).
- `shCourse()` is the *Where you are* sheet: `shSetLesson()` sets `S.settings.curLesson`; the name is `S.settings.userName`.
- Tabs created after start-up get their icon from `TAB_ICON` through `shTabIcons()`.
- A sheet (`.modal-card`) is never taller than the screen: it scrolls inside itself (v60). Toasts sit above sheets, so an Undo offered while a sheet is open can be tapped.

- Phones (≤700 px): the tab bar is fixed to the bottom — Today, Review, Drill, 大考試, More. The other tabs carry class `t2` and sit behind More. Tablets and desktop keep the top bar. In Review the grade buttons are sticky just above that bar (`#vRev .grades`), so a long answer never pushes them off the screen.
- The page never zooms (`maximum-scale=1`, `touch-action: pan-x pan-y`): it is an app, not a document.
- Refresh: the ↻ button, pull-down inside the Home Screen app, and `checkForUpdate()` when the app returns to the foreground (it compares `sw.js` on the server with `APP_VERSION`); see *The service worker and releases* above.

## My words

A personal deck for words outside class, deliberately separate from the course: it never appears in `S.cards`, the lanes, the Library or the Brain, and it does not count toward the course's daily numbers.

- State: `S.my = {n, w:{u1:{t,p,m,at,g?}}, c:{'u1:rec':card,'u1:prod':card}, intro:{day:n}, log:{day:n}, perDay, both, tp:[{id,n}], tn}`. It is part of `S`, so it syncs and backs up with the deck. Always reach it through `myDeck()`, which creates what is missing (a deck adopted from an older device has no `S.my`).
- Ids are `u` + a counter that only goes up; a deleted word's id is never reused.
- `myQueue()` → `{learn, rev, fresh, ahead, waiting}`; `myRate(cid, grade)` is the same FSRS-5 arithmetic as `rate()` without the early-drill cap and without touching `S.log` or `S.intro`.
- **Pinyin and meaning fill themselves in** (v62). `myGuess(t)` → `{p, m, alts, parts, src}`: the course's own reading and meaning if the course teaches the word, then the dictionary (`dcLook`), then pinyin character by character from `COMPONENTS`. In the add sheet `myFill()` runs on every change to the characters; a field is filled only while it is empty or still holds what was filled in last (`MY.auto`), so anything typed by hand stays. `myHint()` paints the note under the characters: other readings as buttons (`myUseAlt`), or the parts of a phrase the dictionary does not hold as one word. `myParse()` reads a pasted list and fills what each line leaves out; `myFillMissing()` does the same for words already in the deck.
- **The dictionary** is `assets/dict.txt`: CC-CEDICT cut down by `tools/build_dict.py` to one line per word, `字<TAB>pinyin<TAB>gloss` and then further pinyin/gloss pairs for other readings ([content.md](content.md#the-dictionary)). `dcLoad()` fetches it (7 MB, about 3 MB over the air) the first time My words is opened and keeps it in a `Map` (`DC.map`); the service worker stores it with the other assets, so it works offline afterwards. `dcLook(t)` returns the word, or failing that its parts by longest match (pinyin only, with 一 and 不 written as spoken). Everything that uses it copes with `DC.map` being null (not loaded yet, or offline before the first fetch). After a rebuild, bump the `?v=` in `DC.url`.
- **Topics** (v60) sort the deck by part of life (Food & drink, Getting around, …). `d.tp` is the ordered list `[{id:'t1', n:'Food & drink'}]`; ids are `t` + a counter (`d.tn`) that only goes up, and a word names its topics in `w.g` (absent when it has none; a word can have several). `myDeck()` seeds the twelve starting topics (`MY_TOPICS`) the first time, with the same ids on every device. Read a word's topics through `myTopicsOf(w)`, which drops ids of deleted topics; write them with `myTag(w, ids)`.
- The list's filter is `MY.tp` (null, a topic id, or `'-'` for words with no topic) and `myQueue(filter)` builds the queue for it, so *Study* studies the topic on screen (`MY.scope` while the session runs). The daily allowance of new cards stays the deck's. The filter row shows only topics that hold a word; the chips in the add / edit sheet (`myChips`, selection in `MY.sel`) show all of them and change without repainting the sheet, so nothing typed is lost. `myTopicsSheet()` renames, deletes (with Undo) and adds.

## Scheduler

FSRS-5 with the default weights. Words have two cards, `rec` and `prod`; `prod` cards are forced back on days 1/2/3 before FSRS takes over (`capEarly`). `buildQueue()` returns `{learn, rev, fresh}` and is cached for 400 ms (`QV` is bumped by every `save`). Lanes (`laneOf`): `live` = lessons ≥ `curLesson − 1`; `catch` = writing-test `l`/`h` results or the hard list; `maint` = the rest.

## Sync

Whole-state, last-write-wins. `save()` → debounce 700 ms → `set(rooms/<code>/study_state, {json, synced_at, device, …})`. The database rejects a write whose `synced_at` is not newer. A device with no study history adopts silently; otherwise a conflict modal blocks pushes until the user picks. `rooms/<code>/sync_log` keeps the last 50 pushes.

## Audio playback

`playAudio(text)` → bundled pack (the voice chosen in Settings, from the packs this deployment carries) → system `speechSynthesis` as fallback. A pack is one file of concatenated MP3s plus `{key: [offset, length]}`; `audioKey()` reduces a word to its Han characters. Rebuild or extend a pack with `tools/build_voice_pack.py`; it reads WORDS, so new lessons are covered automatically. Packs, clip keys and the builders are in [voice.md](voice.md).

## External services

- **Firebase** project `zika-sync` (Realtime Database, asia-southeast1, anonymous auth, Spark plan). Rules are in README.md.
- **Notion** is not connected by API. The app holds page links (`NOTION`, `NOTION_LESSON`) and exports a confidence snapshot that is applied to Notion by hand.
- **萌典** (moedict.tw) is fetched live for the dictionary panel and cached locally.

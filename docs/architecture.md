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
| `chars.js` | Character components and etymology, the anatomy line on card backs, links to look a word up elsewhere, stroke order (Hanzi Writer). |
| `dict.js` | The dictionary: the word list (`assets/dict.txt`), the entry sheet every tap on a character opens, the search the Library uses. |
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
| `my-words.js` | My words. |
| `boot.js` | Start-up. |

## Start-up

The saved deck is read earlier than start-up, where `S` is defined in `js/core.js` (`deckLoad`), and nothing may write it until start-up says so (`DECK_READY`; see *Saving*). `js/boot.js` then runs five steps in order: `bootLoad` (is this a device with no deck; where sync stood), `bootMigrate` (one-time changes to older decks, each behind a flag in `S.settings`), `bootMount` (the parts of the page built by script: sync pill, the Catch-up, 大考試 and My words tabs, More, icons), `bootListen` (keyboard, touch, page lifecycle), `bootStart` (theme, the first paint, sync, the service worker, audio warm-up).

- **A start that fails closes the app for that load.** The first script in `index.html` (it comes before the stylesheet, so that it hears of every file) counts three things as a failed start until `window.zikaStarted` is set: a script or the stylesheet that does not arrive; a syntax error in one of the app's files, or an error while one is being read in (a file cut off on the way); and a start-up that has not finished when the page has loaded. A fourth is checked by `js/boot.js` itself (`bootLost`): every file under `js/` ends with `if(typeof zikaWhole==='function')zikaWhole();`, which reports that it ran to its last line, each data file is known by its tables, the QR library by its name and (since v64) the stylesheet by its last rule, `html{--zika-css-whole:1}`, which must stay the last; a file cut off between two statements raises no error and is caught by what it did not report. Only files under the page's own folder count: a script that an extension puts on the page can fail without shutting the app. On any of these the page shows "字卡 could not start" with the reason and **Try again**, sets `window.zikaFailed`, closes the deck (`DECK_READY=false`), makes everything else on the page `inert`, holds the focus on the button and cancels every key that is not the browser's own. `js/boot.js` runs none of its five steps. Why so strict: with a file missing the steps would all run, the missing one skipped quietly, and what was left could grade a card (the checker did that from the keyboard on v63's first pass, and by Tab and Enter on its second). The harness scenarios `start-file-lost`, `other-file-lost`, `stylesheet-lost`, `file-cut-in-half`, `file-cut-between-lines`, `data-cut-in-half`, `stylesheet-cut-in-half`, `stylesheet-cut-to-nothing`, `qr-library-cut-at-its-line` and `foreign-script-lost` hold it; `node tools/check.mjs` fails if a file under `js/` lacks its last line or the reporting script is not first.
- A new file under `js/` ends with that same last line, and is added to the script list in `index.html` before `js/boot.js`.
- A new one-time migration goes at the end of `bootMigrate` with a new flag ([CLAUDE.md](../CLAUDE.md), rule 3), and the flag is added to `BOOT_FLAGS` so that a device with no deck (`bootFresh`) starts with it set instead of running it.
- **A device with no deck** starts clean at Book 1 Lesson 1 and gets the welcome sheet (`shWelcome` in `js/shell.js`); `S.settings.born` marks such a deck. Decks without it are the first learner's and keep his defaults and Notion links (`linksOn`).
- **What start-up writes by itself must not look like work the learner did.** The day's time-lapse entry and the three oldest migrations store the deck with `saveLocal()`, which writes to the device and queues the backup but does not mark the device as holding unsent changes. A start-up `save()` on an idle linked device raises a sync conflict when another device is ahead; the harness's `open-*` scenarios hold this in place.

## Saving

Every write of the deck to the device goes through `deckStore()` (`js/core.js`), which refuses before start-up has loaded the deck (`DECK_READY`) and refuses to put a deck with no cards over a stored one that has cards unless the learner asked for that (`DECK_EMPTY_OK`: erase, import, restore, taking the cloud's copy). The cloud push, the backup file and the snapshots hold back in the same cases. Why: [decisions.md](decisions.md).

Every change to `S` ends in `save()`. Many changes in one tick make one write (`saveNow`): the cached queue is dropped, the confidence snapshot refreshed, the deck stored, the backup file queued, and the device marked dirty with a cloud push scheduled (unless the change is the cloud's own copy being adopted).

## One definition per function

Until November 2026 the app was version blocks, each wrapping or replacing earlier functions; fifty functions carried 129 layers. Every function now has one definition. `renderHome`, `renderSet`, `renderRev` and `renderDrill` still read as steps in the order the versions added them (build the page, then insert, move or remove parts of it); rewriting each as one direct build is on the [roadmap](roadmap.md). Do not add a wrapper again: change the function, or add a step to it.

**A drill that takes over the Drill tab** (Stories, 用法) registers once: `DRILL_SCREENS[mode] = {start, render}` at the end of its file, plus its line in `DMODES` (`js/drills.js`). `start()` sets `drillMode` and calls `go('drill')`; `render()` paints `#vDrill` while `dq` is null.

## The service worker and releases

`sw.js` stores the whole app shell (the page, `js/`, `css/`, `data/`, the manifest; 35 files) once per release and serves it from that store, so opening never waits for the network and a page never runs with scripts from two versions.

- `node tools/stamp.mjs` writes the release number onto the address of every shell file in `index.html` (`js/core.js?v=64`; for devices still run by the v62 worker, see [decisions.md](decisions.md)) and then the file list and a hash of each file into `sw.js`. A device installing a release copies unchanged files from the release it already holds and downloads the rest, checking each against its hash; any mismatch (the host still serving part of the previous release) refuses the install, and the device keeps what it has.
- The page hears when a new release has taken over (`swUpdated` in `js/shell.js`): it reloads at once if nothing has been touched since the app opened, otherwise it offers **Refresh**. The ↻ button and pull-to-refresh (`appRefresh`) push unsent work, ask for the newest release, wait for it to finish storing, and reload. `checkForUpdate()` runs when the app returns to the foreground.
- When it takes over, the worker removes every other cache but the assets. A worker from v62 or earlier (cache `zika-vNN`, storing whatever a page asks it for) may still be answering the reloading page at that moment and put its cache back; `sweepOld` removes such a cache, if its number is lower than this release's, each time the app is opened. A higher number is left alone: that is the old single-file app published again as a way back ([decisions.md](decisions.md)).
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
- The pinyin and meanings come from the dictionary's word list (`dcLook`, below).
- **Topics** (v60) sort the deck by part of life (Food & drink, Getting around, …). `d.tp` is the ordered list `[{id:'t1', n:'Food & drink'}]`; ids are `t` + a counter (`d.tn`) that only goes up, and a word names its topics in `w.g` (absent when it has none; a word can have several). `myDeck()` seeds the twelve starting topics (`MY_TOPICS`) the first time, with the same ids on every device. Read a word's topics through `myTopicsOf(w)`, which drops ids of deleted topics; write them with `myTag(w, ids)`.
- The list's filter is `MY.tp` (null, a topic id, or `'-'` for words with no topic) and `myQueue(filter)` builds the queue for it, so *Study* studies the topic on screen (`MY.scope` while the session runs). The daily allowance of new cards stays the deck's. The filter row shows only topics that hold a word; the chips in the add / edit sheet (`myChips`, selection in `MY.sel`) show all of them and change without repainting the sheet, so nothing typed is lost. `myTopicsSheet()` renames, deletes (with Undo) and adds.

## The dictionary

One entry sheet for any character or word, put together from what the app already holds (v65, `js/dict.js`). There is no dictionary tab: the entry opens from wherever a character is on screen, and the Library's search box searches it.

- **The word list** is `assets/dict.txt`: CC-CEDICT cut down by `tools/build_dict.py` to one line per word, `字<TAB>pinyin<TAB>gloss` and then further pinyin/gloss pairs for other readings ([content.md](content.md#the-dictionary)). `dcLoad()` fetches it (7 MB, about 3 MB over the air) the first time it is needed and keeps it in a `Map` (`DC.map`); the service worker stores it with the other assets, so it works offline afterwards. `dcWarm()` fetches it once in the background, nine seconds after start-up, on a device whose worker does not hold it yet, and Settings → Offline & audio → Download stores it too. `dcLook(t)` returns the word, or failing that its parts by longest match (pinyin only, with 一 and 不 written as spoken). Everything that uses the list copes with `DC.map` being null (not loaded yet, or offline before the first fetch). After a rebuild, bump the `?v=` in `DC.url`.
- **`dcOpen(text)` opens the entry**; `dcOpenWord(id)` for a course word. `dcZh(text)` returns a text with each Han character wrapped to open its own entry: use it wherever characters are shown as an answer (card backs, Library and My words rows, revealed drill answers, the Stories gloss), and never on a question side, where the entry would give the answer away. The anatomy line's characters and parts, the Brain's tiles and the ⓘ button open entries too.
- **What an entry shows** (`dcRender`), for a character: the reading and a speaker; the learner's standing with it (stage, memory, first lesson, 简 form); the course's meanings, each with its lesson, then the dictionary's; stroke order with the stroke count; how it is built (`charStoryHtml`: parts, why, sound family); examples; the course's words that use it; more words from the dictionary; the outside look-up links. For a word: its characters as rows (each opens that character), strokes for up to four characters, examples, longer course words and dictionary phrases that contain it, and **Add to My words** when the course does not teach it. Entries opened from inside an entry stack (`DCV.stack`), with a back button.
- **The examples are the app's own**: the usage phrases of every word and the example sentences of every grammar point, indexed once (`dcIdx`), about 7,700 lines. `dcSents` puts whole sentences before phrases, lessons the learner has reached before later ones and the earliest first, and for a character takes a different word in each where it can. A word the course does not teach has examples only if the course's sentences happen to use it.
- **The course's side shows at once; the dictionary's side is filled in when the list is in memory** (`dcFill`: the "In the dictionary" lines and "More words"). An entry with nothing else to go on (a word from a search) is painted again when the list arrives.
- **The search** is the Library's box. Under the course's matches, `libDictPaint` lists up to twenty of the dictionary's (`dcFind`), leaving out words the course teaches. By characters it needs only the word list; by pinyin without tones or by meaning it uses an index built once in slices (`dcIndex`, `DC.ix`), scored with the Library's own `libScore`, and only a whole reading, the start of one, or one complete sense counts. CC-CEDICT has no word frequencies, so lists of dictionary words are ordered by `dcRank`: words written only with characters the course teaches first, everyday senses before variants and surnames, short before long.
- **The sheet has its own host** (`#dcSheet`), so it can open over a card. While it is up the first key listener on the page (`bootListen`) stops every key from reaching the screen under it, since a 3 would grade the card behind; Esc closes it. Stroke boxes keep their writers per host (`STROKE_W`), so **Replay strokes** on a card under the sheet still replays the card's.

## Scheduler

FSRS-5 with the default weights. Words have two cards, `rec` and `prod`; `prod` cards are forced back on days 1/2/3 before FSRS takes over (`capEarly`). `buildQueue()` returns `{learn, rev, fresh}` and is cached for 400 ms (`QV` is bumped by every `save`). Lanes (`laneOf`): `live` = lessons ≥ `curLesson − 1`; `catch` = writing-test `l`/`h` results or the hard list; `maint` = the rest.

## Sync

Whole-state, last-write-wins. `save()` → debounce 700 ms → `set(rooms/<code>/study_state, {json, synced_at, device, …})`. The database rejects a write whose `synced_at` is not newer. A device with no study history adopts silently; otherwise a conflict modal blocks pushes until the user picks. `rooms/<code>/sync_log` keeps the last 50 pushes.

## Audio playback

`playAudio(text)` → bundled pack (the voice chosen in Settings, from the packs this deployment carries) → system `speechSynthesis` as fallback. A pack is one file of concatenated MP3s plus `{key: [offset, length]}`; `audioKey()` reduces a word to its Han characters. Rebuild or extend a pack with `tools/build_voice_pack.py`; it reads WORDS, so new lessons are covered automatically. Packs, clip keys and the builders are in [voice.md](voice.md).

## External services

- **Firebase** project `zika-sync` (Realtime Database, asia-southeast1, anonymous auth, Spark plan). Rules are in README.md.
- **Notion** is not connected by API. The app holds page links (`NOTION`, `NOTION_LESSON`) and exports a confidence snapshot that is applied to Notion by hand.
- Nothing else is fetched while studying. The dictionary entry's look-up row links out to 萌典, MDBG, Pleco (on phones), Skritter and 字源; a character with no bundled stroke data (words outside the course) gets it from the Hanzi Writer data on jsDelivr.

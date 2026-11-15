# How the app is built

The app area: `index.html`, `sw.js`, `manifest.webmanifest`. Read this before changing code. The rules that protect saved progress are in [CLAUDE.md](../CLAUDE.md) and apply to every change.

## Reading `index.html`

Five lines of `index.html` are enormous single-line JSON blobs (`const WORDS`, `const GRAMMAR`, `const COMPONENTS`, `const READINGS`, `const USAGE`) and one is the minified QR library. Never read them whole; grep with `cut -c1-300` and parse them with a script.

## Script blocks

`index.html` holds two inline scripts that share one global scope. The first is everything up to v43, layer on layer. The second, added in v44, holds the shell (`sh*`: top bar, tab icons, the look, *Where you are*, the Today layout) and My words (`my*`). The third, added in v50, holds the usage phrases (`us*`), their `USAGE` data line and the wide-and-short layout for the answer side of a card. New features go in the second block, or in a new block of their own, as plain functions with a prefix. `tools/check.mjs` syntax-checks every block.

A function in a later block is not defined while the first block paints the opening view, so the first block calls it guarded: `window.usBlock?usBlock(w):''`.

**A drill that takes over the Drill tab** (Stories, 用法) does not wrap `startDrill` / `renderDrill` again. It registers once: `DRILL_SCREENS[mode] = {start, render}` (defined beside the Stories code), plus a `DMODES.push` for its tile. `start()` sets `drillMode` and calls `go('drill')`; `render()` paints `#vDrill` while `dq` is null.

## Layers

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
- Refresh: the ↻ button, pull-down inside the Home Screen app, and `checkForUpdate()` when the app returns to the foreground (it compares `sw.js` on the server with `APP_VERSION`).

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

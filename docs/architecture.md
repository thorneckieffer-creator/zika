# How the app is built

The app area: `index.html`, `sw.js`, `manifest.webmanifest`. Read this before changing code. The rules that protect saved progress are in [CLAUDE.md](../CLAUDE.md) and apply to every change.

## Reading `index.html`

Three lines of `index.html` are enormous single-line JSON blobs (`const WORDS`, `const GRAMMAR`, `const COMPONENTS`) and one is the minified QR library. Never read them whole; grep with `cut -c1-300` and parse them with a script.

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
- `S` (state) — `cards`, `settings`, `log` (per-day counts), `intro`/`cintro`/`gintro` (per-day intake by lane), `hard`, `pick`, `sib`, `hist`, `mtest` (writing-test results `m`/`l`/`h`), `exam`, `gram`, `cf`, `conf`, `listen`.
- A card: `{st:'learn'|'rev'|'relearn', S, D, due, last, reps, lapses, days, known?, susp?, leech?, mastAt?}`. A card object with no `st` is queued but not started.

## App shell

- Phones (≤700 px): the tab bar is fixed to the bottom — Today, Review, Drill, 大考試, More. The other tabs carry class `t2` and sit behind More. Tablets and desktop keep the top bar.
- The page never zooms (`maximum-scale=1`, `touch-action: pan-x pan-y`): it is an app, not a document.
- Refresh: the ↻ button, pull-down inside the Home Screen app, and `checkForUpdate()` when the app returns to the foreground (it compares `sw.js` on the server with `APP_VERSION`).

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

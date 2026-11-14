# Adding a book

The content area: `WORDS`, `GRAMMAR`, `COMPONENTS`, `BOOKS`, `LESSON_TITLES` and `DLGMAP` in `index.html`, `assets/strokes.json`, `tools/import_dangdai.py`, `tools/add_characters.py`, `tools/content/`. The schemas are in [architecture.md](architecture.md#key-structures); what is still to import is in [roadmap.md](roadmap.md).

## Where the content comes from

1. **The publisher's 當代中文 (DangDai) app, installed on Thorne's Mac.** It is the authoritative source. Each downloaded volume is a folder of local files, not just screens:
   - Find the folder with `mdfind -name ".syd" | grep SoyongMebook` → `…/Application Support/SoyongMebook/MBLCECC00N/`.
   - A volume holds five lessons. `MBLCECC002–004` are Book 1 (L1–5, 6–10, 11–15), `005–007` are Book 2, `008–010` are Book 3, and so on.
   - `*-01-03.sqlite` → table `newwords`: `id` (`b02u11_d2v003` = book 2, lesson 11, dialogue 2, item 3), `entry`, `pinyin`, `zhuyin`, `partofspeech`, `explantion` (sic), `category` (Vocabulary / Phrases / Names), `vocorder`. Table `menu` has lesson titles; `chinesecharacter` has radical and stroke count.
   - Dialogue and essay pages are images (`bNNuNN_tNNpNN.png`); audio is per-syllable MP3.
   - `<ISBN>-01-03.syd` is a text container (UTF-16) holding the lesson texts and the grammar section; the grammar titles are lines like `III. 差一點（就）… almost`. Read it for understanding only.
   - As of v41, Books 1–2 and Book 3 volume 1 (`MBLCECC008`, Lessons 1–4) are downloaded and imported. `MBLCECC009` (Lessons 5–8) and `010` (Lessons 9–12) still show a cover image only: **Thorne has to download them inside the app**, then run the importer again.
2. **Zhong Chinese** (app.zhongchinese.com) for cross-checking. The Chrome extension currently blocks that domain for Claude; Thorne has to allow it in the extension's site permissions.

The app's Books 1–2 word list has been checked against the publisher's table: 1,228 entries on both sides, same order, pinyin identical apart from nine cosmetic differences.

## What may be copied

Word lists and their metadata (pinyin, part of speech, a short gloss, which dialogue a word belongs to) go into the app. **The textbook's dialogues, essays and example sentences do not** — this repository is public and those texts are the publisher's. Read them to learn how the vocabulary and grammar are used, then write original sentences and short essays that use the same words and patterns. That is also what Thorne asked for: new short essays built from each lesson's vocabulary and grammar.

## Steps (as done for Book 3, Lessons 1–4)

```bash
V="…/SoyongMebook/MBLCECC009"
# 1. write tools/content/book3_grammar.py entries for the new lessons (original explanations and sentences)
python3 tools/import_dangdai.py --book 3 --volume "$V"     # words, titles, BOOKS, DLGMAP, grammar
python3 tools/add_characters.py --volume "$V"               # strokes.json + COMPONENTS
# 2. bump ?v= on strokes.json (index.html ×2, sw.js), APP_VERSION and VERSION
node tools/check.mjs
```

What the importer does by hand, for reference:

1. Add the book to `BOOKS` (use the real lesson count from the app's `menu` tables).
2. Append words to `WORDS` with new ids continuing from the current maximum, in `vocorder`. Never interleave: snapshots are positional.
3. Add `LESSON_TITLES`, the lesson's `DLGMAP` string (from the `_d1` / `_d2` part of each id; later books pair a dialogue with an essay), and `GRAMMAR` entries with original example sentences.
4. Add any new characters to `assets/strokes.json` (Hanzi Writer data format) and `COMPONENTS`.
5. Rebuild the voice packs with `tools/build_voice_pack.py` and bump `ASSETS` in `sw.js`.
6. `node tools/check.mjs` reports any lesson without words, character without strokes, or word without a clip.

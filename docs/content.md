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

## Stories (短文, v43)

Short original reading passages per lesson, shown by the `story` drill mode (functions prefixed `rd`).

- **Source of truth:** `tools/content/reading_passages.py` — `R[(book, lesson)] = [{t, en, zh, tr}]`. Thorne asked for new texts in different settings built from each lesson's vocabulary and grammar; these are written for the app, never copied from the textbook.
- **The rule:** a passage may use only characters that appear in some word up to its lesson (numerals are allowed). `python3 tools/check_reading.py` lists any character from a later lesson and how many of the lesson's new words the passage uses; `--write` installs the passages into the `const READINGS = …;` line of `index.html`.
- **In the app:** text is segmented longest-known-word first (`rdSegment`); tapping a word shows its reading and meaning and marks it for review; finishing sends marked words to the hard list and counts the read in `S.read`.
- **Coverage so far:** Book 3 Lessons 1–4, two passages each.

## Usage phrases (用法, v50)

For each word, a few short collocations and then one or two short sentences, so a word is learned with the company it keeps (搬 → 搬東西, 搬到台北, 搬出去, 我下個月要搬到學校附近。). Thorne asked for these in November 2026, starting at Book 2 Lesson 6.

- **Source of truth:** `tools/content/usage_phrases.txt`, one line per word: `詞: 中文 = English | 中文 = English`. Sections are `== 2.6` (book.lesson). The format is described at the top of the file. Written for the app, never copied from the textbook.
- **The rules,** enforced by `python3 tools/check_usage.py`: a phrase uses only characters met by the end of its word's lesson (numerals allowed); it contains its headword (for a separable verb, the characters in order: 潛過水); every word of a covered lesson has at least two phrases, people's names excepted. `--write` installs them into the `const USAGE = …;` line of `index.html`; `--show 2.6` prints a lesson with its pinyin for proofreading; `--review` lists every place a reading had to be chosen.
- **Pinyin is generated, not typed.** A phrase is cut into the longest words `WORDS` knows and each keeps the publisher's reading and spacing; a character standing alone takes the reading it has in `WORDS`; standalone 一 and 不 get their tone change; 了 after 不 or 得 is liǎo. Where a character has several readings the default is in `DEFAULT` in the tool, and the phrase can force one in place: `你得(děi)去`, `長(zhǎng)大`, `睡不著(zháo)`, `熱情地(de)`. Everyday words the course never lists (台灣, 電腦, 星期) are in `EXTRA` so they are written as one word. After adding phrases, read the `--review` list.
- **Writing them:** three to six per word; collocations first, shortest first; sentences last and short. Use the word in the sense the lesson teaches (the gloss in `WORDS`), plus a second very common sense where there is one (酸: 我的腿很酸). The checker's list of unknown characters is the guide to rewording; the common traps before Book 2 Lesson 11 are 讓, 被, 愛, 全, 條, 洗, 完, 懂, 跑 and 簡單.
- **In the app** (the third script block, `us*`): `usBlock(w)` puts the first three on the answer side of a review card with the rest one tap away, and all of them in the Brain's word detail; a phrase is spoken by the system voice when tapped (the packs hold words, not phrases). `S.settings.usageCards === false` turns the card list off. The 用法 drill shows the English and the phrase with the word blanked; a miss changes nothing by itself, and the finish screen offers to put the missed words on the hard list.
- **Coverage so far:** Book 2 Lessons 6–15: 436 words, 1,979 phrases.


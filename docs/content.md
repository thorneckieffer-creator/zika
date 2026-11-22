# Adding a book

The content area: the files in `data/` (`words.js`, `grammar.js`, `components.js`, `readings.js`, `usage.js`, each one `const NAME = <one line of JSON>;`, and `course.js` with `BOOKS`, `LESSON_TITLES` and `DLGMAP`), `tools/applib.py` (how every tool reads and writes them), `assets/strokes.json`, `tools/import_dangdai.py`, `tools/add_characters.py`, `tools/content/`. The schemas are in [architecture.md](architecture.md#key-structures); what is still to import is in [roadmap.md](roadmap.md).

## The dictionary

`assets/dict.txt` is the word list behind the dictionary entries and the Library's search ([architecture.md](architecture.md#the-dictionary)), and what My words fills pinyin and meanings from. It is [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) (CC BY-SA 4.0: free to redistribute with credit, which the add sheet and the README give), reduced by `tools/build_dict.py`:

```bash
# download cedict_1_0_ts_utf-8_mdbg.txt.gz from the page above and unpack it, then
python3 tools/build_dict.py /path/to/cedict.txt     # writes assets/dict.txt; then bump ?v= in DC.url (js/dict.js)
```

- One line per traditional headword of up to eight characters: the everyday reading first, up to three other readings after it. A gloss is at most four short items.
- **The pinyin is written the way the course writes it**, and the course is the measure: of the 1,381 course words the dictionary holds it reads 98.0% the way the course does (90.7% before the rules below); `node tools/check.mjs` prints the figure and fails under 97%. The rules, each found by comparing the two syllable by syllable (`taiwan_style()` in the tool):
  - a stated Taiwan reading is used (垃圾 lèsè), and longer words follow it (垃圾車);
  - a character keeps its Taiwan reading inside words (期 qí, 績 jī, 究 jiù, 微 wéi), except four the course does not teach that way (法, 應, 亞, 括);
  - Taiwan's full tone replaces the mainland's neutral one (朋友 péngyǒu, 衣服 yīfú, 回來 huílái), except on particles and suffixes, doubled characters and a few words (意思, 東西);
  - 一 and 不 carry the tone they are spoken with (yíyàng, yìqǐ, búcuò).
- What is left wrong is mostly characters with two readings where the neutral tone hid which one was meant (答應 dāyìng comes out dāyīng). The course's own reading always wins for a course word, so these only show in words outside the course.
- Not in it: slang and phrases (沒差), which get pinyin from their parts and no meaning; simplified headwords; how common a word is. The lines are in CC-CEDICT's own order, so the app orders the dictionary's words by what the learner can read (`dcRank`). If a frequency list is added, the simplest way is to write the lines most common first: the app already keeps the file's order among equals.

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
# 2. bump ?v= on strokes.json (js/chars.js, sw.js), APP_VERSION and VERSION; then node tools/stamp.mjs
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

## Usage phrases (用法)

For each word, a few short collocations and then one or two short sentences, so a word is learned with the company it keeps (搬 → 搬東西, 搬到台北, 搬出去, 我下個月要搬到學校附近。). Thorne asked for these in November 2026: first Book 2 Lessons 6–15 (v50), then every lesson, a lesson picker for practising them, and a sentence on every write card (v51).

- **Source of truth:** the `.txt` files in `tools/content/usage/`, one per run of lessons (`b1-l01-03.txt` …), read in name order. One line per word: `詞: 中文 = English | 中文 = English`; sections are `== 2.6` (book.lesson). `00-format.txt` there describes the format. Written for the app, never copied from the textbook.
- **The rules,** enforced by `python3 tools/check_usage.py`: a phrase uses only characters met by the end of its word's lesson (numerals allowed); it contains its headword (for a separable verb, the characters in order: 潛過水); every word of a covered lesson has at least two phrases and at least one full sentence (ending 。？！), people's names excepted. `--write` installs them into the `const USAGE = …;` line of `data/usage.js`. `--words 2.6` lists a lesson's words and the characters it may use; `--file PATH` checks one file; `--show 2.6` prints a lesson with its pinyin for proofreading; `--review` lists every place a reading had to be chosen.
- **Pinyin is generated, not typed.** A phrase is cut into the longest words `WORDS` knows and each keeps the publisher's reading and spacing; a character standing alone takes the reading it has in `WORDS`; standalone 一 and 不 get their tone change; 了 after 不 or 得 is liǎo. Where a character has several readings the default is in `DEFAULT` in the tool, and the phrase can force one in place: `你得(děi)去`, `長(zhǎng)大`, `睡不著(zháo)`, `熱情地(de)`, `陳(Chén)先生`. Everyday words the course never lists (台灣, 電腦, 醫院) are in `EXTRA` so they are written as one word; add to it when `--show` prints a common word as separate syllables. After adding phrases, read the `--review` list.
- **Writing them:** three to five per word (two or three in the first lessons of Book 1, where few characters exist); collocations first, shortest first; sentences last and short. Use the word in the sense the lesson teaches (the gloss in `WORDS`), plus a second very common sense where there is one (酸: 我的腿很酸). The checker's list of unknown characters is the guide to rewording. Several lessons can be written at once, one writer per file, each checking with `--file`.
- **In the app** (`js/usage.js`, `us*`):
  - `usBlock(w)` puts a sentence and two phrases on the answer side of a review card (sentence first; the rest one tap away), and all of them in the Brain's word detail. A phrase is spoken by the system voice when tapped (the packs hold words, not phrases). `S.settings.usageCards === false` turns the list off.
  - `usHint(w)` (off unless `S.settings.usageHint === true`) shows the sentence with the word left blank on the question side of a write card.
  - The 用法 drill opens on a start screen: pick the book and lesson, then a 12-phrase quiz, the whole lesson, or *Browse the phrases* (every word of the lesson with all its phrases). The hard list and the words due now can be quizzed too. A question gives the English and the phrase with the word blanked. `S.us[wordId] = [right, missed, last answer 1/0]` orders the quiz (never asked first, then missed last time) and draws the lesson's progress bar; a miss changes nothing else, and the finish screen offers to put the missed words on the hard list.
- **Coverage:** every lesson of Books 1–3 that the app holds. `node tools/check.mjs` prints the totals.
- **Who wrote them:** Claude, lesson by lesson; nobody who speaks Mandarin natively has reviewed them. If Thorne or a teacher flags a phrase, fix it in the source file and rerun `--write`.

## Which pattern? (句型, v66)

Pairs of patterns that both look as if they fit, each with the one-line test that decides between them. The drill shows a sentence with a blank and its English, and the pair as the choices; the answer side gives the right word, why, the test, and the same frame with each choice used correctly.

- **The source is `tools/content/pairs.txt`**; its first lines describe the format. A pair is added there and nowhere else: no code changes.
- **`python3 tools/check_pairs.py`** checks it, **`--list`** prints every sentence with its answer filled in to read through, and **`--write`** installs it as `PAIRS` in `data/pairs.js`.
- **What the tool enforces**: every character is one the course teaches; a sentence is asked only from the lesson by which all its characters have been met (worked out by the tool and stored with the sentence), and never before the pair's own lesson; at least four of a pair's sentences can be asked at the pair's own lesson; one blank, an answer among two to four choices (the keys 1 to 4 choose), every choice the answer somewhere and with a side-by-side line; a side-by-side line uses only characters met by the pair's own lesson, since it is shown with every answer; no sentence that turns into another of the file's sentences when a wrong choice is put in.
- **What only a reader can check**: that for the meaning the English gives, one choice is right and the others are wrong. The English is on the question side for exactly this reason (他十點___來 takes 就 or 才; "He didn't come until ten" takes one). Write it so that it says which.
- **Whose they are**: the first eighteen pairs and their tests are Thorne's, from teacher-checked notes (21 November 2026). The other seven, and the older sentences of six of the eighteen, were the "Which one?" drill's list in the code until v65; they were carried over with their keys, so the tallies in `S.cf` still belong to them. Two things were changed to fit the rules: the old 因果 family offered four words, and its 要不然 and 如果 sentences are now a pair of their own (要不然／如果); the old 比較 family offered five, and its one 一樣 sentence went, since 跟…一樣／像…一樣 is a pair. Five of those older sentences used characters the course does not teach (抽菸, 聰明 and others) and were reworded.
- **A pair's key never changes** once it has shipped: the tally is kept under it.
- **Pick-type sentences** (`pick:`) ask for the whole sentence instead of a word, for word order: where 了 goes, and time-when against duration.
- Wording follows the course: Taiwan usage, plain English, no linguistics terms beyond the course's own (Vs).


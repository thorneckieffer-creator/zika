# Feature map

Every feature of the app: where it is, how to test it, and what good looks like. The checker (`.claude/agents/verify-app.md`) follows this file, so it has to stay true. **When a feature is added, renamed or moved, change its entry in the same commit.** A feature with no entry here does not get tested.

What "right" means on every screen is in [review-checklist.md](review-checklist.md). How to open the app at device sizes from Chrome is in [releasing.md](releasing.md).

Sizes: **phone** 390 × 844 · **iPad upright** 820 × 1180 · **iPad on its side** 1180 × 796.

Entries marked *(walked)* were checked against v62, and again by the checker against v63, on a fresh, unlinked deck at the phone size and at 1180 × 796. The checker walked Dictionary, the v65 parts of Library (phone rows, search), Brain, Review and My words rows, and Offline and updating on v65 at 390, 820 and 1180. Entries marked *(from the notes)* were written from the README and `docs/` and have not been walked yet. The checker cannot edit this file: the first one to test such an entry lists what it found under "Corrections to the feature map" in its report, and the session that made the change corrects the entry and removes the mark.

The checker empties the deck on its own local origin before each run, so every run starts fresh. A fresh deck opens on the welcome sheet (below). Finish it at Book 1 · Lesson 1 and Today shows that lesson's first words and grammar cards waiting. To add another lesson's words: Library → open a lesson → **Study lesson**.

## Core path (every review, all three sizes)

1. **It loads.** Open `index.html?t=<number>`. Today shows a greeting (with the name, if the learner gave one), the date, the course chip (the book, lesson and lesson title the learner is on: "Book 2 · Lesson 11" on Thorne's deck, the lesson picked on the welcome sheet for a new learner), and one filled button ("Start today's cards"; a deck with a sitting in progress shows "Keep going" and a small filled "Start" as well, as v64 did). Nothing scrolls sideways.
2. **The version is the new one.** Open Review: the foot of the page reads "FSRS-5 · vNN" with the version being released. It matches `VERSION` in `sw.js`.
3. **Navigation.** Phone: a bottom bar of five, Today · Review · Drill · 大考試 · More, and More shows the rest (Catch-up, Grammar, Brain, Library, My words, Settings). Wider: one text row under the top bar with Today · Review · Drill · Catch-up · 大考試 · Grammar · Brain · Library · My words, and Settings behind the sliders icon in the top bar. Open every destination once: each paints its screen, none is blank.
4. **Review one card.** Review → **Show answer** (or Space) → the answer appears with four grade buttons, Again · Hard · Good · Easy, each with its interval under it → tap **Good** (or 3) → the count moves ("1 done") and the next card shows.
5. **The answer side fits.** At 1180 × 796 the whole answer and the four grade buttons are on screen without scrolling. On the phone the grade buttons sit above the bottom bar.
6. **One drill.** Drill → **認字 Recognition** → a question with four choices and a header "1 / 20 · 0 right · exit" → answer one → it marks the answer, counts it and shows the word with a **Next →** button; Next moves on → **exit** returns to the Drill tab.
7. **Reload.** Reload the page: the card graded in step 4 is still counted, and the deck is as it was.
8. **Night.** Tap the moon in the top bar: every screen opened so far is readable in the night colours. Tap it again.
9. **Console.** No errors from the app's own code, and no failed request for a file the app ships.

## Welcome *(new in v63, checked by the harness scenarios `first-run*`)*

- **Where:** it opens by itself on a device with no deck and no sync code. It does not open on a deck that has been studied, nor when the app is opened from a sync link.
- **How to test:** empty the deck and reload. Type a name, pick Book 2 and a lesson, switch on "I know the lessons before this one", tap **Start**. Empty the deck again and tap "I already use 字卡 on another device".
- **Good looks like:** a sheet titled "Welcome to 字卡" with a name field, book and lesson pickers, the lesson's title, and one filled button "Start with Book N · Lesson N". After Start: the greeting carries the name, the course chip shows the chosen lesson, the lesson's first words are waiting, earlier lessons are marked known if asked, no exam line, no links to Notion anywhere, and no "Cloud sync is off" card. The other-device link closes the sheet and puts the cursor in the sync code box on Today; the sheet returns on the next open until it is finished or a deck arrives.

## Could not start *(new in v63, walked; the v64 cases walked on v64; harness scenarios `start-file-lost`, `other-file-lost`, `stylesheet-lost`, `file-cut-in-half`, `file-cut-between-lines`, `data-cut-in-half`; in v64 `stylesheet-cut-in-half`, `stylesheet-cut-to-nothing`, `qr-library-cut-at-its-line`, `foreign-script-lost`)*

- **Where:** over the whole page, when a file of the app does not arrive, arrives cut short, or start-up stops part-way.
- **How to test:** serve copies of the folder broken one way each: a script removed (`js/home.js`, `js/review.js`, `js/core.js`), `css/app.css` removed, a file in `data/` removed, a script cut in half, a script with its last line removed, the stylesheet cut in half and delivered empty, `assets/qrcode.min.js` cut to its first line, a `throw` added to `js/boot.js`. The harness's server does all but the last by address (`?drop=<path>`, `?cut=<path>&keep=half`, `?cut=<path>&keep=1`, `?cut=<path>&keep=none`). Also a copy of the page with one extra tag, `<script async src="http://127.0.0.1:9/not-the-apps.js">`, loaded several times (add `?slow=js/boot.js&ms=900` so the failure comes before start-up): the app must start. With the message up: click and tap under it; press Tab and Shift+Tab several times, then Enter; press `r`, `1`–`4` and the other shortcuts (Space and Enter last: with the focus on **Try again** they reload, as they should); click the message's background and type. Compare everything in `localStorage` before and after.
- **Good looks like:** "字卡 could not start." with the reason ("A file did not arrive (js/home.js). Check the connection.", "A file did not arrive whole (js/home.js). Check the connection." or "Something stopped it part-way."), "Your progress on this device is safe.", and **Try again**, which has the focus, keeps it through Tab and clicks, and reloads on a click, Enter or Space. Nothing under it answers to mouse, touch, keyboard or focus; the app has not started (`zikaStarted` unset, `DECK_READY` false); every key in `localStorage` is byte for byte as it was (when start-up had begun before it stopped, what it had already written stays, as on a normal start; nothing is written once the message is up). A data file cut at its line break reads "Something stopped it part-way." Since v64 a stylesheet or the QR library that arrives cut short or empty gives "A file did not arrive whole (css/app.css)" or "(assets/qrcode.min.js)", and a script that is not under the page's own folder (an extension's) failing early does not bring the message up: the app starts. A normal start shows none of this, in Chrome or in WebKit, with any one file arriving late.

## Today *(walked)*

- **Where:** the first tab; the mark and name in the top bar also go there.
- **How to test:** open it on a fresh deck and on one with reviews done. Tap the course chip. Tap **Start today's cards**. Open the fold at the bottom ("Plan, queue and progress").
- **Good looks like:** greeting and date → course chip → the hero (a ring with done-of-total, "N waiting for you", one filled button, "or a quick 20" under it) → the exam countdown when an exam is set → two decks (the course lesson, My words) → the three lanes (This week, Catch-up, Maintenance), each with its counts and a button → the fold. When nothing is due the hero says so and still offers a way to keep going. Lesson names are always "Book N · Lesson N" or "BN LN".

## Where you are *(walked)*

- **Where:** the course chip on Today; also Settings → You → **Change**.
- **How to test:** open the sheet, pick another book and lesson, tap **Done**, then put it back.
- **Good looks like:** a sheet titled "Where you are" with two drop-downs (Book, Lesson), the lesson title, "N of N words started", **← Previous lesson** / **Class moved on →**, and a name field. Today's chip, the This week lane and the Drill tab's scope follow the choice. The sheet is never taller than the screen.

## Review *(walked)*

- **Where:** the Review tab; also every "Start" on Today.
- **How to test:** review a grammar cloze card and a word card of each kind (recognise and write). Reveal, grade with the buttons and with the keys (Space, 1–4). Use **← back** after grading. Finish a session.
- **Good looks like:** the header shows "N done · N left", **focus**, and the card's kind. A grammar card shows the sentence with a blank and the English; the answer fills the blank, adds tone-coloured pinyin, the pattern's name, a speaker button and a Notion link. A word card's answer side shows the word, pinyin, meaning, its usage phrases (用法), a microphone for the tone coach and, after it, the text button **Sounds wrong** (below); tapping a character of the word, or a character or part in the breakdown line under it, opens its dictionary entry (below); a write card adds the stroke boxes and **Replay strokes**. The Notion link on a grammar answer is hidden on a new learner's deck. The grade buttons show the next interval; Good on a new card says minutes, Easy says days and a date. A finished session shows a summary (cards, recalled, minutes, best run, new words, streak) and **Back to Today**.

## Sounds wrong *(new in v67; harness scenario `sounds-wrong`)*

- **Where:** a small text button, "Sounds wrong", beside the speaker in two places: the answer side of a word card in Review (recognise and write), and the head of a Dictionary entry. The list it keeps is in Settings → Audio & strokes → **Sounds wrong · N**, with **Copy list** and **Clear**.
- **How to test:** Review → look at the question side → **Show answer** → tap **Sounds wrong** → press 3. On the next card tap it twice. Open a character from the Library and tap it in the entry. Settings → Audio & strokes: read the count, **Copy list**, paste somewhere; **Clear**, then **Undo** in the toast. Reload. All three sizes, day and night.
- **Good looks like:** the question side has no such button (a recognise card before the answer, and the 聽寫 question with its large speaker). On the answer side it reads "Sounds wrong" in the link colour; tapped, it turns amber with a tick, and nothing on the card moves: the tick's room is always there. On a phone a word with a long reading sends the button to a line of its own under the speaker (about a quarter of the words); on the two tablet sizes it stays on the speaker's line and the card is exactly as tall as in v66. Tapped again, the mark is off. The keys 1–4 grade whether or not the button was just tapped. The row in Settings counts the marks; Copy list puts one line a word on the clipboard, tab-separated: the word, its pinyin, the voice (曉臻 (audio-tw), 雲哲 (audio-tw-m), or "system voice" when the device's own voice said it) and the date; where the browser will not copy, the list opens in a sheet to copy by hand. Clear empties it and offers Undo. The marks are still there after a reload.
- **Must not:** show on a question side; move the grade buttons or push them off the screen (line 5 of the checklist); change the saved deck in any way (the list is the device's own, in `zika_sounds_wrong_v1`: it does not sync and is not in an export).

## Not saved *(new in v67; harness scenario `storage-full`)*

- **Where:** a banner under the top bar, on every screen, when the browser refuses to store the deck.
- **How to test:** it needs a browser that will not store: in the console, `const real=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k==='shida_b1_fsrs_v2')throw new DOMException('full','QuotaExceededError');return real.apply(this,arguments);}`, then grade a card. Put it back (`Storage.prototype.setItem=real`) and grade another.
- **Good looks like:** "Progress is not being saved on this device since 14:32. The browser’s storage is full or switched off, so what you study now is lost when this page closes. Keep a copy: Settings → Backup → Export." in the same amber banner as "No backup in over a week". It stays through every screen and every further grade, with the time of the first refusal. Studying goes on, Export works, and a linked device still sends to its room. The banner goes by itself at the first save that gets through. A normal start, an empty deck that the app itself refuses to store over a full one, and a page that has not started never show it.

## Drill tab *(walked: the tab, the fold, Recognition and Tones; the other drills from the notes)*

- **Where:** the Drill tab.
- **How to test:** change the scope (A lesson · My hard list · Due now · Whole deck; then book and lesson). Start each drill the change touches and answer at least three questions. Leave with **exit**.
- **Good looks like:** scope pickers at the top, then tiles: 聽寫 Dictation · 認字 Recognition · 聲調 Tones · 寫字測驗 Mastery test · 句型 Which pattern? · 聲調教練 Tone coach · 短文 Stories · 用法 Phrases, and a fold "More drills · sentences, listening, grammar" holding five tiles: 聽力 Listening, 句子聽寫 Sentence dictation, 閱讀 Reading sprint, 造句 Sentences, 口說 Speaking. Below: 口試 Exam simulator (**Generate a prompt**) and Your tones (the sixteen tone pairs). A scope line says how many words and grammar points are in play. Every drill has a progress header, and its end screen offers a next step. Not every drill has a way out yet: 聽力 Listening has none but a tab or a reload, and Reading sprint and Sentence dictation have none in the middle of a round (seen by the checker on v66, there before it; on the roadmap).

## Which pattern? 句型 *(new in v66; walked by the checker on both passes)*

- **Where:** Drill tab → 句型 Which pattern? (the fifth tile, between Mastery test and Tone coach). Also Grammar tab → "Grasp · by family" → **Which one?**, on a family whose pair the learner's lesson has reached.
- **How to test:** open it; change the lessons (Up to my lesson · a book · From … to …); start a pair from its tile, answer right and wrong; start **Mixed set**; use the keys 1–4, Enter, Space and Escape; press a tab's shortcut key (g, r) during a question; tap a character on the answer side; **Stop** and **← All drills**; finish a round. On a deck early in Book 1, open a pair from the Grammar tab. Phone, tablet and iPad landscape, day and night.
- **Good looks like:** a grid of pairs (就／才, 被／讓 …), each with its book and lesson and "new" or a score; a book is offered only if a pair becomes a choice in it. A question is one sentence with a blank, its English underneath, and two to four choices; nothing on it can be tapped for the dictionary and it has no speaker. Two pairs (了; time-when against duration) show three whole sentences to choose from instead. After an answer: the blank filled in (when the answer is "nothing" the sentence simply closes up), the right choice green and a wrong pick red, a line saying why, **The test** for the pair, and under it the same frame with each choice used correctly, at most three lines, the right one marked; on a whole-sentence question the lines are there and none is marked. Characters there open the dictionary, and the speaker reads the right sentence. On a phone **Next →** stays above the tab bar. A miss comes back once at the end of the round ("again"). The end screen gives the score, the test of each pair missed, **Again** and **Pairs**, with confetti. **Stop** goes back to the pairs, **← All drills** to the menu; leaving the Drill tab and coming back finds the round where it was (a finished round's end screen stays too, and its confetti plays again, as every drill's does). Opening a pair from the Grammar tab sets Lessons back to "Up to". A From … to … range can be empty, and its pickers list every book. The tab shortcuts work again on the pairs screen and the end screen. On a phone the third side-by-side line of a four-choice answer needs a scroll; at 1180 × 796 with the backup banner showing, **Next →** is cut by a few pixels after a wrong answer on a four-choice pair (it fits on the tablet's real 820).
- **The lesson rule:** no sentence and no side-by-side line uses a character from a lesson later than the last one in scope (numerals are exempt, as in the usage phrases): the learner's own lesson for "Up to" and from the Grammar tab, the range chosen otherwise, whether the round was started from a tile or as a mixed set.
- **Tallies:** the pair's score on its tile moves with every answer. The grammar point the right answer belongs to is counted too, where the pair names one; its dot in the Grammar tab's family moves once it has a few answers. No field is added to the saved deck.
- **Must not:** show the answer or a tappable character before the choice is made; grade twice on a double tap or a held key; answer from the keyboard under the dictionary sheet or the phone's More row; jump to another tab on a shortcut key while a question is open.

## Tone coach *(walked)*

- **Where:** Drill → 聲調教練 Tone coach; Drill → Your tones (Ten words, Ten short phrases, or a tone pair); the microphone on a review card's answer side.
- **How to test:** feed the recorder a synthetic tone as `docs/releasing.md` describes (no microphone prompt). Record, stop, move on. Keys: Space records and stops, Enter moves on, A tries again, L listens, Esc closes.
- **Good looks like:** the first use opens on "first, let the coach hear your voice" with Record and "skip for now". A take ends by itself when the sound stops. Then the learner's pitch curve drawn against the native speaker's, each syllable graded, one line on what to change, and Mine · Native · Again · Next. The card's microphone opens a sheet titled "Check my tones". A take too quiet to judge is not graded: it asks for a closer or louder one. Results fill the tone-pair map.

## Stories and Phrases *(walked)*

- **Where:** Drill → 短文 Stories; Drill → 用法 Phrases.
- **How to test:** open a story and tap a word. In Phrases pick a lesson, browse, then take the English-to-phrase round.
- **Good looks like:** Stories lists Book 3 lessons only (the others are not written); stories use only words learned so far, and a tapped word shows its pinyin, meaning and lesson under the passage. Tapping the Drill tab inside a story does not leave it: "back to the list", then "Back to drills". Phrases offers Quiz · 12 phrases, Whole lesson and Browse the phrases; they belong to the lesson picked and contain their word, and the quiz is graded Missed / Got it.

## Catch-up *(walked)*

- **Where:** the Catch-up tab (phone: More).
- **How to test:** open it; start **Test** on one lesson and grade two words (★ wrote it · ~ shaky · ✗ couldn't).
- **Good looks like:** a ring of ★ of total, the range ("B1 L9 → B2 L6"), counts for tested, shaky and ✗, **Review the shaky ones** and **Start the test**, an "already owned" block for earlier lessons, then one row per lesson with its counts and Test · 聽寫 · Notion. Do not press "Mark all mastered".

## 大考試 *(walked)*

- **Where:** the 大考試 tab; the countdown card on Today.
- **How to test:** open it; open **range · date**; start **Test** on one lesson and sort two words.
- **Good looks like:** tested-of-total, the range and the date with days left, three piles (✓ yes · ~ sorta · ✗ hell no) and untested, **Start the test**, then one row per lesson with Test · 聽寫 · Notion. The printable 田字格 sheet for missed words tapers ×20 → ×5 → ×1 *(from the notes)*.

## Grammar *(walked)*

- **Where:** the Grammar tab (phone: More).
- **How to test:** scroll the families; pick a book and lesson; open one point (▶); tap **Drill** on it; tap **+ Add N cloze cards** on a throw-away deck.
- **Good looks like:** "Grasp · by family" with a dot per pattern and Drill · Which one? (only once the learner's lesson has reached that family's pair; it opens the pair in 句型 Which pattern?) · + cards; then a book and lesson picker, the lesson's title ("B1 L1 · Welcome to Taiwan!"), its points with a one-line explanation each, and whether each has a card.

## Brain *(walked)*

- **Where:** the Brain tab (phone: More).
- **How to test:** switch Scope (Book 1 · Book 2 · Book 3 · Everything), View (Characters · Words) and Group (Stage · Lesson · Trad ≠ Simp). Tap a word type.
- **Good looks like:** "N / N characters mastered", the stage legend (Not started · Learning · Young · Solid · Mastered), the by-word-type tiles, the time-lapse, the mastered shelf, then the wall of characters for the scope. Counts change with the scope. Tapping a tile (a character, a word, a chip on the mastered shelf, a character in Sound families) opens its dictionary entry; since v65 there is no panel inside the page.

## Library *(walked)*

- **Where:** the Library tab (phone: More).
- **How to test:** switch books and filters (All · In deck · Due · Not started · Trad ≠ Simp). Open a lesson. On a throw-away deck tap **Study lesson**. In a word row tap a character, then the reading or meaning. Search "eat", "xue" and 學.
- **Good looks like:** a ring row per lesson, then each lesson with "N of N in deck · N/N 字 known" and Triage · Triage 聽寫一 · Triage 聽寫二 · Study lesson · Know it all. A word row shows the word, its reading and meaning, its state, a speaker and its buttons; on the phone every row is two lines, the word with its reading, meaning and state, then the speaker and the buttons together (since v65: before, the reading and meaning had no room and the last button ran off the card); a long word (故宮博物院（故宮）) wraps inside the left half. Tapping a character opens that character's dictionary entry; tapping the reading or meaning opens the word's. A search lists the course's matches and under them "From the dictionary", up to twenty words the course does not teach (only with the All filter); the dictionary's own words come with what the learner can read first ("xue": 雪, 學人, 學位 before rare characters). If the word list cannot be fetched the search says so under the course's matches. On a phone a long meaning in a search row hides the lesson chip behind its "…". Do not press "Know it all".

## Dictionary *(new in v65)*

- **Where:** no tab of its own. A sheet titled "Dictionary" opens from any character shown as an answer: a Library word row (a character, or the reading and meaning for the whole word), the answer side of a review card (the big word, the breakdown line, the ⓘ), a grammar card's answered sentence, the Triage card, revealed answers in the drills, the writing test and 大考試, a My words row and its answer side, the word picked in a Story, a word's heading in Phrases, every tile in Brain, and the "From the dictionary" rows of a Library search.
- **How to test:** Library → open a lesson → tap 學 in a row. In the entry tap a part under "How it is built", a word under "Words with 學 in your course", then ‹ back. Tap an example. Open a review card's answer and tap a character, then press 3, Space and r: nothing behind the sheet may move; Esc closes it and 3 then grades. Search "eat" in the Library, open a dictionary row, tap **Add to My words**, then Undo in the toast. Look at an entry at night and at 1180 × 796. On a question side (a recognise card before **Show answer**, a tones question) a tap on the word must not open it.
- **Good looks like:** for a character: the character large with its tone-coloured reading, a speaker and **Sounds wrong** (above); its stage, 简 form, memory and "first met in B1 L3" when the course teaches it; the course's meanings, each with its lesson chip, then "In the dictionary"; "Stroke order · 16 strokes · radical in green" with the drawing and **Replay strokes**; "How it is built" with its parts as chips, one line of why, its sound family and where else each part turns up; "Examples · tap to hear", three sentences from the course with the character underlined, pinyin and English, and "N more"; "Words with 學 in your course" with lesson chips; "More words with 學 · from the dictionary"; the look-up links 萌典 · MDBG · Skritter · 字源 (and Pleco on a real iPhone, iPad or Android device: it goes by the device, not the width, so Chrome at 390 px does not show it); the CC-CEDICT credit. For a word: "Its characters" as rows that open each character, strokes for up to four different characters (a longer word says "Tap a character for its stroke order" instead), examples, and for a word outside the course **Add to My words** (or "In My words" with its state); the button is also offered for a part the dictionary does not hold (龺), which is saved with a reading and no meaning. A lesson is always "B1 L3". The sheet scrolls inside itself; a toast shows above it. The course's part shows at once and offline; the dictionary's part needs the word list (a 7 MB download the first time, then stored): without it an entry from outside the course says it needs a connection the first time, and **Add to My words** is not offered until the list is there. A long dictionary word's row puts its reading and meaning on lines of their own; nothing scrolls sideways. Strokes for a character outside `assets/strokes.json` (頸, 鹿: words outside the course) come from the network and do not draw offline; the entry then says "No stroke data for this character".

## My words *(walked: empty deck and the add sheet)*

- **Where:** the My words tab (phone: More); the My words tile on Today.
- **How to test:** **Add words** → type 垃圾 in the first field → wait a second. Pick a topic. Tap **Add**. Try **Paste a list** with two lines. Filter by topic. **Study**. Edit a word; delete one and tap Undo.
- **Good looks like:** an empty deck explains itself and offers "Add your first word". In the add sheet the pinyin and meaning fill themselves in (垃圾 → lèsè · garbage, the Taiwan reading); a field typed by hand is never overwritten. Twelve starting topics show as chips, plus **+ New topic**. The deck is separate: adding a word changes nothing in the course's counts on Today. A row's characters open their dictionary entries, and its reading and meaning open the word's. A word or topic made since v67 has the device in its id (`uz9q79vcb-3`); one made before keeps its own (`u1`, `t13`), and the two kinds list, filter, study, edit, delete and come back with Undo alike, before and after a reload (harness scenario `my-words-ids`; the ids are never on screen). The dictionary is a 7 MB download the first time it is needed (the app fetches it in the background soon after it opens).

## Settings *(walked: the sections; the controls from the notes)*

- **Where:** the sliders icon in the top bar; phone: More → Settings.
- **How to test:** change the setting the change touches, leave Settings, check the screen it governs, reload, check it held. For a device-local setting (voice, theme, backup file, offline pack), check it is still set after reload.
- **Good looks like:** these controls, top to bottom (the grouping here is a reading aid, not the on-screen titles): You (name, book and lesson, **Change**) · the device set-up steps · Cloud sync (status, Sync code, This device, Push and Pull, Sync log) · Daily intake (Live lesson, This week's new words, Catch-up words, Grammar cloze cards, Review cap, Desired retention, Write cards, Dictation drill order, Leeches) · audio (Audio source, Pronunciation voice, Auto-play on reveal, Audio speed, Sounds wrong · N with Copy list and Clear) · what cards show (Stroke-order animations, Pinyin under sentences, Character stories, Usage phrases, Sentence hint on write cards) · backups (Automatic backup, In-browser snapshots, Manual copy) · Appearance (Haptics, Animations, Palette, Accent colour, Character style) · card options (Recognize, Write, Include names, Early recall reps, Day-1 paper reps, Separate the two cards of a word, Cloze cards) · Confidence · Sync file. **Look at Cloud sync; do not press Generate, Link, Push or Pull.**

## Top bar *(walked)*

- **Where:** the top of every screen.
- **How to test:** tap each control.
- **Good looks like:** the mark and name (go to Today) · the sync pill (device badge and state) · refresh (↻) · day / night · Settings (wide screens). It stays in view while the page scrolls.

## Audio *(walked: the packs; the system voice from the notes)*

- **Where:** the speaker on any card or word; Settings → Audio.
- **How to test:** play a word and a single character; switch the voice (曉臻, 雲哲 when its pack is present); switch to the system voice.
- **Good looks like:** the bundled Taiwan voice plays for every word and character; where a pack has no clip the system voice speaks instead, with no error.

## Offline and updating *(walked)*

- **Where:** the service worker (`sw.js`); Settings → Offline & audio ("Store the voice pack, strokes and dictionary on this device", about 25 MB); the ↻ button.
- **How to test:** on `127.0.0.1` the worker is off unless the address carries `?sw`. Load `index.html?sw` once, stop the server, reload: the app still opens. Start the server again and tap ↻. When a file under `assets/` changed under the same name, check line 27 of the checklist.
- **Good looks like:** the worker holds all 35 shell files; the second load takes every script, style and data file from the store; the shell opens offline and a card can be graded; the audio and stroke cache (`zika-assets-v1`) survives a version change; ↻ loads the newest version; when a release arrives while the app is open, an untouched page reloads into it by itself after a few seconds and a page that has been touched gets a "newer version" toast with Refresh, the grade made before it kept; opening the app removes a cache named `zika-vNN` left by an earlier release and keeps one with a higher number. Since v64 `index.html` asks for every shell file as `file?v=<release>` (written by `tools/stamp.mjs`): the worker ignores the number; it keeps a device still run by the v62 worker from getting an older release's script on a newer page. The worker is not installed while `assets/qrcode.min.js` cannot be stored, and installs at the next open once it can. `node tools/swtest.mjs --from <a folder holding the last release>` runs the hand-over from the last release with a deck.

## Sync and backup *(walked, look only)*

- **Where:** Settings → Cloud sync; Settings → Backup.
- **How to test:** on the local copy the deck is not linked. Confirm the screen says so and offers Generate and Link. Do not use them: a test must never reach a real sync room. Export a manual copy and check it is one JSON object.
- **Good looks like:** an unlinked device says sync is off and how to link. Nothing in a test writes to Firebase. A manual export is named with its day and the device's name, `zika-progress-2026-12-14-iPhone.json` (since v67; the name is the one in Cloud sync → This device, with anything that is not a letter or a digit turned into a hyphen). The automatic backup file is whatever file was chosen for it, offered as `zika-progress.json`, and its name never changes.

## voice.html *(walked)*

- **Where:** `voice.html`, a page of its own.
- **How to test:** open it; it shows the reference sentence and a record control.
- **Good looks like:** the page loads with no console errors. Settings → Audio source has "Record your own voice ↗", which opens it.

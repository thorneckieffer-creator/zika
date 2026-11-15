# Feature map

Every feature of the app: where it is, how to test it, and what good looks like. The checker (`.claude/agents/verify-app.md`) follows this file, so it has to stay true. **When a feature is added, renamed or moved, change its entry in the same commit.** A feature with no entry here does not get tested.

What "right" means on every screen is in [review-checklist.md](review-checklist.md). How to open the app at device sizes from Chrome is in [releasing.md](releasing.md).

Sizes: **phone** 390 × 844 · **iPad upright** 820 × 1180 · **iPad on its side** 1180 × 796.

Entries marked *(walked)* were checked against v62, and again by the checker against v63, on a fresh, unlinked deck at the phone size and at 1180 × 796. Entries marked *(from the notes)* were written from the README and `docs/` and have not been walked yet. The checker cannot edit this file: the first one to test such an entry lists what it found under "Corrections to the feature map" in its report, and the session that made the change corrects the entry and removes the mark.

The checker empties the deck on its own local origin before each run, so every run starts fresh. A fresh deck opens on the welcome sheet (below). Finish it at Book 1 · Lesson 1 and Today shows that lesson's first words and grammar cards waiting. To add another lesson's words: Library → open a lesson → **Study lesson**.

## Core path (every review, all three sizes)

1. **It loads.** Open `index.html?t=<number>`. Today shows a greeting (with the name, if the learner gave one), the date, the course chip (the book, lesson and lesson title the learner is on: "Book 2 · Lesson 11" on Thorne's deck, the lesson picked on the welcome sheet for a new learner), and one filled button ("Start today's cards"). Nothing scrolls sideways.
2. **The version is the new one.** Open Review: the foot of the page reads "FSRS-5 · vNN" with the version being released. It matches `VERSION` in `sw.js`.
3. **Navigation.** Phone: a bottom bar of five, Today · Review · Drill · 大考試 · More, and More shows the rest (Catch-up, Grammar, Brain, Library, My words, Settings). Wider: one text row under the top bar with Today · Review · Drill · Catch-up · 大考試 · Grammar · Brain · Library · My words, and Settings behind the sliders icon in the top bar. Open every destination once: each paints its screen, none is blank.
4. **Review one card.** Review → **Show answer** (or Space) → the answer appears with four grade buttons, Again · Hard · Good · Easy, each with its interval under it → tap **Good** (or 3) → the count moves ("1 done") and the next card shows.
5. **The answer side fits.** At 1180 × 796 the whole answer and the four grade buttons are on screen without scrolling. On the phone the grade buttons sit above the bottom bar.
6. **One drill.** Drill → **認字 Recognition** → a question with four choices and a header "1 / 20 · 0 right · exit" → answer one → it marks it and moves on → **exit** returns to the Drill tab.
7. **Reload.** Reload the page: the card graded in step 4 is still counted, and the deck is as it was.
8. **Night.** Tap the moon in the top bar: every screen opened so far is readable in the night colours. Tap it again.
9. **Console.** No errors from the app's own code, and no failed request for a file the app ships.

## Welcome *(new in v63, checked by the harness scenarios `first-run*`)*

- **Where:** it opens by itself on a device with no deck and no sync code. It does not open on a deck that has been studied, nor when the app is opened from a sync link.
- **How to test:** empty the deck and reload. Type a name, pick Book 2 and a lesson, switch on "I know the lessons before this one", tap **Start**. Empty the deck again and tap "I already use 字卡 on another device".
- **Good looks like:** a sheet titled "Welcome to 字卡" with a name field, book and lesson pickers, the lesson's title, and one filled button "Start with Book N · Lesson N". After Start: the greeting carries the name, the course chip shows the chosen lesson, the lesson's first words are waiting, earlier lessons are marked known if asked, no exam line, no links to Notion anywhere, and no "Cloud sync is off" card. The other-device link closes the sheet and puts the cursor in the sync code box on Today; the sheet returns on the next open until it is finished or a deck arrives.

## Could not start *(new in v63, walked; harness scenarios `start-file-lost`, `other-file-lost`, `stylesheet-lost`, `file-cut-in-half`, `file-cut-between-lines`, `data-cut-in-half`)*

- **Where:** over the whole page, when a file of the app does not arrive, arrives cut short, or start-up stops part-way.
- **How to test:** serve copies of the folder broken one way each: a script removed (`js/home.js`, `js/review.js`, `js/core.js`), `css/app.css` removed, a file in `data/` removed, a script cut in half, a script with its last line removed, a `throw` added to `js/boot.js`. The harness's server does the first five by address (`?drop=<path>`, `?cut=<path>&keep=half`, `?cut=<path>&keep=1`). With the message up: click and tap under it; press Tab and Shift+Tab several times, then Enter; press `r`, Space, `1`–`4` and the other shortcuts; click the message's background and type. Compare everything in `localStorage` before and after.
- **Good looks like:** "字卡 could not start." with the reason ("A file did not arrive (js/home.js). Check the connection.", "A file did not arrive whole (js/home.js). Check the connection." or "Something stopped it part-way."), "Your progress on this device is safe.", and **Try again**, which has the focus, keeps it through Tab and clicks, and reloads on a click, Enter or Space. Nothing under it answers to mouse, touch, keyboard or focus; the app has not started (`zikaStarted` unset, `DECK_READY` false); every key in `localStorage` is byte for byte as it was (when start-up had begun before it stopped, what it had already written stays, as on a normal start; nothing is written once the message is up). A data file cut at its line break reads "Something stopped it part-way." Not covered in v63: a stylesheet or the QR library that arrives cut short, and a script that is not the app's ([roadmap.md](roadmap.md)). A normal start shows none of this.

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
- **Good looks like:** the header shows "N done · N left", **focus**, and the card's kind. A grammar card shows the sentence with a blank and the English; the answer fills the blank, adds tone-coloured pinyin, the pattern's name, a speaker button and a Notion link. A word card's answer side shows the word, pinyin, meaning, its usage phrases (用法) and a microphone for the tone coach; a write card adds the stroke boxes and **Replay strokes**. The Notion link on a grammar answer is hidden on a new learner's deck. The grade buttons show the next interval; Good on a new card says minutes, Easy says days and a date. A finished session shows a summary (cards, recalled, minutes, best run, new words, streak) and **Back to Today**.

## Drill tab *(walked: the tab, the fold, Recognition and Tones; the other drills from the notes)*

- **Where:** the Drill tab.
- **How to test:** change the scope (A lesson · My hard list · Due now · Whole deck; then book and lesson). Start each drill the change touches and answer at least three questions. Leave with **exit**.
- **Good looks like:** scope pickers at the top, then tiles: 聽寫 Dictation · 認字 Recognition · 聲調 Tones · 寫字測驗 Mastery test · 聲調教練 Tone coach · 短文 Stories · 用法 Phrases, and a fold "More drills · sentences, listening, grammar" holding six tiles: 聽力 Listening, 句子聽寫 Sentence dictation, 辨析 Which one?, 閱讀 Reading sprint, 造句 Sentences, 口說 Speaking. Below: 口試 Exam simulator (**Generate a prompt**), Which one? 辨析 (a mixed set and twelve families), and Your tones (the sixteen tone pairs). A scope line says how many words and grammar points are in play. Every drill has a progress header and a way out, and its end screen offers a next step.

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
- **Good looks like:** "Grasp · by family" with a dot per pattern and Drill · Which one? · + cards; then a book and lesson picker, the lesson's title ("B1 L1 · Welcome to Taiwan!"), its points with a one-line explanation each, and whether each has a card.

## Brain *(walked)*

- **Where:** the Brain tab (phone: More).
- **How to test:** switch Scope (Book 1 · Book 2 · Book 3 · Everything), View (Characters · Words) and Group (Stage · Lesson · Trad ≠ Simp). Tap a word type.
- **Good looks like:** "N / N characters mastered", the stage legend (Not started · Learning · Young · Solid · Mastered), the by-word-type tiles, the time-lapse, the mastered shelf, then the wall of characters for the scope. Counts change with the scope.

## Library *(walked)*

- **Where:** the Library tab (phone: More).
- **How to test:** switch books and filters (All · In deck · Due · Not started · Trad ≠ Simp). Open a lesson. On a throw-away deck tap **Study lesson**. For the character panel go to Brain and tap a character on the wall (word rows in the Library cannot be tapped).
- **Good looks like:** a ring row per lesson, then each lesson with "N of N in deck · N/N 字 known" and Triage · Triage 聽寫一 · Triage 聽寫二 · Study lesson · Know it all. The character panel (from the Brain wall) shows the stroke-order drawing, memory and first lesson, the words that use it, "Why it looks this way", and look-up links 萌典 · MDBG · Skritter · 字源. Do not press "Know it all".

## My words *(walked: empty deck and the add sheet)*

- **Where:** the My words tab (phone: More); the My words tile on Today.
- **How to test:** **Add words** → type 垃圾 in the first field → wait a second. Pick a topic. Tap **Add**. Try **Paste a list** with two lines. Filter by topic. **Study**. Edit a word; delete one and tap Undo.
- **Good looks like:** an empty deck explains itself and offers "Add your first word". In the add sheet the pinyin and meaning fill themselves in (垃圾 → lèsè · garbage, the Taiwan reading); a field typed by hand is never overwritten. Twelve starting topics show as chips, plus **+ New topic**. The deck is separate: adding a word changes nothing in the course's counts on Today. The dictionary is a 7 MB download the first time My words opens.

## Settings *(walked: the sections; the controls from the notes)*

- **Where:** the sliders icon in the top bar; phone: More → Settings.
- **How to test:** change the setting the change touches, leave Settings, check the screen it governs, reload, check it held. For a device-local setting (voice, theme, backup file, offline pack), check it is still set after reload.
- **Good looks like:** these controls, top to bottom (the grouping here is a reading aid, not the on-screen titles): You (name, book and lesson, **Change**) · the device set-up steps · Cloud sync (status, Sync code, This device, Push and Pull, Sync log) · Daily intake (Live lesson, This week's new words, Catch-up words, Grammar cloze cards, Review cap, Desired retention, Write cards, Dictation drill order, Leeches) · audio (Audio source, Pronunciation voice, Auto-play on reveal, Audio speed) · what cards show (Stroke-order animations, Pinyin under sentences, Character stories, Usage phrases, Sentence hint on write cards) · backups (Automatic backup, In-browser snapshots, Manual copy) · Appearance (Haptics, Animations, Palette, Accent colour, Character style) · card options (Recognize, Write, Include names, Early recall reps, Day-1 paper reps, Separate the two cards of a word, Cloze cards) · Confidence · Sync file. **Look at Cloud sync; do not press Generate, Link, Push or Pull.**

## Top bar *(walked)*

- **Where:** the top of every screen.
- **How to test:** tap each control.
- **Good looks like:** the mark and name (go to Today) · the sync pill (device badge and state) · refresh (↻) · day / night · Settings (wide screens). It stays in view while the page scrolls.

## Audio *(walked: the packs; the system voice from the notes)*

- **Where:** the speaker on any card or word; Settings → Audio.
- **How to test:** play a word and a single character; switch the voice (曉臻, 雲哲 when its pack is present); switch to the system voice.
- **Good looks like:** the bundled Taiwan voice plays for every word and character; where a pack has no clip the system voice speaks instead, with no error.

## Offline and updating *(walked)*

- **Where:** the service worker (`sw.js`); Settings → Offline & audio; the ↻ button.
- **How to test:** on `127.0.0.1` the worker is off unless the address carries `?sw`. Load `index.html?sw` once, stop the server, reload: the app still opens. Start the server again and tap ↻. When a file under `assets/` changed under the same name, check line 27 of the checklist.
- **Good looks like:** the worker holds all 34 shell files; the second load takes every script, style and data file from the store; the shell opens offline and a card can be graded; the audio and stroke cache (`zika-assets-v1`) survives a version change; ↻ loads the newest version; opening the app removes a cache named `zika-vNN` left by an earlier release and keeps one with a higher number. The worker is not installed while `assets/qrcode.min.js` cannot be stored, and installs at the next open once it can. `node tools/swtest.mjs --from <a folder holding the last release>` runs the hand-over from the last release with a deck.

## Sync and backup *(walked, look only)*

- **Where:** Settings → Cloud sync; Settings → Backup.
- **How to test:** on the local copy the deck is not linked. Confirm the screen says so and offers Generate and Link. Do not use them: a test must never reach a real sync room. Export a manual copy and check it is one JSON object.
- **Good looks like:** an unlinked device says sync is off and how to link. Nothing in a test writes to Firebase.

## voice.html *(walked)*

- **Where:** `voice.html`, a page of its own.
- **How to test:** open it; it shows the reference sentence and a record control.
- **Good looks like:** the page loads with no console errors. Settings → Audio source has "Record your own voice ↗", which opens it.

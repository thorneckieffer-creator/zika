# Roadmap and open work

One list of what is not done, by area. Take an item off when it ships; add one when you find it.

## Content

- **Book 3, Lessons 5–12.** Lessons 1–4 are in (v41). The other two volumes (`MBLCECC009`, `MBLCECC010`) still show a cover only in the DangDai app: Thorne downloads them there, then the importer runs again ([content.md](content.md)).
- **Book 4**, the same way, after Book 3.
- **Usage phrases** (用法) cover every lesson the app holds (v51); new lessons need them when they are imported ([content.md](content.md#usage-phrases-用法)). Still open: a native speaker's read-through; a pack of phrase clips so they play in the 曉臻 voice instead of the system one; phrases as scheduled cards of their own.
- **Short essays per lesson**, original, built from each lesson's vocabulary and grammar. Thorne asked for these and will say which lesson to start with.
- Three Book 3 characters (嚐, 汙, 崁) have no stroke data or component breakdown in the open sources.

## Voice

- **Thorne's own voice** (`me`, `audio-me`). The recorder page, the BreezyVoice builder and the app slot shipped in v42; the pack itself is not built. It ships only after Thorne approves the sound by ear ([voice.md](voice.md)).
- **雲哲 male pack** (`audio-tw-m`): Thorne prefers a native voice to the clone of his own ("it doesn't sound like me"). The read-aloud service came back, and a slow-paced build (`--pause 2`) is the way to finish it.
- **Tone coach**: the analysis was rebuilt and measured against ten voices in v52, and rounds now lean on the learner's weakest tone or tone pair ([voice.md](voice.md#tone-coach-聲調教練-beta-analysis-rebuilt-in-v52)). v53 added the tone-pair map (tap a pair, practise ten words of it); v54 put a "check my tones" microphone on the answer side of every review card. v56 added rounds of short phrases. Next: Thorne's verdict on a real microphone; whole sentences; more human voices (men above all) in `tools/tone_lab.mjs`; neutral tones.
- **Stories** cover Book 3 Lessons 1–4; Books 1–2 lessons and more settings per lesson are still to write ([content.md](content.md)).
- **Book 3 words have no bundled clips.** The 曉臻 pack predates them, so 338 words and characters play in the system voice (`node tools/check.mjs` lists them).

## App

Next for the product:

- **Other users.** The plan, in order, is in [multi-user.md](multi-user.md): a clean first run, accounts, storage per person, sync by card.
- **Split `index.html` into files.** Data (`WORDS`, `GRAMMAR`, `COMPONENTS`, `READINGS`) into JSON under `assets/`, styles and each feature into their own file, all fetched with a `?v=` that matches the version and pre-cached by the service worker. Do it after an exam, never before one, and move one piece per release.
- **My words:** share a deck with someone else; count its reviews toward the streak; a dictionary lookup to fill the meaning.
- **A new app icon.** The Home Screen icon is still the red seal; the app itself now uses the plain mark.

Behaviour gaps, not yet fixed:

- Heteronyms still share one clip in the 曉臻 pack (得 de/děi, 了 le/liǎo). The app has looked for a per-reading clip (`字@pinyin`) since v42, but only packs from the BreezyVoice builder contain them.
- The Up-next panel's "will start now" count ignores the per-lane intake.
- Turning a card type on in Settings does not create that card for words already in the deck.

Structure:

- **One layer.** Fold the version-by-version wrappers into a single definition of each function, one function at a time with the smoke test, never as one rewrite ([architecture.md](architecture.md#layers)).
- **Leaner sync.** Send changes rather than the whole deck.

Verified dead or superseded code that is still in the file, to be removed one piece at a time with the smoke test:

- `TIERS`, `RECUR_TGT`, `CATCHUP_SCHED`, `tierWords`, `recurPoints`, `drillTier` and the `drillScope==='tier'` branch (the tier card was stubbed out in v33).
- The first `renderLib` body, the first `buildQueue` body and the first `compLines` body (each replaced wholesale by a later layer).
- The `dict` branch of the first `renderDrill`, and the write-card front in the first `renderRev`.
- The first `anatomyHtml` body (the layer after it replaces it without calling it).
- `NOTION.hub/.catchup/.prep/.book1/.chars`, CSS `.complines`, `.gres`, `.serif-en`, `.kai`.

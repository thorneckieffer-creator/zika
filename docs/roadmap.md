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
- **曉臻 pack is behind.** The 雲哲 pack (`audio-tw-m`) is complete, but the default 曉臻 pack still lacks 338 words and characters (Book 3 and a few earlier ones), which play in the system voice when 曉臻 is selected. Rebuild it the same way (`--voice zh-TW-HsiaoChenNeural --out audio-tw`) and bump `ASSETS`.
- **Tone coach**: the analysis was rebuilt and measured against ten voices in v52, and rounds now lean on the learner's weakest tone or tone pair ([voice.md](voice.md#tone-coach-聲調教練-beta-analysis-rebuilt-in-v52)). v53 added the tone-pair map (tap a pair, practise ten words of it); v54 put a "check my tones" microphone on the answer side of every review card. v56 added rounds of short phrases. Thorne has asked for 97% (it reads 80% today, and this design tops out near 91%): the measured route is in [voice.md](voice.md#tone-coach-聲調教練-beta-analysis-rebuilt-in-v52) under "What 97% would take" — richer inputs and a "not sure" verdict first, then a spectrogram network trained on AISHELL-3. Next: Thorne's verdict on a real microphone; whole sentences; more human voices (men above all) in `tools/tone_lab.mjs`; neutral tones.
- **Stories** cover Book 3 Lessons 1–4; Books 1–2 lessons and more settings per lesson are still to write ([content.md](content.md)).
- **Book 3 words have no bundled clips.** The 曉臻 pack predates them, so 338 words and characters play in the system voice (`node tools/check.mjs` lists them).

## App

Next for the product:

- **Other users.** The plan, in order, is in [multi-user.md](multi-user.md). The clean first run is done on `next` (a device with no deck starts at Book 1 Lesson 1 with a welcome sheet; [decisions.md](decisions.md)). Next: accounts, storage per person, sync by record — designed on the branches `users-accounts` and `users-sync`, not yet wired in. Still Thorne-shaped for a new learner: the weekday plan's wording, the 口試 day, and the copy on the unlinked-device card.
- **My words:** share a deck with someone else; count its reviews toward the streak; meanings for what the dictionary does not hold (slang such as 沒差 and whole phrases get pinyin from their parts and no meaning; a language model could write one, which needs a small server to keep its key, so it belongs with the accounts work in [multi-user.md](multi-user.md)); looking a word up by its simplified form. Topics shipped in v60 and the dictionary in v62; still open there: sorting many words at once (today it is one word at a time, from its ✎), and topics for course words.
- **A new app icon.** The Home Screen icon is still the red seal; the app itself now uses the plain mark.

Behaviour gaps, not yet fixed:

- Heteronyms still share one clip in the 曉臻 pack (得 de/děi, 了 le/liǎo). The app has looked for a per-reading clip (`字@pinyin`) since v42, but only packs from the BreezyVoice builder contain them.
- The Up-next panel's "will start now" count ignores the per-lane intake.
- Turning a card type on in Settings does not create that card for words already in the deck.

Structure (the restructure of November 2026 is on the branch `next`; see [decisions.md](decisions.md)):

- **Release `next`.** It is the app split into files with one definition per function and the new service worker, verified against v62 by the harness. Merge it into `main` when Thorne is ready (after the exam): merge `main` into it first, take the next version number, run the whole release procedure, and run `node tools/swtest.mjs --from <a v62 folder>` once more.
- **Build Today and Settings directly.** `renderHome` and `renderSet` still build a page and then insert, move and remove parts of it, in the order the versions added those steps (Settings builds rows it then deletes; Today builds a card it then replaces). Rewrite each as one pass that builds the final page; the harness says when it is the same page. `renderRev` and `renderDrill` next.
- **Remove what is dead.** `TIERS`, `RECUR_TGT`, `CATCHUP_SCHED`, `tierWords`, `recurPoints`, `drillTier` and the `drillScope==='tier'` branch; `tierPanel` and `mtPanel` (both return an empty string) and the loops in `renderHome` that remove their cards; the `dict` branch of `drillRenderBase` that the dictation card replaces; `NOTION.hub/.catchup/.prep/.book1/.chars`; CSS `.complines`, `.gres`, `.serif-en`, `.kai`. Run `node tools/snap.mjs check --coverage` and go through `never-called.txt`.
- **Scenarios for what the harness never reaches** (about a fifth of the functions): export and import, snapshot restore, the backup file, My words study, the exam's marking and undo, the tone coach with a recorded take.
- **Load the course on demand.** `data/usage.js` is half a megabyte and is only needed on a card's answer side; a learner on Book 1 does not need Book 3. Split `data/` by book and fetch what the learner's position needs.
- **Modules.** The scripts share one global scope and inline `onclick` handlers call functions by name. Moving to ES modules would let a file say what it uses; it means replacing the inline handlers first.
- **Leaner sync.** Send changes rather than the whole deck ([multi-user.md](multi-user.md)).

## Release and repo

- **The checker has not run on a real change yet.** The gate was tested on a scratch copy (sent back, let go, refused, push stopped), but `verify-app` itself loads only in a session started after it was added, so the first change to the app after November 2026 is its first run. Expect it to be slow and to return corrections to the feature map; fix the checker's instructions (`.claude/agents/verify-app.md`) where it stumbles.
- **Walk the rest of the feature map.** Entries marked *(from the notes)* in [feature-map.md](feature-map.md) have not been checked against the app.

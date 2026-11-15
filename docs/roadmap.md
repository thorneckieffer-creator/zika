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

- **Other users.** The plan, in order, is in [multi-user.md](multi-user.md). The clean first run shipped in v63 (a device with no deck starts at Book 1 Lesson 1 with a welcome sheet; [decisions.md](decisions.md)). Next: accounts, storage per person, sync by record — designed and built as stand-alone files on the branches `origin/users-accounts` and `origin/users-sync`, self-tested, and reviewed independently on 15 November 2026 with findings that must be fixed before they are wired in ([review-users-branches.md](review-users-branches.md)). When merging `users-accounts`, its `docs/multi-user.md` replaces the one here and its "clean first run: not built" lines are out of date. Still Thorne-shaped for a new learner: the weekday plan's wording, the 口試 day, and the copy on the unlinked-device card.
- **The backend, in build order.** Steps 1 and 2 do not depend on each other; after that each waits for the one before.
  1. ~~An independent, break-it review of both branches.~~ Done 15 November 2026: neither can be wired in as it is ([review-users-branches.md](review-users-branches.md)). **Fix what it found**, on the two branches, each fix done when its reproduction on `origin/review/users-sync` or `origin/review/users-accounts` passes: the engine first (the shadow tied to the deck, My-words ids per device, the clock held to the server's, unsent changes kept apart from the shadow, the shadow out of localStorage), then the accounts module's changes of identity, then the rules; then the simulation and the fake Firebase made strict enough to have caught them. Run the rules tests on the official emulator, not only the home-made evaluator.
  2. ~~Release the restructure, with the old sync unchanged.~~ Done: v63.
  3. Ready the app for sync by record, with no cloud change: My-words and topic ids that include the device (`u<device>-<n>`; existing ids stay); `deckStore()` returning false reported to the engine's `onChange`; `takeSnapshot()` finding today by date, not by the last entry; one version marker for the tone coach; `wipeLocal` (remove the deck, the backups, the engine's shadow and the room code from a device).
  4. Merge both branches and wire them in behind the old sync, following the "Plugging in" tables in their notes. A device with a room code keeps using its room; only a device without one starts the engine on `users/<uid>`.
  5. Prove it without the live project: two-device scenarios in the harness; the rules in the official emulator (needs Java on this machine); the first real run of `acFirebaseAdapter()` and `syFirebase()` against a separate test Firebase project.
  6. Console steps, by Thorne, after the exam: the checklist in `multi-user.md` (Email/Password on, rules compared and published, App Check registered and unenforced, email templates).
  7. The real-iPhone test from the Home Screen: create, reopen, join by code, remove, sign out, delete.
  8. Release accounts. New learners get `users/<uid>`; Thorne's devices stay on the room.
  9. Move Thorne's deck (Mac first, then iPad and iPhone), as written in `multi-user.md`.
  10. A month later: delete the room (ask Thorne first) and enforce App Check once every device sends tokens.
- **My words:** share a deck with someone else; count its reviews toward the streak; meanings for what the dictionary does not hold (slang such as 沒差 and whole phrases get pinyin from their parts and no meaning; a language model could write one, which needs a small server to keep its key, so it belongs with the accounts work in [multi-user.md](multi-user.md)); looking a word up by its simplified form. Topics shipped in v60 and the dictionary in v62; still open there: sorting many words at once (today it is one word at a time, from its ✎), and topics for course words.
- **A new app icon.** The Home Screen icon is still the red seal; the app itself now uses the plain mark.

Behaviour gaps, not yet fixed:

- Heteronyms still share one clip in the 曉臻 pack (得 de/děi, 了 le/liǎo). The app has looked for a per-reading clip (`字@pinyin`) since v42, but only packs from the BreezyVoice builder contain them.
- The Up-next panel's "will start now" count ignores the per-lane intake.
- Turning a card type on in Settings does not create that card for words already in the deck.

Structure (the restructure of November 2026 shipped as v63; see [decisions.md](decisions.md)):

- **Build Today and Settings directly.** `renderHome` and `renderSet` still build a page and then insert, move and remove parts of it, in the order the versions added those steps (Settings builds rows it then deletes; Today builds a card it then replaces). Rewrite each as one pass that builds the final page; the harness says when it is the same page. `renderRev` and `renderDrill` next.
- **Remove what is dead.** The tier plan, the two empty panels, the unused Notion links and the unused style rules went in November 2026. What is left to look at: run `node tools/snap.mjs check --coverage` and go through `never-called.txt` once the scenarios below reach more of the app.
- **Scenarios for what the harness never reaches** (about a fifth of the functions): export and import, snapshot restore, the backup file, My words study, the exam's marking and undo, the tone coach with a recorded take.
- **Load the course on demand.** `data/usage.js` is half a megabyte and is only needed on a card's answer side; a learner on Book 1 does not need Book 3. Split `data/` by book and fetch what the learner's position needs.
- **Modules.** The scripts share one global scope and inline `onclick` handlers call functions by name. Moving to ES modules would let a file say what it uses; it means replacing the inline handlers first.
- **Leaner sync.** Send changes rather than the whole deck ([multi-user.md](multi-user.md)).

## Release and repo

- **v63 went out with three findings of the checker open** (third pass, FAIL, fingerprint c6d75c39868e; pushed on Thorne's instruction). All three are on the "could not start" path, none in normal use: a stylesheet that arrives empty or cut short (status 200) gives no message and the app starts unstyled; `assets/qrcode.min.js` cut at its line break gives no message; a script that is not the app's (an extension's), failing before start-up ends, brings the message up although every file of the app arrived. The fixes are written and pass the harness (the stylesheet's last rule `html{--zika-css-whole:1}` and the library's name checked in `bootLost`; only files under the page's own folder count) but have not been through the checker: they are the next commit on `next`. Release them as v64 after a PASS.
- **The QR library belongs in the shell list.** `assets/qrcode.min.js` is a script the page loads before it starts, but it is stored with the assets, without a hash; since v63 an install fails if it could not be stored, which keeps a device from being unable to start offline. Moving it under the files `tools/stamp.mjs` lists (or loading it only when a QR code is drawn) would be cleaner.
- **Before v64: a version stamp on the script addresses, or proof it is not needed.** A device still under a v62-or-earlier worker (one whose v63 worker never finished installing) gets the newest `index.html` from the network but `js/`, `css/` and `data/` files from that old worker's cache if it has seen them before, so at v64 it could run a v64 page on v63 scripts until the new worker takes over. `js/core.js?v=64` in `index.html` (written by `tools/stamp.mjs`, checked by `tools/check.mjs`) closes it; the new worker ignores the query. Thorne's three devices will have the v63 worker long before then, so this matters for anyone who opened v62 once and comes back late.
- **The checker's first real run was v63** (15 November 2026): about an hour a pass at first and half that later, three FAILs that were right (a card graded from the keyboard under the "could not start" message; then Tab and Enter reaching under it, a lost stylesheet unreported and a cut-off file unnoticed), and a list of corrections to the feature map, now made. Worth doing to it: let a second pass on the same release carry over what the first found good and re-test only what the edits can reach; it was told so by hand this time.
- **Things the checker saw that were there before v63**, none fixed yet: the choices in Recognition and the other choice drills are black on the dark panel at night; in Recognition's "what does it mean?" the character asked is 15 px, smaller than its hint; Review's ← back does not put the "left" count back; "No backup in over a week" shows on a deck that is minutes old; the app asks for `assets/audio-me-index.json` on every start and gets a 404; the tone coach and the grammar drill have no way out but a tab; and a new learner still reads "grammar lives in Notion" (Today), "explanations live in Notion" (Grammar), "rules are in the Grammar index" (Drill) and "Confidence · shared with Notion" (Settings) although the links are hidden.
- **Walk the rest of the feature map.** Entries marked *(from the notes)* in [feature-map.md](feature-map.md) have not been checked against the app.

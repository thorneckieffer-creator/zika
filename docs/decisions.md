# Decisions

Decisions with consequences, newest first, each with its reason. Thorne asked on 15 November 2026 that Claude decide without asking and write the decisions down ([CLAUDE.md](../CLAUDE.md#the-commitment)); this is where they are written. A decision here can be changed, but change it here, with the new reason, in the same commit as the code.

## 2026-11-16 — accounts and sync move to Supabase, and replace the room code outright

Thorne asked for "an actual database", gave two rules for the backend the same day (subscribe to pushed changes, never poll; replace the old thing, no second version beside the first) and connected a Supabase account. This changes three lines of the two entries below: "stay on Firebase Realtime Database", "a person is a Firebase uid", and "the old sync code and room stay". The rest of them stands, and so does every finding of the review.

**Why change stores now.** The entry below said a relational database earns its keep when there are classes, teachers and shared decks. That is now the direction: a co-founder, other learners, shared My-words decks on the roadmap, and questions a business asks of its data (how many learners, who came back). Meanings written by a language model, and payments later, need a place to keep a key; Supabase has functions for that, Firebase only on its paid plan. And nobody has an account yet: the accounts code has to be rebuilt after its review anyway, so moving now costs a new adapter and new access rules, while moving later would mean moving every learner's data.

- **The store is Supabase (Postgres).** One row per record: the owner, the record's key (`<kind>~<id>`, as in `docs/sync.md` on `origin/users-sync`), its stamp, its value, a deleted mark, and a change number the database gives it. Row-level security lets a signed-in person reach their own rows and nothing else.
- **The database enforces what the review found the client could not be trusted with.** Writes go through one database function: a version is taken only if its stamp is later than the one stored (a delete followed by a rewrite gets round nothing), a stamp ahead of the server's clock by more than the drift allowance is refused, sizes are column limits, and the change number and the time are the server's. That closes the rules findings F-1, F-2, F-4 and F-8 by construction and gives the engine's F3 fix its server side.
- **A person is a Supabase user with a confirmed email and a password.** Email and password for the same reason as before: it is the one method that never leaves the page inside an app installed on an iPhone. An unconfirmed account syncs nothing (the review's R8).
- **No anonymous identity in the cloud.** A device with no account keeps its deck on the device and talks to no database. This removes the stranger who fills the database (F-5), the "new guest" made by an unexpected sign-out (R9, R13: the app says "signed out, sign in again" and uploads nothing), and the need for App Check.
- **No join codes and no approved devices.** A second device signs in with the same email and password. The code was a secret that gave access (R21, F-3) and most of the accounts findings lived in approving, joining and removing; with one way in, they have nothing to live in. The QR link goes with it.
- **Changes are pushed.** The app subscribes to its own rows (Supabase Realtime) and, when it connects, asks once for everything after the last change number it saw. No timer asks the server for anything.
- **The room-code sync is removed in the release that brings accounts**, with the Firebase SDK. Nothing runs beside it and no device "keeps using its room". Until that release, v63's sync is untouched.
- **Thorne's deck is carried over once, from his devices, not from the room.** Every device holds the whole deck under `shida_b1_fsrs_v2`, which does not change. A backup file first; then he creates the account on the Mac and the deck on it is imported as old records, so anything studied later anywhere wins; the iPad and the iPhone sign in and what each holds is merged record by record. The room is left as it is in Firebase, a frozen copy, until he agrees to delete it. (This is carrying data, not keeping a compatibility layer: the rules that protect progress are unchanged.)
- **What is kept from the two branches:** the sync engine and its record model, behind the same four-function adapter (`sySupabase()` takes the place of `syFirebase()`), and the engine's reproductions on `origin/review/users-sync`, each still to be made to pass. **What is rewritten:** the accounts module, much smaller (sign up, confirm, sign in, sign out, reset, delete, and "this device already holds a deck: add it or replace it"); the hazards in R1–R4, R6, R10, R11 and R15 still apply to it and get reproductions of their own. **What is dropped:** the Firebase rules, their builder and the 68 attacks, replaced by the policies above and an attack suite run against the real project with two accounts.
- **Keys.** The project's address and its publishable key are public by design and go in the code, as the Firebase web config does. The service-role key and the database password never go in the repository, the app or a commit message.
- **The client library is a pinned copy in the repository**, loaded only by a device that has an account or opens the sign-in sheet, so a device without one starts exactly as today and offline start-up does not depend on it.
- **One Supabase project for building and testing now; a separate one for real learners before the release.** Known before launch: a free project pauses after about a week without activity, and the built-in mail sender is for testing, so confirmation and reset emails need a real mail service attached. Both to be checked against Supabase's current terms when that step comes.
- **Nothing changes on the live app or in Firebase before the exam on 18 November.**

Not decided here, because it needs the tables in front of it: the exact columns and the function's signature; whether the daily counts stay "one record per device, summed" or become rows the database sums.

## 2026-11-15 — the review of the user branches: the design stands, the code does not go in yet

Three reviewers that did not write the code tried to break the sync engine, the accounts module and the security rules ([review-users-branches.md](review-users-branches.md)). No stranger can reach another learner's deck, and nothing argues for a different store. But a learner's own progress can be lost in ordinary situations, so:

- **Neither branch is wired in until its reproductions pass.** They are kept, failing, on `origin/review/users-sync` and `origin/review/users-accounts`.
- **A join code is treated as a secret that gives access**, because it does: whoever answers a code first receives the joining device's deck. The joining device must show who answered and wait for a tap before it deletes or merges anything.
- **The engine's shadow moves out of localStorage** (IndexedDB), is tied to the deck by a generation number, and keeps unsent changes apart from itself. Storing it beside the deck is what lets a failed save turn into lost reviews on every device.
- **A stamp's time is written as decimal digits**, so the rules can hold it to the server's clock. Nothing has shipped in the old form.
- **App Check is enforced before the first outside learner**, not left unenforced at launch: without it any anonymous visitor can fill the database.
- **The rules are tested on the official emulator.** The home-made evaluator agreed with it on all 184 of the authors' cases but is blind to priorities and increments, which is where two of the holes were.

## 2026-11-15 — accounts and sync by record: the design is chosen, the code waits for its review

Decided in outline by this session and worked out in full by the second one, on two branches that add new files only and are not merged: `origin/users-accounts` (its `docs/multi-user.md` is the design; `js/account.js`, the security rules and their tests) and `origin/users-sync` (`docs/sync.md`, `js/sync-records.js` and its tests).

- **Stay on Firebase Realtime Database.** The app keeps the truth on the device and works offline; what the cloud has to do is carry small records between one person's devices, which is what a tree of paths with per-user rules does, with no server to run. A relational database earns its keep when there are classes, teachers and shared decks; revisit then.
- **A person is a Firebase uid.** Every device signs in anonymously as today; an account is that same uid with an email and password attached, so the deck does not move when someone signs up. Email and password first because it is the one method that never leaves the page inside an installed iPhone app; Google and Apple after a test on a real device.
- **A second device** signs in with the same email, or shows a short code that a device owning the deck approves. The old sync code and room stay exactly as they are until the learner moves the deck, once, by choice.
- **The deck is `users/<uid>/rec/…`, one record per card, setting, day and list member**, the later stamp winning per record, day counts kept per device and summed. Measured on a 3,155-card deck: 352 bytes written per review instead of 981 KB.
- **Nothing is wired in until an independent review of both branches has reported**, and nothing changes in the live Firebase project before Thorne's exam. Wiring means: the script tags, the hooks listed in each branch's notes (`saveNow`, `fbBoot`, `fbAdopt`, the last line of `js/boot.js`), removing the anonymous sign-in line where an account exists, new My-words ids that cannot collide between two offline devices, and harness scenarios for two devices.

## 2026-11-15 — the deck cannot be written by a page that has not started

Splitting the app into files opened a gap that one file never had: the page's buttons work as soon as their script has loaded, and start-up runs in the last script. At one point on `next`, a tap on the theme button in that gap saved the empty default deck over the real one, and a linked device could then send it to the cloud. The independent review found it; the harness scenario `tap-before-start` reproduces it (2,288 cards became 18) and now holds the fix in place. Three things, each enough on its own:

1. The saved deck is read where `S` is defined (`deckLoad` in `js/core.js`), so `S` is never an empty deck while a saved one exists.
2. Nothing writes the deck, the backup file, a snapshot or the cloud before `js/boot.js` has loaded and migrated it (`DECK_READY`).
3. A deck with no cards never replaces a stored one that has cards, and is never pushed from a device that has synced before, unless the learner erased, imported, restored or chose the cloud's copy (`DECK_EMPTY_OK`). Every write of the deck goes through `deckStore()`.

A new way of writing or replacing the deck must go through `deckStore()` and say so with `DECK_EMPTY_OK` if emptying is the point.

A fourth, added when the checker failed v63's first two passes: **an app with a piece missing does not start, and nothing under the "could not start" message can be used.** Start-up used to run to its end with, say, `js/home.js` absent (the missing call was caught), which left the deck open under the message; the keyboard could grade a card there, then Tab and Enter could, a lost stylesheet was never reported, and a file cut off on the way went unnoticed. Now a failed start is any of: a file that does not arrive, a file that cannot be run, a file that did not report running to its last line, a start-up that stops. Then `js/boot.js` starts nothing, the deck is closed, the page under the message is inert and the keyboard goes no further than **Try again** ([architecture.md](architecture.md#start-up)). The price is one fixed last line in every file under `js/`, which the release check enforces.

## 2026-11-15 — a device with no deck starts clean

Until now a new device ran every migration ever written, which gave it the first learner's history: Book 2 Lesson 11, his exam range and date, his name, links to his Notion pages. A device with no saved deck now starts at Book 1 Lesson 1 with every migration marked done (`bootFresh`), and a welcome sheet asks two things: a name, and where the class is (with "I know the lessons before this one"). Finishing it puts that lesson's words and grammar in the deck. "I already use 字卡 on another device" goes to the sync code instead.

`S.settings.born` marks a deck made this way and travels with it. What is personal to the first learner is tied to decks *without* it, so nothing of his changes: the name default, the exam's default range and date, and the Notion links (hidden by one CSS rule unless `html[data-links]`, which `shLook()` sets from `linksOn()`). No migration is needed and a deck adopted from an older device keeps its links.

## 2026-11-15 — a release is stored whole on the device and served from there

Before: the page was fetched from the network on every open (with a 3.5-second fallback to the last copy), and everything else was cached as it was first seen. With the app in thirty files that would have run a new page against old scripts after every release. Now `sw.js` stores the whole shell per release, lists it with a hash of each file (`tools/stamp.mjs`), and serves only from that store. A device takes a release whole or keeps the one it has; opening never waits for the network; an unchanged file is not downloaded again.

The cost is that a release arrives one open later than before: the open that finds it runs the old one while the new one is stored, then reloads into it at once if nothing has been touched, or offers Refresh. That is the price of never mixing versions, and it is what makes splitting the app into files safe.

File names carry no version stamp (`js/core.js`, not `js/core.js?v=63`): the worker checks content against its hashes, which is stronger, and a stamp in `index.html` would be one more generated edit per release. `tools/swtest.mjs` holds all of this in place, including the upgrade from the v62 worker.

## 2026-11-15 — plain scripts in one shared scope, not modules, for now

The split kept every function a global and every inline `onclick="fn()"` working, which is why it could be proven identical to v62. ES modules would let each file declare what it uses, but need the inline handlers replaced first. It is on the roadmap, after the release.

## 2026-11-15 — a second session works beside this one, by agreement

Thorne opened a second window and asked for more agents. The split agreed between the two sessions: this one owns the restructure on `next` and applies and verifies everything with the harness; the other one's agents read the layers and wrote the single definitions (each checked against its original before delivery), reviewed every push independently, and are drafting the multi-user design (accounts, storage per person, sync by record) on branches of their own, as new files that touch no existing function. Their review found real things: the service worker's version skew, the tools broken by the data move, and start-up saves that would have marked an idle device as holding unsent work.

## 2026-11-15 — the restructure is released as v63, before the exam, on Thorne's word

The plan below was to hold it until after the exam of 18 November. On the 15th Thorne asked for it to be released once the review of the user branches had reported. **It went out without the checker's PASS, on his instruction** ("Just push it now so I can use it", after being told the third pass had failed): the checker failed it three times, each time on the "could not start" message and never on the app in use, and after the third the rule is to stop and ask him. What was still open when it was pushed is in [roadmap.md](roadmap.md) under Release and repo. What it was held to: the release check; the harness against a recording (identical but for the version label) and against v62 itself (the same deck in memory on opening, the same deck stored after a graded card; the differences are the new-device screens, the sync note of whether a deck ever had cards, and the two-day sibling list being trimmed when another device's save is taken); the upgrade test from a v62 device carrying a deck, a sync code and stored audio; and the checker's three passes, which found a deck made with v62 opening byte for byte the same, every tab matching v62, and normal starts clean at all three sizes. If a device misbehaves after it, the way back is to publish the v62 files again under the next version number (`git revert` of the release, then bump `APP_VERSION` and `VERSION` in the old places). That was tried before the release, by hand, in headless Chrome: a device running v63 under its worker, with a deck it had saved, a sync code and stored audio, was given the single-file app numbered 64; it became it, dropped the v63 shell, kept every card, My words, the log, the link and the audio, and opened offline.

## 2026-11-15 — the restructure lives on `next`, not on `main`

`main` is the app on Thorne's devices and he has an exam coming. The restructure (files split out of `index.html`, one definition per function, the foundations for other users) is developed on the branch `next` in `.claude/worktrees/next` and is merged only when he says he is ready to launch, or after the exam. `main` still takes small fixes; `next` is rebased on them before the merge and takes the next version number then.

## 2026-11-15 — nothing is restructured without the screen-by-screen harness saying it is the same app

`tools/snap.mjs` opens the app in headless Chrome with a fixed clock, a seeded `Math.random`, its timers on that clock, and no network (a stand-in for the Firebase SDK lives in memory). It walks every tab, a review sitting, every drill, cloud-sync situations, and several thousand seeded random actions, at phone and tablet size, and records the page, the saved state and a picture after each step. Two recordings are compared. A change meant to leave behaviour alone must compare as identical, or every difference must be explained in the commit. This replaced "fold one function per release and smoke-test by hand": it is what made folding all the layers at once safe.

The first use found what hand-testing never would have: with one definition of `save()`, the entry the app adds to its time-lapse on the first open of a day would have marked the device as holding unsent work and pushed it to the cloud. Start-up now stores that entry locally only (`saveLocal`), as the layered code did by accident of ordering.

## 2026-11-15 — definitions first, then start-up

Every script first defines, and one place at the end runs start-up in a fixed order: load the saved state, migrate it, mount the screen, listen, paint once. Before this the file was version blocks, each of which defined some functions, ran a migration, and painted the home screen again; the page was painted about twenty times on every open, and what a start-up statement did depended on how many layers of a function existed above it in the file.

## 2026-11-15 — the data, the styles and the libraries are files

`data/words.js`, `grammar.js`, `components.js`, `readings.js`, `usage.js` each hold one `const NAME = <one line of JSON>`, which is what the content tools read and write. Styles are `css/app.css`. The QR library is `assets/qrcode.min.js`. There is no build step: the browser loads plain files, and GitHub Pages serves the repository as it is.

# Decisions

Decisions with consequences, newest first, each with its reason. Thorne asked on 15 November 2026 that Claude decide without asking and write the decisions down ([CLAUDE.md](../CLAUDE.md#the-commitment)); this is where they are written. A decision here can be changed, but change it here, with the new reason, in the same commit as the code.

## 2026-11-15 — a release is stored whole on the device and served from there

Before: the page was fetched from the network on every open (with a 3.5-second fallback to the last copy), and everything else was cached as it was first seen. With the app in thirty files that would have run a new page against old scripts after every release. Now `sw.js` stores the whole shell per release, lists it with a hash of each file (`tools/stamp.mjs`), and serves only from that store. A device takes a release whole or keeps the one it has; opening never waits for the network; an unchanged file is not downloaded again.

The cost is that a release arrives one open later than before: the open that finds it runs the old one while the new one is stored, then reloads into it at once if nothing has been touched, or offers Refresh. That is the price of never mixing versions, and it is what makes splitting the app into files safe.

File names carry no version stamp (`js/core.js`, not `js/core.js?v=63`): the worker checks content against its hashes, which is stronger, and a stamp in `index.html` would be one more generated edit per release. `tools/swtest.mjs` holds all of this in place, including the upgrade from the v62 worker.

## 2026-11-15 — plain scripts in one shared scope, not modules, for now

The split kept every function a global and every inline `onclick="fn()"` working, which is why it could be proven identical to v62. ES modules would let each file declare what it uses, but need the inline handlers replaced first. It is on the roadmap, after the release.

## 2026-11-15 — a second session works beside this one, by agreement

Thorne opened a second window and asked for more agents. The split agreed between the two sessions: this one owns the restructure on `next` and applies and verifies everything with the harness; the other one's agents read the layers and wrote the single definitions (each checked against its original before delivery), reviewed every push independently, and are drafting the multi-user design (accounts, storage per person, sync by record) on branches of their own, as new files that touch no existing function. Their review found real things: the service worker's version skew, the tools broken by the data move, and start-up saves that would have marked an idle device as holding unsent work.

## 2026-11-15 — the restructure lives on `next`, not on `main`

`main` is the app on Thorne's devices and he has an exam coming. The restructure (files split out of `index.html`, one definition per function, the foundations for other users) is developed on the branch `next` in `.claude/worktrees/next` and is merged only when he says he is ready to launch, or after the exam. `main` still takes small fixes; `next` is rebased on them before the merge and takes the next version number then.

## 2026-11-15 — nothing is restructured without the screen-by-screen harness saying it is the same app

`tools/snap.mjs` opens the app in headless Chrome with a fixed clock, a seeded `Math.random`, its timers on that clock, and no network (a stand-in for the Firebase SDK lives in memory). It walks every tab, a review sitting, every drill, cloud-sync situations, and several thousand seeded random actions, at phone and tablet size, and records the page, the saved state and a picture after each step. Two recordings are compared. A change meant to leave behaviour alone must compare as identical, or every difference must be explained in the commit. This replaced "fold one function per release and smoke-test by hand": it is what made folding all the layers at once safe.

The first use found what hand-testing never would have: with one definition of `save()`, the entry the app adds to its time-lapse on the first open of a day would have marked the device as holding unsent work and pushed it to the cloud. Start-up now stores that entry locally only (`saveLocal`), as the layered code did by accident of ordering.

## 2026-11-15 — definitions first, then start-up

Every script first defines, and one place at the end runs start-up in a fixed order: load the saved state, migrate it, mount the screen, listen, paint once. Before this the file was version blocks, each of which defined some functions, ran a migration, and painted the home screen again; the page was painted about twenty times on every open, and what a start-up statement did depended on how many layers of a function existed above it in the file.

## 2026-11-15 — the data, the styles and the libraries are files

`data/words.js`, `grammar.js`, `components.js`, `readings.js`, `usage.js` each hold one `const NAME = <one line of JSON>`, which is what the content tools read and write. Styles are `css/app.css`. The QR library is `assets/qrcode.min.js`. There is no build step: the browser loads plain files, and GitHub Pages serves the repository as it is.

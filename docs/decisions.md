# Decisions

Decisions with consequences, newest first, each with its reason. Thorne asked on 15 November 2026 that Claude decide without asking and write the decisions down ([CLAUDE.md](../CLAUDE.md#the-commitment)); this is where they are written. A decision here can be changed, but change it here, with the new reason, in the same commit as the code.

## 2026-11-15 — the restructure lives on `next`, not on `main`

`main` is the app on Thorne's devices and he has an exam coming. The restructure (files split out of `index.html`, one definition per function, the foundations for other users) is developed on the branch `next` in `.claude/worktrees/next` and is merged only when he says he is ready to launch, or after the exam. `main` still takes small fixes; `next` is rebased on them before the merge and takes the next version number then.

## 2026-11-15 — nothing is restructured without the screen-by-screen harness saying it is the same app

`tools/snap.mjs` opens the app in headless Chrome with a fixed clock, a seeded `Math.random`, its timers on that clock, and no network (a stand-in for the Firebase SDK lives in memory). It walks every tab, a review sitting, every drill, cloud-sync situations, and several thousand seeded random actions, at phone and tablet size, and records the page, the saved state and a picture after each step. Two recordings are compared. A change meant to leave behaviour alone must compare as identical, or every difference must be explained in the commit. This replaced "fold one function per release and smoke-test by hand": it is what made folding all the layers at once safe.

The first use found what hand-testing never would have: with one definition of `save()`, the entry the app adds to its time-lapse on the first open of a day would have marked the device as holding unsent work and pushed it to the cloud. Start-up now stores that entry locally only (`saveLocal`), as the layered code did by accident of ordering.

## 2026-11-15 — definitions first, then start-up

Every script first defines, and one place at the end runs start-up in a fixed order: load the saved state, migrate it, mount the screen, listen, paint once. Before this the file was version blocks, each of which defined some functions, ran a migration, and painted the home screen again; the page was painted about twenty times on every open, and what a start-up statement did depended on how many layers of a function existed above it in the file.

## 2026-11-15 — the data, the styles and the libraries are files

`data/words.js`, `grammar.js`, `components.js`, `readings.js`, `usage.js` each hold one `const NAME = <one line of JSON>`, which is what the content tools read and write. Styles are `css/app.css`. The QR library is `assets/qrcode.min.js`. There is no build step: the browser loads plain files, and GitHub Pages serves the repository as it is.

# Releasing and the repository

The release area: `tools/check.mjs`, `tools/stamp.mjs`, `tools/snap.mjs`, `tools/swtest.mjs`, `tools/review.mjs`, `.claude/agents/`, `.claude/settings.json`, `README.md`, `CLAUDE.md`, `docs/`, `.gitignore`, and the GitHub side of the project.

## The repository

- GitHub: `thorneckieffer-creator/zika`, public. `main` is what the devices run; `next` (November 2026) carries the restructure until it is released ([decisions.md](decisions.md)). No Actions, no issues in use.
- GitHub Pages publishes `main` from the repository root (the classic branch build, no workflow file). A push is live at https://thorneckieffer-creator.github.io/zika/ in about two minutes.
- The repository has a `.nojekyll` file, so Pages serves the files as they are. (Before it, the classic Jekyll build read a doubled curly brace or a curly-brace-percent pair in a Markdown file as a template tag and failed the deploy; avoid them anyway until `.nojekyll` has been live for a while.)
- Every device takes a release the next time it is opened with a connection: the service worker stores it whole in the background and the page reloads into it ([architecture.md](architecture.md#the-service-worker-and-releases)). A bad push reaches every device; everything is tested locally first.
- The sync code never goes in the repo. The Firebase web config is public by design.

## A release

1. Before the change: `node tools/snap.mjs record` (about three minutes; it records the app as it is).
2. Make the change. Bump `APP_VERSION` in `js/core.js` and `VERSION` in `sw.js` to the same number. Bump `ASSETS` in `sw.js` only if a file under `assets/` changed.
3. `node tools/stamp.mjs` — rewrites the service worker's list of shell files. Needed after any change to the page, `js/`, `css/` or `data/`.
4. `node tools/check.mjs` — every script parses and is loaded, no name is defined twice, the versions agree, the stamp is current, the storage key, the data, the voice packs, and a self-test of the tone coach on synthetic tones.
5. `node tools/snap.mjs check` — every screen, the saved state and a picture, for scripted and seeded random use at phone and tablet size, compared with the recording from step 1. A change that should not alter behaviour comes back identical; otherwise read every difference and be able to say why it is there. If the service worker or how the page loads changed: `node tools/swtest.mjs --from <a folder holding the previous release>`.
6. Look at it yourself. Serve locally (`python3 -m http.server 8791 --bind 127.0.0.1`; port 8765 is taken by another project on this Mac) and open what the change touched at 390 px wide for iPhone, ~820 px for iPad upright, and 1180 × 796 for Thorne's iPad (10th generation) on its side: there the answer side of a review card and its grade buttons must fit without scrolling. The service worker is off on this address, so a reload shows the edit.
7. Run the `verify-app` subagent and tell it in a sentence what the change was meant to do. Fix what it fails and run it again until it records a PASS ([The checker](#the-checker)). Do this last: any edit to an app file after a PASS, the version bump included, voids it.
8. Commit as `vNN — what changed` and push `main`. Two minutes later, confirm the live copy is the one you pushed: `sw.js` on the site is byte for byte the local one (`curl -s <site>/sw.js | shasum` against `shasum sw.js`).

### The harness

`tools/snap.mjs` opens the app in headless Chrome with a fixed clock, a seeded `Math.random`, the app's timers on that clock, and no network: Chrome is started so that it can resolve no host but this machine, and a stand-in for the Firebase SDK lives in memory. The scenarios are in `tools/snap/scenarios.mjs`; the deck they start from is `tools/snap/fixtures/deck.json` (a month of study made by using the app; rebuild it with `node tools/snap.mjs fixture --dir <a known-good copy>` only when the deck's shape changes). Recordings are kept in `~/.cache/zika-snap/<folder name>/`, outside the repository.

- `record` / `check` for the usual before and after; `run --dir D --out O` and `diff A B` to compare any two copies of the app (for example a `git archive` of the last release against the working folder).
- `--only <text>` runs the scenarios whose name contains it; `--coverage` lists the functions no scenario reached; `--detail <scenario>:<step>` dumps the page and state at one step of a random run.
- It compares the page's HTML, the deck in memory, whether the stored deck matches it, what is in `localStorage`, what was sent to the stand-in cloud, and a picture (changed only above 150 differing pixels). It stubs the service worker and the microphone: `tools/swtest.mjs` and `tools/tone_lab.mjs` cover those.
- Add a scenario when you add a screen or a state a device can be in. A random-use scenario finds what a script does not think to try, but only a scripted step proves a particular path.

How to do step 6 from Claude in Chrome, learned the slow way:

- **Resizing the window does not resize the page.** Open any file on the local origin (the manifest will do), replace the document with same-origin iframes of 390 × 844, 820 × 1180 and 1180 × 796 pointing at `index.html?t=…`, and screenshot those. (The iPad's screen is 1180 × 820; the test size is a little shorter, so what fits at 796 fits on the tablet.)
- **Reach into a frame with `frame.contentWindow.eval('…')`.** The app's state lives in top-level `let` and `const`, which are not properties of `window`; assigning `frame.contentWindow.drillScope = …` changes nothing.
- **Check the deck before touching it.** The local origin (`127.0.0.1:8791`) held an unpaired throw-away deck in November 2026; confirm `SYNC.code` is empty before grading cards or saving, so a test never reaches the real sync room. Do not run tests on the live site's origin.
- **Anything that records** (tone coach, 口試, the speaking drill) can be driven without a microphone prompt: replace `navigator.mediaDevices.getUserMedia` in the frame with a function that returns `audioContext.createMediaStreamDestination().stream`, with an oscillator connected to it. A sawtooth gliding 250 → 130 Hz is a fourth tone. The context only runs after a real click in that frame.

A change that touches only documentation or `tools/` does not need a version bump or a review: nothing the devices load has changed. Commit it with a plain description instead of a `vNN` title.

## The checker

The session that makes a change tends to walk past its own mistakes, so a second agent checks every change to the app, and a gate keeps unchecked work from being called finished or reaching the devices. The loop is: make it, look at the real thing, compare it with what right means, fix it, and go round again until it passes.

| Piece | File | What it is |
|---|---|---|
| What right means | [review-checklist.md](review-checklist.md) | The lines every change is held against. A note Thorne gives twice becomes a line. |
| Where everything is | [feature-map.md](feature-map.md) | Every feature: where it is, how to test it, what good looks like. |
| The checker | `.claude/agents/verify-app.md` | A subagent with a fresh context. It serves the folder with the last release beside it, opens the app in Chrome at the three sizes, tests what the change touched, and records PASS or FAIL. It cannot use the edit tools. |
| The gate | `tools/review.mjs` | Ties a verdict to a fingerprint of the app files: every file in the repository except the notes and the tools. Called when a session tries to finish and before any shell command (`.claude/settings.json`), and before a push (`.git/hooks/pre-push`). |

How a change goes through it:

1. Finish the change, bump the version, run `node tools/check.mjs` and your own smoke test.
2. Run the `verify-app` subagent and tell it in a sentence what the change was meant to do. It writes its report and verdict to `.claude/review/` (git-ignored, one per folder). It runs in the background and takes a while; the session may stop while it works and is called back when it reports.
3. On a FAIL, fix every item in `.claude/review/verdict.txt` and run it again. After three FAILs, stop and tell Thorne what fails; do not keep going round.
4. On a PASS, make the corrections to the feature map that the report lists (the notes are not part of the fingerprint, so the PASS holds), then commit and push. `node tools/review.mjs status` shows where a folder stands at any time.

The rules:

- **Only the checker records a verdict.** `review.mjs pass` and `fail` are refused from anyone but the `verify-app` subagent (a hook on shell commands sees who is asking). The session that made the change does not write `.claude/review/verdict.txt` by hand either.
- **A PASS is for exact bytes.** Edit an app file afterwards and the gate asks for a new one. After `git rebase origin/main` the files are different, so the checker runs again on the rebased result.
- **A session cannot finish with unreviewed app changes.** It is sent back, up to three times in a row. To stop on purpose with the work unfinished (a question only Thorne can answer, or he asked for it to be left), begin a line of the reply with "Unverified:" and say what is unreviewed and why. Said once, that holds until an app file changes again, so a long piece of work left open between sessions (the `next` branch) does not hold up every reply.
- **A push to `main` that changes the app needs a PASS for the commit being pushed.** Only if Thorne says in so many words to release without the review: `git push --no-verify`.
- **Everything the site serves is the app.** The gate does not keep a list of app files; it leaves out `docs/`, `tools/`, `.claude/`, `.github/`, Markdown files and `.gitignore`, and reviews the rest, so a new file or folder (`css/`, `data/`) is covered from its first commit. A new folder the devices never load is added to `NOT_APP` in `tools/review.mjs` in the commit that adds it.
- **Keep the map and the checklist true.** A feature with no entry is not tested. A check a script can make belongs in `tools/check.mjs`, where it cannot be skipped.

Setting it up, and its limits:

- The checker and the two hooks come with the repository (`.claude/agents/verify-app.md`, `.claude/settings.json`). The push gate lives in `.git/hooks`, which git does not carry: on a new clone or a new Mac run `node tools/review.mjs install` once; worktrees share it.
- Claude Code reads hooks and agents when a session starts. After pulling a commit that adds or changes them, start a new session. A session that started before the checker existed cannot run it: it says so with "Unverified:" and leaves the release to the next session.
- A session started inside a worktree gets the loop when the worktree is rebased onto a commit that has it. Until then it is not sent back; a push to `main` from it is still gated, because whatever it pushes is built on `main`.
- Every gate fails open: if `tools/review.mjs` itself breaks, it says so and lets the session, the command or the push through.
- The gate tells the checker from everyone else by fields Claude Code gives its hooks (`agent_type`, `background_tasks`, `last_assistant_message`; checked against Claude Code 2.1.232). If a later Claude Code renames them, the signs are the checker being refused its own verdict, or a session being sent back while the checker is still running: fix `guard` and `stop-hook` in `tools/review.mjs`.
- A push made from outside this Mac (the GitHub website, a cloud session using the GitHub App) does not pass through the gate.

## Two sessions at once

Thorne sometimes runs two Claude windows on this project, split by the areas in [CLAUDE.md](../CLAUDE.md). Both can release; these rules keep them out of each other's way.

- **One folder each.** The first session works in the main folder. A second session makes its own copy and works only there:

  ```bash
  git worktree add -b dev .claude/worktrees/dev origin/main    # .claude/worktrees/ is git-ignored
  ```

  Never edit, stage, stash or reset in the other session's folder.
- **Stay in your area.** The area table says which files belong to which area; most areas now have files of their own under `js/` and `data/`. `js/core.js`, `js/shell.js`, `js/boot.js` and `css/app.css` are shared, so tell the other session before changing them.
- **Take the version number last.** Do not reserve one. When the work is ready: `git fetch`, `git rebase origin/main`, then bump to one more than what `origin/main` holds, run the check and then the checker (a rebase changes the files, so an earlier PASS no longer counts), and push.
- **Pushing from a worktree:** `git push origin dev:main`. Then tell the other session that `main` moved, so it runs `git pull --rebase --autostash` before its next commit.
- **Each folder has its own verdict.** The checker's report and PASS live in that folder's `.claude/review/`, and it serves the folder on its own port (8793, then 8794), so two sessions never check each other's build.
- **Each area has its own notes file** under `docs/`, so two sessions rarely edit the same one. Shared files (`CLAUDE.md`, `README.md`, `docs/roadmap.md`) get small, separate edits.

When the second session is finished, remove its copy with `git worktree remove .claude/worktrees/dev` and `git branch -d dev`.

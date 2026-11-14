# Releasing and the repository

The release area: `tools/check.mjs`, `README.md`, `CLAUDE.md`, `docs/`, `.gitignore`, and the GitHub side of the project.

## The repository

- GitHub: `thorneckieffer-creator/zika`, public, one branch (`main`). No Actions, no issues in use.
- GitHub Pages publishes `main` from the repository root (the classic branch build, no workflow file). A push is live at https://thorneckieffer-creator.github.io/zika/ in about two minutes.
- Because Pages runs the classic Jekyll build over every file, never write a doubled curly brace or a curly-brace-percent pair in a Markdown file: Jekyll reads them as template tags and the deploy fails.
- The shell is network-first, so a bad push reaches every device on its next open. Everything is tested locally first.
- The sync code never goes in the repo. The Firebase web config is public by design.

## A release

1. Make the change. Bump `APP_VERSION` in `index.html` and `VERSION` in `sw.js` to the same number. Bump `ASSETS` in `sw.js` only if a file under `assets/` changed.
2. `node tools/check.mjs`
3. Serve locally (`python3 -m http.server 8791 --bind 127.0.0.1`; port 8765 is taken by another project on this Mac) and smoke-test: open every tab, start a review, grade a card, run one drill, check the console. Check a 390-px-wide frame for iPhone and ~820 px for iPad.
4. Commit as `vNN — what changed` and push `main`.

A change that touches only documentation or `tools/` does not need a version bump: nothing the devices load has changed. Commit it with a plain description instead of a `vNN` title.

## Two sessions at once

Thorne sometimes runs two Claude windows on this project, split by the areas in [CLAUDE.md](../CLAUDE.md). Both can release; these rules keep them out of each other's way.

- **One folder each.** The first session works in the main folder. A second session makes its own copy and works only there:

  ```bash
  git worktree add -b dev .claude/worktrees/dev origin/main    # .claude/worktrees/ is git-ignored
  ```

  Never edit, stage, stash or reset in the other session's folder.
- **Stay in your area.** The area table says which files belong to which area. `index.html` is shared by all of them, so keep a change inside your area's functions and data, and tell the other session before reaching outside it.
- **Take the version number last.** Do not reserve one. When the work is ready: `git fetch`, `git rebase origin/main`, then bump to one more than what `origin/main` holds, run the check, and push.
- **Pushing from a worktree:** `git push origin dev:main`. Then tell the other session that `main` moved, so it runs `git pull --rebase --autostash` before its next commit.
- **Each area has its own notes file** under `docs/`, so two sessions rarely edit the same one. Shared files (`CLAUDE.md`, `README.md`, `docs/roadmap.md`) get small, separate edits.

When the second session is finished, remove its copy with `git worktree remove .claude/worktrees/dev` and `git branch -d dev`.

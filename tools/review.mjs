#!/usr/bin/env node
/* The review gate for 字卡: nothing that changes the app is finished, or pushed, until a separate
   checker has passed exactly those bytes. How it is used is in docs/releasing.md ("The checker").

     node tools/review.mjs status      where this folder stands
     node tools/review.mjs changes     the last release this folder is built on, and the app files that differ from it
     node tools/review.mjs pass        the checker records a PASS (it runs tools/check.mjs first and refuses if that fails)
     node tools/review.mjs fail        the checker records a FAIL
     node tools/review.mjs install     put the push gate in .git/hooks (once per clone)
     node tools/review.mjs stop-hook   called by Claude Code when a session tries to finish (.claude/settings.json)
     node tools/review.mjs guard       called by Claude Code before a shell command: only the checker may run pass or fail
     node tools/review.mjs pre-push    called by git before a push (.git/hooks/pre-push)

   A verdict is tied to a fingerprint of the app files: every file in the repository except the notes and
   the tools (NOT_APP below). Edit any of them after a PASS and the PASS no longer counts. A change to the
   notes or to tools/ needs no review.

   Every gate fails open: if this script itself breaks, it says so and lets the session, the command or the
   push through, so a bug here can never trap the project. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, lstatSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, isAbsolute } from 'node:path';

/* What is NOT the app. Everything else that GitHub Pages serves is, so a file or folder added later
   (css/, data/, a second page) is under review from its first commit without anyone remembering to list it.
   A new folder the devices never load (Firebase rules, say) is added here in the commit that adds it. */
const NOT_APP = [/^docs\//, /^tools\//, /^db\//, /^\.claude\//, /^\.github\//, /\.md$/i, /^\.gitignore$/, /^\.gitattributes$/];
const isApp = path => !NOT_APP.some(re => re.test(path));
const CHECKER = 'verify-app';                       /* the subagent in .claude/agents/, the only one that records a verdict */
const ROUNDS = 3;                                   /* FAILs, and reminders in a row, before the problem goes to Thorne */
const REVIEW = '.claude/review';                    /* git-ignored; one per working folder */
const cmd = process.argv[2] || '';

const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
const tryGit = (cwd, args, input) => { try { return git(cwd, args, input).trim(); } catch { return null; } };
const topOf = dir => (dir && existsSync(dir) ? tryGit(dir, ['rev-parse', '--show-toplevel']) : null);
const digest = text => createHash('sha1').update(text).digest('hex').slice(0, 12);
const listing = pairs => pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([path, hash]) => hash + ' ' + path).join('\n');
const isFile = f => { try { return lstatSync(f).isFile(); } catch { return false; } };

/* the app files on disk in this folder, committed or not (git-ignored files are not the app) */
function appFiles(top) {
  const listed = git(top, ['-c', 'core.quotepath=off', 'ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  return [...new Set(listed)].filter(f => isApp(f) && isFile(join(top, f)));
}
/* their fingerprint */
function fpFolder(top) {
  const files = appFiles(top);
  if (!files.length) return digest('');
  const hashes = git(top, ['hash-object', '--stdin-paths'], files.join('\n') + '\n').trim().split('\n');
  return digest(listing(files.map((f, i) => [f, hashes[i]])));
}
/* the same fingerprint for a commit; equal to fpFolder() when the folder holds exactly that commit's app files */
function fpCommit(top, rev) {
  const out = tryGit(top, ['-c', 'core.quotepath=off', 'ls-tree', '-r', '-z', rev]);
  if (out === null) return null;
  return digest(listing(out.split('\0').filter(Boolean).map(l => { const [meta, path] = l.split('\t'); return [path, meta.split(' ')[2]]; }).filter(([path]) => isApp(path))));
}
/* the last released commit this folder is built on */
const baseOf = top => tryGit(top, ['merge-base', 'HEAD', 'origin/main']) || tryGit(top, ['rev-parse', 'HEAD']);

function readVerdict(top) {
  const f = join(top, REVIEW, 'verdict.txt');
  if (!existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(/^(PASS|FAIL) ([0-9a-f]{12})\b/);
  return m ? { kind: m[1], fp: m[2] } : null;
}
function stateOf(top) {
  const fp = fpFolder(top), base = baseOf(top), baseFp = base ? fpCommit(top, base) : null, v = readVerdict(top);
  return { top, fp, changed: fp !== baseFp, verdict: v, current: v && v.fp === fp ? v.kind : null };
}
const verdictLine = s => s.current === 'PASS' ? 'PASS for these exact files'
  : s.current === 'FAIL' ? `FAIL for these exact files (the list is in ${REVIEW}/verdict.txt)`
  : s.verdict ? `none for these files (the last one, a ${s.verdict.kind}, was for an earlier edit)`
  : 'none yet';

/* what the gate remembers between calls: { rounds, fails, declared }
     rounds    reminders sent in a row to a session that keeps trying to finish
     fails     FAILs the checker has recorded since the last PASS or release
     declared  the fingerprint a session last stopped on with an "Unverified:" line */
const notesFile = top => join(top, REVIEW, 'state.json');
const getNotes = top => { try { return JSON.parse(readFileSync(notesFile(top), 'utf8')) || {}; } catch { return {}; } };
const setNotes = (top, patch) => { try { mkdirSync(join(top, REVIEW), { recursive: true }); writeFileSync(notesFile(top), JSON.stringify({ ...getNotes(top), ...patch }) + '\n'); } catch { /* not worth failing over */ } };
const times = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

const stdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };
const here = () => { const top = topOf(process.cwd()); if (!top) { console.error('review: not inside the repository'); process.exit(1); } return top; };

/* ---------- status ---------- */
if (cmd === 'status') {
  const s = stateOf(here()), n = getNotes(s.top);
  console.log(`folder       ${s.top}`);
  console.log(`app files    ${s.changed ? 'changed since the last release — they need a PASS before the work is finished or pushed' : 'the same as the last release — nothing to review'}`);
  console.log(`fingerprint  ${s.fp}`);
  console.log(`verdict      ${verdictLine(s)}`);
  if (s.changed && n.fails) console.log(`failed       ${times(n.fails)} since the last PASS`);
  if (s.changed && n.declared === s.fp && s.current !== 'PASS') console.log('left         a session stopped here on purpose and said so ("Unverified:")');
}

/* ---------- changes: what the checker has to look at ---------- */
else if (cmd === 'changes') {
  const top = here(), base = baseOf(top);
  if (!base) { console.error('review: no commit to compare with'); process.exit(1); }
  const diff = git(top, ['-c', 'core.quotepath=off', 'diff', '--name-status', '--no-renames', '-z', base]).split('\0').filter(Boolean);
  const rows = []; for (let i = 0; i + 1 < diff.length; i += 2) if (isApp(diff[i + 1])) rows.push(`${diff[i]}  ${diff[i + 1]}`);
  for (const f of git(top, ['-c', 'core.quotepath=off', 'ls-files', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean)) if (isApp(f)) rows.push(`new  ${f}`);
  console.log(`base  ${base}  (${tryGit(top, ['log', '-1', '--format=%s', base]).slice(0, 60)})`);
  console.log(rows.length ? rows.join('\n') : 'no app file differs from the base');
  if (rows.length) console.log(`\nRead one with:  git diff ${base.slice(0, 10)} -- <file> | cut -c1-300 | head -400`);
}

/* ---------- pass / fail: only the checker (the verify-app subagent) runs these ---------- */
else if (cmd === 'pass' || cmd === 'fail') {
  const top = here(), arg = process.argv[3] || join(REVIEW, 'report.md'), reportFile = isAbsolute(arg) ? arg : join(top, arg);
  let report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8').trim() : '';
  if (!report) { console.error(`review: write the report first (${REVIEW}/report.md): what was tested, at which sizes, what was found, what was not tested`); process.exit(1); }
  let kind = cmd === 'pass' ? 'PASS' : 'FAIL';
  const before = fpFolder(top);
  if (kind === 'PASS') {
    const run = spawnSync(process.execPath, [join('tools', 'check.mjs')], { cwd: top, encoding: 'utf8' });
    if (run.status !== 0) {
      kind = 'FAIL';
      report = 'The release check (node tools/check.mjs) fails, so this cannot pass:\n\n' + ((run.stdout || '') + (run.stderr || '')).trim().split('\n').slice(-25).join('\n') + '\n\n---\n\n' + report;
    }
  }
  const fp = fpFolder(top);
  if (fp !== before) { console.error('review: the app files changed while the verdict was being recorded — nothing recorded; review them again'); process.exit(1); }
  mkdirSync(join(top, REVIEW), { recursive: true });
  writeFileSync(join(top, REVIEW, 'verdict.txt'), `${kind} ${fp}\n${new Date().toISOString()}\n\n${report}\n`);
  setNotes(top, { fails: kind === 'PASS' ? 0 : (getNotes(top).fails || 0) + 1, declared: null });
  console.log(`Recorded ${kind} for fingerprint ${fp} in ${REVIEW}/verdict.txt`);
  if (kind === 'FAIL' && cmd === 'pass') { console.error('(asked for PASS, recorded FAIL: the release check does not pass)'); process.exit(1); }
}

/* ---------- install: the push gate lives in .git/hooks, which git does not track ---------- */
else if (cmd === 'install') {
  const top = here(), common = git(top, ['rev-parse', '--git-common-dir']).trim(), hooks = join(isAbsolute(common) ? common : join(top, common), 'hooks'), f = join(hooks, 'pre-push');
  const shim = `#!/bin/sh
# 字卡 push gate (installed by: node tools/review.mjs install). The logic is in tools/review.mjs.
top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$top/tools/review.mjs" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
exec node "$top/tools/review.mjs" pre-push "$@"
`;
  if (existsSync(f) && !readFileSync(f, 'utf8').includes('tools/review.mjs')) { console.error(`review: ${f} already exists and is not this gate — left alone`); process.exit(1); }
  mkdirSync(hooks, { recursive: true }); writeFileSync(f, shim); chmodSync(f, 0o755);
  mkdirSync(join(top, REVIEW), { recursive: true });
  console.log(`Push gate installed: ${f}`);
  console.log('The checker and the hooks come with the repository (.claude/agents/verify-app.md, .claude/settings.json); a session loads them when it starts.');
}

/* ---------- guard: the session that made a change does not mark its own work ---------- */
else if (cmd === 'guard') {
  try {
    const input = JSON.parse(stdin() || '{}'), command = String((input.tool_input || {}).command || '');
    if (/\bnode\b[^|;&\n]*review\.mjs["']?\s+(pass|fail)\b/.test(command) && input.agent_type !== CHECKER) {
      console.error(`Refused: only the ${CHECKER} subagent records a verdict. It did not make the change, so it has no reason to think it works. Run it (Agent tool, subagent_type "${CHECKER}") and say in a sentence what the change was meant to do.`);
      process.exit(2);
    }
  } catch { /* unreadable input: let the command through */ }
  process.exit(0);
}

/* ---------- stop-hook: a session may not finish with unreviewed app changes ---------- */
else if (cmd === 'stop-hook') {
  try {
    let input = {}; try { input = JSON.parse(stdin() || '{}'); } catch { /* no input: treat as a first stop */ }
    if (input.agent_id) process.exit(0);                                         /* a subagent finishing is not the session finishing */
    const top = topOf(input.cwd) || topOf(process.env.CLAUDE_PROJECT_DIR) || topOf(process.cwd());
    if (!top) process.exit(0);
    const s = stateOf(top);
    if (!s.changed) { setNotes(top, { rounds: 0, fails: 0, declared: null }); process.exit(0); }
    if (s.current === 'PASS') { setNotes(top, { rounds: 0, declared: null }); process.exit(0); }
    /* stopping on purpose, and saying so in the reply, is allowed: Thorne is told the work is unreviewed.
       Said once, it holds for these exact bytes, so a later question about something else is not held up. */
    if (/^[\s>*_#-]*unverified\b/im.test(String(input.last_assistant_message || ''))) { setNotes(top, { rounds: 0, declared: s.fp }); process.exit(0); }
    const notes = getNotes(top);
    if (notes.declared === s.fp) process.exit(0);
    /* the checker is at work in the background: the session is called back when it reports */
    if ((Array.isArray(input.background_tasks) ? input.background_tasks : []).some(t => t && t.agent_type === CHECKER)) process.exit(0);
    const n = (input.stop_hook_active ? notes.rounds || 0 : 0) + 1, fails = notes.fails || 0;
    if (n > ROUNDS) { setNotes(top, { rounds: 0 }); process.exit(0); }
    setNotes(top, { rounds: n });
    console.error([
      `Not finished (reminder ${n} of ${ROUNDS}). The app files in ${top} differ from the last release, and the checker has not passed them.`,
      `Fingerprint ${s.fp} · verdict: ${verdictLine(s)}${fails ? ` · the checker has failed this change ${times(fails)}` : ''}.`,
      '',
      '1. Finish the change, including the version bump. Any later edit to an app file voids a PASS.',
      `2. Run the ${CHECKER} subagent and tell it in a sentence what the change was meant to do. It tests the running app against docs/feature-map.md and docs/review-checklist.md and records the verdict; you cannot record one yourself. While it works in the background you may stop: you are called back when it reports.`,
      `3. On a FAIL, fix every item in ${REVIEW}/verdict.txt and run it again.`,
      '',
      fails >= ROUNDS
        ? `The checker has failed this change ${times(fails)}. Do not go round again unless Thorne has said to: begin a line of your reply with "Unverified:" and tell him what still fails and that nothing was pushed.`
        : `Stopping on purpose with the change unfinished (a question only Thorne can answer, he asked you to leave it, or this session has no ${CHECKER} subagent because it started before the checker was added)? Begin a line of your reply with "Unverified:" and say what is unreviewed and why. Then you can stop.`,
    ].join('\n'));
    process.exit(2);
  } catch (e) { console.error('review stop-hook could not run, letting the session finish: ' + e.message); process.exit(0); }
}

/* ---------- pre-push: main deploys to every device, so only reviewed app files reach it ---------- */
else if (cmd === 'pre-push') {
  try {
    const top = topOf(process.cwd());
    if (!top) process.exit(0);
    const ZERO = /^0+$/;
    for (const line of stdin().split('\n').filter(Boolean)) {
      const [, localSha, remoteRef, remoteSha] = line.split(' ');
      if (remoteRef !== 'refs/heads/main' || !localSha || ZERO.test(localSha)) continue;
      const pushed = fpCommit(top, localSha);
      const live = (remoteSha && !ZERO.test(remoteSha) ? fpCommit(top, remoteSha) : null) || fpCommit(top, 'origin/main');
      if (pushed === null || pushed === live) continue;            /* notes or tools only: nothing the devices load changed */
      const v = readVerdict(top);
      if (v && v.kind === 'PASS' && v.fp === pushed) continue;
      const s = stateOf(top);
      const steps = s.fp !== pushed && s.current === 'PASS'
        ? ['The checker passed this folder, but the folder holds app edits that are not in the commit being pushed.',
           'Commit them (the PASS still holds, because the files do not change) and push again.']
        : [s.fp !== pushed ? 'The folder also holds app edits that are not in the commit being pushed. Commit or undo them so the folder matches, then:' : 'To release:',
           `  1. run the ${CHECKER} subagent on this folder (it records the verdict; you cannot record one yourself)`,
           '  2. on a FAIL, fix every item, amend or add a commit, and run it again',
           '  3. push again once the verdict is PASS'];
      console.error([
        '',
        `Push stopped. Commit ${localSha.slice(0, 7)} changes the app, and the checker has not passed those exact files`,
        `(pushed fingerprint ${pushed}; this folder ${s.fp}; verdict: ${verdictLine(s)}).`,
        '',
        ...steps,
        '',
        'Only if Thorne says in so many words to release without the review: git push --no-verify',
        '',
      ].join('\n'));
      process.exit(1);
    }
    process.exit(0);
  } catch (e) { console.error('review pre-push could not run, letting the push through: ' + e.message); process.exit(0); }
}

else {
  console.error('usage: node tools/review.mjs status | changes | pass [report] | fail [report] | install');
  process.exit(1);
}

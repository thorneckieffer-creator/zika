/* The screens and actions tools/snap.mjs walks through.

   A scenario opens the app (optionally on a fixture: the contents of localStorage) and then runs
   - `steps`: each step's `js` runs in the page, where the app's own functions and state are in scope; the
     harness then waits for the page to settle and records its HTML, the saved state and a screenshot;
   - `monkeys`: seeded random tapping, typing and key presses, optionally kept inside one part of the page
     (`scope`), recorded as one line per action with fingerprints of state and page.
   __tick(ms) moves the clock; __setNow(t) sets it. Names starting with `__` only run when asked for by name. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 86400000;
const T0 = Date.parse('2026-11-20T09:30:00+08:00');
const tabs = ['home', 'rev', 'drill', 'gram', 'brain', 'lib', 'set', 'exam', 'catch', 'my'];
const drills = ['rec', 'tone', 'dict', 'sent', 'speak', 'confuse', 'read', 'listen', 'sdict', 'mtest', 'tcoach', 'story', 'usage'];
const CODE = 'zika-test01';   /* a made-up sync code: the harness's cloud is in memory */
const SHEETS = ', .modal-card, #syncModal';   /* sheets and modals sit outside the view they belong to */

/* the fixture's deck, for scenarios that open on an altered copy of it */
const fx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'deck.json'), 'utf8'));
const altered = (drop, change) => { const S = JSON.parse(fx.shida_b1_fsrs_v2); for (const k of drop) delete S.settings[k]; if (change) change(S); return JSON.stringify(S); };
const FLAGS = ['_v18', '_v22', '_v25', '_v26', '_v28', '_v30', '_v31', '_v38'];
const oldDeck = S => { delete S.exam; delete S.conf; delete S.my; delete S.settings.userName; delete S.settings.prodScope; S.settings.curLesson = 22; S.settings.newPerDay = 9; };
const unlinked = { zika_sync_meta: JSON.stringify({ at: 0, dirty: false, remoteDev: '' }) };
const linkedIdle = { zika_sync_code: CODE, zika_sync_meta: JSON.stringify({ at: T0 - 2 * DAY, dirty: false, remoteDev: 'iPad' }) };   /* linked, nothing unsent */
/* every script but js/boot.js has loaded, and start-up has not run */
const GAP = `typeof usRender === 'function' && typeof DRILL_SCREENS === 'object' && !window.zikaStarted`;
const opened = [{ name: 'settings', js: `go('set')`, noShot: true }, { name: 'home', js: `go('home')`, noShot: true }, { name: 'a-little-later', js: `__tick(5000)`, noShot: true }];
const otherSaves = change => `{ const o = JSON.parse(localStorage.getItem('shida_b1_fsrs_v2')); ${change}; __cloud.other(o, 'iPad', Date.now() + 1000); }`;

/* one sitting of reviews through the real screen: show the answer, grade, next */
const study = max => `{ go('rev'); let n = 0; while (cur && n < ${max}) { reveal(); const r = Math.random(); grade(r < 0.1 ? 1 : r < 0.25 ? 2 : r < 0.85 ? 3 : 4); __tick(15000); n++; } go('home'); }`;
const nextMorning = `{ const d = new Date(__now() + ${DAY}); d.setHours(9, 12 + d.getDate(), 0, 0); __setNow(d.getTime()); }`;
const knowLessons = (a, z) => `for (let l = ${a}; l <= ${z}; l++) (LESSON_WORDS[l] || []).forEach(w => markKnown(w.id));`;

/* monkeys that each stay in one area */
const areaMonkeys = n => [
  { name: 'home', start: `go('home')`, scope: '#vHome' + SHEETS, steps: n },
  { name: 'review', start: `go('rev')`, scope: '#vRev' + SHEETS, steps: 2 * n },
  { name: 'grammar', start: `go('gram')`, scope: '#vGram' + SHEETS, steps: n },
  { name: 'brain', start: `go('brain')`, scope: '#vBrain' + SHEETS, steps: n },
  { name: 'library', start: `go('lib')`, scope: '#vLib' + SHEETS, steps: n },
  { name: 'exam', start: `go('exam')`, scope: '#vExam' + SHEETS, steps: n },
  { name: 'catch-up', start: `go('catch')`, scope: '#vCatch' + SHEETS, steps: Math.ceil(n / 2) },
  { name: 'my-words', start: `go('my')`, scope: '#vMy' + SHEETS, steps: 2 * n },
  { name: 'settings', start: `go('set')`, scope: '#vSet' + SHEETS, steps: n },
];
const drillMonkeys = n => drills.map(m => ({ name: 'drill-' + m, start: `go('drill'); startDrill('${m}')`, scope: '#vDrill' + SHEETS, steps: n }));

export const scenarios = [
  /* Builds tools/snap/fixtures/deck.json: a deck with a month of history, made by using the app the way a learner
     does. Run with `node tools/snap.mjs fixture --dir <a known-good copy>`; the other scenarios start from what it
     leaves. The learner here knew Book 1 already, marked half of Book 2 known a week in, has been studying
     Book 2 Lessons 8 to 13 since, and has used every screen. Settings end as they were before the random part. */
  { name: '__fixture', at: T0 - 30 * DAY, sizes: ['phone'], noShots: true, fixtureOut: 'deck',
    steps: [
      { name: 'book1-known', js: knowLessons(1, 15) + `shSetLesson(23); try { shClose(); } catch (e) {} return Object.keys(S.cards).length` },
      ...Array.from({ length: 28 }, (_, d) => ({ name: 'day' + String(d).padStart(2, '0'), js:
        (d === 7 ? knowLessons(16, 22) : '')
        + (d && d % 5 === 0 ? `shSetLesson(Math.min(28, S.settings.curLesson + 1)); try { shClose(); } catch (e) {} qLoadLesson(S.settings.curLesson);` : d === 0 ? 'qLoadLesson(23);' : d === 3 ? `LESSON_WORDS[24].slice(0, 9).forEach(w => addHard(w.id));` : '')
        + study(d % 6 === 5 ? 15 : 80) + nextMorning + (d === 27 ? 'window.__keep = JSON.stringify(S.settings);' : '') + 'return [S.settings.curLesson, Object.values(S.cards).filter(c => c.st).length]' })),
    ],
    monkeys: [...areaMonkeys(40), ...drillMonkeys(22), { name: 'restore-settings', steps: 0,
      start: `const keep = JSON.parse(window.__keep), flags = {}; for (const k in S.settings) if (/^_/.test(k)) flags[k] = S.settings[k];
              S.settings = { ...keep, ...flags }; save(); try { shLook(); } catch (e) {} go('home'); __tick(100);` }] },

  /* a brand-new device */
  { name: 'fresh', steps: tabs.map(t => ({ name: 'tab-' + t, js: `go('${t}')` })) },
  /* the welcome sheet: a new learner starting at the beginning, and one joining a class that is already in Book 2 */
  { name: 'first-run', steps: [
    { name: 'name', js: `const i = document.getElementById('shWelName'); i.value = 'Mei'; i.dispatchEvent(new Event('input', { bubbles: true }))` },
    { name: 'start', js: `shWelcomeDone()` }, { name: 'review', js: `go('rev')` }, { name: 'answer', js: `reveal()` },
    { name: 'exam-tab', js: `go('exam')` }, { name: 'settings', js: `go('set')`, noShot: true }, { name: 'open-again', reload: true }] },
  { name: 'first-run-book-2', sizes: ['phone'], steps: [
    { name: 'pick-lesson', js: `WELCOME.ln = 22; shWelcome()` }, { name: 'know-earlier', js: `WELCOME.known = true; shWelcome()` },
    { name: 'start', js: `shWelcomeDone()` }, { name: 'library', js: `go('lib')`, noShot: true }, { name: 'grammar', js: `go('gram')`, noShot: true }] },
  { name: 'first-run-other-device', sizes: ['phone'], steps: [{ name: 'link-instead', js: `shWelcomeLink()` }, { name: 'close-and-reopen', reload: true }] },
  { name: 'fresh-roam', sizes: ['phone'], monkeys: [{ name: 'roam', steps: 150, seed: 5 }] },

  /* every tab of a deck in use, at both sizes, with pictures */
  { name: 'tabs', fixture: 'deck', steps: [
    ...tabs.map(t => ({ name: 'tab-' + t, js: `go('${t}')` })),
    { name: 'home-more-open', js: `go('home'); const f = document.querySelector('#vHome details.fold'); if (f) f.open = true;` },
    { name: 'where-you-are', js: `shCourse()` },
    { name: 'where-closed', js: `shClose()` },
    { name: 'dark', js: `toggleTheme(); go('home')` },
    { name: 'dark-review', js: `go('rev'); reveal()` },
  ] },

  /* a review sitting, card by card */
  { name: 'review', fixture: 'deck', steps: [
    { name: 'front', js: `go('rev')` },
    ...[3, 1, 4, 2, 3, 3, 1, 3].flatMap((g, i) => [{ name: `card${i}-answer`, js: `reveal()`, noShot: i > 2 }, { name: `card${i}-grade${g}`, js: `grade(${g}); __tick(20000)`, noShot: i > 2 }]),
    { name: 'undo', js: `doUndo()`, noShot: true }, { name: 'undo-again', js: `doUndo()`, noShot: true },
    { name: 'know', js: `skipKnown('k')`, noShot: true }, { name: 'mastered', js: `skipKnown('m')`, noShot: true },
    { name: 'next-day', js: `__tick(${DAY}); go('home')` }, { name: 'next-day-review', js: `go('rev'); reveal()` },
  ] },

  /* each drill: its opening screen, then random use */
  ...drills.map(m => ({ name: 'drill-' + m, fixture: 'deck', steps: [{ name: 'menu', js: `go('drill')`, noShot: m !== 'rec' }, { name: 'start', js: `startDrill('${m}')` }],
    monkeys: [{ name: m, start: `go('drill'); startDrill('${m}')`, scope: '#vDrill' + SHEETS, steps: 45, seed: 21 }] })),

  /* each area under random use */
  ...areaMonkeys(70).map((m, i) => ({ name: 'area-' + m.name, fixture: 'deck', sizes: ['phone'], monkeys: [{ ...m, seed: 40 + i }] })),
  { name: 'area-review-tablet', fixture: 'deck', sizes: ['tablet'], monkeys: [{ name: 'review', start: `go('rev')`, scope: '#vRev' + SHEETS, steps: 80, seed: 61 }] },

  /* cloud sync against the harness's stand-in for Firebase: nothing here reaches a real database */
  { name: 'sync-first-push', fixture: 'deck', local: { zika_sync_code: CODE }, cloud: { code: CODE }, steps: [
    { name: 'settings', js: `go('set')` },
    { name: 'grade-pushes', js: `go('rev'); reveal(); grade(3); __tick(5000)`, noShot: true },
    { name: 'copy-code', js: `fbCopyCode(); fbCopyLink()`, noShot: true },
    { name: 'unlink', js: `go('set'); fbUnlink()`, noShot: true },
    { name: 'new-code', js: `fbNewCode(); __cloud.code = SYNC.code`, noShot: true },
    { name: 'home', js: `go('home')`, noShot: true },
  ] },
  { name: 'sync-link-fresh', hash: '#sync=' + CODE, cloud: { code: CODE, remote: 'deck' }, steps: [
    { name: 'home', js: `go('home')` }, { name: 'settings', js: `go('set')` }, { name: 'review', js: `go('rev'); reveal(); grade(3); __tick(5000)`, noShot: true },
    { name: 'undo-adopt', js: `fbRevert()`, noShot: true },
  ] },
  { name: 'sync-conflict-use-theirs', fixture: 'deck', local: { zika_sync_code: CODE }, cloud: { code: CODE, remote: 'deck' }, steps: [
    { name: 'use-theirs', js: `document.getElementById('cfUse').click()` }, { name: 'settings', js: `go('set')`, noShot: true },
  ] },
  { name: 'sync-conflict-keep-mine', fixture: 'deck', sizes: ['phone'], local: { zika_sync_code: CODE }, cloud: { code: CODE, remote: 'deck' }, steps: [
    { name: 'keep-mine', js: `document.getElementById('cfKeep').click()` }, { name: 'settings', js: `go('set')`, noShot: true },
  ] },
  { name: 'sync-live', fixture: 'deck', sizes: ['phone'], local: { zika_sync_code: CODE }, cloud: { code: CODE }, steps: [
    { name: 'other-device-saves', js: `__tick(60000); const o = JSON.parse(JSON.stringify(S)); o.settings.curLesson = 27; o.hard = []; __cloud.other(o, 'iPad', Date.now())` },
    { name: 'undo', js: `fbRevert()`, noShot: true },
    { name: 'clash', js: `go('rev'); reveal(); grade(3); const o = JSON.parse(JSON.stringify(S)); o.settings.curLesson = 26; __cloud.other(o, 'iPad', Date.now() + 5)`, noShot: true },
    { name: 'after-clash', js: `__tick(9000)`, noShot: true },
    { name: 'pull-now', js: `const o = JSON.parse(JSON.stringify(S)); o.settings.curLesson = 25; __cloud.other(o, 'iPhone', Date.now() + 9); await fbPullNow()`, noShot: true },
    { name: 'other-device-is-ahead', js: `__tick(30000); const o = JSON.parse(JSON.stringify(S)); o.settings.curLesson = 24; __cloud.put('rooms/' + SYNC.code + '/study_state', { v: 18, json: JSON.stringify(o), device: 'iPad', device_id: 'other-device', synced_at: Date.now() + 600000, bytes: 1 }); SYNC.unsub && SYNC.unsub(); SYNC.unsub = null; go('rev'); reveal(); grade(4)`, noShot: true },
    { name: 'rejected-write', js: `__tick(3000)` },
  ] },
  { name: 'sync-roam', fixture: 'deck', sizes: ['phone'], local: { zika_sync_code: CODE }, cloud: { code: CODE }, monkeys: [
    { name: 'settings', start: `go('set')`, scope: '#vSet' + SHEETS, steps: 60, seed: 71 }, { name: 'roam', steps: 80, seed: 72 }] },

  /* Opening the app, on the states a device can be in. What matters here is what start-up leaves behind: the stored
     deck, whether the device now claims unsent work, and what it sends. (Scenarios and the cases they cover come
     from the independent review of the restructure, November 2026.) */
  { name: 'open-new-day', fixture: 'deck', local: unlinked, steps: opened },
  { name: 'open-same-day', fixture: 'deck', at: Date.parse('2026-11-18T21:00:00+08:00'), local: unlinked, steps: opened },
  { name: 'open-twice', fixture: 'deck', local: unlinked, sizes: ['phone'], steps: [{ name: 'study', js: `go('rev'); reveal(); grade(3); reveal(); grade(1); __tick(30000)`, noShot: true }, { name: 'open-again', reload: true }, ...opened, { name: 'and-again-next-morning', js: `__tick(${DAY})`, noShot: true }, { name: 'open-next-day', reload: true }] },
  { name: 'open-linked-idle-cloud-newer', fixture: 'deck', local: linkedIdle, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 3600000 }, steps: opened },
  { name: 'open-linked-idle-then-other-saves', fixture: 'deck', local: linkedIdle, cloud: { code: CODE }, sizes: ['phone'], steps: [{ name: 'other-saves', js: `__tick(60000);` + otherSaves(`o.settings.curLesson = 27`), noShot: true }, { name: 'a-little-later', js: `__tick(5000)`, noShot: true }] },
  { name: 'open-one-migration-behind', fixture: 'deck', sizes: ['phone'], local: { ...linkedIdle, shida_b1_fsrs_v2: altered(['_v38'], S => { delete S.exam; }) }, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 3600000 }, steps: opened },
  { name: 'open-old-deck-linked', fixture: 'deck', sizes: ['phone'], local: { ...linkedIdle, shida_b1_fsrs_v2: altered(FLAGS, oldDeck) }, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 3600000 }, steps: opened },
  { name: 'open-old-deck', fixture: 'deck', local: { ...unlinked, shida_b1_fsrs_v2: altered(FLAGS, oldDeck) }, steps: opened },
  { name: 'open-no-confidence-snapshot', fixture: 'deck', sizes: ['phone'], local: { ...linkedIdle, shida_b1_fsrs_v2: altered([], S => { delete S.conf; }) }, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 3600000 }, steps: opened },
  { name: 'open-before-v11', fixture: 'deck', sizes: ['phone'], local: { ...linkedIdle, shida_b1_fsrs_v2: altered(['_v11']) }, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 3600000 }, steps: opened },
  { name: 'open-v1-deck', sizes: ['phone'], local: { shida_b1_fsrs_v1: JSON.stringify({ cards: { 'w10:mean': { st: 'rev', S: 12, D: 5, due: T0 - DAY, last: T0 - 9 * DAY, reps: 4, lapses: 0, days: 3 }, 'w10:hw': { st: 'learn', S: 1, D: 5, due: T0 - DAY, last: T0 - 2 * DAY, reps: 1, lapses: 0, days: 1 }, 'w11:pin': {} }, log: { '2026-11-01': { rev: 5, new: 2 } }, settings: { retention: 0.88, maxRev: 150, includeNames: true } }) }, steps: opened },
  { name: 'open-fresh-linked', sizes: ['phone'], local: { zika_sync_code: CODE }, cloud: { code: CODE, remote: 'deck' }, steps: opened },
  { name: 'open-link-over-a-deck', fixture: 'deck', sizes: ['phone'], hash: '#sync=' + CODE, cloud: { code: CODE, remote: 'deck' }, steps: [...opened, { name: 'use-theirs', js: `const b = document.getElementById('cfUse'); if (b) b.click(); return !!b`, noShot: true }, { name: 'a-little-later-still', js: `__tick(5000)`, noShot: true }] },
  { name: 'open-link-same-code', fixture: 'deck', sizes: ['phone'], hash: '#sync=' + CODE, local: linkedIdle, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 3600000 }, steps: opened },
  { name: 'open-cloud-unreadable', fixture: 'deck', sizes: ['phone'], local: linkedIdle, cloud: { code: CODE }, steps: [
    { name: 'bad-copy-arrives', js: `__tick(60000); __cloud.put('rooms/' + SYNC.code + '/study_state', { v: 18, json: '{not json', device: 'iPad', device_id: 'other-device', synced_at: Date.now() + 5, bytes: 1 })`, noShot: true }] },

  /* A tap before start-up has run. The page's buttons work as soon as their script has loaded, so with js/boot.js
     arriving late (or never) a tap must not store or send an empty deck in place of the saved one. Found by the
     independent review: at one point on the `next` branch this replaced a 2,288-card deck with an empty one. */
  { name: 'tap-before-start', fixture: 'deck', local: unlinked, sizes: ['phone'], query: '?slow=js/boot.js&ms=900',
    early: { when: GAP, js: `toggleTheme(); document.getElementById('setBtn').click()` }, steps: opened },
  { name: 'tap-before-start-linked', fixture: 'deck', sizes: ['phone'], query: '?slow=js/boot.js&ms=900', local: { zika_sync_code: CODE, zika_sync_meta: JSON.stringify({ at: T0 - 2 * DAY, dirty: false, remoteDev: 'Web' }) }, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 2 * DAY },
    early: { when: GAP, js: `toggleTheme()` }, steps: opened },

  /* Replacing the deck on purpose still works through the guard on empty decks: erase, import (a small deck, then an
     empty one), and a new learner with no cards yet whose settings must still reach the cloud. */
  { name: 'erase', fixture: 'deck', sizes: ['phone'], local: linkedIdle, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 2 * DAY }, steps: [
    { name: 'erase', js: `go('set'); [...document.querySelectorAll('#vSet button')].find(b => b.textContent.trim() === 'Reset').click(); __tick(3000)`, noShot: true },
    { name: 'open-again', reload: true }, { name: 'home', js: `go('home')`, noShot: true }] },
  { name: 'import', fixture: 'deck', sizes: ['phone'], local: unlinked, steps: [
    { name: 'small-deck', js: `importData({ files: [new File([JSON.stringify({ cards: { 'w10:rec': { st: 'rev', S: 12, D: 5, due: Date.now() - 1000, last: Date.now() - 9 * ${DAY}, reps: 4, lapses: 0, days: 3 }, 'w11:rec': {} }, log: {}, settings: { curLesson: 3 } })], 'deck.json')] }); await new Promise(r => __realSetTimeout(r, 200)); go('home')`, noShot: true },
    { name: 'empty-deck', js: `importData({ files: [new File([JSON.stringify({ cards: {}, log: {} })], 'empty.json')] }); await new Promise(r => __realSetTimeout(r, 200)); go('home')`, noShot: true },
    { name: 'open-again', reload: true }] },
  { name: 'new-learner-linked', sizes: ['phone'], local: { zika_sync_code: CODE }, cloud: { code: CODE }, steps: [
    { name: 'a-setting', js: `shSetLook('accent', 'blue'); __tick(3000)`, noShot: true }, { name: 'another', js: `shSetLook('zhFont', 'kai'); __tick(3000)`, noShot: true },
    { name: 'welcome-done', js: `shWelcome(); shWelcomeDone(); __tick(3000)`, noShot: true }, { name: 'open-again', reload: true }] },

  /* a device in dark mode with the theme left on "auto"; a chosen look */
  { name: 'dark-auto', fixture: 'deck', scheme: 'dark', steps: [{ name: 'settings', js: `go('set')` }, { name: 'review', js: `go('rev'); reveal()` }] },
  { name: 'dark-fresh', scheme: 'dark', sizes: ['phone'], steps: [{ name: 'settings', js: `go('set')` }] },
  { name: 'dark-forced-light', fixture: 'deck', scheme: 'dark', sizes: ['phone'], local: { shida_b1_fsrs_v2: altered([], S => { S.settings.theme = 'light'; }), zika_look: JSON.stringify({ t: 'light', p: '', a: '', z: '' }) }, steps: [{ name: 'review', js: `go('rev')` }] },
  { name: 'look-clean-blue-kai-dark', fixture: 'deck', local: { shida_b1_fsrs_v2: altered([], S => { S.settings.palette = 'clean'; S.settings.accent = 'blue'; S.settings.zhFont = 'kai'; S.settings.theme = 'dark'; }) }, steps: [{ name: 'review', js: `go('rev'); reveal()` }, { name: 'settings', js: `go('set')` }] },

  /* with the app's animations on (every other scenario asks for reduced motion) */
  { name: 'motion-review', fixture: 'deck', motion: true, sizes: ['phone'], steps: [{ name: 'front', js: `go('rev')`, noShot: true }, ...[3, 1, 4, 3].flatMap((g, i) => [{ name: `card${i}`, js: `reveal(); grade(${g}); __tick(20000)`, noShot: true }])],
    monkeys: [{ name: 'roam', steps: 120, seed: 31 }] },

  /* a sitting that crosses midnight; lanes, a catch-up lesson, a quick sitting, grammar cards, leeches */
  { name: 'midnight', fixture: 'deck', sizes: ['phone'], at: Date.parse('2026-11-20T23:57:00+08:00'), steps: [
    { name: 'start', js: `go('rev')`, noShot: true },
    ...[3, 1, 3, 4, 2, 3, 1, 3, 3, 3].map((g, i) => ({ name: `card${i}`, js: `reveal(); grade(${g}); __tick(40000)`, noShot: true })),
    { name: 'home', js: `go('home')` }, { name: 'undo', js: `go('rev'); doUndo(); doUndo(); doUndo()`, noShot: true }, { name: 'brain', js: `go('brain')`, noShot: true }] },
  { name: 'lanes', fixture: 'deck', sizes: ['phone'], steps: [
    { name: 'lane-live', js: `startLane('live'); return [cur, rq.learn.length, rq.rev.length, rq.fresh.length]`, noShot: true }, { name: 'grade', js: `reveal(); grade(3); reveal(); grade(1); __tick(20000)`, noShot: true },
    { name: 'lane-catch', js: `go('home'); startLane('catch'); return [cur, rq.learn.length, rq.rev.length, rq.fresh.length]`, noShot: true }, { name: 'grade-catch', js: `for (let i = 0; i < 6 && cur; i++) { reveal(); grade(i % 3 ? 3 : 1); __tick(20000); } return [S.intro, S.cintro, S.gintro]`, noShot: true },
    { name: 'catch-lesson', js: `go('home'); startCatchLesson(24); return [view, cur]`, noShot: true }, { name: 'quick', js: `go('home'); startQuick(5); return [cur, rq.learn.length + rq.rev.length + rq.fresh.length]`, noShot: true },
    { name: 'grammar-cards', js: `go('home'); const g = Object.keys(S.cards).filter(isGram).slice(0, 6); g.forEach((c, i) => rate(c, 1 + i % 4)); return [S.intro, S.gintro, g.map(c => S.cards[c].st)]`, noShot: true },
    { name: 'leech', js: `const c = Object.keys(S.cards).find(k => !isGram(k) && S.cards[k].st === 'rev'); S.cards[c].lapses = 3; rate(c, 1); const a = [S.cards[c].lapses, isHard(c.split(':')[0])]; S.cards[c].st = 'rev'; S.cards[c].lapses = 6; rate(c, 1); return [a, S.cards[c].susp, S.cards[c].leech]`, noShot: true }] },
  { name: 'sync-burst', fixture: 'deck', sizes: ['phone'], local: linkedIdle, cloud: { code: CODE }, steps: [
    { name: 'burst', js: `go('rev'); for (let i = 0; i < 4 && cur; i++) { reveal(); grade(3); __tick(300); } fbPush(); reveal(); grade(2); fbPush(); __tick(100)`, noShot: true },
    { name: 'to-the-background', js: `reveal(); grade(3); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); __tick(3000)`, noShot: true }] },

  /* the whole app under random use, with days passing */
  { name: 'roam-a', fixture: 'deck', sizes: ['phone'], monkeys: [{ name: 'roam', steps: 260, seed: 7, dayEvery: 90 }] },
  { name: 'roam-b', fixture: 'deck', sizes: ['tablet'], monkeys: [{ name: 'roam', steps: 260, seed: 8, dayEvery: 90 }] },
];

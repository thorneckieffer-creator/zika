/* The screens and actions tools/snap.mjs walks through.

   A scenario opens the app (optionally on a fixture: the contents of localStorage) and then runs
   - `steps`: each step's `js` runs in the page, where the app's own functions and state are in scope; the
     harness then waits for the page to settle and records its HTML, the saved state and a screenshot;
   - `monkeys`: seeded random tapping, typing and key presses, optionally kept inside one part of the page
     (`scope`), recorded as one line per action with fingerprints of state and page.
   __tick(ms) moves the clock; __setNow(t) sets it. Names starting with `__` only run when asked for by name. */
const DAY = 86400000;
const T0 = Date.parse('2026-11-20T09:30:00+08:00');
const tabs = ['home', 'rev', 'drill', 'gram', 'brain', 'lib', 'set', 'exam', 'catch', 'my'];
const drills = ['rec', 'tone', 'dict', 'sent', 'speak', 'confuse', 'read', 'listen', 'sdict', 'mtest', 'tcoach', 'story', 'usage'];
const CODE = 'zika-test01';   /* a made-up sync code: the harness's cloud is in memory */
const SHEETS = ', .modal-card, #syncModal';   /* sheets and modals sit outside the view they belong to */

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

  /* the whole app under random use, with days passing */
  { name: 'roam-a', fixture: 'deck', sizes: ['phone'], monkeys: [{ name: 'roam', steps: 260, seed: 7, dayEvery: 90 }] },
  { name: 'roam-b', fixture: 'deck', sizes: ['tablet'], monkeys: [{ name: 'roam', steps: 260, seed: 8, dayEvery: 90 }] },
];

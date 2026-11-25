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
const tabs = ['home', 'rev', 'drill', 'gram', 'brain', 'lib', 'set', 'catch', 'my'];
const drills = ['rec', 'tone', 'dict', 'sent', 'speak', 'wp', 'read', 'listen', 'sdict', 'mtest', 'tcoach', 'story', 'usage'];
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
const saved = `const saved = () => new Promise(r => __realSetTimeout(r, 0));`;
const nextMorning = `{ const d = new Date(__now() + ${DAY}); d.setHours(9, 12 + d.getDate(), 0, 0); __setNow(d.getTime()); }`;
const knowLessons = (a, z) => `for (let l = ${a}; l <= ${z}; l++) (LESSON_WORDS[l] || []).forEach(w => markKnown(w.id));`;

/* monkeys that each stay in one area */
const areaMonkeys = n => [
  { name: 'home', start: `go('home')`, scope: '#vHome' + SHEETS, steps: n },
  { name: 'review', start: `go('rev')`, scope: '#vRev' + SHEETS, steps: 2 * n },
  { name: 'grammar', start: `go('gram')`, scope: '#vGram' + SHEETS, steps: n },
  { name: 'brain', start: `go('brain')`, scope: '#vBrain' + SHEETS, steps: n },
  { name: 'library', start: `go('lib')`, scope: '#vLib' + SHEETS, steps: n },
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
    { name: 'catch-up-tab', js: `go('catch')` }, { name: 'settings', js: `go('set')`, noShot: true }, { name: 'open-again', reload: true }] },
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

  /* The dictionary (v65): a character's entry from a Library row, a word opened from inside it and back, an entry over a review
     card (keys must not reach the card under the sheet: the grade count stays where it was), the Library's search in the
     dictionary, and a word from outside the course added to My words. */
  { name: 'dictionary', fixture: 'deck', local: unlinked, steps: [
    { name: 'library-lesson', js: `go('lib'); libBook = 1; openLessons[3] = true; renderLib()`, noShot: true },
    { name: 'character', js: `document.querySelector('#libResults .wrow .tr .dcc').click()` },
    { name: 'a-word-from-it', js: `document.querySelector('#dcSheet .dc-w').click()` },
    { name: 'back', js: `dcBack(); return dcTop() + ' ' + DCV.stack.length`, noShot: true },
    { name: 'close', js: `dcClose(); return dcIsOpen()`, noShot: true },
    { name: 'over-a-card', js: `go('rev'); reveal(); document.querySelector('#vRev .bigzh .dcc').click()` },
    { name: 'keys-stay-out', js: `const n = SES.n, c = cur; for (const k of ['3', ' ', 'r', 'u']) (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : '', bubbles: true, cancelable: true })); return [SES.n === n, cur === c, view, dcIsOpen()].join(' ')`, noShot: true },
    { name: 'escape-closes', js: `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return dcIsOpen()`, noShot: true },
    { name: 'search', js: `go('lib'); libQueue('eat'); __tick(200)`, noShot: true },
    { name: 'search-results', js: `renderLibResults(); return DCV.found.map(x => x.t).join(' ')` },
    { name: 'outside-the-course', js: `dcOpen(DCV.found[1].t)` },
    { name: 'add-to-my-words', js: `const n = Object.keys(myDeck().w).length; dcAdd(); return Object.keys(myDeck().w).length - n`, noShot: true },
    { name: 'brain-tile', js: `dcClose(); go('brain'); document.querySelector('#vBrain .wall .tile').click(); return dcTop()` },
    { name: 'night', js: `toggleTheme()` }] },

  /* A tap before start-up has run. The page's buttons work as soon as their script has loaded, so with js/boot.js
     arriving late (or never) a tap must not store or send an empty deck in place of the saved one. Found by the
     independent review: at one point on the `next` branch this replaced a 2,288-card deck with an empty one. */
  { name: 'tap-before-start', fixture: 'deck', local: unlinked, sizes: ['phone'], query: '?slow=js/boot.js&ms=900',
    early: { when: GAP, js: `toggleTheme(); document.getElementById('setBtn').click()` }, steps: opened },
  { name: 'tap-before-start-linked', fixture: 'deck', sizes: ['phone'], query: '?slow=js/boot.js&ms=900', local: { zika_sync_code: CODE, zika_sync_meta: JSON.stringify({ at: T0 - 2 * DAY, dirty: false, remoteDev: 'Web' }) }, cloud: { code: CODE, remote: 'deck', remoteAt: T0 - 2 * DAY },
    early: { when: GAP, js: `toggleTheme()` }, steps: opened },

  /* The start-up file never arrives: the page says so, covers everything, and the deck is as it was. */
  { name: 'start-file-lost', fixture: 'deck', local: unlinked, sizes: ['phone'], query: '?drop=js/boot.js', steps: [
    { name: 'try-the-tabs', js: `const hit = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest('#loadFail') ? 'covered' : (e ? e.tagName + '#' + e.id : 'nothing'); }; return [hit(120, 820), hit(195, 400), hit(350, 30), hit(40, 30)]` },
    { name: 'a-grade-anyway', js: `try { go('rev'); reveal(); grade(3); } catch (e) {} __tick(3000)`, noShot: true }] },
  /* Any other file never arrives, or arrives cut short. Start-up itself is there, so without a refusal it would run
     with a piece missing and the keyboard would drive what is left: the checker graded a card under the message
     this way (v63, first pass), then reached the buttons under it with Tab, found the stylesheet's loss unreported
     and a cut-off file unnoticed (second pass). In every case: the message, the app not started, the deck closed,
     focus held on "Try again", nothing in storage changed, and a grade called directly not stored. */
  ...[['other-file-lost', '?drop=js/home.js'], ['stylesheet-lost', '?drop=css/app.css'], ['file-cut-in-half', '?cut=js/review.js&keep=half'], ['file-cut-between-lines', '?cut=js/home.js&keep=1'], ['data-cut-in-half', '?cut=data/grammar.js&keep=half'],
    ['stylesheet-cut-in-half', '?cut=css/app.css&keep=half'], ['stylesheet-cut-to-nothing', '?cut=css/app.css&keep=none'], ['qr-library-cut-at-its-line', '?cut=assets/qrcode.min.js&keep=1']].map(([name, query]) =>
  ({ name, fixture: 'deck', local: unlinked, sizes: ['phone'], query, steps: [
    { name: 'keys-under-the-cover', js: `window.__before = JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]));
        const press = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true }));
        for (const k of ['r', ' ', '3', '2', 'Enter', 'Tab']) press(document.body, k);
        /* focus cannot be put on anything under the message, and Enter there does nothing */
        const under = ['#tabRev', '#themeBtn', '#setBtn', 'button', 'input', 'a[href]'].map(q => document.querySelector('.wrap ' + q) || document.querySelector(q)).filter(e => e && !e.closest('#loadFail'));
        let reached = 0; for (const e of under) { try { e.focus(); } catch (x) {} if (document.activeElement === e) reached++; press(document.activeElement, 'Enter'); }
        __tick(3000);
        return { cover: !!document.getElementById('loadFail'), says: (document.getElementById('loadFail') || {}).textContent, started: !!window.zikaStarted, deckOpen: typeof DECK_READY === 'undefined' ? 'no deck code' : DECK_READY,
          focus: document.activeElement && document.activeElement.textContent, tried: under.length, reached, shut: [...document.body.children].every(e => e.id === 'loadFail' || e.inert === true),
          view: typeof view === 'undefined' ? null : view, storage: JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])) === window.__before ? 'as it was' : 'CHANGED' }` },
    { name: 'a-grade-anyway', js: `try { toggleTheme(); } catch (e) {} try { go('rev'); reveal(); grade(3); } catch (e) {} __tick(3000); return localStorage.getItem('shida_b1_fsrs_v2') === new Map(JSON.parse(window.__before)).get('shida_b1_fsrs_v2') ? 'the deck is as it was' : 'THE DECK CHANGED'`, noShot: true }] })),
  /* A script that is not the app's (one an extension or a blocker put on the page) fails before start-up has
     finished: the app starts all the same. v63 took it for a file of its own and shut the app (third pass). Start-up
     is held back so that the failure always comes first. */
  { name: 'foreign-script-lost', fixture: 'deck', local: unlinked, sizes: ['phone'], query: '?slow=js/boot.js&ms=900',
    early: { when: `document.head`, js: `const s = document.createElement('script'); s.async = true; s.src = 'http://127.0.0.1:9/not-the-apps.js'; s.onerror = () => { window.__foreign = window.zikaStarted ? 'failed after start-up' : 'failed before start-up'; }; document.head.appendChild(s)` },
    steps: [{ name: 'started-all-the-same', js: `return { foreign: window.__foreign || 'no failure seen', cover: !!document.getElementById('loadFail'), started: !!window.zikaStarted, deckOpen: typeof DECK_READY === 'undefined' ? 'no deck code' : DECK_READY }` }] },

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

  /* ---- v67, "ready the app" ---- */
  /* My words and topics made on this device carry the device in their id (uz9q79vcb-3, tz9q79vcb-14); the ones a deck
     already holds keep theirs (u1, t13). Both kinds are listed, filtered, studied, edited, deleted and brought back,
     survive a reload, go to the room whole, and arrive from another device with that device's ids. */
  { name: 'my-words-ids', fixture: 'deck', cloud: { code: CODE },
    local: { ...linkedIdle, shida_b1_fsrs_v2: altered([], S => { S.my.w.u1 = { t: '夜市', p: 'yèshì', m: 'night market', at: T0 - 9 * DAY, g: ['t1', 't13'] };
      S.my.c['u1:rec'] = { st: 'rev', S: 4, D: 5, due: T0 - DAY, last: T0 - 5 * DAY, reps: 3, lapses: 0, days: 2 }; }) }, steps: [
    { name: 'list', js: `go('my'); return [Object.keys(myDeck().w), myDeck().n, myDeck().tn, DEVICE.id]`, noShot: true },
    { name: 'add-a-word', js: `myOpenAdd(); const put = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
        put('myT', '珍珠奶茶'); put('myP', 'zhēnzhū nǎichá'); put('myM', 'bubble tea'); mySaveOne(); shClose(); renderMy(); return [Object.keys(myDeck().w), myDeck().n]` },
    { name: 'add-a-topic', js: `myTopicsSheet(); document.getElementById('myNewT').value = 'Night out'; myTopicNew(); shClose(); renderMy(); return [myDeck().tp.slice(-2).map(t => t.id + ' ' + t.n), myDeck().tn]`, noShot: true },
    { name: 'sort-into-it', js: `const id = Object.keys(myDeck().w).find(k => k !== 'u1'), tp = myDeck().tp[myDeck().tp.length - 1].id; window.__w = id; window.__t = tp;
        myOpenAdd(id); [...document.querySelectorAll('#myChips button')].find(b => b.textContent === 'Night out').click(); mySaveOne();
        myOpenAdd('u1'); [...document.querySelectorAll('#myChips button')].find(b => b.textContent === 'Night out').click(); mySaveOne();
        return [myDeck().w[id].g, myDeck().w.u1.g]`, noShot: true },
    { name: 'filter-by-it', js: `[...document.querySelectorAll('#vMy .my-chips.bar button')].find(b => b.textContent.startsWith('Night out')).click(); return [MY.tp, document.querySelectorAll('#myList .my-row').length]` },
    { name: 'study-both', js: `document.querySelector('#vMy .btn.big').click(); const seen = []; for (let i = 0; i < 6 && MY.cur; i++) { seen.push(MY.cur); myReveal(); myGrade(i ? 3 : 1); __tick(90000); } return [seen, Object.keys(myDeck().c).sort()]` },
    { name: 'back-to-the-list', js: `myStop(); mySetTopic(''); document.querySelector('#myList .my-row .spk').click(); document.querySelector('#myList .my-row .info').click(); const open = dcTop(); dcClose(); return open`, noShot: true },
    { name: 'open-again', reload: true },
    { name: 'after-reload', js: `go('my'); const d = myDeck(); return [Object.keys(d.w), Object.keys(d.c).sort(), d.n, d.tn, d.tp.slice(-2).map(t => t.id), document.querySelectorAll('#myList .my-row').length]`, noShot: true },
    { name: 'delete-and-undo', js: `const before = JSON.stringify(myDeck()); myDelete(window.__w || Object.keys(myDeck().w).find(k => k !== 'u1')); const gone = Object.keys(myDeck().w); document.querySelector('#toastHost .tact').click(); return [gone, Object.keys(myDeck().w), JSON.stringify(myDeck()) === before ? 'the deck is as it was' : 'THE DECK DIFFERS']`, noShot: true },
    { name: 'delete-the-topic-and-undo', js: `const id = myDeck().tp[myDeck().tp.length - 1].id, before = JSON.stringify(myDeck()); myTopicDelete(id); const left = myDeck().tp.length; document.querySelector('#toastHost .tact').click(); return [id, left, myDeck().tp.length, JSON.stringify(myDeck()) === before ? 'the deck is as it was' : 'THE DECK DIFFERS']`, noShot: true },
    { name: 'the-room-holds-it', js: `__tick(5000); await new Promise(r => __realSetTimeout(r, 60)); const o = JSON.parse(__cloud.read('rooms/' + SYNC.code + '/study_state').json); return [Object.keys(o.my.w), SYNC.dirty]`, noShot: true },
    { name: 'another-device-adds', js: `__tick(60000);` + otherSaves(`o.my.w['uother9-7'] = { t: '悠遊卡', p: 'yōuyóukǎ', m: 'EasyCard', at: Date.now(), g: ['tother9-15'] }; o.my.tp.push({ id: 'tother9-15', n: 'Transit' }); o.my.n = 8; o.my.tn = 16`), noShot: true },
    { name: 'its-word-is-here', js: `go('my'); return [Object.keys(myDeck().w), myDeck().n, myDeck().tn, SYNC.remoteDev]` },
    { name: 'and-one-more-here', js: `const r = myAdd('滷肉飯', 'lǔròufàn', 'braised pork rice', ['tother9-15']); save(); renderMy(); const d = myDeck(), tn = d.tn; delete d.tn; myDeck(); return [r.id, d.n, 'the topic counter, rebuilt from the ids: ' + d.tn + ' (was ' + tn + ')']`, noShot: true },
    { name: 'next-day', js: `__tick(${DAY}); go('my'); myStart(); const seen = []; for (let i = 0; i < 8 && MY.cur; i++) { seen.push(MY.cur); myReveal(); myGrade(3); __tick(30000); } myStop(); return seen`, noShot: true },
  ] },
  /* The browser refuses to store the deck (its storage is full). The page says so in a banner that stays, studying goes
     on in memory and still reaches the room, and the banner goes when a save gets through again. The two refusals the
     app makes on purpose (before start-up; an empty deck over a full one) are not this and say nothing. */
  { name: 'storage-full', fixture: 'deck', local: linkedIdle, cloud: { code: CODE }, steps: [   /* `saved()`: a save is written at the end of the tick that asked for it */
    { name: 'a-grade-is-stored', js: `${saved} go('rev'); reveal(); grade(3); await saved(); __tick(2000); return [!!document.getElementById('saveBanner'), DECK_UNSTORED]`, noShot: true },
    { name: 'refusals-on-purpose-say-nothing', js: `const keep = S.cards; S.cards = {}; const empty = deckStore(), held = DECK_HELD; S.cards = keep; const back = deckStore();
        DECK_READY = false; const early = deckStore(); DECK_READY = true;
        return { emptyOverFull: empty, held, storedAgain: back, beforeStartUp: early, banner: !!document.getElementById('saveBanner'), unstored: DECK_UNSTORED }`, noShot: true },
    { name: 'storage-fills', js: `${saved} window.__realSet = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'shida_b1_fsrs_v2') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return window.__realSet.apply(this, arguments); };
        reveal(); grade(3); await saved(); __tick(2000); const b = document.getElementById('saveBanner'); return [b && getComputedStyle(b).display, b && b.textContent, DECK_UNSTORED > 0]` },
    { name: 'still-full', js: `${saved} const since = DECK_UNSTORED; reveal(); grade(1); await saved(); __tick(60000); reveal(); grade(3); await saved(); __tick(2000); go('home'); const b = document.getElementById('saveBanner'); return [getComputedStyle(b).display, DECK_UNSTORED === since ? 'since the first refusal' : 'THE TIME MOVED', document.querySelectorAll('#saveBanner').length]` },
    { name: 'the-room-still-gets-it', js: `__tick(5000); await new Promise(r => __realSetTimeout(r, 60)); const o = JSON.parse(__cloud.read('rooms/' + SYNC.code + '/study_state').json), d = dkey(new Date()); return [JSON.stringify(o.log[d]) === JSON.stringify(S.log[d]) ? 'the room has today as it is in memory' : 'THE ROOM IS BEHIND', JSON.stringify(JSON.parse(localStorage.getItem('shida_b1_fsrs_v2')).log[d]) === JSON.stringify(S.log[d]) ? 'THE DEVICE HAS IT TOO?' : 'the device does not']`, noShot: true },
    { name: 'settings-while-full', js: `go('set')`, noShot: true },
    { name: 'room-again', js: `${saved} Storage.prototype.setItem = window.__realSet; go('rev'); reveal(); grade(3); await saved(); __tick(2000); const b = document.getElementById('saveBanner'); return [getComputedStyle(b).display, DECK_UNSTORED]` },
    { name: 'open-again', reload: true }] },
  /* Today's entry in the time-lapse is found by its date. Another device's later day is already in the list: today goes
     in before it, is not added twice on the next open, and a change of stage is written to today and not to the last entry. */
  { name: 'history-out-of-order', fixture: 'deck', sizes: ['phone'], noShots: true, local: { ...unlinked, shida_b1_fsrs_v2: altered([], S => { S.hist.d.push('2026-11-21'); S.hist.s.push(S.hist.s[S.hist.s.length - 1]); }) }, steps: [
    { name: 'opened', js: `return [S.hist.d.slice(-4), S.hist.s.length === S.hist.d.length]` },
    { name: 'a-word-moves-on', js: `const last = S.hist.s[S.hist.s.length - 1], i = S.hist.d.indexOf(dkey(new Date())), was = S.hist.s[i]; const w = WORDS.find(x => wordStage(x.id) === 0); markMastered(w.id); go('brain');
        return [S.hist.d.slice(-4), S.hist.s[i] !== was ? 'today was rewritten' : 'TODAY WAS NOT', S.hist.s[S.hist.s.length - 1] === last ? 'the later day was left alone' : 'THE LATER DAY WAS OVERWRITTEN']` },
    { name: 'open-again', reload: true },
    { name: 'no-second-today', js: `go('brain'); const t = dkey(new Date()); return [S.hist.d.slice(-4), S.hist.d.filter(d => d === t).length]` },
    { name: 'the-next-day-too', js: `__tick(${DAY}); go('home'); go('brain'); const t = dkey(new Date()); return [S.hist.d.slice(-4), S.hist.d.filter(d => d === t).length, JSON.stringify(S.hist.d) === JSON.stringify(S.hist.d.slice().sort()) ? 'in order' : 'OUT OF ORDER']` }] },
  /* One marker for the tone coach (TC_V): results from an older analysis start again, the present ones and any from a
     newer analysis than this app knows are left as they are. */
  { name: 'tone-marker', fixture: 'deck', sizes: ['phone'], noShots: true, local: unlinked, steps: [
    { name: 'as-saved', js: `const a = JSON.stringify([S.tone, S.vp]); tcState(); return [TC_V, JSON.stringify([S.tone, S.vp]) === a ? 'left as it was' : 'CHANGED', S.tone.v, S.vp.v]` },
    { name: 'older-starts-again', js: `S.tone = { v: 1, n: 9, by: { 1: [3, 4] }, conf: {}, pair: {}, w: {} }; S.vp = { n: 900, sum: 12000, sq: 170000 }; tcState(); return [S.tone, S.vp]` },
    { name: 'newer-is-kept', js: `S.tone = { v: 3, n: 9, by: { 1: [3, 4] }, conf: {}, pair: {}, w: {}, later: 1 }; S.vp = { v: 3, n: 900, sum: 12000, sq: 170000 }; tcState(); return [S.tone, S.vp]` },
    { name: 'the-coach-opens-on-it', js: `go('drill'); startDrill('tcoach'); return [S.tone.v, S.vp.n, TC.state]` }] },
  /* A manual export is named with its day and its device; what is in it has not changed. The automatic backup keeps its one name. */
  { name: 'export-name', fixture: 'deck', sizes: ['phone'], noShots: true, local: unlinked, steps: [
    { name: 'export', js: `const got = []; const realClick = HTMLAnchorElement.prototype.click, realUrl = URL.createObjectURL; let blob = null;
        HTMLAnchorElement.prototype.click = function () { got.push(this.download); }; URL.createObjectURL = b => { blob = b; return 'blob:harness'; };
        exportData(); const same = (await blob.text()) === JSON.stringify(S, null, 1);
        DEVICE.name = 'iPhone'; exportData(); DEVICE.name = 'Thorne’s iPad (old) / 2'; exportData(); DEVICE.name = '我的手機'; exportData(); DEVICE.name = '///'; exportData(); DEVICE.name = '';
        HTMLAnchorElement.prototype.click = realClick; URL.createObjectURL = realUrl;
        return [got, same ? 'the file is the deck, as before' : 'THE FILE DIFFERS', (bkPanel().match(/zika-progress[^<"]*/g) || []).join(' | ') || 'no file chosen']` }] },
  /* "Sounds wrong": beside the speaker on a card's answer side and in the dictionary entry, never on a question side. A
     mark is kept on the device and not in the deck; the same button takes it off. Marking moves no grade button, and the
     keys 1–4 still grade. Settings → Audio counts, copies and clears. */
  { name: 'sounds-wrong', fixture: 'deck', local: unlinked, steps: [
    { name: 'question-side', js: `go('rev'); return ['buttons on the question side: ' + document.querySelectorAll('#vRev .awb').length, modeOf(cur)]`, noShot: true },
    { name: 'answer-side', js: `reveal(); const b = document.querySelector('#vRev .awb'); return [b.textContent, b.getAttribute('aria-pressed'), b.dataset.t, b.dataset.p]` },
    { name: 'marked', js: `const g = () => JSON.stringify([...document.querySelectorAll('#vRev .grades button, #vRev .stage, #vRev .spk')].map(x => { const r = x.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })); const before = g(), deck = JSON.stringify(S);
        document.querySelector('#vRev .awb').click();
        return [before === g() ? 'nothing moved' : 'SOMETHING MOVED', document.querySelector('#vRev .awb').getAttribute('aria-pressed'), localStorage.getItem('zika_sounds_wrong_v1'), JSON.stringify(S) === deck ? 'the deck is untouched' : 'THE DECK CHANGED']` },
    { name: 'key-3-still-grades', js: `const n = SES.n, c = cur; const b = document.querySelector('#vRev .awb'); b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true })); return [SES.n - n, cur !== c, awList().length]`, noShot: true },
    { name: 'mark-and-take-off', js: `if (!revealed) reveal(); const b = () => document.querySelector('#vRev .awb'); b().click(); const on = [b().getAttribute('aria-pressed'), awList().length]; b().click(); return [on, b().getAttribute('aria-pressed'), awList().length]`, noShot: true },
    { name: 'keys-1-2-4', js: `const out = []; for (const k of ['1', '2', '4']) { if (!revealed) reveal(); const n = SES.n; document.querySelector('#vRev .awb').click(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); out.push(k + ':' + (SES.n - n)); __tick(20000); } return [out, awList().map(x => x.t + ' ' + x.v)]`, noShot: true },
    { name: 'a-write-card', js: `go('home'); REV_FILTER = c => modeOf(c) === 'prod'; go('rev'); const q = document.querySelectorAll('#vRev .awb').length; reveal(); return [modeOf(cur), 'on the question side: ' + q, 'on the answer side: ' + document.querySelectorAll('#vRev .awb').length]` },
    { name: 'a-grammar-card', js: `go('home'); REV_FILTER = isGram; go('rev'); const had = !!cur; if (cur) reveal(); return [had, document.querySelectorAll('#vRev .awb').length]`, noShot: true },
    { name: 'dictionary', js: `go('lib'); libBook = 1; openLessons[3] = true; renderLib(); document.querySelector('#libResults .wrow .tr .dcc').click(); const b = document.querySelector('#dcSheet .awb'); const was = b.getAttribute('aria-pressed'); b.click(); return [dcTop(), was, document.querySelector('#dcSheet .awb').getAttribute('aria-pressed'), awList().length]` },
    { name: 'a-word-in-it', js: `document.querySelector('#dcSheet .dc-w').click(); const b = document.querySelector('#dcSheet .awb'); b.click(); return [dcTop(), b.dataset.p, awList().length]`, noShot: true },
    { name: 'settings-row', js: `dcClose(); go('set'); const r = document.getElementById('awRow'); r.scrollIntoView({ block: 'center' }); return [r.querySelector('b').textContent, [...r.querySelectorAll('button')].map(b => b.textContent + (b.disabled ? ' (off)' : ''))]` },
    { name: 'copy', js: `let got = null; navigator.clipboard.writeText = t => { got = t; return Promise.resolve(); }; document.querySelector('#awRow button').click(); await new Promise(r => __realSetTimeout(r, 30)); return [got, document.querySelector('#toastHost').textContent]`, noShot: true },
    { name: 'copy-where-the-browser-will-not', js: `navigator.clipboard.writeText = () => Promise.reject(new Error('not allowed')); awCopy(); await new Promise(r => __realSetTimeout(r, 30)); const box = document.getElementById('awBox'); return [!!box, box && box.value.split('\\n').length]` },
    { name: 'clear', js: `shClose(); document.querySelectorAll('#awRow button')[1].click(); return [awList().length, localStorage.getItem('zika_sounds_wrong_v1'), document.getElementById('awRow').querySelector('b').textContent]`, noShot: true },
    { name: 'undo-clear', js: `document.querySelector('#toastHost .tact').click(); return [awList().length, document.getElementById('awRow').querySelector('b').textContent]`, noShot: true },
    { name: 'open-again', reload: true },
    { name: 'still-there', js: `go('set'); const n = document.getElementById('awRow').querySelector('b').textContent; go('rev'); reveal(); return [n, Object.keys(S).includes('aw'), JSON.stringify(S).includes('zika_sounds_wrong')]`, noShot: true },
    { name: 'night', js: `toggleTheme(); go('rev'); reveal(); document.querySelector('#vRev .awb').click()` },
    { name: 'night-settings', js: `go('set'); document.getElementById('awRow').scrollIntoView({ block: 'center' })` }] },

  /* the whole app under random use, with days passing */
  { name: 'roam-a', fixture: 'deck', sizes: ['phone'], monkeys: [{ name: 'roam', steps: 260, seed: 7, dayEvery: 90 }] },
  { name: 'roam-b', fixture: 'deck', sizes: ['tablet'], monkeys: [{ name: 'roam', steps: 260, seed: 8, dayEvery: 90 }] },
];

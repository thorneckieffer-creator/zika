#!/usr/bin/env node
/* The start-up checks in WebKit (the engine of Safari on the iPhone and iPad), which the harness and the checker,
   both Chrome, never see.

     node tools/webkit.mjs --playwright <a folder where `npm i playwright && npx playwright install webkit` was run>

   Playwright is not a dependency of this repository: install it in a scratch folder and name that folder.
   - normal starts, at iPhone and iPad sizes, many times, and with the stylesheet or a script arriving late:
     the app must start and must NOT say a file is missing (a false alarm here would shut the app on every device);
   - a card is graded and stored;
   - each way a file can fail to arrive whole: the message, the app not started, nothing stored, nothing reachable;
   - a script that is not the app's failing early: the app starts;
   - the service worker installs and serves the next open.
   Written for v64 (16 November 2026); the release number is read from js/core.js. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/browser.mjs';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const pw = process.argv.includes('--playwright') ? resolve(process.argv[process.argv.indexOf('--playwright') + 1]) : null;
if (!pw) { console.error('usage: node tools/webkit.mjs --playwright <a folder where playwright is installed>'); process.exit(2); }
const { webkit } = createRequire(join(pw, 'package.json'))('playwright');
const V = +/const APP_VERSION=(\d+);/.exec(readFileSync(join(app, 'js/core.js'), 'utf8'))[1];
const fx = JSON.parse(readFileSync(join(app, 'tools/snap/fixtures/deck.json'), 'utf8'));
const srv = await serve(app);
const origin = `http://127.0.0.1:${srv.port}`;
const results = []; const ok = (name, pass, detail = '') => { results.push(pass); console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await webkit.launch();
console.log(`WebKit ${browser.version()}`);
const SIZES = { iPhone: { width: 390, height: 844 }, 'iPad on its side': { width: 1180, height: 820 } };

async function fresh(size, { foreign = false } = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[size], hasTouch: true, isMobile: size === 'iPhone', serviceWorkers: 'block' });
  /* nothing leaves this machine: the app's own files only */
  await ctx.route(u => !String(u).startsWith(origin), r => r.abort('internetdisconnected'));
  await ctx.addInitScript(([deck, foreign]) => {
    if (!localStorage.getItem('__seeded')) { for (const k in deck) localStorage.setItem(k, deck[k]); localStorage.setItem('zika_sync_meta', JSON.stringify({ at: 0, dirty: false, remoteDev: '' })); localStorage.setItem('__seeded', '1'); }
    if (foreign) { const add = () => { if (!document.head) return setTimeout(add, 5); const s = document.createElement('script'); s.async = true; s.src = 'http://127.0.0.1:9/not-the-apps.js'; s.onerror = () => { window.__foreign = window.zikaStarted ? 'after' : 'before'; }; document.head.appendChild(s); }; add(); }
  }, [fx, foreign]);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
  return { ctx, page, errors };
}
const look = page => page.evaluate(() => ({
  started: !!window.zikaStarted, failed: !!window.zikaFailed, cover: document.getElementById('loadFail') ? document.getElementById('loadFail').textContent : '',
  version: typeof APP_VERSION === 'undefined' ? null : APP_VERSION, deckOpen: typeof DECK_READY === 'undefined' ? null : DECK_READY,
  css: getComputedStyle(document.documentElement).getPropertyValue('--zika-css-whole').trim(), qr: typeof qrcode,
  cards: typeof S === 'undefined' ? null : Object.keys(S.cards).length, home: !!document.querySelector('#vHome .card'),
  focus: document.activeElement ? document.activeElement.textContent.slice(0, 20) : '', shut: [...document.body.children].every(e => e.id === 'loadFail' || e.inert === true),
  foreign: window.__foreign || '' }));
const store = page => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])));

console.log('1. normal starts');
for (const size of Object.keys(SIZES)) {
  const { ctx, page, errors } = await fresh(size);
  let bad = 0, last = null;
  for (let i = 0; i < 15; i++) { await page.goto(`${origin}/index.html?t=${i}`, { waitUntil: 'load' }); last = await look(page); if (!last.started || last.cover || last.css !== '1' || last.qr !== 'function') bad++; }
  ok(`${size}: 15 loads in a row start, no message`, bad === 0 && last.version === V && last.cards > 2000 && last.home, `v${last.version}, ${last.cards} cards, last rule read as "${last.css}"${errors.length ? ', errors: ' + errors.join(' | ') : ''}`);
  /* the files late, one at a time: a start-up check that ran before the stylesheet was in would give a false alarm here */
  for (const [what, q] of [['the stylesheet 1.5 s late', '?slow=css/app.css&ms=1500'], ['the last script 1.5 s late', '?slow=js/boot.js&ms=1500'], ['the QR library 1.5 s late', '?slow=assets/qrcode.min.js&ms=1500'], ['a data file 1.5 s late', '?slow=data/usage.js&ms=1500']]) {
    await page.goto(`${origin}/index.html${q}`, { waitUntil: 'load' }); const st = await look(page);
    ok(`${size}: ${what} — starts, no message`, st.started && !st.cover && st.css === '1', st.cover || `v${st.version}`);
  }
  /* a card, by the real screen */
  await page.goto(`${origin}/index.html?t=g`, { waitUntil: 'load' });
  const graded = await page.evaluate(async () => { go('rev'); if (!cur) return 'no card due'; const id = cur.id || JSON.stringify(cur).slice(0, 40); const before = localStorage.getItem('shida_b1_fsrs_v2'); reveal(); grade(3); await new Promise(r => setTimeout(r, 1500)); return localStorage.getItem('shida_b1_fsrs_v2') !== before ? 'stored' : 'NOT stored'; });
  ok(`${size}: a card is revealed, graded and stored`, graded === 'stored', graded);
  await ctx.close();
}

console.log('2. a file that does not arrive whole');
const BROKEN = [['a script missing', '?drop=js/home.js', 'did not arrive (js/home.js)'], ['the stylesheet missing', '?drop=css/app.css', 'did not arrive (css/app.css)'],
  ['the stylesheet cut in half', '?cut=css/app.css&keep=half', 'did not arrive whole (css/app.css)'], ['the stylesheet empty', '?cut=css/app.css&keep=none', 'did not arrive whole (css/app.css)'],
  ['the QR library cut at its line break', '?cut=assets/qrcode.min.js&keep=1', 'did not arrive whole (assets/qrcode.min.js)'], ['a script without its last line', '?cut=js/home.js&keep=1', 'did not arrive whole (js/home.js)'],
  ['a script cut in half', '?cut=js/review.js&keep=half', 'did not arrive whole (js/review.js)'], ['a data file cut in half', '?cut=data/grammar.js&keep=half', 'did not arrive whole (data/grammar.js)'],
  ['the last script missing', '?drop=js/boot.js', 'did not arrive (js/boot.js)']];
for (const [what, q, says] of BROKEN) {
  const { ctx, page } = await fresh('iPhone');
  await page.goto(`${origin}/index.html?t=seed`, { waitUntil: 'load' });   /* a normal start first, so the deck is as a device holds it */
  const before = await store(page);
  await page.goto(`${origin}/index.html${q}`, { waitUntil: 'load' }); await page.waitForTimeout(300);
  for (const k of ['Tab', 'Tab', 'r', '3', '1', 'Shift+Tab', 't']) await page.keyboard.press(k);   /* not Space or Enter: on "Try again" they reload, as they should */
  await page.touchscreen.tap(195, 800); await page.touchscreen.tap(60, 30);
  await page.evaluate(() => { try { go('rev'); reveal(); grade(3); } catch (e) { } });
  await page.waitForTimeout(400);
  const st = await look(page), after = await store(page);
  ok(`${what}: message, not started, deck closed, nothing stored, nothing reachable`, st.cover.includes(says) && !st.started && st.deckOpen !== true && after === before && st.shut && /Try again/.test(st.focus),
    `${st.cover ? '"' + st.cover.replace('字卡 could not start. ', '').replace(' Your progress on this device is safe. Try again', '') + '"' : 'NO MESSAGE'}${st.started ? ', STARTED' : ''}${after === before ? '' : ', STORAGE CHANGED'}${st.shut ? '' : ', page not shut'} · focus on "${st.focus}"`);
  await ctx.close();
}

console.log('3. a script that is not the app\'s fails before start-up');
{ const { ctx, page } = await fresh('iPhone', { foreign: true });
  await page.goto(`${origin}/index.html?slow=js/boot.js&ms=900`, { waitUntil: 'load' }); await page.waitForTimeout(300);
  const st = await look(page);
  ok('the app starts all the same', st.started && !st.cover && st.foreign === 'before', `foreign script failed ${st.foreign || '— not seen'} start-up${st.cover ? ', MESSAGE: ' + st.cover : ''}`);
  await ctx.close(); }

console.log('4. the service worker in WebKit');
try {
  const ctx = await browser.newContext({ viewport: SIZES.iPhone, serviceWorkers: 'allow' });
  await ctx.route(u => !String(u).startsWith(origin), r => r.abort('internetdisconnected'));
  const page = await ctx.newPage();
  await page.goto(`${origin}/index.html?sw`, { waitUntil: 'load' });
  const has = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!has) console.log('  · this WebKit build has no service worker: not tested');
  else {
    let st = null; for (let i = 0; i < 60; i++) { st = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, caches: (await caches.keys()).join(' '), started: !!window.zikaStarted, cover: !!document.getElementById('loadFail') })).catch(() => null); if (st && st.controlled && new RegExp('zika-shell-v' + V + '-').test(st.caches)) break; await page.waitForTimeout(500); }
    ok('the worker installs, stores the release and takes control', !!st && st.controlled && new RegExp('zika-shell-v' + V + '-').test(st.caches), st ? st.caches : 'no answer');
    await page.goto(`${origin}/index.html?sw`, { waitUntil: 'load' }); await page.waitForTimeout(500);
    const again = await look(page);
    const from = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => /\/(js|css|data)\//.test(r.name)).length);
    ok('the next open, served by the worker, starts with no message', again.started && !again.cover && again.css === '1' && again.version === V, `v${again.version}, ${from} scripts and styles loaded${again.cover ? ', MESSAGE: ' + again.cover : ''}`);
  }
  await ctx.close();
} catch (e) { console.log('  · could not run: ' + String(e.message).split('\n')[0]); }

await browser.close(); await srv.close();
const failed = results.filter(r => !r).length;
console.log(failed ? `\nFAILED — ${failed} of ${results.length}` : `\nOK — ${results.length} checks`);
process.exit(failed ? 1 : 0);

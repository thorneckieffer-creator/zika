#!/usr/bin/env node
/* A device whose worker is still v62's (the worker of a later release never finished installing) is given this
   release.

     node tools/oldworker.mjs <a v62 folder> <a v63 folder>      (git archive d3296a9 | tar -x -C <folder>; 70c922e for v63)

   The v62 worker fetches the page from the network and keeps every other file under the address it first saw it
   at. So after one open of v63 it holds v63's scripts and stylesheet; if that open was cut short it holds some of
   them. Then this release is published.
   - with the release number on the addresses (as tools/stamp.mjs writes them): the page must be this release, whole;
   - control, the same release with the numbers taken off: shows the fault the numbers prevent (in v64 it was
     "could not start (css/app.css)": this release's js/boot.js with v63's stylesheet);
   Last, this release's worker is allowed in and must end with one whole store and no v62 cache.
   Written for v64 (16 November 2026); the numbers 62, 63 and 64 are written into the checks, so raise the last
   one with the release. Nothing here touches the real site or a real deck. */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const now = join(dirname(fileURLToPath(import.meta.url)), '..');
const [v62, v63] = process.argv.slice(2).map(p => resolve(p));
if (!v62 || !v63) { console.error('usage: node tools/oldworker.mjs <a v62 folder> <a v63 folder>'); process.exit(2); }
const { serve, chrome } = await import('./lib/browser.mjs');
const dir = mkdtempSync(join(tmpdir(), 'zika-oldworker-'));
const skip = p => /\.pack$|\/dict\.txt$|\/\.git(\/|$)|\/\.claude(\/|$)|\/docs(\/|$)/.test(p);
const oldWorker = readFileSync(join(v62, 'sw.js'), 'utf8');
/* publish a release into the served folder; `worker` false keeps the v62 worker file in place */
const publish = (from, { worker = false, change = null } = {}) => {
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true });
  cpSync(from, dir, { recursive: true, filter: p => !skip(p.slice(from.length)) });
  if (!worker) writeFileSync(join(dir, 'sw.js'), oldWorker);
  if (change) change();
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, pass, detail = '') => { results.push(pass); console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

publish(v62);
let srv = await serve(dir);
const port = srv.port, url = `http://127.0.0.1:${port}/index.html?sw`;
const br = await chrome();
try {
  const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => br.send(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  const js = async (expr, ms = 25000) => { const r = await Promise.race([s('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => { throw new Error('no answer from the page'); })]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const open = async () => { const loaded = new Promise(done => { const stop = br.on(m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { stop(); done(); } }); }); await s('Page.navigate', { url }); await Promise.race([loaded, sleep(15000)]); await sleep(600); };
  const until = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await js(`return ${expr}`, 5000)) return true; } catch (e) { } await sleep(200); } return false; };
  const state = () => js(`const keys = await caches.keys();
    const reg = await navigator.serviceWorker.getRegistration();
    return { version: typeof APP_VERSION === 'undefined' ? null : APP_VERSION, started: !!window.zikaStarted, painted: !!document.querySelector('#vHome .card'),
      cover: document.getElementById('loadFail') ? document.getElementById('loadFail').textContent : '', controlled: !!navigator.serviceWorker.controller, caches: keys.sort().join(' '),
      core: (document.querySelector('script[src^="js/core.js"]') || {}).src || '' }`);
  const show = st => `v${st.version}${st.started ? ', started' : ''}${st.cover ? ', MESSAGE: ' + st.cover : ''} · caches: ${st.caches}`;

  console.log('1. a device on v62');
  await open(); await open();
  ok('v62 runs under its own worker', await until(`navigator.serviceWorker.controller && typeof APP_VERSION !== "undefined" && APP_VERSION === 62`));

  console.log('2. v63 is published; this device opens it once and its new worker never arrives');
  publish(v63);
  await open();
  let st = await state();
  ok('the page is v63, still under the v62 worker', st.version === 63 && st.started && /(^| )zika-v62( |$)/.test(st.caches) && !/zika-shell-/.test(st.caches), show(st));
  const held = await js(`const c = await caches.open('zika-v62'); return (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search).filter(u => /\\/(js|css|data)\\//.test(u))`);
  ok('the v62 worker now holds v63\'s scripts and stylesheet by address', held.length >= 30, `${held.length} files, such as ${held.slice(0, 3).join(' ')}`);
  /* the open was cut short: the last script never reached the cache */
  await js(`const c = await caches.open('zika-v62'); for (const r of await c.keys()) if (/\\/js\\/boot\\.js/.test(r.url)) await c.delete(r); return 1`);

  console.log('3. control — v64 published WITHOUT the release number on its addresses');
  publish(now, { change: () => { const p = join(dir, 'index.html'); writeFileSync(p, readFileSync(p, 'utf8').replace(/\?v=\d+"/g, '"')); } });
  await open();
  st = await state();
  console.log(`  · what the device shows: ${show(st)}`);
  ok('(control) the page is not a whole v64: this is the fault the numbers prevent', !(st.version === 64 && st.started && !st.cover), show(st));

  console.log('4. v64 as released, with the numbers');
  publish(now);
  await open();
  st = await state();
  ok('the page is v64, started, no message — still under the v62 worker', st.version === 64 && st.started && !st.cover && st.painted && !/zika-shell-/.test(st.caches), show(st));
  ok('its scripts were asked for by this release\'s addresses', /\?v=64$/.test(st.core), st.core);
  const whole = await js(`return { css: getComputedStyle(document.documentElement).getPropertyValue('--zika-css-whole').trim(), qr: typeof qrcode, got: Object.keys(window.zikaGot || {}).length }`);
  ok('the stylesheet, the QR library and every script are this release\'s, whole', whole.css === '1' && whole.qr === 'function' && whole.got >= 23, JSON.stringify(whole));

  console.log('5. the v64 worker arrives');
  publish(now, { worker: true });
  await open();
  const arrived = await until(`(await caches.keys()).some(k => k.startsWith('zika-shell-v64-')) && !(await caches.keys()).includes('zika-v62')`, 45000);
  if (!arrived) console.log('  · registration: ' + await js(`const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ installing: r && r.installing && r.installing.state, waiting: r && r.waiting && r.waiting.state, active: r && r.active && r.active.state, caches: await caches.keys() })`));
  ok('the new worker stores the release and removes the v62 cache', arrived);
  ok('the device ends on v64 under the new worker', await until(`navigator.serviceWorker.controller && typeof APP_VERSION !== "undefined" && APP_VERSION === 64 && !!window.zikaStarted`, 40000));
  await open();
  st = await state();
  ok('one whole v64 store, the v62 cache gone, no message', st.version === 64 && st.started && !st.cover && /zika-shell-v64-/.test(st.caches) && !/(^| )zika-v62( |$)/.test(st.caches), show(st));
  await srv.close();
  await open();
  st = await state();
  ok('and it opens offline', st.version === 64 && st.started && !st.cover, show(st));
} finally { await br.close(); try { await srv.close(); } catch (e) { } rmSync(dir, { recursive: true, force: true }); }

const failed = results.filter(r => !r).length;
console.log(failed ? `\nFAILED — ${failed} of ${results.length}` : `\nOK — ${results.length} checks`);
process.exit(failed ? 1 : 0);

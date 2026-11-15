#!/usr/bin/env node
/* The service worker, tested for real: a copy of the app is served from a temporary folder, opened in headless
   Chrome with the worker on, and taken through what a device goes through.

     node tools/swtest.mjs

   1. First visit: the worker installs and holds every shell file.
   2. Offline: with the server stopped, the app still opens.
   3. A release: the version is bumped and one file changed; the app picks it up, runs the new version, keeps
      one shell cache, and downloads only what changed.
   4. A half-published release: the worker names a file whose content on the server is not what it expects;
      the install is refused and the device keeps running the release it has.

   5. With --from <folder holding an earlier release>: a device running that release (and its worker) is given
      this one, and must end up running it, whole, and able to open offline.

   Nothing here touches the real site or a real deck. */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, chrome } from './lib/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'zika-sw-'));
/* the audio packs and the dictionary are not part of what is being tested, and they are large */
cpSync(root, dir, { recursive: true, filter: p => !/^\/(\.git|\.claude|\.snap|voice-samples|zika-v17)(\/|$)|\.pack$|\/dict\.txt$/.test(p.slice(root.length)) });

const edit = (file, from, to) => { const p = join(dir, file), s = readFileSync(p, 'utf8'); if (!s.includes(from)) throw new Error(`${file}: "${from}" not found`); writeFileSync(p, s.replace(from, to)); };
const stamp = () => execFileSync(process.execPath, [join(dir, 'tools/stamp.mjs')], { stdio: 'pipe' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, pass, detail = '') => { results.push(pass); console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

const log = [];
let srv = await serve(dir, { log });
const port = srv.port, url = `http://127.0.0.1:${port}/index.html?sw`;
const br = await chrome();
try {
  const { targetId } = await br.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => br.send(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  /* an evaluation whose page reloads under it never answers: give up on it after `ms` */
  const js = async (expr, ms = 25000) => { const r = await Promise.race([s('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => { throw new Error('no answer from the page'); })]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const open = async () => { const loaded = new Promise(done => { const stop = br.on(m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { stop(); done(); } }); }); await s('Page.navigate', { url }); await Promise.race([loaded, sleep(15000)]); await sleep(300); };
  const until = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await js(`return ${expr}`, 3000)) return true; } catch (e) { /* the page may be reloading */ } await sleep(200); } return false; };
  const state = () => js(`const keys = (await caches.keys()).filter(k => k.startsWith('zika-shell-')); const n = keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
    return { version: typeof APP_VERSION === 'undefined' ? null : APP_VERSION, painted: !!document.querySelector('#vHome .card'), controlled: !!navigator.serviceWorker.controller, shells: keys, held: n }`);
  const shellCount = JSON.parse(/const FILES = (\[.*\]);/.exec(readFileSync(join(dir, 'sw.js'), 'utf8'))[1]).length;

  console.log('1. first visit');
  await open();
  ok('the worker takes control', await until('navigator.serviceWorker.controller && true'));
  let st = await state();
  ok('it holds every shell file', st.shells.length === 1 && st.held === shellCount, `${st.held} of ${shellCount} in ${st.shells.join(', ')}`);
  ok('the app is painted', st.painted && st.version === 62, 'v' + st.version);

  console.log('2. offline');
  await srv.close();
  await open();
  st = await state();
  ok('the app opens with the server stopped', st.painted && st.version === 62);
  const errs = await js(`return performance.getEntriesByType('resource').filter(r => /\\/(js|css|data)\\//.test(r.name) && r.responseStatus && r.responseStatus !== 200).map(r => r.name)`);
  ok('every script and style came from the store', errs.length === 0, errs.join(' '));

  console.log('3. a release');
  srv = await serve(dir, { port, log });
  edit('js/core.js', 'const APP_VERSION=62;', 'const APP_VERSION=63;'); edit('sw.js', "const VERSION = 'zika-v62';", "const VERSION = 'zika-v63';"); stamp();
  log.length = 0;
  await js(`appRefresh(); return 1`, 3000).catch(() => { });
  ok('the page reloads into the new version', await until('typeof APP_VERSION !== "undefined" && APP_VERSION === 63 && !!document.querySelector("#vHome .card")', 30000));
  st = await state();
  ok('one shell cache, of the new release', st.shells.length === 1 && /v63/.test(st.shells[0]) && st.held === shellCount, st.shells.join(', '));
  const fetched = [...new Set(log.map(u => u.split('?')[0]))].filter(u => /\/(js|css|data)\//.test(u));
  ok('only the changed file was downloaded', fetched.length === 1 && fetched[0] === '/js/core.js', fetched.join(' ') || 'nothing');

  console.log('4. a half-published release');
  edit('js/core.js', 'const APP_VERSION=63;', 'const APP_VERSION=64;'); edit('sw.js', "const VERSION = 'zika-v63';", "const VERSION = 'zika-v64';"); stamp();
  edit('js/core.js', 'const APP_VERSION=64;', 'const APP_VERSION=63;');   /* the server still hands out the old file */
  const outcome = await js(`const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); const w = reg.installing; if (!w) return 'no install started';
    return await new Promise(done => { const t = setTimeout(() => done('still ' + w.state), 15000); w.addEventListener('statechange', () => { if (w.state === 'redundant' || w.state === 'activated') { clearTimeout(t); done(w.state); } }); })`);
  ok('the install is refused', outcome === 'redundant', outcome);
  await open();
  st = await state();
  ok('the device keeps the release it has, whole', st.painted && st.version === 63 && st.shells.length === 1 && /v63/.test(st.shells[0]), `v${st.version}, ${st.shells.join(', ')}`);

  const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
  if (from) {
    console.log('5. coming from an earlier release');
    await js(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); return 1`);
    await srv.close(); rmSync(dir, { recursive: true, force: true });
    const skip = p => /\.pack$|\/dict\.txt$/.test(p);
    cpSync(from, dir, { recursive: true, filter: p => !skip(p) });
    srv = await serve(dir, { port, log });
    await open(); await open();
    ok('the earlier release runs under its own worker', await until('navigator.serviceWorker.controller && typeof APP_VERSION !== "undefined" && APP_VERSION === 62'));
    /* publish this release over it, as a push to the site does */
    cpSync(root, dir, { recursive: true, force: true, filter: p => !/^\/(\.git|\.claude|\.snap|voice-samples|zika-v17)(\/|$)/.test(p.slice(root.length)) && !skip(p) });
    edit('js/core.js', 'const APP_VERSION=62;', 'const APP_VERSION=63;'); edit('sw.js', "const VERSION = 'zika-v62';", "const VERSION = 'zika-v63';"); stamp();
    await js(`appRefresh(); return 1`, 3000).catch(() => { });
    ok('it becomes this release', await until('typeof APP_VERSION !== "undefined" && APP_VERSION === 63 && !!document.querySelector("#vHome .card")', 40000));
    ok('the new worker holds the whole shell', await until(`(async () => { const k = (await caches.keys()).filter(k => k.startsWith('zika-shell-')); return k.length === 1 && (await (await caches.open(k[0])).keys()).length === ${shellCount}; })()`, 30000));
    await sleep(1500);
    const left = await js(`return (await caches.keys()).join(', ')`);
    ok('the old per-version cache is gone', !/zika-v62/.test(left), left);
    await srv.close();
    await open();
    st = await state();
    ok('and it opens offline', st.painted && st.version === 63 && st.controlled, 'v' + st.version);
  }
} finally { await br.close(); try { await srv.close(); } catch (e) { } rmSync(dir, { recursive: true, force: true }); }

const failed = results.filter(r => !r).length;
console.log(failed ? `\nFAILED — ${failed} of ${results.length}` : `\nOK — ${results.length} checks`);
process.exit(failed ? 1 : 0);

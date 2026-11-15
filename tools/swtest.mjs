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

const ver = () => +/const APP_VERSION=(\d+);/.exec(readFileSync(join(dir, 'js/core.js'), 'utf8'))[1];
/* give the copy version `to`, in both places a release changes it */
const setVersion = to => { const p = join(dir, 'js/core.js'), q = join(dir, 'sw.js');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/const APP_VERSION=\d+;/, `const APP_VERSION=${to};`));
  writeFileSync(q, readFileSync(q, 'utf8').replace(/const VERSION = 'zika-v\d+';/, `const VERSION = 'zika-v${to}';`)); };
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

  const V = ver();   /* the release being tested */
  console.log(`1. first visit (v${V})`);
  await open();
  ok('the worker takes control', await until('navigator.serviceWorker.controller && true'));
  let st = await state();
  ok('it holds every shell file', st.shells.length === 1 && st.held === shellCount, `${st.held} of ${shellCount} in ${st.shells.join(', ')}`);
  ok('the app is painted', st.painted && st.version === V, 'v' + st.version);

  console.log('2. offline');
  await srv.close();
  await open();
  st = await state();
  ok('the app opens with the server stopped', st.painted && st.version === V);
  const errs = await js(`return performance.getEntriesByType('resource').filter(r => /\\/(js|css|data)\\//.test(r.name) && r.responseStatus && r.responseStatus !== 200).map(r => r.name)`);
  ok('every script and style came from the store', errs.length === 0, errs.join(' '));

  console.log('3. a release');
  srv = await serve(dir, { port, log });
  setVersion(V + 1); stamp();
  log.length = 0;
  await js(`appRefresh(); return 1`, 3000).catch(() => { });
  ok('the page reloads into the new version', await until(`typeof APP_VERSION !== "undefined" && APP_VERSION === ${V + 1} && !!document.querySelector("#vHome .card")`, 30000));
  st = await state();
  ok('one shell cache, of the new release', st.shells.length === 1 && st.shells[0].includes(`v${V + 1}-`) && st.held === shellCount, st.shells.join(', '));
  const fetched = [...new Set(log.map(u => u.split('?')[0]))].filter(u => /\/(js|css|data)\//.test(u));
  ok('only the changed file was downloaded', fetched.length === 1 && fetched[0] === '/js/core.js', fetched.join(' ') || 'nothing');

  console.log('4. a half-published release');
  setVersion(V + 2); stamp();
  { const p = join(dir, 'js/core.js'); writeFileSync(p, readFileSync(p, 'utf8').replace(`const APP_VERSION=${V + 2};`, `const APP_VERSION=${V + 1};`)); }   /* the server still hands out the old file */
  const outcome = await js(`const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); const w = reg.installing; if (!w) return 'no install started';
    return await new Promise(done => { const t = setTimeout(() => done('still ' + w.state), 15000); w.addEventListener('statechange', () => { if (w.state === 'redundant' || w.state === 'activated') { clearTimeout(t); done(w.state); } }); })`);
  ok('the install is refused', outcome === 'redundant', outcome);
  await open();
  st = await state();
  ok('the device keeps the release it has, whole', st.painted && st.version === V + 1 && st.shells.length === 1 && st.shells[0].includes(`v${V + 1}-`), `v${st.version}, ${st.shells.join(', ')}`);

  const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
  if (from) {
    console.log('5. coming from an earlier release');
    await js(`for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); return 1`);
    await srv.close(); rmSync(dir, { recursive: true, force: true });
    const skip = p => /\.pack$|\/dict\.txt$/.test(p);
    cpSync(from, dir, { recursive: true, filter: p => !skip(p) });
    srv = await serve(dir, { port, log });
    await open(); await open();
    const fromV = +/const VERSION = 'zika-v(\d+)'/.exec(readFileSync(join(from, 'sw.js'), 'utf8'))[1];
    ok(`the earlier release (v${fromV}) runs under its own worker`, await until(`navigator.serviceWorker.controller && typeof APP_VERSION !== "undefined" && APP_VERSION === ${fromV}`));
    /* what a real device holds when a release reaches it: a deck with a month of study, a sync code, and the
       audio the old worker stored. The browser can resolve no host but this machine, so the code reaches no cloud. */
    const fx = JSON.parse(readFileSync(join(root, 'tools/snap/fixtures/deck.json'), 'utf8'));
    const CODE = 'swtest-not-a-real-room';
    await js(`localStorage.clear(); const fx = ${JSON.stringify(fx)}; for (const k in fx) localStorage.setItem(k, fx[k]);
      localStorage.setItem('zika_sync_code', ${JSON.stringify(CODE)});
      await (await caches.open('zika-assets-v1')).put('assets/swtest-marker', new Response('kept'));
      return 1`);
    await open();
    ok('the earlier release opens the deck', await until(`typeof S !== "undefined" && Object.keys(S.cards).length === ${Object.keys(JSON.parse(fx.shida_b1_fsrs_v2).cards).length} && !!document.querySelector("#vHome .card")`));
    await sleep(1500);   /* let it finish whatever it saves on opening */
    const held = `(() => { const d = JSON.parse(localStorage.getItem('shida_b1_fsrs_v2')); const flat = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
      return { cards: flat(d.cards), n: Object.keys(d.cards).length, my: flat(d.my), log: flat(d.log), hist: flat(d.hist), intro: flat(d.intro), flags: Object.keys(d.settings).filter(k => k[0] === '_' && d.settings[k]).sort().join(' '),
        keys: Object.keys(d).sort().join(' '), settings: flat(d.settings), code: localStorage.getItem('zika_sync_code'), device: localStorage.getItem('zika_device_id'), look: localStorage.getItem('zika_look'), stores: Object.keys(localStorage).sort().join(' ') }; })()`;
    const before = await js(`return ${held}`);
    /* publish this release over it, as a push to the site does */
    cpSync(root, dir, { recursive: true, force: true, filter: p => !/^\/(\.git|\.claude|\.snap|voice-samples|zika-v17)(\/|$)/.test(p.slice(root.length)) && !skip(p) });
    const toV = V > fromV ? V : fromV + 1;   /* a copy not yet given its number is published as the next one */
    if (toV !== V) { setVersion(toV); stamp(); }
    await js(`appRefresh(); return 1`, 3000).catch(() => { });
    ok(`it becomes this release (v${toV})`, await until(`typeof APP_VERSION !== "undefined" && APP_VERSION === ${toV} && !!document.querySelector("#vHome .card")`, 40000));
    ok('the new worker holds the whole shell', await until(`(async () => { const k = (await caches.keys()).filter(k => k.startsWith('zika-shell-')); return k.length === 1 && (await (await caches.open(k[0])).keys()).length === ${shellCount}; })()`, 30000));
    /* The new worker removes the old cache when it takes over. The old worker may still be storing what the
       reloading page asked it for, and then its cache comes back (about one run in four on a busy machine); the new
       worker sweeps it when the app is next opened. So: open the app once more, and then nothing old may be left. */
    await open();
    const gone = await until(`(async () => { const k = await caches.keys(); return k.length === 2 && k.includes('zika-assets-v1') && k.some(n => n.startsWith('zika-shell-v${toV}-')); })()`, 20000);
    const left = await js(`return (await caches.keys()).join(', ')`);
    ok('nothing of the old release is left: one shell cache and the assets', gone, left);
    ok('the stored audio is carried over', await js(`const r = await (await caches.open('zika-assets-v1')).match('assets/swtest-marker'); return !!r && (await r.text()) === 'kept'`));
    const after = await js(`return ${held}`);
    ok('every card is as it was', after.cards === before.cards && after.n === before.n, `${after.n} cards`);
    ok('My words, the log, the history and the day counts are as they were', ['my', 'log', 'hist', 'intro'].every(k => after[k] === before[k]), ['my', 'log', 'hist', 'intro'].filter(k => after[k] !== before[k]).join(' '));
    ok('no part of the deck is missing and no migration runs again', before.keys.split(' ').every(k => after.keys.split(' ').includes(k)) && before.flags.split(' ').every(f => after.flags.split(' ').includes(f)), `flags: ${after.flags}`);
    ok('the sync code, the device id and the look are kept', after.code === CODE && after.device === before.device && after.look === before.look);
    ok('the page is linked to the same room', await js(`return typeof SYNC !== 'undefined' && SYNC.code === ${JSON.stringify(CODE)}`));
    if (after.settings !== before.settings) { const a = JSON.parse(after.settings), b = JSON.parse(before.settings); console.log('    settings that differ: ' + [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => `${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}`).join(', ')); }
    if (after.stores !== before.stores) console.log(`    stored keys: ${before.stores}  →  ${after.stores}`);
    await srv.close();
    await open();
    st = await state();
    ok('and it opens offline, on the same deck', st.painted && st.version === toV && st.controlled && await js(`return Object.keys(S.cards).length`) === before.n, 'v' + st.version);
  }
} finally { await br.close(); try { await srv.close(); } catch (e) { } rmSync(dir, { recursive: true, force: true }); }

const failed = results.filter(r => !r).length;
console.log(failed ? `\nFAILED — ${failed} of ${results.length}` : `\nOK — ${results.length} checks`);
process.exit(failed ? 1 : 0);

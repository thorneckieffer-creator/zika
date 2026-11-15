#!/usr/bin/env node
/* Screen-by-screen regression harness for 字卡.

   It opens the app in headless Chrome with a fixed clock, a seeded Math.random and no network beyond
   this machine, walks through a script of screens and actions (tools/snap/scenarios.mjs) at phone and
   tablet size, and records for every step: the page's HTML, the saved state, and a screenshot.
   Two recordings of the same scenarios are then compared. A change that is meant to leave the app
   behaving exactly as before (folding layers, moving code between files) must compare as identical.

     node tools/snap.mjs record                 record the working copy as the golden recording
     node tools/snap.mjs check                  record it again and compare with the golden recording
     node tools/snap.mjs run --dir D --out O    record the app in folder D into folder O
     node tools/snap.mjs diff A B               compare two recordings
     node tools/snap.mjs fixture --dir D        rebuild tools/snap/fixtures/deck.json by studying in D

   Options: --only <text> (scenarios whose name contains it), --size phone|tablet, --no-shots, --jobs N,
   --coverage (lists the functions no scenario reached), --detail <scenario>:<step> (dump one monkey step).
   Recordings are kept in ~/.cache/zika-snap/. Nothing here touches a real deck: Chrome runs with a throw-away profile. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, extname, resolve, normalize, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const argv = process.argv.slice(2), cmd = argv[0];
const opt = (name, dflt) => { const i = argv.indexOf('--' + name); return i < 0 ? dflt : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = { phone: { width: 390, height: 844, mobile: true }, tablet: { width: 1180, height: 820, mobile: false } };
/* The moment every scenario starts at: a Friday morning in Taipei. */
const T0 = Date.parse('2026-11-20T09:30:00+08:00');

/* ---------- a static server for one folder ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.pack': 'application/octet-stream', '.svg': 'image/svg+xml' };
function serve(dir) {
  dir = resolve(dir);
  return new Promise(done => {
    const srv = createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = normalize(join(dir, p));
      if (!f.startsWith(dir + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
      const body = readFileSync(f), range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const head = { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      if (range) { const a = +range[1], z = range[2] ? +range[2] : body.length - 1; res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${z}/${body.length}` }); res.end(body.subarray(a, z + 1)); }
      else { res.writeHead(200, head); res.end(body); }
    });
    srv.listen(0, '127.0.0.1', () => done({ port: srv.address().port, close: () => srv.close() }));
  });
}

/* ---------- headless Chrome over the DevTools protocol (no packages needed) ---------- */
async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), 'zika-snap-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-background-networking',
    '--disable-component-update', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-popup-blocking', '--disable-sync', '--disable-extensions', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, no) => {
    let buf = ''; const t = setTimeout(() => no(new Error('Chrome did not start: ' + buf.slice(0, 400))), 20000);
    proc.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); ok(m[1]); } });
    proc.on('exit', c => no(new Error('Chrome exited (' + c + '): ' + buf.slice(0, 400))));
  });
  const ws = new WebSocket(wsUrl); await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('cannot reach Chrome')); });
  let seq = 0; const waiting = new Map(), listeners = new Set();
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) { const { ok, no } = waiting.get(m.id); waiting.delete(m.id); m.error ? no(new Error(m.error.message + (m.error.data ? ' — ' + m.error.data : ''))) : ok(m.result); }
    else if (m.method) for (const l of listeners) l(m); };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, { ok, no }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  return { send, on: l => { listeners.add(l); return () => listeners.delete(l); },
    close: async () => { await Promise.race([send('Browser.close').catch(() => { }), new Promise(r => setTimeout(r, 1500))]);   /* Chrome may drop the socket before it answers */ try { ws.close(); } catch (e) { } try { proc.kill('SIGKILL'); } catch (e) { } try { rmSync(profile, { recursive: true, force: true }); } catch (e) { } } };
}

/* ---------- what runs in the page before the app does ---------- */
const prelude = (t0, storage) => `(() => {
  window.__errors = [];
  /* a clock that moves only when the scenario says so */
  const RealDate = Date; let now = ${t0};
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  window.Date = FakeDate;
  window.__now = () => now;
  /* Timers follow that clock too, so a toast lasts the same number of steps in every run. A timer of under 50 ms
     stays real (and the recording waits for it); anything longer, and every interval, fires when the scenario's
     clock passes it: __tick(ms) moves the clock and runs what came due on the way, in order. */
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window), realCI = window.clearInterval.bind(window);
  window.__realSetTimeout = realST; window.__busy = 0;
  let tid = 1e9; const timers = new Map(), shorts = new Map();
  window.setTimeout = (fn, ms, ...args) => {
    if (typeof fn !== 'function') return realST(fn, ms);
    if (!(ms >= 50)) { let open = true; const close = () => { if (open) { open = false; window.__busy--; } }; window.__busy++;
      const id = realST(() => { shorts.delete(id); close(); fn(...args); }, ms); shorts.set(id, close); return id; }
    timers.set(++tid, { due: now + ms, fn, args }); return tid; };
  window.clearTimeout = id => { if (timers.delete(id)) return; const close = shorts.get(id); if (close) { close(); shorts.delete(id); } realCT(id); };
  window.setInterval = (fn, ms, ...args) => { timers.set(++tid, { due: now + Math.max(50, ms || 0), fn, args, every: Math.max(50, ms || 0) }); return tid; };
  window.clearInterval = id => { if (!timers.delete(id)) realCI(id); };
  window.__run = until => { let guard = 0, fired = 0;
    while (guard++ < 3000) { let best = null, bid = 0; for (const [id, t] of timers) if (t.due <= until && (!best || t.due < best.due)) { best = t; bid = id; }
      if (!best) break; if (best.due > now) now = best.due;
      if (best.every) best.due = now + best.every; else timers.delete(bid);
      fired++; try { best.fn(...best.args); } catch (e) { window.__errors.push('timer: ' + (e && e.message || e)); } }
    if (until > now) now = until; return fired; };
  window.__setNow = t => { if (t > now) window.__run(t); else now = t; }; window.__tick = ms => window.__run(now + ms);
  /* a seeded Math.random (mulberry32) */
  let seed = 12345;
  Math.random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  window.__seed = n => { seed = n; };
  /* no service worker, no speech, no surprises from the outside world */
  try { Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => new Promise(() => {}), getRegistration: () => Promise.resolve(undefined), getRegistrations: () => Promise.resolve([]), addEventListener() {}, ready: new Promise(() => {}), controller: null }, configurable: true }); } catch (e) {}
  try { window.speechSynthesis.speak = () => {}; window.speechSynthesis.getVoices = () => []; } catch (e) {}
  try { HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; } catch (e) {}
  try { navigator.vibrate = () => false; } catch (e) {}
  window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; window.print = () => {}; window.open = () => null;
  try { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no microphone in the harness', 'NotAllowedError')); } catch (e) {}
  try { navigator.clipboard.writeText = () => Promise.resolve(); navigator.clipboard.readText = () => Promise.resolve(''); } catch (e) {}
  try { delete window.showSaveFilePicker; delete window.showOpenFilePicker; } catch (e) {}
  /* requests in flight, so a recording waits for what the page is still loading */
  window.__pending = new Set();
  const realFetch = window.fetch; window.fetch = function (u) { const tag = String(u && u.url || u).slice(0, 80); window.__pending.add(tag); window.__busy++; const done = () => { window.__busy--; window.__pending.delete(tag); }; return realFetch.apply(this, arguments).then(r => {
      for (const m of ['text', 'json', 'arrayBuffer', 'blob']) { const read = r[m].bind(r); r[m] = () => { window.__busy++; return read().finally(() => { window.__busy--; }); }; }   /* busy until the body has been read too */
      done(); return r; }, e => { done(); throw e; }); };
  /* the monkey: one random tap, choice, keystroke or typed word, chosen by its own seeded generator */
  let ms = 1; const mrand = () => { ms |= 0; ms = ms + 0x6D2B79F5 | 0; let t = Math.imul(ms ^ ms >>> 15, 1 | ms); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const DANGER = /reset|erase|wipe|importData|exportData|fbUnlink|fbNewCode|fbSetCode|fbPullNow|bkForget|bkChoose|bkGrant|appRefresh|location\.|reload|print|download|preloadOffline|snapRestore|confDownload|fbCopy|fbPaste|checkForUpdate|shareDeck/i;
  const KEYS = [' ', '1', '2', '3', '4', 'Enter', 'Escape', 'ArrowRight', 'ArrowLeft', 'u', 'z', 'h'];
  const WORDS_TO_TYPE = ['學', '好', 'ni', 'tea', '吃飯', 'xué', '沒差', '垃圾'];
  let tried = {};
  window.__monkeySeed = n => { ms = n; tried = {}; };
  window.__monkey = (scope, noKeys) => {
    const pick = a => a[Math.floor(mrand() * a.length)];
    const within = scope ? [...document.querySelectorAll(scope)].filter(e => e.getClientRects().length) : [document];
    if (!within.length) return 'RESTART (the screen is gone)';
    if (!noKeys && mrand() < 0.12) { const k = pick(KEYS); const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
      t.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true })); return 'key ' + JSON.stringify(k); }
    const els = within.flatMap(r => [...r.querySelectorAll('button,[onclick],summary,select,input,textarea,[role=button]')]).filter(e => {
      if (e.disabled || !e.getClientRects().length || e.closest('[hidden]')) return false;
      if (e.type === 'file') return false;
      const sig = (e.getAttribute('onclick') || '') + ' ' + (e.id || '') + ' ' + (e.getAttribute('onchange') || '');
      return !DANGER.test(sig) && !/^(reset|erase|unlink|forget|delete everything)/i.test((e.textContent || '').trim());
    });
    if (!els.length) return 'RESTART (nothing to tap)';
    /* prefer what has been tried least: a control's signature is its handler with digits blanked, so the 40 rows of a list count as one */
    const sigOf = e => (e.tagName + '|' + (e.getAttribute('onclick') || e.getAttribute('onchange') || e.getAttribute('oninput') || e.id || (e.textContent || '').trim().slice(0, 24))).replace(/\\d+/g, '#').slice(0, 80);
    const wts = els.map(e => 1 / Math.pow(1 + (tried[sigOf(e)] || 0), 2)); let roll = mrand() * wts.reduce((a, b) => a + b, 0), at = 0;
    while (at < els.length - 1 && (roll -= wts[at]) > 0) at++;
    const e = els[at]; tried[sigOf(e)] = (tried[sigOf(e)] || 0) + 1;
    const label = (e.tagName + ' ' + (e.getAttribute('onclick') || e.getAttribute('onchange') || e.id || '') + ' ' + (e.textContent || '').trim().replace(/\\s+/g, ' ')).slice(0, 90);
    if (e.tagName === 'SELECT') { if (e.options.length) { e.selectedIndex = Math.floor(mrand() * e.options.length); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } return 'choose ' + label; }
    if (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && !/checkbox|radio|range|button|submit/.test(e.type))) {
      if (e.type === 'number') e.value = String(1 + Math.floor(mrand() * 20)); else if (e.type === 'date') e.value = '2026-12-0' + (1 + Math.floor(mrand() * 8)); else e.value = pick(WORDS_TO_TYPE);
      e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
      if (mrand() < 0.3) e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 'type ' + label; }
    if (e.tagName === 'INPUT' && e.type === 'range') { e.value = String(+e.min + mrand() * ((+e.max || 100) - (+e.min || 0))); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return 'slide ' + label; }
    e.click(); return 'tap ' + label;
  };
  /* links that lead out of the app go nowhere */
  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a && (a.target === '_blank' || /^https?:/.test(a.getAttribute('href')))) e.preventDefault(); }, true);
  window.addEventListener('error', e => window.__errors.push('error: ' + (e.message || e)));
  window.addEventListener('unhandledrejection', e => window.__errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const store = ${JSON.stringify(storage || {})};
  try { for (const k in store) localStorage.setItem(k, typeof store[k] === 'string' ? store[k] : JSON.stringify(store[k])); } catch (e) {}
  /* stillness: animations and transitions off, so a screenshot is the same picture every time */
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.id = '__still';
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important} svg:has([clip-path]),.qrbox svg{visibility:hidden!important}'; document.head.appendChild(st); });
})();`;

/* A stand-in for the Firebase SDK, for scenarios with `cloud`. The app finds it as window.__fbSDK and never loads
   the real one. It holds one tree in memory, applies the one database rule that matters (a study_state write must
   carry a newer synced_at), and lets a scenario act as another device: __cloud.put(path, value), __cloud.other(state). */
const fakeCloud = cloud => `(() => {
  const tree = {}, subs = [];
  /* answers arrive the way the real SDK's do: never before the page has finished loading, never in the middle of a script */
  const later = fn => { const go = () => setTimeout(fn, 40);   /* long enough for what start-up reads from IndexedDB to arrive first, as it does against a real network */ if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true }); };
  const at = (path, make) => { let n = tree; const ks = path.split('/').filter(Boolean); for (const k of ks.slice(0, -1)) { if (!n[k]) { if (!make) return [null, null]; n[k] = {}; } n = n[k]; } return [n, ks[ks.length - 1]]; };
  const read = path => { const [n, k] = at(path); return n && k in n ? JSON.parse(JSON.stringify(n[k])) : null; };
  const snap = path => ({ val: () => path === '.info/connected' ? C.online : read(path), exists: () => read(path) !== null });
  const tell = path => { for (const s of subs.slice()) if (path === s.path || path.startsWith(s.path + '/') || s.path.startsWith(path + '/')) later(() => { if (subs.includes(s)) s.cb(snap(s.path)); }); };
  const write = (path, v) => { const [n, k] = at(path, true); if (v === null || v === undefined) delete n[k]; else n[k] = JSON.parse(JSON.stringify(v)); tell(path); };
  let pushN = 0, authCb = null;
  const C = window.__cloud = { online: true, writes: [], tree,
    put: write, read,
    /* another device saves: its state (an object) goes up the way the app writes it */
    other: (state, device, when) => write('rooms/' + C.code + '/study_state', { v: 18, json: JSON.stringify(state), device: device || 'iPad', device_id: 'other-device', synced_at: when || Date.now(), bytes: 1 }),
    code: ${JSON.stringify(cloud.code || '')} };
  window.__fbSDK = {
    initializeApp: cfg => ({ cfg }), getDatabase: app => ({ app }), getAuth: app => ({ app }),
    ref: (db, path) => ({ path }),
    serverTimestamp: () => Date.now(),
    onAuthStateChanged: (auth, cb) => { authCb = cb; },
    signInAnonymously: () => new Promise(ok => later(() => { if (authCb) authCb({ uid: 'harness-uid-0001', isAnonymous: true }); ok({ user: { uid: 'harness-uid-0001' } }); })),
    onValue: (ref, cb, onErr) => { const s = { path: ref.path, cb }; subs.push(s); later(() => { if (subs.includes(s)) cb(snap(ref.path)); }); return () => { const i = subs.indexOf(s); if (i > -1) subs.splice(i, 1); }; },
    get: ref => C.online ? new Promise(ok => later(() => ok(snap(ref.path)))) : Promise.reject(new Error('Error: Client is offline.')),
    set: (ref, v) => { if (!C.online) return new Promise(() => {});
      const old = read(ref.path);
      if (/\\/study_state$/.test(ref.path) && old && !(v && v.synced_at > old.synced_at)) return Promise.reject(new Error('PERMISSION_DENIED: Permission denied'));
      C.writes.push({ path: ref.path, bytes: JSON.stringify(v).length, device: v && v.device }); write(ref.path, v); return new Promise(ok => later(ok)); },
    push: (ref, v) => { write(ref.path + '/-N' + String(++pushN).padStart(6, '0'), v); return Promise.resolve({ key: '-N' + pushN }); },
  };
  ${cloud.remote ? `C.other(${cloud.remote}, 'iPad', ${cloud.remoteAt || 0} || Date.now() - 3600000);` : ''}
})();`;

/* what is read back after every step */
const CAPTURE = quiet => `(async () => {
  const QUIET = ${quiet};
  /* wait until the page has stopped changing (count-ups, lists painted in slices) */
  const began = performance.now(), sleep = ms => new Promise(r => window.__realSetTimeout(r, ms));
  /* let the page finish what the last action started: wait until nothing is loading and the page has stopped
     changing (count-ups, lists painted in slices), run the next second of its timers, and wait again for what they began */
  const who = []; let last = performance.now();
  const mo = new MutationObserver(ms => { last = performance.now(); for (const m of ms) { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (t && who.length < 400) who.push(t.tagName + (t.id ? '#' + t.id : '') + (t.className && t.className.baseVal === undefined ? '.' + String(t.className).split(' ')[0] : '')); } });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  const still = async () => { const t0 = performance.now(); last = t0; while (true) { await sleep(15); const n = performance.now(); if ((n - last > QUIET && !window.__busy) || n - t0 > 8000) return; } };
  await still(); window.__run(window.__now() + 1000); await still(); if (window.__run(window.__now() + 250)) await still();
  mo.disconnect(); window.__who = who;
  const stable = v => v && typeof v === 'object' ? (Array.isArray(v) ? v.map(stable) : Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])]))) : v;
  let state = null; try { state = stable(JSON.parse(JSON.stringify(S))); } catch (e) { state = 'unreadable: ' + e.message; }
  const body = document.body.cloneNode(true);
  body.querySelectorAll('script').forEach(n => n.remove());
  /* stroke-order drawings are animated by Hanzi Writer on its own clock: record that they are there, not how far along */
  body.querySelectorAll('svg').forEach(svg => { if (svg.querySelector('[clip-path]')) svg.innerHTML = '<!-- strokes -->'; });
  /* the QR code spells out this page's address, and the harness serves from a different port every run */
  body.querySelectorAll('.qrbox svg').forEach(svg => { svg.innerHTML = '<!-- qr -->'; });
  const html = body.innerHTML.split(location.origin).join('http://app').replace(/>\\s*</g, '>\\n<').replace(/\\n\\s*\\n/g, '\\n');
  const head = [...document.head.querySelectorAll('style')].filter(s => s.id !== '__still').map(s => s.textContent.length).join(',');
  const extra = { view: typeof view === 'undefined' ? null : view, title: document.title, attrs: [...document.documentElement.attributes].map(a => a.name + '=' + a.value).sort().join(' '),
    scrollH: document.documentElement.scrollHeight, busy: window.__busy, pending: [...window.__pending].join(' '), who: [...new Set((window.__who || []).slice(-60))].join(' '), waited: Math.round(performance.now() - began), errors: window.__errors.splice(0), local: Object.fromEntries(Object.keys(localStorage).sort().filter(k => k !== 'shida_b1_fsrs_v2' && k !== 'zika_snap_v1').map(k => [k, localStorage.getItem(k).length > 400 ? 'len ' + localStorage.getItem(k).length : localStorage.getItem(k)])) };
  if (window.__cloud) { const room = (window.__cloud.tree.rooms || {})[window.__cloud.code] || {}, st = room.study_state;
    extra.cloud = { writes: window.__cloud.writes.length, held: st ? { device: st.device, synced_at: st.synced_at, cards: Object.keys(JSON.parse(st.json).cards || {}).length } : null, log: Object.keys(room.sync_log || {}).length };
    extra.sync = typeof SYNC === 'undefined' ? null : { status: SYNC.status, code: SYNC.code, dirty: SYNC.dirty, at: SYNC.at, remoteAt: SYNC.remoteAt, remoteDev: SYNC.remoteDev, lastErr: SYNC.lastErr, log: SYNC.log.map(l => l.kind + ' ' + l.extra) }; }
  return JSON.stringify({ html, state, extra, head });
})()`;

/* ---------- running scenarios ---------- */
const sha = t => createHash('sha1').update(t).digest('hex').slice(0, 16);
async function record(dir, out, { only, size, shots = true, coverage = false, detail = null, jobs = 8 } = {}) {
  const { scenarios } = await import(join(here, 'snap', 'scenarios.mjs') + '?t=' + Date.now());
  const fixtures = name => name ? JSON.parse(readFileSync(join(here, 'snap', 'fixtures', name + '.json'), 'utf8')) : {};
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const srv = await serve(dir), br = await chrome(), origin = `http://127.0.0.1:${srv.port}`;
  const sizes = Object.keys(SIZES).filter(k => !size || size === k);
  const work = []; for (const sc of scenarios) { if (only ? !sc.name.includes(only) : sc.name.startsWith('__')) continue; for (const sz of sizes) if (!sc.sizes || sc.sizes.includes(sz)) work.push([sc, sz]); }
  let steps = 0; const t0 = Date.now(), seen = new Map();   /* seen: function name -> was it ever called */

  async function one(sc, sz) {
    const { browserContextId } = await br.send('Target.createBrowserContext');
    const { targetId } = await br.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await br.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => br.send(m, p, sessionId);
    const v = SIZES[sz];
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: v.mobile });
    if (v.mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true });
    await s('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Taipei' });
    await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
    /* only this machine answers: the Firebase SDK, 萌典 and everything else fail at once, as they do offline */
    await s('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const off = br.on(m => { if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
      const u = m.params.request.url, local = u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank';
      br.send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', local ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: 'InternetDisconnected' }, sessionId).catch(() => { }); });
    if (coverage) { await s('Profiler.enable'); await s('Profiler.startPreciseCoverage', { callCount: false, detailed: false }); }
    const local = { ...fixtures(sc.fixture), ...(sc.local || {}) };
    /* `cloud.remote` names the fixture whose deck another device has already saved to the room */
    const cloud = sc.cloud && { ...sc.cloud, remote: sc.cloud.remote ? JSON.stringify(JSON.parse(fixtures(sc.cloud.remote).shida_b1_fsrs_v2)) : null };
    await s('Page.addScriptToEvaluateOnNewDocument', { source: prelude(sc.at || T0, local) + (cloud ? '\n' + fakeCloud(cloud) : '') });
    const loaded = new Promise(ok => { const stop = br.on(m => { if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { stop(); ok(); } }); });
    await s('Page.navigate', { url: origin + '/index.html' + (sc.hash || '') }); await loaded;
    const evalJs = async js => { const r = await s('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) return { threw: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').split('\n')[0] }; return { value: r.result.value }; };
    const dump = (id, st, ran, c, shot) => writeFileSync(join(out, id + '.txt'), [`# ${id}`, `threw: ${ran.threw || ''}`, `returned: ${st.fixture ? '(fixture)' : ran.value === undefined ? '' : JSON.stringify(ran.value)}`, `view: ${c.extra.view}`, `html-attrs: ${c.extra.attrs}`, `title: ${c.extra.title}`,
      `styles-in-head: ${c.head}`, `scroll-height: ${c.extra.scrollH}`, `errors: ${JSON.stringify(c.extra.errors)}`, `local: ${JSON.stringify(c.extra.local)}`, `cloud: ${JSON.stringify(c.extra.cloud || null)}`, `sync: ${JSON.stringify(c.extra.sync || null)}`, `screenshot: ${shot}`,
      '', '## state', JSON.stringify(c.state, null, 1), '', '## html', c.html, ''].join('\n'));

    const all = [{ name: 'open', js: '' }, ...(sc.steps || [])];
    for (let i = 0; i < all.length; i++) {
      const st = all[i], id = `${sc.name}.${sz}.${String(i).padStart(2, '0')}-${st.name}`.replace(/[^\w.\-]+/g, '_');
      await evalJs(`__seed(${1000 + i})`);
      const ran = st.js ? await evalJs(`(async()=>{${st.js}\n})()`) : {};
      const cap = await evalJs(CAPTURE(160)); steps++;
      if (cap.threw) { writeFileSync(join(out, id + '.txt'), 'CAPTURE FAILED: ' + cap.threw); continue; }
      const c = JSON.parse(cap.value);
      if (c.extra.waited > 4000) console.log(`\n  slow capture in ${id} (${c.extra.waited} ms): busy=${c.extra.busy} waiting for [${c.extra.pending}] changing [${c.extra.who}]`);
      if (st.fixture) { writeFileSync(join(here, 'snap', 'fixtures', st.fixture + '.json'), ran.value); console.log('\n  fixture written: tools/snap/fixtures/' + st.fixture + '.json (' + ran.value.length + ' bytes)'); }
      let shot = '';
      if (shots && !st.noShot && !sc.noShots) {
        const { cssContentSize } = await s('Page.getLayoutMetrics');
        const png = Buffer.from((await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: v.width, height: Math.min(Math.max(v.height, Math.ceil(cssContentSize.height)), 5000), scale: 1 } })).data, 'base64');
        writeFileSync(join(out, id + '.png'), png); shot = createHash('sha1').update(png).digest('hex');
      }
      dump(id, st, ran, c, shot);
    }
    /* the monkeys: many random actions, one line each (what it did, and fingerprints of the state and the page).
       Each monkey can be kept inside one part of the page (`scope`, a selector) and starts by running `start`. */
    const monkeys = sc.monkeys || (sc.monkey ? [sc.monkey] : []);
    if (monkeys.length) {
      const lines = []; let n = 0;
      for (const [k, m0] of monkeys.entries()) {
        const m = { steps: 100, seed: 1 + k, tick: 7000, dayEvery: 0, scope: '', start: '', ...m0 };
        await evalJs(`__monkeySeed(${m.seed})`);
        if (m.start) { const r = await evalJs(`(async()=>{${m.start}\n})()`); if (r.threw) lines.push(`start of ${m.name || k} THREW ${r.threw}`); }
        for (let i = 0; i < m.steps; i++, n++) {
          await evalJs(`__seed(${50000 + n}); __tick(${m.tick});` + (m.dayEvery && i && i % m.dayEvery === 0 ? `__tick(${20 * 3600 * 1000});` + (m.eachDay || '') : ''));
          let ran = await evalJs(`__monkey(${JSON.stringify(m.scope)}, ${!!m.noKeys})`);
          if (String(ran.value).startsWith('RESTART') && m.start) { await evalJs(`(async()=>{${m.start}\n})()`); ran = { value: ran.value + ' → started again' }; }
          const cap = await evalJs(CAPTURE(45)); steps++;
          if (cap.threw) { lines.push(`${n}\t${ran.value || ran.threw}\tCAPTURE FAILED ${cap.threw}`); continue; }
          const c = JSON.parse(cap.value);
          if (opt('verbose')) console.log(n, m.name || '', ran.value, c.extra.waited + ' ms', c.extra.waited > 400 ? 'still changing: ' + c.extra.who : '');
          if (c.extra.waited > 4000) console.log(`\n  slow capture in ${sc.name}.${sz} step ${n} (${c.extra.waited} ms): busy=${c.extra.busy} waiting for [${c.extra.pending}] changing [${c.extra.who}]`);
          lines.push([n, m.name || k, ran.threw ? 'THREW ' + ran.threw : ran.value, 'view=' + c.extra.view, 'state=' + sha(JSON.stringify(c.state)), 'html=' + sha(c.html), c.extra.cloud ? 'cloud=' + sha(JSON.stringify([c.extra.cloud, c.extra.sync])) : '', c.extra.errors.length ? 'errors=' + JSON.stringify(c.extra.errors) : ''].join('\t'));
          if (detail && detail.name === sc.name && detail.step === n) dump(`${sc.name}.${sz}.monkey-step-${n}`, {}, ran, c, '');
        }
        if (m.after) await evalJs(`(async()=>{${m.after}\n})()`);
      }
      writeFileSync(join(out, `${sc.name}.${sz}.monkey.txt`), lines.join('\n') + '\n');
      if (sc.fixtureOut) { const r = await evalJs(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])))`);
        const keep = JSON.parse(r.value); delete keep.zika_snap_v1;   /* the in-browser snapshots would double the file */
        writeFileSync(join(here, 'snap', 'fixtures', sc.fixtureOut + '.json'), JSON.stringify(keep)); console.log('\n  fixture written: tools/snap/fixtures/' + sc.fixtureOut + '.json (' + r.value.length + ' bytes)'); }
    }
    if (coverage) { const { result } = await s('Profiler.takePreciseCoverage');
      for (const sc2 of result) { if (!sc2.url.startsWith(origin) || /hanzi-writer|vendor/.test(sc2.url)) continue;
        for (const f of sc2.functions) { if (!f.functionName) continue; seen.set(f.functionName, (seen.get(f.functionName) || false) || f.ranges[0].count > 0); } } }
    off(); await br.send('Target.closeTarget', { targetId }); await br.send('Target.disposeBrowserContext', { browserContextId });
    process.stdout.write('.');
  }

  try {
    let next = 0; const errs = [];
    await Promise.all(Array.from({ length: Math.min(jobs, work.length) }, async () => { while (next < work.length) { const [sc, sz] = work[next++]; try { await one(sc, sz); } catch (e) { errs.push(`${sc.name}.${sz}: ${e.message}`); writeFileSync(join(out, `${sc.name}.${sz}.FAILED.txt`), String(e.stack || e)); } } }));
    if (errs.length) console.log('\nscenarios that could not run:\n  ' + errs.join('\n  '));
  } finally { if (!opt('keep-open')) await br.close(); srv.close(); }
  console.log(`\n${steps} steps of ${work.length} runs recorded in ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (coverage) { const never = [...seen].filter(([, hit]) => !hit).map(([n]) => n).sort(), n = seen.size;
    writeFileSync(join(out, 'never-called.txt'), never.join('\n') + '\n');
    console.log(`coverage: ${n - never.length} of ${n} named functions were called (${(100 * (n - never.length) / n).toFixed(0)}%); the ${never.length} never called are listed in ${join(out, 'never-called.txt')}`); }
}

/* ---------- comparing two recordings ---------- */
/* Things that differ between two builds without the app behaving differently. */
const scrub = (t, loose) => {
  t = t.replace(/^screenshot: .*$/m, '').replace(/^styles-in-head: .*$/m, '');
  if (loose) t = t.replace(/^scroll-height: .*$/m, '');
  return t.replace(/v\d+(?=<\/span>)/g, 'vNN').replace(/"APP_VERSION":\d+/g, '');
};
function diff(a, b, { loose = false, max = 12 } = {}) {
  const fa = new Set(readdirSync(a).filter(f => f.endsWith('.txt'))), fb = new Set(readdirSync(b).filter(f => f.endsWith('.txt')));
  const bad = []; let same = 0, shotsDiff = [];
  for (const f of [...new Set([...fa, ...fb])].sort()) {
    if (!fa.has(f) || !fb.has(f)) { bad.push({ f, why: 'only in ' + (fa.has(f) ? a : b) }); continue; }
    const ta = readFileSync(join(a, f), 'utf8'), tb = readFileSync(join(b, f), 'utf8');
    if (f.endsWith('.monkey.txt')) {
      const la = ta.split('\n'), lb = tb.split('\n'); let i = 0; while (i < la.length && la[i] === lb[i]) i++;
      if (i < la.length || la.length !== lb.length) bad.push({ f, why: `first difference at step ${i} of ${la.length - 1}`, a: (la[i] || '').slice(0, 300), b: (lb[i] || '').slice(0, 300) }); else same++;
      continue;
    }
    if (scrub(ta, loose) !== scrub(tb, loose)) {
      const la = scrub(ta, loose).split('\n'), lb = scrub(tb, loose).split('\n'); let i = 0; while (i < la.length && la[i] === lb[i]) i++;
      let section = ''; for (let j = i; j >= 0; j--) if (/^## /.test(la[j] || '')) { section = la[j]; break; }
      bad.push({ f, why: `${section || 'header'} line ${i + 1}`, a: (la[i] || '').slice(0, 300), b: (lb[i] || '').slice(0, 300) });
    } else {
      same++;
      const sa = /^screenshot: (.*)$/m.exec(ta), sb = /^screenshot: (.*)$/m.exec(tb);
      if (sa && sb && sa[1] && sb[1] && sa[1] !== sb[1]) shotsDiff.push(f.replace(/\.txt$/, '.png'));
    }
  }
  for (const d of bad.slice(0, max)) { console.log(`\n✗ ${d.f}: ${d.why}`); if (d.a !== undefined) { console.log('    was: ' + d.a); console.log('    now: ' + d.b); } }
  if (bad.length > max) console.log(`\n… and ${bad.length - max} more: ` + bad.slice(max).map(d => d.f).join(' ').slice(0, 1500));
  if (shotsDiff.length) console.log(`\n◐ ${shotsDiff.length} screens have the same HTML and state but a different picture:\n    ` + shotsDiff.slice(0, 40).join('\n    ') + (shotsDiff.length > 40 ? `\n    … and ${shotsDiff.length - 40} more` : ''));
  console.log(`\n${same} steps identical in HTML and state, ${bad.length} differ, ${shotsDiff.length} differ only in the picture`);
  return bad.length + shotsDiff.length;
}

/* recordings are thousands of files that change on every run: they live outside the repository (which sits in a
   folder iCloud syncs), in ~/.cache/zika-snap/<name of the working copy>, or wherever ZIKA_SNAP points */
const snapDir = process.env.ZIKA_SNAP || join(homedir(), '.cache', 'zika-snap', basename(root));
const detailOpt = opt('detail');   /* --detail <scenario>:<step> writes the whole page and state for one monkey step */
const common = { only: opt('only'), size: opt('size'), shots: !opt('no-shots'), coverage: !!opt('coverage'), jobs: +opt('jobs', 8),
  detail: typeof detailOpt === 'string' ? { name: detailOpt.split(':')[0], step: +detailOpt.split(':')[1] } : null };
if (cmd === 'record') { await record(opt('dir', root), join(snapDir, 'golden'), common); process.exit(0); }
else if (cmd === 'check') { await record(opt('dir', root), join(snapDir, 'now'), common); process.exit(diff(join(snapDir, 'golden'), join(snapDir, 'now'), { loose: !!opt('loose') }) ? 1 : 0); }
else if (cmd === 'run') { await record(opt('dir', root), resolve(opt('out', join(snapDir, 'run'))), common); process.exit(0); }
else if (cmd === 'diff') process.exit(diff(resolve(argv[1]), resolve(argv[2]), { loose: !!opt('loose'), max: +opt('max', 12) }) ? 1 : 0);
else if (cmd === 'fixture') { await record(opt('dir', root), join(snapDir, 'fixture-run'), { only: '__fixture', size: 'phone', shots: false, jobs: 1 }); process.exit(0); }
else { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\s?/, '')); process.exit(cmd ? 1 : 0); }

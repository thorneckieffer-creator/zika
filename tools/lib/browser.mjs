/* What the tools that drive a real browser share: a static server for one folder, and headless Chrome spoken to
   over the DevTools protocol (no packages needed). Used by tools/snap.mjs and tools/swtest.mjs. */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve, normalize, sep } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* ---------- a static server for one folder ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.pack': 'application/octet-stream', '.svg': 'image/svg+xml' };
export function serve(dir, { port = 0, log = null } = {}) {
  dir = resolve(dir);
  return new Promise(done => {
    const srv = createServer((req, res) => {
      if (log) log.push(req.url);
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = normalize(join(dir, p));
      if (!f.startsWith(dir + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end('not found'); return; }
      const body = readFileSync(f), range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
      const head = { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      if (range) { const a = +range[1], z = range[2] ? +range[2] : body.length - 1; res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${z}/${body.length}` }); res.end(body.subarray(a, z + 1)); }
      else { res.writeHead(200, head); res.end(body); }
    });
    srv.listen(port, '127.0.0.1', () => done({ port: srv.address().port, close: () => new Promise(ok => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(ok); }) }));
  });
}

/* ---------- headless Chrome over the DevTools protocol (no packages needed) ---------- */
export async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), 'zika-snap-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-background-networking',
    '--disable-component-update', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-popup-blocking', '--disable-sync', '--disable-extensions', /* nothing leaves this machine: not the page, not a service worker, not Chrome itself */
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--disable-features=OptimizationHints,MediaRouter',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

/* 字卡 service worker
   - App shell: network-first with a 3.5 s fallback to cache, so updates arrive but the MRT still works.
   - Assets (audio packs, stroke data, icons, the pinned Firebase SDK): cache-first in a long-lived
     cache that survives app updates.
   Keep VERSION in step with APP_VERSION in index.html (tools/check.mjs verifies it). */
const VERSION = 'zika-v45';
const SHELL = VERSION;                 // replaced on every release
const ASSETS = 'zika-assets-v1';       // bump only when a file under assets/ changes
const KEEP = [SHELL, ASSETS];

const SHELL_FILES = ['./', './index.html', './manifest.webmanifest'];
const ASSET_FILES = ['./assets/hanzi-writer.min.js', './assets/strokes.json?v=2', './assets/icon-192.png', './assets/icon-512.png'];

const sameOrigin = url => url.origin === location.origin;
const isShell = url => sameOrigin(url) && (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/'));
const isAsset = url => (sameOrigin(url) && url.pathname.includes('/assets/')) || url.hostname === 'www.gstatic.com';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    /* assets are fetched only if this device does not already hold them */
    const assets = await caches.open(ASSETS);
    await Promise.all(ASSET_FILES.map(async f => {
      if (await caches.match(f)) return;
      try { await assets.add(f); } catch (err) { /* picked up on first use instead */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const assets = await caches.open(ASSETS);
    for (const k of await caches.keys()) {
      if (KEEP.includes(k)) continue;
      /* carry audio and stroke data forward from older caches (including the v35–v38
         "zika-preload" cache) before dropping them, so nothing is downloaded twice */
      try {
        const old = await caches.open(k);
        for (const req of await old.keys()) {
          if (!isAsset(new URL(req.url)) || await assets.match(req)) continue;
          const res = await old.match(req);
          if (res) await assets.put(req, res);
        }
      } catch (err) { /* a cache that cannot be read is simply dropped */ }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.cache === 'no-store') return;   /* the app's own update check must reach the network */
  const url = new URL(e.request.url);

  if (isShell(url)) {
    e.respondWith(
      Promise.race([
        fetch(e.request).then(r => {
          if (r.ok) { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); }
          return r;
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))
      ]).catch(() => caches.match(e.request).then(hit => hit || fetch(e.request)))
    );
    return;
  }

  if (!sameOrigin(url) && !isAsset(url)) return;   /* other origins go straight to the network */

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.status === 200) {
        const cp = r.clone();
        caches.open(isAsset(url) ? ASSETS : SHELL).then(c => c.put(e.request, cp));
      }
      return r;
    }))
  );
});

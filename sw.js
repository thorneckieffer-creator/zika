/* 字卡 service worker — network-first app shell with a 3.5 s fallback to cache, cache-first assets (MRT-proof) */
const VERSION = 'zika-v34';
const CORE = ['./', './index.html', './manifest.webmanifest', './assets/hanzi-writer.min.js', './assets/strokes.json', './assets/icon-192.png', './assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // network-first for the app shell so updates arrive; cache-first for immutable assets (stroke data)
  if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      Promise.race([
        fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return r; }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))
      ]).catch(() => caches.match(e.request).then(hit => hit || fetch(e.request)))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok && (url.origin === location.origin || url.hostname === 'www.gstatic.com')) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => hit))
  );
});

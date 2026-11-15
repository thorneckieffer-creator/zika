/* 字卡 service worker.

   The app shell (the page, its scripts, styles and course data: FILES below) is stored whole, per release, and
   served from that store. Opening the app never waits for the network and works offline; a release is taken
   all at once or not at all, so a page can never run with scripts from two versions.

   - Install: every file of the release is put in a new cache. A file whose content is unchanged since the release
     this device already holds is copied from it; the others are downloaded and their content is checked against
     the hash written here. If anything is missing or does not match, the install fails and the old release stays.
   - Activate: older shell caches go; audio, stroke data and the dictionary are carried forward (ASSETS).
   - The page hears about the new release (`controllerchange`, js/shell.js) and reloads itself when that is safe.
   - Assets (audio packs, stroke data, the dictionary, icons, the pinned Firebase SDK): cache-first in a
     long-lived cache that survives releases.

   VERSION is bumped by hand together with APP_VERSION in js/core.js. FILES and DIGEST are written by
   `node tools/stamp.mjs`; `node tools/check.mjs` fails when they are out of date. */
const VERSION = 'zika-v62';
/* FILES:BEGIN — written by tools/stamp.mjs, do not edit by hand */
const DIGEST = 'a6a1644a1c1c';
const FILES = [["index.html","33176df30bbb"],["manifest.webmanifest","1037668406b7"],["voice.html","88088877971f"],["css/app.css","7f1ae1cc8ed1"],["data/course.js","fa2bed407b55"],["data/words.js","a675ae803ca0"],["data/grammar.js","44727f5c38f3"],["data/components.js","023c7223a619"],["data/readings.js","63b362eface9"],["data/usage.js","adf97459240a"],["js/core.js","ca8119f4d2be"],["js/text.js","7719d8220c6b"],["js/shell.js","95f6e2f23152"],["js/audio.js","a52085008857"],["js/chars.js","f826f52546e9"],["js/sync.js","577d15fd35b3"],["js/backup.js","0e19cd7d99ef"],["js/home.js","2ad3703b7c86"],["js/review.js","fea2ba940c00"],["js/library.js","bcb2e641f28d"],["js/brain.js","beae36360e61"],["js/grammar.js","8ff96173d1c3"],["js/drills.js","29cd9c443451"],["js/listen.js","fcfec7e5d205"],["js/mtest.js","33b58eaf94ee"],["js/exam.js","1a7e4595405a"],["js/catchup.js","12a45448ff4e"],["js/settings.js","418693029db5"],["js/tone-analysis.js","c01b9163a168"],["js/tone.js","1a1a095c707a"],["js/stories.js","38ee7a84c5ca"],["js/my-words.js","6620a004afa0"],["js/usage.js","0ea87880740e"],["js/boot.js","a8ae7c2a233f"]];
/* FILES:END */
const SHELL = VERSION.replace('zika-', 'zika-shell-') + '-' + DIGEST;   // one cache per release: zika-shell-v63-<digest>
const ASSETS = 'zika-assets-v1';                        // bump only when a file under assets/ changes
const ASSET_FILES = ['./assets/hanzi-writer.min.js', './assets/qrcode.min.js', './assets/strokes.json?v=2', './assets/icon-192.png', './assets/icon-512.png'];

const BASE = new URL('./', self.location).pathname;                       // '/zika/' on GitHub Pages
const keyOf = ([path, hash]) => new URL(path + '?h=' + hash, self.location).href;
const KEYS = new Map(FILES.map(f => [BASE + f[0], keyOf(f)]));            // request path → the entry that answers it
KEYS.set(BASE, KEYS.get(BASE + 'index.html'));

const sameOrigin = url => url.origin === location.origin;
const isAsset = url => (sameOrigin(url) && url.pathname.includes('/assets/')) || url.hostname === 'www.gstatic.com';
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const older = (await caches.keys()).filter(k => k.startsWith('zika-shell-') && k !== SHELL);
    try { await Promise.all(FILES.map(async f => {
      const key = keyOf(f);
      if (await shell.match(key)) return;
      for (const name of older) { const hit = await (await caches.open(name)).match(key); if (hit) { await shell.put(key, hit); return; } }
      const res = await fetch(new URL(f[0], self.location), { cache: 'reload' });
      if (!res.ok) throw new Error(f[0] + ': ' + res.status);
      /* the host may still be handing out the previous release of this file: take it only if it is the one named here */
      const got = hex(await crypto.subtle.digest('SHA-1', await res.clone().arrayBuffer())).slice(0, f[1].length);
      if (got !== f[1]) throw new Error(f[0] + ': not this release yet');
      await shell.put(key, res);
    })); } catch (err) { await caches.delete(SHELL); throw err; }   /* nothing half-stored is left behind */
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
      if (k === SHELL || k === ASSETS) continue;
      /* carry audio and stroke data forward from older caches (the per-version caches up to v62 held some) before
         dropping them, so nothing is downloaded twice */
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

  /* the shell: from this release's cache, whatever the query string says */
  const key = sameOrigin(url) && KEYS.get(url.pathname);
  if (key) {
    e.respondWith(caches.open(SHELL).then(c => c.match(key)).then(hit => hit || fetch(e.request)));
    return;
  }

  if (!isAsset(url)) return;   /* anything else goes straight to the network */

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.status === 200) { const cp = r.clone(); caches.open(ASSETS).then(c => c.put(e.request, cp)); }
      return r;
    }))
  );
});

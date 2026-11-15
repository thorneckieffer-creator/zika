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
const DIGEST = 'e9030a10f154';
const FILES = [["index.html","043ed41bfa9f"],["manifest.webmanifest","1037668406b7"],["voice.html","88088877971f"],["css/app.css","d80361671bea"],["data/course.js","fa2bed407b55"],["data/words.js","a675ae803ca0"],["data/grammar.js","44727f5c38f3"],["data/components.js","023c7223a619"],["data/readings.js","63b362eface9"],["data/usage.js","adf97459240a"],["js/core.js","99f492923b74"],["js/text.js","95a825454be2"],["js/shell.js","c5da895670f7"],["js/audio.js","85009eb26015"],["js/chars.js","a2837e68a305"],["js/sync.js","0b50e0174c3a"],["js/backup.js","fd3d7a5613fc"],["js/home.js","225b58e8eb17"],["js/review.js","e04c825fd8c6"],["js/library.js","03be8f9666dd"],["js/brain.js","a8a768657112"],["js/grammar.js","6f8c023d06ac"],["js/drills.js","9f9315720856"],["js/listen.js","01c9fdbecd00"],["js/mtest.js","c88a4197ab38"],["js/exam.js","845123402a17"],["js/catchup.js","c8ba7e5456be"],["js/settings.js","3ccf427337c7"],["js/tone-analysis.js","b5c065d38d4e"],["js/tone.js","86b4b13ee1fd"],["js/stories.js","f73c424e4c79"],["js/my-words.js","f7b5c6610562"],["js/usage.js","db8c1cedf6b5"],["js/boot.js","3633a4bdbdf6"]];
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

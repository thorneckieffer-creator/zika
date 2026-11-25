/* 字卡 service worker.

   The app shell (the page, its scripts, styles and course data: FILES below) is stored whole, per release, and
   served from that store. Opening the app never waits for the network and works offline; a release is taken
   all at once or not at all, so a page can never run with scripts from two versions.

   - Install: every file of the release is put in a new cache. A file whose content is unchanged since the release
     this device already holds is copied from it; the others are downloaded and their content is checked against
     the hash written here. If anything is missing or does not match, the install fails and the old release stays.
   - Activate: older shell caches go; audio, stroke data and the dictionary are carried forward (ASSETS). A cache
     that a v62-or-earlier worker puts back during the hand-over goes the next time the app is opened (sweepOld).
   - The page hears about the new release (`controllerchange`, js/shell.js) and reloads itself when that is safe.
   - Assets (audio packs, stroke data, the dictionary, icons, the pinned Firebase SDK): cache-first in a
     long-lived cache that survives releases.

   VERSION is bumped by hand together with APP_VERSION in js/core.js. FILES and DIGEST are written by
   `node tools/stamp.mjs`; `node tools/check.mjs` fails when they are out of date. */
const VERSION = 'zika-v68';
/* FILES:BEGIN — written by tools/stamp.mjs, do not edit by hand */
const DIGEST = '4d770189fa7f';
const FILES = [["index.html","34cb8f51b223"],["manifest.webmanifest","1037668406b7"],["voice.html","88088877971f"],["css/app.css","d676e5858140"],["data/course.js","fa2bed407b55"],["data/words.js","a675ae803ca0"],["data/grammar.js","44727f5c38f3"],["data/components.js","d9b80bc92252"],["data/readings.js","63b362eface9"],["data/usage.js","adf97459240a"],["data/pairs.js","ba0dd6e186da"],["js/core.js","784d1e32b2b4"],["js/text.js","5dcc50c016b1"],["js/shell.js","0f490a8a8614"],["js/audio.js","bac55ea70782"],["js/chars.js","8aedf2610934"],["js/dict.js","529c404007be"],["js/sync.js","68c0a76288cb"],["js/backup.js","3e598abc2725"],["js/home.js","09b5d2b3c93b"],["js/review.js","3a2d37c94e25"],["js/library.js","25040d2922ef"],["js/brain.js","16c9a7032b59"],["js/grammar.js","df6620acc481"],["js/drills.js","a8d3a8b03f35"],["js/listen.js","fbdfe1f62aa0"],["js/mtest.js","595afee514d0"],["js/catchup.js","f5a8f1176edf"],["js/settings.js","b69ff09158ab"],["js/tone-analysis.js","1b358eb62e1a"],["js/tone.js","ce917324e1bf"],["js/stories.js","359bed16d9cb"],["js/my-words.js","9d1f3dbe99df"],["js/usage.js","c1089deadc30"],["js/boot.js","a236beb93756"]];
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
    /* all but one: the page loads the QR library as a script before it starts, and does not start without it, so a
       release that could not store it is not taken (the install is tried again the next time the app is opened) */
    if (!(await caches.match('./assets/qrcode.min.js'))) throw new Error('assets/qrcode.min.js could not be stored');
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

/* A worker from v62 or earlier names its cache zika-vNN and stores in it whatever a page asks it for. While this
   worker is taking over, that one may still be answering the reloading page, and its cache comes back after
   activate removed it. Nothing here reads it; it is removed each time the app is opened. Only that old name, and
   only from an earlier release, is swept: a `zika-shell-…` cache other than SHELL may be a newer release that is
   still being stored, and so may a zika-vNN with a higher number (the old single-file app published again as a
   way back). */
const RELEASE = +VERSION.replace(/\D+/g, '');
const sweepOld = async () => { try { for (const k of await caches.keys()) { const m = /^zika-v(\d+)$/.exec(k); if (m && +m[1] < RELEASE) await caches.delete(k); } } catch (err) { /* next time */ } };

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') e.waitUntil(sweepOld());
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

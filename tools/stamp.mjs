#!/usr/bin/env node
/* Writes into sw.js the list of files that make up the app shell, each with a hash of its content.

     node tools/stamp.mjs          rewrite the list (run after any change to the page, js/, css/ or data/)
     node tools/stamp.mjs --check  exit 1 if sw.js is out of date (tools/check.mjs does this as part of the release check)

   The service worker stores exactly these files for a release and checks each download against its hash, so a
   device takes a release whole or not at all. The shell is: index.html, the manifest, voice.html, the stylesheet,
   and every script index.html loads from js/ and data/. Files under assets/ are cached on their own schedule. */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = buf => createHash('sha1').update(buf).digest('hex').slice(0, 12);

export function shellFiles() {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const loaded = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"?]+)(?:\?[^"]*)?"/g)].map(m => m[1]).filter(f => !f.startsWith('assets/'));
  return ['index.html', 'manifest.webmanifest', 'voice.html', ...loaded];
}
export function stampBlock() {
  const files = shellFiles().map(f => [f, sha(readFileSync(join(root, f)))]);
  return `/* FILES:BEGIN — written by tools/stamp.mjs, do not edit by hand */\nconst DIGEST = '${sha(JSON.stringify(files))}';\nconst FILES = ${JSON.stringify(files)};\n/* FILES:END */`;
}
const BLOCK = /\/\* FILES:BEGIN[\s\S]*?\/\* FILES:END \*\//;
export function stampIsCurrent() { const m = BLOCK.exec(readFileSync(join(root, 'sw.js'), 'utf8')); return !!m && m[0] === stampBlock(); }

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  if (process.argv.includes('--check')) { if (!stampIsCurrent()) { console.error('sw.js: the list of shell files is out of date — run node tools/stamp.mjs'); process.exit(1); } console.log('sw.js is up to date'); }
  else { const p = join(root, 'sw.js'), s = readFileSync(p, 'utf8'); if (!BLOCK.test(s)) { console.error('sw.js: FILES block not found'); process.exit(1); }
    writeFileSync(p, s.replace(BLOCK, () => stampBlock())); console.log(`sw.js: ${shellFiles().length} shell files stamped`); }
}

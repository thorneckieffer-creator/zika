#!/usr/bin/env node
/* The case table of tools/test/rules-cases.mjs against the OFFICIAL Realtime Database emulator.

   WRITTEN BUT NEVER RUN: the machine this was written on has no Java, which the emulator
   needs. Expect to fix small things the first time. The commands are in firebase/README.md;
   in short, from the firebase/ folder:

     npx --prefix ../tools/test/.cross firebase emulators:exec --only database --project demo-zika \
         "node ../tools/test/rules-emulator.mjs"

   It talks only to the emulator on this machine (the project id starts with demo-, which the
   Firebase tools never send to a real project). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CASES, BASE, NOW } from './rules-cases.mjs';

const require = createRequire(new URL('./.cross/', import.meta.url));
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { ref, get, set, update } = require('firebase/database');

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) { console.error('Run this through `firebase emulators:exec` (see the top of this file).'); process.exit(2); }

/* The cases are written around a fixed NOW; the emulator uses the real clock. Every number
   within a day of NOW is moved by the same distance, so "one minute ago" stays one minute ago.
   {'.sv': 'timestamp'} is left as it is: the emulator fills it in, as the service does. */
const shift = Date.now() - NOW;
const move = v => {
  if (typeof v === 'number') return Math.abs(v - NOW) < 86400000 ? v + shift : v;
  if (v === null || typeof v !== 'object') return v;
  const o = {}; for (const k of Object.keys(v)) o[k] = move(v[k]); return o;
};

const env = await initializeTestEnvironment({
  projectId: 'demo-zika',
  database: { rules: readFileSync(new URL('../../firebase/database.rules.json', import.meta.url), 'utf8') },
});

let wrong = 0;
for (const c of CASES) {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(ctx => set(ref(ctx.database()), move(c.data || BASE)));
  const db = (c.auth ? env.authenticatedContext(c.auth.uid) : env.unauthenticatedContext()).database();
  let allowed = true;
  try {
    if (c.op === 'read') await get(c.path ? ref(db, c.path) : ref(db));
    else if (c.op === 'set') await set(ref(db, c.path), move(c.value));
    else await update(ref(db), move(c.map));
  } catch (e) {
    if (!/permission[_ ]denied/i.test(String(e && (e.code || '') + ' ' + (e.message || '')))) { console.log('  ERROR     ' + c.name + '\n     ' + (e && e.message)); wrong++; continue; }
    allowed = false;
  }
  if (allowed !== c.allow) { wrong++; console.log('  DISAGREE  ' + c.name + '\n     expected ' + c.allow + ' · emulator ' + allowed); }
}
await env.cleanup();
console.log(wrong ? wrong + ' of ' + CASES.length + ' cases differ on the emulator' : 'the emulator gives the expected answer on all ' + CASES.length + ' cases');
process.exit(wrong ? 1 : 0);

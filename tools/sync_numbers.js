#!/usr/bin/env node
/* What sync costs, whole deck against by record:   node tools/sync_numbers.js
   It builds a deck of the size the app's content gives (the words and grammar points of the course, every one of
   them studied, 180 days of history), then measures with the real engine (js/sync-records.js) against the in-memory cloud
   of the tests. Nothing here touches the network. The figures are JSON bytes as the database stores and sends
   them; what the transport adds (TLS, the websocket envelope) is added as stated assumptions at the end. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const sy = require('../js/sync-records.js');
const { Cloud, rng32, clone, memStore, tick } = require('./test/helpers/cloud.js');
const { makeDeck, dayOf, DAYMS } = require('./test/helpers/deck.js');

const bytes = v => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
const kb = n => (n / 1024).toFixed(n < 10240 ? 2 : 0) + ' KB';
const row = (a, b) => console.log('  ' + String(a).padEnd(62) + b);

/* the course data: lines of index.html today, files under data/ once the app is split up */
function content() {
  const root = path.join(__dirname, '..'), lines = [];
  for (const f of ['index.html', 'data/words.js', 'data/grammar.js']) if (fs.existsSync(path.join(root, f))) lines.push(...fs.readFileSync(path.join(root, f), 'utf8').split('\n'));
  const grab = n => { const l = lines.find(x => x.startsWith('const ' + n + ' = ')); if (!l) throw new Error(n + ' not found in index.html or data/'); return JSON.parse(l.slice(l.indexOf('=') + 1).trim().replace(/;$/, '')); };
  const W = grab('WORDS'), G = grab('GRAMMAR'), gids = [];
  for (const l in G) for (const p of G[l]) gids.push(p.id);
  return { words: W.map(w => ({ id: w.id, l: w.l, t: w.t })), gids };
}

async function measure(label, words, gids) {
  const T0 = 1800000000000, r = rng32(42);
  const S = makeDeck({ rng: r, now: T0, words, grammar: gids, days: 180, started: 1, my: 150 });
  const cards = Object.keys(S.cards).length;
  console.log('\n' + label);
  row('words / grammar points / cards', words.length + ' / ' + gids.length + ' / ' + cards + '  (+ ' + Object.keys(S.my.c).length + ' My words cards)');

  /* ---- today: the whole deck, one value ---- */
  const json = JSON.stringify(S);
  const conf = {}; for (const k in S.conf.words) conf[k.replace(/[.#$\[\]\/]/g, '_')] = S.conf.words[k];
  const payload = { v: 18, json, device: 'iPad', device_id: 'k3j9x2ab', synced_at: T0, bytes: json.length, conf, hard_list: S.hard.slice(), summary: { cards, started: cards, due: 120, streak: 30 } };
  const whole = bytes(payload);
  const part = {}; for (const k in S) part[k] = bytes(S[k]);
  console.log('  whole deck (today)');
  row('the deck as JSON (localStorage, and the `json` field)', kb(bytes(json)));
  row('  of which cards / hist / conf / us / exam+mtest / the rest', [part.cards, part.hist, part.conf, part.us, part.exam + part.mtest].map(kb).join(' / ') + ' / ' + kb(bytes(json) - part.cards - part.hist - part.conf - part.us - part.exam - part.mtest));
  row('one save = one write of rooms/<code>/study_state', kb(whole) + '  (the string is escaped inside JSON, plus the conf mirror)');
  row('stored per learner', kb(whole));

  /* ---- by record ---- */
  const cloud = new Cloud({ rng: r, dup: 0, time: T0 });
  const dev = (id, state) => { const d = { id, S: state, store: memStore(), conn: cloud.connect({}) }; d.conn.everOnline = true; d.E = sy.syCreate({ state: () => d.S, store: d.store, adapter: d.conn, node: id, now: () => cloud.time, timers: false }); return d; };
  const A = dev('k3j9x2ab', clone(S)), B = dev('p7m2q9zz', { cards: {}, settings: {}, log: {}, intro: {}, hist: { d: [], s: [] } });
  const settle = async devs => { for (let i = 0; i < 400; i++) { let did = false; for (const d of devs) { if (d.conn.catchUp()) did = true; while (d.conn.send()) did = true; while (d.conn.deliver()) did = true; await tick(); if (sy.syPump(d.E)) did = true; sy.syFlush(d.E, true); await tick(); if (d.conn.writes.length) did = true; } if (!did) return; } throw new Error('did not settle'); };

  let t = process.hrtime.bigint();
  sy.syStart(A.E, { uid: 'u1' }); A.conn.catchUp();
  const joinMs = Number(process.hrtime.bigint() - t) / 1e6;
  await settle([A]);
  const recs = cloud.node('users/u1').rec, n = Object.keys(recs).length;
  const stored = bytes(recs), first = cloud.up;
  const by = {}; for (const k in recs) { const c = k.slice(0, k.indexOf('~')); by[c] = by[c] || [0, 0]; by[c][0]++; by[c][1] += bytes(k) + bytes(recs[k]) + 4; }
  console.log('  by record');
  row('records', n + '  (' + Object.keys(by).sort((a, b) => by[b][1] - by[a][1]).slice(0, 7).map(c => c + ' ' + by[c][0]).join(', ') + ', …)');
  row('stored per learner (JSON export of users/<uid>/rec)', kb(stored) + '  (' + Object.keys(by).sort((a, b) => by[b][1] - by[a][1]).slice(0, 5).map(c => c + ' ' + kb(by[c][1])).join(', ') + ')');
  row('average card record (key + value)', (by.c[1] / by.c[0]).toFixed(0) + ' B   against ' + (part.cards / cards).toFixed(0) + ' B per card in the whole-deck JSON');
  row('first upload of the deck (once per account)', kb(first) + '  in ' + cloud.writes + ' updates');

  cloud.down = 0;
  sy.syStart(B.E, { uid: 'u1' }); await settle([A, B]);
  row('first download on a new device (once per device)', kb(cloud.down));
  assert(JSON.stringify(Object.keys(B.S.cards).sort()) === JSON.stringify(Object.keys(A.S.cards).sort()), 'B did not get the deck');

  /* restart the first device once: what it wrote while it was listening (here, the whole first upload) comes back once */
  const restart = old => { const d = dev(old.id, old.S); d.store = old.store; d.E = sy.syCreate({ state: () => d.S, store: old.store, adapter: d.conn, node: old.id, now: () => cloud.time, timers: false }); old.conn.kill(); sy.syStart(d.E, { uid: 'u1' }); return d; };
  cloud.time += 600000;
  let A1 = restart(A); await settle([A1, B]);
  row('the uploading device\'s next start (its upload comes back once)', kb(A1.conn.down));

  /* reviews, as rate() makes them: the card, the day's counters, the sibling claim, sometimes the up-next list */
  const ids = Object.keys(A.S.cards).filter(k => A.S.cards[k].st);
  const N = 200; let up = 0, ops = 0, diffMs = 0, saveMs = 0;
  cloud.time += 3 * 3600000;
  const a0 = A1.conn.down, b0 = B.conn.down;
  { const A = A1;
  for (let i = 0; i < N; i++) {
    cloud.time += 9000;
    const cid = ids[Math.floor(r() * ids.length)], wid = cid.split(':')[0], c = A.S.cards[cid], now = cloud.time, today = dayOf(now);
    A.S.log[today] = A.S.log[today] || { rev: 0, new: 0 }; A.S.log[today].rev++;
    c.reps++; c.last = now; c.S = c.S * (1.3 + r()); c.D = 1 + r() * 9; c.due = now + Math.round(c.S) * DAYMS; c.days++;
    const m = A.S.sib[today] || (A.S.sib[today] = {}); if (!m[wid]) m[wid] = cid;
    const u0 = cloud.up;
    t = process.hrtime.bigint(); ops += sy.syDiff(A.E, A.S); diffMs += Number(process.hrtime.bigint() - t) / 1e6;
    t = process.hrtime.bigint(); sy.sySave(A.E); saveMs += Number(process.hrtime.bigint() - t) / 1e6;
    await settle([A, B]);
    up += cloud.up - u0;
  } }
  const perUp = up / N, echo = (A1.conn.down - a0) / N, other = (B.conn.down - b0) / N;
  row('one review: records changed', (ops / N).toFixed(2) + '  (the card, the day counter, and the sibling claim the first time a word comes up)');
  row('one review: written', perUp.toFixed(0) + ' B   against ' + kb(whole) + ' today  (' + (whole / perUp).toFixed(0) + '× less)');
  row('one review: downloaded by each other device', other.toFixed(0) + ' B   against ' + kb(whole) + ' today  (while it is open, or when it next starts)');
  row('one review: sent back to the device that made it', echo.toFixed(0) + ' B   (the records return with the server\'s time on them; assumed whole)');
  cloud.time += 600000;
  const A2 = restart(A1); await settle([A2, B]);
  const back = A2.conn.down / N;
  row('one review: fetched again at that device\'s next start', back.toFixed(0) + ' B   (' + kb(A2.conn.down) + ' for the ' + N + ' reviews; see "The cursor" in docs/sync.md)');
  cloud.time += 600000;
  const A3 = restart(A2); await settle([A3, B]);
  row('a start with nothing new', A3.conn.down + ' B   against ' + kb(whole) + ' today');
  row('on the device: the shadow in localStorage', kb(A.store.size()) + '   beside the deck\'s ' + kb(bytes(JSON.stringify(A.S))));
  row('on the device: time per save (diff + storing the shadow)', (diffMs / N).toFixed(1) + ' ms + ' + (saveMs / N).toFixed(1) + ' ms;  first sync of the whole deck ' + joinMs.toFixed(0) + ' ms');
  return { whole, stored, perUp, other, echo, back, first: bytes(recs), n };
}
function assert(ok, msg) { if (!ok) throw new Error(msg); }

/* ---- what the free plan carries ---- */
function capacity(label, m) {
  const GB = 1024 * 1024 * 1024;
  /* the model learner — change these to taste, the arithmetic is printed */
  const U = { reviews: 150, opens: 6, devices: 2, live: 0.1, newDevicePerMonth: 1 / 6, tls: 5000, envelope: 60, days: 30 };
  console.log('\n' + label + ' — the free plan: 1 GB stored, 10 GB downloaded a month, 100 connections at once');
  console.log('  model learner: ' + U.reviews + ' reviews a day, opens the app ' + U.opens + '× a day over ' + U.devices + ' devices, ' + (U.live * 100) + '% of reviews made while the other device is also open,');
  console.log('  a new or reset device every ' + (1 / U.newDevicePerMonth) + ' months; each open costs about ' + U.tls + ' B of TLS and handshake, each message about ' + U.envelope + ' B of envelope.');
  const openOver = U.opens * U.days * U.tls;
  const wd = U.opens * U.days * m.whole + U.reviews * U.live * U.days * (m.whole + U.envelope) + openOver;
  /* a review comes down: back to its writer, again at the writer's next start, and once to each other device */
  const perRev = m.echo + m.back + (U.devices - 1) * m.other + (U.devices + 1) * U.envelope;
  const rd = U.reviews * U.days * perRev + U.newDevicePerMonth * m.first + openOver;
  row('whole deck: downloaded per learner-month', (wd / 1048576).toFixed(1) + ' MB = ' + U.opens + '×' + U.days + ' opens × ' + kb(m.whole) + ' + ' + (U.reviews * U.live * U.days) + ' live reviews × ' + kb(m.whole) + ' + overhead');
  row('  → learners on 10 GB a month', Math.floor(10 * GB / wd));
  row('by record: downloaded per learner-month', (rd / 1048576).toFixed(2) + ' MB = ' + (U.reviews * U.days) + ' reviews × ' + perRev.toFixed(0) + ' B (writer ' + m.echo.toFixed(0) + ' + its next start ' + m.back.toFixed(0) + ' + other device ' + m.other.toFixed(0) + ' + envelopes) + ' + U.newDevicePerMonth.toFixed(2) + ' × ' + kb(m.first) + ' + overhead');
  row('  → learners on 10 GB a month', Math.floor(10 * GB / rd) + '   (of that, ' + (openOver / 1048576).toFixed(2) + ' MB is the ' + (U.opens * U.days) + ' connections themselves)');
  row('whole deck: stored → learners on 1 GB', Math.floor(GB / m.whole));
  row('by record: stored → learners on 1 GB', Math.floor(GB / m.stored) + '   (' + kb(m.stored) + ' each; grows about ' + kb(365 * 2 * 60) + ' a year per learner in day counters)');
  row('100 connections at once', 'if p of the learners are connected at the busiest moment: 100 / p.  p = 5% → 2000,  p = 12.5% (everyone studies 30 min in the same 4 h) → 800');
  const rec = Math.min(Math.floor(10 * GB / rd), Math.floor(GB / m.stored)), old = Math.min(Math.floor(10 * GB / wd), Math.floor(GB / m.whole));
  row('the binding limit', 'whole deck: ' + old + ' learners (downloads).   by record: ' + rec + ' by bytes (storage), or what 100 connections carry (800 to 2000), whichever is lower');
}

(async () => {
  const { words, gids } = content();
  const byBook = {}; words.forEach(w => { const b = w.l <= 15 ? 1 : w.l <= 30 ? 2 : 3; byBook[b] = (byBook[b] || 0) + 1; });
  console.log('The course holds ' + words.length + ' words (Book 1: ' + byBook[1] + ', Book 2: ' + byBook[2] + ', Book 3 so far: ' + byBook[3] + ' in ' + (Math.max(...words.map(w => w.l)) - 30) + ' lessons) and ' + gids.length + ' grammar points.');
  const now = await measure('A. The deck the file gives today: every word and grammar point studied, 180 days of history, 150 My words', words, gids);
  capacity('A', now);
  /* Book 3 has 12 lessons; the file holds 4. At the same words and grammar points per lesson: */
  const l3 = Math.max(...words.map(w => w.l)) - 30, w3 = byBook[3] / l3, g3 = gids.filter(g => +g.slice(1).split('-')[0] > 30).length / l3;
  const moreW = Math.round(w3 * (12 - l3)), moreG = Math.round(g3 * (12 - l3));
  const words2 = words.concat(Array.from({ length: moreW }, (x, i) => ({ id: 'w' + (words.length + i + 1), l: 35 + Math.floor(i / w3), t: '字' + i })));
  const gids2 = gids.concat(Array.from({ length: moreG }, (x, i) => 'n' + (35 + Math.floor(i / g3)) + '-' + (1 + i % 8)));
  const full = await measure('B. The same with Book 3 complete (12 lessons at the rate of its first ' + l3 + ': +' + moreW + ' words, +' + moreG + ' grammar points — an estimate)', words2, gids2);
  capacity('B', full);
})().catch(e => { console.error(e); process.exit(1); });

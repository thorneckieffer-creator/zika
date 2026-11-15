/* The many-device run for js/sync-records.js.   node --test tools/test/*.test.js
   More seeds, or one seed again:   SIM_SEEDS=2000 node --test tools/test/sim.test.js
                                    SIM_FIRST=1234 SIM_SEEDS=1 node --test tools/test/sim.test.js

   Each seed is one story: two to four devices (and sometimes one that turns up later, empty) share a deck. Their
   clocks disagree — by seconds, by hours, or by days in either direction. They study, undo, add and drop lessons,
   edit lists, settings and My words; they go offline and come back; the page is reloaded; the network delivers
   writes, events and acknowledgements one at a time in random order, some twice, and drops what was on its way to
   a device that went offline. Even seeds run against a database with the newer-only rule, odd seeds against one
   that takes whatever arrives.

   At the end every device comes online and the run is checked:
   1. every device holds the same deck, and so does a new device that joins from the cloud alone;
   2. every day's counters are exactly the reviews that were made (minus the ones undone) — none lost, none doubled;
   3. no card ends in a state that some device had already moved on from: what is lost is only ever one side of two
      edits to the same card made without knowledge of each other (docs/sync.md, "Cards");
   4. device-local settings stayed on their device, and nothing is left unsent or parked.
   A failure names its seed. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRig, emptyState, normal, firstDiff, sortKeys, sy, clone, dayOf, tick } = require('./helpers/rig.js');
const { rng32 } = require('./helpers/cloud.js');
const { makeDeck, DAYMS } = require('./helpers/deck.js');

const SEEDS = +process.env.SIM_SEEDS || 300, FIRST = +process.env.SIM_FIRST || 1, STEPS = +process.env.SIM_STEPS || 450;
const T0 = 1800000000000;
const WORDS = Array.from({ length: 46 }, (x, i) => 'w' + (i + 1));

/* ---- what the app does to S, in short (the real thing: rate, doUndo, trackWord, myRate … in index.html) ---- */
function actions(x) {
  const { r, int, pick, bump } = x;
  const started = c => !!c && c.st !== undefined;
  const fresh = now => ({ st: 'learn', S: 0.4 + r(), D: 4 + r() * 3, due: now + 60000, last: now, reps: 1, lapses: 0, days: 0 });
  const again = (c, now) => { c.reps++; c.last = now; c.S = c.S * (1.2 + r() * 1.5); c.D = 1 + r() * 9; c.days = (c.days || 0) + 1; if (r() < 0.12) { c.st = 'relearn'; c.lapses++; } else c.st = 'rev'; c.due = now + Math.round(c.S) * DAYMS; if (c.st === 'rev' && c.S >= 45) { if (!c.mastAt) c.mastAt = now; } else delete c.mastAt; };
  const myDeck = S => {
    if (!S.my || typeof S.my !== 'object') S.my = { n: 1, w: {}, c: {}, intro: {}, log: {} };
    const d = S.my; d.w = d.w || {}; d.c = d.c || {}; d.intro = d.intro || {}; d.log = d.log || {}; d.n = d.n || 1;
    if (!Array.isArray(d.tp)) d.tp = ['Food', 'Travel', 'Work'].map((n, i) => ({ id: 't' + (i + 1), n }));
    if (!d.tn) d.tn = 1 + d.tp.reduce((m, t) => Math.max(m, +String(t.id).slice(1) || 0), 3);
    return d;
  };
  const A = {
    review(d) {
      const S = d.S, ids = Object.keys(S.cards); if (!ids.length) return;
      const cid = pick(ids), wid = cid.split(':')[0], now = d.now(), today = dayOf(now);
      const u = { cid, card: clone(S.cards[cid] || {}), log: clone(S.log), intro: clone(S.intro), pick: (S.pick || []).slice(), bumps: [] };
      S.log[today] = S.log[today] || { rev: 0, new: 0 };
      const c = S.cards[cid];
      if (!started(c)) {
        if (!['rec', 'prod'].some(m => started(S.cards[wid + ':' + m]))) { S.intro[today] = (S.intro[today] || 0) + 1; u.bumps.push([today, 'i']); if (S.pick) S.pick = S.pick.filter(z => z !== wid); }
        S.cards[cid] = fresh(now); S.log[today].new++; u.bumps.push([today, 'n']);
      } else { again(c, now); S.log[today].rev++; u.bumps.push([today, 'r']); }
      S.sib = S.sib || {}; const m = S.sib[today] || (S.sib[today] = {}); if (!m[wid]) m[wid] = cid;
      for (const b of u.bumps) bump(b[0], b[1], 1);
      d.undo.push(u); if (d.undo.length > 25) d.undo.shift();
    },
    undo(d) {       /* doUndo(): the card, the log, the intake and the up-next list go back to how they were */
      const u = d.undo.pop(); if (!u) return;
      d.S.cards[u.cid] = Object.keys(u.card).length ? u.card : {}; d.S.log = u.log; d.S.intro = u.intro; d.S.pick = u.pick;
      for (const b of u.bumps) bump(b[0], b[1], -1);
    },
    track(d) { for (let i = int(1, 3); i > 0; i--) { const w = pick(WORDS); for (const m of ['rec', 'prod']) if (!d.S.cards[w + ':' + m]) d.S.cards[w + ':' + m] = {}; if (r() < 0.6 && !d.S.pick.includes(w)) d.S.pick.push(w); } },
    untrack(d) { const w = pick(WORDS); delete d.S.cards[w + ':rec']; delete d.S.cards[w + ':prod']; },
    known(d) { const w = pick(WORDS), now = d.now(); d.S.pick = d.S.pick.filter(z => z !== w); for (const m of ['rec', 'prod']) d.S.cards[w + ':' + m] = { st: 'rev', S: 21, D: 4, due: now + 21 * DAYMS, last: now, reps: 1, lapses: 0, days: 99, known: 1 }; },
    reset(d) { const ids = Object.keys(d.S.cards).filter(k => started(d.S.cards[k])); if (ids.length) d.S.cards[pick(ids)] = {}; },
    hard(d) { const S = d.S; if (S.hard.length && r() < 0.45) { const w = pick(S.hard); S.hard = S.hard.filter(z => z !== w); } else { const w = pick(WORDS); if (!S.hard.includes(w)) S.hard.push(w); } },
    pick(d) { const S = d.S, w = pick(WORDS), i = S.pick.indexOf(w); if (i > -1) S.pick.splice(i, 1); else S.pick.push(w); },
    top(d) { const S = d.S; if (S.pick.length > 1) { const w = S.pick.splice(int(0, S.pick.length - 1), 1)[0]; S.pick.unshift(w); } },
    clear(d) { d.S.pick = []; },
    setting(d) { const s = d.S.settings, k = pick(['newPerDay', 'retention', 'curLesson', 'userName', 'palette', 'modes']); if (k === 'modes') s.modes = { rec: true, prod: r() < 0.5 }; else if (r() < 0.08) delete s[k]; else s[k] = k === 'userName' ? 'name' + int(1, 9) : int(1, 30); },
    local(d) { d.S.settings.theme = d.theme = 't' + int(1, 99); if (r() < 0.3) d.S.settings.voiceName = d.voice = 'v' + int(1, 99); },
    flag(d) { d.S.settings['_v9' + int(0, 3)] = 1; },
    tally(d) {
      const S = d.S, w = pick(WORDS);
      if (r() < 0.4) { S.gram = S.gram || {}; const g = S.gram[pick(x.gids)] || (S.gram[pick(x.gids)] = { n: 0, ok: 0 }); g.n++; if (r() < 0.6) g.ok++; }
      if (r() < 0.4) { S.us = S.us || {}; const u = S.us[w] || [0, 0, 0]; u[r() < 0.6 ? 0 : 1]++; u[2] = r() < 0.6 ? 1 : 0; S.us[w] = u; }
      if (r() < 0.2) { S.cf = S.cf || {}; const k = pick(['dian', 'ba', 'a/b']), c = S.cf[k] || (S.cf[k] = { n: 0, ok: 0 }); c.n++; c.last = d.now(); }
      if (r() < 0.2) { S.listen = S.listen || {}; const l = S.listen[int(1, 4)] || (S.listen[int(1, 4)] = { n: 0, ok: 0 }); l.n++; }
      if (r() < 0.2) { S.read = S.read || {}; const k = int(31, 33) + ':' + int(0, 2); S.read[k] = (S.read[k] || 0) + 1; }
    },
    hist(d) {      /* takeSnapshot() */
      const S = d.S, today = dayOf(d.now()); let s = ''; for (let i = 0; i < 40; i++) s += r() < 0.7 ? '0' : int(1, 4);
      if (!S.hist) S.hist = { d: [], s: [] };
      const n = S.hist.d.length;
      if (n && S.hist.d[n - 1] === today) S.hist.s[n - 1] = s; else { S.hist.d.push(today); S.hist.s.push(s); }
    },
    exam(d) {
      const S = d.S; S.exam = S.exam || { lo: 1, hi: 3, date: '2027-02-01', name: '大考試', run: null };
      if (!S.exam.run) S.exam.run = { ids: WORDS.slice(0, 6), i: 0, label: 'all', hist: [] };
      else if (r() < 0.15) S.exam.run = null; else { S.exam.run.hist.push({ wid: S.exam.run.ids[S.exam.run.i % 6], prev: null }); S.exam.run.i++; }
      if (r() < 0.1) S.exam.date = '2027-02-' + String(int(10, 28));
    },
    mtest(d) {
      const S = d.S; S.mtest = S.mtest || { lo: 9, hi: 21, res: {}, order: WORDS.slice(0, 12), i: 0, started: d.now() };
      const w = pick(S.mtest.order); if (r() < 0.2) delete S.mtest.res[w]; else { S.mtest.res[w] = pick(['m', 'l', 'h']); S.mtest.i++; }
    },
    tone(d) {      /* tcState() and one graded word */
      const S = d.S; if (!S.tone || S.tone.v !== 2) S.tone = { v: 2, n: 0, by: {}, conf: {}, pair: {}, w: {} };
      const w = pick(WORDS), rec = S.tone.w[w] || [0, 0]; rec[0]++; rec[1] = Math.max(rec[1], int(40, 100)); S.tone.w[w] = rec; S.tone.n++;
      const t = int(1, 4); S.tone.by[t] = S.tone.by[t] || [0, 0]; S.tone.by[t][1]++;
      if (!S.vp || S.vp.v !== 2) S.vp = { v: 2, n: 0, sum: 0, sq: 0 }; S.vp.n += 10; S.vp.sum += 140 + r(); S.vp.sq += 2000 + r();
    },
    myAdd(d) { const my = myDeck(d.S), num = d.idx * 1000 + (d.myN++), id = 'u' + num; my.w[id] = { t: '詞' + num, p: 'cí', m: 'word ' + num, at: d.now() }; if (r() < 0.5) my.w[id].g = [pick(my.tp.length ? my.tp : [{ id: 't1' }]).id]; my.c[id + ':rec'] = {}; if (!(my.n > num)) my.n = num + 1; },
    myEdit(d) { const my = myDeck(d.S), ids = Object.keys(my.w); if (!ids.length) return; const w = my.w[pick(ids)]; if (r() < 0.6) w.m = 'meaning ' + int(1, 999); else if (my.tp.length && r() < 0.7) w.g = [pick(my.tp).id]; else delete w.g; },
    myDelete(d) { const my = myDeck(d.S), ids = Object.keys(my.w); if (!ids.length) return; const id = pick(ids); delete my.w[id]; for (const k in my.c) if (k.split(':')[0] === id) delete my.c[k]; },
    myReview(d) {  /* myRate() */
      const my = myDeck(d.S), ids = Object.keys(my.c); if (!ids.length) return;
      const cid = pick(ids), now = d.now(), today = dayOf(now), c = my.c[cid];
      if (!started(c)) { my.intro[today] = (my.intro[today] || 0) + 1; bump(today, 'mi', 1); my.c[cid] = fresh(now); } else again(c, now);
      my.log[today] = (my.log[today] || 0) + 1; bump(today, 'ml', 1);
    },
    topicAdd(d) { const my = myDeck(d.S), num = d.idx * 100 + (d.tN++); my.tp.push({ id: 't' + num, n: 'topic ' + num }); if (!(my.tn > num)) my.tn = num + 1; },
    topicName(d) { const my = myDeck(d.S); if (my.tp.length) pick(my.tp).n = 'renamed ' + int(1, 999); },
    topicDelete(d) { const my = myDeck(d.S); if (!my.tp.length) return; const id = pick(my.tp).id; my.tp.splice(my.tp.findIndex(t => t.id === id), 1); for (const k in my.w) { const w = my.w[k]; if (w.g && w.g.includes(id)) { w.g = w.g.filter(z => z !== id); if (!w.g.length) delete w.g; } } }
  };
  const table = [[30, 'review'], [5, 'undo'], [4, 'track'], [2, 'untrack'], [2.5, 'known'], [2, 'reset'], [4, 'hard'], [4, 'pick'], [2, 'top'], [0.3, 'clear'], [4, 'setting'], [2, 'local'], [0.5, 'flag'],
    [4, 'tally'], [1.5, 'hist'], [2, 'exam'], [2, 'mtest'], [1.5, 'tone'], [3, 'myAdd'], [2, 'myEdit'], [1, 'myDelete'], [7, 'myReview'], [1.2, 'topicAdd'], [1, 'topicName'], [0.6, 'topicDelete']];
  const sum = table.reduce((n, t) => n + t[0], 0);
  return () => { let v = r() * sum; for (const t of table) { v -= t[0]; if (v < 0) return [t[1], A[t[1]]]; } return ['review', A.review]; };
}

/* what the app does to S when it starts: old sibling claims go, today's snapshot is taken */
function housekeeping(d, x) {
  const S = d.S, keep = [dayOf(d.now()), dayOf(d.now() - DAYMS)];
  if (S.sib) for (const k in S.sib) if (!keep.includes(k)) delete S.sib[k];
  if (x.r() < 0.5) { const today = dayOf(d.now()); S.hist = S.hist || { d: [], s: [] }; const n = S.hist.d.length; if (!(n && S.hist.d[n - 1] === today)) { S.hist.d.push(today); S.hist.s.push('0'.repeat(40)); } }
}

async function runSim(seed) {
  const r = rng32(seed * 2654435761 + 17), int = (a, b) => a + Math.floor(r() * (b - a + 1)), pick = a => a[Math.floor(r() * a.length)];
  const rig = makeRig({ rng: r, rule: seed % 2 === 0, dup: 0.04 + r() * 0.2, time: T0 });
  const base = makeDeck({ rng: rng32(seed + 99), now: T0, words: 36, grammar: 6, days: 5, my: 4, started: 0.5 });
  base.hard = ['w1', 'w2']; base.settings.theme = 'base';
  const truth = sy.syCtRead(base), stats = { ops: 0, lost: 0, reloads: 0, offline: 0, refused: 0 };
  const bump = (day, f, n) => { (truth[day] || (truth[day] = {}))[f] = ((truth[day] || {})[f] || 0) + n; };
  const x = { r, int, pick, bump, gids: Object.keys(base.cards).filter(k => k[0] === 'g').map(k => k.slice(2)) };
  const next = actions(x);
  const child = new Set(), authored = {};
  const skew = () => { const v = r(); return v < 0.45 ? int(-300, 300) * 1000 : v < 0.65 ? int(-12, 12) * 3600000 : v < 0.85 ? int(2, 30) * DAYMS + int(0, 9999) : -int(1, 10) * DAYMS; };
  const add = (S, i) => { const d = rig.device('dev' + String.fromCharCode(97 + i).repeat(4) + i, S, { skew: skew(), knowsServerTime: r() < 0.6 }); d.idx = i + 1; d.myN = 1; d.tN = 1; d.theme = S.settings.theme; d.voice = S.settings.voiceName; return d; };

  /* ---- the oracle for cards: which version each edit was made on top of ---- */
  const stamps = d => { const o = {}; for (const k in d.E.sh) if (k.charCodeAt(0) === 99 || k.startsWith('mc~')) o[k] = d.E.sh[k].slice(12); return o; };
  const content = (d, key) => { const cid = key.slice(key.indexOf('~') + 1), m = key[0] === 'c' ? d.S.cards : ((d.S.my || {}).c || {}); return cid in m ? JSON.stringify(sortKeys(m[cid])) : '∅'; };
  const act = (d, fn) => {
    const before = stamps(d);
    fn(d);
    d.save();
    const after = stamps(d);
    for (const k in after) if (after[k] !== before[k]) { if (before[k]) child.add(k + '|' + before[k]); (authored[k] || (authored[k] = {}))[d.id] = content(d, k); }
  };

  /* ---- start: the devices that already hold the deck (and perhaps an empty one) all join at once ---- */
  const n0 = 2 + int(0, 2);
  for (let i = 0; i < n0; i++) add(i > 0 && r() < 0.2 ? Object.assign(emptyState(), { hard: [], pick: [] }) : clone(base), i);
  for (const d of rig.devs) rig.start(d);
  for (let i = 0; i < 300; i++) { const d = pick(rig.devs), a = r(); if (a < 0.3) d.conn.catchUp(); else if (a < 0.6) d.conn.send(); else d.conn.deliver(); if (r() < 0.3) { sy.syPump(d.E); sy.syFlush(d.E); } if (i % 10 === 0) await tick(); }
  await rig.settle();
  for (const d of rig.devs) assert.ok(d.E.joined, 'a device did not join');

  /* ---- the story ---- */
  let late = 0;
  for (let step = 0; step < STEPS; step++) {
    rig.cloud.time += Math.floor(r() * r() * r() * 40 * 60000);
    const v = r(), d = pick(rig.devs);
    if (v < 0.5) { if (d.E.joined) { const [name, fn] = next(); act(d, fn); stats.ops++; stats[name] = (stats[name] || 0) + 1; } }
    else if (v < 0.56) { d.conn.setOnline(!d.conn.online); stats.offline++; }
    else if (v < 0.58) { housekeeping(d, x); rig.reload(d); stats.reloads++; }
    else if (v < 0.586 && !late && step > STEPS / 4) { late = 1; const nd = add(Object.assign(emptyState(), { hard: [], pick: [] }), rig.devs.length); rig.start(nd); }
    else for (let i = int(1, 6); i > 0; i--) { const c = pick(rig.devs), a = r(); if (a < 0.2) c.conn.catchUp(); else if (a < 0.55) c.conn.send(); else c.conn.deliver(); }
    const e = pick(rig.devs);
    if (r() < 0.5) sy.syPump(e.E);
    if (r() < 0.5) sy.syFlush(e.E, r() < 0.2);
    await null; await null; await null;
    if (step % 25 === 0) await tick();
  }

  /* ---- everyone comes back ---- */
  for (const d of rig.devs) d.conn.setOnline(true);
  await rig.settle();
  for (let round = 0; round < 2; round++) { rig.cloud.time += 600000; for (const d of rig.devs) rig.reload(d); await rig.settle(); }
  for (const d of rig.devs) { d.save(); stats.lost += d.lost.length; }
  await rig.settle();
  stats.refused = rig.cloud.refused;

  /* 4. nothing unsent, nothing parked */
  for (const d of rig.devs) { assert.deepEqual(rig.pending(d), [], d.id + ' still has unsent records'); assert.deepEqual(Object.keys(d.E.park), [], d.id + ' parked records'); assert.equal(d.E.joined, 1); }

  /* 1. the same deck everywhere — and in the cloud: a new device that knows nothing gets it too */
  const fresh = rig.device('devnew99', Object.assign(emptyState(), { settings: {} }), {});
  rig.start(fresh, { join: 'cloud' }); await rig.settle();
  /* sibling claims are only kept for two days, by each device's own clock: they are compared from the first day
     that every device, whatever its clock says, still holds */
  const sibFrom = rig.devs.map(d => dayOf(Math.max(d.now(), d.now() + d.E.off) - 2 * DAYMS)).sort().pop();
  const ref = normal(rig.devs[0].S, { sibFrom });
  for (const d of rig.devs.slice(1)) { const diff = firstDiff(ref, normal(d.S, { sibFrom })); assert.equal(diff, null, rig.devs[0].id + ' and ' + d.id + ' differ at ' + diff); }

  /* 2. the counters are exactly what was done */
  const zero = t => { const o = {}; for (const day in t) { const e = {}; for (const f in t[day]) if (t[day][f]) e[f] = t[day][f]; if (Object.keys(e).length) o[day] = e; } return o; };
  for (const d of rig.devs) assert.deepEqual(zero(sy.syCtRead(d.S)), zero(truth), d.id + ': the day counters are not the reviews that were made');

  /* 3. cards: the version that stands is one that nobody had already moved on from */
  const d0 = rig.devs[0], final = stamps(d0);
  for (const d of rig.devs.slice(1)) assert.deepEqual(stamps(d), final, d.id + ' holds other versions than ' + d0.id);
  for (const k in final) {
    assert.ok(!child.has(k + '|' + final[k]), k + ' ended in a version that a device had already replaced');
    if (authored[k]) assert.ok(Object.values(authored[k]).includes(content(d0, k)), k + ' ended as something no device wrote last: ' + content(d0, k));
  }

  /* 4. device-local settings stayed where they were made */
  for (const d of rig.devs.slice(0, -1)) { assert.equal(d.S.settings.theme, d.theme, d.id + ' theme'); assert.equal(d.S.settings.voiceName, d.voice, d.id + ' voiceName'); }
  for (const k of sy.SY_LOCAL) assert.equal(rig.rec('s~' + k), undefined);
  stats.devices = rig.devs.length - 1; stats.records = Object.keys(rig.recs()).length;
  return stats;
}

test('simulation: ' + SEEDS + ' seeds from ' + FIRST + ', ' + STEPS + ' steps each', async t => {
  const failed = [], sum = {};
  for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
    try { const s = await runSim(seed); for (const k in s) sum[k] = (sum[k] || 0) + s[k]; }
    catch (err) { failed.push('seed ' + seed + ': ' + String(err.message || err).split('\n')[0].slice(0, 500)); if (failed.length >= 8) break; }
  }
  t.diagnostic('device actions ' + sum.ops + ' (reviews ' + ((sum.review || 0) + (sum.myReview || 0)) + ', undos ' + (sum.undo || 0) + '), offline switches ' + sum.offline + ', reloads ' + sum.reloads +
    ', unsent changes overruled ' + sum.lost + ', writes refused by the rule ' + sum.refused + ', records at the end ' + sum.records + ' over ' + sum.devices + ' devices');
  assert.equal(failed.length, 0, '\n' + failed.join('\n') + '\nrun one again with  SIM_FIRST=<seed> SIM_SEEDS=1 node --test tools/test/sim.test.js');
});

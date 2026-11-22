#!/usr/bin/env node
/* Merge an older backup of a deck into the live one, on copies, and say exactly what changed.

     node tools/merge_deck.mjs compare <live.json> <old.json>              what the old file has that the live deck lacks
     node tools/merge_deck.mjs merge   <live.json> <old.json> --out <f>    the same report, and the merged deck written to <f>
     node tools/merge_deck.mjs selftest                                    the rules, tried on the harness's deck

   Both files are what Settings → Export (or the automatic backup file) writes: the deck as one JSON object.
   Nothing here touches a browser, the room or a device. Applying a merged file is done by hand, by Import on the
   Mac, after its counts have been read (docs/roadmap.md, "The 7 November backup file").

   The rules, one per kind of thing:
     cards        the later review wins, card by card; a card one side lacks is added; a card that is only queued
                  never replaces one that has been studied
     days         (reviews, new words, the intake counters) a day the live deck lacks is added; a day both have
                  keeps the larger count
     marks        writing-test marks, drill tallies: one the live deck lacks is added; its own are kept
     hard list    entries the live deck lacks are added after its own
     the time-lapse  days the live deck lacks are put in, in date order
     everything else (settings, the exam, the tone coach, My words, the up-next list) stays the live deck's;
                  My words the old file has and the live deck lacks are reported, never merged (their ids can collide)
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const clone = x => JSON.parse(JSON.stringify(x));
const studied = c => !!c && c.st !== undefined;
const dayTotal = e => !e ? 0 : typeof e === 'number' ? e : (e.rev || 0) + (e.new || 0);
const DAY_FIELDS = ['log', 'intro', 'cintro', 'gintro'];
const TALLIES = ['cf', 'gram', 'listen', 'us', 'read'];

export function mergeDecks(liveIn, oldIn) {
  const live = clone(liveIn), old = oldIn, R = { cardsAdded: [], cardsNewer: [], days: {}, marks: [], tallies: {}, hard: [], hist: [], myWords: [], notes: [] };
  delete live._app; delete live._savedAt;
  live.cards = live.cards || {};
  for (const [id, oc] of Object.entries(old.cards || {})) {
    const lc = live.cards[id];
    if (lc === undefined) { live.cards[id] = clone(oc); R.cardsAdded.push(id); }
    else if (studied(oc) && (!studied(lc) || (oc.last || 0) > (lc.last || 0))) { live.cards[id] = clone(oc); R.cardsNewer.push(id); }
  }
  for (const f of DAY_FIELDS) {
    const o = old[f]; if (!o) continue; live[f] = live[f] || {};
    for (const [day, e] of Object.entries(o)) {
      const had = live[f][day];
      if (had === undefined || dayTotal(e) > dayTotal(had)) { live[f][day] = clone(e); (R.days[day] = R.days[day] || []).push(f + (had === undefined ? ' added' : ' ' + dayTotal(had) + ' → ' + dayTotal(e))); }
    }
  }
  if (old.mtest && old.mtest.res) {
    live.mtest = live.mtest || {}; live.mtest.res = live.mtest.res || {};
    for (const [id, m] of Object.entries(old.mtest.res)) if (live.mtest.res[id] === undefined) { live.mtest.res[id] = clone(m); R.marks.push(id); }
  }
  for (const f of TALLIES) {
    if (!old[f]) continue; live[f] = live[f] || {};
    for (const [k, v] of Object.entries(old[f])) if (live[f][k] === undefined) { live[f][k] = clone(v); R.tallies[f] = (R.tallies[f] || 0) + 1; }
  }
  if (Array.isArray(old.hard)) { live.hard = live.hard || []; for (const id of old.hard) if (!live.hard.includes(id)) { live.hard.push(id); R.hard.push(id); } }
  if (old.hist && Array.isArray(old.hist.d) && Array.isArray(old.hist.s)) {
    live.hist = live.hist && Array.isArray(live.hist.d) ? live.hist : { d: [], s: [] };
    const rows = live.hist.d.map((d, i) => [d, live.hist.s[i]]);
    old.hist.d.forEach((d, i) => { if (!live.hist.d.includes(d)) { rows.push([d, old.hist.s[i]]); R.hist.push(d); } });
    rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    live.hist.d = rows.map(r => r[0]); live.hist.s = rows.map(r => r[1]);
  }
  if (old.my && old.my.w) for (const [id, w] of Object.entries(old.my.w)) { const lw = live.my && live.my.w && live.my.w[id]; if (!lw || JSON.stringify(lw) !== JSON.stringify(w)) R.myWords.push(id); }
  for (const k of Object.keys(old)) if (!(k in liveIn) && !['_app', '_savedAt'].includes(k)) R.notes.push(`the old file has a field the live deck lacks: ${k} (left out)`);
  return { deck: live, report: R };
}

const dkey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
/* the streak as js/home.js counts it, as of the deck's own last day of study */
export function streakOf(S, asOf) {
  const log = S.log || {}, days = Object.keys(log).filter(d => dayTotal(log[d]) > 0).sort();
  if (!days.length) return 0;
  const d = new Date((asOf || days[days.length - 1]) + 'T12:00:00'); let n = 0;
  if (!dayTotal(log[dkey(d)])) d.setDate(d.getDate() - 1);
  while (dayTotal(log[dkey(d)]) > 0) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function counts(S, asOf) {
  const cards = Object.entries(S.cards || {}), words = new Set(cards.filter(([id]) => /^w\d+:/.test(id)).map(([id]) => id.split(':')[0]));
  const log = S.log || {}, days = Object.keys(log).sort(), last = days[days.length - 1] || '';
  return { words: words.size, cards: cards.length, started: cards.filter(([, c]) => studied(c)).length, grammar: cards.filter(([id]) => id.startsWith('g:')).length,
    daysStudied: days.filter(d => dayTotal(log[d]) > 0).length, lastDay: last, reviewsAll: days.reduce((a, d) => a + dayTotal(log[d]), 0), streak: streakOf(S, asOf),
    marks: Object.keys((S.mtest && S.mtest.res) || {}).length, hard: (S.hard || []).length, myWords: Object.keys((S.my && S.my.w) || {}).length };
}
/* what must hold of any merge: nothing either file had is behind where it was */
export function lost(live, old, merged) {
  const out = [];
  for (const [name, src] of [['live', live], ['old', old]]) {
    for (const [id, c] of Object.entries(src.cards || {})) { const m = merged.cards[id]; if (!m) out.push(`${name}: card ${id} is gone`); else if (studied(c) && (!studied(m) || (m.last || 0) < (c.last || 0))) out.push(`${name}: card ${id} went back`); }
    for (const f of DAY_FIELDS) for (const [d, e] of Object.entries(src[f] || {})) if (dayTotal((merged[f] || {})[d]) < dayTotal(e)) out.push(`${name}: ${f} ${d} is lower`);
    for (const id of Object.keys((src.mtest && src.mtest.res) || {})) if (!merged.mtest || merged.mtest.res[id] === undefined) out.push(`${name}: writing-test mark ${id} is gone`);
    for (const id of src.hard || []) if (!(merged.hard || []).includes(id)) out.push(`${name}: hard-list entry ${id} is gone`);
  }
  for (const k of ['settings', 'exam', 'tone', 'vp', 'my', 'pick', 'sib', 'conf']) if (JSON.stringify(merged[k]) !== JSON.stringify(live[k])) out.push(`${k} is not the live deck's`);
  return out;
}

function show(live, old, merged, R) {
  const asOf = counts(live).lastDay > counts(old).lastDay ? counts(live).lastDay : counts(old).lastDay;
  const a = counts(live, asOf), o = counts(old, asOf), m = counts(merged, asOf), row = (label, k) => console.log(`  ${label.padEnd(26)} ${String(a[k]).padStart(10)} ${String(o[k]).padStart(10)} ${String(m[k]).padStart(10)}`);
  console.log(`\n  ${''.padEnd(26)} ${'live'.padStart(10)} ${'old file'.padStart(10)} ${'merged'.padStart(10)}`);
  row('words in the deck', 'words'); row('cards', 'cards'); row('cards studied', 'started'); row('grammar cards', 'grammar'); row('days studied', 'daysStudied'); row('last day studied', 'lastDay');
  row('reviews, all days', 'reviewsAll'); row(`streak as of ${asOf}`, 'streak'); row('writing-test marks', 'marks'); row('hard list', 'hard'); row('My words', 'myWords');
  console.log(`\n  From the old file: ${R.cardsNewer.length} cards with a later review, ${R.cardsAdded.length} cards the live deck did not have, ${R.marks.length} writing-test marks, ${R.hard.length} hard-list entries, ${R.hist.length} time-lapse days${Object.keys(R.tallies).length ? ', drill tallies: ' + Object.entries(R.tallies).map(([k, n]) => k + ' ' + n).join(', ') : ''}.`);
  const days = Object.keys(R.days).sort();
  if (days.length) { console.log(`  Days changed (${days.length}):`); for (const d of days) console.log(`    ${d}  ${R.days[d].join('; ')}   live ${dayTotal((live.log || {})[d])} · old ${dayTotal((old.log || {})[d])} · merged ${dayTotal((merged.log || {})[d])}`); }
  else console.log('  No day changed.');
  const list = (name, ids) => { if (ids.length) console.log(`  ${name}: ${ids.slice(0, 60).join(' ')}${ids.length > 60 ? ' … and ' + (ids.length - 60) + ' more' : ''}`); };
  list('Later review in the old file', R.cardsNewer); list('Cards added', R.cardsAdded); list('Marks added', R.marks); list('Hard list added', R.hard);
  if (R.myWords.length) console.log(`  NOT merged: ${R.myWords.length} of the old file's My words differ from or are missing in the live deck (${R.myWords.slice(0, 20).join(' ')}). Their ids can collide; look at them by hand.`);
  R.notes.forEach(n => console.log('  note: ' + n));
  const bad = lost(live, old, merged);
  console.log(bad.length ? `\n  ✗ ${bad.length} thing(s) went backwards:\n    ` + bad.slice(0, 30).join('\n    ') : '\n  ✓ Nothing in either file is behind where it was; settings, the exam, the tone coach and My words are the live deck\'s.');
  return bad.length;
}

function selftest() {
  const here = dirname(fileURLToPath(import.meta.url)), fx = JSON.parse(readFileSync(join(here, 'snap', 'fixtures', 'deck.json'), 'utf8')), src = fx.localStorage || fx;
  const live = typeof src.shida_b1_fsrs_v2 === 'string' ? JSON.parse(src.shida_b1_fsrs_v2) : src.shida_b1_fsrs_v2, old = clone(live);
  let fails = 0; const ok = (name, cond) => { console.log(`  ${cond ? '✓' : '✗'} ${name}`); if (!cond) fails++; };
  const ids = Object.keys(live.cards).filter(id => studied(live.cards[id])), days = Object.keys(live.log).sort();
  /* the old file: a later review of one card, an earlier one of another, a card and a day and a mark the live deck lacks, a smaller and a larger count */
  old.cards[ids[0]].last = live.cards[ids[0]].last + 5000; old.cards[ids[0]].reps = 99;
  old.cards[ids[1]].last = live.cards[ids[1]].last - 5000; old.cards[ids[1]].reps = 1;
  old.cards['w999999:rec'] = { st: 'rev', S: 3, D: 5, due: 1, last: 1, reps: 1, lapses: 0 };
  const queuedOnly = Object.keys(live.cards).find(id => !studied(live.cards[id])); if (queuedOnly) { old.cards[queuedOnly] = { st: 'rev', S: 2, D: 5, due: 2, last: 2, reps: 1, lapses: 0 }; }
  old.cards[ids[2]] = {};                                             /* queued in the old file, studied in the live deck */
  old.log['2026-09-01'] = { rev: 7, new: 3 }; old.log[days[0]] = { rev: 1, new: 0 }; old.log[days[1]] = { rev: 500, new: 9 };
  old.mtest = old.mtest || {}; old.mtest.res = Object.assign({}, old.mtest.res, { w999999: 'l' }); old.hard = (old.hard || []).concat(['w999999']);
  old.settings = Object.assign({}, old.settings, { newPerDay: 99 }); delete live.cards['w999999:rec'];
  const { deck: m, report: R } = mergeDecks(live, old);
  ok('a later review in the old file wins', m.cards[ids[0]].reps === 99 && R.cardsNewer.includes(ids[0]));
  ok('an earlier review in the old file loses', m.cards[ids[1]].reps === live.cards[ids[1]].reps);
  ok('a card the live deck lacks is added', !!m.cards['w999999:rec']);
  ok('a card studied only in the old file replaces a queued one', !queuedOnly || studied(m.cards[queuedOnly]));
  ok('a queued card never replaces a studied one', studied(m.cards[ids[2]]));
  ok('a day the live deck lacks is added', dayTotal(m.log['2026-09-01']) === 10);
  ok('a day both have keeps the larger count', dayTotal(m.log[days[0]]) === dayTotal(live.log[days[0]]) && dayTotal(m.log[days[1]]) === 509);
  ok('a mark and a hard-list entry the live deck lacks are added', m.mtest.res.w999999 === 'l' && m.hard.includes('w999999') && m.hard.slice(0, (live.hard || []).length).join() === (live.hard || []).join());
  ok('settings stay the live deck\'s', m.settings.newPerDay === live.settings.newPerDay);
  ok('nothing in either file went backwards', lost(live, old, m).length === 0);
  ok('merging the old file in again changes nothing', JSON.stringify(mergeDecks(m, old).deck) === JSON.stringify(m));
  ok('merging a deck with itself changes nothing', JSON.stringify(mergeDecks(live, live).deck) === JSON.stringify(live));
  ok('the inputs are not touched', old.cards[ids[0]].reps === 99 && live.cards[ids[0]].reps !== 99);
  console.log(fails ? `\n${fails} failed` : '\nall pass'); process.exit(fails ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, a, b] = process.argv.slice(2), outAt = process.argv.indexOf('--out'), out = outAt > 0 ? process.argv[outAt + 1] : null;
  if (cmd === 'selftest') selftest();
  else if ((cmd === 'compare' || cmd === 'merge') && a && b) {
    const live = JSON.parse(readFileSync(a, 'utf8')), old = JSON.parse(readFileSync(b, 'utf8'));
    if (!live.cards || !old.cards) { console.error('merge_deck: both files must be decks (an object with "cards")'); process.exit(2); }
    console.log(`live: ${a}${live._savedAt ? ' (saved ' + live._savedAt + ')' : ''}\nold:  ${b}${old._savedAt ? ' (saved ' + old._savedAt + ')' : ''}`);
    const { deck, report } = mergeDecks(live, old), bad = show(live, old, deck, report);
    if (cmd === 'merge') {
      if (!out) { console.error('\nmerge_deck: say where to write the merged deck with --out <file>'); process.exit(2); }
      if (bad) { console.error('\nmerge_deck: not written, because something went backwards'); process.exit(1); }
      writeFileSync(out, JSON.stringify(deck)); console.log(`\n  written: ${out}  (nothing else was changed; apply it by Import on the Mac, with the other devices closed)`);
    }
  } else { console.log('usage: node tools/merge_deck.mjs compare <live.json> <old.json> | merge <live.json> <old.json> --out <file> | selftest'); process.exit(2); }
}

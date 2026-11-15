'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', 'review-sync');
const src = fs.readFileSync(path.join(ROOT, 'js/sync-records.js'), 'utf8');
const M = {
  noObserve: [["  syObserve(E, rec.h);\n  if (kind.k === 'd')", "  if (kind.k === 'd')"]],
  noDrift: [["  if (!(w <= syNow(E) + SY_DRIFT)) return false;\n", ""]],
  noBlind: [["const syBlind = (kind, v, e) => !e &&", "const syBlind = (kind, v, e) => false && !e &&"]],
  startHard: [["if (syDiff(E, E.env.state(), { soft: true })) sySave(E);", "if (syDiff(E, E.env.state(), { soft: false })) sySave(E);"]],
  legacyWinsAll: [["        if (!(rr !== lr ? rr > lr : st.slice(0, 12) > lh.slice(0, 12))) continue;", "        if (false) continue;"]],
  legacyCardNever: [["        if (!(rr !== lr ? rr > lr : st.slice(0, 12) > lh.slice(0, 12))) continue;", "        if (!(rr !== lr ? rr > lr : false)) continue;"]],
  noFlagRank: [["rank(id, v) { return id.charCodeAt(0) === 95 ? (v ? 2 : 0) : 1; }", "rank(id, v) { return 1; }"]],
  ackAny: [["else if (E.q[key] === 1 && E.sh[key] && E.sh[key].slice(12) === sent[key]) delete E.q[key];", "else if (E.q[key] === 1) delete E.q[key];"]],
  cursorNow: [["    m = Math.min(sn, Math.max(m, E.t0 + E.off - SY_SLACK));", "    m = sn;"], ["Math.max(0, E.cur - SY_OVERLAP)", "E.cur + 1"]],
  afterNoBase: [["  if (!base || t > base) return t;", "  return t;"]],
  staleShadowKept: [["    try { E.env.store.removeItem(SY_STORE); } catch (e2) { /* nothing more to do */ }\n", ""]],
  tellKeepsShadow: [["  try { E.env.store.removeItem(SY_STORE); } catch (err) { /* nothing more to do */ }\n  E.err = 'store';\n}", "  sySave(E);\n}"]],
  noMnRank: [["rank(id, v) { return typeof v === 'number' && v > 0 ? v : 0; }", "rank(id, v) { return 1; }"]],
  noFrozen: [["const syFrozen = (E, f, d) => (f === 'mi' || f === 'ml') && d < E.cutMy;", "const syFrozen = (E, f, d) => false;"]],
  noOffset: [["    E.off = Math.round(sn - E.env.now());\n", ""]],
  noOrder: [["  if (A.o) A.o.forEach((id, i) => { if (!(id in pos)) pos[id] = i; });\n", ""]],
  softIsHard: [["      E.sh[key] = 'v' + h + (soft || syBlind(kind, v, e) ? sySoft(E, kind, v, e, h) : syAfter(E, e && e.slice(12)));", "      E.sh[key] = 'v' + h + (syBlind(kind, v, e) ? sySoft(E, kind, v, e, h) : syAfter(E, e && e.slice(12)));"]],
  softCardNoLast: [["  if (kind && kind.card && v && typeof v.last === 'number' && v.last > 0 && v.last < SY_WMAX) {", "  if (false) {"]],
  tallyDropRemote: [["  if (kind.put(S, id, rv, E) === false) { E.wait[key] = rec; res.deferred++; return; }", "  if (kind.k === 'us' || kind.k === 'g' || kind.k === 'cf') { if (!rtomb) { rv = kind.k === 'us' ? [0, 0, 0] : { n: 0, ok: 0 }; } }\n  if (kind.put(S, id, rv, E) === false) { E.wait[key] = rec; res.deferred++; return; }"]],
  lostNotReported: [["  if (E.q[key] === 1 && e && e.slice(0, 12) !== E.sh[key].slice(0, 12)) res.lost.push(key);", ""]],
  wipeMyWordOnConflict: [["      if (rec.h > lh) E.sh[key] = e.slice(0, 12) + syAfter(E, rec.h);\n      E.q[key] = 1; res.kept++; return;", "      if (rec.h > lh) E.sh[key] = e.slice(0, 12) + syAfter(E, rec.h);\n      E.q[key] = 1; res.kept++; return;"]]
};
delete M.wipeMyWordOnConflict;
M.deleteWins = [["    if (!(rr !== lr ? rr > lr : rec.h > lh)) {", "    const dw = !kind.card && !kind.rank && (rtomb !== (e.charCodeAt(0) === 100));\n    if (!(dw ? rtomb : (rr !== lr ? rr > lr : rec.h > lh))) {"]];
M.hwNeverPersisted = [["  E.hw = +p.hw || 0; E.hc = +p.hc || 0;", "  E.hw = 0; E.hc = 0;"]];
M.noReadRepair = [["      if (rec.h > lh) E.sh[key] = e.slice(0, 12) + syAfter(E, rec.h);\n      E.q[key] = 1; res.kept++; return;", "      res.kept++; return;"]];
M.cloneCounter = [["  } else if (e && rec.h < lh) { E.q[key] = 1; res.kept++; return; }", "  } else if (e && rec.h < lh) { res.kept++; return; }"]];

const only = process.argv.slice(2);
const out = [];
for (const name of Object.keys(M)) {
  if (only.length && !only.includes(name)) continue;
  let s = src;
  for (const [a, b] of M[name]) { if (!s.includes(a)) { console.log(name + ': PATTERN NOT FOUND ' + a.slice(0, 60)); s = null; break; } s = s.replace(a, b); }
  if (!s) continue;
  const f = path.join(__dirname, 'mut-' + name + '.js'); fs.writeFileSync(f, s);
  const run = (file, env) => { const r = spawnSync('node', ['--test', path.join(ROOT, 'tools/test', file)], { env: Object.assign({}, process.env, { SY_FILE: f }, env), encoding: 'utf8', timeout: 240000 }); const m = /ℹ fail (\d+)/.exec(r.stdout || ''); const names = (r.stdout || '').split('\n').filter(l => /^✖ /.test(l)).map(l => l.slice(2, 90)); return { fail: m ? +m[1] : -1, names: [...new Set(names)] }; };
  const u = run('sync.test.js', {}), sim = run('sim.test.js', { SIM_SEEDS: process.env.MUT_SEEDS || '120' });
  const line = name.padEnd(18) + ' unit: ' + (u.fail ? 'CAUGHT (' + u.fail + ')' : 'survives') + '   sim: ' + (sim.fail ? 'CAUGHT' : 'survives') + (u.fail ? '\n      ' + u.names.join('\n      ') : '');
  console.log(line); out.push(line);
}

/* node --test tools/test/rules-mutation.test.mjs
   Does the case table notice when a rule is weakened or broken?

   Every expression in firebase/database.rules.json is changed in turn — replaced by true, by
   false, and with each condition of every && and || taken out — and the case table is run
   again. A change that no case notices is a hole in the tests (or a condition that does
   nothing), and fails here unless it is listed in EQUIVALENT with the reason. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RulesDb } from './rules-eval.mjs';
import { CASES, BASE, NOW } from './rules-cases.mjs';

const RULES = JSON.parse(readFileSync(new URL('../../firebase/database.rules.json', import.meta.url), 'utf8'));

/* the operands of every && and || in an expression, at every depth, as [start, end, operator] */
export function operands(src) {
  const out = [];
  (function scan(from, to) {
    /* split [from,to) on the lowest-precedence operator present at depth 0 */
    for (const op of ['||', '&&']) {
      const cuts = []; let depth = 0, q = null, re = false;
      for (let i = from; i < to; i++) {
        const c = src[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
        if (re) { if (c === '\\') i++; else if (c === '/') re = false; continue; }
        if (c === "'" || c === '"') q = c;
        else if (c === '/' && /[(,]\s*$/.test(src.slice(from, i))) re = true;
        else if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (depth === 0 && src.startsWith(op, i)) { cuts.push(i); i++; }
      }
      if (!cuts.length) continue;
      const edges = [from, ...cuts.flatMap(i => [i, i + 2]), to];
      for (let k = 0; k < edges.length; k += 2) {
        let a = edges[k], b = edges[k + 1];
        while (src[a] === ' ') a++; while (src[b - 1] === ' ') b--;
        out.push([a, b, op]); scan(a, b);
      }
      return;
    }
    /* no operator at depth 0: look inside one pair of wrapping parentheses, or after a ! */
    let a = from, b = to;
    while (src[a] === ' ') a++; while (src[b - 1] === ' ') b--;
    if (src[a] === '!') return scan(a + 1, b);
    if (src[a] === '(' && src[b - 1] === ')') {
      let depth = 0, wraps = true;
      for (let i = a; i < b - 1; i++) { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; if (depth === 0) { wraps = false; break; } }
      if (wraps) scan(a + 1, b - 1);
    }
  })(0, src.length);
  return out;
}

function mutants() {
  const list = [];
  (function walk(node, where) {
    for (const k of Object.keys(node)) {
      if (k === '.indexOn') continue;
      if (k[0] !== '.') { walk(node[k], where + '/' + k); continue; }
      const at = where + '/' + k, orig = node[k];
      const add = (label, value) => list.push({ at, label, apply: () => { node[k] = value; }, undo: () => { node[k] = orig; } });
      if (typeof orig === 'boolean') { add('flipped to ' + !orig, !orig); continue; }
      add('replaced by true', 'true');
      add('replaced by false', 'false');
      for (const [a, b, op] of operands(orig)) add('without `' + orig.slice(a, b) + '`', orig.slice(0, a) + (op === '&&' ? 'true' : 'false') + orig.slice(b));
    }
  })(RULES.rules, '');
  return list;
}

const run = () => CASES.every(c => {
  const db = new RulesDb(RULES, c.data || BASE, { now: NOW });
  const r = c.op === 'read' ? db.read(c.auth, c.path) : c.op === 'set' ? db.write(c.auth, c.path, c.value) : db.update(c.auth, c.map);
  return r.allowed === c.allow;
});

/* Changes that cannot alter an answer, with the reason: [where, which change, why].
   Each of these conditions is kept in the rules because it says what is meant, or because it
   keeps a refusal from depending on an evaluation error. */
const EQUIVALENT = [
  [/./, m => m.label === 'without `auth != null`' && /auth\.uid/.test(m.rest),
    'with nobody signed in, auth.uid is an error and the rule is false anyway'],
  [/\/\.validate$/, m => m.label === 'without `newData.isString()`' && /newData\.val\(\)\.(length|matches)/.test(m.orig),
    'length and matches() on anything but a string are errors, so the rule is false anyway'],
  [/^\/joins\/\$code\/\.validate$/, m => /^without `\$code\.matches/.test(m.label),
    'a request can only be filed under the code its account\'s pointer names, and the pointer has the same pattern'],
  [/^\/joins\/\$code\/uid\/\.validate$/, m => /replaced by true|without `newData\.val\(\)\.length/.test(m.label),
    'the request\'s .write already pins uid to auth.uid'],
  [/^\/joins\/\$code\/ans\/(owner\/)?\.validate$/, m => /replaced by true|without `newData\.val\(\)\.length/.test(m.label),
    'the answer\'s .write already pins owner to auth.uid'],
  [/^\/joins\/\$code\/ans\/\.write$/, m => m.label === "without `data.parent().child('uid').exists()`",
    'the next condition adds to the request\'s time, which is an error when there is no request'],
  [/^\/joins\/\$code\/\.write$/, m => m.label === 'without `data.exists()`',
    'every way to delete compares against a field of the existing request'],
  [/^\/users\/\$uid\/rec\/\$key\/m\/\.validate$/, m => m.label === 'replaced by true',
    'the record\'s own rule already requires m to be the server\'s clock; this child rule only exists so that m is a listed field'],
  [/^\/users\/\$uid\/(meta\/)?\$other\/\.validate$/, m => m.label === 'flipped to true',
    'no .write reaches an unlisted branch, so nothing can be written there with or without this; it is the second lock, for the day someone widens the .write on a person\'s tree'],
  [/^\/users\/\$uid\/devices\/\$dev\/seen\/\.write$/, m => m.label === 'without `data.parent().exists()`',
    'without an approval the write would create a device entry with no name, which the entry\'s .validate refuses'],
];

test('operands() finds the conditions of a nested expression', () => {
  const s = "a && (b || c.m('x && y')) && !(d && e)";
  assert.deepEqual(operands(s).map(([a, b]) => s.slice(a, b)), ['a', "(b || c.m('x && y'))", 'b', "c.m('x && y')", '!(d && e)', 'd', 'e']);
});

test('the unchanged rules pass every case', () => { assert.ok(run()); });

test('every weakening or breaking of a rule is noticed by some case', () => {
  const all = mutants(), survivors = [], excused = [], used = new Set();
  for (const m of all) {
    m.apply();
    let ok;
    try { ok = run(); } catch (e) { ok = false; } finally { m.undo(); }
    if (!ok) continue;                               /* a case failed: the change was noticed */
    const orig = (function get(node, parts) { return parts.length ? get(node[parts[0]], parts.slice(1)) : node; })(RULES.rules, m.at.split('/').filter(Boolean));
    m.orig = typeof orig === 'string' ? orig : '';
    m.rest = m.orig.replace('auth != null', '');
    const why = EQUIVALENT.find(([where, cond]) => where.test(m.at) && cond(m));
    if (why) { excused.push(m.at + '  ' + m.label); used.add(why); continue; }
    survivors.push(m.at + '  ' + m.label);
  }
  if (process.env.SHOW_EXCUSED) console.log(excused.join('\n'));
  assert.ok(all.length > 150, 'generated ' + all.length + ' changes');
  assert.deepEqual(survivors, [], survivors.length + ' of ' + all.length + ' changes went unnoticed (' + excused.length + ' excused as equivalent)');
  assert.equal(used.size, EQUIVALENT.length, 'an entry in EQUIVALENT no longer excuses anything: remove it');
  console.log('  ' + all.length + ' changes to the rules: ' + (all.length - excused.length) + ' noticed by the cases, ' + excused.length + ' cannot change an answer (reasons in EQUIVALENT)');
});

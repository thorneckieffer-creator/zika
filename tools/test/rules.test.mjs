/* node --test tools/test/rules.test.mjs
   The security rules, checked with the evaluator in rules-eval.mjs. No dependencies, no network.
   How far this can be trusted, and how to run the same cases on the official emulator, is in
   firebase/README.md. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RulesDb, _internals } from './rules-eval.mjs';
import { CASES, BASE, NOW } from './rules-cases.mjs';
import { rulesText, COLLECTIONS, STAMP } from '../../firebase/build-rules.mjs';

const file = new URL('../../firebase/database.rules.json', import.meta.url);
const text = readFileSync(file, 'utf8');
const RULES = JSON.parse(text);

export function runCase(c, rules) {
  const db = new RulesDb(rules || RULES, c.data || BASE, { now: NOW });
  const r = c.op === 'read' ? db.read(c.auth, c.path) : c.op === 'set' ? db.write(c.auth, c.path, c.value) : db.update(c.auth, c.map);
  return { allowed: r.allowed, trace: db.trace, db };
}

test('the rules file is strict JSON and is what the generator produces', () => {
  assert.equal(text, rulesText(), 'run: node firebase/build-rules.mjs');
  assert.ok(!/\/\/|\/\*/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, '""')), 'no comments outside strings');
  assert.deepEqual(Object.keys(RULES), ['rules']);
  assert.deepEqual(Object.keys(RULES.rules).sort(), ['joins', 'rooms', 'users']);
});

test('the legacy rooms branch is word for word what README.md publishes', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const m = /```json\n(\{\s*"rules":[\s\S]*?)\n```/.exec(readme);
  assert.ok(m, 'README.md still shows the rules');
  assert.deepEqual(RULES.rules.rooms, JSON.parse(m[1]).rules.rooms);
});

test('every rule in the file parses', () => {
  let n = 0;
  (function walk(node, where) {
    for (const k of Object.keys(node)) {
      if (k === '.indexOn') { assert.ok(Array.isArray(node[k])); continue; }
      if (k[0] === '.') { if (typeof node[k] === 'string') { _internals.parse(node[k]); n++; } else assert.equal(typeof node[k], 'boolean', where + k); }
      else walk(node[k], where + k + '/');
    }
  })(RULES.rules, '/');
  assert.ok(n > 40, 'parsed ' + n + ' expressions');
});

test('no rule grants read or write above a single room, request or person', () => {
  for (const top of ['rooms', 'joins', 'users']) {
    assert.equal(RULES.rules[top]['.read'], undefined, top + ' has no .read');
    assert.equal(RULES.rules[top]['.write'], undefined, top + ' has no .write');
  }
  assert.equal(RULES.rules['.read'], undefined);
  assert.equal(RULES.rules['.write'], undefined);
});

test('every collection is indexed on its stamp and closed to other fields', () => {
  for (const c of COLLECTIONS) {
    let node = RULES.rules.users.$uid;
    for (const seg of c.path.slice(0, -1)) node = node[seg];
    assert.deepEqual(node['.indexOn'], [STAMP], c.path.join('/'));
    const rec = node[c.path[c.path.length - 1]];
    assert.equal(rec.$other['.validate'], false, c.path.join('/'));
    assert.ok(rec[STAMP], c.path.join('/'));
  }
});

for (const c of CASES) {
  test(c.name, () => {
    const r = runCase(c);
    assert.equal(r.allowed, c.allow, (c.allow ? 'should be allowed' : 'should be refused') + '\n' + r.trace.join('\n'));
  });
}

test('case names are unique and both answers are well represented', () => {
  assert.equal(new Set(CASES.map(c => c.name)).size, CASES.length);
  assert.ok(CASES.filter(c => c.allow).length >= 35, 'allowed cases: ' + CASES.filter(c => c.allow).length);
  assert.ok(CASES.filter(c => !c.allow).length >= 60, 'refused cases: ' + CASES.filter(c => !c.allow).length);
});

/* ---- the evaluator itself: the places where it must be as strict as the service ---- */
test('evaluator: a type error makes a rule false instead of true', () => {
  const rules = { rules: { a: { '.write': true, '.validate': "newData.child('n').val() > data.child('n').val()" }, b: { '.read': 'auth.uid === "x"' }, c: { '.write': "newData.val() + 1 > 0" } } };
  const db = new RulesDb(rules, { a: { n: 5 } }, { now: NOW });
  assert.equal(db.check({ uid: 'u' }, 'a', { n: 6 }).allowed, true);
  assert.equal(db.check({ uid: 'u' }, 'a', { n: 'six' }).allowed, false, 'string against number');
  assert.equal(db.check({ uid: 'u' }, 'a', { other: 1 }).allowed, false, 'null against number');
  assert.equal(db.read(null, 'b').allowed, false, 'auth.uid with nobody signed in');
  assert.equal(db.check({ uid: 'u' }, 'c', null).allowed, false, 'null + 1');
  assert.equal(db.check({ uid: 'u' }, 'c', 1).allowed, true);
});

test('evaluator: write permission comes from the location or above, never from below', () => {
  const rules = { rules: { box: { inner: { '.write': true } } } };
  const db = new RulesDb(rules, null, { now: NOW });
  assert.equal(db.check({ uid: 'u' }, 'box/inner', 1).allowed, true);
  assert.equal(db.check({ uid: 'u' }, 'box/inner/deep', 1).allowed, true, 'a grant cascades down');
  assert.equal(db.check({ uid: 'u' }, 'box', { inner: 1 }).allowed, false, 'a grant below does not reach up');
});

test('evaluator: validation runs on ancestors and on the whole new value, but not on deletions', () => {
  const rules = { rules: { '.write': true, p: { '.validate': "newData.hasChildren(['a','b'])", a: { '.validate': 'newData.isNumber()' }, b: {}, $x: { '.validate': false } } } };
  const db = new RulesDb(rules, { p: { a: 1, b: 2 } }, { now: NOW });
  assert.equal(db.check(null, 'p/a', 5).allowed, true);
  assert.equal(db.check(null, 'p/a', 'five').allowed, false);
  assert.equal(db.check(null, 'p/b', null).allowed, false, 'deleting b breaks the parent rule');
  assert.equal(db.check(null, 'p', null).allowed, true, 'deleting the parent is not validated');
  assert.equal(db.check(null, 'p', { a: 1, b: 2, c: 3 }).allowed, false, 'the wildcard catches c');
  assert.equal(db.check(null, 'p/c', 3).allowed, false, 'and catches it when written on its own');
  assert.equal(db.check(null, 'p/b', 'anything').allowed, true, 'a named child with no rule of its own is not the wildcard');
});

test('evaluator: a literal child wins over a wildcard; wildcards are bound as strings', () => {
  const rules = { rules: { $k: { '.read': "$k === 'open'" }, shut: { '.read': false } } };
  const db = new RulesDb(rules, null, { now: NOW });
  assert.equal(db.read(null, 'open').allowed, true);
  assert.equal(db.read(null, 'shut').allowed, false);
  assert.equal(db.read(null, '7').allowed, false);
});

test('evaluator: root and data are the old data, newData is the result of the whole update', () => {
  const rules = { rules: { a: { '.write': "root.child('flag').val() === true" }, b: { '.write': "newData.parent().child('flag').val() === true" }, flag: { '.write': true } } };
  const db = new RulesDb(rules, null, { now: NOW });
  assert.equal(db.update(null, { flag: true, a: 1 }).allowed, false, 'root does not see the flag being written');
  assert.equal(db.update(null, { flag: true, b: 1 }).allowed, true, 'newData does');
  assert.equal(db.get('b'), 1);
});

test('evaluator: the server timestamp placeholder becomes now; empty branches vanish', () => {
  const rules = { rules: { '.write': true, t: { '.validate': 'newData.val() === now' } } };
  const db = new RulesDb(rules, null, { now: NOW });
  assert.equal(db.write(null, 't', { '.sv': 'timestamp' }).allowed, true);
  assert.equal(db.get('t'), NOW);
  assert.equal(db.write(null, 'x', { a: {}, b: null }).allowed, true);
  assert.equal(db.get('x'), null);
});

test('evaluator: refuses what the rules language does not have', () => {
  for (const bad of ['auth.uid = 1', 'data.val() instanceof Object', 'now > 1;', "data.val().matches(/a/g)", "data.val().matches(/(?=a)/)", "data.val().matches(/a^b/)"]) {
    assert.throws(() => new RulesDb({ rules: { '.read': bad } }, null), SyntaxError, bad);
  }
  const db = new RulesDb({ rules: { '.read': "data.val().length() > 1", a: { '.read': 'window.x === 1' } } }, 'abc');
  assert.equal(db.read(null, '').allowed, false);
  assert.equal(db.read(null, 'a').allowed, false);
});

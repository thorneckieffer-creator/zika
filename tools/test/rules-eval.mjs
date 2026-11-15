/* A small evaluator for Firebase Realtime Database security rules, for tests on a machine
   without Java (the official emulator needs it).

   It implements the part of the rules language firebase/database.rules.json uses, and is strict
   where the real service is strict: a type error inside an expression makes the rule false.
   It is NOT the real thing. tools/test/rules-cross.mjs runs the same cases through an
   independent implementation (targaryen) and compares; firebase/README.md gives the commands
   for the official emulator, which is the only authority.

   What it models
     .read      granted if any .read on the path from the root down to the location is true
     .write     granted if any .write on the path from the root down to the location is true
     .validate  every .validate on that path, and on every node of the written value, must be
                true wherever the new data is not null (a deletion is never validated)
     update()   a multi-path update: every path needs its own .write; newData is the result of
                the whole update; root and data are what was there before
     variables  auth, now, root, data, newData, $wildcards
     snapshots  val child parent hasChild hasChildren exists isNumber isString isBoolean getPriority
     strings    length contains beginsWith endsWith replace toLowerCase toUpperCase matches
     operators  + - * / %  === !== == !=  < > <= >=  && || !  ?:  unary -

   What it does not model: query-based rules (query.*), priorities, .indexOn (ignored, as the
   server ignores it for permission), the rules size limit, and anything about timing. */

/* ---------- data ---------- */
const OBJ = Symbol('node with children');

export function norm(v, now) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object') return v;
  if (Object.keys(v).length === 1 && v['.sv'] === 'timestamp') return now;
  const out = {};
  for (const k of Object.keys(v)) {             /* arrays become objects with index keys, as in the database */
    const c = norm(v[k], now);
    if (c !== null) out[k] = c;
  }
  return Object.keys(out).length ? out : null;  /* the database has no empty objects */
}
export const splitPath = p => (Array.isArray(p) ? p : String(p).split('/').filter(Boolean));
export function getAt(root, path) {
  let v = root;
  for (const k of path) {
    if (v === null || typeof v !== 'object') return null;
    v = Object.prototype.hasOwnProperty.call(v, k) ? v[k] : null;
  }
  return v === undefined ? null : v;
}
export function setAt(root, path, value) {
  if (!path.length) return value;
  const base = root !== null && typeof root === 'object' ? root : {};
  const out = Object.assign({}, base);
  const c = setAt(Object.prototype.hasOwnProperty.call(base, path[0]) ? base[path[0]] : null, path.slice(1), value);
  if (c === null) delete out[path[0]]; else out[path[0]] = c;
  return Object.keys(out).length ? out : null;
}

class Snap {
  constructor(root, path) { this.r = root; this.p = path; }
  raw() { return getAt(this.r, this.p); }
  val() { const v = this.raw(); return v !== null && typeof v === 'object' ? OBJ : v; }
  child(p) { if (typeof p !== 'string') throw new TypeError('child() needs a string'); return new Snap(this.r, this.p.concat(splitPath(p))); }
  parent() { if (!this.p.length) throw new TypeError('parent() of the root'); return new Snap(this.r, this.p.slice(0, -1)); }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren(list) {
    if (list === undefined) { const v = this.raw(); return v !== null && typeof v === 'object'; }
    if (!Array.isArray(list) || !list.length) throw new TypeError('hasChildren() needs a non-empty list');
    return list.every(k => this.child(k).exists());
  }
  exists() { return this.raw() !== null; }
  isNumber() { return typeof this.raw() === 'number'; }
  isString() { return typeof this.raw() === 'string'; }
  isBoolean() { return typeof this.raw() === 'boolean'; }
  getPriority() { return null; }
}
const SNAP_METHODS = new Set(['val', 'child', 'parent', 'hasChild', 'hasChildren', 'exists', 'isNumber', 'isString', 'isBoolean', 'getPriority']);
const STR_METHODS = {
  contains: (s, a) => s.includes(str(a)),
  beginsWith: (s, a) => s.startsWith(str(a)),
  endsWith: (s, a) => s.endsWith(str(a)),
  replace: (s, a, b) => s.split(str(a)).join(str(b)),     /* every occurrence, unlike JavaScript */
  toLowerCase: s => s.toLowerCase(),
  toUpperCase: s => s.toUpperCase(),
  matches: (s, re) => { if (!(re instanceof RegExp)) throw new TypeError('matches() needs a regular expression'); return re.test(s); },
};
function str(a) { if (typeof a !== 'string') throw new TypeError('expected a string'); return a; }

/* ---------- the expression language ---------- */
const PUNCT = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '.', ',', '(', ')', '[', ']'];

function tokenize(src) {
  const out = []; let i = 0;
  const operandNext = () => { const t = out[out.length - 1]; return !t || (t.t === 'p' && t.v !== ')' && t.v !== ']'); };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i)); out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { j++; s += src[j]; } else s += src[j]; j++; }
      if (j >= src.length) throw new SyntaxError('unterminated string');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (c === '/' && operandNext()) {          /* a regular-expression literal */
      let j = i + 1, inClass = false;
      while (j < src.length && (src[j] !== '/' || inClass)) { if (src[j] === '\\') j++; else if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; j++; }
      if (j >= src.length) throw new SyntaxError('unterminated regular expression');
      const body = src.slice(i + 1, j); let flags = ''; j++;
      while (j < src.length && /[a-z]/.test(src[j])) flags += src[j++];
      if (flags && flags !== 'i') throw new SyntaxError('only the i flag is supported');
      if (/\(\?|\\[bB1-9]/.test(body)) throw new SyntaxError('look-around, word boundaries and back-references are not in the rules regex subset');
      const bare = body.replace(/\\./g, '__').replace(/\[[^\]]*\]/g, m => '_'.repeat(m.length));   /* escapes and classes blanked */
      if (bare.indexOf('^', 1) > 0 || (bare.includes('$') && bare.indexOf('$') !== bare.length - 1)) throw new SyntaxError('^ may only be first and $ only last');
      out.push({ t: 're', v: new RegExp(body, flags) }); i = j; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const p = PUNCT.find(x => src.startsWith(x, i));
    if (!p) throw new SyntaxError('unexpected ' + c + ' in rule: ' + src);
    out.push({ t: 'p', v: p }); i += p.length;
  }
  return out;
}

function parse(src) {
  const toks = tokenize(src); let i = 0;
  const peek = v => toks[i] && toks[i].t === 'p' && toks[i].v === v;
  const eat = v => { if (!peek(v)) throw new SyntaxError('expected ' + v + ' in rule: ' + src); i++; };
  const binary = (next, ops) => () => { let l = next(); while (toks[i] && toks[i].t === 'p' && ops.includes(toks[i].v)) { const op = toks[i++].v; l = { k: 'bin', op, l, r: next() }; } return l; };
  function primary() {
    const t = toks[i++];
    if (!t) throw new SyntaxError('unexpected end of rule: ' + src);
    if (t.t === 'num' || t.t === 'str' || t.t === 're') return { k: 'lit', v: t.v };
    if (t.t === 'id') { if (t.v === 'true') return { k: 'lit', v: true }; if (t.v === 'false') return { k: 'lit', v: false }; if (t.v === 'null') return { k: 'lit', v: null }; return { k: 'var', n: t.v }; }
    if (t.v === '(') { const e = ternary(); eat(')'); return e; }
    if (t.v === '[') { const items = []; if (!peek(']')) { do { items.push(ternary()); } while (peek(',') && ++i); } eat(']'); return { k: 'arr', items }; }
    throw new SyntaxError('unexpected ' + t.v + ' in rule: ' + src);
  }
  function postfix() {
    let e = primary();
    for (;;) {
      if (peek('.')) { i++; const t = toks[i++]; if (!t || t.t !== 'id') throw new SyntaxError('expected a name after . in rule: ' + src);
        if (peek('(')) { i++; const args = []; if (!peek(')')) { do { args.push(ternary()); } while (peek(',') && ++i); } eat(')'); e = { k: 'call', o: e, m: t.v, args }; }
        else e = { k: 'mem', o: e, m: t.v }; }
      else if (peek('[')) { i++; const ix = ternary(); eat(']'); e = { k: 'idx', o: e, ix }; }
      else return e;
    }
  }
  function unary() { if (peek('!')) { i++; return { k: 'not', e: unary() }; } if (peek('-')) { i++; return { k: 'neg', e: unary() }; } return postfix(); }
  const mul = binary(unary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  const rel = binary(add, ['<', '>', '<=', '>=']);
  const eq = binary(rel, ['===', '!==', '==', '!=']);
  const and = binary(eq, ['&&']);
  const or = binary(and, ['||']);
  function ternary() { const c = or(); if (peek('?')) { i++; const a = ternary(); eat(':'); const b = ternary(); return { k: 'cond', c, a, b }; } return c; }
  const ast = ternary();
  if (i < toks.length) throw new SyntaxError('unexpected ' + toks[i].v + ' in rule: ' + src);
  return ast;
}

const bool = v => { if (typeof v !== 'boolean') throw new TypeError('expected a boolean'); return v; };
const num = v => { if (typeof v !== 'number') throw new TypeError('expected a number'); return v; };

function ev(n, s) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'arr': return n.items.map(x => ev(x, s));
    case 'var':
      if (n.n[0] === '$') { if (!(n.n in s.vars)) throw new ReferenceError(n.n + ' is not a wildcard on this path'); return s.vars[n.n]; }
      if (n.n === 'newData' && !s.newData) throw new ReferenceError('newData is not available in .read');
      if (['auth', 'now', 'root', 'data', 'newData'].includes(n.n)) return s[n.n];
      throw new ReferenceError('unknown variable ' + n.n);
    case 'not': return !bool(ev(n.e, s));
    case 'neg': return -num(ev(n.e, s));
    case 'cond': return bool(ev(n.c, s)) ? ev(n.a, s) : ev(n.b, s);
    case 'mem': {
      const o = ev(n.o, s);
      if (typeof o === 'string') { if (n.m === 'length') return o.length; throw new TypeError('no property ' + n.m + ' on a string'); }
      if (o === null || o instanceof Snap || typeof o !== 'object' || o instanceof RegExp || Array.isArray(o)) throw new TypeError('no property ' + n.m);
      return Object.prototype.hasOwnProperty.call(o, n.m) && o[n.m] !== undefined ? o[n.m] : null;
    }
    case 'idx': {
      const o = ev(n.o, s), ix = ev(n.ix, s);
      if (o === null || typeof o !== 'object' || o instanceof Snap || typeof ix !== 'string') throw new TypeError('bad index');
      return Object.prototype.hasOwnProperty.call(o, ix) ? o[ix] : null;
    }
    case 'call': {
      const o = ev(n.o, s), args = n.args.map(x => ev(x, s));
      if (o instanceof Snap) { if (!SNAP_METHODS.has(n.m)) throw new TypeError('no method ' + n.m + ' on a snapshot'); return o[n.m](...args); }
      if (typeof o === 'string') { if (!STR_METHODS[n.m]) throw new TypeError('no method ' + n.m + ' on a string'); return STR_METHODS[n.m](o, ...args); }
      throw new TypeError('cannot call ' + n.m);
    }
    case 'bin': {
      if (n.op === '&&') return bool(ev(n.l, s)) && bool(ev(n.r, s));
      if (n.op === '||') return bool(ev(n.l, s)) || bool(ev(n.r, s));
      const l = ev(n.l, s), r = ev(n.r, s);
      switch (n.op) {
        case '===': case '==': return l === r;
        case '!==': case '!=': return l !== r;
        case '<': case '>': case '<=': case '>=':
          if (!((typeof l === 'number' && typeof r === 'number') || (typeof l === 'string' && typeof r === 'string'))) throw new TypeError('cannot compare ' + typeof l + ' with ' + typeof r);
          return n.op === '<' ? l < r : n.op === '>' ? l > r : n.op === '<=' ? l <= r : l >= r;
        case '+':
          if (typeof l === 'number' && typeof r === 'number') return l + r;
          if ((typeof l === 'string' || typeof l === 'number') && (typeof r === 'string' || typeof r === 'number')) return String(l) + String(r);
          throw new TypeError('cannot add ' + typeof l + ' and ' + typeof r);
        case '-': return num(l) - num(r);
        case '*': return num(l) * num(r);
        case '/': return num(l) / num(r);
        case '%': return num(l) % num(r);
      }
    }
  }
  throw new Error('cannot evaluate ' + n.k);
}

/* ---------- the rules tree ---------- */
function compile(node, where) {
  const out = { rules: {}, kids: {}, wild: null };
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (k === '.read' || k === '.write' || k === '.validate') {
      if (typeof v === 'boolean') out.rules[k] = { k: 'lit', v };
      else if (typeof v === 'string') out.rules[k] = parse(v);
      else throw new SyntaxError(where + '/' + k + ' must be a string or a boolean');
    } else if (k === '.indexOn') { /* not a permission */ }
    else if (k[0] === '.') throw new SyntaxError('unknown rule ' + where + '/' + k);
    else if (k[0] === '$') { if (out.wild) throw new SyntaxError('two wildcards at ' + where); out.wild = { name: k, node: compile(v, where + '/' + k) }; }
    else out.kids[k] = compile(v, where + '/' + k);
  }
  return out;
}
function step(node, key, vars) {
  if (!node) return [null, vars];
  if (Object.prototype.hasOwnProperty.call(node.kids, key)) return [node.kids[key], vars];
  if (node.wild) return [node.wild.node, Object.assign({}, vars, { [node.wild.name]: key })];
  return [null, vars];
}

export class RulesDb {
  constructor(rulesJson, data, opts) {
    if (!rulesJson || typeof rulesJson.rules !== 'object') throw new Error('rules file needs a top-level "rules" object');
    this.tree = compile(rulesJson.rules, '');
    this.now = (opts && opts.now) || Date.now();
    this.root = norm(data === undefined ? null : data, this.now);
    this.trace = [];
  }
  _rule(ast, scope, what, path) {
    let ok = false, err = null;
    try { ok = ev(ast, scope) === true; } catch (e) { err = e.message; }
    this.trace.push(what + ' /' + path.join('/') + ' -> ' + ok + (err ? ' (' + err + ')' : ''));
    return ok;
  }
  read(auth, path) {
    const p = splitPath(path); this.trace = [];
    let node = this.tree, vars = {};
    for (let d = 0; d <= p.length && node; d++) {
      const prefix = p.slice(0, d);
      if (node.rules['.read'] && this._rule(node.rules['.read'], { auth, now: this.now, root: new Snap(this.root, []), data: new Snap(this.root, prefix), newData: null, vars }, '.read', prefix)) return { allowed: true, value: getAt(this.root, p) };
      if (d < p.length) [node, vars] = step(node, p[d], vars);
    }
    return { allowed: false, value: undefined };
  }
  /* writes: [[path, value], …] — one entry for set(), several for a multi-path update() */
  _try(auth, writes) {
    this.trace = [];
    let next = this.root;
    const list = writes.map(([p, v]) => [splitPath(p), norm(v, this.now)]);
    for (const [p, v] of list) next = setAt(next, p, v);
    const scopeAt = (prefix, vars) => ({ auth, now: this.now, root: new Snap(this.root, []), data: new Snap(this.root, prefix), newData: new Snap(next, prefix), vars });
    const subtree = (node, path, vars) => {      /* every node of the new value below the write location */
      const v = getAt(next, path);
      if (v === null || typeof v !== 'object') return true;
      for (const k of Object.keys(v)) {
        const [kid, kv] = step(node, k, vars);
        if (!kid) continue;
        const kp = path.concat(k);
        if (kid.rules['.validate'] && !this._rule(kid.rules['.validate'], scopeAt(kp, kv), '.validate', kp)) return false;
        if (!subtree(kid, kp, kv)) return false;
      }
      return true;
    };
    for (const [p] of list) {
      let node = this.tree, vars = {}, granted = false;
      for (let d = 0; d <= p.length; d++) {
        const prefix = p.slice(0, d);
        if (node) {
          const scope = scopeAt(prefix, vars);
          if (!granted && node.rules['.write'] && this._rule(node.rules['.write'], scope, '.write', prefix)) granted = true;
          if (node.rules['.validate'] && scope.newData.exists() && !this._rule(node.rules['.validate'], scope, '.validate', prefix)) return { allowed: false, why: 'validate', at: '/' + prefix.join('/') };
        }
        if (d < p.length) [node, vars] = step(node, p[d], vars);
      }
      if (!granted) return { allowed: false, why: 'write', at: '/' + p.join('/') };
      if (node && !subtree(node, p, vars)) return { allowed: false, why: 'validate', at: '/' + p.join('/') };
    }
    return { allowed: true, next };
  }
  check(auth, path, value) { const r = this._try(auth, [[path, value]]); return { allowed: r.allowed, why: r.why, at: r.at }; }
  write(auth, path, value) { const r = this._try(auth, [[path, value]]); if (r.allowed) this.root = r.next; return { allowed: r.allowed, why: r.why, at: r.at }; }
  update(auth, map, dry) {
    const paths = Object.keys(map).map(k => splitPath(k));
    for (const a of paths) for (const b of paths) if (a !== b && a.length <= b.length && a.every((k, i) => b[i] === k)) throw new Error('an update cannot name a path and its ancestor');
    const r = this._try(auth, Object.keys(map).map((k, i) => [paths[i], map[k]]));
    if (r.allowed && !dry) this.root = r.next;
    return { allowed: r.allowed, why: r.why, at: r.at };
  }
  checkUpdate(auth, map) { return this.update(auth, map, true); }
  get(path) { return getAt(this.root, splitPath(path)); }
}

export const _internals = { parse, tokenize, ev, Snap };

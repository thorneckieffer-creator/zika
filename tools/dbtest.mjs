#!/usr/bin/env node
/* The database's test: what the record store promises, and the attacks it has to refuse, run against the real
   Supabase project over the same doors the app uses (the sign-in service, the data API, the Realtime socket).
   What the store is and why is in docs/backend.md; the SQL under test is db/.

     node tools/dbtest.mjs            everything: about two and a half minutes (three waits of a minute are in it)
     node tools/dbtest.mjs --quick    without the waits: skips expiry, the full account and the flood
     node tools/dbtest.mjs --only realtime     the groups whose name contains the text

   It needs three accounts that exist only for this, and reads them from a file kept OUTSIDE the repository
   (~/.config/zika/db-test.json, or the path in ZIKA_DB_TEST):

     { "url": "https://<project>.supabase.co", "key": "<the publishable key>",
       "a": {"email": …, "password": …},      a confirmed account
       "b": {"email": …, "password": …},      a second confirmed account: the attacker, and the bystander
       "c": {"email": …, "password": …} }     an account whose email was never confirmed

   docs/backend.md says how to make them. Nothing this writes outlives it by long: every record carries a time to
   live, in keys of a kind (`zt~`) the app never uses. It uses no library: fetch and WebSocket as Node ships them. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const ONLY = args.includes('--only') ? String(args[args.indexOf('--only') + 1] || '').toLowerCase() : '';
const CONF = process.env.ZIKA_DB_TEST || join(homedir(), '.config', 'zika', 'db-test.json');
let C;
try { C = JSON.parse(readFileSync(CONF, 'utf8')); }
catch (e) { console.error(`dbtest: cannot read the test accounts from ${CONF} (${e.message}). See docs/backend.md.`); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUN = Date.now().toString(36);
const key = name => `zt~${RUN}:${name}`;
const stamp = (ms, ctr = 0, node = 't3st') => String(Math.floor(ms)).padStart(13, '0') + ctr.toString(36).padStart(3, '0') + node;
const TTL = 180;                                   /* seconds a test record lives */

/* ---------- the three doors ---------- */

async function http(method, path, { token, body, headers } = {}) {
  const res = await fetch(C.url + path, {
    method,
    headers: { apikey: C.key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function signIn(who) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { body: { email: who.email, password: who.password } });
  return r.status === 200 && r.json && r.json.access_token ? { token: r.json.access_token, id: r.json.user.id, r } : { token: null, id: null, r };
}
const write = (s, v, recs) => http('POST', '/rest/v1/rpc/rec_write', { token: s && s.token, body: { v, recs } });
const head = s => http('POST', '/rest/v1/rpc/rec_head', { token: s && s.token, body: {} });
const rows = (s, query) => http('GET', '/rest/v1/rec?' + query, { token: s && s.token });
const one = async (s, k) => { const r = await rows(s, 'select=k,h,j,d,n&k=eq.' + encodeURIComponent(k)); return r.json && r.json[0]; };

/* a Realtime channel, spoken by hand: join, collect what arrives, send */
function channel(topic, { token = null, priv = true } = {}) {
  const ws = new WebSocket(C.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(C.key) + '&vsn=1.0.0');
  const full = 'realtime:' + topic, got = [], ch = { got, status: null, reason: '' };
  let ref = 0, settle;
  ch.joined = new Promise(r => { settle = r; });
  const done = (status, reason) => { if (ch.status === null) { ch.status = status; ch.reason = reason || ''; settle(status); } };
  ws.addEventListener('open', () => ws.send(JSON.stringify({
    topic: full, event: 'phx_join', ref: String(++ref), join_ref: '1',
    payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: priv }, ...(token ? { access_token: token } : {}) }
  })));
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.topic !== full) return;
    if (m.event === 'phx_reply' && m.ref === '1') done(m.payload && m.payload.status === 'ok' ? 'ok' : 'refused', JSON.stringify(m.payload && m.payload.response));
    else if (m.event === 'phx_error' || m.event === 'phx_close') done('refused', m.event);
    else if (m.event === 'system' && m.payload && m.payload.status === 'error') done('refused', m.payload.message);
    else if (m.event === 'broadcast') got.push(m.payload);
  });
  ws.addEventListener('error', () => done('refused', 'socket error'));
  ws.addEventListener('close', () => done('refused', 'socket closed'));
  setTimeout(() => done('refused', 'no answer in 8 s'), 8000);
  ch.send = (event, payload) => ws.send(JSON.stringify({ topic: full, event: 'broadcast', ref: String(++ref), join_ref: '1', payload: { type: 'broadcast', event, payload } }));
  ch.close = () => { try { ws.close(); } catch { /* gone */ } };
  ch.wait = async (pred, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (got.some(pred)) return true; await sleep(100); } return got.some(pred); };
  return ch;
}

/* ---------- the report ---------- */

let passed = 0, failed = 0, group = '';
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${group}: ${name}`); console.log(`  ✗ ${name}${detail !== undefined ? '\n      ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''}`); }
}
const groups = [];
const section = (name, fn, { slow = false } = {}) => groups.push({ name, fn, slow });
const R = r => (r.json && r.json.r) || [];            /* the per-record answers of a write */
const says = (r, status, message) => r.status === status && r.json && r.json.message === message;

/* ---------- start ---------- */

console.log(`dbtest: ${C.url}${QUICK ? '  (quick)' : ''}`);
const A = await signIn(C.a), B = await signIn(C.b);
if (!A.token || !B.token) { console.error('dbtest: the two confirmed test accounts cannot sign in:', A.r.status, A.r.text.slice(0, 200), B.r.status, B.r.text.slice(0, 200)); process.exit(2); }

/* the format each account is on (the last run raised B's), the server's clock, and room to write: a run started
   within a minute of the last one finds the account full or over its minute, and waits for that to pass */
let VA = 1, VB = 1, T = 0;
{
  const ha = await head(A), hb = await head(B);
  VA = Math.max(1, (ha.json && ha.json.v) || 1); VB = Math.max(1, (hb.json && hb.json.v) || 1);
  T = (ha.json && ha.json.now) || Date.now();
  for (let i = 0; i < 30; i++) {
    const p = await write(A, VA, [{ k: key('probe'), h: stamp(T, i), j: 'p', t: 60 }]), q = await write(B, VB, []);
    if (p.status === 200 && R(p)[0] && R(p)[0].n && q.status === 200) break;
    if (i === 0) console.log('  (waiting for the test accounts to have room again: the last run filled them)');
    await sleep(5000);
  }
}
const now = () => T + (Date.now() - T0), T0 = Date.now();      /* the server's clock, carried forward */
const started = Date.now();
const kExpire = key('expires');
await write(A, VA, [{ k: kExpire, h: stamp(now(), 5), j: 'gone soon', t: 60 }]);

/* ---------- 1. who may come in ---------- */

section('signing in', async () => {
  const set = (await http('GET', '/auth/v1/settings')).json || {};
  ok('the project makes a new account confirm its email, and has anonymous sign-in off', set.mailer_autoconfirm === false && set.external && set.external.anonymous_users === false && set.external.email === true, set);
  const c = await signIn(C.c);
  ok('an account whose email is not confirmed cannot sign in', !c.token && /not confirmed/i.test(c.r.text), c.r.text);
  const anon = await http('POST', '/auth/v1/signup', { body: {} });
  ok('there is no anonymous sign-in', !(anon.json && anon.json.access_token), anon.text);
  const wrong = await signIn({ email: C.a.email, password: 'not-the-password' });
  ok('a wrong password is refused', !wrong.token, wrong.r.text);
});

/* ---------- 2. the protocol ---------- */

section('writing and reading', async () => {
  const h0 = (await head(A)).json;
  ok('rec_head answers with the clock, the change number and the format', h0 && Number.isInteger(h0.now) && Number.isInteger(h0.n) && h0.v === VA, h0);

  const k = key('card'), s1 = stamp(now(), 1), s2 = stamp(now(), 2), s3 = stamp(now(), 3);
  let w = await write(A, VA, [{ k, h: s2, j: 'two', t: TTL }]);
  ok('a new record is taken and numbered one past the head', w.status === 200 && R(w)[0].n === h0.n + 1 && w.json.n === h0.n + 1, w.text);
  ok('the answer carries the server\'s clock', Number.isInteger(w.json && w.json.now) && Math.abs(w.json.now - now()) < 5000, w.json);
  let row = await one(A, k);
  ok('it reads back exactly', row && row.h === s2 && row.j === 'two' && row.d === false && row.n === h0.n + 1, row);

  w = await write(A, VA, [{ k, h: s2, j: 'two', t: TTL }]);
  ok('the same version again changes nothing and says so', R(w)[0].same === true && R(w)[0].n === h0.n + 1 && w.json.n === h0.n + 1, w.text);

  w = await write(A, VA, [{ k, h: s1, j: 'one', t: TTL }]);
  ok('an older version is not taken, and the stored one comes back', R(w)[0].old && R(w)[0].old.h === s2 && R(w)[0].old.j === 'two' && R(w)[0].old.n === h0.n + 1, w.text);
  w = await write(A, VA, [{ k, h: s2, j: 'TWO', t: TTL }]);
  ok('the same stamp with another value is not taken either', R(w)[0].old && R(w)[0].old.j === 'two', w.text);
  row = await one(A, k);
  ok('…and the stored record is untouched', row && row.h === s2 && row.j === 'two', row);

  w = await write(A, VA, [{ k, h: s3, j: 'three', t: TTL }]);
  ok('a later version is taken with the next number', R(w)[0].n === h0.n + 2, w.text);

  const kd = key('deleted'), d1 = stamp(now(), 10), d2 = stamp(now(), 11), d0 = stamp(now(), 9);
  await write(A, VA, [{ k: kd, h: d1, j: 'here', t: TTL }]);
  w = await write(A, VA, [{ k: kd, h: d2, d: true, t: TTL }]);
  row = await one(A, kd);
  ok('a deleted mark with a later stamp is taken and keeps its stamp', R(w)[0].n > 0 && row && row.d === true && row.j === null && row.h === d2, [w.text, row]);
  w = await write(A, VA, [{ k: kd, h: d0, j: 'back from the dead', t: TTL }, { k: kd, h: d1, j: 'here', t: TTL }]);
  ok('delete, then rewrite an older version: refused, the tombstone stands', R(w).every(x => x.old && x.old.d === true && x.old.h === d2), w.text);

  const base = (await head(A)).json.n, ks = [0, 1, 2, 3, 4].map(i => key('batch' + i));
  w = await write(A, VA, ks.map((kk, i) => ({ k: kk, h: stamp(now(), 20 + i), j: 'b' + i, t: TTL })));
  ok('a batch is numbered in order with none missing', R(w).map(x => x.n).join() === [1, 2, 3, 4, 5].map(i => base + i).join(), w.text);
  const since = await rows(A, `select=k,n&n=gt.${base}&order=n.asc`);
  ok('"everything after n" returns exactly those, in order', since.json && since.json.map(x => x.k).join() === ks.join(), since.text);
  const h1 = (await head(A)).json;
  ok('rec_head has moved to the last number', h1.n === base + 5, h1);
});

section('two devices writing at once', async () => {
  const A2 = await signIn(C.a), base = (await head(A)).json.n, t = now();
  const calls = Array.from({ length: 16 }, (_, c) => write(c % 2 ? A2 : A, VA,
    Array.from({ length: 10 }, (_, i) => ({ k: key(`race${c}-${i}`), h: stamp(t, i, 'dev' + (c % 2)), j: `r${c}.${i}`, t: TTL }))));
  const done = await Promise.all(calls), ns = done.flatMap(w => R(w).map(x => x.n));
  ok('16 calls at once from two devices: every record taken', done.every(w => w.status === 200) && ns.length === 160 && ns.every(n => n > base), done.find(w => w.status !== 200) || ns.slice(0, 5));
  ok('their numbers are one unbroken run, none given twice', [...ns].sort((a, b) => a - b).join() === Array.from({ length: 160 }, (_, i) => base + 1 + i).join());
  ok('and inside each call the numbers are consecutive (no other call\'s in between)', done.every(w => R(w).every((x, i, r) => i === 0 || x.n === r[i - 1].n + 1)));
  const since = await rows(A, `select=n&n=gt.${base}&order=n.asc`);
  ok('"everything after n" then holds all 160', since.json && since.json.length === 160 && since.json[159].n === base + 160, since.text.slice(0, 200));

  /* the same record from both devices at the same moment, twenty times over: the later stamp must stand whoever lands first */
  const k = key('same-card'), order = Array.from({ length: 20 }, (_, i) => i).sort(() => Math.random() - 0.5);
  await Promise.all(order.map(i => write(i % 2 ? A2 : A, VA, [{ k, h: stamp(t, 100 + i, 'dev' + (i % 2)), j: 'v' + i, t: TTL }])));
  const row = await one(A, k);
  ok('one record written by both at once ends on the latest stamp', row && row.j === 'v19' && row.h === stamp(t, 119, 'dev1'), row);
  await http('POST', '/auth/v1/logout?scope=local', { token: A2.token });
});

section('a whole deck', async () => {
  /* the size of a first sync: 6,000 records shaped like a card's, up in calls of 1,000 and down in pages */
  const base = (await head(A)).json.n, t = now(), card = i => `2,${(3.1 + i / 977).toFixed(14)},${(5.2 + i / 1319).toFixed(14)},${t + i * 86400},${t - i * 3600},7,1,${20 + i % 40}`;
  let worst = 0, took = 0;
  for (let c = 0; c < 6; c++) {
    const t0 = Date.now(), w = await write(A, VA, Array.from({ length: 1000 }, (_, i) => ({ k: key(`deck-w${c * 1000 + i}:rec`), h: stamp(t - 1000, i % 1000, 'deck' + c), j: card(c * 1000 + i), t: 60 })));
    worst = Math.max(worst, Date.now() - t0); took += R(w).filter(x => x.n > 0).length;
  }
  ok(`6,000 records go up in six calls (the slowest took ${worst} ms)`, took === 6000 && worst < 8000, { took, worst });
  let cur = base, got = 0, pages = 0; const t1 = Date.now();
  for (;;) { const r = await rows(A, `select=k,h,j,d,n&n=gt.${cur}&order=n.asc&limit=1000`); if (!r.json || !r.json.length) break; got += r.json.length; cur = r.json[r.json.length - 1].n; pages++; if (r.json.length < 1000) break; }
  ok(`and come down again in ${pages} pages of at most 1,000 (${Date.now() - t1} ms)`, got === 6000 && cur === base + 6000, { got, cur, base });
  const all = await rows(A, `select=n&n=gt.${base}&order=n.asc`);
  ok('a request with no limit of its own is cut at 1,000 by the server, so the app must page', all.json && all.json.length === 1000, all.json && all.json.length);
}, { slow: true });

section('what one record can be refused for', async () => {
  const t = now(), good = i => ({ k: key('ok' + i), h: stamp(t, 40 + i), j: 'fine', t: TTL });
  const big = n => 'x'.repeat(n);
  const cases = [
    ['a key with no kind', { k: 'nokind', h: stamp(t), j: '1' }, 'key'],
    ['a key with a capital kind', { k: 'C~w1', h: stamp(t), j: '1' }, 'key'],
    ['a key with a control character', { k: 'zt~a\u0007b', h: stamp(t), j: '1' }, 'key'],
    ['a key of 513 bytes', { k: 'zt~' + big(510), h: stamp(t), j: '1' }, 'key'],
    ['a key that is a number', { k: 7, h: stamp(t), j: '1' }, 'key'],
    ['a stamp in the old base-36 form', { k: key('s1'), h: '0n1x8k2ab004k3j9x2ab', j: '1' }, 'stamp'],
    ['a stamp with no device', { k: key('s2'), h: String(t).padStart(13, '0') + '000', j: '1' }, 'stamp'],
    ['a stamp of 64 characters', { k: key('s3'), h: stamp(t, 0, big(48)), j: '1' }, 'stamp'],
    ['a stamp six minutes ahead of the server', { k: key('f1'), h: stamp(t + 6 * 60000), j: '1' }, 'future'],
    ['the largest stamp there is', { k: key('f2'), h: '9999999999999zzzzzzz', j: '1' }, 'future'],
    ['a value of 65,537 bytes', { k: key('v1'), h: stamp(t), j: big(65537) }, 'size'],
    ['a value of 21,846 Chinese characters (65,538 bytes)', { k: key('v2'), h: stamp(t), j: '字'.repeat(21846) }, 'size'],
    ['a value that is not a string', { k: key('v3'), h: stamp(t), j: { a: 1 } }, 'shape'],
    ['a value and a deleted mark together', { k: key('v4'), h: stamp(t), j: '1', d: true }, 'shape'],
    ['neither a value nor a deleted mark', { k: key('v5'), h: stamp(t) }, 'shape'],
    ['a deleted mark that is not true or false', { k: key('v6'), h: stamp(t), j: '1', d: 'yes' }, 'shape'],
    ['a time to live of one second', { k: key('t1'), h: stamp(t), j: '1', t: 1 }, 'ttl'],
    ['a time to live of two years', { k: key('t2'), h: stamp(t), j: '1', t: 2 * 366 * 86400 }, 'ttl'],
    ['a time to live that is text', { k: key('t3'), h: stamp(t), j: '1', t: '90' }, 'ttl'],
    ['something that is not a record', 42, 'shape']
  ];
  const recs = []; cases.forEach((c, i) => { recs.push(c[1]); recs.push(good(i)); });
  const w = await write(A, VA, recs), r = R(w);
  ok('the call itself succeeds', w.status === 200 && r.length === recs.length, w.text.slice(0, 300));
  cases.forEach((c, i) => ok(`${c[0]} → ${c[2]}`, r[2 * i] && r[2 * i].no === c[2], r[2 * i]));
  ok('and every good record between them was taken', cases.every((c, i) => r[2 * i + 1] && r[2 * i + 1].n > 0), r.filter((x, i) => i % 2).slice(0, 5));

  const edge = await write(A, VA, [
    { k: key('edge-v'), h: stamp(t, 90), j: big(65536), t: 60 },
    { k: 'zt~' + big(509), h: stamp(t, 91), j: '1', t: 60 },
    { k: key('edge-f'), h: stamp(t + 4 * 60000), j: '1', t: 60 },
    { k: key('edge-h'), h: stamp(t, 92, big(47)), j: '1', t: 60 },
    { k: key('edge-字'), h: stamp(t, 93), j: '{"zh":"沒差","e":"😀"}', t: 60 }]);
  ok('just inside every limit is taken (65,536 bytes; a 512-byte key; four minutes ahead; a 63-character stamp)', R(edge).every(x => x.n > 0), edge.text.slice(0, 300));
  const zh = await one(A, key('edge-字'));
  ok('Chinese and emoji come back byte for byte', zh && zh.j === '{"zh":"沒差","e":"😀"}', zh);
});

section('what refuses the whole call', async () => {
  let w = await write(A, VA, { k: 'zt~x' });
  ok('records that are not a list → 400 rec:shape', says(w, 400, 'rec:shape'), w.text);
  w = await write(A, 0, []);
  ok('format 0 → 400 rec:shape', says(w, 400, 'rec:shape'), w.text);
  w = await write(A, VA, Array.from({ length: 1001 }, () => 0));
  ok('1,001 records → 400 rec:batch', says(w, 400, 'rec:batch'), w.text);
  w = await write(A, VA, Array.from({ length: 1000 }, () => 0));
  ok('1,000 is allowed', w.status === 200 && R(w).length === 1000, w.text.slice(0, 200));
  const before = (await head(A)).json.n;
  w = await write(A, VA, [{ k: key('nul-ok'), h: stamp(now(), 1), j: 'fine', t: 60 }, { k: key('nul'), h: stamp(now(), 2), j: 'a\u0000b', t: 60 }]);
  ok('a value holding U+0000 fails the whole call, good records with it (the app must set such a record aside)', w.status >= 400 && (await head(A)).json.n === before, [w.status, w.text]);
});

/* ---------- 3. the attacks ---------- */

section('another person\'s records', async () => {
  const k = key('secret');
  await write(A, VA, [{ k, h: stamp(now(), 1), j: 'A\'s own', t: TTL }]);
  let r = await rows(B, 'select=k,j&k=eq.' + encodeURIComponent(k));
  ok('B asks for A\'s record by its key: nothing', r.status === 200 && r.json.length === 0, r.text);
  r = await rows(B, 'select=k&k=like.zt~' + RUN + '*');
  ok('B lists this run\'s keys: none of A\'s', r.status === 200 && r.json.length === 0, r.text.slice(0, 200));
  r = await rows(B, 'select=k&owner=eq.' + A.id);
  ok('B filters by A as owner: refused or empty', r.status >= 400 || (r.json && r.json.length === 0), r.text);
  r = await rows(A, 'select=owner,at,x&limit=1');
  ok('the owner, time and expiry columns are not served, even to their owner', r.status >= 400, r.text);
  r = await http('GET', '/rest/v1/rec_owner?select=*', { token: A.token });
  ok('the counters table is not served', r.status >= 400, r.text);

  const w = await write(B, VB, [{ k, h: stamp(now() + 60000, 1), j: 'B was here', owner: A.id, t: TTL }]);
  const mine = await one(A, k), theirs = await one(B, k);
  ok('B writes A\'s key naming A as owner: it lands under B, and A\'s record stands', R(w)[0] && R(w)[0].n > 0 && mine.j === 'A\'s own' && theirs && theirs.j === 'B was here', [w.text, mine, theirs]);
});

section('getting round rec_write', async () => {
  const k = key('direct'), s = stamp(now(), 1);
  await write(A, VA, [{ k, h: s, j: 'as written', t: TTL }]);
  const tries = [
    ['A inserts a row straight into the table', 'POST', '/rest/v1/rec', A, { k: key('raw'), h: stamp(now()), j: '1', n: 1 }],
    ['A inserts a row naming B as owner', 'POST', '/rest/v1/rec', A, { owner: B.id, k: key('raw2'), h: stamp(now()), j: '1', n: 1 }],
    ['A updates its own row in place', 'PATCH', '/rest/v1/rec?k=eq.' + encodeURIComponent(k), A, { j: 'changed', h: stamp(now() + 1000) }],
    ['A deletes its own row', 'DELETE', '/rest/v1/rec?k=eq.' + encodeURIComponent(k), A, undefined],
    ['B updates A\'s row', 'PATCH', '/rest/v1/rec?k=eq.' + encodeURIComponent(k), B, { j: 'changed' }],
    ['B deletes A\'s row', 'DELETE', '/rest/v1/rec?k=eq.' + encodeURIComponent(k), B, undefined]
  ];
  for (const [name, method, path, who, body] of tries) {
    const r = await http(method, path, { token: who.token, body, headers: { Prefer: 'return=representation' } });
    const row = await one(A, k);
    ok(`${name}: refused, nothing changed`, r.status >= 400 && row && row.j === 'as written' && row.h === s, [r.status, r.text.slice(0, 160), row]);
  }
  const raw = await rows(A, 'select=k&k=in.(' + [key('raw'), key('raw2')].map(encodeURIComponent).join(',') + ')'), rawB = await rows(B, 'select=k&k=eq.' + encodeURIComponent(key('raw2')));
  ok('and no row came of the inserts', raw.json && raw.json.length === 0 && rawB.json && rawB.json.length === 0, [raw.text, rawB.text]);
});

section('a client that is not signed in', async () => {
  let r = await rows(null, 'select=k&limit=5');
  ok('reads nothing', r.status >= 400 || (r.json && r.json.length === 0), r.text);
  r = await write(null, 1, [{ k: key('anon'), h: stamp(now()), j: '1' }]);
  ok('cannot call rec_write', r.status === 401 || r.status === 403, [r.status, r.text]);
  r = await head(null);
  ok('cannot call rec_head', r.status === 401 || r.status === 403, [r.status, r.text]);
  r = await write({ token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify({ sub: A.id, role: 'authenticated', exp: 4102444800 })).toString('base64url') + '.forged' }, 1, []);
  ok('a token signed by someone else is refused', r.status === 401 || r.status === 403, [r.status, r.text]);

  const s2 = await signIn(C.a), k = key('after-signout');
  let w = await write(s2, VA, [{ k, h: stamp(now(), 1), j: 'while signed in', t: TTL }]);
  const out = await http('POST', '/auth/v1/logout?scope=local', { token: s2.token });
  w = await write(s2, VA, [{ k, h: stamp(now() + 1000, 2), j: 'after signing out', t: TTL }]);
  ok('a device that signed out cannot write with the token it still holds', out.status < 300 && (w.status === 401 || w.status === 403), [out.status, w.status, w.text]);
  r = await rows(s2, 'select=k&limit=5');
  ok('…nor read', r.status >= 400 || (r.json && r.json.length === 0), r.text.slice(0, 200));
  r = await head(s2);
  ok('…nor ask for the head', r.status >= 400 || r.json === null, r.text);
  const row = await one(A, k);
  ok('…and the other device of the same person is still signed in and sees the last good version', row && row.j === 'while signed in', row);
});

section('the realtime signal', async () => {
  const topic = 'rec:' + A.id;
  /* A project nobody has listened to for a few days has no place for today's signals: the first join is refused
     ("MissingPartition"), Realtime makes the place, and the next join is taken (seen on 21 November 2026, five days
     after the last run). The app's adapter must do what this does: try a refused join again, and ask rec_head once
     it is in, because a signal sent meanwhile is gone. */
  let mine = channel(topic, { token: A.token }), cold = false;
  for (let i = 0; i < 4 && (await mine.joined) !== 'ok' && /MissingPartition/.test(mine.reason); i++) {
    cold = true; mine.close(); await sleep(2000);
    mine = channel(topic, { token: A.token });
  }
  if (cold) console.log('  (the first join was refused, MissingPartition: the project had been idle; joined again)');
  const theirs = channel(topic, { token: B.token }), anon = channel(topic, {});
  const pubB = channel(topic, { token: B.token, priv: false }), pubAnon = channel(topic, { priv: false });
  await Promise.all([mine.joined, theirs.joined, anon.joined, pubB.joined, pubAnon.joined]);
  ok('A joins its own private channel', mine.status === 'ok', mine.reason);
  ok('B cannot join A\'s private channel', theirs.status === 'refused', theirs.reason);
  ok('a client that is not signed in cannot join it', anon.status === 'refused', anon.reason);

  const w = await write(A, VA, [{ k: key('signal'), h: stamp(now(), 1), j: 'ping', t: TTL }]), n = w.json && w.json.n;
  const heard = await mine.wait(m => m.event === 'n' && m.payload && m.payload.n === n);
  ok('A\'s write reaches A\'s channel as the new change number, and nothing else', heard && mine.got.every(m => Object.keys(m.payload).sort().join() === 'id,n'), mine.got);
  await sleep(1500);
  ok('B and the stranger heard nothing, on the private channel or on a public one of the same name', !theirs.got.length && !anon.got.length && !pubB.got.length && !pubAnon.got.length, [theirs.got, anon.got, pubB.got, pubAnon.got]);

  /* forged signals: on a public channel of the same name, on the private one, and through the HTTP door */
  const before = mine.got.length;
  if (pubB.status === 'ok') pubB.send('n', { n: 999999999 });
  if (pubAnon.status === 'ok') pubAnon.send('n', { n: 999999998 });
  const mine2 = channel(topic, { token: A.token }); await mine2.joined;
  if (mine2.status === 'ok') mine2.send('n', { n: 999999997 });
  const viaHttp = await http('POST', '/realtime/v1/api/broadcast', { token: B.token, body: { messages: [{ topic, event: 'n', payload: { n: 999999996 }, private: true }] } });
  await sleep(2500);
  const forged = mine.got.slice(before).map(m => m.payload && m.payload.n);
  ok('nobody can put a signal on A\'s channel: not B, not a stranger, not A\'s own device', forged.length === 0, { forged, http: viaHttp.status, public: [pubB.status, pubAnon.status] });
  for (const c of [mine, mine2, theirs, anon, pubB, pubAnon]) c.close();
});

section('an account that is full', async () => {
  const big = 'f'.repeat(65536); let full = null, sent = 0;
  for (let call = 0; call < 12 && !full; call++) {
    const w = await write(A, VA, Array.from({ length: 15 }, (_, i) => ({ k: key(`fill${call}-${i}`), h: stamp(now(), i), j: big, t: 60 })));
    if (w.status !== 200) { full = { broke: w.status, text: w.text.slice(0, 200) }; break; }
    sent += 15; full = R(w).find(x => x.no) || null;
  }
  ok(`after ${sent} records of 64 KB the account takes no more: full`, full && full.no === 'full', full);
  const small = await write(A, VA, [{ k: key('fill-small'), h: stamp(now()), j: big.slice(0, 20000), t: 60 }]);
  ok('…and stays under its 8 MB whatever is tried next', R(small)[0] && (R(small)[0].no === 'full' || R(small)[0].n > 0), small.text.slice(0, 200));
  const w = await write(B, VB, [{ k: key('bystander'), h: stamp(now()), j: big, t: 60 }]);
  ok('B, beside it, writes as usual', w.status === 200 && R(w)[0].n > 0, w.text.slice(0, 200));
}, { slow: true });

section('a flood of writes', async () => {
  const junk = Array.from({ length: 1000 }, () => 0); let at = 0, last = null;
  for (let call = 1; call <= 32 && !at; call++) { last = await write(A, VA, junk); if (last.status !== 200) at = call; }
  ok('past 30,000 records in a minute the account is told to slow down → 429 rec:slow', at > 0 && at <= 31 && says(last, 429, 'rec:slow'), [at, last && last.status, last && last.text.slice(0, 200)]);
  const w = await write(B, VB, [{ k: key('bystander2'), h: stamp(now()), j: 'unbothered', t: 60 }]);
  ok('B, beside it, writes as usual', w.status === 200 && R(w)[0].n > 0, w.text.slice(0, 200));
  const r = await rows(A, 'select=k&limit=1');
  ok('A can still read', r.status === 200, r.text.slice(0, 200));
}, { slow: true });

section('a record with a time to live', async () => {
  const wait = 62000 - (Date.now() - started);
  if (wait > 0) { console.log(`  (waiting ${Math.ceil(wait / 1000)} s for a record written at the start to pass its minute)`); await sleep(wait); }
  const gone = await one(A, kExpire);
  ok('after its time it is no longer read', gone === undefined, gone);
  let w = null;
  for (let i = 0; i < 16; i++) { w = await write(A, VA, [{ k: kExpire, h: stamp(0, 1), j: 'older than old', t: 60 }]); if (w.status !== 429) break; if (i === 0) console.log('  (waiting for the flood\'s minute to pass)'); await sleep(5000); }
  ok('and the server has forgotten it: the key is free for any version', w.status === 200 && R(w)[0].n > 0 && !R(w)[0].old, w.text.slice(0, 200));
}, { slow: true });

section('the record format', async () => {
  let w = await write(B, VB + 1, [{ k: key('fmt'), h: stamp(now(), 1), j: 'from a newer app', t: TTL }]);
  ok('a newer app writes and the account moves to its format', w.status === 200 && (await head(B)).json.v === VB + 1, w.text);
  w = await write(B, VB, [{ k: key('fmt'), h: stamp(now() + 1000, 2), j: 'from the older app', t: TTL }]);
  const row = await one(B, key('fmt'));
  ok('the older app is then refused, whole call → 409 rec:newer', says(w, 409, 'rec:newer') && row && row.j === 'from a newer app', [w.status, w.text, row]);
  ok('it can still read, and rec_head tells it why', (await head(B)).json.v === VB + 1);
  VB++;
});

/* ---------- run ---------- */

for (const g of groups) {
  if (ONLY && !g.name.toLowerCase().includes(ONLY)) continue;
  if (QUICK && g.slow) { console.log(`\n${g.name}: skipped (--quick)`); continue; }
  group = g.name; console.log(`\n${g.name}`);
  try { await g.fn(); } catch (e) { ok('ran to the end', false, e && e.stack || String(e)); }
}
for (const s of [A, B]) await http('POST', '/auth/v1/logout?scope=local', { token: s.token });      /* leave no session behind */
console.log(`\n${passed} passed, ${failed} failed${failures.length ? ':\n  - ' + failures.join('\n  - ') : ''}`);
process.exit(failed ? 1 : 0);

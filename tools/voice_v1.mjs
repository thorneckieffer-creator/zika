#!/usr/bin/env node
/* Voice V1 (docs/voice.md): the same hard words from several sources, side by side. The words and the reading each
   should have are in tools/content/voice_v1_words.txt. Every source's clips are files named <key>.mp3 in a folder
   of ~/.cache/zika-voice/v1/, are measured with the same analysis as V0 (tools/voice_audit.mjs), and go, unnamed and in
   mixed order, onto the blind listening page (tools/voice_listen.html?set=v1).

     node tools/voice_v1.mjs test        the word list against the course data; the SSML for every word
     node tools/voice_v1.mjs ssml [key]  print the SSML Azure would be sent
     node tools/voice_v1.mjs azure       source (b): Azure Speech, each syllable pinned. Needs ~/.config/zika/azure.json
                                         { "key": "…", "region": "eastasia" }; without it, says so and stops
     node tools/voice_v1.mjs score       measure every source that has clips; write the table
     node tools/voice_v1.mjs blind       build the blind listening set from the sources that have clips
     node tools/voice_v1.mjs count       the size of the full set (words, characters, readings, usage phrases) and its cost

   Sources: pack-f, pack-m (a: the present packs, cut out of assets/ by `score`), azure-f, azure-m (b),
   elevenlabs (c: generated through the ElevenLabs connector, one take a word, saved by hand under v1/elevenlabs/),
   breezy (d: tools/build_voice_pack_breezy.py --keys-file, staged; see ~/.cache/zika-voice/v1/breezy-run.sh).
   Nothing here spends money by itself except `azure`, which says what it will bill before it sends anything. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, realpathSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, app, WORDS, hanKey } from './tone_lab.mjs';
import { HOME, OUT, PACKS, READINGS, digits, spoken, zhuyinShown, tracksFor, statsOf, judgeClip, yardstick, tally, rng, shuffle } from './voice_audit.mjs';

const V1 = join(HOME, 'v1'), LIST = join(ROOT, 'tools/content/voice_v1_words.txt');
const SOURCES = { 'pack-f': '(a) the pack, 曉臻', 'pack-m': '(a) the pack, 雲哲', 'azure-f': '(b) Azure 曉臻, pinned', 'azure-m': '(b) Azure 雲哲, pinned', elevenlabs: '(c) ElevenLabs', breezy: '(d) BreezyVoice' };
const GROUPS = { taiwan: 'Taiwan reading', heteronym: 'one reading of several', sandhi3: 'third-tone sandhi', 'yi-bu': '一 and 不', 'v0-pair': 'flagged in V0' };
/* what the listening page says about a word: what to listen for, never how any clip of it measured */
const HINT = { taiwan: 'Taiwan reading 台灣讀音', heteronym: '破音字: this reading', sandhi3: 'two third tones together', 'yi-bu': '一 / 不', 'v0-pair': '' };
const json = f => JSON.parse(readFileSync(f, 'utf8')), pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '–';
const put = (f, v) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
const byId = Object.fromEntries(WORDS.map(w => [w.id, w]));
/* pyKey() of js/audio.js and py_id() of the BreezyVoice builder: the pinyin as a key suffix */
const pyId = p => String(p || '').split('/')[0].toLowerCase().normalize('NFC').replace(/[\s'’\-·,，!！]/g, '');

/* ---------- the word list ---------- */
export function wordList() {
  return readFileSync(LIST, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => { const [key, id, pinyin, z, group] = l.split('\t');
    const word = key.split('@')[0], chars = [...word], syl = z.split(' ');
    return { key, id, word, chars, pinyin, syl, group, written: digits(syl, chars), tones: spoken(chars, digits(syl, chars)) }; });
}
/* every line must still be what the course says */
function checkList(list) {
  const bad = [], seen = new Set();
  for (const w of list) {
    const c = byId[w.id]; if (!c) { bad.push(`${w.key}: no word ${w.id}`); continue; }
    if (hanKey(c.t) !== w.word) bad.push(`${w.key}: ${w.id} is ${c.t}`);
    if (c.p !== w.pinyin) bad.push(`${w.key}: pinyin is ${c.p}, the list says ${w.pinyin}`);
    const z = READINGS.words[w.id] || w.chars.map(ch => READINGS.chars[ch]);
    if (z.join(' ') !== w.syl.join(' ')) bad.push(`${w.key}: 注音 is ${z.join(' ')}, the list says ${w.syl.join(' ')}`);
    if (w.syl.length !== w.chars.length) bad.push(`${w.key}: ${w.syl.length} syllables for ${w.chars.length} characters`);
    const py = Array.from(app.toneSeq(w.pinyin), t => t || 5); if (py.join() !== w.written.join()) bad.push(`${w.key}: 注音 tones ${w.written.join('')} but pinyin tones ${py.join('')}`);
    const others = new Set(WORDS.filter(x => hanKey(x.t) === w.word).map(x => pyId(x.p)));
    if ((others.size > 1) !== w.key.includes('@') || (w.key.includes('@') && w.key.split('@')[1] !== pyId(w.pinyin))) bad.push(`${w.key}: the key should be ${w.word}${others.size > 1 ? '@' + pyId(w.pinyin) : ''}`);
    if (!GROUPS[w.group]) bad.push(`${w.key}: unknown group ${w.group}`);
    if (seen.has(w.key)) bad.push(`${w.key}: twice`); seen.add(w.key);
  }
  return bad;
}

/* ---------- source (b): Azure Speech, every syllable pinned ---------- */
/* The `sapi` phone set for zh-TW is bopomofo with the tone written after the syllable: nothing or ˉ for the first tone,
   ˊ ˇ ˋ, and ˙ for the neutral tone; syllables are separated by a space. Microsoft's example:
   <phoneme alphabet="sapi" ph="ㄋㄧˇ ㄏㄠˇ">你好</phoneme>   (learn.microsoft.com, speech-ssml-phonetic-sets, read 21 November 2026)
   That example pins 你好 with its written tones, third + third, so the default here is the written tones too;
   `--spoken` pins the tones after sandhi instead. Which of the two the service says right is for the first run to show. */
const AZ_TONE = ['', '', 'ˊ', 'ˇ', 'ˋ', '˙'];
export const AZ_VOICES = { f: 'zh-TW-HsiaoChenNeural', m: 'zh-TW-YunJheNeural' };
const xml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function sapi(w, useSpoken) { const t = useSpoken ? w.tones : w.written; return w.syl.map((s, i) => s.slice(0, -1) + AZ_TONE[t[i]]).join(' '); }
/* the packs were recorded at −12% (tools/build_voice_pack.py), so the comparison is at the same pace */
export function ssml(w, voice, useSpoken, rate = '-12%') {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW"><voice name="${xml(voice)}"><prosody rate="${xml(rate)}"><phoneme alphabet="sapi" ph="${xml(sapi(w, useSpoken))}">${xml(w.word)}</phoneme></prosody></voice></speak>`;
}
/* Azure bills a Chinese character as two characters and bills all markup but <speak> and <voice> (learn.microsoft.com,
   text-to-speech, "billable characters"). Whether a bopomofo symbol counts once or twice is not stated: twice here. */
export function azureBilled(doc) {
  const inner = doc.replace(/^<speak[^>]*><voice[^>]*>/, '').replace(/<\/voice><\/speak>$/, ''); let n = 0;
  for (const ch of inner) n += /[⺀-鿿＀-￯ㄅ-ㄯˉˊˇˋ˙]/.test(ch) ? 2 : 1; return n;
}
async function azure(list) {
  const cfg = join(homedir(), '.config/zika/azure.json'), useSpoken = process.argv.includes('--spoken');
  if (!existsSync(cfg)) { console.log(`(b) not run: no key. Azure Speech needs ${cfg} with { "key": "…", "region": "…" }; nothing was sent.`); return; }
  const { key, region } = json(cfg), todo = [];
  for (const v of Object.keys(AZ_VOICES)) for (const w of list) { const f = join(V1, 'azure-' + v, w.key + '.mp3'); if (!existsSync(f)) todo.push({ v, w, f, doc: ssml(w, AZ_VOICES[v], useSpoken) }); }
  console.log(`${todo.length} clips to make, about ${todo.reduce((n, t) => n + azureBilled(t.doc), 0)} billed characters${useSpoken ? ' (tones pinned as spoken)' : ' (tones pinned as written)'}`);
  for (const t of todo) {
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', body: t.doc,
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'tts-client' } });
    if (!r.ok) { console.log(`  ! ${t.w.key} (${t.v}): ${r.status} ${(await r.text()).slice(0, 120)}`); if (r.status === 401 || r.status === 403) break; continue; }
    mkdirSync(join(t.f, '..'), { recursive: true }); writeFileSync(t.f, Buffer.from(await r.arrayBuffer()));
    await new Promise(ok => setTimeout(ok, 250));
  }
}

/* ---------- test ---------- */
function test(list) {
  let failed = 0; const say = (ok, what) => { console.log((ok ? '  ok    ' : '  FAIL  ') + what); if (!ok) failed++; };
  const bad = checkList(list); say(!bad.length, bad.length ? 'the word list: ' + bad.join('; ') : `${list.length} words, each as the course data has it (word, pinyin, 注音, key)`);
  const groups = {}; for (const w of list) groups[w.group] = (groups[w.group] || 0) + 1; console.log('        ' + Object.entries(groups).map(([g, n]) => `${GROUPS[g]} ${n}`).join(' · '));
  const SYL = /^[ㄅ-ㄩ]+[ˊˇˋ˙]?$/, back = { '': 1, 'ˊ': 2, 'ˇ': 3, 'ˋ': 4, '˙': 5 }; let shape = [], round = [], form = [], n = 0;
  for (const w of list) for (const v of Object.keys(AZ_VOICES)) for (const sp of [false, true]) {
    const doc = ssml(w, AZ_VOICES[v], sp), m = /^<speak version="1\.0" xmlns="http:\/\/www\.w3\.org\/2001\/10\/synthesis" xml:lang="zh-TW"><voice name="(zh-TW-\w+Neural)"><prosody rate="-12%"><phoneme alphabet="sapi" ph="([^"<>&]*)">([^<>&]*)<\/phoneme><\/prosody><\/voice><\/speak>$/.exec(doc); n++;
    if (!m || m[1] !== AZ_VOICES[v] || m[3] !== w.word) { form.push(w.key); continue; }
    const syl = m[2].split(' '); if (syl.length !== w.chars.length || syl.some(s => !SYL.test(s))) { shape.push(w.key); continue; }
    const tones = syl.map(s => back[s.replace(/[ㄅ-ㄩ]/g, '')]), body = syl.map(s => s.replace(/[ˊˇˋ˙]/g, ''));
    if (tones.join() !== (sp ? w.tones : w.written).join() || body.join() !== w.syl.map(s => s.slice(0, -1)).join()) round.push(w.key);
  }
  say(!form.length, form.length ? 'SSML not of the expected form: ' + form.join(' ') : `${n} SSML documents (two voices, tones as written and as spoken) have the form Azure documents`);
  say(!shape.length, shape.length ? 'ph with the wrong syllables: ' + shape.join(' ') : 'every ph has one bopomofo syllable per character, tone mark last');
  say(!round.length, round.length ? 'ph does not read back as the 注音: ' + round.join(' ') : 'every ph reads back as the 注音 of readings.json (and, with --spoken, with sandhi applied)');
  const ex = k => list.find(w => w.key === k), chk = (k, sp, want) => say(ex(k) && sapi(ex(k), sp) === want, `${k}${sp ? ' as spoken' : ''} → ${ex(k) ? sapi(ex(k), sp) : '(not in the list)'}`);
  chk('星期', false, 'ㄒㄧㄥ ㄑㄧˊ'); chk('垃圾', false, 'ㄌㄜˋ ㄙㄜˋ'); chk('和', false, 'ㄏㄢˋ'); chk('得@děi', false, 'ㄉㄟˇ'); chk('覺得', false, 'ㄐㄩㄝˊ ㄉㄜ˙');
  chk('你好', false, 'ㄋㄧˇ ㄏㄠˇ'); chk('你好', true, 'ㄋㄧˊ ㄏㄠˇ'); chk('展覽館', true, 'ㄓㄢˊ ㄌㄢˊ ㄍㄨㄢˇ'); chk('不客氣', false, 'ㄅㄨˊ ㄎㄜˋ ㄑㄧˋ'); chk('第一手', true, 'ㄉㄧˋ ㄧ ㄕㄡˇ');
  say(xml(`<&"'>`) === '&lt;&amp;&quot;&apos;&gt;', 'text is escaped for XML');
  /* <prosody rate="-12%"> 21 + <phoneme alphabet="sapi" ph=" 29 + six bopomofo symbols and marks twice and a space 13 + "> 2 + 你好 4 + </phoneme></prosody> 20 */
  const one = azureBilled(ssml(ex('你好'), AZ_VOICES.f, false)); say(one === 89, `billed characters for 你好, pinned: ${one} (markup once, each Han character and bopomofo symbol twice; <speak> and <voice> free)`);
  console.log(failed ? `\n${failed} check(s) failed` : '\nthe list and the SSML are as they should be (no request was sent to Azure)'); process.exit(failed ? 1 : 0);
}

/* ---------- score ---------- */
function clipFiles(list) {
  /* source (a): cut the words' clips out of the packs, under the list's own keys (the packs have one clip per set of characters) */
  for (const [v, P] of Object.entries(PACKS)) { const idx = json(join(ROOT, 'assets', P.file + '-index.json')), pack = readFileSync(join(ROOT, 'assets', P.file + '.pack')), dir = join(V1, 'pack-' + v); mkdirSync(dir, { recursive: true });
    for (const w of list) if (idx[w.word]) writeFileSync(join(dir, w.key + '.mp3'), pack.subarray(idx[w.word][0], idx[w.word][0] + idx[w.word][1])); }
  const out = {}; for (const s of Object.keys(SOURCES)) { const dir = join(V1, s); out[s] = list.filter(w => existsSync(join(dir, w.key + '.mp3')) && statSync(join(dir, w.key + '.mp3')).size > 500).map(w => ({ w, file: join(dir, w.key + '.mp3') })); }
  return out;
}
/* a voice's mid pitch and spread: for the packs, the figure V0 measured over the whole pack; for another source, its own
   clips (and, for the few BreezyVoice clips, every clip that voice has in its cache); else none, and each take is
   judged against its own middle, as the coach does before it knows a voice */
function speakerOf(source, tracks, keys) {
  const v0 = join(OUT, 'summary.json');
  if (source.startsWith('pack-') && existsSync(v0)) return { sp: json(v0).speakers[source.slice(5)].sp, how: 'the whole pack (V0)' };
  if (source === 'breezy') { const dir = join(HOME, 'breezy-dce6a0e425'); if (existsSync(dir)) { const fs = readdirSync(dir).filter(f => f.endsWith('.mp3')), t = tracksFor('v1-breezy-voice', fs.map(f => ({ k: f + ':' + statSync(join(dir, f)).size, bytes: () => readFileSync(join(dir, f)) }))), sp = statsOf(t, [...t.keys()]); if (sp) return { sp, how: `the ${fs.length} clips this voice has in its cache` }; } }
  const sp = statsOf(tracks, keys); return { sp, how: sp ? 'its own clips' : 'none: each clip against its own middle' };
}
function score(list) {
  const bad = checkList(list); if (bad.length) { console.error('the word list does not match the course data:\n  ' + bad.join('\n  ')); process.exit(1); }
  const files = clipFiles(list), Y = yardstick(m => console.log(m)), rows = [], res = {}, judged = {};
  for (const [s, clips] of Object.entries(files)) {
    if (!clips.length) { res[s] = null; continue; }
    const tracks = tracksFor('v1-' + s, clips.map(c => ({ k: c.w.key + ':' + statSync(c.file).size, bytes: () => readFileSync(c.file) }))), tk = c => c.w.key + ':' + statSync(c.file).size;
    const { sp, how } = speakerOf(s, tracks, clips.map(tk)), out = clips.map(c => Object.assign({ source: s, key: c.w.key, group: c.w.group, n: c.w.chars.length, alts: 1 }, judgeClip(tracks.get(tk(c)), c.w.chars.length, { cands: [{ t: c.w.tones, from: 'list' }] }, sp, Y.net)));
    rows.push(...out); judged[s] = out; const T = tally(out), g = {};
    for (const k of Object.keys(GROUPS)) { const t = tally(out.filter(c => c.group === k)); g[k] = [t.graded - t.off, t.graded]; }
    res[s] = { clips: clips.length, speaker: sp, how, T, g, failed: out.filter(c => c.status !== 'ok').map(c => `${c.key} (${c.status})`), flagged: out.filter(c => c.flag).map(c => `${c.key} ${c.syl.map(x => x.want).join('')}→${c.syl.map(x => x.heard).join('')}`) };
  }
  const L = [`# Voice V1 — side by side on ${list.length} hard words`, '', `Made ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by tools/voice_v1.mjs. Agreement is the analysis against the expected tone: a suspect, not a verdict.`, '',
    '| source | clips | could not be measured | graded syllables | agree with the expected tone (app\'s classifier) | (held-out classifier) | clips with every tone agreeing | the packs on the same words: 曉臻, 雲哲 |', '|---|---|---|---|---|---|---|---|'];
  /* a source that has only some of the words is compared with the packs on those words alone */
  const same = (s, v) => { const keys = new Set(judged[s].map(c => c.key)), t = tally((judged['pack-' + v] || []).filter(c => keys.has(c.key))); return `${t.graded - t.off}/${t.graded}`; };
  for (const [s, r] of Object.entries(res)) { if (r && !s.startsWith('pack-')) r.packsOnSame = { f: same(s, 'f'), m: same(s, 'm') };
    L.push(r ? `| ${SOURCES[s]} | ${r.clips} of ${list.length} | ${r.failed.length} | ${r.T.graded} | **${r.T.graded - r.T.off}/${r.T.graded} (${pct(r.T.graded - r.T.off, r.T.graded)})** | ${r.T.graded - r.T.offHeld}/${r.T.graded} (${pct(r.T.graded - r.T.offHeld, r.T.graded)}) | ${r.T.ok - r.T.clipFlag} of ${r.T.ok} | ${r.packsOnSame ? r.packsOnSame.f + ', ' + r.packsOnSame.m : ''} |` : `| ${SOURCES[s]} | not run | | | | | | |`); }
  L.push('', 'By group (syllables agreeing, app\'s classifier):', '', '| source | ' + Object.values(GROUPS).join(' | ') + ' |', '|---|' + Object.keys(GROUPS).map(() => '---').join('|') + '|');
  for (const [s, r] of Object.entries(res)) if (r) L.push(`| ${SOURCES[s]} | ` + Object.keys(GROUPS).map(k => `${r.g[k][0]}/${r.g[k][1]}`).join(' | ') + ' |');
  L.push('');
  for (const [s, r] of Object.entries(res)) if (r) L.push(`**${SOURCES[s]}** — voice measured from ${r.how}${r.speaker ? ` (mid ${r.speaker.base.toFixed(1)} st, spread ${r.speaker.sd.toFixed(1)})` : ''}.${r.failed.length ? ' Not measured: ' + r.failed.join(', ') + '.' : ''} Expected→measured where they differ: ${r.flagged.join(', ') || 'none'}.`, '');
  mkdirSync(V1, { recursive: true }); put(join(V1, 'scores.md'), L.join('\n') + '\n'); put(join(V1, 'scores.json'), { made: new Date().toISOString(), words: list.length, sources: res }); put(join(V1, 'clips.json'), rows);
  const csv = ['source,key,group,status,expected,measured,confidence,verdict,flag,measured_heldout,flag_heldout'];
  for (const c of rows) { const y = c.syl || [], j = f => y.map(f).join(' '); csv.push([c.source, c.key, c.group, c.status, j(x => x.want), j(x => x.heard), j(x => x.conf), j(x => x.verdict), c.flag ? 1 : 0, j(x => x.heardHeld), c.flagHeld ? 1 : 0].join(',')); }
  put(join(V1, 'clips.csv'), csv.join('\n') + '\n');
  console.log(L.join('\n') + '\nwritten: ' + ['scores.md', 'scores.json', 'clips.csv', 'clips.json'].map(f => join(V1, f)).join('  '));
}

/* ---------- the blind listening set ---------- */
/* One card per word, the sources' clips under it in an order shuffled for each word, as files with meaningless names.
   Which source a clip is, and whether the analysis flagged it, is in listen-v1-key.json, which the page never loads.
   The words are shuffled too, so a session that stops half-way is still a fair sample. */
function blind(list) {
  const seed = +(process.argv.find(a => /^--seed=/.test(a)) || '--seed=20261121').slice(7), r = rng(seed), files = clipFiles(list), dir = join(V1, 'blind');
  const flags = existsSync(join(V1, 'clips.json')) ? Object.fromEntries(json(join(V1, 'clips.json')).map(c => [c.source + ' ' + c.key, c])) : {};
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const items = [], answers = {}, used = new Set(), name = () => { let n; do n = Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0'); while (used.has(n)); used.add(n); return n; };
  shuffle(list, r).forEach((w, i) => {
    const id = 'w' + String(i + 1).padStart(2, '0'), have = shuffle(Object.keys(SOURCES).filter(s => files[s].some(c => c.w.key === w.key)), r); if (!have.length) return;
    const clips = have.map((s, k) => { const cid = id + 'abcdefgh'[k], f = name() + '.mp3', c = flags[s + ' ' + w.key]; copyFileSync(files[s].find(x => x.w.key === w.key).file, join(dir, f));
      answers[cid] = { source: SOURCES[s], word: w.word, key: w.key, group: w.group, flag: !!(c && c.flag), measured: c && c.syl ? c.syl.map(x => x.heard) : null, want: w.tones }; return { id: cid, url: '/_voice/v1/blind/' + f }; });
    items.push({ id, word: w.word, pinyin: w.pinyin, zhuyin: zhuyinShown(w.syl), tones: w.tones, note: HINT[w.group], clips });
  });
  put(join(V1, 'listen-v1.json'), { set: 'v1', title: 'Voice V1 — the same word, several voices', intro: 'the voices are not named, and their order changes from word to word', seed, made: new Date().toISOString(), items });
  put(join(V1, 'listen-v1-key.json'), { set: 'v1', seed, answers });
  const per = {}; Object.values(answers).forEach(a => { per[a.source] = (per[a.source] || 0) + 1; });
  console.log(`${items.length} words, ${Object.keys(answers).length} clips (seed ${seed}):`, per); console.log('written:', join(V1, 'listen-v1.json'), 'and', join(V1, 'listen-v1-key.json'), '(which source each clip is, for `node tools/voice_audit.mjs score`)');
}

/* ---------- the full set and what it would cost ---------- */
/* Prices as read on 21 November 2026 (sources in docs/voice.md). They are constants here so the arithmetic can be run again. */
const PRICE = { azurePerMillion: 15, azureFreePerMonth: 500000, elevenPlans: [['Starter', 6, 30000], ['Creator', 22, 121000], ['Pro', 99, 600000]], breezySecondsPerClip: 21.6, edgeClipsPerHour: 190 };
function count() {
  const USAGE = JSON.parse(readFileSync(join(ROOT, 'data/usage.js'), 'utf8').split('\n').find(l => l.startsWith('const USAGE = ')).slice(14).replace(/;\s*$/, ''));
  const wordKeys = new Set(), chars = new Set(), readings = new Map();
  for (const w of WORDS) { const k = hanKey(w.t); if (!k) continue; wordKeys.add(k); for (const c of k) chars.add(c); if (READINGS.words[w.id]) (readings.get(k) || readings.set(k, new Set()).get(k)).add(pyId(w.p)); }
  const charOnly = [...chars].filter(c => !wordKeys.has(c)), perReading = [...readings].filter(([, s]) => s.size > 1), readingClips = perReading.reduce((n, [, s]) => n + s.size, 0);
  const phrases = new Set(); let lines = 0; for (const id in USAGE) for (const row of USAGE[id]) { lines++; phrases.add(row[0]); }
  const han = t => (t.match(/[㐀-鿿]/g) || []).length, sum = (it, f) => { let n = 0; for (const x of it) n += f(x); return n; };
  const set = { words: { clips: wordKeys.size, han: sum(wordKeys, han), all: sum(wordKeys, k => [...k].length) }, characters: { clips: charOnly.length, han: charOnly.length, all: charOnly.length },
    readings: { clips: readingClips, han: sum(perReading, ([k, s]) => han(k) * s.size), all: sum(perReading, ([k, s]) => [...k].length * s.size) }, phrases: { clips: phrases.size, han: sum(phrases, han), all: sum(phrases, p => [...p].length) } };
  const tot = k => Object.values(set).reduce((n, s) => n + s[k], 0), clips = tot('clips'), hanAll = tot('han'), allChars = tot('all');
  /* Azure: plain text bills a Han character and a full-width mark twice; pinned, each word, character and reading also carries its phoneme markup */
  const bill = t => { let n = 0; for (const ch of t) n += /[⺀-鿿＀-￯、-〿]/.test(ch) ? 2 : 1; return n; };
  const azPlain = sum(wordKeys, bill) + charOnly.length * 2 + sum(perReading, ([k, s]) => bill(k) * s.size) + sum(phrases, bill);
  const pinOne = (k, z) => azureBilled(ssml({ word: k, syl: z, written: z.map(s => +s.slice(-1)), tones: [] }, AZ_VOICES.f, false));
  const firstZ = {}; for (const w of WORDS) { const k = hanKey(w.t); if (k && !firstZ[k] && READINGS.words[w.id] && READINGS.words[w.id].length === [...k].length) firstZ[k] = READINGS.words[w.id]; }
  const zOf = k => firstZ[k] || ([...k].every(c => READINGS.chars[c]) ? [...k].map(c => READINGS.chars[c]) : null);
  let azPinned = sum(phrases, bill), unpinned = 0; for (const k of [...wordKeys, ...charOnly]) { const z = zOf(k); if (z) azPinned += pinOne(k, z); else { azPinned += bill(k); unpinned++; } }
  for (const [k, s] of perReading) azPinned += s.size * pinOne(k, zOf(k));
  const usd = n => '$' + n.toFixed(2), plan = n => { const p = PRICE.elevenPlans.find(x => x[2] >= n); return p ? `${p[0]} for one month, $${p[1]} (${p[2].toLocaleString('en')} credits)` : `more than one month of ${PRICE.elevenPlans.at(-1)[0]}`; };
  const L = ['The full set, counted from data/words.js, tools/content/readings.json and data/usage.js:', '', '| | clips | Han characters | characters with punctuation |', '|---|---|---|---|',
    `| words (distinct sets of characters; ${WORDS.length} entries) | ${set.words.clips} | ${set.words.han} | ${set.words.all} |`, `| characters that are not words on their own (of ${chars.size} in all) | ${set.characters.clips} | ${set.characters.han} | ${set.characters.all} |`,
    `| a clip per reading, for the ${perReading.length} sets of characters with more than one (字@pinyin) | ${set.readings.clips} | ${set.readings.han} | ${set.readings.all} |`, `| usage phrases (distinct; ${lines} lines) | ${set.phrases.clips} | ${set.phrases.han} | ${set.phrases.all} |`,
    `| **one voice** | **${clips}** | **${hanAll}** | **${allChars}** |`, '',
    `Azure Speech (neural, $${PRICE.azurePerMillion} per million billed characters; a Han character bills as two): plain text ${azPlain.toLocaleString('en')} billed characters = ${usd(azPlain * PRICE.azurePerMillion / 1e6)} a voice; with every word, character and reading pinned by a phoneme tag ${azPinned.toLocaleString('en')} = ${usd(azPinned * PRICE.azurePerMillion / 1e6)} a voice (${unpinned} keys have no 注音 to pin and go as plain text). Two voices: ${usd(2 * azPinned * PRICE.azurePerMillion / 1e6)}. The free tier's ${PRICE.azureFreePerMonth.toLocaleString('en')} characters a month ${azPinned <= PRICE.azureFreePerMonth ? 'would cover one voice' : 'would not cover one voice'}${2 * azPinned <= PRICE.azureFreePerMonth ? ' and two' : ''}, but its output carries no commercial licence.`,
    `ElevenLabs (one credit a character): ${allChars.toLocaleString('en')} credits a voice → ${plan(allChars)}; two voices ${(2 * allChars).toLocaleString('en')} → ${plan(2 * allChars)}.`,
    `BreezyVoice (free; ${PRICE.breezySecondsPerClip} s a clip measured on short words on this Mac, 14 November): ${(clips * PRICE.breezySecondsPerClip / 3600).toFixed(0)} hours for ${clips} clips, more for the phrases, which are longer.`,
    `The read-aloud service the present packs came from (free; about ${PRICE.edgeClipsPerHour} clips an hour before it throttles): ${(clips / PRICE.edgeClipsPerHour).toFixed(0)} hours a voice.`];
  console.log(L.join('\n')); mkdirSync(V1, { recursive: true }); put(join(V1, 'count.md'), L.join('\n') + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const cmd = process.argv[2], list = wordList();
  if (cmd === 'test') test(list);
  else if (cmd === 'ssml') { for (const w of list) if (!process.argv[3] || w.key === process.argv[3]) console.log(ssml(w, AZ_VOICES.f, process.argv.includes('--spoken'))); }
  else if (cmd === 'azure') await azure(list);
  else if (cmd === 'score') score(list);
  else if (cmd === 'blind') blind(list);
  else if (cmd === 'count') count();
  else { console.error('usage: node tools/voice_v1.mjs test | ssml [key] [--spoken] | azure [--spoken] | score | blind [--seed=N] | count'); process.exit(1); }
}

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check the usage phrases against the vocabulary learned so far, and install them into index.html.

    python3 tools/check_usage.py                 # report only
    python3 tools/check_usage.py --review        # also list every reading the tool had to choose
    python3 tools/check_usage.py --show 2.6      # print one lesson's phrases with their pinyin
    python3 tools/check_usage.py --write         # also (re)write the USAGE line in index.html

The phrases live in tools/content/usage_phrases.txt (the format is described at the top of that file).

Rules, enforced here:
  * a phrase for a word of Book B Lesson L uses only characters met by the end of that lesson (numerals allowed);
  * a phrase contains its headword (or, for a separable verb, the headword's characters in order);
  * every word of a covered lesson that is not a person's name has at least two phrases.

Pinyin is not typed by hand. Each phrase is cut into the longest words WORDS knows, and every word keeps
the publisher's own reading and spacing; characters that stand alone take the reading they have in
WORDS. Standalone 一 and 不 get their tone change. Where one character has several readings (得, 了,
著, 長 …) the default is in DEFAULT below, and a phrase can force one in place: 你得(děi)去.
"""
import argparse, json, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'content' / 'usage_phrases.txt'
HAN = re.compile(r'[㐀-鿿]')
NUM = dict(zip('零一二三四五六七八九十百千萬兩', 'líng yī èr sān sì wǔ liù qī bā jiǔ shí bǎi qiān wàn liǎng'.split()))
PUNCT = {'，': ',', '。': '.', '？': '?', '！': '!', '、': ',', '：': ':', '；': ';', '…': '…', '「': '“', '」': '”', '—': '—'}
ENDS = '。？！'
QUIET = '一不的個會幾和'      # chosen by rule or never in doubt: left out of --review
SUFFIX = '們'          # written onto the word before it: péngyǒumen
# The reading a character takes when it stands alone and WORDS knows more than one full-tone reading.
# (A character with one full-tone reading and a neutral one — 姐 jiě / jie — takes the full tone unless listed here.)
DEFAULT = {'了': 'le', '得': 'de', '著': 'zhe', '地': 'dì', '的': 'de', '個': 'ge', '子': 'zi', '和': 'hàn', '會': 'huì',
           '好': 'hǎo', '長': 'cháng', '當': 'dāng', '便': 'biàn', '覺': 'jué', '樂': 'lè', '為': 'wèi', '行': 'xíng',
           '空': 'kōng', '差': 'chā', '分': 'fēn', '教': 'jiāo', '相': 'xiāng', '應': 'yīng', '調': 'diào', '待': 'dài',
           '擔': 'dān', '幾': 'jǐ', '一': 'yī', '不': 'bù'}
# Everyday words the course uses without listing them (or lists only as a pattern), so they are written as one word.
EXTRA = {'星期': 'xīngqí', '電腦': 'diànnǎo', '第一': 'dìyī', '一下': 'yíxià', '一樣': 'yíyàng', '一些': 'yìxiē',
         '大家': 'dàjiā', '這裡': 'zhèlǐ', '那裡': 'nàlǐ', '這些': 'zhèxiē', '那些': 'nàxiē', '一共': 'yígòng',
         '不用': 'búyòng', '不要': 'búyào', '不會': 'búhuì', '不是': 'búshì', '不太': 'bútài', '不對': 'búduì',
         '沒有': 'méiyǒu', '還有': 'háiyǒu', '只有': 'zhǐyǒu', '這個': 'zhège', '那個': 'nàge',
         '哪個': 'nǎge', '每天': 'měitiān', '每個': 'měi ge', '一個': 'yí ge', '兩個': 'liǎng ge', '幾個': 'jǐ ge',
         '台灣': 'Táiwān', '台北': 'Táiběi', '常常': 'chángcháng', '別人': 'biérén', '有人': 'yǒu rén', '一直': 'yìzhí',
         '一百': 'yìbǎi', '一千': 'yìqiān', '一萬': 'yíwàn', '電子': 'diànzǐ', '假日': 'jiàrì', '可樂': 'kělè',
         '紅包': 'hóngbāo', '公車': 'gōngchē'}
PROPER = {'王': 'Wáng'}   # a surname standing alone keeps its capital
NOJOIN = {'好的'}        # words that would swallow a neighbour: 很好的 is 很好 + 的, not 很 + 好的

# ---------- pinyin syllables ----------
INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w', '']
FINALS = ['iang', 'iong', 'uang', 'ueng', 'ang', 'eng', 'ong', 'iao', 'ian', 'ing', 'uai', 'uan', 'üan', 'ai', 'ei', 'ao', 'ou',
          'an', 'en', 'er', 'ia', 'ie', 'iu', 'in', 'ua', 'uo', 'ui', 'un', 'ue', 'üe', 'ün', 'a', 'o', 'e', 'i', 'u', 'ü']
SYL = {i + f for i in INITIALS for f in FINALS if i or f[0] in 'aoe'}
TONES = {'̄': 1, '́': 2, '̌': 3, '̀': 4}


def plain(s):
    """Lower-case, tone marks removed (ü kept)."""
    out = []
    for ch in unicodedata.normalize('NFD', s.lower()):
        if ch in TONES:
            continue
        out.append(ch)
    return unicodedata.normalize('NFC', ''.join(out))


def tone(syl):
    for ch in unicodedata.normalize('NFD', syl):
        if ch in TONES:
            return TONES[ch]
    return 0


def split_syllables(run, n):
    """Split one run of tone-marked pinyin (no spaces) into exactly n syllables, or None."""
    marks = unicodedata.normalize('NFC', run)
    # walk the marked string and the plain string together, one user-visible letter at a time
    letters = re.findall(r"[a-zA-ZüÜ][̀-ͯ]*|['’]", unicodedata.normalize('NFD', marks).replace('ü', 'ü').replace('Ü', 'Ü'))
    base = [plain(x) if x not in "'’" else "'" for x in letters]
    found = []

    def walk(i, acc):
        if len(found) > 1:
            return
        if i == len(base):
            if len(acc) == n:
                found.append(list(acc))
            return
        if len(acc) >= n:
            return
        apos = base[i] == "'"
        if apos:
            i += 1
        for L in range(6, 0, -1):
            if i + L > len(base) or "'" in base[i:i + L]:
                continue
            s = ''.join(base[i:i + L])
            if s not in SYL:
                continue
            if acc and s[0] in 'aoe' and not apos:      # a syllable inside a word starts with a/o/e only after an apostrophe
                continue
            acc.append((i, i + L))
            walk(i + L, acc)
            acc.pop()

    walk(0, [])
    if len(found) != 1:
        return None
    return [unicodedata.normalize('NFC', ''.join(letters[a:b])) for a, b in found[0]]


def head_of(w):
    """The word itself: no bracketed variant, no “+ noun” pattern text."""
    return re.sub(r'\s*\+\s*[a-z]+|[a-z]+\s*\+\s*', '', w['t'].split('（')[0]).strip()


def word_groups(w):
    """A word's reading as groups of syllables, one syllable per character, keeping the publisher's spacing.
    Returns None when the reading cannot be laid against the characters."""
    t = head_of(w)
    chars = HAN.findall(t)
    if len(chars) != len(t):
        return None
    p = re.split(r'[/(（,]', w['p'])[0].strip()
    erhua = t.endswith('兒') and plain(p).endswith('r') and not plain(p).endswith('er')
    groups, n_left = [], len(chars) - (1 if erhua else 0)
    runs = p.split()
    # try every way of sharing the characters out among the space-separated runs
    def share(k, left):
        if k == len(runs):
            return [[]] if left == 0 else []
        res = []
        run = runs[k][:-1] if (erhua and k == len(runs) - 1) else runs[k]
        for n in range(1, left + 1):
            syl = split_syllables(run, n)
            if syl:
                for rest in share(k + 1, left - n):
                    res.append([syl] + rest)
        return res
    ways = share(0, n_left)
    if len(ways) != 1:
        return None
    groups = ways[0]
    if erhua:
        groups[-1][-1] += 'r'      # 餡兒 xiànr: the 兒 has no syllable of its own
    return groups


def join(syls):
    out = syls[0]
    for s in syls[1:]:
        out += ("'" if plain(s)[0] in 'aoe' else '') + s
    return out


class Reader:
    def __init__(self, WORDS):
        self.words, self.chars, self.unsplit, self.alone = {}, defaultdict(Counter), [], {}
        for t, p in EXTRA.items():
            self.words[t] = word_groups({'t': t, 'p': p}) or sys.exit(f'EXTRA: cannot read {t} {p}')
        for w in WORDS:
            t = head_of(w)
            g = word_groups(w)
            if not g and '（' in w['t']:          # 忘（了） wàngle: the reading covers the bracketed part too
                t = re.sub(r'[（）]', '', w['t'])
                g = word_groups({'t': t, 'p': w['p']})
            if not g:
                self.unsplit.append(w)
                continue
            flat = [s for grp in g for s in grp]
            hs = HAN.findall(t)
            if t.endswith('兒') and len(flat) == len(hs) - 1:
                flat = flat + ['']
            for c, s in zip(hs, flat):
                if s:
                    self.chars[c][s.lower()] += 1
            if t not in self.words or t in EXTRA:
                self.words[t] = g
            if len(hs) == 1 and hs[0] not in self.alone:
                self.alone[hs[0]] = flat[0].lower()
        self.maxlen = max(len(t) for t in self.words)
        self.choices = []          # (char, reading, phrase) for --review

    def single(self, c, phrase, prev=''):
        if c == '了' and prev and prev in '不得':      # 吃不了, 受得了
            return 'liǎo'
        if c in PROPER:
            return PROPER[c]
        opts = self.chars.get(c)
        if not opts:
            return NUM.get(c)
        if c in NUM and c not in DEFAULT:
            return NUM[c]
        if len(opts) == 1:
            return next(iter(opts))
        toned = [r for r in opts if tone(r)]
        r = DEFAULT.get(c) or (toned[0] if len(toned) == 1 else None)
        guessed = r is None
        if guessed:
            r = self.alone.get(c) or opts.most_common(1)[0][0]
        if c in DEFAULT or guessed:
            self.choices.append((c, r, phrase, guessed))
        return r

    def read(self, text):
        """text may carry forced readings: 你得(děi)去. Returns (clean text, pinyin)."""
        forced, clean = {}, ''
        i = 0
        while i < len(text):
            m = re.match(r'\(([^)]+)\)', text[i:])
            if m and clean:
                forced[len(clean) - 1] = m.group(1)
                i += m.end()
                continue
            clean += text[i]
            i += 1
        toks = []      # [kind, text, start] kind: 'w' word groups, 'c' single, 'p' punct
        i = 0
        while i < len(clean):
            hit = None
            for L in range(min(self.maxlen, len(clean) - i), 1, -1):
                s = clean[i:i + L]
                if s in self.words and (s not in NOJOIN or s == clean) and not any(k in forced for k in range(i, i + L)):
                    hit = s
                    break
            if hit:
                toks.append(['w', [list(g) for g in self.words[hit]], i, hit])
                i += len(hit)
                continue
            ch = clean[i]
            if HAN.match(ch):
                toks.append(['c', forced.get(i) or self.single(ch, clean, clean[i - 1] if i else ''), i, ch])
            else:
                toks.append(['p', ch, i, ch])
            i += 1
        # tone change on a standalone 一 / 不, from the syllable that follows
        def first_syl(k):
            if k >= len(toks) or toks[k][0] == 'p':
                return None
            return toks[k][1][0][0] if toks[k][0] == 'w' else toks[k][1]
        for k, t in enumerate(toks):
            if t[0] != 'c' or t[2] in forced:
                continue
            prev = clean[t[2] - 1] if t[2] else ''
            nxt_ch = clean[t[2] + 1] if t[2] + 1 < len(clean) else ''
            nxt = first_syl(k + 1)
            if t[3] == '一':
                if (prev and (prev in '第初十期' or prev in NUM)) or nxt is None or (nxt_ch in NUM) or nxt_ch in '月號樓':
                    t[1] = 'yī'
                elif tone(nxt) == 4 or nxt_ch == '個':
                    t[1] = 'yí'
                else:
                    t[1] = 'yì'
            elif t[3] == '不' and nxt and tone(nxt) == 4:
                t[1] = 'bú'
        # lay the tokens out
        out = []
        for k, t in enumerate(toks):
            if t[0] == 'p':
                p = PUNCT.get(t[1], t[1])
                if p in '“':
                    out.append(p + '\x00')        # opening quote glues to what follows
                elif out:
                    out[-1] += p
                continue
            if t[0] == 'w':
                parts = [join(g) for g in t[1]]
            else:
                parts = [t[1]]
                prev = toks[k - 1] if k else None
                if out and prev and prev[0] != 'p' and (t[3] in SUFFIX or (t[3] in NUM and prev[3] in NUM)):
                    out[-1] += ("'" if plain(t[1])[0] in 'aoe' else '') + t[1]
                    continue
            out.extend(parts)
        py = ' '.join(out).replace('\x00 ', '')
        if clean and clean[-1] in ENDS and py:
            py = py[0].upper() + py[1:]
        return clean, py


def parse(src):
    """→ [(book, lesson, head, [(zh, en)], line number)] in file order."""
    out, book, lesson = [], None, None
    for n, raw in enumerate(src.read_text(encoding='utf-8').split('\n'), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        m = re.match(r'==\s*(\d+)\.(\d+)\s*$', line)
        if m:
            book, lesson = int(m.group(1)), int(m.group(2))
            continue
        if ':' not in line or book is None:
            sys.exit(f'{src.name}:{n}: cannot read this line: {raw}')
        head, body = line.split(':', 1)
        items = []
        for part in body.split('|'):
            if not part.strip():
                continue
            if '=' not in part:
                sys.exit(f'{src.name}:{n}: “{part.strip()}” has no “= English”')
            zh, en = part.split('=', 1)
            items.append((zh.strip(), en.strip()))
        out.append((book, lesson, head.strip(), items, n))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--review', action='store_true')
    ap.add_argument('--show', metavar='B.L')
    a = ap.parse_args()
    path = ROOT / 'index.html'
    lines = path.read_text(encoding='utf-8').split('\n')
    WORDS = json.loads(next(l for l in lines if l.startswith('const WORDS = '))[len('const WORDS = '):].rstrip().rstrip(';'))
    books = {int(n): int(f) for n, f, c in re.findall(r"\{n:(\d+),zh:'.',first:(\d+),count:(\d+)\}", next(l for l in lines if l.startswith('const BOOKS=')))}
    reader = Reader(WORDS)

    problems, out, covered, seen_head = [], {}, set(), Counter()
    n_phr = 0
    for book, lesson, head, items, n in parse(SRC):
        ln = books[book] + lesson - 1
        covered.add((book, lesson, ln))
        cands = [w for w in WORDS if w['l'] == ln and head in (w['t'], w['t'].split('（')[0], head_of(w))]
        k = seen_head[(ln, head)]
        seen_head[(ln, head)] += 1
        where = f'B{book} L{lesson} {head} (line {n})'
        if k >= len(cands):
            problems.append(f'{where}: no such word in that lesson' if not cands else f'{where}: listed more often than the lesson has it')
            continue
        w = cands[k]
        known = {c for x in WORDS if x['l'] <= ln for c in HAN.findall(x['t'])} | set(NUM)
        hw = [head_of(w)] + [h for h in re.split(r'[（）]', w['t'])[1:] if h]
        rows = []
        for zh, en in items:
            clean, py = reader.read(zh)
            unknown = sorted({c for c in HAN.findall(clean) if c not in known})
            if unknown:
                problems.append(f'{where}: 「{clean}」 uses characters not yet learned: {"".join(unknown)}')
            if not any(h in clean for h in hw):
                it = iter(clean)
                if not all(c in it for c in hw[0]):
                    problems.append(f'{where}: 「{clean}」 does not contain {hw[0]}')
            if not en:
                problems.append(f'{where}: 「{clean}」 has no English')
            if any(r[0] == clean for r in rows):
                problems.append(f'{where}: 「{clean}」 is listed twice')
            if None in py.split() or 'None' in py:
                problems.append(f'{where}: 「{clean}」 has a character with no known reading')
            rows.append([clean, py, en])
        if len(rows) < 2:
            problems.append(f'{where}: only {len(rows)} phrase(s) — give at least two')
        out[w['id']] = rows
        n_phr += len(rows)

    for book, lesson, ln in sorted(covered):
        missing = [w['t'] for w in WORDS if w['l'] == ln and w['id'] not in out and not re.match(r'^[A-Z]', w['p']) ]
        if missing:
            problems.append(f'B{book} L{lesson}: no phrases for {" ".join(missing)}')
        ws = [w for w in WORDS if w['l'] == ln and w['id'] in out]
        print(f'  B{book} L{lesson}: {len(ws)} words · {sum(len(out[w["id"]]) for w in ws)} phrases')
    print(f'  {len(out)} words · {n_phr} phrases in all')

    if a.show:
        b, l = map(int, a.show.split('.'))
        ln = books[b] + l - 1
        for w in WORDS:
            if w['l'] == ln and w['id'] in out:
                print(f"\n{w['t']}  {w['p']}  — {w['m']}")
                for zh, py, en in out[w['id']]:
                    print(f'    {zh}   {py}   {en}')
    if a.review:
        print('\nReadings chosen for characters with more than one (force another with 字(reading) in the phrase):')
        by = defaultdict(list)
        for c, r, phrase, guessed in reader.choices:
            by[(c, r, guessed)].append(phrase)
        for (c, r, guessed), ps in sorted(by.items()):
            if c in QUIET and not guessed:
                continue
            print(f'  {c} → {r}{"  (no default set — most common reading used)" if guessed else ""}: ' + ' · '.join(dict.fromkeys(ps)))
    if problems:
        print('\n' + '\n'.join('  ✗ ' + p for p in problems))
        print(f'\n{len(problems)} problem(s).')
        sys.exit(1)
    if a.write:
        i = next((k for k, l in enumerate(lines) if l.startswith('const USAGE = ')), None)
        if i is None:
            sys.exit('index.html has no "const USAGE = " line to replace')
        lines[i] = 'const USAGE = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';'
        path.write_text('\n'.join(lines), encoding='utf-8')
        print(f'\nwrote {n_phr} phrases for {len(out)} words to index.html')


if __name__ == '__main__':
    main()

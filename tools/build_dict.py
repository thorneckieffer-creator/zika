#!/usr/bin/env python3
"""Build assets/dict.txt, the dictionary My words fills pinyin and meanings from.

Source: CC-CEDICT (https://www.mdbg.net/chinese/dictionary?page=cc-cedict), licensed
CC BY-SA 4.0. Download cedict_1_0_ts_utf-8_mdbg.txt.gz from that page, unpack it, and run

    python3 tools/build_dict.py /path/to/cedict.txt

What it writes: one line per traditional headword,

    字<TAB>pinyin<TAB>gloss[<TAB>pinyin<TAB>gloss ...]

The first pinyin/gloss pair is the reading the app fills in; the rest are other
readings, offered as alternatives. Choices made here, because the app is for a
learner in Taiwan who wants a short card, not a dictionary article:

- Pinyin is written the way the course writes it: tone marks, the syllables of a
  word joined (zhēnzhū), an apostrophe before a, e, o (nǚ'ér), a new word at a
  capital (Máo Zédōng).
- Where CC-CEDICT gives a Taiwan pronunciation (垃圾 lèsè) that is the reading
  used, and the other words are written the way the course writes them: see
  taiwan_style(). tools/check.mjs measures the result against the course's pinyin.
- A gloss is at most four short items and about 80 characters, without classifier
  notes, cross-reference pinyin or simplified forms.
- Of several readings, the everyday one comes first: for a single character the
  reading in the app's own COMPONENTS table, and surnames, variants, "used in"
  entries and literary senses after the rest.

After a rebuild, bump the ?v= of DC.url in js/my-words.js so devices fetch the new file.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import applib

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'dict.txt'
MAX_HEAD = 8        # longer headwords are proverbs and full names; the app's longest-match lookup stops at 6
MAX_ITEMS = 4
MAX_GLOSS = 80
MAX_READINGS = 4

MARK = {'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì', 'o': 'ōóǒò', 'u': 'ūúǔù', 'ü': 'ǖǘǚǜ'}
COMB = ['̄', '́', '̌', '̀']
HAN = re.compile(r'[㐀-鿿\U00020000-\U0003ffff]')
SYL = re.compile(r'([A-Za-zÜü:]+)([1-5])')


def syllable(tok):
    """'zhen1' -> 'zhēn'; None if tok is not a pinyin syllable."""
    m = SYL.fullmatch(tok)
    if not m:
        return None
    base, tone = m.group(1).replace('u:', 'ü').replace('U:', 'Ü'), int(m.group(2))
    low = base.lower()
    if low == 'xx':
        return None
    if tone == 5:
        return base
    if 'a' in low:
        i = low.index('a')
    elif 'e' in low:
        i = low.index('e')
    elif 'ou' in low:
        i = low.index('o')
    else:
        at = [k for k, c in enumerate(low) if c in 'iouü']
        if not at:                                   # m, n, ng, hm: the mark goes on the m or n
            k = next((k for k, c in enumerate(low) if c in 'mn'), None)
            if k is None:
                return None
            return unicodedata.normalize('NFC', base[:k + 1] + COMB[tone - 1] + base[k + 1:])
        i = at[-1]
    ch = MARK[low[i]][tone - 1]
    return base[:i] + (ch.upper() if base[i].isupper() else ch) + base[i + 1:]


def plain(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c))


def pinyin(tokens):
    """['zhen1','zhu1','nai3','cha2'] -> 'zhēnzhūnǎichá'; None if a token cannot be read."""
    out = ''
    for tok in tokens:
        s = syllable(tok)
        if s is None:
            if tok == ',':
                out = out.rstrip() + ', '
            elif tok == '·':
                out = out.rstrip() + ' '
            elif re.fullmatch(r'[A-Za-z0-9]+', tok):  # a Latin letter that is part of the word: T恤, 卡拉OK
                out = (out.rstrip() + ' ' if out else '') + tok + ' '
            else:
                return None
            continue
        if tok.lower() == 'r5' and out and not out.endswith(' '):   # erhua
            out += 'r'
            continue
        if out and not out.endswith(' '):
            if s[0].isupper():
                out += ' '
            elif plain(s[0]).lower() in 'aeo':
                out += "'"
        out += s
    return out.strip() or None


def taiwan(tokens, senses):
    """The Taiwan reading if the entry gives one that fits: as a sense of its own, or inside the first sense."""
    for k, s in enumerate(senses):
        m = re.search(r'Taiwan pr\. \[([^\]]+)\]', s)
        if not m:
            continue
        if not s.startswith('Taiwan pr.') and k > 0:
            continue
        tw = [a + b for a, b in SYL.findall(m.group(1))]
        if len(tw) != len(tokens) or not all(SYL.fullmatch(t) for t in tokens):
            continue
        return [t.capitalize() if o[0].isupper() else t for t, o in zip(tw, tokens)]
    return tokens


SKIP = re.compile(r'^(CL:|Taiwan pr\.|also pr\.|also written|see also )')
WEAK = re.compile(r'^((old |archaic |erhua |Japanese |dialectal )?variant of|used in |see |surname )')
DATED = re.compile(r'^\((literary|archaic|old|dialect|classical)\)')


def clean(sense):
    s = re.sub(r'\s*\(?Taiwan pr\. \[[^\]]*\]\)?', '', sense)
    s = re.sub(r'\s*\(?also pr\. \[[^\]]*\](?: or \[[^\]]*\])*\)?', '', s)
    s = re.sub(r'(\S+?)\|\S+?\[[^\]]*\]', r'\1', s)                    # 無|无[wu2] -> 無
    s = re.sub(r'([㐀-鿿]+)\[[^\]]*\]', r'\1', s)              # 得[de2]   -> 得
    s = re.sub(r'([㐀-鿿]+)\|[㐀-鿿]+', r'\1', s)      # 無|无     -> 無
    s = re.sub(r'^\(bound form\)\s*', '', s)
    return re.sub(r'\s+', ' ', s).strip(' ;,')


def gloss(senses):
    keep = [c for c in (clean(s) for s in senses if not SKIP.match(s)) if c]
    if not keep:
        return ''
    keep.sort(key=lambda s: bool(DATED.match(s)))                       # everyday senses first (the sort is stable)
    if len(keep) == 1:
        items = keep[0].split('; ')[:3]
    else:
        items = keep[0].split('; ')[:2] + [s.split('; ')[0] for s in keep[1:]]
    out = []
    for it in items[:MAX_ITEMS]:
        if out and len('; '.join(out + [it])) > MAX_GLOSS:
            break
        out.append(it)
    g = '; '.join(out)
    return g if len(g) <= MAX_GLOSS + 10 else g[:MAX_GLOSS + 7].rsplit(' ', 1)[0] + '…'


KEEP_NEUTRAL = set('子麼了的得們兒著嗎吧呢啊呀啦嘛哦喔囉')     # particles and suffixes: neutral in Taiwan as well
LEX_NEUTRAL = ('意思', '關係', '名字', '暖和', '東西')          # words the course itself writes with a neutral second syllable
COUNTED = set('一這那哪幾每上下兩半二三四五六七八九十百千')      # before these, 個 is the measure word: ge
NUMERAL = set('第十初零〇二三四五六七八九百千萬')
ORDINAL_NEXT = set('月號日')
NOT_TAIWAN = set('法應亞括')    # CC-CEDICT lists a Taiwan reading (fà, yìng, yǎ, guā) that the course does not teach: 法國 Fǎguó, 應該 yīnggāi, 亞洲 Yàzhōu, 包括 bāokuò


def taiwan_style(head, toks, said, chars, tw):
    """Write a word of several characters the way the course does. Measured against the course's own pinyin
    (every course word that is in CC-CEDICT), these are the systematic differences:
      - a longer word follows the Taiwan reading of a word inside it (垃圾車 lèsèchē);
      - a character follows its own Taiwan reading (期 qí: 星期, 學期; 績 jī; 究 jiù; 微 wéi);
      - Taiwan keeps the full tone where the mainland standard has a neutral one (朋友 péngyǒu, 衣服 yīfú, 回來 huílái),
        except on particles and suffixes (子, 們, 的 …), doubled characters (媽媽) and a few words (意思, 東西);
      - 個 after a number or 這/那 is ge;
      - 一 and 不 are written with the tone they are spoken with (yíyàng, yìqǐ, búcuò)."""
    n = len(head)
    if n < 2 or len(toks) != n or not all(SYL.fullmatch(t) for t in toks):
        return said
    out = list(said)
    cap = lambda new, old: new.capitalize() if old[0].isupper() else new
    if said == toks:                                    # an entry that states its own Taiwan reading is left as it is
        if n > 2:
            for sub, (std, twr) in tw.items():
                at = head.find(sub)
                if at >= 0 and [t.lower() for t in out[at:at + len(sub)]] == std:
                    out[at:at + len(sub)] = [cap(t, o) for t, o in zip(twr, out[at:at + len(sub)])]
        for i, ch in enumerate(head):
            low, reads, new = out[i].lower(), chars.get(ch, ()), None
            if low[-1] != '5':
                new = None if ch in NOT_TAIWAN else next((t for _, std, t in reads if std == low and t != std), None)
            elif i > 0 and ch not in KEEP_NEUTRAL and head[i - 1] != ch and head[i - 1:i + 1] not in LEX_NEUTRAL:
                new = next((std if ch in NOT_TAIWAN else t for _, std, t in reads if std[:-1] == low[:-1] and t[-1] != '5'), None)
            if new:
                out[i] = cap(new, out[i])
    for i in range(1, n):
        if head[i] == '個' and head[i - 1] in COUNTED and out[i].lower() == 'ge4':
            out[i] = 'ge5'
    for i, ch in enumerate(head[:-1]):
        low, nxt = out[i].lower(), out[i + 1].lower()
        after = 4 if head[i + 1] == '個' and nxt == 'ge5' else int(nxt[-1])
        if ch == '不' and low in ('bu4', 'bu5'):
            out[i] = cap('bu2' if after == 4 else 'bu4', out[i])
        elif ch == '一' and low == 'yi1' and not (i and head[i - 1] in NUMERAL) and head[i + 1] not in ORDINAL_NEXT | NUMERAL:
            if after == 4:
                out[i] = cap('yi2', out[i])
            elif after in (1, 2, 3):
                out[i] = cap('yi4', out[i])
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).read_text(encoding='utf-8')
    comp = applib.read_data('COMPONENTS')
    usual = {ch: str(c.get('p', '')).split(',')[0].strip().lower() for ch, c in comp.items() if c.get('p')}

    def rank(head, p, g, senses):
        weak = all(WEAK.match(clean(s) or 'see ') for s in senses if not SKIP.match(s))
        score = (5 if g.startswith('surname ') else 0) + (6 if weak else 0) + (3 if DATED.match(g) else 0) + (1 if p[0].isupper() else 0)
        return score - 10 if len(head) == 1 and usual.get(head) == p.lower() else score

    line = re.compile(r'^(\S+) \S+ \[([^\]]*)\] /(.*)/\s*$')
    entries, tw, chars = [], {}, {}
    for raw in src.splitlines():
        if raw.startswith('#'):
            continue
        m = line.match(raw)
        if not m:
            continue
        head, toks, senses = m.group(1), m.group(2).split(), m.group(3).split('/')
        if not HAN.search(head) or len(head) > MAX_HEAD or '\t' in head:
            continue
        said = taiwan(toks, senses)
        if said != toks and len(head) > 1 and len(toks) == len(head):
            tw[head] = ([t.lower() for t in toks], said)             # 垃圾: la1 ji1 -> le4 se4
        if len(head) == 1 and len(toks) == 1 and SYL.fullmatch(toks[0]):
            p, g = pinyin(said), gloss(senses)
            if p and g:                                              # the readings of a character, everyday one first
                chars.setdefault(head, []).append((rank(head, p, g, senses), toks[0].lower(), said[0].lower()))
        entries.append((head, toks, said, senses))
    for rs in chars.values():
        rs.sort(key=lambda r: r[0])

    heads, unread, styled = {}, 0, 0
    for head, toks, said, senses in entries:
        tws = taiwan_style(head, toks, said, chars, tw)
        styled += tws != said
        p = pinyin(tws)
        g = gloss(senses)
        if not p or not g:
            unread += 1
            continue
        score = rank(head, p, g, senses)
        rs = heads.setdefault(head, [])
        same = next((r for r in rs if r[1] == p), None)
        if same:                                                        # two entries, one reading: one card line
            if len(same[2]) + len(g) + 2 <= MAX_GLOSS and g not in same[2]:
                same[2] += '; ' + g
            same[0] = min(same[0], score)
        else:
            rs.append([score, p, g])

    # a gloss that only points elsewhere ("erhua variant of 一點", "see 西安市") takes the gloss of what it points to
    points = re.compile(r'^(?:(?:old |archaic |erhua |Japanese |dialectal )?variant of|see(?: also)?) ([\u3400-\u9fff]+)')
    for head, rs in heads.items():
        for r in rs:
            m = points.match(r[2])
            target = m and heads.get(m.group(1))
            if target and target is not rs:
                best = min(target, key=lambda t: t[0])
                if not points.match(best[2]):
                    r[2] = best[2]

    rows = []
    for head in sorted(heads):
        rs = sorted(heads[head], key=lambda r: r[0])[:MAX_READINGS]     # stable: CC-CEDICT's order breaks ties
        rows.append(head + '\t' + '\t'.join(r[1] + '\t' + r[2].replace('\t', ' ') for r in rs))
    OUT.write_text('\n'.join(rows) + '\n', encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {len(rows):,} headwords, {OUT.stat().st_size / 1e6:.1f} MB · {len(tw):,} words with a stated Taiwan reading, '
          f'{styled:,} more written the Taiwan way ({unread:,} entries without a readable pinyin or gloss left out)')


if __name__ == '__main__':
    main()

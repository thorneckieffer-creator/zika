#!/usr/bin/env python3
"""Write tools/content/readings.json: the publisher's reading (注音) for every word and character.

    python3 tools/build_readings.py --volumes "<…/SoyongMebook>"

Voice packs built with BreezyVoice use it to pin pronunciations the model would otherwise guess,
and to give words that share characters but not readings (了 le / liǎo, 得 de / děi) their own clips.
Syllables are written the way the model expects them: bopomofo plus a tone digit, 5 = neutral.
"""
import argparse, collections, glob, json, re, sqlite3, sys
from pathlib import Path

import applib

ROOT = Path(__file__).resolve().parent.parent
HAN = re.compile(r'[㐀-鿿]')
TONE = {'ˊ': '2', 'ˇ': '3', 'ˋ': '4', '˙': '5'}


def syllables(zhuyin):
    out = []
    for s in re.split(r'[\s/，,（）()]+', zhuyin or ''):
        body = ''.join(c for c in s if 'ㄅ' <= c <= 'ㄩ')
        if not body:
            continue
        tone = next((TONE[c] for c in s if c in TONE), '1')
        out.append(body + tone)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--volumes', required=True, help='the SoyongMebook folder that holds the MBLCECC00N volumes')
    a = ap.parse_args()
    pub = {}
    for db in sorted(glob.glob(str(Path(a.volumes) / 'MBLCECC*' / '*-01-03.sqlite'))):
        con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        for entry, zhuyin, pinyin in con.execute('select entry, zhuyin, pinyin from newwords'):
            pub.setdefault((entry.strip(), re.sub(r'\s+', ' ', (pinyin or '').strip())), zhuyin)
            pub.setdefault((entry.strip(), None), zhuyin)
    if not pub:
        sys.exit('no volumes found')

    WORDS = applib.read_data('WORDS')
    words, votes, skipped = {}, collections.defaultdict(collections.Counter), []
    for w in WORDS:
        text = str(w['t']).split('（')[0]
        z = pub.get((w['t'], re.sub(r'\s+', ' ', w['p'].strip()))) or pub.get((w['t'], None)) or pub.get((text, None))
        syl, han = syllables(z), HAN.findall(text)
        if not z or len(syl) != len(han) or len(han) != len(text.replace(' ', '')):
            skipped.append(w['t']); continue
        words[w['id']] = syl
        for ch, s in zip(han, syl):
            votes[ch][s] += 1
    chars = {ch: c.most_common(1)[0][0] for ch, c in votes.items()}       # each character as the textbook most often reads it
    out = ROOT / 'tools' / 'content' / 'readings.json'
    out.write_text(json.dumps({'words': words, 'chars': chars}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(words)} word readings, {len(chars)} character readings → {out.relative_to(ROOT)}')
    print(f'{len(skipped)} words left to the model (mixed scripts or no publisher reading):', ' '.join(skipped[:20]))


if __name__ == '__main__':
    main()

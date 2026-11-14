#!/usr/bin/env python3
"""Give every character in WORDS its stroke-order data and its component breakdown.

    python3 tools/add_characters.py [--volume "<…/SoyongMebook/MBLCECC008>" …]

  • assets/strokes.json  ← Hanzi Writer data (the same source the app falls back to online)
  • COMPONENTS           ← Make Me a Hanzi dictionary (decomposition, etymology, gloss)

Run after tools/import_dangdai.py. With --volume, readings come from the publisher's character
table (Taiwan readings) instead of the dictionary's. Bump the ?v= on strokes.json in index.html
and sw.js afterwards so devices fetch the new file.
"""
import argparse, glob, json, re, sqlite3, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HAN = re.compile(r'[㐀-鿿]')
STROKES_URL = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/{}.json'
DICT_URL = 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt'
CACHE = Path.home() / '.cache' / 'zika-chars'


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'zika-tools'}), timeout=40) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--volume', action='append', default=[])
    a = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)

    path = ROOT / 'index.html'
    lines = path.read_text(encoding='utf-8').split('\n')
    iw = next(i for i, l in enumerate(lines) if l.startswith('const WORDS = '))
    ic = next(i for i, l in enumerate(lines) if l.startswith('const COMPONENTS = '))
    WORDS = json.loads(lines[iw][len('const WORDS = '):].rstrip().rstrip(';'))
    COMP = json.loads(lines[ic][len('const COMPONENTS = '):].rstrip().rstrip(';'))
    chars = sorted({c for w in WORDS for c in HAN.findall(str(w['t']).split('（')[0])})

    # ---- strokes
    spath = ROOT / 'assets' / 'strokes.json'
    strokes = json.loads(spath.read_text(encoding='utf-8'))
    need = [c for c in chars if c not in strokes]

    def fetch(c):
        try:
            d = json.loads(get(STROKES_URL.format(urllib.parse.quote(c))))
            return c, {'strokes': d['strokes'], 'medians': d['medians']}
        except Exception:
            return c, None
    missing = []
    with ThreadPoolExecutor(8) as ex:
        for c, d in ex.map(fetch, need):
            if d: strokes[c] = d
            else: missing.append(c)
    if need:
        spath.write_text(json.dumps(strokes, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'strokes: {len(need) - len(missing)} added, {len(missing)} not available' + (': ' + ''.join(missing) if missing else ''))

    # ---- components
    readings = {}
    for v in a.volume:
        db = glob.glob(str(Path(v) / '*-01-03.sqlite'))
        if db:
            con = sqlite3.connect(f'file:{db[0]}?mode=ro', uri=True)
            for entry, py in con.execute('select entry, pinyin from chinesecharacter'):
                if entry and py: readings.setdefault(entry.strip(), py.strip())
    dpath = CACHE / 'dictionary.txt'
    if not dpath.exists():
        dpath.write_bytes(get(DICT_URL))
    DICT = {}
    for line in dpath.read_text(encoding='utf-8').split('\n'):
        if line.strip():
            d = json.loads(line); DICT[d['character']] = d

    def entry(c):
        d = DICT.get(c)
        if not d: return None
        e = {'p': readings.get(c) or (d.get('pinyin') or [''])[0], 'g': d.get('definition') or ''}
        parts = [x for x in (d.get('decomposition') or '') if not ('⿰' <= x <= '⿿') and x != '？']
        if len(parts) > 1: e['d'] = parts
        ety = d.get('etymology') or {}
        if ety.get('type'): e['t'] = ety['type']
        if ety.get('hint'): e['h'] = ety['hint']
        if ety.get('semantic'): e['s'] = ety['semantic']
        if ety.get('phonetic'): e['ph'] = ety['phonetic']
        return e
    added, nodata = 0, []
    for c in chars:
        if c in COMP: continue
        e = entry(c)
        if not e: nodata.append(c); continue
        COMP[c] = e; added += 1
        for part in e.get('d', []):                 # the parts need their own reading and gloss on the card
            if part not in COMP and entry(part):
                pe = entry(part); pe.pop('d', None); COMP[part] = pe
    if added:
        lines[ic] = 'const COMPONENTS = ' + json.dumps(COMP, ensure_ascii=False, separators=(',', ':')) + ';'
        path.write_text('\n'.join(lines), encoding='utf-8')
    print(f'components: {added} added, {len(nodata)} without dictionary data' + (': ' + ''.join(nodata) if nodata else ''))


if __name__ == '__main__':
    main()

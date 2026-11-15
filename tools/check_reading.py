#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check the reading passages against the vocabulary learned so far, and install them into data/readings.js.

    python3 tools/check_reading.py            # report only
    python3 tools/check_reading.py --write    # also (re)write the READINGS line of data/readings.js

A passage for Book B Lesson L may use only characters that appear in some word up to that lesson.
Anything else is listed so the passage can be reworded. The report also shows how many of the lesson's
own new words each passage exercises.
"""
import argparse, importlib.util, json, re, sys
from pathlib import Path

import applib

ROOT = Path(__file__).resolve().parent.parent
NUMERALS = '零一二三四五六七八九十百千萬兩'   # counting is taught early, but the numbers are not all listed as words
HAN = re.compile(r'[㐀-鿿]')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    WORDS = applib.read_data('WORDS')
    books = {b['n']: b['first'] for b in applib.books()}
    spec = importlib.util.spec_from_file_location('r', ROOT / 'tools' / 'content' / 'reading_passages.py')
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

    out, bad = {}, 0
    for (book, lesson), passages in sorted(mod.R.items()):
        ln = books[book] + lesson - 1
        known = {c for w in WORDS if w['l'] <= ln for c in HAN.findall(w['t'])} | set(NUMERALS)
        new_words = [w['t'].split('（')[0] for w in WORDS if w['l'] == ln]
        for p in passages:
            unknown = sorted({c for c in HAN.findall(p['zh']) if c not in known})
            used = [t for t in new_words if t in p['zh']]
            flag = '✗' if unknown else '✓'
            print(f"{flag} B{book} L{lesson} 「{p['t']}」 {len(HAN.findall(p['zh']))} characters · {len(used)} of the lesson's {len(new_words)} new words"
                  + (f" · NOT YET LEARNED: {''.join(unknown)}" if unknown else ''))
            bad += bool(unknown)
            out.setdefault(str(ln), []).append(dict(t=p['t'], en=p['en'], zh=p['zh'], tr=p['tr']))
    if bad:
        print(f'\n{bad} passage(s) use characters from later lessons — reword them.')
        sys.exit(1)
    if a.write:
        applib.write_data('READINGS', out)
        print(f'\nwrote {sum(len(v) for v in out.values())} passages to data/readings.js')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check the "which pattern?" pairs and install them into data/pairs.js.

    python3 tools/check_pairs.py            # report only
    python3 tools/check_pairs.py --list     # every sentence with its answer filled in, to read through
    python3 tools/check_pairs.py --write    # also (re)write the PAIRS line of data/pairs.js

The pairs live in tools/content/pairs.txt; the format is described at the top of that file.

Rules, enforced here:
  * every character of a sentence, its choices and the side-by-side lines is one the course teaches;
  * a sentence is offered only from the lesson by which all its characters have been met (worked out here and
    stored with it), never before the pair's own lesson; at least four of a pair's sentences can be asked at the
    pair's own lesson;
  * a blank sentence has exactly one blank and its answer is one of its choices (four at most: the keys 1 to 4
    choose); every choice of a pair is the answer to at least one sentence and has a side-by-side line, and a
    side-by-side line uses only characters met by the pair's own lesson, since it is shown with every answer;
  * no sentence, once a wrong choice is put in its blank, reads the same as another sentence of the file;
  * two sentences with the same blanked text and different answers must differ in their English, since the
    English is what tells them apart on the screen;
  * a grammar point named for a choice exists.

What this cannot check is the thing that matters most: that only one choice is right for the meaning the English
gives. That is read by a person; --list prints the list to read.
"""
import argparse, re, sys
from pathlib import Path

import applib

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'content' / 'pairs.txt'
OUT = ROOT / 'data' / 'pairs.js'
HAN = re.compile(r'[㐀-鿿]')
NUMERALS = set('零一二三四五六七八九十百千萬兩')
BLANK, HOLE, NONE = '___', '⬚', '∅'
HEADER = ('/* PAIRS — the "which pattern?" drill: pairs of patterns that both look as if they fit, each with the test that '
          'decides it, side-by-side lines and sentences with a blank. Installed by tools/check_pairs.py --write from '
          'tools/content/pairs.txt. One line of JSON: the tools read and rewrite it whole. */\n')


def lesson_index(books, text, where):
    m = re.fullmatch(r'(\d+)\.(\d+)', text.strip())
    if not m:
        raise SystemExit(f'{where}: "{text}" is not a lesson (write Book.Lesson, as in 2.11)')
    b, l = int(m.group(1)), int(m.group(2))
    for bk in books:
        if bk['n'] == b and 1 <= l <= bk['count']:
            return bk['first'] + l - 1
    raise SystemExit(f'{where}: there is no Book {b} Lesson {l}')


def label(books, idx):
    for bk in books:
        if bk['first'] <= idx < bk['first'] + bk['count']:
            return f"B{bk['n']} L{idx - bk['first'] + 1}"
    return f'lesson {idx}'


def parse(books):
    pairs, cur, errors = [], None, []
    for n, raw in enumerate(SRC.read_text(encoding='utf-8').split('\n'), 1):
        line = raw.strip()
        where = f'pairs.txt:{n}'
        if not line or line.startswith('#'):
            continue
        if line.startswith('=='):
            f = [x.strip() for x in line[2:].split('|')]
            if len(f) != 3 or '→' not in f[2]:
                errors.append(f'{where}: a pair starts "== key | 就／才 | 1.11 → 2.11"'); cur = None; continue
            a, b = f[2].split('→')
            cur = dict(k=f[0], zh=f[1], **{'from': lesson_index(books, a, where)}, to=lesson_index(books, b, where),
                       opts=[], test='', pts={}, side=[], q=[], line=n)
            pairs.append(cur)
            continue
        if cur is None:
            errors.append(f'{where}: a line before the first pair'); continue
        if line.startswith('choices:'):
            cur['opts'] = [x.strip() for x in line[8:].split('/') if x.strip()]
        elif line.startswith('test:'):
            cur['test'] = line[5:].strip()
        elif line.startswith('points:'):
            for item in line[7:].split():
                if '=' not in item:
                    errors.append(f'{where}: points are written 就=n11-2'); continue
                c, pid = item.split('=', 1)
                cur['pts'][c] = pid
        elif line.startswith('side:'):
            f = [x.strip() for x in line[5:].split('|')]
            if len(f) != 3:
                errors.append(f'{where}: side: choice | 中文 | English'); continue
            cur['side'].append(f)
        elif line.startswith('pick:'):
            halves = [x.strip() for x in line[5:].split('||')]
            if len(halves) != 3:
                errors.append(f'{where}: pick: right | wrong | wrong || English || why'); continue
            opts = [x.strip() for x in halves[0].split('|') if x.strip()]
            if len(opts) < 2:
                errors.append(f'{where}: a pick needs the right sentence and at least one wrong one'); continue
            cur['q'].append(dict(pick=1, a=opts[0], opts=opts, en=halves[1], why=halves[2], line=n))
        else:
            f = [x.strip() for x in line.split('|')]
            if len(f) not in (4, 5):
                errors.append(f'{where}: a sentence is "中文 with ___ | answer | English | why" (and optionally | a/b/c)'); continue
            q = dict(zh=f[0], a=f[1], en=f[2], why=f[3], line=n)
            if len(f) == 5:
                q['opts'] = [x.strip() for x in f[4].split('/') if x.strip()]
            cur['q'].append(q)
    return pairs, errors


def filled(q, choice=None):
    c = q['a'] if choice is None else choice
    return q['zh'].replace(BLANK, '' if c == NONE else c)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()

    books = applib.books()
    words, grammar = applib.read_data('WORDS'), applib.read_data('GRAMMAR')
    met = {}                                        # character -> the first lesson that has it
    for w in words:
        for ch in HAN.findall(w['t']):
            met[ch] = min(met.get(ch, 10 ** 6), w['l'])
    point_ids = {p['id'] for l in grammar for p in grammar[l]}

    def need(text, where, errors):
        worst = 0
        for ch in HAN.findall(text):
            if ch in NUMERALS:
                continue
            if ch not in met:
                errors.append(f'{where}: {ch} is not a character the course teaches ({text})')
            else:
                worst = max(worst, met[ch])
        return worst

    pairs, errors = parse(books)
    notes, seen_keys, every = [], set(), {}
    for p in pairs:
        w = f"pairs.txt:{p['line']} ({p['k']})"
        if p['k'] in seen_keys:
            errors.append(f'{w}: the key {p["k"]} is used twice')
        seen_keys.add(p['k'])
        if not re.fullmatch(r'[a-z]{1,12}', p['k']):
            errors.append(f'{w}: a key is 1 to 12 lower-case letters')
        if p['from'] > p['to']:
            errors.append(f'{w}: the first lesson is after the second')
        if not p['test']:
            errors.append(f'{w}: no test: line')
        picks = [q for q in p['q'] if q.get('pick')]
        blanks = [q for q in p['q'] if not q.get('pick')]
        if blanks and len(p['opts']) < 2:
            errors.append(f'{w}: choices: needs at least two')
        if len(p['opts']) > 4:
            errors.append(f'{w}: more than four choices (the keys 1 to 4 choose)')
        for c, pid in p['pts'].items():
            if pid not in point_ids:
                errors.append(f'{w}: there is no grammar point {pid}')
            if c not in p['opts'] and c != '*':
                errors.append(f'{w}: points names {c}, which is not one of the choices')
        sided = {s[0] for s in p['side']}
        if len(p['side']) < 2:
            errors.append(f'{w}: fewer than two side: lines')
        for s in p['side']:
            late = need(s[1], w, errors)
            if late > p['to']:
                errors.append(f"{w}: the side: line for {s[0]} uses a character first met in {label(books, late)}, after the pair's own lesson ({s[1]})")
            if s[0] not in p['opts'] and blanks:
                errors.append(f'{w}: a side: line is for {s[0]}, which is not one of the choices')
        if blanks:
            for c in p['opts']:
                if c not in sided:
                    errors.append(f'{w}: no side: line for {c}')
                if not any(q['a'] == c for q in blanks):
                    errors.append(f'{w}: {c} is never the answer')
        if len(p['q']) < 6:
            errors.append(f'{w}: {len(p["q"])} sentences; a pair needs at least six')
        for q in p['q']:
            qw = f"pairs.txt:{q['line']} ({p['k']})"
            if q.get('pick'):
                if len(set(q['opts'])) != len(q['opts']):
                    errors.append(f'{qw}: the same sentence twice among the choices')
                q['l'] = max([p['to']] + [need(o, qw, errors) for o in q['opts']])
                every.setdefault(q['a'], []).append((p['k'], q))
                continue
            opts = q.get('opts') or p['opts']
            if q['zh'].count(BLANK) != 1:
                errors.append(f'{qw}: a sentence has exactly one blank (___): {q["zh"]}')
                continue
            if q['a'] not in opts:
                errors.append(f'{qw}: the answer {q["a"]} is not among {" / ".join(opts)}')
            if len(set(opts)) != len(opts) or len(opts) < 2 or len(opts) > 4:
                errors.append(f'{qw}: the choices are not two to four different ones')
            if any(o not in sided for o in opts):
                errors.append(f'{qw}: a choice offered here has no side: line in its pair')
            q['l'] = max([p['to'], need(filled(q), qw, errors)] + [need(o, qw, errors) for o in opts if o != NONE])
            every.setdefault(filled(q), []).append((p['k'], q))
        at_own = sum(1 for q in p['q'] if q.get('l', 10 ** 6) <= p['to'])
        if at_own < 4:
            errors.append(f'{w}: only {at_own} of its sentences can be asked at {label(books, p["to"])}; it needs four')
        later = [q for q in p['q'] if q.get('l', 0) > p['to']]
        if later:
            notes.append(f'{p["k"]}: {len(later)} of {len(p["q"])} sentences wait for a later lesson (' +
                         ', '.join(sorted({label(books, q["l"]) for q in later})) + ')')

    # a wrong choice that makes another sentence of the file; one blanked text with two answers and one English
    by_frame = {}
    for p in pairs:
        for q in p['q']:
            if q.get('pick') or q['zh'].count(BLANK) != 1:
                continue
            qw = f"pairs.txt:{q['line']} ({p['k']})"
            for c in (q.get('opts') or p['opts']):
                if c == q['a']:
                    continue
                for k2, q2 in every.get(filled(q, c), []):
                    if q2 is not q and q2['en'].strip().lower() == q['en'].strip().lower():
                        errors.append(f'{qw}: with {c} in the blank it is the sentence on line {q2["line"]}, and the English is the same')
            by_frame.setdefault((p['k'], q['zh']), []).append(q)
    for (k, zh), qs in by_frame.items():
        if len(qs) > 1 and len({q['en'].strip().lower() for q in qs}) < len(qs):
            errors.append(f'pairs.txt:{qs[0]["line"]} ({k}): the same blanked sentence twice with the same English')

    if args.list:
        for p in pairs:
            print(f"\n{p['zh']}   {label(books, p['from'])} → {label(books, p['to'])}   [{p['k']}]")
            print(f"  The test: {p['test']}")
            for s in p['side']:
                print(f"  side by side · {s[0]}: {s[1]}  {s[2]}")
            for q in p['q']:
                if q.get('pick'):
                    print(f"  ✓ {q['a']}   ✗ {'  ✗ '.join(q['opts'][1:])}   — {q['en']}   ({q['why']})")
                else:
                    opts = q.get('opts') or p['opts']
                    shown = q['zh'].replace(BLANK, '【' + ('nothing' if q['a'] == NONE else q['a']) + '】')
                    print(f"  {shown}   not: {' / '.join(o for o in opts if o != q['a'])}   — {q['en']}   ({q['why']})")
        print()

    total = sum(len(p['q']) for p in pairs)
    print(f'{len(pairs)} pairs, {total} sentences')
    for n in notes:
        print('  note:', n)
    if errors:
        print(f'\n{len(errors)} problem(s):')
        for e in errors:
            print('  ✗', e)
        sys.exit(1)
    print('all checks pass')

    if args.write:
        out = []
        for p in pairs:
            qs = []
            for q in p['q']:
                if q.get('pick'):
                    qs.append(dict(pick=1, a=q['a'], opts=q['opts'], en=q['en'], why=q['why'], l=q['l']))
                else:
                    d = dict(zh=q['zh'].replace(BLANK, HOLE), a=q['a'], en=q['en'], why=q['why'], l=q['l'])
                    if q.get('opts'):
                        d['opts'] = q['opts']
                    qs.append(d)
            d = {'k': p['k'], 'zh': p['zh'], 'from': p['from'], 'to': p['to'], 'opts': p['opts'], 'test': p['test'],
                 'pts': p['pts'], 'side': p['side'], 'q': qs}
            out.append(d)
        if not OUT.exists():
            OUT.write_text(HEADER + 'const PAIRS = [];\n', encoding='utf-8')
        applib.write_data('PAIRS', out)
        print(f'wrote data/pairs.js ({len(out)} pairs)')


if __name__ == '__main__':
    main()

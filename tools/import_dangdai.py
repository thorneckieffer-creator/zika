#!/usr/bin/env python3
"""Import lessons from a downloaded volume of the publisher's 當代中文 (DangDai) app into index.html.

    python3 tools/import_dangdai.py --book 3 --volume "<…/SoyongMebook/MBLCECC008>" [--dry-run]

Adds, for each lesson in the volume that the app does not have yet:
  • the word list (new ids continuing from the current maximum, in textbook order),
  • the lesson title, and the lesson's entry in BOOKS,
  • the DLGMAP string (1 = first text, 2 = second text: dialogue and essay from Book 3 on),
  • grammar points from tools/content/book<N>_grammar.py when that file covers the lesson.

Only word metadata is taken from the app. Dialogue, essay and example-sentence text is never copied:
grammar explanations and examples come from tools/content/, which is original writing.
Find a volume folder with:  mdfind -name ".syd" | grep SoyongMebook
"""
import argparse, glob, importlib.util, json, re, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ZH = '一二三四五六'
TYPOS = {'discouont': 'discount'}     # slips in the publisher's glosses


def read_volume(folder, book):
    db = glob.glob(str(Path(folder) / '*-01-03.sqlite'))
    if not db:
        sys.exit(f'no *-01-03.sqlite in {folder} — is the volume downloaded in the app?')
    con = sqlite3.connect(f'file:{db[0]}?mode=ro', uri=True)
    titles = {}
    for id_, en in con.execute('select id, en from menu'):
        m = re.fullmatch(r'b(\d\d)u(\d\d)', id_)
        if m and int(m.group(1)) == book:
            titles[int(m.group(2))] = re.sub(r'^Lesson\s+\d+\s+', '', (en or '').strip())
    lessons = {}
    q = 'select id, entry, [entry_zh-hans], pinyin, partofspeech, explantion, category, vocorder from newwords'
    for id_, entry, simp, py, pos, gloss, cat, order in con.execute(q):
        m = re.fullmatch(r'b(\d\d)u(\d\d)_d(\d)v(\d+)', id_)
        if not m or int(m.group(1)) != book:
            continue
        gloss = re.sub(r'\s+', ' ', (gloss or '').strip())
        if (cat or '').lower().startswith('people') and gloss[:2] == 'A ':
            gloss = 'a ' + gloss[2:]          # isName() recognises "a woman from …"
        gloss = re.sub(r'!+$', '', re.sub(r'^To ', 'to ', gloss)).strip()
        for typo, fix in TYPOS.items():
            gloss = gloss.replace(typo, fix)
        pos = re.sub(r'[()（）]', '', (pos or '').strip())
        if not pos and (cat or '').lower().startswith('phrase'):
            pos = 'Ph'                         # the app's tag for phrases, as in Books 1–2
        w = dict(t=entry.strip(), p=re.sub(r'\s+', ' ', (py or '').strip()), pos=pos, m=gloss)
        if simp and simp.strip() != w['t']:
            w['s'] = simp.strip()
        lessons.setdefault(int(m.group(2)), []).append((int(m.group(3)), order or 0, int(m.group(4)), w))
    for u in lessons:
        lessons[u].sort(key=lambda x: x[:3])
    return titles, lessons


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--book', type=int, required=True)
    ap.add_argument('--volume', required=True, action='append', help='volume folder (repeatable)')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    titles, lessons = {}, {}
    for v in a.volume:
        t, l = read_volume(v, a.book)
        titles.update(t); lessons.update(l)

    path = ROOT / 'index.html'
    lines = path.read_text(encoding='utf-8').split('\n')
    at = lambda prefix: next(i for i, l in enumerate(lines) if l.startswith(prefix))
    iw, ig, ib, it, idm = at('const WORDS = '), at('const GRAMMAR = '), at('const BOOKS='), at('const LESSON_TITLES = '), at('var DLGMAP=')
    WORDS = json.loads(lines[iw][len('const WORDS = '):].rstrip().rstrip(';'))
    GRAMMAR = json.loads(lines[ig][len('const GRAMMAR = '):].rstrip().rstrip(';'))
    books = [dict(n=int(n), first=int(f), count=int(c)) for n, f, c in
             re.findall(r"\{n:(\d+),zh:'.',first:(\d+),count:(\d+)\}", lines[ib])]

    book = next((b for b in books if b['n'] == a.book), None)
    if not book:
        prev = books[-1]
        if a.book != prev['n'] + 1:
            sys.exit(f'Book {a.book} cannot follow Book {prev["n"]}')
        book = dict(n=a.book, first=prev['first'] + prev['count'], count=0)
        books.append(book)
    elif book is not books[-1]:
        sys.exit('lessons can only be appended to the last book (word ids and snapshots are positional)')

    gram_file = ROOT / 'tools' / 'content' / f'book{a.book}_grammar.py'
    gram = {}
    if gram_file.exists():
        spec = importlib.util.spec_from_file_location('g', gram_file); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        gram = mod.G

    next_id = max(int(w['id'][1:]) for w in WORDS) + 1
    added = []
    for u in sorted(lessons):
        if u <= book['count']:
            continue                                   # already imported
        if u != book['count'] + 1:
            sys.exit(f'Book {a.book} has {book["count"]} lessons; lesson {u} would leave a gap')
        ln = book['first'] + u - 1
        marks = ''
        for d, _, _, w in lessons[u]:
            WORDS.append(dict(id=f'w{next_id}', l=ln, **w)); next_id += 1; marks += str(d)
        lines[it] = re.sub(r'\};\s*$', f',{ln}:{json.dumps(titles.get(u, ""), ensure_ascii=False)}' + '};', lines[it])
        lines[idm] = re.sub(r'\};\s*$', f",{ln}:'{marks}'" + '};', lines[idm])
        if u in gram:
            GRAMMAR[str(ln)] = [dict(id=f'g{ln}-{i + 1}', t=p['t'], e=p['e'], pat=p['pat'], tgt=p['tgt'], alt=p.get('alt', []), s=p['s'],
                                     cy=f'Write your own sentence using 「{p["tgt"][0]}」.') for i, p in enumerate(gram[u])]
        book['count'] = u
        added.append((u, len(lessons[u]), len(gram.get(u, [])), titles.get(u, '')))

    if not added:
        print('nothing to import — every lesson in this volume is already in the app'); return
    for u, n, g, t in added:
        print(f'  Book {a.book} Lesson {u}: {n} words, {g} grammar points — {t}')
    if a.dry_run:
        print('dry run: nothing written'); return

    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    lines[iw] = 'const WORDS = ' + dump(WORDS) + ';'
    lines[ig] = 'const GRAMMAR = ' + dump(GRAMMAR) + ';'
    lines[ib] = 'const BOOKS=[' + ','.join(f"{{n:{b['n']},zh:'{ZH[b['n'] - 1]}',first:{b['first']},count:{b['count']}}}" for b in books) + '];'
    path.write_text('\n'.join(lines), encoding='utf-8')
    print(f'wrote index.html — {len(WORDS)} words, {len(books)} books. Next: stroke data, COMPONENTS, voice clips, then node tools/check.mjs')


if __name__ == '__main__':
    main()

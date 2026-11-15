"""Where the app keeps what the content tools read and write.

The course's data is in data/: each file holds lines of the form `const NAME = <one line of JSON>;`
(words.js, grammar.js, components.js, readings.js, usage.js), and data/course.js holds the three short tables
the importer extends: BOOKS, LESSON_TITLES and DLGMAP. The tools never parse the app's code."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
COURSE = DATA / 'course.js'


def data_file(name):
    return DATA / f'{name.lower()}.js'


def _find(lines, prefix, path):
    for i, line in enumerate(lines):
        if line.startswith(prefix):
            return i
    raise SystemExit(f'{path.relative_to(ROOT)}: no line starting with "{prefix}"')


def read_data(name):
    """The value of `const NAME = …;` in data/<name>.js."""
    path = data_file(name)
    lines = path.read_text(encoding='utf-8').split('\n')
    prefix = f'const {name} = '
    return json.loads(lines[_find(lines, prefix, path)][len(prefix):].rstrip().rstrip(';'))


def write_data(name, value):
    """Rewrite the `const NAME = …;` line of data/<name>.js, leaving the rest of the file alone."""
    path = data_file(name)
    lines = path.read_text(encoding='utf-8').split('\n')
    prefix = f'const {name} = '
    lines[_find(lines, prefix, path)] = prefix + json.dumps(value, ensure_ascii=False, separators=(',', ':')) + ';'
    path.write_text('\n'.join(lines), encoding='utf-8')


def course_line(prefix):
    """One line of data/course.js, found by how it starts (`const BOOKS=`, `const LESSON_TITLES = `, `const DLGMAP=`)."""
    lines = COURSE.read_text(encoding='utf-8').split('\n')
    return lines[_find(lines, prefix, COURSE)]


def set_course_line(prefix, line):
    lines = COURSE.read_text(encoding='utf-8').split('\n')
    lines[_find(lines, prefix, COURSE)] = line
    COURSE.write_text('\n'.join(lines), encoding='utf-8')


def books():
    """[{n, first, count}] from the BOOKS table."""
    return [dict(n=int(n), first=int(f), count=int(c))
            for n, f, c in re.findall(r"\{n:(\d+),zh:'.',first:(\d+),count:(\d+)\}", course_line('const BOOKS='))]

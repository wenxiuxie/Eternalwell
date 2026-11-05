"""Chinese line breaking: wrap lines between phrases, never inside a word.

Browsers break Chinese text between any two characters, so a heading can end up as
"不等于最 / 佳。". This runs after the build on the Chinese pages and uses BudouX
(Google's phrase segmenter) to mark phrase boundaries in headings, intro paragraphs,
list titles and FAQ questions. Each one gets `word-break: keep-all` so the browser
only breaks at those boundaries.

    python -m pip install budoux
    python tools/zh_phrases.py site/v7/zh
"""
import pathlib
import re
import sys

import budoux

parser = budoux.load_default_simplified_chinese_parser()

# (opening tag pattern, closing tag); the inner HTML of each match is processed
TARGETS = [
    (r'<h1\b[^>]*>', '</h1>'),
    (r'<h2\b[^>]*>', '</h2>'),
    (r'<h3\b[^>]*>', '</h3>'),
    (r'<p class="lede"[^>]*>', '</p>'),
    (r'<summary\b[^>]*>', '</summary>'),
    (r'<b>', '</b>'),
    (r'<span class="d">', '</span>'),
]
HAS_CJK = re.compile(r'[一-鿿]')


def process(html):
    for open_pat, close in TARGETS:
        def fix(m):
            inner = m.group(2)
            if not HAS_CJK.search(inner) or 'word-break: keep-all' in inner:
                return m.group(0)
            return m.group(1) + parser.translate_html_string(inner) + close
        html = re.sub('(' + open_pat + ')(.*?)' + re.escape(close), fix, html, flags=re.S)
    return html


def main(root):
    files = sorted(pathlib.Path(root).rglob('index.html'))
    for f in files:
        f.write_text(process(f.read_text(encoding='utf-8')), encoding='utf-8')
    print('zh phrase breaks: %d pages' % len(files))


if __name__ == '__main__':
    main(sys.argv[1])

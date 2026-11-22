#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Look for mainland wording in what the app says in Chinese, before a native voice records it (Voice V2).

    python3 tools/check_register.py                  # everything: usage phrases, stories, grammar examples, pairs
    python3 tools/check_register.py --source usage   # one source: usage | stories | grammar | pairs
    python3 tools/check_register.py --terms          # the list it looks for, with what Taiwan says instead

It only reports. Nothing is ever replaced by it: a flagged line is read by a person, who decides. A word the
course itself teaches (it is in WORDS) is not flagged, whatever this list says of it: the course is the standard,
and it is a Taiwan course. The list is a starting one, kept here so that a term is added in one place.

Three kinds of thing are looked for:
  * a mainland word where Taiwan uses another (視頻 → 影片, 地鐵 → 捷運);
  * erhua, the -兒 the north adds (哪兒 → 哪裡, 一點兒 → 一點), other than in words where 兒 is the word itself;
  * a few northern or mainland habits worth a second look, marked "look" (咱們, 早上好).
"""
import argparse, re, sys

import applib

# mainland wording → what Taiwan says. Longest first when matching, so 公交車 is not also reported as 公交.
TERMS = {
    '視頻': '影片', '信息': '訊息／資訊', '軟件': '軟體', '硬件': '硬體', '出租車': '計程車', '自行車': '腳踏車', '地鐵': '捷運',
    '摩托車': '機車', '網絡': '網路', '互聯網': '網際網路', '公交車': '公車', '公共汽車': '公車', '土豆': '馬鈴薯', '西紅柿': '番茄',
    '菠蘿': '鳳梨', '酸奶': '優格', '冰激凌': '冰淇淋', '打印': '列印', '鼠標': '滑鼠', '短信': '簡訊', '博客': '部落格',
    '服務員': '服務生', '塑料': '塑膠', '質量': '品質 (when it means quality)', '激光': '雷射', '數碼': '數位', '程序': '程式 (software)',
    '默認': '預設', '文件夾': '資料夾', '內存': '記憶體', '硬盤': '硬碟', '光盤': '光碟', '屏幕': '螢幕', '空調': '冷氣',
    '衛生間': '洗手間／廁所', '普通話': '國語／中文', '漢語': '中文／華語', '幼兒園': '幼稚園', '打的': '搭計程車', '方便麵': '泡麵',
    '盒飯': '便當', '宇航員': '太空人', '熊貓': '貓熊', '奔馳': '賓士', '新西蘭': '紐西蘭', '悉尼': '雪梨', '意大利': '義大利',
    '網吧': '網咖', '卡拉OK': 'KTV', '手機號': '手機號碼', '水平': '水準／程度 (when it means level)', '聯繫': '聯絡',
    '反饋': '回饋', '優化': '最佳化', '智能': '智慧', '高清': '高畫質', '移動電話': '行動電話', '人工智能': '人工智慧',
    '小時工': '鐘點工', '創可貼': 'OK 繃', '圓珠筆': '原子筆', '橡皮': '橡皮擦', '撲克': '撲克牌', '立交橋': '交流道',
}
ERHUA = {'哪兒': '哪裡', '這兒': '這裡', '那兒': '那裡', '一點兒': '一點', '有點兒': '有一點', '一塊兒': '一起', '一下兒': '一下',
         '玩兒': '玩', '事兒': '事', '小孩兒': '小孩', '好玩兒': '好玩', '沒事兒': '沒事', '聊天兒': '聊天', '這會兒': '現在',
         '一邊兒': '一邊', '旁邊兒': '旁邊', '畫兒': '畫', '花兒': '花', '門兒': '門', '勁兒': '勁', '點兒': '點'}
LOOK = {'咱們': 'northern; Taiwan says 我們', '早上好': 'Taiwan says 早安', '晚上好': 'Taiwan says 晚安 or just 你好', '下午好': 'Taiwan says 午安 or 你好',
        '挺': 'northern for 很／蠻 (挺好的)', '甭': 'northern for 不用', '倍兒': 'northern', '啥': 'northern for 什麼', '咋': 'northern for 怎麼',
        '立馬': 'mainland for 馬上', '給力': 'mainland slang'}
# 兒 that is the word, not the north's suffix
ER_OK = ('兒子', '女兒', '兒童', '嬰兒', '孤兒', '幼兒', '兒女', '兒時', '兒歌', '小兒', '健兒', '兒科')


def sources(which):
    if which in (None, 'usage'):
        words = {w['id']: w for w in applib.read_data('WORDS')}
        for wid, phrases in applib.read_data('USAGE').items():
            for p in phrases:
                yield 'usage', f"{words[wid]['t'] if wid in words else wid}", p[0]
    if which in (None, 'stories'):
        for l, stories in applib.read_data('READINGS').items():
            for s in stories:
                yield 'stories', s.get('t', ''), s.get('t', '') + '。' + s.get('zh', '')
    if which in (None, 'grammar'):
        for l, points in applib.read_data('GRAMMAR').items():
            for p in points:
                for s in p.get('s', []):
                    yield 'grammar', p['id'], s['zh']
    if which in (None, 'pairs'):
        try:
            pairs = applib.read_data('PAIRS')
        except SystemExit:
            pairs = []
        for p in pairs:
            for s in p['side']:
                yield 'pairs', p['zh'], s[1]
            for q in p['q']:
                for text in (q['opts'] if q.get('pick') else [q['zh'].replace('⬚', '' if q['a'] == '∅' else q['a'])]):
                    yield 'pairs', p['zh'], text


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', choices=['usage', 'stories', 'grammar', 'pairs'])
    ap.add_argument('--terms', action='store_true')
    args = ap.parse_args()
    if args.terms:
        for name, table in (('Mainland word → Taiwan', TERMS), ('Erhua → without it', ERHUA), ('Worth a look', LOOK)):
            print(f'\n{name}')
            for k, v in table.items():
                print(f'  {k}  →  {v}')
        return

    taught = {w['t'].split('（')[0] for w in applib.read_data('WORDS')}
    table = {}
    table.update({k: ('word', v) for k, v in TERMS.items()})
    table.update({k: ('erhua', v) for k, v in ERHUA.items()})
    table.update({k: ('look', v) for k, v in LOOK.items()})
    keys = sorted((k for k in table if k not in taught), key=len, reverse=True)
    skipped = sorted(k for k in table if k in taught)
    finder = re.compile('|'.join(re.escape(k) for k in keys))
    hits, counts, lines = {}, {}, 0
    for src, where, text in sources(args.source):
        lines += 1
        counts[src] = counts.get(src, 0) + 1
        clean = text
        for ok in ER_OK:
            clean = clean.replace(ok, '〇' * len(ok))
        for w in taught:                                   # a taught word that holds a listed one inside it is the course's
            if len(w) > 1 and w in clean and ('兒' in w or any(k in w for k in keys)):
                clean = clean.replace(w, '〇' * len(w))
        found = set(finder.findall(clean))
        if '兒' in clean and not any(k.endswith('兒') and k in found for k in keys):
            found.add('兒')                                # a 兒 this list does not name: still worth a look
        for k in found:
            if k in ('挺', '啥', '咋', '甭') and not re.search(k + r'[一-鿿]', clean):
                continue
            hits.setdefault(k, []).append((src, where, text))

    print(f"{lines} lines read: " + ', '.join(f'{n} {s}' for s, n in counts.items()))
    if skipped:
        print('not looked for, because the course teaches them: ' + ' '.join(skipped))
    if not hits:
        print('nothing flagged')
        return
    order = {'word': 0, 'erhua': 1, 'look': 2}
    for k in sorted(hits, key=lambda k: (order.get(table.get(k, ('look',))[0], 2), -len(hits[k]))):
        kind, instead = table.get(k, ('erhua', 'a 兒 not on the list: suffix, or part of a word?'))
        print(f"\n{k}  ({kind}; {instead})  — {len(hits[k])} line(s)")
        for src, where, text in hits[k][:25]:
            print(f"  [{src} · {where}] {text[:90]}")
        if len(hits[k]) > 25:
            print(f'  … and {len(hits[k]) - 25} more')
    print(f"\n{sum(len(v) for v in hits.values())} flagged line(s) under {len(hits)} term(s). Nothing was changed.")


if __name__ == '__main__':
    main()

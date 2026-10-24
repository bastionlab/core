#!/usr/bin/env python3
"""Builds addons/kanji/web/server/data/kanji.json — the /kanji deck: every JLPT kanji (N5 → N1, by frequency within a level)
with meanings, readings and up to three common example words.

Sources (download into an empty dir, pass it as the argument):
  kanji.json           https://github.com/davidluzgouveia/kanji-data (KANJIDIC2 + WaniKani meanings, MIT)
  jmdict-eng-common-*.json  https://github.com/scriptin/jmdict-simplified/releases (JMdict, CC BY-SA 4.0)
Run: python3 -I addons/kanji/scripts/build-kanji.py /tmp/kanji-dl
"""
import glob, json, os, re, sys

src = sys.argv[1]
K = json.load(open(os.path.join(src, 'kanji.json')))
J = json.load(open(glob.glob(os.path.join(src, 'jmdict-eng-common-*.json'))[0]))['words']
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'server', 'data', 'kanji.json')

lvl = {k: v['jlpt_new'] for k, v in K.items() if v['jlpt_new']}
freq = {k: v['freq'] or 3000 for k, v in K.items()}
is_kanji = lambda c: '一' <= c <= '鿿' or c == '々'

# every common word, once per written form: (form, reading, gloss)
words = {}
for w in J:
    forms = [x['text'] for x in w['kanji'] if x['common']]
    if not forms:
        continue
    form = forms[0]
    if not all(is_kanji(c) or '\u3040' <= c <= '\u30ff' for c in form):   # no ９日, no Ｔシャツ
        continue
    kana = next((x['text'] for x in w['kana'] if x['common'] and ('*' in x['appliesToKanji'] or form in x['appliesToKanji'])), None)
    if not kana or not w['sense']:
        continue
    gloss = '; '.join(g['text'] for g in w['sense'][0]['gloss'][:2])
    for c in set(form):
        if c in lvl:
            words.setdefault(c, []).append((form, kana, gloss))

def score(k, form):
    ks = [c for c in form if is_kanji(c)]
    harder = sum(1 for c in ks if lvl.get(c, 0) < lvl[k])        # N1 = 1: a lower number is a harder kanji
    return (harder, len(ks) > 2, max([freq.get(c, 3000) for c in ks if c != k] or [0]) // 200, abs(len(form) - 2), len(form))

def meanings(v):
    m = v['wk_meanings'] or [x for x in v['meanings'] if 'radical' not in x.lower()] or v['meanings']
    return [re.sub(r'^\^', '', x) for x in m][:4]

deck = []
for k, v in sorted(((k, v) for k, v in K.items() if k in lvl), key=lambda kv: (-kv[1]['jlpt_new'], kv[1]['freq'] or 9999, kv[1]['strokes'])):
    cand = sorted({w[0]: w for w in words.get(k, [])}.values(), key=lambda w: score(k, w[0]))
    deck.append({
        'k': k, 'n': v['jlpt_new'], 's': v['strokes'], 'm': meanings(v),
        'on': v['readings_on'][:4], 'kun': v['readings_kun'][:4],
        'w': [list(w) for w in cand[:3]],
    })

json.dump(deck, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(deck), 'kanji →', OUT, os.path.getsize(OUT) // 1024, 'KB')

"""Merges the chart rows in raw/ into one entry per album, and marks the albums /mu/core already has.

The same album turns up on many charts, spelled a little differently each time ("The Knife" and
"Knife", "Floral Shoppe" and "FLORAL SHOPPE", "Self-Titled" for an album named after its artist).
Two rows are the same album when:

1. their artist and album read the same once case, accents, punctuation, a leading "The" and
   anything in brackets are set aside, or
2. their artists read the same and their albums are close: a typo apart, or one is the other plus a
   subtitle after ":", " - " or "/", or plus "EP". Numbers must agree, Roman and spelled out too,
   so "Mass III" never meets "Mass V" nor "Volume One" "Volume Two". Compilations by various
   artists never match this way, since "Folk Music of Albania" is a typo away from "of Armenia".
3. their albums read the same and their artists are close: a typo apart, one holds the other
   ("Bill Evans" and "Bill Evans Trio", "Bach" and "Johann Sebastian Bach"), one holds the other's
   words in order ("Fela Kuti" and "Fela Ransome Kuti & Africa 70"), or one is the other with
   initials ("J.S. Bach"). "Various Artists" meets a named artist only on an album of three words
   or more: field recordings that one chart credits to "Various" and another to the performer.

A row with no album (the chart printed only the artist) is never merged by name; the lookup finds
its album first. /mu/core's works (../mucore.yaml) go through the same rules, so an album both
there and on a chart ends up in one entry that names its /mu/core work.

    python3 dedupe.py    # writes albums.json and merges.tsv beside this script

albums.json holds one entry per album: its name as most charts spell it, the year if a chart gives
one, the /mu/core work id if it has one, and every chart row it came from. merges.tsv lists the
entries made from rows that are spelled differently, to check by eye that rules 2 and 3 did not
join two different albums.
"""

import collections
import difflib
import glob
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from mucore_covers import split_title  # noqa: E402

RAW = os.path.join(HERE, 'raw')
MUCORE = os.path.join(os.path.dirname(HERE), 'mucore.yaml')
ALBUMS = os.path.join(HERE, 'albums.json')
MERGES = os.path.join(HERE, 'merges.tsv')
# Letters that NFKD keeps whole, so they would not meet their plain spelling (Lustmørd, Hliðskjálf).
LETTERS = str.maketrans({'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ð': 'd', 'þ': 'th', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ı': 'i'})
SELF_TITLED = {'self titled', 's t', 'st', 'selftitled', 'untitled self titled'}
VARIOUS = {'various artists', 'various', 'va', 'v a', 'various artist'}


def key(text: str) -> str:
    """Lower case without accents, punctuation, a leading "the" or brackets. Keeps kana, hangul and kanji."""
    text = unicodedata.normalize('NFKC', text)
    text = re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', ' ', text) if re.sub(r'[\(\[][^\)\]]*[\)\]]', '', text).strip() else text
    text = ''.join(c for c in unicodedata.normalize('NFKD', text.casefold()) if not unicodedata.combining(c))
    text = text.translate(LETTERS).replace('&', ' and ')
    text = re.sub(r'[\W_]+', ' ', text).strip()
    return re.sub(r'^the ', '', text)


def artist_key(artist: str) -> str:
    k = key(artist)
    return 'various' if k in VARIOUS else k


def album_key(artist: str, album: str) -> str:
    k = key(album)
    return artist_key(artist) if k in SELF_TITLED else k


NUMBERS = {
    **{r: n for n, r in enumerate('i ii iii iv v vi vii viii ix x xi xii xiii'.split(), 1)},
    **{w: n for n, w in enumerate('one two three four five six seven eight nine ten eleven twelve'.split(), 1)},
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
}
SUBTITLE = re.compile(r'\s*(?::|\s[-–]\s|/|\+|·|;)')


def numbers(k: str) -> list[int]:
    """The numbers in a key, however they are written: "pt ii", "part 2" and "part two" agree."""
    return [int(t) if t.isdigit() else NUMBERS[t] for t in re.findall(r'\d+|[a-z]+', k) if t.isdigit() or t in NUMBERS]


def typo(a: str, b: str) -> bool:
    return min(len(a), len(b)) >= 5 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.88


def same_album(a: str, b: str) -> bool:
    ka, kb = key(a), key(b)
    if not ka or not kb or numbers(ka) != numbers(kb):
        return False
    if ka == kb or typo(ka, kb):
        return True
    (short, s_raw), (long, l_raw) = sorted(((ka, a), (kb, b)), key=lambda x: len(x[0]))
    if not long.startswith(short + ' '):
        return False
    rest = long[len(short) :].strip()
    # The longer one goes on after a separator ("Necroticism: Descanting...") or adds only "EP".
    head = key(SUBTITLE.split(l_raw, maxsplit=1)[0]) if SUBTITLE.search(l_raw) else ''
    return rest in ('ep', 'lp', 'soundtrack') or head == short


def in_order(short: list[str], long: list[str]) -> bool:
    words = iter(long)
    return all(w in words for w in short)


def initials(short: list[str], long: list[str]) -> bool:
    """"j s bach" for "johann sebastian bach": the same last name, and each initial a first letter."""
    if len(short) != len(long) or short[-1] != long[-1] or short == long:
        return False
    return all(s == l or (len(s) == 1 and l.startswith(s)) for s, l in zip(short[:-1], long[:-1]))


def same_artist(a: str, b: str, album: str) -> bool:
    ka, kb = artist_key(a), artist_key(b)
    if not ka or not kb:
        return ka == kb
    if 'various' in (ka, kb):
        return ka == kb or len(album.split()) >= 3
    if ka == kb or typo(ka, kb) or ka.replace(' ', '') == kb.replace(' ', ''):
        return True
    (short, long) = sorted((ka.split(), kb.split()), key=lambda w: len(' '.join(w)))
    if len(' '.join(short)) >= 4 and f' {" ".join(short)} ' in f' {" ".join(long)} ':
        return True
    return (len(short) >= 2 and in_order(short, long)) or initials(short, long)


def read_rows() -> list[dict]:
    rows = []
    for path in sorted(glob.glob(os.path.join(RAW, '*.tsv'))):
        chart = os.path.basename(path)[:-4]
        with open(path, encoding='utf-8') as f:
            lines = f.read().split('\n')[1:]
        for line in lines:
            if not line.strip() or line.startswith('#'):
                continue
            pos, artist, album, year, confidence, note = line.split('\t')
            if key(album) in SELF_TITLED:
                album = artist
            rows.append({'chart': chart, 'pos': int(pos), 'artist': artist, 'album': album, 'year': year, 'confidence': confidence, 'note': note})
    return rows


def read_mucore() -> list[dict]:
    works = []
    with open(MUCORE, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'\s+- \{ id: "([^"]+)", title: ("(?:[^"\\]|\\.)*"), medium: album', line)
            if m:
                artist, album = split_title(json.loads(m[2]))
                works.append({'mucore': m[1], 'artist': artist, 'album': album})
    return works


class Groups:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def join(self, a: int, b: int) -> None:
        self.parent[self.find(a)] = self.find(b)


def merge(items: list[dict]) -> Groups:
    groups = Groups(len(items))
    keys = [(artist_key(x['artist']), album_key(x['artist'], x['album'])) for x in items]
    by_pair, by_artist, by_album = {}, collections.defaultdict(list), collections.defaultdict(list)
    for i, (a, b) in enumerate(keys):
        if not b:
            continue
        if (a, b) in by_pair:
            groups.join(i, by_pair[(a, b)])
        else:
            by_pair[(a, b)] = i
            by_artist[a].append(i)
            by_album[b].append(i)
    # Rules 2 and 3 compare one row per spelling, so each bucket stays small.
    for a, bucket in by_artist.items():
        if a == 'various':
            continue
        for x, i in enumerate(bucket):
            for j in bucket[x + 1 :]:
                if same_album(items[i]['album'], items[j]['album']):
                    groups.join(i, j)
    for b, bucket in by_album.items():
        for x, i in enumerate(bucket):
            for j in bucket[x + 1 :]:
                if same_artist(items[i]['artist'], items[j]['artist'], b):
                    groups.join(i, j)
    return groups


def most_common(values: list[str]) -> str:
    values = [v for v in values if v]
    return collections.Counter(values).most_common(1)[0][0] if values else ''


def main() -> None:
    rows = read_rows()
    works = read_mucore()
    items = rows + works
    groups = merge(items)
    clusters = collections.defaultdict(list)
    for i, item in enumerate(items):
        clusters[groups.find(i)].append(item)

    albums, merges = [], []
    for members in clusters.values():
        chart_rows = [m for m in members if 'chart' in m]
        if not chart_rows:
            continue
        mucore = sorted({m['mucore'] for m in members if 'mucore' in m})
        sure = [r for r in chart_rows if r['confidence'] == 'ok'] or chart_rows
        spelled = collections.Counter((r['artist'], r['album']) for r in sure).most_common()
        artist, album = spelled[0][0]
        albums.append({
            'artist': artist,
            'album': album,
            'year': most_common([r['year'] for r in chart_rows]),
            'mucore': mucore,
            'rows': [{k: r[k] for k in ('chart', 'pos', 'artist', 'album', 'confidence', 'note') if r[k] or k == 'album'} for r in chart_rows],
        })
        spellings = {(m['artist'], m['album']) for m in members}
        if len({(artist_key(a), album_key(a, b)) for a, b in spellings}) > 1:
            merges.append((artist, album, ' | '.join(sorted(f'{a} - {b}' for a, b in spellings))))

    albums.sort(key=lambda a: (artist_key(a['artist']), album_key(a['artist'], a['album'])))
    for n, a in enumerate(albums, 1):
        a['id'] = n
    with open(ALBUMS, 'w', encoding='utf-8') as f:
        json.dump([{k: a[k] for k in ('id', 'artist', 'album', 'year', 'mucore', 'rows')} for a in albums], f, ensure_ascii=False, indent=1)
        f.write('\n')
    with open(MERGES, 'w', encoding='utf-8') as f:
        f.write('artist\talbum\tspellings merged\n')
        for line in sorted(merges, key=lambda m: m[0].casefold()):
            f.write('\t'.join(line) + '\n')

    in_mucore = sum(1 for a in albums if a['mucore'])
    no_album = sum(1 for a in albums if not a['album'])
    matched_works = len({w for a in albums for w in a['mucore']})
    print(f'{len(rows)} chart rows -> {len(albums)} albums ({len(merges)} joined across spellings)')
    print(f'{in_mucore} already in /mu/core (matching {matched_works} of its {len(works)} works), {len(albums) - in_mucore} new')
    print(f'{no_album} rows name only an artist')


if __name__ == '__main__':
    main()

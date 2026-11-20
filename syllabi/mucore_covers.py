"""Gives each recording in mucore.yaml its album cover (DARK-8), for the randomizer to show.

Each work's title reads `Genre: Artist - Album (Year)`. Its cover is, in order:

1. A cover on the web, sharp enough for a card: the album on Deezer (500 px), or else the release
   group on MusicBrainz with a front cover on the Cover Art Archive (500 px). A match counts only
   when its title and artist are close to the work's, so a miss is left a miss rather than guessed.
2. Otherwise the album's own square on the chart (musicgenretree.org's image map gives each one, by
   the number that starts the work's id), cut out at the chart's 60 px and shipped with the web app
   under apps/web/public/covers/mucore/. Soft on a card, but always the right album.

Rewrites mucore.yaml in place, touching only the work lines, and only those without a cover yet.
Answers from the web are kept in a cache file (the first argument, `mucore_covers.json` by default)
so an interrupted run picks up where it stopped; the chart is downloaded once into the folder beside
it. MusicBrainz asks for one request a second, so the albums Deezer misses take most of the time.
Needs Pillow for the cut-outs.

Run `python3 mucore_covers.py` here; the YAML and the cut-outs are what ship.
"""

import difflib
import http.client
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

YAML = 'mucore.yaml'
CACHE = sys.argv[1] if len(sys.argv) > 1 else 'mucore_covers.json'
CHART_DIR = os.path.join(os.path.dirname(os.path.abspath(CACHE)), 'mucore_chart')
CUTOUTS = os.path.join('..', 'apps', 'web', 'public', 'covers', 'mucore')
CUTOUT_URL = '/covers/mucore/'
AGENT = 'syllabus-cover-lookup/1.0'
DEEZER = 'https://api.deezer.com/search/album'
MB = 'https://musicbrainz.org/ws/2/release-group/'
CAA = 'https://coverartarchive.org/release-group/'
SITE = 'https://www.musicgenretree.org/'
CHART_PAGE = 'chart.html'
CHART_IMAGE = '1111 Essential Recordings of Music Classics (HiRes).png'

WORK = re.compile(r'^(?P<lead>\s+- \{ id: "(?P<id>[^"]+)", title: (?P<title>"(?:[^"\\]|\\.)*"), medium: album)(?P<rest>.*)\}$')


def split_title(title):
    """`Genre: Artist - Album (Year)` as (artist, album). The same reading as the syllabus's randomizer source."""
    rest = title.split(': ', 1)[1] if ': ' in title else title
    rest = re.sub(r'\s*\([^()]*\d[^()]*\)\s*$', '', rest)
    parts = re.split(r'\s+-\s*|\s*-\s+', rest, maxsplit=1)
    return (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else ('', rest.strip())


def norm(text):
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode() or text
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def core(text):
    """A title without what is in brackets, `(Remastered 2009)` or `[DFS 7006]`, unless that is all of it."""
    return norm(re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', ' ', text)) or norm(text)


def close(a, b):
    a, b = core(a), core(b)
    if not a or not b:
        return False
    # Numbers name the record: Oxygène is not Oxygène 3, nor Volume 1 Volume 2.
    if re.findall(r'\d+', a) != re.findall(r'\d+', b):
        return False
    short, long = sorted((a, b), key=len)
    return a == b or (len(short) >= 4 and short in long) or difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


def various(artist):
    return norm(artist) in ('various', 'various artists', '')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # The cover's own redirect (to the Internet Archive, which is slow) is the answer: there is one.
    def redirect_request(self, *args):
        return None


open_url = urllib.request.build_opener(NoRedirect).open
last_call = {}
# Seconds between requests to each host: MusicBrainz asks for one a second, Deezer allows ten.
SPACING = {'musicbrainz.org': 1.1, 'api.deezer.com': 0.15}


def get(url, head=False):
    host = urllib.parse.urlparse(url).hostname
    for attempt in range(6):
        wait = SPACING.get(host, 0) - (time.time() - last_call.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        last_call[host] = time.time()
        request = urllib.request.Request(url, method='HEAD' if head else 'GET', headers={'User-Agent': AGENT, 'Accept': 'application/json'})
        try:
            with open_url(request, timeout=30) as response:
                return response.status, (None if head else json.load(response))
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 307, 308):
                return error.code, None
            if error.code in (429, 502, 503):
                time.sleep(1 + attempt)
                continue
            return error.code, None
        except (OSError, http.client.HTTPException, json.JSONDecodeError):
            # Offline for a moment, a dropped connection, half an answer: try again.
            time.sleep(2 + attempt)
    return 0, None


def deezer(artist, album):
    queries = [f'album:"{album}"' if various(artist) else f'artist:"{artist}" album:"{album}"', f'{"" if various(artist) else artist} {album}'.strip()]
    for query in queries:
        status, body = get(f'{DEEZER}?{urllib.parse.urlencode({"q": query, "limit": 10})}')
        if status != 200 or not isinstance(body, dict) or 'error' in body:
            continue
        for found in body.get('data', []):
            if close(found.get('title', ''), album) and (various(artist) or close(found.get('artist', {}).get('name', ''), artist)) and found.get('cover_big'):
                return found['cover_big']
    return ''


def lucene(text):
    return re.sub(r'([+\-&|!(){}\[\]^"~*?:\\/])', r'\\\1', text)


def musicbrainz(artist, album):
    queries = [f'releasegroup:"{lucene(album)}"'] if various(artist) else [
        f'releasegroup:"{lucene(album)}" AND artist:"{lucene(artist)}"',
        f'releasegroup:({lucene(album)}) AND artist:({lucene(artist)})',
    ]
    seen = set()
    for query in queries:
        status, body = get(f'{MB}?{urllib.parse.urlencode({"query": query, "fmt": "json", "limit": 8})}')
        if status != 200 or not body:
            continue
        for group in body.get('release-groups', []):
            if group['id'] in seen or group.get('score', 0) < 60 or len(seen) >= 4:
                continue
            seen.add(group['id'])
            credit = ''.join(c.get('name', '') + c.get('joinphrase', '') for c in group.get('artist-credit', []))
            if not close(group.get('title', ''), album) or (not various(artist) and not close(credit, artist)):
                continue
            status, _ = get(f'{CAA}{group["id"]}/front-250', head=True)
            if status in (200, 302, 307):
                return f'{CAA}{group["id"]}/front-500'
    return ''


def web_cover(title, cache):
    """A sharp cover from the web, or ''. Each service is asked once per title, ever."""
    known = cache.setdefault(title, {})
    artist, album = split_title(title)
    if not album:
        return ''
    if known.get('musicbrainz'):
        return known['musicbrainz']
    if 'deezer' not in known:
        known['deezer'] = deezer(artist, album)
    if known['deezer']:
        return known['deezer']
    if 'musicbrainz' not in known:
        known['musicbrainz'] = musicbrainz(artist, album)
    return known['musicbrainz']


def chart():
    """Each album's square on the chart, by its number (`0002`), and the chart image itself."""
    os.makedirs(CHART_DIR, exist_ok=True)
    paths = {}
    for name in (CHART_PAGE, CHART_IMAGE):
        path = paths[name] = os.path.join(CHART_DIR, name)
        if not os.path.exists(path):
            urllib.request.urlretrieve(SITE + urllib.parse.quote(name), path)
    html = open(paths[CHART_PAGE], encoding='utf-8').read()
    squares = {n: tuple(map(int, box)) for n, *box in re.findall(r'title="(\d+) \|[^"]*"[^>]*coords="(\d+),(\d+),(\d+),(\d+)"', html)}
    from PIL import Image

    return squares, Image.open(paths[CHART_IMAGE]).convert('RGB')


def main():
    try:
        with open(CACHE, encoding='utf-8') as f:
            cache = json.load(f)
    except FileNotFoundError:
        cache = {}
    # The first runs kept only MusicBrainz's answer, as a string.
    cache = {t: (v if isinstance(v, dict) else {'musicbrainz': v}) for t, v in cache.items()}
    with open(YAML, encoding='utf-8') as f:
        lines = f.read().split('\n')
    works = [(i, m) for i, line in enumerate(lines) if (m := WORK.match(line)) and 'cover:' not in m['rest']]
    squares, image = None, None
    counts = {'web': 0, 'chart': 0, 'none': 0}
    for n, (i, m) in enumerate(works, 1):
        title = json.loads(m['title'])
        cover = web_cover(title, cache)
        with open(CACHE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, ensure_ascii=False, indent=0)
        how = 'web' if cover else 'none'
        if not cover:
            if squares is None:
                squares, image = chart()
            number = m['id'].split('-', 1)[0]
            if number in squares:
                os.makedirs(CUTOUTS, exist_ok=True)
                image.crop(squares[number]).save(os.path.join(CUTOUTS, f'{number}.webp'), quality=90)
                cover, how = f'{CUTOUT_URL}{number}.webp', 'chart'
        counts[how] += 1
        if cover:
            lines[i] = f'{m["lead"]}{m["rest"].rstrip()}, cover: "{cover}" }}'
        print(f'{n}/{len(works)} {how:5} {title}', flush=True)
    with open(YAML, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print(f'{counts["web"]} covers from the web, {counts["chart"]} from the chart, {counts["none"]} without, of {len(works)}')


if __name__ == '__main__':
    main()

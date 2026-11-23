"""Joins albums.json with the answers in lookup.json into the final album list, essentials.json.

Two entries of albums.json that the lookup found to be the same release (the same Deezer album or
MusicBrainz release group) become one, and an entry whose release is one /mu/core already uses (by
the Deezer cover or release group in mucore.yaml's cover URLs) is marked as /mu/core's.

Each album of essentials.json has:

- `artist`, `album`: as the service spells them, without "(Remastered)" or "Deluxe Edition"; as the
  chart spells them when no service found the album. When one artist credit holds the other ("Bill
  Evans" and "Bill Evans & Jim Hall"), the fuller one is kept.
- `year`: from a chart, or else the earliest release MusicBrainz knows. Deezer gives none.
- `tracks`, `cover`, `link`: from the release found, where there is one.
- `youtube`: a YouTube search for the artist and album.
- `found`: "deezer", "musicbrainz" or "".
- `check`: true when no service found it and a chart's name for it was hard to read or came from the
  cover alone, so the name itself may be wrong.
- `charts`: every chart row it came from (chart id, place, section).
- `mucore`: the /mu/core work ids it matches.

    python3 report.py    # writes essentials.json and prints a summary
"""

import collections
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dedupe import artist_key, key  # noqa: E402
from lookup import cache_key  # noqa: E402

ALBUMS = os.path.join(HERE, 'albums.json')
CACHE = os.path.join(HERE, 'lookup.json')
MUCORE = os.path.join(os.path.dirname(HERE), 'mucore.yaml')
OUT = os.path.join(HERE, 'essentials.json')
EDITION = r'remaster|deluxe|edition|expanded|anniversary|reissue|bonus|version|mono|stereo|bonus tracks?'
EDITION_BRACKETS = re.compile(rf'\s*[\(\[][^\)\]]*(?:{EDITION})[^\)\]]*[\)\]]', re.I)
EDITION_DASH = re.compile(rf'\s+[-–]\s+[^-–]*(?:{EDITION})[^-–]*$', re.I)


def plain_title(title: str) -> str:
    return EDITION_DASH.sub('', EDITION_BRACKETS.sub('', title)).strip() or title


def fuller_artist(chart: str, found: str) -> str:
    """The service's spelling, unless the chart's credit holds it and more ("& Jim Hall")."""
    a, b = artist_key(chart), artist_key(found)
    if a != b and b and f' {b} ' in f' {a} ':
        return chart
    return found or chart


def mucore_releases() -> dict[str, str]:
    """mucore.yaml's covers by Deezer cover hash or MusicBrainz release group, to its work id."""
    known = {}
    with open(MUCORE, encoding='utf-8') as f:
        for line in f:
            m = re.match(r'\s+- \{ id: "([^"]+)".*cover: "([^"]+)"', line)
            if not m:
                continue
            deezer = re.search(r'/images/cover/([0-9a-f]{32})/', m[2])
            group = re.search(r'/release-group/([0-9a-f-]{36})/', m[2])
            if deezer or group:
                known[(deezer or group)[1]] = m[1]
    return known


def release_ids(found: dict | None) -> list[str]:
    if not found:
        return []
    ids = [str(found.get('id', ''))]
    cover = re.search(r'/images/cover/([0-9a-f]{32})/', found.get('cover', ''))
    return [i for i in ids + ([cover[1]] if cover else []) if i]


def main() -> None:
    with open(ALBUMS, encoding='utf-8') as f:
        albums = json.load(f)
    with open(CACHE, encoding='utf-8') as f:
        cache = json.load(f)
    on_mucore = mucore_releases()

    # Entries that found the same release are one album: join them by that release's ids.
    owner: dict[str, int] = {}
    parent = list(range(len(albums)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(albums):
        known = cache.get(cache_key(a), {})
        a['_found'], a['_source'] = (known.get('deezer'), 'deezer') if known.get('deezer') else (known.get('musicbrainz'), 'musicbrainz' if known.get('musicbrainz') else '')
        for rid in release_ids(a['_found']):
            if rid in on_mucore and on_mucore[rid] not in a['mucore']:
                a['mucore'] = sorted(a['mucore'] + [on_mucore[rid]])
            if rid in owner:
                parent[find(i)] = find(owner[rid])
            else:
                owner[rid] = i

    groups = collections.defaultdict(list)
    for i, a in enumerate(albums):
        groups[find(i)].append(a)

    out = []
    for members in groups.values():
        # The entry with the most chart rows names the album.
        lead = max(members, key=lambda a: len(a['rows']))
        rows = [r for a in members for r in a['rows']]
        found, source = lead['_found'], lead['_source']
        if not found:
            found, source = next(((a['_found'], a['_source']) for a in members if a['_found']), (None, ''))
        artist, album = lead['artist'], lead['album']
        if found:
            artist, album = fuller_artist(artist, found.get('artist', '')), plain_title(found.get('title', '')) or album
        # Deezer's dates are often a reissue's, so only MusicBrainz's earliest release counts.
        year = next((a['year'] for a in members if a['year']), '') or ((found or {}).get('date', '')[:4] if source == 'musicbrainz' else '')
        out.append({
            'artist': artist,
            'album': album,
            'year': year,
            'tracks': (found or {}).get('tracks') or None,
            'cover': (found or {}).get('cover', ''),
            'link': (found or {}).get('link', ''),
            'youtube': 'https://www.youtube.com/results?' + urllib.parse.urlencode({'search_query': f'{"" if artist_key(artist) == "various" else artist} {album}'.strip()}),
            'found': source,
            'check': not found and any(r['confidence'] != 'ok' for r in rows),
            'charts': [{k: r[k] for k in ('chart', 'pos', 'note') if k in r} for r in rows],
            'mucore': sorted({w for a in members for w in a['mucore']}),
        })

    out.sort(key=lambda a: (artist_key(a['artist']), key(a['album'])))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write('\n')

    new = [a for a in out if not a['mucore']]
    by = collections.Counter(a['found'] or 'not found' for a in new)
    print(f'{len(albums)} entries of albums.json -> {len(out)} albums ({len(albums) - len(out)} joined by release)')
    print(f'{len(out) - len(new)} already in /mu/core, {len(new)} new')
    print(f'new albums: {by["deezer"]} found on Deezer, {by["musicbrainz"]} on MusicBrainz, {by["not found"]} not found')
    print(f'{sum(1 for a in new if a["tracks"])} new albums with a track count, {sum(1 for a in new if a["cover"])} with a cover, {sum(1 for a in new if a["year"])} with a year')
    print(f'{sum(1 for a in new if a["check"])} not found and read with doubt (check: true)')


if __name__ == '__main__':
    main()

"""Looks up each album of albums.json on Deezer, and on MusicBrainz when Deezer has no match.

For every album not already in /mu/core it records the release it matched: its id, its name as the
service spells it, its track count, its year, a cover and a link. A result counts only when its
title and artist are the album's by the rules of dedupe.py (same_album, same_artist), so a miss is
left a miss rather than guessed.

- Deezer allows 50 requests in 5 seconds. Its album search gives the track count, cover and link,
  but no year; its release dates are often a reissue's anyway, so the year comes from the charts.
  Several searches run at once, since each one waits on the network far longer than the limit.
- MusicBrainz allows one request to start each second, and takes a second or two to answer, so
  three are kept in flight. Its release search gives the track count and date of each
  release; the earliest matching one gives the year, and the release group's cover comes from the
  Cover Art Archive when it has one.

They run side by side: each Deezer miss goes straight to the MusicBrainz queue, and each MusicBrainz
match to the cover check, so the whole run takes about as long as MusicBrainz alone. Answers are kept in lookup.json (written every few
seconds and at the end), so a run that is stopped picks up where it left off.

    python3 lookup.py            # look up every album not asked yet
    python3 lookup.py --retry    # ask MusicBrainz again about albums it found nothing for
    python3 lookup.py --recheck-deezer   # ask Deezer again about albums it found nothing for
"""

import http.client
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from dedupe import artist_key, key, same_album, same_artist  # noqa: E402
from mucore_covers import AGENT, CAA, DEEZER, get, lucene  # noqa: E402

ALBUMS = os.path.join(HERE, 'albums.json')
CACHE = os.path.join(HERE, 'lookup.json')
MB_RELEASE = 'https://musicbrainz.org/ws/2/release/'
SAVE_EVERY = 10  # seconds
DEEZER_LANES = 12
DEEZER_PER_SECOND = 8
MUSICBRAINZ_LANES = 3
MUSICBRAINZ_PER_SECOND = 0.9

lock = threading.Lock()


class Pace:
    def __init__(self, per_second: float):
        self.gap, self.next, self.lock = 1 / per_second, 0.0, threading.Lock()

    def wait(self) -> None:
        with self.lock:
            now = time.time()
            at = max(now, self.next)
            self.next = at + self.gap
        time.sleep(max(0.0, at - now))


deezer_pace = Pace(DEEZER_PER_SECOND)
musicbrainz_pace = Pace(MUSICBRAINZ_PER_SECOND)
refused = {'deezer': 0, 'musicbrainz': 0}
sent = {'deezer': 0, 'musicbrainz': 0}


def fetch(url: str) -> tuple[int, dict | None]:
    """One GET, no retries: the callers retry, each in its service's pace. 0 when the network failed."""
    request = urllib.request.Request(url, headers={'User-Agent': AGENT, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None
    except (OSError, http.client.HTTPException, json.JSONDecodeError):
        return 0, None


def paced_get(service: str, pace: Pace, url: str) -> dict | None:
    """The answer, or None. A refusal (Deezer's quota error, MusicBrainz's 503) or a network failure
    waits a little longer each time and asks again, in the pace like any other request."""
    for attempt in range(8):
        pace.wait()
        sent[service] += 1
        status, body = fetch(url)
        over = status in (429, 503) or (isinstance(body, dict) and body.get('error', {}).get('code') == 4)
        if over or status in (0, 500, 502, 504):
            refused[service] += over
            time.sleep(1 + attempt)
            continue
        return body if status == 200 and isinstance(body, dict) and 'error' not in body else None
    return None


def cache_key(album: dict) -> str:
    return f'{album["artist"]}\t{album["album"]}'


def matches(artist: str, album: str, found_artist: str, found_title: str) -> bool:
    if not same_album(album, found_title):
        return False
    # A chart row with no artist (Noise Hip Hop prints titles only) needs the title to agree exactly.
    if not artist:
        return key(album) == key(found_title)
    return same_artist(artist, found_artist, key(album))


def deezer(artist: str, album: str) -> dict | None:
    various = artist_key(artist) == 'various' or not artist
    queries = [f'album:"{album}"' if various else f'artist:"{artist}" album:"{album}"', f'{"" if various else artist} {album}'.strip()]
    for query in queries:
        body = paced_get('deezer', deezer_pace, f'{DEEZER}?{urllib.parse.urlencode({"q": query, "limit": 10})}')
        if not body:
            continue
        found = [d for d in body.get('data', []) if matches(artist, album, d.get('artist', {}).get('name', ''), d.get('title', ''))]
        if not found:
            continue
        # An exact title beats "Deluxe Edition"; a full album beats a single of the same name.
        best = min(found, key=lambda d: (key(d['title']) != key(album), d.get('record_type') != 'album'))
        return {
            'id': best['id'],
            'artist': best['artist']['name'],
            'title': best['title'],
            'tracks': best.get('nb_tracks'),
            'type': best.get('record_type'),
            'cover': best.get('cover_big', ''),
            'link': best.get('link', ''),
        }
    return None


def musicbrainz(artist: str, album: str) -> dict | None:
    various = artist_key(artist) == 'various' or not artist
    # One search per album: the words rather than the phrase, so "Psychic... Powerless..." still
    # finds it, and the best-scored results first.
    queries = [f'release:({lucene(album)})' if various else f'release:({lucene(album)}) AND artist:({lucene(artist)})']
    for query in queries:
        body = paced_get('musicbrainz', musicbrainz_pace, f'{MB_RELEASE}?{urllib.parse.urlencode({"query": query, "fmt": "json", "limit": 25})}')
        if not body:
            continue
        found = []
        for release in body.get('releases', []):
            credit = ''.join(c.get('name', '') + c.get('joinphrase', '') for c in release.get('artist-credit', []))
            if release.get('score', 0) >= 60 and matches(artist, album, credit, release.get('title', '')):
                found.append((release, credit))
        if not found:
            continue
        # The earliest release with a date stands for the album; its group is what charts mean.
        release, credit = min(found, key=lambda rc: (key(rc[0]['title']) != key(album), rc[0].get('date') or '9999'))
        group = release.get('release-group', {})
        dates = [r.get('date') for r, _ in found if r.get('release-group', {}).get('id') == group.get('id') and r.get('date')]
        return {
            'id': group.get('id', ''),
            'release': release['id'],
            'artist': credit,
            'title': group.get('title') or release.get('title', ''),
            'tracks': release.get('track-count'),
            'type': (group.get('primary-type') or '').lower(),
            'date': min(dates) if dates else '',
            'link': f'https://musicbrainz.org/release-group/{group["id"]}' if group.get('id') else '',
        }
    return None


def caa_cover(group: str) -> str:
    status, _ = get(f'{CAA}{group}/front-250', head=True)
    return f'{CAA}{group}/front-500' if status in (200, 302, 307) else ''


def main() -> None:
    retry = '--retry' in sys.argv
    recheck = '--recheck-deezer' in sys.argv
    with open(ALBUMS, encoding='utf-8') as f:
        albums = [a for a in json.load(f) if not a['mucore'] and a['album']]
    try:
        with open(CACHE, encoding='utf-8') as f:
            cache = json.load(f)
    except FileNotFoundError:
        cache = {}

    misses: queue.Queue = queue.Queue()
    covers: queue.Queue = queue.Queue()
    done = {'deezer': 0, 'musicbrainz': 0, 'covers': 0}
    if recheck:
        # Ask Deezer again where it found nothing: an answer given while over its quota looks the same.
        for known in cache.values():
            if known.get('deezer', 0) is None:
                del known['deezer']
    todo_deezer = [a for a in albums if 'deezer' not in cache.get(cache_key(a), {})]
    for a in albums:
        known = cache.get(cache_key(a), {})
        if 'deezer' in known and known['deezer'] is None and ('musicbrainz' not in known or (retry and known['musicbrainz'] is None)):
            misses.put(a)
        elif (known.get('musicbrainz') or {}).get('id') and 'cover' not in known['musicbrainz']:
            covers.put(a)
    print(f'{len(albums)} albums to look up: {len(todo_deezer)} not asked on Deezer yet, {misses.qsize()} Deezer misses waiting for MusicBrainz', flush=True)

    def deezer_one(a: dict) -> None:
        result = deezer(a['artist'], a['album'])
        with lock:
            cache.setdefault(cache_key(a), {})['deezer'] = result
            done['deezer'] += 1
            asked = 'musicbrainz' in cache[cache_key(a)]
        if result is None and not asked:
            misses.put(a)

    def deezer_lane() -> None:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(DEEZER_LANES) as pool:
            list(pool.map(deezer_one, todo_deezer))
        misses.put(None)

    def musicbrainz_lane() -> None:
        while (a := misses.get()) is not None:
            result = musicbrainz(a['artist'], a['album'])
            with lock:
                cache.setdefault(cache_key(a), {})['musicbrainz'] = result
                done['musicbrainz'] += 1
            if result and result['id']:
                covers.put(a)
        misses.put(None)  # for the next lane
        covers.put(None)

    def cover_lane() -> None:
        while (a := covers.get()) is not None:
            with lock:
                found = cache[cache_key(a)]['musicbrainz']
            cover = caa_cover(found['id'])
            with lock:
                found['cover'] = cover
                done['covers'] += 1

    def save() -> None:
        with lock:
            text = json.dumps(cache, ensure_ascii=False, indent=0)
        with open(CACHE + '.tmp', 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(CACHE + '.tmp', CACHE)

    if '--trace' in sys.argv:
        import faulthandler

        faulthandler.dump_traceback_later(60)
    lanes = [threading.Thread(target=lane, daemon=True) for lane in (deezer_lane, *[musicbrainz_lane] * MUSICBRAINZ_LANES, *[cover_lane] * MUSICBRAINZ_LANES)]
    for lane in lanes:
        lane.start()
    start = time.time()
    while any(lane.is_alive() for lane in lanes):
        time.sleep(SAVE_EVERY)
        save()
        print(f'{int(time.time() - start)} s: Deezer {done["deezer"]}/{len(todo_deezer)} ({sent["deezer"]} sent, {refused["deezer"]} refused), MusicBrainz {done["musicbrainz"]} (queue {misses.qsize()}, {sent["musicbrainz"]} sent, {refused["musicbrainz"]} refused), covers {done["covers"]}', flush=True)
    save()
    found_d = sum(1 for a in albums if cache.get(cache_key(a), {}).get('deezer'))
    found_m = sum(1 for a in albums if not cache.get(cache_key(a), {}).get('deezer') and cache.get(cache_key(a), {}).get('musicbrainz'))
    print(f'Done: {found_d} found on Deezer, {found_m} more on MusicBrainz, {len(albums) - found_d - found_m} not found, of {len(albums)}')


if __name__ == '__main__':
    main()

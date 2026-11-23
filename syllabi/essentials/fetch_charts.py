"""Lists and downloads the genre charts of the 4chan /mu/ wiki's Essential Charts page.

The page (https://4chanmusic.miraheze.org/wiki/Essential_Charts) is a set of galleries of chart
images, with no text version. Its wikitext is kept beside this script as Essential_Charts.wikitext,
because the wiki's API often times out. Run with `--refresh` to fetch it again.

    python3 fetch_charts.py CACHE_DIR            # charts.json, and every image into CACHE_DIR
    python3 fetch_charts.py CACHE_DIR --refresh  # the same, with the wikitext fetched again first
    python3 fetch_charts.py CACHE_DIR --tiles ID [BANDS]
        # cut one chart into BANDS overlapping horizontal strips (4 by default) under
        # CACHE_DIR/tiles/ID/, for charts too dense to read whole

charts.json lists each chart in page order with its id, its caption, its file name and the URL of
the image. Only the Genres gallery is read. The images come from static.wikitide.net, which serves
them by MediaWiki's hashed path. They are not kept in git: transcriptions of them go in raw/.
"""

import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
WIKITEXT = os.path.join(HERE, 'Essential_Charts.wikitext')
CHARTS = os.path.join(HERE, 'charts.json')
API = 'https://4chanmusic.miraheze.org/w/api.php?action=parse&page=Essential_Charts&prop=wikitext&format=json'
STATIC = 'https://static.wikitide.net/4chanmusicwiki/'
AGENT = 'syllabus-chart-lookup/1.0'
SECTION = 'Genres'


def get(url: str, timeout: int = 60) -> bytes:
	request = urllib.request.Request(url, headers={'User-Agent': AGENT})
	with urllib.request.urlopen(request, timeout=timeout) as response:
		return response.read()


def refresh_wikitext() -> None:
	data = json.loads(get(API))
	with open(WIKITEXT, 'w', encoding='utf-8') as f:
		f.write(data['parse']['wikitext']['*'])


def slug(text: str) -> str:
	text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode().lower()
	text = text.replace('&', ' and ').replace("'", '')
	return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def image_url(file: str) -> str:
	"""MediaWiki's path for an upload: spaces as underscores, first letter upper case, md5 folders."""
	name = file.strip().replace(' ', '_')
	name = name[:1].upper() + name[1:]
	digest = hashlib.md5(name.encode('utf-8')).hexdigest()
	return f'{STATIC}{digest[0]}/{digest[:2]}/{urllib.parse.quote(name)}'


def list_charts() -> list[dict]:
	with open(WIKITEXT, encoding='utf-8') as f:
		wikitext = f.read()
	match = re.search(r'=== ' + SECTION + r' ===\s*<gallery[^>]*>(.*?)</gallery>', wikitext, re.S)
	if not match:
		sys.exit(f'No "{SECTION}" gallery in {WIKITEXT}')
	charts, seen = [], set()
	for line in match.group(1).strip().splitlines():
		file, _, caption = line.strip().partition('|')
		if not file:
			continue
		caption = caption.strip() or os.path.splitext(file)[0]
		chart_id = slug(caption)
		# Two charts with the same caption ("'10s Hip Hop" twice) get -2, -3.
		base, n = chart_id, 2
		while chart_id in seen:
			chart_id, n = f'{base}-{n}', n + 1
		seen.add(chart_id)
		charts.append({'id': chart_id, 'title': caption, 'file': file.strip(), 'url': image_url(file)})
	return charts


def fetch_one(chart: dict, path: str) -> str | None:
	"""Downloads one chart, retrying twice. The error, or None once it is on disk."""
	error = ''
	for attempt in range(3):
		try:
			data = get(chart['url'])
			with open(path, 'wb') as f:
				f.write(data)
			print(f'{chart["id"]} {len(data) // 1024} KB', flush=True)
			return None
		except Exception as e:  # noqa: BLE001 - any failure is retried, then reported
			error = str(e)
			# A 404 is a file the wiki no longer has; asking again won't bring it back.
			if getattr(e, 'code', None) == 404:
				break
			time.sleep(5 * (attempt + 1))
	print(f'{chart["id"]} failed: {error}', flush=True)
	return error


def download(charts: list[dict], cache: str, workers: int = 6) -> None:
	"""Several at once: the host is slow to start answering (up to ~20 s), not slow to send."""
	from concurrent.futures import ThreadPoolExecutor

	os.makedirs(os.path.join(cache, 'img'), exist_ok=True)
	todo = []
	for chart in charts:
		ext = os.path.splitext(chart['file'])[1].lower() or '.img'
		path = os.path.join(cache, 'img', chart['id'] + ext)
		if not (os.path.exists(path) and os.path.getsize(path) > 0):
			todo.append((chart, path))
	print(f'{len(charts) - len(todo)} already here, {len(todo)} to fetch', flush=True)
	with ThreadPoolExecutor(workers) as pool:
		errors = list(pool.map(lambda job: fetch_one(*job), todo))
	failed = {chart['id']: error for (chart, _), error in zip(todo, errors) if error}
	with open(os.path.join(cache, 'failed.json'), 'w', encoding='utf-8') as f:
		json.dump(failed, f, indent=1)
	if failed:
		print(f'{len(failed)} failed (listed in failed.json), run again to retry: {", ".join(failed)}')


def tiles(cache: str, chart_id: str, bands: int) -> None:
	from PIL import Image

	folder = os.path.join(cache, 'img')
	name = next((f for f in os.listdir(folder) if os.path.splitext(f)[0] == chart_id), None)
	if not name:
		sys.exit(f'No image for {chart_id} in {folder}')
	image = Image.open(os.path.join(folder, name)).convert('RGB')
	out = os.path.join(cache, 'tiles', chart_id)
	os.makedirs(out, exist_ok=True)
	height = image.height / bands
	overlap = int(height * 0.12)
	for i in range(bands):
		top = max(0, int(i * height) - overlap)
		bottom = min(image.height, int((i + 1) * height) + overlap)
		path = os.path.join(out, f'{i + 1}.png')
		image.crop((0, top, image.width, bottom)).save(path)
		print(path)


def main() -> None:
	args = sys.argv[1:]
	if not args:
		sys.exit(__doc__)
	cache = os.path.abspath(args[0])
	if '--tiles' in args:
		rest = args[args.index('--tiles') + 1 :]
		tiles(cache, rest[0], int(rest[1]) if len(rest) > 1 else 4)
		return
	if '--refresh' in args:
		refresh_wikitext()
	charts = list_charts()
	download(charts, cache)
	with open(CHARTS, 'w', encoding='utf-8') as f:
		json.dump([{k: c[k] for k in ('id', 'title', 'file', 'url')} for c in charts], f, indent=1, ensure_ascii=False)
		f.write('\n')
	print(f'{len(charts)} charts in {CHARTS}')


if __name__ == '__main__':
	main()

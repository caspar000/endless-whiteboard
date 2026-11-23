# /mu/ Essential Charts

The raw data for extending /mu/core (`../mucore.yaml`) with the genre charts of the 4chan /mu/
wiki's [Essential Charts](https://4chanmusic.miraheze.org/wiki/Essential_Charts) page. The charts
are images only, so each one is transcribed by hand into `raw/`.

- `Essential_Charts.wikitext` is a copy of the page's source, because the wiki's API often times out.
- `charts.json` lists the 320 charts of the Genres gallery, with each chart's id, caption, file and
  image URL. `fetch_charts.py` writes it and downloads the images into a cache folder outside git.
- `raw/<chart id>.tsv` holds one chart's albums, as the chart writes them.
- `dedupe.py` merges the rows of `raw/` into one entry per album in `albums.json`, and marks the
  albums /mu/core already has. `merges.tsv` lists the entries joined from different spellings, to
  check by eye. The rules are in the script's docstring.
- `lookup.py` finds each album not in /mu/core on Deezer, and on MusicBrainz when Deezer has
  nothing. Its answers are kept in `lookup.json`, so a run can stop and pick up again, and nobody
  has to ask the services again (the full run takes about two hours, mostly MusicBrainz's).
- `report.py` joins `albums.json` and `lookup.json` into `essentials.json`: one entry per album,
  with its track count, cover, link, YouTube search, the chart rows it came from and the /mu/core
  works it matches. Its docstring describes each field.

## raw/*.tsv

Tab-separated, with a header row:

| column | what it holds |
| --- | --- |
| `pos` | Place on the chart, counted left to right and top to bottom from 1. |
| `artist` | As the chart writes it, typos included. Phase 2 matches it to MusicBrainz. |
| `album` | As the chart writes it. |
| `year` | Only when the chart shows one. |
| `confidence` | `ok` when the chart prints the name, `unsure` when the print is hard to read, `cover` when the chart prints nothing and the album was recognised from its cover. |
| `note` | Anything worth knowing, such as "compilation" or "two albums in one square". |

A chart that can't be read at all gets a file with only the header and a line starting with `#`
that says why.

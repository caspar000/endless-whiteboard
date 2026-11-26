import { getNetworkBridge, type SourceEntry } from '@lifeboard/node-kit'
import { plain, workKey, type BacklogMedia } from './model'

/**
 * Finding an album or a film online, for a backlog of one media type. Every service here needs no key
 * and answers a browser itself (CORS), except Deezer, which is read through the server when there is
 * one. Each request is one a person typed: there is no background lookup.
 *
 * Music asks iTunes, MusicBrainz and Deezer at once, since none of them has everything (iTunes's search
 * misses Logic's Ultra 85, MusicBrainz is often busy), and keeps each album once. Films come from
 * Wikidata, which knows a film by its title in any language (შერეკილები, Ностальгия), with the poster
 * from the film's Wikipedia article.
 *
 * Everything that reads a response is pure and exported, so it is tested on recorded answers.
 */

/** One result. `id` is the service's own (`itunes:123`); `via` is the service, said under the tile. */
export interface Found extends SourceEntry {
	via: string
}

const LIMIT = 8

/** Answers already had, so the same query typed again asks no one: Wikimedia turns away callers who ask a lot. */
const answered = new Map<string, Found[]>()

/**
 * What the services find for `query`, best first. `onSome` hears the list so far each time one of
 * them answers, so what iTunes finds shows while MusicBrainz is still being asked.
 */
export async function searchMedia(media: BacklogMedia, query: string, onSome?: (found: Found[]) => void): Promise<Found[]> {
	const text = query.trim()
	if (!text) return []
	const key = `${media}\t${text}`
	const had = answered.get(key)
	if (had) return had
	const found = await (media === 'music' ? searchMusic(text, onSome) : searchFilm(text))
	// Nothing found may be a service turning us away; that is asked again next time.
	if (found.length) answered.set(key, found)
	return found
}

/* -------------------------------------------------------------------------------------- shared */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const qs = (params: Record<string, string | number>) =>
	Object.entries(params)
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('&')

/** A year written in a query ("Ностальгия 1983"), which a search may not match on. */
const YEAR = /(?:^|\s)((?:18|19|20)\d{2})(?=\s|$)/

/** Words that say what is wanted rather than name it: "Out There album", "by Tarkovsky". */
const FILLER = /(?:^|\s)(?:by|album|lp|ep|record|film|movie)(?=\s|$)/gi

/** A query with its "by", its "album" and its dashes taken out, and its year when `year` (never an album's: Prince's 1999). */
export function bareQuery(query: string, { year = false } = {}): string {
	const text = year ? query.replace(YEAR, ' ') : query
	return text
		.replace(FILLER, ' ')
		.replace(/\s[—–-]+\s/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/** How much of the query a result says: its words found in the artist, title and year. */
function relevance(query: string, found: Found): number {
	const words = plain(query.replace(FILLER, ' ')).split(' ').filter(Boolean)
	if (!words.length) return 0
	const said = new Set(plain(`${found.creator} ${found.title} ${found.year}`).split(' '))
	const hits = words.filter((w) => said.has(w)).length / words.length
	// At the same score an album goes before its singles.
	return hits - (/single/i.test(found.detail ?? '') ? 0.01 : 0)
}

/**
 * Results from several services as one list, each thing once (by `workKey`), the first copy kept and
 * given what a later one knows that it doesn't: a year, a cover.
 */
export function mergeFound(lists: readonly (readonly Found[])[]): Found[] {
	const out: Found[] = []
	const at = new Map<string, number>()
	for (const found of lists.flat()) {
		const key = workKey(found)
		const i = at.get(key)
		if (i === undefined) {
			at.set(key, out.length)
			out.push(found)
			continue
		}
		const had = out[i]!
		out[i] = {
			...had,
			year: had.year || found.year,
			cover: had.cover || found.cover,
			url: had.url || found.url,
		}
	}
	return out
}

/* --------------------------------------------------------------------------------------- music */

/** "OUT THERE (feat. Sonicwonder)" → "OUT THERE"; " - Single" and " - EP" come off as what it is. */
export function cleanAlbumTitle(raw: string): { title: string; type: string } {
	let title = raw.replace(/\s*[([]\s*(?:feat\.?|featuring|with)\s[^)\]]*[)\]]/gi, '')
	let type = ''
	const suffix = /\s+-\s+(Single|EP)$/i.exec(title)
	if (suffix) {
		type = suffix[1]!.toUpperCase() === 'EP' ? 'EP' : 'Single'
		title = title.slice(0, suffix.index)
	}
	return { title: title.trim() || raw.trim(), type }
}

/** "Hiromi feat. Sonicwonder" → "Hiromi": the album is Hiromi's, as iTunes has it. */
const withoutFeatured = (artist: string) => artist.replace(/\s+(?:feat\.?|featuring|ft\.)\s.*$/i, '').trim()

const tracks = (n: number) => (n > 0 ? `${n} ${n === 1 ? 'track' : 'tracks'}` : '')
const detailOf = (...parts: string[]) => parts.filter(Boolean).join(' · ')

export function parseItunes(body: unknown): Found[] {
	return arr(obj(body).results).flatMap((r): Found[] => {
		const raw = obj(r)
		const id = num(raw.collectionId)
		const name = str(raw.collectionName)
		if (!id || !name || raw.wrapperType !== 'collection') return []
		const { title, type } = cleanAlbumTitle(name)
		return [
			{
				id: `itunes:${id}`,
				title,
				creator: withoutFeatured(str(raw.artistName)),
				year: str(raw.releaseDate).slice(0, 4),
				// The search gives 100px; the same picture comes at any size.
				cover: str(raw.artworkUrl100).replace(/\/\d+x\d+bb\./, '/600x600bb.'),
				url: str(raw.collectionViewUrl).replace(/\?uo=\d+$/, ''),
				detail: detailOf(type, tracks(num(raw.trackCount))),
				via: 'iTunes',
			},
		]
	})
}

/** Lucene's own characters, which a title may well have ("Voice in the Wilderness: Part 1"). */
const escapeLucene = (text: string) => text.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1')

export function parseMusicBrainz(body: unknown): Found[] {
	return arr(obj(body)['release-groups']).flatMap((r): Found[] => {
		const raw = obj(r)
		const id = str(raw.id)
		const title = str(raw.title)
		// Its search answers something for anything; under this it is rarely what was meant.
		if (!id || !title || num(raw.score) < 60) return []
		const creator = withoutFeatured(
			arr(raw['artist-credit'])
				.map((c) => `${str(obj(c).name)}${typeof obj(c).joinphrase === 'string' ? obj(c).joinphrase : ''}`)
				.join(''),
		)
		const type = [str(raw['primary-type']), ...arr(raw['secondary-types']).map(str)].filter((t) => t && t !== 'Album').join(', ')
		return [
			{
				id: `musicbrainz:${id}`,
				title,
				creator,
				year: str(raw['first-release-date']).slice(0, 4),
				cover: `https://coverartarchive.org/release-group/${id}/front-500`,
				url: `https://musicbrainz.org/release-group/${id}`,
				detail: type,
				via: 'MusicBrainz',
			},
		]
	})
}

export function parseDeezer(body: unknown): Found[] {
	return arr(obj(body).data).flatMap((r): Found[] => {
		const raw = obj(r)
		const id = num(raw.id)
		const name = str(raw.title)
		if (!id || !name) return []
		const kind = str(raw.record_type)
		const { title } = cleanAlbumTitle(name)
		return [
			{
				id: `deezer:${id}`,
				title,
				creator: str(obj(raw.artist).name),
				year: '',
				cover: str(raw.cover_xl) || str(raw.cover_big),
				url: str(raw.link),
				detail: detailOf(kind === 'single' ? 'Single' : kind === 'ep' ? 'EP' : '', tracks(num(raw.nb_tracks))),
				via: 'Deezer',
			},
		]
	})
}

/** MusicBrainz turns away about half of all callers when it is busy, which is often; it asks for a second between tries. */
async function askMusicBrainz(url: string, tries = 4): Promise<unknown> {
	const network = getNetworkBridge()
	for (let i = 0; network && i < tries; i++) {
		if (i) await new Promise((resolve) => setTimeout(resolve, 1100))
		const body = await network.getJson(url)
		if (body) return body
	}
	return null
}

async function searchMusic(query: string, onSome?: (found: Found[]) => void): Promise<Found[]> {
	const network = getNetworkBridge()
	if (!network) return []
	const q = bareQuery(query) || query
	const itunes = network.getJson(`https://itunes.apple.com/search?${qs({ term: q, media: 'music', entity: 'album', limit: LIMIT })}`).then(parseItunes)
	const musicBrainz = askMusicBrainz(`https://musicbrainz.org/ws/2/release-group/?${qs({ query: escapeLucene(q), fmt: 'json', limit: LIMIT })}`).then(parseMusicBrainz)
	// Deezer sends no CORS headers, so only the server can read it; without one this is empty.
	const deezer = network.getText(`https://api.deezer.com/search/album?${qs({ q, limit: LIMIT })}`).then((r) => {
		if (!r.ok) return []
		try {
			return parseDeezer(JSON.parse(r.text))
		} catch {
			return []
		}
	})
	// Each list in its place, so the order never depends on which service answered first.
	const lists: Found[][] = [[], [], []]
	const ranked = () =>
		mergeFound(lists)
			.map((found, i) => ({ found, i, score: relevance(query, found) }))
			.sort((a, b) => b.score - a.score || a.i - b.i)
			.slice(0, LIMIT)
			.map((r) => r.found)
	await Promise.all(
		[itunes, musicBrainz, deezer].map((answer, i) =>
			answer.then((found) => {
				lists[i] = found
				if (found.length) onSome?.(ranked())
			}),
		),
	)
	return ranked()
}

/* ---------------------------------------------------------------------------------------- film */

const WIKIDATA = 'https://www.wikidata.org/w/api.php'
/** Film, animated film, documentary, short film, television film. */
const FILM_TYPES = ['Q11424', 'Q202866', 'Q93204', 'Q24862', 'Q506240']

/** The Wikidata items a search finds, best first. */
export function parseWikidataSearch(body: unknown): string[] {
	return arr(obj(obj(body).query).search).flatMap((r) => {
		const title = str(obj(r).title)
		return /^Q\d+$/.test(title) ? [title] : []
	})
}

/** What a film's Wikidata item says, before its director's name and its poster are known. */
export interface FilmFacts {
	id: string
	title: string
	/** The title in the film's own language, when it is not `title`: "შერეკილები". */
	original: string
	year: string
	/** Its director's names, from its English description ("1983 film by Andrei Tarkovsky"), when it says. */
	directedBy: string
	/** Its directors' items, for when the description doesn't say. */
	directors: string[]
	imdb: string
	/** The film's Wikipedia articles, `enwiki` first: where its poster is. */
	articles: { wiki: string; title: string }[]
	/** A poster on Commons, which few films have. */
	commonsPoster: string
}

const label = (labels: unknown, lang: string) => str(obj(obj(labels)[lang]).value)
const claimValues = (claims: unknown, property: string) =>
	arr(obj(claims)[property])
		.map((c) => obj(obj(c).mainsnak).datavalue)
		.map((d) => obj(d).value)

export function parseWikidataEntities(body: unknown, ids: readonly string[]): FilmFacts[] {
	const entities = obj(obj(body).entities)
	return ids.flatMap((id): FilmFacts[] => {
		const e = obj(entities[id])
		const claims = e.claims
		const original =
			claimValues(claims, 'P1476')
				.map((v) => str(obj(v).text))
				.find(Boolean) ?? ''
		const anyLabel =
			Object.values(obj(e.labels))
				.map((l) => str(obj(l).value))
				.find(Boolean) ?? ''
		const title = label(e.labels, 'en') || label(e.labels, 'mul') || original || anyLabel
		if (!title) return []
		const years = claimValues(claims, 'P577')
			.map((v) => /^[+-]?(\d{4})/.exec(str(obj(v).time))?.[1] ?? '')
			.filter(Boolean)
			.sort()
		const links = obj(e.sitelinks)
		const articles = Object.values(links)
			.map((l) => ({ wiki: str(obj(l).site), title: str(obj(l).title) }))
			.filter((a) => /^[a-z_-]+wiki$/.test(a.wiki) && !/^(commons|species|meta|wikidata)wiki$/.test(a.wiki) && a.title)
			.sort((a, b) => Number(b.wiki === 'enwiki') - Number(a.wiki === 'enwiki'))
		return [
			{
				id,
				title,
				original: original && plain(original) !== plain(title) ? original : '',
				year: years[0] ?? '',
				directedBy: /\bby\s+(.+)$/i.exec(label(e.descriptions, 'en'))?.[1]?.trim() ?? '',
				directors: claimValues(claims, 'P57')
					.map((v) => str(obj(v).id))
					.filter(Boolean),
				imdb:
					claimValues(claims, 'P345')
						.map(str)
						.find((v) => /^tt\d+$/.test(v)) ?? '',
				articles,
				commonsPoster: claimValues(claims, 'P3383').map(str).find(Boolean) ?? '',
			},
		]
	})
}

/** Names by Wikidata item, from a `wbgetentities` of labels. */
export function parseLabels(body: unknown): Map<string, string> {
	const out = new Map<string, string>()
	for (const [id, e] of Object.entries(obj(obj(body).entities))) {
		const name = label(obj(e).labels, 'en') || label(obj(e).labels, 'mul')
		if (name) out.set(id, name)
	}
	return out
}

/** Article title → its lead image, from a Wikipedia `pageimages` query. Titles it normalized are mapped back. */
export function parsePageImages(body: unknown): Map<string, string> {
	const q = obj(obj(body).query)
	const out = new Map<string, string>()
	for (const p of arr(q.pages)) {
		const source = str(obj(obj(p).thumbnail).source)
		if (source) out.set(str(obj(p).title), source.replace(/\?utm_.*$/, ''))
	}
	for (const n of arr(q.normalized)) {
		const to = out.get(str(obj(n).to))
		if (to) out.set(str(obj(n).from), to)
	}
	return out
}

const wikiHost = (wiki: string) => `https://${wiki.replace(/wiki$/, '').replace(/_/g, '-')}.wikipedia.org`

async function pageImages(wiki: string, titles: readonly string[]): Promise<Map<string, string>> {
	const network = getNetworkBridge()
	if (!network || !titles.length) return new Map()
	// `any`: a film's poster is almost always under fair use, which the default leaves out.
	const params = {
		action: 'query',
		prop: 'pageimages',
		piprop: 'thumbnail',
		pithumbsize: 500,
		pilicense: 'any',
		titles: titles.join('|'),
		format: 'json',
		formatversion: 2,
		origin: '*',
	}
	return parsePageImages(await network.getJson(`${wikiHost(wiki)}/w/api.php?${qs(params)}`))
}

/** Each film's poster: its English article's, then one on Commons, then its first other article's. */
async function posters(films: readonly FilmFacts[]): Promise<Map<string, string>> {
	const out = new Map<string, string>()
	const english = films.flatMap((f) => (f.articles[0]?.wiki === 'enwiki' ? [f.articles[0].title] : []))
	const enImages = await pageImages('enwiki', english)
	const rest: FilmFacts[] = []
	for (const f of films) {
		const en = f.articles[0]?.wiki === 'enwiki' ? enImages.get(f.articles[0].title) : undefined
		if (en) out.set(f.id, en)
		else if (f.commonsPoster) out.set(f.id, `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f.commonsPoster)}?width=500`)
		else rest.push(f)
	}
	await Promise.all(
		rest.map(async (f) => {
			const other = f.articles.find((a) => a.wiki !== 'enwiki')
			if (!other) return
			const image = (await pageImages(other.wiki, [other.title])).get(other.title)
			if (image) out.set(f.id, image)
		}),
	)
	return out
}

async function findFilmIds(query: string): Promise<string[]> {
	const network = getNetworkBridge()
	if (!network) return []
	const search = async (text: string) => {
		const filter = `haswbstatement:${FILM_TYPES.map((t) => `P31=${t}`).join('|')}`
		const params = {
			action: 'query',
			list: 'search',
			srsearch: `${text} ${filter}`,
			srlimit: LIMIT,
			format: 'json',
			formatversion: 2,
			origin: '*',
		}
		return parseWikidataSearch(await network.getJson(`${WIKIDATA}?${qs(params)}`))
	}
	const found = await search(query)
	if (found.length) return found
	// A year or a "by" the items don't say keeps the search from matching at all: without them.
	const bare = bareQuery(query, { year: true })
	return bare && bare !== query ? search(bare) : []
}

/** Films with a year near the query's first, when it gives one: Wikidata may say 1973 for a 1974 film. */
export function byYear(films: readonly Found[], query: string): Found[] {
	const year = Number(YEAR.exec(query)?.[1] ?? 0)
	if (!year) return [...films]
	const near = (f: Found) => Math.abs(Number(f.year) - year) <= 1
	return [...films.filter(near), ...films.filter((f) => !near(f))]
}

async function searchFilm(query: string): Promise<Found[]> {
	const network = getNetworkBridge()
	const ids = await findFilmIds(query)
	if (!network || !ids.length) return []
	const entityParams = {
		action: 'wbgetentities',
		ids: ids.join('|'),
		props: 'labels|descriptions|claims|sitelinks',
		languages: 'en|mul',
		format: 'json',
		origin: '*',
	}
	const films = parseWikidataEntities(await network.getJson(`${WIKIDATA}?${qs(entityParams)}`), ids)
	// Most descriptions name the director, which saves asking for the names.
	const directorIds = [...new Set(films.flatMap((f) => (f.directedBy ? [] : f.directors)))].slice(0, 50)
	const [names, images] = await Promise.all([
		directorIds.length
			? network.getJson(`${WIKIDATA}?${qs({ action: 'wbgetentities', ids: directorIds.join('|'), props: 'labels', languages: 'en|mul', format: 'json', origin: '*' })}`).then(parseLabels)
			: Promise.resolve(new Map<string, string>()),
		posters(films),
	])
	const results = films.map((f): Found => ({
		id: `wikidata:${f.id}`,
		title: f.title,
		creator:
			f.directedBy ||
			f.directors
				.map((d) => names.get(d) ?? '')
				.filter(Boolean)
				.join(', '),
		year: f.year,
		cover: images.get(f.id) ?? '',
		url: f.imdb
			? `https://www.imdb.com/title/${f.imdb}/`
			: f.articles[0]
				? `${wikiHost(f.articles[0].wiki)}/wiki/${encodeURIComponent(f.articles[0].title.replace(/ /g, '_'))}`
				: `https://www.wikidata.org/wiki/${f.id}`,
		detail: f.original,
		via: 'Wikidata',
	}))
	return byYear(results, query)
}

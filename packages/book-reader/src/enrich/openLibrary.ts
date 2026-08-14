import { getNetworkBridge } from '@lifeboard/node-kit'

/**
 * Open Library lookup — the one place this extension talks to the outside world.
 *
 * Chosen over Google Books because it needs no API key and no attribution dance, and because it is
 * a library catalogue rather than a storefront: the answers are editions and works, which is what a
 * book *is*. It is run by a non-profit that asks callers to be considerate, so every request here is
 * one a person explicitly asked for — there is no background enrichment, and never will be.
 *
 * The whole module is defensive about the response for the same reason `fetchExchangeRates` is:
 * this is third-party JSON, and a field being absent or the wrong shape is a normal Tuesday.
 */
const SEARCH_URL = 'https://openlibrary.org/search.json'
const COVER_URL = 'https://covers.openlibrary.org/b/id'
const WORK_URL = 'https://openlibrary.org'

/** One candidate the user can choose from. Everything except `title` may be missing. */
export interface BookMatch {
	/** Open Library's work key, `/works/OL123W`. Identity, and the link we record. */
	key: string
	title: string
	author: string
	year: number | null
	pages: number | null
	isbn: string | null
	/** Small cover for the picker, and the large one to keep. Null when the record has no cover. */
	thumbnailUrl: string | null
	coverUrl: string | null
}

/** How many candidates to offer. Enough to recognise the right edition, few enough to scan. */
const LIMIT = 6

/**
 * Searches by free text — a title, "title author", or an ISBN, which Open Library's `q` handles
 * directly. Returns `[]` for no matches *and* for no network: both mean "nothing to choose from",
 * and a local-first app must not treat being offline as an error.
 */
export async function searchOpenLibrary(query: string): Promise<BookMatch[]> {
	const trimmed = query.trim()
	if (!trimmed) return []
	const network = getNetworkBridge()
	if (!network) return []

	const url =
		`${SEARCH_URL}?q=${encodeURIComponent(trimmed)}&limit=${LIMIT}` +
		// Asking for just these keeps the response small; the default document is enormous.
		`&fields=key,title,author_name,first_publish_year,number_of_pages_median,isbn,cover_i`
	const body = await network.getJson(url)
	return parseSearchResponse(body)
}

/** The pure half of {@link searchOpenLibrary}, so the parsing rules are testable without a network. */
export function parseSearchResponse(body: unknown): BookMatch[] {
	if (!body || typeof body !== 'object') return []
	const docs = (body as { docs?: unknown }).docs
	if (!Array.isArray(docs)) return []

	const matches: BookMatch[] = []
	for (const doc of docs) {
		if (!doc || typeof doc !== 'object') continue
		const raw = doc as Record<string, unknown>
		const key = typeof raw.key === 'string' ? raw.key : ''
		const title = typeof raw.title === 'string' ? raw.title.trim() : ''
		// A record with no title is unusable in a picker — there would be nothing to click.
		if (!key || !title) continue

		const coverId =
			typeof raw.cover_i === 'number' && Number.isFinite(raw.cover_i) ? raw.cover_i : null
		matches.push({
			key,
			title,
			author: firstString(raw.author_name),
			year: positiveInt(raw.first_publish_year),
			pages: positiveInt(raw.number_of_pages_median),
			isbn: firstString(raw.isbn) || null,
			thumbnailUrl: coverId === null ? null : `${COVER_URL}/${coverId}-M.jpg`,
			coverUrl: coverId === null ? null : `${COVER_URL}/${coverId}-L.jpg`,
		})
	}
	return matches
}

/** The page a human would read about this book on — recorded as the match's link property. */
export function workUrl(match: BookMatch): string {
	return `${WORK_URL}${match.key}`
}

/** Downloads a match's cover, or null if it has none (or the network is unavailable). */
export async function fetchCover(match: BookMatch): Promise<Blob | null> {
	if (!match.coverUrl) return null
	const network = getNetworkBridge()
	if (!network) return null
	const blob = await network.getBlob(match.coverUrl)
	// Open Library answers a missing cover with a tiny 1×1 GIF rather than a 404, so a suspiciously
	// small body means "no cover" — storing it would replace a real page render with a blank pixel.
	if (!blob || blob.size < 1024) return null
	return blob
}

function firstString(value: unknown): string {
	if (typeof value === 'string') return value.trim()
	if (Array.isArray(value)) {
		for (const entry of value) {
			if (typeof entry === 'string' && entry.trim()) return entry.trim()
		}
	}
	return ''
}

function positiveInt(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

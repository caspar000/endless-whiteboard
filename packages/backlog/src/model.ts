import type { SourceEntry } from '@lifeboard/node-kit'

/**
 * A backlog (DARK-11): media you mean to get to, gathered from anywhere. Every rule about it that is
 * not drawing lives here, pure, so it is tested without a DOM.
 *
 * It holds two kinds of thing. An **item** is one album, film or book: typed into it, or a cover
 * dragged onto it from another card. A **collection** is a whole source, kept whole: a syllabus track
 * dropped on it stays one tile, and lists the track's works as they are now, so a work added to the
 * track is in the backlog too.
 *
 * Offered to other cards as a source (`source.ts`), a backlog is everything it holds, collections
 * opened out, each thing once. "Once" is by id and by `workKey`: the same album typed in, dragged in
 * and held by a collection, or held by two collections (/mu/core and its Black Metal node), is one.
 */

export interface BacklogItem {
	kind: 'item'
	/** Unique in the backlog: `<source key>|<entry id>` for one dragged from a source, random for a typed one. */
	id: string
	title: string
	creator: string
	year: string
	cover: string
	url: string
	/** The source's line beside the year ("11 tracks"), when it had one. */
	detail?: string
	/** Where it came from, said under it: "Feeds", "Syllabi". '' for a typed one. */
	via: string
}

export interface BacklogCollection {
	kind: 'collection'
	/** The source key it holds, which is also its id here: its items' ids start with it. */
	id: string
	/**
	 * The source key it reads, when that is no longer its id (DARK-14): a stamped list from before
	 * boards, moved onto its board's own list, keeps its id so its items keep theirs.
	 */
	key?: string
	via: string
}

/** The source key a collection reads. */
export const collectionKey = (c: Pick<BacklogCollection, 'id' | 'key'>): string => c.key || c.id

export type BacklogEntry = BacklogItem | BacklogCollection

export interface Backlog {
	backlogId: string
	/**
	 * The board it belongs to (DARK-14): only cards there are offered it. '' for one made before
	 * backlogs had boards, until the board showing it opens (`claimBacklog`).
	 */
	boardId: string
	name: string
	/** Newest first. */
	entries: BacklogEntry[]
}

export const DEFAULT_NAME = 'Backlog'

export function randomId(): string {
	const out = new Uint32Array(2)
	crypto.getRandomValues(out)
	return Array.from(out, (n) => n.toString(36)).join('')
}

export function newBacklog(backlogId: string, boardId = ''): Backlog {
	return { backlogId, boardId, name: DEFAULT_NAME, entries: [] }
}

/** An item's id: the same item dragged in twice, or also in a collection, is one item. */
export function itemKey(from: string, entryId: string): string {
	return `${from}|${entryId}`
}

/**
 * One typed line, `Title — Creator — Year`, the way a randomizer's list reads them: an em dash, an en
 * dash, a spaced hyphen, a tab or a `|` separate. `null` for a line with no title.
 */
export function parseTyped(line: string): Pick<BacklogItem, 'title' | 'creator' | 'year'> | null {
	const text = line.trim()
	if (!text) return null
	const parts = text.split(/\s+[—–-]\s+|\s*[—–|\t]\s*/).map((p) => p.trim())
	const [title = '', second = '', third = ''] = parts
	if (!title) return null
	if (parts.length === 2 && /^\d{4}$/.test(second)) return { title, creator: '', year: second }
	return { title, creator: second, year: third }
}

/** Letters that keep their mark through NFKD: Ágætis, Lustmørd, Hliðskjálf. */
const LETTERS: Readonly<Record<string, string>> = { æ: 'ae', ø: 'o', œ: 'oe', ð: 'd', þ: 'th', ß: 'ss', ł: 'l', đ: 'd', ı: 'i' }

/** Text as a backlog compares it: case, accents, punctuation, a leading "the" and what is in brackets set aside. */
function plain(text: string): string {
	const folded = text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[æøœðþßłđı]/g, (c) => LETTERS[c] ?? c)
	const bare = folded.replace(/\s*[([][^)\]]*[)\]]/g, ' ')
	return (bare.trim() ? bare : folded).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/^the /, '')
}

/**
 * What makes two things the same thing here, whichever way they came in: "Filosofem (Remastered)" by
 * "Burzum" and "filosofem" by "BURZUM" are one album, "The Smiths" and "Smiths" one artist.
 */
export function workKey(thing: Pick<SourceEntry, 'title' | 'creator'>): string {
	return `${plain(thing.creator)}\t${plain(thing.title)}`
}

const sameWork = (a: Pick<BacklogItem, 'title' | 'creator'>, b: Pick<BacklogItem, 'title' | 'creator'>) => workKey(a) === workKey(b)

/** A typed item on top; one already here moves to the top instead. `null` when the line has no title. */
export function addTyped(backlog: Backlog, line: string, newId: () => string = randomId): Backlog | null {
	const parsed = parseTyped(line)
	if (!parsed) return null
	const had = backlog.entries.find((e): e is BacklogItem => e.kind === 'item' && sameWork(e, parsed))
	const item: BacklogItem = had ?? { kind: 'item', id: `typed|${newId()}`, ...parsed, cover: '', url: '', via: '' }
	return { ...backlog, entries: [item, ...backlog.entries.filter((e) => e !== had)] }
}

/**
 * The entry already holding this thing, by `workKey`: an item, or a collection whose source has it.
 * `null` when it is new here. What a card says when something is added twice.
 */
export function whereIs(
	backlog: Backlog,
	entriesOf: (sourceKey: string) => readonly SourceEntry[],
	thing: Pick<SourceEntry, 'title' | 'creator'>
): BacklogEntry | null {
	const key = workKey(thing)
	return (
		backlog.entries.find((e) =>
			e.kind === 'item' ? workKey(e) === key : entriesOf(collectionKey(e)).some((x) => workKey(x) === key)
		) ?? null
	)
}

/**
 * An item from another card on top. One already here moves to the top rather than being there twice,
 * whichever card it came by: an album dragged from a ranking, then from a randomizer drawing from that
 * ranking, is one album.
 */
export function addItem(backlog: Backlog, entry: SourceEntry, from: string, via: string): Backlog {
	const id = from ? itemKey(from, entry.id) : entry.id
	const item: BacklogItem = { kind: 'item', id, title: entry.title, creator: entry.creator, year: entry.year, cover: entry.cover, url: entry.url, ...(entry.detail ? { detail: entry.detail } : {}), via }
	return { ...backlog, entries: [item, ...backlog.entries.filter((e) => e.id !== id && !(e.kind === 'item' && sameWork(e, item)))] }
}

/** A whole source on top, kept as one; one already here moves to the top. */
export function addCollection(backlog: Backlog, sourceKey: string, via: string): Backlog {
	const collection: BacklogCollection = { kind: 'collection', id: sourceKey, via }
	return { ...backlog, entries: [collection, ...backlog.entries.filter((e) => e.id !== sourceKey && !(e.kind === 'collection' && collectionKey(e) === sourceKey))] }
}

export function removeEntry(backlog: Backlog, id: string): Backlog {
	return { ...backlog, entries: backlog.entries.filter((e) => e.id !== id) }
}

export function renameBacklog(backlog: Backlog, name: string): Backlog {
	const trimmed = name.trim()
	return trimmed ? { ...backlog, name: trimmed } : backlog
}

/**
 * Everything the backlog holds, as one list for other cards: items as they are, collections opened
 * out into what their source holds now, each thing once, in the backlog's order. A ranking's weights
 * stay behind: in a backlog everything counts the same.
 */
export function backlogEntries(backlog: Backlog, entriesOf: (sourceKey: string) => readonly SourceEntry[]): SourceEntry[] {
	const out: SourceEntry[] = []
	const seen = new Set<string>()
	const works = new Set<string>()
	const push = (entry: SourceEntry) => {
		const work = workKey(entry)
		if (seen.has(entry.id) || works.has(work)) return
		seen.add(entry.id)
		works.add(work)
		out.push(entry)
	}
	for (const e of backlog.entries) {
		if (e.kind === 'item') push({ id: e.id, title: e.title, creator: e.creator, year: e.year, cover: e.cover, url: e.url, ...(e.detail ? { detail: e.detail } : {}) })
		else
			for (const { id, title, creator, year, cover, url, detail } of entriesOf(collectionKey(e)))
				push({ id: itemKey(e.id, id), title, creator, year, cover, url, ...(detail ? { detail } : {}) })
	}
	return out
}

/* ------------------------------------------------------------------------------------ storing */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A stored backlog, checked: what can't be read is dropped rather than trusted. */
export function readBacklog(raw: Record<string, unknown>): Backlog | null {
	const backlogId = str(raw.backlogId)
	if (!backlogId) return null
	const entries: BacklogEntry[] = []
	for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
		if (!isObject(e) || !str(e.id)) continue
		if (e.kind === 'collection') entries.push({ kind: 'collection', id: str(e.id), ...(str(e.key) ? { key: str(e.key) } : {}), via: str(e.via) })
		else if (e.kind === 'item' && str(e.title))
			entries.push({ kind: 'item', id: str(e.id), title: str(e.title), creator: str(e.creator), year: str(e.year), cover: str(e.cover), url: str(e.url), ...(str(e.detail) ? { detail: str(e.detail) } : {}), via: str(e.via) })
	}
	return { backlogId, boardId: str(raw.boardId), name: str(raw.name) || DEFAULT_NAME, entries }
}

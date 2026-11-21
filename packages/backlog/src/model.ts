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
 * opened out, each thing once.
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
	/** Where it came from, said under it: "Feeds", "Syllabi". '' for a typed one. */
	via: string
}

export interface BacklogCollection {
	kind: 'collection'
	/** The source key it holds, which is also its id here. */
	id: string
	via: string
}

export type BacklogEntry = BacklogItem | BacklogCollection

export interface Backlog {
	backlogId: string
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

export function newBacklog(backlogId: string): Backlog {
	return { backlogId, name: DEFAULT_NAME, entries: [] }
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

/** A typed item on top. `null` when the line has no title. */
export function addTyped(backlog: Backlog, line: string, newId: () => string = randomId): Backlog | null {
	const parsed = parseTyped(line)
	if (!parsed) return null
	const item: BacklogItem = { kind: 'item', id: `typed|${newId()}`, ...parsed, cover: '', url: '', via: '' }
	return { ...backlog, entries: [item, ...backlog.entries] }
}

/** An item from another card on top; one already here moves to the top rather than twice. */
export function addItem(backlog: Backlog, entry: SourceEntry, from: string, via: string): Backlog {
	const id = from ? itemKey(from, entry.id) : entry.id
	const item: BacklogItem = { kind: 'item', id, title: entry.title, creator: entry.creator, year: entry.year, cover: entry.cover, url: entry.url, via }
	return { ...backlog, entries: [item, ...backlog.entries.filter((e) => e.id !== id)] }
}

/** A whole source on top, kept as one; one already here moves to the top. */
export function addCollection(backlog: Backlog, sourceKey: string, via: string): Backlog {
	const collection: BacklogCollection = { kind: 'collection', id: sourceKey, via }
	return { ...backlog, entries: [collection, ...backlog.entries.filter((e) => e.id !== sourceKey)] }
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
	const push = (entry: SourceEntry) => {
		if (seen.has(entry.id)) return
		seen.add(entry.id)
		out.push(entry)
	}
	for (const e of backlog.entries) {
		if (e.kind === 'item') push({ id: e.id, title: e.title, creator: e.creator, year: e.year, cover: e.cover, url: e.url })
		else for (const { id, title, creator, year, cover, url } of entriesOf(e.id)) push({ id: itemKey(e.id, id), title, creator, year, cover, url })
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
		if (e.kind === 'collection') entries.push({ kind: 'collection', id: str(e.id), via: str(e.via) })
		else if (e.kind === 'item' && str(e.title))
			entries.push({ kind: 'item', id: str(e.id), title: str(e.title), creator: str(e.creator), year: str(e.year), cover: str(e.cover), url: str(e.url), via: str(e.via) })
	}
	return { backlogId, name: str(raw.name) || DEFAULT_NAME, entries }
}

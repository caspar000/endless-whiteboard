import { atom, react, type TLShape } from '@lifeboard/canvas'
import type { LucideIcon } from 'lucide-react'
import { isExtensionEnabled } from './registry'

/**
 * Lists of things other cards can pick from, rank or collect (DARK-7, moved here in DARK-11): a feed's
 * videos, a syllabus track's works, everything stamped Liked, a backlog, a ranking.
 *
 * The registry lives in the kit rather than in any one extension because no extension may count on
 * another being there. Feeds offers its posts here without knowing whether a randomizer, a ranking or a
 * backlog will read them; a randomizer reads whatever is here without knowing who put it there. Turn
 * any of them off and the others carry on with what is left.
 *
 * Reads go through atoms, so a card reading a source inside `useValue` also follows the source's own
 * atoms: a feed that reads new videos changes the card under it.
 *
 * A **source key** names one choice of one source, as a card stores it: `<source id>:<choice id>`,
 * such as `feeds:all`. `''` is no source yet.
 */

/** How a source's items are spoken of and drawn. */
export interface SourceKind {
	/** Plural, for the count: "12 videos". */
	noun: string
	/** Singular, for "Stamp this video". */
	one: string
	/** What the second line is: "Channel", "Artist". */
	creator: string
	/** Shown beside the year: "1978 · LP". Often ''. */
	tag: string
	/** The shape of a cover: square, or taller than wide and set on a mat (a poster, a book). */
	shape: 'square' | 'poster' | 'book'
}

/** A source that says nothing about what its items are. */
export const PLAIN_KIND: SourceKind = { noun: 'items', one: 'item', creator: 'Creator', tag: '', shape: 'square' }

/** One thing a source offers: a video, a post, an album, anything with a title. */
export interface SourceEntry {
	/** Unique within the choice, and lasting: stamps, ranks and picks find it again by it. */
	id: string
	title: string
	creator: string
	year: string
	/** A picture of it: an `https:` URL, a path the app serves, `asset:<sha256>`, or ''. */
	cover: string
	/** Where it opens, or ''. */
	url: string
	/**
	 * How much more often a draw should land on it than on an entry of weight 1. Only a ranking with
	 * weighted shuffle on gives weights; a source that gives none is drawn evenly.
	 */
	weight?: number
}

/** One thing a source can be pointed at: all feeds, a category, a channel. */
export interface SourceChoice {
	/** Unique within the source, and lasting: cards store it. */
	id: string
	label: string
	/** The heading it is listed under in a picker: "Categories", "Channels". */
	group: string
}

export interface ItemSource {
	/** The first half of every source key it makes: `feeds`. Must not contain a `:`. */
	id: string
	/** Its name in a picker: "Feeds". */
	label: string
	icon?: LucideIcon
	/** The extension that offers it. While that is off it isn't offered, though a card already on it keeps working, as its nodes do. */
	extensionId?: string
	/** What it can be pointed at now. */
	choices(): readonly SourceChoice[]
	/** What a choice holds now, in its own order. Empty for a choice that is gone. */
	entries(choiceId: string): readonly SourceEntry[]
	/** How a choice's items are spoken of: "videos" for YouTube channels. */
	kind(choiceId: string): SourceKind
	/**
	 * Called while a card shows this source, so it can keep itself fresh (a feed reads its channels
	 * every quarter of an hour). Returns the card's release.
	 */
	watch?(choiceId: string): () => void
	/** Opens an entry, as the source's own card would (a video, marked watched). Without it, its `url` opens in a new tab. */
	open?(entry: { id: string; url: string }): void
	/**
	 * Cards on the board that stand for one of its choices, so dropping one on a card that collects
	 * sources (a backlog) adds that choice: a syllabus track's card is that track.
	 */
	fromShape?: {
		types: readonly string[]
		/** The choice a shape of one of those types is, or `null`. */
		choiceOf(shape: TLShape): string | null
	}
}

const sources = atom<readonly ItemSource[]>('lifeboard:item-sources', [])

/** Adds a source, or replaces the one with its id (a module loaded again in development). */
export function registerItemSource(source: ItemSource): void {
	if (!source.id || source.id.includes(':')) throw new Error(`registerItemSource: "${source.id}" can't be a source id`)
	sources.set([...sources.get().filter((s) => s.id !== source.id), source])
}

export function getItemSources(): readonly ItemSource[] {
	return sources.get()
}

/** The sources a picker should list: those whose extension is on. */
export function offeredItemSources(): ItemSource[] {
	return sources.get().filter((s) => !s.extensionId || isExtensionEnabled(s.extensionId))
}

/** For tests. */
export function clearItemSources(): void {
	sources.set([])
}

/** The source key for a choice of a source: `feeds:all`. */
export function sourceKey(sourceId: string, choiceId: string): string {
	return `${sourceId}:${choiceId}`
}

/** A source key taken apart, or `null` for one that names no source (`''`, a card's own list). */
export function parseSourceKey(key: string): { sourceId: string; choiceId: string } | null {
	const at = key.indexOf(':')
	if (at <= 0) return null
	return { sourceId: key.slice(0, at), choiceId: key.slice(at + 1) }
}

/** What a source key points at, as a card shows it. */
export interface ResolvedItemSource {
	/** `none` for no source yet, `missing` for one that is gone. */
	type: 'none' | 'source' | 'missing'
	/** The heading, as specific as it can be: "Electronics", "Feeds". */
	name: string
	kind: SourceKind
	source: ItemSource | null
	choiceId: string
}

/**
 * A source key as a card shows it.
 *
 * A key whose source is gone (its extension turned off, a category deleted) is `missing`: the card
 * says so and keeps the key, so turning the extension back on, or undoing the delete, picks up where
 * it was.
 */
export function resolveItemSource(key: string): ResolvedItemSource {
	const parsed = parseSourceKey(key)
	if (!parsed) return { type: 'none', name: 'No source yet', kind: PLAIN_KIND, source: null, choiceId: '' }
	const source = sources.get().find((s) => s.id === parsed.sourceId) ?? null
	const choice = source?.choices().find((c) => c.id === parsed.choiceId)
	if (!source || !choice) return { type: 'missing', name: source ? `${source.label}: gone` : 'Source unavailable', kind: PLAIN_KIND, source, choiceId: parsed.choiceId }
	return { type: 'source', name: choice.label, kind: source.kind(parsed.choiceId), source, choiceId: parsed.choiceId }
}

/** The source key a card on the board stands for, from whichever offered source knows it, or `null`. */
export function sourceKeyOfShape(shape: TLShape): string | null {
	for (const source of offeredItemSources()) {
		if (!source.fromShape?.types.includes(shape.type)) continue
		const choiceId = source.fromShape.choiceOf(shape)
		if (choiceId !== null) return sourceKey(source.id, choiceId)
	}
	return null
}

/** Whether any offered source knows cards of this type. */
export function isSourceShapeType(type: string): boolean {
	return offeredItemSources().some((s) => s.fromShape?.types.includes(type))
}

/** The keys being read right now, outermost first. */
const reading: string[] = []

/**
 * A source key's entries now, or none for a key that names nothing.
 *
 * A source made of other sources (a backlog holding a ranking, a ranking of a backlog) reads them
 * through here, which is what stops a loop: a key asked for again while it is being read has nothing,
 * so a backlog that holds a ranking of itself reads that ranking as empty, rather than forever.
 */
export function sourceEntries(key: string): readonly SourceEntry[] {
	if (reading.includes(key)) return []
	const resolved = resolveItemSource(key)
	if (resolved.type !== 'source' || !resolved.source) return []
	reading.push(key)
	try {
		return resolved.source.entries(resolved.choiceId)
	} finally {
		reading.pop()
	}
}

/* ----------------------------------------------------------------- dragging an item between cards */

/**
 * The drag type a card puts an item under when you drag its cover out, and another card looks for
 * when something is dragged over it. The kit's, so a ranking's covers drop on a backlog without either
 * extension knowing of the other.
 */
export const ITEM_DRAG_TYPE = 'application/x-lifeboard-item'

/** What a dragged item carries: the item, and the source key it came from, when it came from one. */
export interface DraggedItem {
	entry: SourceEntry
	/** Where it came from, as a source key, or '' for an item a card typed. */
	from: string
	/** Said under it where it lands: "Feeds", "Syllabi". */
	via: string
}

/**
 * The item being dragged from a card in this tab, while it is. A drag's data can only be read on the
 * drop, so a card that wants to say what is about to land ("Drop to add Solaris") asks here.
 */
let inFlight: DraggedItem | null = null

export function draggingItem(): DraggedItem | null {
	return inFlight
}

/** Puts an item on a drag. The title also goes as plain text, for anything else it is dropped on. */
export function setDraggedItem(data: DataTransfer, item: DraggedItem): void {
	inFlight = item
	if (typeof document !== 'undefined') document.addEventListener('dragend', () => (inFlight = null), { once: true })
	data.setData(ITEM_DRAG_TYPE, JSON.stringify(item))
	data.setData('text/plain', item.entry.creator ? `${item.entry.title} — ${item.entry.creator}` : item.entry.title)
}

/** Whether a drag carries an item. Only the types can be read before the drop. */
export function hasDraggedItem(data: DataTransfer): boolean {
	return Array.from(data.types).includes(ITEM_DRAG_TYPE)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The item a drop carries, checked: it may come from another tab, or another build. */
export function getDraggedItem(data: DataTransfer): DraggedItem | null {
	try {
		const raw: unknown = JSON.parse(data.getData(ITEM_DRAG_TYPE))
		if (!raw || typeof raw !== 'object') return null
		const { entry, from, via } = raw as Record<string, unknown>
		if (!entry || typeof entry !== 'object') return null
		const e = entry as Record<string, unknown>
		if (!str(e.id) || !str(e.title)) return null
		return {
			entry: { id: str(e.id), title: str(e.title), creator: str(e.creator), year: str(e.year), cover: str(e.cover), url: str(e.url) },
			from: str(from),
			via: str(via),
		}
	} catch {
		return null
	}
}

/* ------------------------------------------------------------------- keeping sources fresh */

/** The keys whose watch is being started right now, outermost first: the same guard as `reading`. */
const watching: string[] = []

function watchOne(key: string): () => void {
	if (watching.includes(key)) return () => {}
	const resolved = resolveItemSource(key)
	if (resolved.type !== 'source' || !resolved.source?.watch) return () => {}
	watching.push(key)
	try {
		return resolved.source.watch(resolved.choiceId)
	} finally {
		watching.pop()
	}
}

/**
 * Keeps the sources a list is made of fresh while it is shown or read: a backlog holding a feed, a
 * ranking of one. `keys` is read reactively, so a collection added or a source changed is watched from
 * then on and one taken away is let go. `owner` is the list's own source key: while its parts' watches
 * start, it counts as being watched, so a backlog holding a ranking of itself doesn't start itself
 * again. Returns the release.
 */
export function watchSourceKeys(owner: string, keys: () => readonly string[]): () => void {
	const held = new Map<string, () => void>()
	const stop = react(`lifeboard:watch-sources:${owner}`, () => {
		const want = new Set(keys().filter(Boolean))
		watching.push(owner)
		try {
			for (const [key, release] of held) {
				if (want.has(key)) continue
				release()
				held.delete(key)
			}
			for (const key of want) if (!held.has(key)) held.set(key, watchOne(key))
		} finally {
			watching.pop()
		}
	})
	return () => {
		stop()
		for (const release of held.values()) release()
		held.clear()
	}
}

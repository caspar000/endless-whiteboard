import { computed, type Editor, type TLShape } from '@lifeboard/canvas'
import {
	PLAIN_KIND,
	foldText,
	isExtensionEnabled,
	keyedStore,
	parseSourceKey,
	sourceEntries,
	type ItemReaction,
	type ItemSource,
	type ItemStamp,
	type ItemStamps,
	type SourceEntry,
} from '@lifeboard/node-kit'
import { Stamp } from 'lucide-react'
import { STAMPS, STAMP_KINDS, TYPED_SOURCE, latestStamp, localDay, type RandomItem, type Stamp as CardStamp, type StampKind } from './model'
import { RANDOMIZER_TYPE, type RandomizerProps } from './props'

/**
 * Everything stamped on every randomizer, as one list per stamp (DARK-11): "Everything I liked" is
 * something a ranking or a backlog can take, through the kit's registry, without knowing a randomizer
 * made it.
 *
 * A card keeps its stamps in its own props, on its own board. This is the vault's copy of each card's
 * latest stamp on each item it stamped, kept up from every board a randomizer is open on
 * (`watchStamped`), so a ranking on another board, or another device, reads the same list. Each card's
 * stamps are kept apart, so taking one back on one card can never take away another card's: the lists
 * are worked out from all of them (`stampedEntries`). Saved by the app beside the feeds.
 */

export const STAMPED_EXTENSION_ID = 'lifeboard.randomizer'

export interface StampedEntry {
	/** `${card}#${item}`: one card's stamp on one item. */
	key: string
	/** The card that stamped it: `<board id>/<shape id>`. */
	card: string
	/** `stampedKey(source, id)`: the item, whichever card stamped it. */
	item: string
	/** The source key of the card that stamped it (`list` for a typed line, `feeds:all`). */
	source: string
	id: string
	title: string
	creator: string
	year: string
	cover: string
	url: string
	/** The card's latest stamp on it. */
	kind: StampKind
	date: string
}

const SOURCE_ID = 'stamped'

/** One item, wherever it was stamped: a typed line's id is the card's own, so it is unique already. */
export function stampedKey(source: string, id: string): string {
	return `${source}|${id}`
}

/** Which card a stamp is from: the board, then the shape, since a shape id is only unique on its board. */
export function cardKey(boardId: string, shapeId: string): string {
	return `${boardId}/${shapeId}`
}

/**
 * A card shuffling "Everything I liked" itself keeps its stamps to itself: written back, a stamp would
 * list the item a second time under the card's source.
 */
const fromThisList = (item: RandomItem) => item.source.startsWith(`${SOURCE_ID}:`)

type Stamped = Readonly<Record<string, StampedEntry>>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const stamped = keyedStore<StampedEntry>(
	'lifeboard:randomizer-stamped',
	(e) => {
		const kind = STAMP_KINDS.find((k) => k === e.kind)
		if (!str(e.key) || !str(e.card) || !str(e.item) || !str(e.id) || !kind) return null
		return {
			key: str(e.key),
			card: str(e.card),
			item: str(e.item),
			source: str(e.source),
			id: str(e.id),
			title: str(e.title),
			creator: str(e.creator),
			year: str(e.year),
			cover: str(e.cover),
			url: str(e.url),
			kind,
			date: str(e.date),
		}
	},
	(e) => e.key
)

export const getStamped = stamped.get
/** Loads a stored copy without saving it back. */
export const replaceStamped = stamped.replace
/** Where a change is saved: the app's, set once at startup. */
export const setStampedPersistence = stamped.setPersistence

/**
 * The stamped list with one card's stamps as that card holds them now: every item whose latest stamp
 * is there, and nothing else of that card's. Other cards' stamps are left as they are, so an undo on
 * one card takes back only its own stamp, and a card deleted keeps what it stamped.
 *
 * A stamp the list already has is kept as it is, picture and all, so a change elsewhere on the card
 * doesn't read the source again for every item.
 */
export function nextStamped(current: Stamped, card: string, items: readonly RandomItem[], entryOf: (item: RandomItem) => SourceEntry | undefined): Stamped {
	const next: Record<string, StampedEntry> = {}
	for (const [key, e] of Object.entries(current)) if (e.card !== card) next[key] = e
	for (const item of items) {
		const latest = latestStamp(item)
		if (!latest || fromThisList(item)) continue
		const itemKey = stampedKey(item.source, item.id)
		const key = `${card}#${itemKey}`
		const kept = current[key]
		if (kept && kept.kind === latest.kind && kept.date === latest.date && kept.title === item.title) {
			next[key] = kept
			continue
		}
		const entry = entryOf(item)
		next[key] = {
			key,
			card,
			item: itemKey,
			source: item.source,
			id: item.id,
			title: item.title,
			creator: item.creator,
			year: item.year,
			cover: item.cover || entry?.cover || '',
			url: entry?.url ?? '',
			kind: latest.kind,
			date: latest.date,
		}
	}
	return next
}

/** A source's own entry for an item, for the picture and address the card doesn't keep. */
function entryOf(item: RandomItem): SourceEntry | undefined {
	if (item.source === TYPED_SOURCE) return undefined
	return sourceEntries(item.source).find((e) => e.id === item.id)
}

const itemsOf = (shape: TLShape): readonly RandomItem[] => (shape.props as RandomizerProps).items ?? []

const watched = new WeakSet<Editor>()

/**
 * Keeps the stamped list up from one board: what its cards hold when it opens, then every stamp,
 * undo and redo, and what other devices send. Wired from `onBoardOpen`, once per editor; side effects
 * go when the editor does. While the randomizer is off nothing is written, as with everything it does.
 */
export function watchStamped(editor: Editor, boardId: string): void {
	if (watched.has(editor)) return
	watched.add(editor)
	const write = (shape: TLShape) => {
		if (!isExtensionEnabled(STAMPED_EXTENSION_ID)) return
		stamped.set(nextStamped(stamped.get(), cardKey(boardId, shape.id), itemsOf(shape), entryOf))
	}
	for (const shape of editor.getCurrentPageShapes()) if (shape.type === RANDOMIZER_TYPE) write(shape)
	editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
		if (shape.type === RANDOMIZER_TYPE) write(shape)
	})
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (next.type === RANDOMIZER_TYPE && itemsOf(prev) !== itemsOf(next)) write(next)
	})
}

/* ------------------------------------------------------------------------- the source it offers */

const CHOICE_LABELS: Record<StampKind, string> = {
	liked: 'Everything I liked',
	disliked: 'Everything I disliked',
	unsure: 'Everything I’m unsure of',
}

const sameItem = (e: StampedEntry) => `${e.title.trim().toLowerCase()}\u0000${e.creator.trim().toLowerCase()}`

/**
 * A stamp's list, newest stamp first. One album stamped on two cards (typed into one, shuffled from a
 * ranking of this very list on another) is one album: of the same title and creator, the newest stamp
 * says which list it is in, and the first one gives its id, so a ranking of the list keeps its place.
 */
export function stampedEntries(all: Stamped, kind: string): SourceEntry[] {
	const groups = new Map<string, { first: StampedEntry; newest: StampedEntry }>()
	const later = (a: StampedEntry, b: StampedEntry) => a.date > b.date || (a.date === b.date && a.key > b.key)
	for (const e of Object.values(all)) {
		const g = groups.get(sameItem(e))
		if (!g) groups.set(sameItem(e), { first: e, newest: e })
		else {
			if (later(e, g.newest)) g.newest = e
			if (later(g.first, e)) g.first = e
		}
	}
	return [...groups.values()]
		.filter((g) => g.newest.kind === kind)
		.sort((a, b) => b.newest.date.localeCompare(a.newest.date) || a.first.title.localeCompare(b.first.title))
		.map(({ first: e, newest }) => ({ id: e.item, title: e.title, creator: e.creator, year: e.year, cover: e.cover || newest.cover, url: e.url || newest.url }))
}

/** "Everything I liked", and the other stamps, for any card that takes a list. */
export const stampedSource: ItemSource = {
	id: SOURCE_ID,
	label: 'Randomizer stamps',
	icon: Stamp,
	extensionId: STAMPED_EXTENSION_ID,
	choices: () => STAMP_KINDS.map((kind) => ({ id: kind, label: CHOICE_LABELS[kind], group: '' })),
	entries: (kind) => (STAMPS[kind as StampKind] ? stampedEntries(stamped.get(), kind) : []),
	kind: () => PLAIN_KIND,
}

/* ------------------------------------------------------------------- what the kit is told (DARK-13) */

/** Where a ranking's stamps are filed, as card keys: `ranking/<id>`. */
const RANKING_CARD = 'ranking/'

const foldedItem = (e: Pick<SourceEntry, 'title' | 'creator'>) => `${foldText(e.title)}\u0000${foldText(e.creator)}`

/** Each item's latest stamp, by its folded title and creator, worked out once per change of the list. */
const latestByItem = computed('lifeboard:randomizer-stamp-by-item', () => {
	const out = new Map<string, StampedEntry>()
	for (const e of Object.values(stamped.get())) {
		const key = foldedItem(e)
		const had = out.get(key)
		if (!had || e.date > had.date || (e.date === had.date && e.key > had.key)) out.set(key, e)
	}
	return out
})

/** An item's latest stamp on any card, or `null`: what a ranking draws on its cover. */
export function stampOf(entry: Pick<SourceEntry, 'title' | 'creator'>): ItemStamp | null {
	const e = latestByItem.get().get(foldedItem(entry))
	return e ? { kind: e.kind, date: e.date } : null
}

/**
 * The stamps rankings gave, by folded title and creator (DARK-13): what a randomizer card counts as
 * its own too, so an album ranked on any board is out of every card's shuffle.
 */
const rankedByItem = computed('lifeboard:randomizer-ranked-stamps', () => {
	const out = new Map<string, CardStamp[]>()
	for (const e of Object.values(stamped.get())) {
		if (!e.card.startsWith(RANKING_CARD)) continue
		const key = foldedItem(e)
		out.set(key, [...(out.get(key) ?? []), { kind: e.kind, date: e.date, ranked: true }])
	}
	for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date))
	return out
})

/** The stamps rankings gave an item, oldest first. Read reactively. */
export function rankedStampsOf(item: Pick<SourceEntry, 'title' | 'creator'>): readonly CardStamp[] {
	return rankedByItem.get().get(foldedItem(item)) ?? []
}

/** Read reactively: every ranked item's stamps, for a card to look its items up in. */
export const getRankedStamps = (): ReadonlyMap<string, readonly CardStamp[]> => rankedByItem.get()
export { foldedItem }


/** Where a ranking's Liked stamps are kept: as a card of their own, so no randomizer's stamps are touched. */
export const rankingCard = (rankingId: string) => `${RANKING_CARD}${rankingId}`

/**
 * An item ranked stamped Liked, as the stamp button would (DARK-13), under the ranking's own card key.
 *
 * Always the ranking's own stamp, even on an item a randomizer already Liked: what rankings stamped is
 * what every randomizer card counts (`rankedStampsOf`), so an album Liked on one card and ranked from
 * Everything I liked leaves every other card's shuffle too. Ranked again by the same ranking, it keeps
 * the stamp it has.
 *
 * An item ranked from the stamped lists themselves (a ranking of "Everything I'm unsure of") is the
 * item it was stamped as: its entry's id is that item's key (`stampedEntries`), so the Liked stamp goes
 * on the same item, from the same source, and the list keeps giving it the same id. A ranking then
 * finds it where it put it, in the Liked list now (`rankedEntries` in Ranking Tiers keeps it shown).
 */
export function stampRanked(all: Stamped, item: { entry: SourceEntry; from: string; rankingId: string }, today: string): Stamped {
	const { entry } = item
	const fromStamps = parseSourceKey(item.from)?.sourceId === SOURCE_ID
	const was = fromStamps ? Object.values(all).find((e) => e.item === entry.id) : undefined
	const source = was?.source ?? item.from
	const id = was?.id ?? entry.id
	const itemKey = was?.item ?? stampedKey(item.from, entry.id)
	const card = rankingCard(item.rankingId)
	const key = `${card}#${itemKey}`
	if (all[key]?.kind === 'liked') return all
	return {
		...all,
		[key]: {
			key,
			card,
			item: itemKey,
			source,
			id,
			title: entry.title,
			creator: entry.creator,
			year: entry.year,
			cover: entry.cover,
			url: entry.url,
			kind: 'liked',
			date: today,
		},
	}
}

/** A ranked item is a liked one. */
export const stampedReaction: ItemReaction = {
	id: 'lifeboard.randomizer.liked-when-ranked',
	extensionId: STAMPED_EXTENSION_ID,
	ranked: (item) => stamped.set(stampRanked(stamped.get(), item, localDay())),
}

/** The stamps, for a ranking's badges and filters. */
export const itemStamps: ItemStamps = {
	extensionId: STAMPED_EXTENSION_ID,
	sourceId: SOURCE_ID,
	kinds: STAMP_KINDS.map((kind) => ({ id: kind, label: STAMPS[kind].label, ink: STAMPS[kind].ink })),
	stampOf,
}

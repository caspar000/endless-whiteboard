import { computed, type Editor, type TLShape } from '@lifeboard/canvas'
import {
	PLAIN_KIND,
	foldText,
	resolveItemSource,
	isExtensionEnabled,
	keyedStore,
	sourceEntries,
	type ItemReaction,
	type ItemSource,
	type ItemStamp,
	type ItemStamps,
	type SourceChoice,
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
 *
 * A stamp belongs to the board it was given on (DARK-14), and the lists are one per board and per
 * source it was stamped from: "Liked on /mu/core" on this board, never everything liked anywhere.
 */

export const STAMPED_EXTENSION_ID = 'lifeboard.randomizer'

export interface StampedEntry {
	/** `${card}#${item}`: one card's stamp on one item. */
	key: string
	/** The card that stamped it: `<board id>/<shape id>`, or a ranking's `ranking/<id>`. */
	card: string
	/**
	 * The board it was stamped on. A randomizer's is in its card key; a ranking's is said when it stamps.
	 * `''` for a ranking's stamp from before DARK-14, which no board was kept for: every board counts it.
	 */
	board: string
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

/** Where a ranking's stamps are filed, as card keys: `ranking/<id>`. */
const RANKING_CARD = 'ranking/'

/** One item, wherever it was stamped: a typed line's id is the card's own, so it is unique already. */
export function stampedKey(source: string, id: string): string {
	return `${source}|${id}`
}

/** Which card a stamp is from: the board, then the shape, since a shape id is only unique on its board. */
export function cardKey(boardId: string, shapeId: string): string {
	return `${boardId}/${shapeId}`
}

/** The board in a randomizer's card key; `''` for a ranking's, which says its board apart. */
export function boardOfCard(card: string): string {
	if (card.startsWith(RANKING_CARD)) return ''
	const at = card.lastIndexOf('/')
	return at > 0 ? card.slice(0, at) : ''
}

/** Whether a stamp counts on a board: one given there, or one from before stamps had boards. */
const onBoard = (e: Pick<StampedEntry, 'board'>, boardId: string) => e.board === boardId || e.board === ''

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
			board: str(e.board) || boardOfCard(str(e.card)),
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
			board: boardOfCard(card),
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
	// Cards set to a list from before DARK-14 move onto this board's own, with no undo step: nobody changed them.
	const scoped = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.type === RANDOMIZER_TYPE)
		.flatMap((shape) => {
			const props = scopedCard(shape.props as RandomizerProps, boardId)
			return props ? [{ id: shape.id, type: RANDOMIZER_TYPE, props }] : []
		})
	if (scoped.length && isExtensionEnabled(STAMPED_EXTENSION_ID)) editor.run(() => editor.updateShapes(scoped as never), { history: 'ignore' })
	for (const shape of editor.getCurrentPageShapes()) if (shape.type === RANDOMIZER_TYPE) write(shape)
	editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
		if (shape.type === RANDOMIZER_TYPE) write(shape)
	})
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (next.type === RANDOMIZER_TYPE && itemsOf(prev) !== itemsOf(next)) write(next)
	})
}

/* ------------------------------------------------------------------------- the source it offers */

const KIND_LABELS: Record<StampKind, string> = { liked: 'Liked', disliked: 'Disliked', unsure: 'Unsure' }

/** What the lists were called before DARK-14, when there was one of each for everything stamped anywhere. */
const LEGACY_LABELS: Record<StampKind, string> = {
	liked: 'Everything I liked',
	disliked: 'Everything I disliked',
	unsure: 'Everything I’m unsure of',
}

const sameItem = (e: StampedEntry) => `${e.title.trim().toLowerCase()}\u0000${e.creator.trim().toLowerCase()}`

/** Which stamps a list holds: one board's, from one source. Leave it out for every stamp anywhere (a list from before DARK-14). */
export interface StampScope {
	board: string
	/** The source key they were stamped from: `syllabus:mucore`, `list` for typed lines; `ANY_ORIGIN` for every one. */
	origin: string
}

/**
 * A list of one board's stamps from any source: what a card set to a list from before DARK-14
 * ("Everything I liked") is moved onto as its board opens (`scopeToBoard`). Never offered otherwise.
 */
export const ANY_ORIGIN = '*'

/**
 * A stamp's list, newest stamp first. One album stamped on two cards (typed into one, shuffled from a
 * ranking of this very list on another) is one album: of the same title and creator, the newest stamp
 * in the list's scope says which list it is in, and the first one anywhere gives its id, so a ranking
 * of the list keeps its place.
 *
 * The id is the first stamp on any board, not only in the scope (DARK-14): a list from before stamps
 * had boards, moved onto one board's, then gives each album the id it had, and the rankings, picks and
 * stamps kept under that id still find it.
 */
export function stampedEntries(all: Stamped, kind: string, scope?: StampScope): SourceEntry[] {
	const groups = new Map<string, { first: StampedEntry; newest: StampedEntry }>()
	const later = (a: StampedEntry, b: StampedEntry) => a.date > b.date || (a.date === b.date && a.key > b.key)
	const firstAnywhere = new Map<string, StampedEntry>()
	for (const e of Object.values(all)) {
		const had = firstAnywhere.get(sameItem(e))
		if (!had || later(had, e)) firstAnywhere.set(sameItem(e), e)
	}
	for (const e of Object.values(all)) {
		if (scope && (!onBoard(e, scope.board) || (scope.origin !== ANY_ORIGIN && e.source !== scope.origin))) continue
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
		.map(({ first: e, newest }) => ({
			id: (firstAnywhere.get(sameItem(e)) ?? e).item,
			title: e.title,
			creator: e.creator,
			year: e.year,
			cover: e.cover || newest.cover,
			url: e.url || newest.url,
		}))
}

/**
 * A list's choice id: `<kind>|<board>|<source stamped from>`, such as `liked|b1|syllabus:mucore`. A
 * bare kind (`liked`) is a list from before DARK-14, of everything stamped anywhere: a card already on
 * one keeps it, and none is offered.
 */
export function stampedChoiceId(kind: StampKind, scope: StampScope): string {
	return `${kind}|${scope.board}|${scope.origin}`
}

export function parseStampedChoice(choiceId: string): { kind: StampKind; scope?: StampScope } | null {
	const [kind, board, ...origin] = choiceId.split('|')
	if (!kind || !STAMPS[kind as StampKind]) return null
	if (board === undefined) return { kind: kind as StampKind }
	return { kind: kind as StampKind, scope: { board, origin: origin.join('|') } }
}

/** What the list of one source is called: "/mu/core", "my lists". */
function originName(origin: string): string {
	if (origin === TYPED_SOURCE) return 'my lists'
	const resolved = resolveItemSource(origin)
	return resolved.type === 'source' ? resolved.name : 'a source that is gone'
}

function stampedChoice(choiceId: string): SourceChoice | null {
	const parsed = parseStampedChoice(choiceId)
	if (!parsed) return null
	if (!parsed.scope) return { id: choiceId, label: LEGACY_LABELS[parsed.kind], group: '' }
	if (parsed.scope.origin === ANY_ORIGIN) return { id: choiceId, label: `${KIND_LABELS[parsed.kind]} on this board`, group: '' }
	const from = originName(parsed.scope.origin)
	return { id: choiceId, label: `${KIND_LABELS[parsed.kind]} on ${from}`, group: from }
}

/** A board's lists: for each source something was stamped from there, its Liked, Unsure and Disliked. */
export function stampedChoices(all: Stamped, boardId: string): SourceChoice[] {
	const origins = new Set<string>()
	for (const e of Object.values(all)) if (onBoard(e, boardId)) origins.add(e.source)
	return [...origins]
		.map((origin) => ({ origin, name: originName(origin) }))
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap(({ origin }) => STAMP_KINDS.map((kind) => stampedChoice(stampedChoiceId(kind, { board: boardId, origin }))!))
}

/** "Liked on /mu/core", and the other stamps and sources, for any card on the same board that takes a list. */
export const stampedSource: ItemSource = {
	id: SOURCE_ID,
	label: 'Randomizer stamps',
	icon: Stamp,
	extensionId: STAMPED_EXTENSION_ID,
	choices: (boardId) => stampedChoices(stamped.get(), boardId),
	choice: stampedChoice,
	entries: (choiceId) => {
		const parsed = parseStampedChoice(choiceId)
		return parsed ? stampedEntries(stamped.get(), parsed.kind, parsed.scope) : []
	},
	kind: (choiceId) => {
		const origin = parseStampedChoice(choiceId)?.scope?.origin
		return origin && origin !== TYPED_SOURCE && origin !== ANY_ORIGIN ? resolveItemSource(origin).kind : PLAIN_KIND
	},
}

/** A list key from before DARK-14 (`stamped:liked`) as the same list of one board's stamps; `null` for any other key. */
export function scopeToBoard(key: string, boardId: string): string | null {
	if (!boardId || !key.startsWith(`${SOURCE_ID}:`)) return null
	const parsed = parseStampedChoice(key.slice(SOURCE_ID.length + 1))
	return parsed && !parsed.scope ? `${SOURCE_ID}:${stampedChoiceId(parsed.kind, { board: boardId, origin: ANY_ORIGIN })}` : null
}

/**
 * A randomizer set to a list from before DARK-14, moved onto its board's own: its source, and the
 * stamps and picks it keeps under it. `null` when it isn't set to one.
 */
export function scopedCard(props: Pick<RandomizerProps, 'source' | 'items' | 'picks'>, boardId: string): Pick<RandomizerProps, 'source' | 'items' | 'picks'> | null {
	const to = scopeToBoard(props.source, boardId)
	if (!to) return null
	const from = props.source
	return {
		source: to,
		items: props.items.map((i) => (i.source === from ? { ...i, source: to } : i)),
		picks: props.picks.map((p) => (p.source === from ? { ...p, source: to } : p)),
	}
}

/* ------------------------------------------------------------------- what the kit is told (DARK-13) */

const foldedItem = (e: Pick<SourceEntry, 'title' | 'creator'>) => `${foldText(e.title)}\u0000${foldText(e.creator)}`

/** A board's stamp on an item, as a map key: the board, then the folded title and creator. */
const onBoardKey = (board: string, folded: string) => `${board}\u0001${folded}`

const later = (a: StampedEntry, b: StampedEntry | undefined) => !b || a.date > b.date || (a.date === b.date && a.key > b.key)

/** Each item's latest stamp on each board, worked out once per change of the list. */
const latestByItem = computed('lifeboard:randomizer-stamp-by-item', () => {
	const out = new Map<string, StampedEntry>()
	for (const e of Object.values(stamped.get())) {
		const key = onBoardKey(e.board, foldedItem(e))
		if (later(e, out.get(key))) out.set(key, e)
	}
	return out
})

/**
 * An item's latest stamp on a board, or `null`: what a ranking on that board draws on its cover and
 * puts in its queue. A ranking's stamp from before stamps had boards counts on every board.
 */
export function stampOf(entry: Pick<SourceEntry, 'title' | 'creator'>, boardId: string): ItemStamp | null {
	const folded = foldedItem(entry)
	const here = latestByItem.get().get(onBoardKey(boardId, folded))
	const before = boardId ? latestByItem.get().get(onBoardKey('', folded)) : undefined
	const e = here && before ? (later(here, before) ? here : before) : (here ?? before)
	return e ? { kind: e.kind, date: e.date } : null
}

/**
 * The stamps rankings gave, by board and folded title and creator (DARK-13): what a randomizer card on
 * the same board counts as its own too, so an album ranked there is out of its shuffle.
 */
const rankedByItem = computed('lifeboard:randomizer-ranked-stamps', () => {
	const out = new Map<string, CardStamp[]>()
	for (const e of Object.values(stamped.get())) {
		if (!e.card.startsWith(RANKING_CARD)) continue
		const key = onBoardKey(e.board, foldedItem(e))
		out.set(key, [...(out.get(key) ?? []), { kind: e.kind, date: e.date, ranked: true }])
	}
	for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date))
	return out
})

type RankedStamps = ReadonlyMap<string, readonly CardStamp[]>

/** Read reactively: every ranked item's stamps, for a card to look its items up in (`rankedStampsIn`). */
export const getRankedStamps = (): RankedStamps => rankedByItem.get()

/** The stamps rankings on a board gave an item, oldest first, from `getRankedStamps`. */
export function rankedStampsIn(all: RankedStamps, item: Pick<SourceEntry, 'title' | 'creator'>, boardId: string): readonly CardStamp[] {
	const folded = foldedItem(item)
	const here = all.get(onBoardKey(boardId, folded)) ?? []
	const before = boardId ? (all.get(onBoardKey('', folded)) ?? []) : []
	return before.length ? [...before, ...here].sort((a, b) => a.date.localeCompare(b.date)) : here
}

/** The stamps rankings on a board gave an item, oldest first. Read reactively. */
export function rankedStampsOf(item: Pick<SourceEntry, 'title' | 'creator'>, boardId: string): readonly CardStamp[] {
	return rankedStampsIn(rankedByItem.get(), item, boardId)
}

export { foldedItem }

/** Where a ranking's Liked stamps are kept: as a card of their own, so no randomizer's stamps are touched. */
export const rankingCard = (rankingId: string) => `${RANKING_CARD}${rankingId}`

/**
 * An item ranked for the first time, stamped Liked as the stamp button would (DARK-13), under the
 * ranking's own card key and on its board.
 *
 * Only an item with no stamp on that board yet (DARK-14): one already Liked, Unsure or Disliked keeps
 * the stamp it was given, wherever it is ranked and however often it moves. The ranking's queue is made
 * of exactly those, so ranking them says nothing new.
 *
 * An item ranked from the stamped lists themselves is the item it was stamped as: its entry's id is
 * that item's key (`stampedEntries`), and it has a stamp, so nothing is filed.
 */
export function stampRanked(all: Stamped, item: { entry: SourceEntry; from: string; rankingId: string; boardId: string }, today: string): Stamped {
	const { entry, boardId } = item
	const folded = foldedItem(entry)
	if (Object.values(all).some((e) => onBoard(e, boardId) && foldedItem(e) === folded)) return all
	const itemKey = stampedKey(item.from, entry.id)
	const card = rankingCard(item.rankingId)
	const key = `${card}#${itemKey}`
	return {
		...all,
		[key]: {
			key,
			card,
			board: boardId,
			item: itemKey,
			source: item.from,
			id: entry.id,
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

/** A ranked item nobody has stamped is a liked one. */
export const stampedReaction: ItemReaction = {
	id: 'lifeboard.randomizer.liked-when-ranked',
	extensionId: STAMPED_EXTENSION_ID,
	ranked: (item) => stamped.set(stampRanked(stamped.get(), item, localDay())),
}

/** The stamps, for a ranking's badges, filters and queue. */
export const itemStamps: ItemStamps = {
	extensionId: STAMPED_EXTENSION_ID,
	sourceId: SOURCE_ID,
	kinds: STAMP_KINDS.map((kind) => ({ id: kind, label: STAMPS[kind].label, ink: STAMPS[kind].ink })),
	stampOf,
	scopeToBoard,
}

import type { Editor, TLShape } from '@lifeboard/canvas'
import { PLAIN_KIND, isExtensionEnabled, keyedStore, sourceEntries, type ItemSource, type SourceEntry } from '@lifeboard/node-kit'
import { Stamp } from 'lucide-react'
import { STAMPS, STAMP_KINDS, TYPED_SOURCE, latestStamp, type RandomItem, type StampKind } from './model'
import { RANDOMIZER_TYPE, type RandomizerProps } from './props'

/**
 * Everything stamped on every randomizer, as one list per stamp (DARK-11): "Everything I liked" is
 * something a ranking or a backlog can take, through the kit's registry, without knowing a randomizer
 * made it.
 *
 * A card keeps its stamps in its own props, on its own board. This is the vault's copy of the latest
 * stamp of each stamped item, kept up from every board a randomizer is open on (`watchStamped`), so a
 * ranking on another board, or another device, reads the same list. Saved by the app beside the feeds.
 */

export const STAMPED_EXTENSION_ID = 'lifeboard.randomizer'

export interface StampedEntry {
	/** `stampedKey(source, id)`: the item, whichever card stamped it. */
	key: string
	/** The source key of the card that stamped it (`list` for a typed line, `feeds:all`). */
	source: string
	id: string
	title: string
	creator: string
	year: string
	cover: string
	url: string
	/** Its latest stamp. */
	kind: StampKind
	date: string
}

const SOURCE_ID = 'stamped'

/** One item, wherever it was stamped: a typed line's id is the card's own, so it is unique already. */
export function stampedKey(source: string, id: string): string {
	return `${source}|${id}`
}

/**
 * A card shuffling "Everything I liked" itself keeps its stamps to itself: written back, a stamp would
 * list the item a second time under the card's source, and taking it back could not restore the first.
 */
const fromThisList = (item: RandomItem) => item.source.startsWith(`${SOURCE_ID}:`)

type Stamped = Readonly<Record<string, StampedEntry>>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const stamped = keyedStore<StampedEntry>(
	'lifeboard:randomizer-stamped',
	(e) => {
		const kind = STAMP_KINDS.find((k) => k === e.kind)
		if (!str(e.key) || !str(e.id) || !kind) return null
		return {
			key: str(e.key),
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
 * The stamped list after one card went from `before` to `after` (`null` before: a card just opened or
 * made, which can only add).
 *
 * An item whose latest stamp changed is written with it. One whose stamps were all taken back, or that
 * left the card's list stamped, leaves the list too. An item left alone stays as it is, so a card that
 * never saw a stamp can't take away what another card stamped. Of two cards stamping one feed video,
 * the later stamp is kept.
 */
export function nextStamped(
	current: Stamped,
	before: readonly RandomItem[] | null,
	after: readonly RandomItem[],
	entryOf: (item: RandomItem) => SourceEntry | undefined
): Stamped {
	const was = new Map((before ?? []).filter((item) => !fromThisList(item)).map((item) => [stampedKey(item.source, item.id), latestStamp(item)]))
	const next: Record<string, StampedEntry> = { ...current }
	const seen = new Set<string>()
	for (const item of after) {
		if (fromThisList(item)) continue
		const key = stampedKey(item.source, item.id)
		seen.add(key)
		const latest = latestStamp(item)
		const old = was.get(key)
		if (before && old?.kind === latest?.kind && old?.date === latest?.date) continue
		if (!latest) {
			if (before && old) delete next[key]
			continue
		}
		const kept = next[key]
		if (!before && kept && kept.date > latest.date) continue
		const entry = entryOf(item)
		next[key] = {
			key,
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
	if (before) for (const [key, old] of was) if (old && !seen.has(key)) delete next[key]
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
export function watchStamped(editor: Editor): void {
	if (watched.has(editor)) return
	watched.add(editor)
	const write = (before: readonly RandomItem[] | null, after: readonly RandomItem[]) => {
		if (!isExtensionEnabled(STAMPED_EXTENSION_ID)) return
		stamped.set(nextStamped(stamped.get(), before, after, entryOf))
	}
	for (const shape of editor.getCurrentPageShapes()) if (shape.type === RANDOMIZER_TYPE) write(null, itemsOf(shape))
	editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
		if (shape.type === RANDOMIZER_TYPE) write(null, itemsOf(shape))
	})
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (next.type !== RANDOMIZER_TYPE || prev.props === next.props) return
		const before = itemsOf(prev)
		const after = itemsOf(next)
		if (before !== after) write(before, after)
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
		.map(({ first: e, newest }) => ({ id: e.key, title: e.title, creator: e.creator, year: e.year, cover: e.cover || newest.cover, url: e.url || newest.url }))
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

import { atom } from '@lifeboard/canvas'
import {
	checkCategoryName,
	makeId,
	mergeItems,
	nextColor,
	pruneWatched,
	watchedKey,
	type FeedCategory,
	type FeedItem,
	type FeedSource,
	type SourceItems,
	type WatchedEntry,
} from './model'

/**
 * The feeds' data. Sources, categories and watched marks are vault data, saved by the app beside the
 * syllabus (its `feeds.ts`), each belonging to a board (DARK-14): every feed card on that board, on any
 * device, reads the same ones. The posts each source last listed are this device's, saved here only so
 * a card opens full.
 *
 * Writes here are not on any board's undo stack: they are not a board's data.
 */
function store<T>(name: string) {
	const value = atom<Readonly<Record<string, T>>>(name, {})
	let persist: ((v: Readonly<Record<string, T>>) => void) | null = null
	return {
		get: () => value.get(),
		set(next: Readonly<Record<string, T>>) {
			if (JSON.stringify(next) === JSON.stringify(value.get())) return
			value.set(next)
			persist?.(next)
		},
		/** Loads a stored copy without saving it back. */
		load: (next: Readonly<Record<string, T>>) => value.set(next),
		setPersistence: (listener: ((v: Readonly<Record<string, T>>) => void) | null) => {
			persist = listener
		},
	}
}

const sources = store<FeedSource>('lifeboard:feed-sources')
const categories = store<FeedCategory>('lifeboard:feed-categories')
const watched = store<WatchedEntry>('lifeboard:feed-watched')
const items = store<SourceItems>('lifeboard:feed-items')

export const getSources = sources.get
export const getCategories = categories.get
export const getWatched = watched.get
export const getSourceItems = items.get

export const setSourcesPersistence = sources.setPersistence
export const setCategoriesPersistence = categories.setPersistence
export const setWatchedPersistence = watched.setPersistence
export const setSourceItemsPersistence = items.setPersistence

/* Loading a stored copy (the app's cache, or the server vault). Each entry is checked, and what can't
 * be read is dropped rather than trusted: these arrive from storage and from other devices. */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** Where a record from before DARK-14 has been copied to, if anywhere; left off a record of a board. */
const claimed = (e: Record<string, unknown>) => (str(e.boardId) ? {} : { claimedBy: strings(e.claimedBy) })
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

function keyed<T>(raw: unknown, key: string, read: (entry: Record<string, unknown>) => T | null): Record<string, T> {
	if (!isObject(raw)) return {}
	const out: Record<string, T> = {}
	for (const entry of Object.values(raw)) {
		if (!isObject(entry) || typeof entry[key] !== 'string') continue
		const value = read(entry)
		if (value) out[entry[key] as string] = value
	}
	return out
}

export function replaceSources(raw: unknown): void {
	sources.load(
		keyed(raw, 'sourceId', (e) =>
			str(e.feedUrl) && str(e.provider)
				? {
						sourceId: str(e.sourceId),
						provider: str(e.provider),
						feedUrl: str(e.feedUrl),
						link: str(e.link),
						title: str(e.title) || str(e.feedUrl),
						categories: strings(e.categories),
						addedAt: str(e.addedAt),
						boardId: str(e.boardId),
						...claimed(e),
					}
				: null
		)
	)
}

export function replaceCategories(raw: unknown): void {
	categories.load(
		keyed(raw, 'categoryId', (e) =>
			str(e.name)
				? {
						categoryId: str(e.categoryId),
						name: str(e.name),
						color: str(e.color) || 'blue',
						order: typeof e.order === 'number' ? e.order : 0,
						boardId: str(e.boardId),
						...claimed(e),
					}
				: null
		)
	)
}

export function replaceWatched(raw: unknown): void {
	const out: Record<string, WatchedEntry> = {}
	for (const e of Object.values(isObject(raw) ? raw : {})) {
		if (!isObject(e) || !str(e.itemId)) continue
		const entry = { itemId: str(e.itemId), at: str(e.at), boardId: str(e.boardId) }
		out[watchedKey(entry.boardId, entry.itemId)] = entry
	}
	watched.load(out)
}

/* ------------------------------------------------------------------------------- one board's */

const onBoard = <T extends { boardId: string }>(all: Readonly<Record<string, T>>, boardId: string, idOf: (v: T) => string): Record<string, T> => {
	const out: Record<string, T> = {}
	for (const v of Object.values(all)) if (v.boardId === boardId) out[idOf(v)] = v
	return out
}

/** A board's sources, by id. Read reactively. `''` is those from before DARK-14. */
export const sourcesOn = (boardId: string) => onBoard(sources.get(), boardId, (s) => s.sourceId)
/** A board's categories, by id. Read reactively. */
export const categoriesOn = (boardId: string) => onBoard(categories.get(), boardId, (c) => c.categoryId)
/** A board's watched marks, by item id, as the model's functions take them. Read reactively. */
export const watchedOn = (boardId: string) => onBoard(watched.get(), boardId, (w) => w.itemId)

/**
 * Gives a board its own copy of the feeds from before DARK-14, once, as a board with a feed card opens:
 * the sources, the categories they are filed under, what was watched, and the posts already read, so
 * the card opens as it was. Each board's copy then goes its own way.
 *
 * Returns the old category ids with the board's copies of them, for the board's feed cards to follow
 * (`remapFeedCards`), or `null` when nothing was copied.
 */
export function claimFeeds(boardId: string): ReadonlyMap<string, string> | null {
	if (!boardId) return null
	const oldSources = Object.values(sources.get()).filter((s) => !s.boardId)
	const oldCategories = Object.values(categories.get()).filter((c) => !c.boardId)
	if (!oldSources.length && !oldCategories.length) return null
	if ([...oldSources, ...oldCategories].some((r) => r.claimedBy?.includes(boardId))) return null
	const at = new Date().toISOString()
	const nextCategories: Record<string, FeedCategory> = { ...categories.get() }
	const categoryIds = new Map<string, string>()
	for (const c of oldCategories) {
		const copy: FeedCategory = { categoryId: makeId('cat'), name: c.name, color: c.color, order: c.order, boardId }
		categoryIds.set(c.categoryId, copy.categoryId)
		nextCategories[copy.categoryId] = copy
		nextCategories[c.categoryId] = { ...c, claimedBy: [...(c.claimedBy ?? []), boardId] }
	}
	const nextSources: Record<string, FeedSource> = { ...sources.get() }
	const nextItems: Record<string, SourceItems> = { ...items.get() }
	for (const s of oldSources) {
		const sourceId = makeId('src')
		const filed = s.categories.flatMap((id) => categoryIds.get(id) ?? [])
		nextSources[sourceId] = { sourceId, provider: s.provider, feedUrl: s.feedUrl, link: s.link, title: s.title, categories: filed, addedAt: s.addedAt || at, boardId }
		nextSources[s.sourceId] = { ...s, claimedBy: [...(s.claimedBy ?? []), boardId] }
		const kept = items.get()[s.sourceId]
		if (kept) nextItems[sourceId] = { ...kept, sourceId, items: kept.items.map((i) => ({ ...i, sourceId })) }
	}
	const nextWatched: Record<string, WatchedEntry> = { ...watched.get() }
	for (const w of Object.values(watched.get())) if (!w.boardId) nextWatched[watchedKey(boardId, w.itemId)] = { ...w, boardId }
	categories.set(nextCategories)
	sources.set(nextSources)
	items.set(nextItems)
	watched.set(nextWatched)
	return categoryIds
}

function readItem(raw: unknown): FeedItem | null {
	if (!isObject(raw) || !str(raw.itemId) || !str(raw.url)) return null
	return {
		itemId: str(raw.itemId),
		sourceId: str(raw.sourceId),
		title: str(raw.title),
		url: str(raw.url),
		published: str(raw.published),
		thumbnail: str(raw.thumbnail),
	}
}

export function replaceSourceItems(raw: unknown): void {
	items.load(
		keyed(raw, 'sourceId', (e) => ({
			sourceId: str(e.sourceId),
			fetchedAt: str(e.fetchedAt),
			items: Array.isArray(e.items) ? e.items.map(readItem).filter((i): i is FeedItem => !!i) : [],
			error: str(e.error),
		}))
	)
}

/* ------------------------------------------------------------------------------------- sources */

/**
 * Adds a source to a board, or files the one the board already has with the same feed into its
 * categories too. A feed another board follows is read once for both (`refresh.ts`), and its posts
 * already read are this one's from the start.
 */
export function addSource(boardId: string, source: Omit<FeedSource, 'sourceId' | 'addedAt' | 'boardId' | 'claimedBy'>): FeedSource {
	const existing = Object.values(sources.get()).find((s) => s.boardId === boardId && s.feedUrl === source.feedUrl)
	if (existing) {
		const merged = { ...existing, categories: [...new Set([...existing.categories, ...source.categories])] }
		sources.set({ ...sources.get(), [existing.sourceId]: merged })
		return merged
	}
	const added: FeedSource = { ...source, sourceId: makeId('src'), addedAt: new Date().toISOString(), boardId }
	sources.set({ ...sources.get(), [added.sourceId]: added })
	const read = Object.values(sources.get()).find((s) => s.feedUrl === source.feedUrl && items.get()[s.sourceId]?.fetchedAt)
	const kept = read && items.get()[read.sourceId]
	if (kept) items.set({ ...items.get(), [added.sourceId]: { ...kept, sourceId: added.sourceId, items: kept.items.map((i) => ({ ...i, sourceId: added.sourceId })) } })
	return added
}

export function removeSource(sourceId: string): void {
	const { [sourceId]: _gone, ...rest } = sources.get()
	sources.set(rest)
	const { [sourceId]: _posts, ...restItems } = items.get()
	items.set(restItems)
}

/** Files a source under a category, or takes it out of it. */
export function setSourceInCategory(sourceId: string, categoryId: string, filed: boolean): void {
	const source = sources.get()[sourceId]
	if (!source) return
	const without = source.categories.filter((c) => c !== categoryId)
	sources.set({ ...sources.get(), [sourceId]: { ...source, categories: filed ? [...without, categoryId] : without } })
}

/* ---------------------------------------------------------------------------------- categories */

/** A new category at the end of a board's chips, or why it can't be made. */
export function addCategory(boardId: string, name: string): FeedCategory | { error: string } {
	const mine = categoriesOn(boardId)
	const checked = checkCategoryName(name, mine)
	if ('error' in checked) return checked
	const order = Math.max(0, ...Object.values(mine).map((c) => c.order + 1))
	const category: FeedCategory = { categoryId: makeId('cat'), name: checked.name, color: nextColor(mine), order, boardId }
	categories.set({ ...categories.get(), [category.categoryId]: category })
	return category
}

export function renameCategory(categoryId: string, name: string): { error: string } | null {
	const all = categories.get()
	const category = all[categoryId]
	if (!category) return null
	const checked = checkCategoryName(name, categoriesOn(category.boardId), categoryId)
	if ('error' in checked) return checked
	categories.set({ ...all, [categoryId]: { ...category, name: checked.name } })
	return null
}

/** Deletes a category. Its sources stay, filed under whatever else they were in. */
export function removeCategory(categoryId: string): void {
	const { [categoryId]: _gone, ...rest } = categories.get()
	categories.set(rest)
	const next: Record<string, FeedSource> = {}
	for (const [id, s] of Object.entries(sources.get())) next[id] = s.categories.includes(categoryId) ? { ...s, categories: s.categories.filter((c) => c !== categoryId) } : s
	sources.set(next)
}

/** Moves a category one place earlier (`-1`) or later (`1`) among its board's: up the panel, left along the chips. */
export function moveCategory(categoryId: string, by: -1 | 1): void {
	const boardId = categories.get()[categoryId]?.boardId
	if (boardId === undefined) return
	const ordered = Object.values(categoriesOn(boardId)).sort((a, b) => a.order - b.order)
	const at = ordered.findIndex((c) => c.categoryId === categoryId)
	const to = at + by
	if (at < 0 || to < 0 || to >= ordered.length) return
	;[ordered[at], ordered[to]] = [ordered[to]!, ordered[at]!]
	categories.set({ ...categories.get(), ...Object.fromEntries(ordered.map((c, i) => [c.categoryId, { ...c, order: i }])) })
}

/* ------------------------------------------------------------------------------------- watched */

/** Marks posts watched, or not, on a board: another board's marks are its own. */
export function setWatched(boardId: string, itemIds: readonly string[], on: boolean): void {
	const at = new Date().toISOString()
	const next: Record<string, WatchedEntry> = { ...watched.get() }
	for (const itemId of itemIds) {
		const key = watchedKey(boardId, itemId)
		if (on) next[key] ??= { itemId, at, boardId }
		else delete next[key]
	}
	watched.set(pruneWatched(next))
}

/* --------------------------------------------------------------------------------------- posts */

/** What a read of a source brought: its posts, merged into what was kept, or why it failed. */
export function recordRead(sourceId: string, result: { items: FeedItem[] } | { error: string }): void {
	const old = items.get()[sourceId]
	const next: SourceItems =
		'error' in result
			? { sourceId, fetchedAt: old?.fetchedAt ?? '', items: old?.items ?? [], error: result.error }
			: { sourceId, fetchedAt: new Date().toISOString(), items: mergeItems(old?.items ?? [], result.items), error: '' }
	items.set({ ...items.get(), [sourceId]: next })
}

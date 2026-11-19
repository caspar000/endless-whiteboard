import { atom } from '@lifeboard/canvas'
import {
	checkCategoryName,
	makeId,
	mergeItems,
	nextColor,
	pruneWatched,
	type FeedCategory,
	type FeedItem,
	type FeedSource,
	type SourceItems,
	type WatchedEntry,
} from './model'

/**
 * The feeds' data. Sources, categories and watched marks are vault data, saved by the app beside the
 * syllabus (its `feeds.ts`): every feed card on every board and device reads the same ones. The posts
 * each source last listed are this device's, saved here only so a card opens full.
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
					}
				: null
		)
	)
}

export function replaceCategories(raw: unknown): void {
	categories.load(
		keyed(raw, 'categoryId', (e) =>
			str(e.name)
				? { categoryId: str(e.categoryId), name: str(e.name), color: str(e.color) || 'blue', order: typeof e.order === 'number' ? e.order : 0 }
				: null
		)
	)
}

export function replaceWatched(raw: unknown): void {
	watched.load(keyed(raw, 'itemId', (e) => ({ itemId: str(e.itemId), at: str(e.at) })))
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

/** Adds a source, or files the one already there with the same feed into `categoryIds` too. */
export function addSource(source: Omit<FeedSource, 'sourceId' | 'addedAt'>): FeedSource {
	const existing = Object.values(sources.get()).find((s) => s.feedUrl === source.feedUrl)
	if (existing) {
		const merged = { ...existing, categories: [...new Set([...existing.categories, ...source.categories])] }
		sources.set({ ...sources.get(), [existing.sourceId]: merged })
		return merged
	}
	const added: FeedSource = { ...source, sourceId: makeId('src'), addedAt: new Date().toISOString() }
	sources.set({ ...sources.get(), [added.sourceId]: added })
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

/** A new category at the end of the chips, or why it can't be made. */
export function addCategory(name: string): FeedCategory | { error: string } {
	const all = categories.get()
	const checked = checkCategoryName(name, all)
	if ('error' in checked) return checked
	const order = Math.max(0, ...Object.values(all).map((c) => c.order + 1))
	const category: FeedCategory = { categoryId: makeId('cat'), name: checked.name, color: nextColor(all), order }
	categories.set({ ...all, [category.categoryId]: category })
	return category
}

export function renameCategory(categoryId: string, name: string): { error: string } | null {
	const all = categories.get()
	const category = all[categoryId]
	if (!category) return null
	const checked = checkCategoryName(name, all, categoryId)
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

/** Moves a category one place earlier (`-1`) or later (`1`): up the panel, left along the chips. */
export function moveCategory(categoryId: string, by: -1 | 1): void {
	const ordered = Object.values(categories.get()).sort((a, b) => a.order - b.order)
	const at = ordered.findIndex((c) => c.categoryId === categoryId)
	const to = at + by
	if (at < 0 || to < 0 || to >= ordered.length) return
	;[ordered[at], ordered[to]] = [ordered[to]!, ordered[at]!]
	categories.set(Object.fromEntries(ordered.map((c, i) => [c.categoryId, { ...c, order: i }])))
}

/* ------------------------------------------------------------------------------------- watched */

export function setWatched(itemIds: readonly string[], on: boolean): void {
	const at = new Date().toISOString()
	const next: Record<string, WatchedEntry> = { ...watched.get() }
	for (const itemId of itemIds) {
		if (on) next[itemId] ??= { itemId, at }
		else delete next[itemId]
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

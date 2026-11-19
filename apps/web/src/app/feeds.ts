import {
	getCategories,
	getSourceItems,
	getSources,
	getWatched,
	replaceCategories,
	replaceSourceItems,
	replaceSources,
	replaceWatched,
	setCategoriesPersistence,
	setSourceItemsPersistence,
	setSourcesPersistence,
	setWatchedPersistence,
} from '@lifeboard/feeds'
import { pushVaultSetting } from '../server/serverVault'

/**
 * The feeds' data (packages/feeds), kept like the syllabus (`skillIndex.ts`): localStorage as the cache
 * that makes the first render right, the server vault as the truth once it answers. The posts each
 * source last listed stay on this device: any device can read them again.
 */
const WAIT_MS = 1000

const VAULT = [
	{ key: 'feedSources', cacheKey: 'lifeboard:feedSources', get: getSources, replace: replaceSources, listen: setSourcesPersistence },
	{ key: 'feedCategories', cacheKey: 'lifeboard:feedCategories', get: getCategories, replace: replaceCategories, listen: setCategoriesPersistence },
	{ key: 'feedWatched', cacheKey: 'lifeboard:feedWatched', get: getWatched, replace: replaceWatched, listen: setWatchedPersistence },
] as const

const LOCAL = { cacheKey: 'lifeboard:feedItems', get: getSourceItems, replace: replaceSourceItems, listen: setSourceItemsPersistence }

export function loadFeeds(): void {
	for (const store of [...VAULT, LOCAL]) {
		try {
			const raw = localStorage.getItem(store.cacheKey)
			if (raw) store.replace(JSON.parse(raw))
		} catch {
			// A malformed cache, or no DOM (vitest imports the composition root): start empty.
		}
		let timer: ReturnType<typeof setTimeout> | null = null
		store.listen(() => {
			if (timer) return
			timer = setTimeout(() => {
				timer = null
				const value = store.get()
				cache(store.cacheKey, value)
				if ('key' in store) pushVaultSetting(store.key, value)
			}, WAIT_MS)
		})
	}
}

function cache(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// Private-mode Safari can throw on write; the next read of the sources fills it again.
	}
}

/** The server vault's copy wins; this device's seeds a vault that has none. */
export function applyRemoteFeeds(remote: Partial<Record<(typeof VAULT)[number]['key'], unknown>>): void {
	for (const store of VAULT) {
		const value = remote[store.key]
		if (value === undefined) {
			pushVaultSetting(store.key, store.get())
			continue
		}
		store.replace(value)
		cache(store.cacheKey, store.get())
	}
}

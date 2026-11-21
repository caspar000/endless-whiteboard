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
import type { VaultSettingKey } from '../server/serverVault'
import { read, readRaw, remove, vaultCache, write, type VaultStore } from './vaultCache'

/**
 * The feeds' data (packages/feeds). Sources, categories and watched marks are the only copy there is,
 * kept like saved card layouts (`cardLayouts.ts`): written to localStorage and sent to the server vault
 * the moment they change, and held for a vault whose server hasn't taken them yet (`vaultCache.ts`).
 * The posts each source last listed stay on this device, since any device can read them again.
 */
const VAULT = vaultCache('feed', [
	{ key: 'feedSources', cacheKey: 'lifeboard:feedSources', get: getSources, replace: replaceSources, listen: setSourcesPersistence },
	{ key: 'feedCategories', cacheKey: 'lifeboard:feedCategories', get: getCategories, replace: replaceCategories, listen: setCategoriesPersistence },
	{ key: 'feedWatched', cacheKey: 'lifeboard:feedWatched', get: getWatched, replace: replaceWatched, listen: setWatchedPersistence },
] as VaultStore[])

const ITEMS_KEY = 'lifeboard:feedItems'
/** The posts change with every read of every source; a second's delay costs nothing, as they can be read again. */
const ITEMS_WAIT_MS = 1000

let itemsTimer: ReturnType<typeof setTimeout> | null = null

export function loadFeeds(): void {
	VAULT.load()

	read(ITEMS_KEY, replaceSourceItems)
	const flush = () => {
		if (itemsTimer) clearTimeout(itemsTimer)
		itemsTimer = null
		write(ITEMS_KEY, JSON.stringify(getSourceItems()))
	}
	setSourceItemsPersistence(() => {
		itemsTimer ??= setTimeout(flush, ITEMS_WAIT_MS)
	})
	// A tab can close inside the second; what it had read is kept rather than read again.
	if (typeof window !== 'undefined') {
		window.addEventListener('pagehide', () => itemsTimer && flush())
		document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && itemsTimer && flush())
	}
}

/**
 * Drops everything this browser holds of the feeds, unsent changes included, without sending
 * anything: on logging out, and when another vault answers than the one the cache is of.
 */
export function forgetFeeds(): void {
	VAULT.forget()
	if (itemsTimer) clearTimeout(itemsTimer)
	itemsTimer = null
	remove(ITEMS_KEY)
	replaceSourceItems({})
}

/**
 * The server vault's copy wins, unless this device has a change it never took: then this device's is
 * sent again. A vault that has none is seeded from this device. `vaultId` is the vault that answered
 * (`null` when not known): a cache of another vault is dropped, posts included, before any of that.
 */
export function applyRemoteFeeds(remote: Partial<Record<VaultSettingKey, unknown>>, vaultId: string | null): void {
	const cachedFor = readRaw('lifeboard:feedVault')
	if (vaultId && cachedFor !== null && cachedFor !== vaultId) forgetFeeds()
	VAULT.applyRemote(remote, vaultId)
}

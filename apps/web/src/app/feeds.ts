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
 * The feeds' data (packages/feeds). Sources, categories and watched marks are the only copy there is,
 * kept like saved card layouts (`cardLayouts.ts`): written to localStorage and sent to the server vault
 * the moment they change, never on a timer that a closed tab would cut short. The posts each source
 * last listed stay on this device, since any device can read them again.
 *
 * A change the server hasn't taken yet (offline, the tab closed mid-request, no server this session)
 * is marked unsent in localStorage. The next time the vault answers, an unsent copy is sent again
 * rather than replaced by the vault's older one.
 *
 * All of it is one vault's, and a browser can be used by several accounts. The cache remembers which
 * vault it is of; another vault answering, or a log-out, drops it, unsent changes included, so one
 * vault's sources are never shown to, or sent into, another.
 */
const VAULT = [
	{ key: 'feedSources', cacheKey: 'lifeboard:feedSources', get: getSources, replace: replaceSources, listen: setSourcesPersistence },
	{ key: 'feedCategories', cacheKey: 'lifeboard:feedCategories', get: getCategories, replace: replaceCategories, listen: setCategoriesPersistence },
	{ key: 'feedWatched', cacheKey: 'lifeboard:feedWatched', get: getWatched, replace: replaceWatched, listen: setWatchedPersistence },
] as const

type VaultKey = (typeof VAULT)[number]['key']

const ITEMS_KEY = 'lifeboard:feedItems'
/** The posts change with every read of every source; a second's delay costs nothing, as they can be read again. */
const ITEMS_WAIT_MS = 1000

const unsentKey = (key: VaultKey) => `lifeboard:feedUnsent:${key}`
/** The vault the cache above is of, once one has answered. */
const VAULT_ID_KEY = 'lifeboard:feedVault'
let itemsTimer: ReturnType<typeof setTimeout> | null = null
/** Which push of each setting is the latest: an older one finishing last must not clear the mark. */
const latest: Partial<Record<VaultKey, number>> = {}

function send(key: VaultKey, value: unknown): void {
	write(unsentKey(key), '1')
	const push = (latest[key] = (latest[key] ?? 0) + 1)
	void pushVaultSetting(key, value).then((taken) => {
		if (taken && latest[key] === push) remove(unsentKey(key))
	})
}

export function loadFeeds(): void {
	for (const store of VAULT) {
		read(store.cacheKey, store.replace)
		store.listen((value) => {
			write(store.cacheKey, JSON.stringify(value))
			send(store.key, value)
		})
	}

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
	for (const store of VAULT) {
		// A push still on its way must not clear a mark made after this.
		latest[store.key] = (latest[store.key] ?? 0) + 1
		remove(store.cacheKey)
		remove(unsentKey(store.key))
		store.replace({})
	}
	if (itemsTimer) clearTimeout(itemsTimer)
	itemsTimer = null
	remove(ITEMS_KEY)
	replaceSourceItems({})
	remove(VAULT_ID_KEY)
}

/**
 * The server vault's copy wins, unless this device has a change it never took: then this device's is
 * sent again. A vault that has none is seeded from this device. `vaultId` is the vault that answered
 * (`null` when not known): a cache of another vault is dropped before any of that happens.
 */
export function applyRemoteFeeds(remote: Partial<Record<VaultKey, unknown>>, vaultId: string | null): void {
	const cachedFor = readRaw(VAULT_ID_KEY)
	if (vaultId && cachedFor !== null && cachedFor !== vaultId) forgetFeeds()
	if (vaultId) write(VAULT_ID_KEY, vaultId)
	for (const store of VAULT) {
		const value = remote[store.key]
		if (value === undefined || unsent(store.key)) {
			send(store.key, store.get())
			continue
		}
		store.replace(value)
		write(store.cacheKey, JSON.stringify(store.get()))
	}
}

const unsent = (key: VaultKey) => readRaw(unsentKey(key)) !== null

function readRaw(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function read(key: string, replace: (raw: unknown) => void): void {
	try {
		const raw = localStorage.getItem(key)
		if (raw) replace(JSON.parse(raw))
	} catch {
		// A malformed cache, or no DOM (vitest imports the composition root): start empty.
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Private-mode Safari can throw on write; the server vault still has what was sent.
	}
}

function remove(key: string): void {
	try {
		localStorage.removeItem(key)
	} catch {
		// As above.
	}
}

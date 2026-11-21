import { pushVaultSetting, type VaultSettingKey } from '../server/serverVault'

/**
 * An extension's data that is the only copy there is, kept as feeds' sources are (DARK-4, made general
 * for DARK-11's rankings and backlogs): written to localStorage and sent to the server vault the
 * moment it changes, never on a timer that a closed tab would cut short.
 *
 * A change the server hasn't taken yet (offline, the tab closed mid-request, no server this session)
 * is marked unsent in localStorage. The next time the vault answers, an unsent copy is sent again
 * rather than replaced by the vault's older one.
 *
 * All of it is one vault's, and a browser can be used by several accounts. The cache remembers which
 * vault it is of; another vault answering, or a log-out, drops it, unsent changes included, so one
 * vault's data is never shown to, or sent into, another.
 */
export interface VaultStore {
	/** The vault setting's key, which the server checks (`apps/server/src/api.ts`). */
	key: VaultSettingKey
	/** Where this device keeps its copy. */
	cacheKey: string
	get: () => unknown
	/** Loads a copy without saving it back. */
	replace: (raw: unknown) => void
	/** Where the store reports a change. */
	listen: (listener: ((value: unknown) => void) | null) => void
}

export interface VaultCache {
	/** Reads this device's copies, then saves every change. */
	load(): void
	/** Drops everything this browser holds of it, unsent changes included, without sending anything. */
	forget(): void
	/**
	 * The server vault's copy wins, unless this device has a change it never took: then this device's
	 * is sent again. A vault that has none is seeded from this device. `vaultId` is the vault that
	 * answered (`null` when not known): a cache of another vault is dropped before any of that happens.
	 */
	applyRemote(remote: Partial<Record<VaultSettingKey, unknown>>, vaultId: string | null): void
}

/** `prefix` names the localStorage marks: `lifeboard:<prefix>Unsent:<key>` and `lifeboard:<prefix>Vault`. */
export function vaultCache(prefix: string, stores: readonly VaultStore[]): VaultCache {
	const unsentKey = (key: string) => `lifeboard:${prefix}Unsent:${key}`
	const vaultIdKey = `lifeboard:${prefix}Vault`
	/** Which push of each setting is the latest: an older one finishing last must not clear the mark. */
	const latest: Record<string, number> = {}

	const send = (key: VaultSettingKey, value: unknown) => {
		write(unsentKey(key), '1')
		const push = (latest[key] = (latest[key] ?? 0) + 1)
		void pushVaultSetting(key, value).then((taken) => {
			if (taken && latest[key] === push) remove(unsentKey(key))
		})
	}

	const forget = () => {
		for (const store of stores) {
			// A push still on its way must not clear a mark made after this.
			latest[store.key] = (latest[store.key] ?? 0) + 1
			remove(store.cacheKey)
			remove(unsentKey(store.key))
			store.replace({})
		}
		remove(vaultIdKey)
	}

	return {
		load() {
			for (const store of stores) {
				read(store.cacheKey, store.replace)
				store.listen((value) => {
					write(store.cacheKey, JSON.stringify(value))
					send(store.key, value)
				})
			}
		},
		forget,
		applyRemote(remote, vaultId) {
			const cachedFor = readRaw(vaultIdKey)
			if (vaultId && cachedFor !== null && cachedFor !== vaultId) forget()
			if (vaultId) write(vaultIdKey, vaultId)
			for (const store of stores) {
				const value = remote[store.key]
				if (value === undefined || readRaw(unsentKey(store.key)) !== null) {
					send(store.key, store.get())
					continue
				}
				store.replace(value)
				write(store.cacheKey, JSON.stringify(store.get()))
			}
		},
	}
}

export function readRaw(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

export function read(key: string, replace: (raw: unknown) => void): void {
	try {
		const raw = localStorage.getItem(key)
		if (raw) replace(JSON.parse(raw))
	} catch {
		// A malformed cache, or no DOM (vitest imports the composition root): start empty.
	}
}

export function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Private-mode Safari can throw on write; the server vault still has what was sent.
	}
}

export function remove(key: string): void {
	try {
		localStorage.removeItem(key)
	} catch {
		// As above.
	}
}

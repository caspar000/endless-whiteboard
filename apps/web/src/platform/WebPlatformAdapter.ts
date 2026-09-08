import { clear, createStore, del, get, keys, set, type UseStore } from 'idb-keyval'
import type {
	BlobStore,
	KvStore,
	PlatformAdapter,
	RawExchangeRates,
	StorageEstimate,
} from './PlatformAdapter'

/**
 * The only MVP implementation of `PlatformAdapter`. Two IndexedDB stores of our own — deliberately
 * separate from the database tldraw manages for canvas documents, so that deleting a board's canvas
 * can never take the board index or a shared blob with it.
 */
const DB_NAME = 'lifeboard'
const BLOB_STORE = 'blobs'
const KV_STORE = 'kv'

async function healthRequest(token: string, path: string, init: RequestInit = {}) {
	let response: Response
	try {
		response = await fetch(`/__lifeboard/health/${path}`, {
			...init,
			headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
			cache: 'no-store', signal: AbortSignal.timeout(path === 'pick-folder' ? 120_000 : 60_000),
		})
	} catch { throw new Error('The local health service is unavailable. Cached readings remain available.') }
	let data: unknown
	try { data = await response.json() } catch { throw new Error('The local health service returned an invalid response.') }
	if (response.status === 401) throw new Error('Enter the service access key to connect. The key is stored only in memory.')
	if (!response.ok) {
		const message = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' ? (data as { error: string }).error : 'The health service could not complete this request.'
		throw new Error(message)
	}
	if (data && typeof data === 'object' && (data as { cancelled?: unknown }).cancelled === true) return null
	const result = data as { snapshot?: unknown; status?: { folder?: unknown; checkedAt?: unknown; files?: unknown; incompatible?: unknown; errors?: unknown; ignored?: unknown } }
	const status = result?.status
	if (!status || !(status.folder === null || typeof status.folder === 'string') || !(status.checkedAt === null || typeof status.checkedAt === 'string') || typeof status.files !== 'number' || typeof status.incompatible !== 'number' ||
		!Array.isArray(status.errors) || !status.errors.every(e => typeof e === 'string') ||
		!Array.isArray(status.ignored) || !status.ignored.every(e => typeof e === 'string')) throw new Error('Invalid health service response.')
	return { snapshot: result.snapshot, status: { folder: status.folder, checkedAt: status.checkedAt, files: status.files, incompatible: status.incompatible, errors: status.errors, ignored: status.ignored } }
}

function idbBlobStore(store: UseStore): BlobStore {
	return {
		async get(hash) {
			return get<Blob>(hash, store)
		},
		async put(hash, blob) {
			// Content-addressed: identical content always yields the same key, so re-putting is a
			// no-op rather than a duplicate. Skipping the write keeps re-import cheap.
			if (await get(hash, store)) return
			await set(hash, blob, store)
		},
		async has(hash) {
			return (await get(hash, store)) !== undefined
		},
		async delete(hash) {
			await del(hash, store)
		},
		async list() {
			return (await keys(store)) as string[]
		},
		async size() {
			let total = 0
			for (const key of (await keys(store)) as string[]) {
				const blob = await get<Blob>(key, store)
				if (blob) total += blob.size
			}
			return total
		},
	}
}

function idbKvStore(store: UseStore): KvStore {
	return {
		async get<T>(key: string) {
			return get<T>(key, store)
		},
		async set<T>(key: string, value: T) {
			await set(key, value, store)
		},
		async delete(key: string) {
			await del(key, store)
		},
		async keys() {
			return (await keys(store)) as string[]
		},
	}
}

export function createWebPlatformAdapter(): PlatformAdapter {
	const blobIdb = createStore(DB_NAME, BLOB_STORE)
	const kvIdb = createStore(`${DB_NAME}-kv`, KV_STORE)

	return {
		blobs: idbBlobStore(blobIdb),
		kv: idbKvStore(kvIdb),

		async saveFile(name, data) {
			const url = URL.createObjectURL(data)
			try {
				const anchor = document.createElement('a')
				anchor.href = url
				anchor.download = name
				anchor.rel = 'noopener'
				document.body.append(anchor)
				anchor.click()
				anchor.remove()
			} finally {
				// Revoking immediately can cancel the download in some browsers, so give the click
				// a turn of the event loop first.
				setTimeout(() => URL.revokeObjectURL(url), 10_000)
			}
		},

		async openFile(accept) {
			return new Promise<Blob | null>((resolve) => {
				const input = document.createElement('input')
				input.type = 'file'
				input.accept = accept.join(',')
				input.style.display = 'none'

				let settled = false
				const finish = (blob: Blob | null) => {
					if (settled) return
					settled = true
					input.remove()
					resolve(blob)
				}

				input.addEventListener('change', () => finish(input.files?.[0] ?? null))
				// `cancel` fires when the user dismisses the picker; without handling it the promise
				// would never settle and the caller's "importing…" state would hang forever.
				input.addEventListener('cancel', () => finish(null))

				document.body.append(input)
				input.click()
			})
		},

		async requestPersistentStorage() {
			if (!navigator.storage?.persist) return false
			if (await navigator.storage.persisted?.()) return true
			try {
				return await navigator.storage.persist()
			} catch {
				return false
			}
		},

		/**
		 * Rates from open.er-api.com — no API key, `access-control-allow-origin: *` so a browser can call
		 * it directly, and 166 currencies including GEL. Most free rate APIs are ECB-derived and carry
		 * only the majors, which would leave the very currency this board is priced in unconvertible.
		 *
		 * `time_next_update_unix` is the provider telling us exactly when the numbers change, which is a
		 * better cache key than a clock of our own: no stale-for-a-day window, and no pointless refetch.
		 *
		 * Never throws. Offline is the expected case for a local-first app, and a total that fails
		 * because the network is down would be worse than one that admits its rates are from Tuesday.
		 */
		async fetchExchangeRates(base: string): Promise<RawExchangeRates | null> {
			try {
				const response = await fetch(
					`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`,
					{ headers: { accept: 'application/json' } }
				)
				if (!response.ok) return null
				const body: unknown = await response.json()
				if (!body || typeof body !== 'object') return null
				const raw = body as {
					result?: unknown
					base_code?: unknown
					rates?: unknown
					time_last_update_unix?: unknown
					time_next_update_unix?: unknown
				}
				if (raw.result !== 'success' || typeof raw.base_code !== 'string') return null
				if (!raw.rates || typeof raw.rates !== 'object') return null

				// Validated rather than trusted: this is third-party JSON, and one NaN in the table would
				// silently poison every total that touches it.
				const rates: Record<string, number> = {}
				for (const [code, value] of Object.entries(raw.rates as Record<string, unknown>)) {
					if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code] = value
				}
				if (!Object.keys(rates).length) return null

				const seconds = (value: unknown, fallback: number) =>
					typeof value === 'number' && Number.isFinite(value) ? value * 1000 : fallback
				const asOf = seconds(raw.time_last_update_unix, Date.now())
				return {
					base: raw.base_code,
					rates,
					asOf,
					// A day on from the last update if the provider didn't say, so a missing field can
					// never mean "cache forever".
					nextUpdate: seconds(raw.time_next_update_unix, asOf + 86_400_000),
				}
			} catch {
				return null
			}
		},

		/**
		 * The generic outbound calls extensions make (see `PlatformAdapter`). Same posture as the
		 * rates call above and for the same reasons: cross-origin, no credentials, and `null` rather
		 * than a throw — an app that works offline cannot treat "no network" as an exception.
		 *
		 * `credentials: 'omit'` is deliberate: these are third-party services an extension chose, and
		 * they have no business receiving cookies from this origin.
		 */
		async fetchExternalJson(url: string): Promise<unknown | null> {
			try {
				const response = await fetch(url, {
					headers: { accept: 'application/json' },
					credentials: 'omit',
				})
				if (!response.ok) return null
				return (await response.json()) as unknown
			} catch {
				return null
			}
		},

		async fetchExternalBlob(url: string): Promise<Blob | null> {
			try {
				const response = await fetch(url, { credentials: 'omit' })
				if (!response.ok) return null
				const blob = await response.blob()
				// A zero-byte body is how some CDNs answer "no such image"; treat it as a miss.
				return blob.size > 0 ? blob : null
			} catch {
				return null
			}
		},

		async estimateStorage(): Promise<StorageEstimate> {
			const persisted = (await navigator.storage?.persisted?.()) ?? false
			if (!navigator.storage?.estimate) return { usage: null, quota: null, persisted }
			try {
				const { usage, quota } = await navigator.storage.estimate()
				return { usage: usage ?? null, quota: quota ?? null, persisted }
			} catch {
				return { usage: null, quota: null, persisted }
			}
		},

		async fetchHealthSnapshot(token) {
			const result = await healthRequest(token, 'snapshot')
			if (!result) throw new Error('Invalid health service response.')
			return result
		},
		async configureHealthFolder(token, folder) {
			const result = await healthRequest(token, 'config', { method: 'PUT', body: JSON.stringify({ folder }) })
			if (!result) throw new Error('No export folder was selected.')
			return result
		},
		pickHealthFolder: token => healthRequest(token, 'pick-folder', { method: 'POST' }),
	}
}

/** Test-only: wipes our own stores. Never wipes tldraw's canvas databases. */
export async function clearWebPlatformStores(): Promise<void> {
	await clear(createStore(DB_NAME, BLOB_STORE))
	await clear(createStore(`${DB_NAME}-kv`, KV_STORE))
}

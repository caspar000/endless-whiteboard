import { clear, createStore, del, get, keys, set, type UseStore } from 'idb-keyval'
import type { BlobStore, KvStore, PlatformAdapter, StorageEstimate } from './PlatformAdapter'

/**
 * The only MVP implementation of `PlatformAdapter`. Two IndexedDB stores of our own — deliberately
 * separate from the database tldraw manages for canvas documents, so that deleting a board's canvas
 * can never take the board index or a shared blob with it.
 */
const DB_NAME = 'lifeboard'
const BLOB_STORE = 'blobs'
const KV_STORE = 'kv'

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
	}
}

/** Test-only: wipes our own stores. Never wipes tldraw's canvas databases. */
export async function clearWebPlatformStores(): Promise<void> {
	await clear(createStore(DB_NAME, BLOB_STORE))
	await clear(createStore(`${DB_NAME}-kv`, KV_STORE))
}

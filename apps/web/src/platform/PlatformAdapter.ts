/**
 * The entire Tauri/Capacitor port surface (§4.5).
 *
 * **Rule enforced by convention and review: no direct IndexedDB or file-API calls outside
 * `platform/` and `persistence/`.** Under Tauri, blobs move to real files or SQLite by writing a
 * `TauriPlatformAdapter` — UI and node code stay untouched.
 */

/** Content-addressed blob storage. Keys are SHA-256 hex digests of the content. */
export interface BlobStore {
	get(hash: string): Promise<Blob | undefined>
	put(hash: string, blob: Blob): Promise<void>
	has(hash: string): Promise<boolean>
	delete(hash: string): Promise<void>
	list(): Promise<string[]>
	/** Total bytes held, for the storage-usage panel. */
	size(): Promise<number>
}

export interface KvStore {
	get<T>(key: string): Promise<T | undefined>
	set<T>(key: string, value: T): Promise<void>
	delete(key: string): Promise<void>
	keys(): Promise<string[]>
}

/**
 * A currency rate payload, as the provider gives it.
 *
 * Behind the adapter because it is the app's only outbound network call, and the Tauri port has its own
 * HTTP stack — the same reason storage lives here. `null` means "could not reach it", which is a normal
 * answer rather than an error: a cached table is used instead and the total says how old it is.
 */
export interface RawExchangeRates {
	base: string
	rates: Record<string, number>
	/** When the provider last recalculated, epoch ms. */
	asOf: number
	/** When the provider says it will change next, epoch ms — what the cache expires on. */
	nextUpdate: number
}

export interface StorageEstimate {
	usage: number | null
	quota: number | null
	persisted: boolean
}

export interface PlatformAdapter {
	blobs: BlobStore
	kv: KvStore
	saveFile(name: string, data: Blob): Promise<void>
	openFile(accept: string[]): Promise<Blob | null>
	/** Ask the browser to make storage durable. Resolves to whether it is now persisted. */
	requestPersistentStorage(): Promise<boolean>
	estimateStorage(): Promise<StorageEstimate>
	/** Latest rates against `base`, or `null` when they can't be reached. Never throws. */
	fetchExchangeRates(base: string): Promise<RawExchangeRates | null>
}

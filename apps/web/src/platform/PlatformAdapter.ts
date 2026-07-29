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
}

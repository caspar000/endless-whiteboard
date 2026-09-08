import type { LinkPreview } from '@lifeboard/link-preview'

/**
 * The entire Tauri/Capacitor port surface (§4.5).
 *
 * **Rule enforced by convention and review: no direct IndexedDB or file-API calls outside
 * `platform/` and `persistence/`.** Under Tauri, blobs move to real files or SQLite by writing a
 * `TauriPlatformAdapter` — UI and node code stay untouched.
 *
 * Payload shapes are declared here rather than imported, so that this file describes the port on its
 * own terms (`RawExchangeRates`, below). `LinkPreview` is the exception: it is defined once in
 * `@lifeboard/link-preview`, a package with no dependencies whatsoever, because the *server* half of
 * that feature has to produce exactly the same shape and a second copy of it would be a second thing
 * to keep in step. A type-only import from a leaf package drags nothing into the bundle.
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
	/**
	 * Generic outbound requests, for extensions that talk to a service the host knows nothing about
	 * (the books extension and Open Library, say). Behind the adapter for the same reason the rates
	 * call is: it is network, and the Tauri port has its own HTTP stack.
	 *
	 * `null` for anything that went wrong — offline, blocked, non-2xx, unparseable. Never throws.
	 */
	fetchExternalJson(url: string): Promise<unknown | null>
	fetchExternalBlob(url: string): Promise<Blob | null>
	/**
	 * What a page says about itself — its title, description and preview image.
	 *
	 * A capability rather than a transport, and the one call here that a browser genuinely *cannot*
	 * make: reading a cross-origin page needs either a server on this origin or a runtime with no
	 * same-origin policy at all. So each platform answers it a different way — the web adapter asks
	 * whoever is serving the app, a native shell would fetch and parse in-process — and `null` means
	 * "nobody here can", which is a normal answer this app already knows how to live with.
	 *
	 * Never throws. Never guesses: an empty field means the page said nothing, and a caller that
	 * invents a value for it puts a broken image on someone's canvas.
	 */
	unfurl(url: string): Promise<LinkPreview | null>
}

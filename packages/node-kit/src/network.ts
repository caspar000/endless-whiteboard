import type { LinkPreview } from '@lifeboard/link-preview'

export type { LinkPreview }

/**
 * The SDK's view of the outside world (§4.5).
 *
 * Extensions must not call `fetch` any more than they may call IndexedDB: outbound requests are a
 * platform capability, and the Tauri port has its own HTTP stack. This is the same shape of seam as
 * `AssetBridge` — the app installs a transport, the extension supplies the URLs and makes sense of
 * what comes back.
 *
 * Deliberately *transport only*. Nothing here knows what a book is; the domain — which service,
 * which fields, how to validate them — belongs to the extension asking.
 */
export interface NetworkBridge {
	/**
	 * Parsed JSON, or `null` for anything that went wrong: offline, blocked, non-2xx, unparseable.
	 * Never throws. A lookup that cannot reach the network is a normal answer in a local-first app,
	 * not an error state to propagate.
	 */
	getJson(url: string): Promise<unknown | null>
	/** Raw bytes — an image, typically — or `null`. Never throws, for the same reason. */
	getBlob(url: string): Promise<Blob | null>
	/**
	 * What a page says about itself. The exception to "transport only", and it has to be.
	 *
	 * An extension cannot build this out of `getJson`: a browser is not allowed to read another
	 * origin's HTML at all, so the work happens wherever the app is served from and only the host
	 * knows where that is. What comes back is still not domain knowledge — a title, a description,
	 * an image URL, for any page — so the seam stays as thin as the two above.
	 *
	 * `null` when nobody can answer (static hosting, offline, an unreadable page). An empty *field*
	 * is different: it means the page itself said nothing, and it must be shown as nothing rather
	 * than filled in with a guess.
	 */
	unfurl(url: string): Promise<LinkPreview | null>
}

let bridge: NetworkBridge | null = null

/** Installed once by the app's composition root, before any board mounts. */
export function setNetworkBridge(next: NetworkBridge): void {
	bridge = next
}

/**
 * The installed transport, or `null` when the host has not provided one.
 *
 * Nullable on purpose, unlike `getAssetBridge`: a host may legitimately ship without network access
 * (a locked-down build, a test), and an extension that reaches the outside world has to be able to
 * degrade — its feature is unavailable, not broken.
 */
export function getNetworkBridge(): NetworkBridge | null {
	return bridge
}

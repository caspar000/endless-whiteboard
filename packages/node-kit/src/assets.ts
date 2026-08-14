import { useEffect, useState } from 'react'

/**
 * The SDK's view of the app's blob storage (§4.5).
 *
 * Node-kit and extensions must not touch storage APIs — that belongs behind the app's
 * `PlatformAdapter`. But a node that owns binary content (a book's file, its cover render) still has
 * to put bytes somewhere and get them back. This bridge is that seam: the app implements it over its
 * content-addressed blob store and installs it at startup; extensions see only `asset:<hash>` srcs,
 * the same currency the asset store already uses for images.
 *
 * Deliberately tiny. Anything more (deletion, listing) stays app-side, because blobs are shared by
 * content across boards and reclaimed only by the app's mark-and-sweep GC.
 */
export interface AssetBridge {
	/** Stores the blob content-addressed and returns its `asset:<sha256>` src. Idempotent by content. */
	store(blob: Blob): Promise<string>
	/** A displayable URL for an `asset:` src, or null if the blob is gone. Cached app-side. */
	resolveUrl(src: string): Promise<string | null>
	/** The raw bytes for an `asset:` src — for consumers that parse rather than display (a reader). */
	getBlob(src: string): Promise<Blob | null>
}

let bridge: AssetBridge | null = null

/** Installed once by the app's composition root, before any board mounts. */
export function setAssetBridge(next: AssetBridge): void {
	bridge = next
}

export function getAssetBridge(): AssetBridge {
	if (!bridge) {
		throw new Error('AssetBridge not installed — the app must call setAssetBridge() at startup')
	}
	return bridge
}

/**
 * Resolves an `asset:` src to a displayable URL, for node components.
 *
 * Returns null while resolving and for missing blobs alike — a component treats both as "no image
 * yet", which is also what it must render for the brief window before a first resolve lands.
 */
export function useAssetUrl(src: string): string | null {
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		if (!src) {
			setUrl(null)
			return
		}
		let cancelled = false
		void getAssetBridge()
			.resolveUrl(src)
			.then((resolved) => {
				if (!cancelled) setUrl(resolved)
			})
		return () => {
			cancelled = true
		}
	}, [src])
	return src ? url : null
}

import type { TLAsset, TLAssetStore } from 'tldraw'
import type { BlobStore } from '../platform/PlatformAdapter'
import { downscaleImage } from './downscale'
import { sha256Hex } from './hash'

/**
 * Custom `TLAssetStore` over our content-addressed `BlobStore` (§4.4).
 *
 * The point of existing: tldraw's default behaviour inlines pasted images as base64 data URLs
 * inside the document. That bloats every snapshot, makes export enormous, and would break CRDT
 * sync later — so images are externalised from day one.
 *
 * `src` is stored as `asset:<sha256>`. That URL form is stable, portable across boards, and
 * survives export/import untouched, because the hash *is* the identity of the bytes.
 */
export const ASSET_URL_PREFIX = 'asset:'

export function isManagedAssetSrc(src: string | null | undefined): src is string {
	return typeof src === 'string' && src.startsWith(ASSET_URL_PREFIX)
}

export function hashFromAssetSrc(src: string): string {
	return src.slice(ASSET_URL_PREFIX.length)
}

export function assetSrcForHash(hash: string): string {
	return `${ASSET_URL_PREFIX}${hash}`
}

/**
 * Object URLs are cached per hash and never revoked for the lifetime of the page: a revoked URL
 * would break every `<img>` still pointing at it, and the alternative (refcounting across shapes,
 * duplicates and undo history) is a memory-safety problem we would get wrong. The cache holds one
 * entry per *distinct image on screen*, which is bounded by board size.
 */
const objectUrlCache = new Map<string, string>()

/**
 * Upload bookkeeping: how many are running, when the last one finished, and who is waiting.
 *
 * This exists because of a sharp edge in tldraw: dropping files creates the `asset` record
 * immediately with `src: ''` and then fires the upload as a **floating promise** that
 * `putExternalContent` never awaits (`defaultHandleExternalContent`, the `Promise.allSettled` around
 * `editor.updateAssets`). So `await editor.putExternalContent(…)` resolves while the image is still
 * being downscaled and hashed, and the store is briefly in a state where the shape points at an
 * asset that has no source yet.
 *
 * Unmounting the editor in that window loses the real `src` permanently — the shape keeps rendering
 * blank, with the bytes sitting in the blob store unreachable. Module-level (like `objectUrlCache`
 * above) because it is a property of the page, not of any one board: uploads outlive the board that
 * started them, which is exactly the problem.
 */
let uploadsInFlight = 0
let lastUploadFinishedAt = 0
const uploadWaiters = new Set<() => void>()

/** True while an image is still being downscaled, hashed or stored. */
export function hasPendingAssetUploads(): boolean {
	return uploadsInFlight > 0
}

/**
 * When an upload last did something that will write to the editor's store, or 0 if none ever has.
 * A running upload reports *now*, so it always reads as ongoing.
 *
 * The board drain needs the *timestamp*, not a boolean: finishing an upload triggers tldraw's
 * `updateAssets`, and that write is throttled. A drain that only asked "is anything running?" would
 * see nothing at a tick 190ms after an upload finished, unmount, and discard the `src`.
 */
export function assetUploadActivityAt(): number {
	return uploadsInFlight > 0 ? Date.now() : lastUploadFinishedAt
}

/**
 * Resolves once no upload is running, or after `timeoutMs` — whichever comes first.
 *
 * Bounded on purpose: anything that waits on this (backup export, asset GC) must still make progress
 * if an upload is wedged. The timeout is not a correctness assumption, because both callers are
 * separately conservative about asset records that still have no `src`.
 */
export function waitForAssetUploads(timeoutMs = 10_000): Promise<void> {
	if (uploadsInFlight === 0) return Promise.resolve()
	return new Promise((resolve) => {
		const settle = () => {
			clearTimeout(timer)
			uploadWaiters.delete(settle)
			resolve()
		}
		const timer = setTimeout(settle, timeoutMs)
		uploadWaiters.add(settle)
	})
}

export function createLifeboardAssetStore(blobs: BlobStore): TLAssetStore {
	return {
		async upload(_asset: TLAsset, file: File) {
			uploadsInFlight++
			try {
				// Downscale first, then hash: the hash must identify what we actually store, so that
				// re-pasting the same photo dedupes against the stored (downscaled) blob.
				const { blob } = await downscaleImage(file)
				const hash = await sha256Hex(blob)
				await blobs.put(hash, blob)
				return { src: assetSrcForHash(hash) }
			} finally {
				uploadsInFlight--
				lastUploadFinishedAt = Date.now()
				if (uploadsInFlight === 0) {
					for (const waiter of uploadWaiters) waiter()
					uploadWaiters.clear()
				}
			}
		},

		async resolve(asset: TLAsset) {
			const src = 'src' in asset.props ? asset.props.src : null
			if (!src) return null
			// Assets that aren't ours (e.g. a bookmark's remote image) pass through untouched.
			if (!isManagedAssetSrc(src)) return src

			const hash = hashFromAssetSrc(src)
			const cached = objectUrlCache.get(hash)
			if (cached) return cached

			const blob = await blobs.get(hash)
			if (!blob) return null

			// A concurrent resolve for the same hash may have populated the cache while we awaited.
			const raced = objectUrlCache.get(hash)
			if (raced) return raced

			const url = URL.createObjectURL(blob)
			objectUrlCache.set(hash, url)
			return url
		},

		// `remove` is intentionally not implemented. Blobs are shared by content across boards,
		// duplicates and undo history, so deleting on shape-delete would corrupt a board whenever
		// the same image appears twice, or whenever the deletion is undone. Reclamation happens
		// through explicit mark-and-sweep GC instead — see `collectGarbageAssets`.
	}
}

/**
 * Mark-and-sweep asset GC. Called after a board is deleted, with the set of hashes still referenced
 * by *all remaining* boards. Sweeping only what nothing references makes this safe to run at any
 * time and idempotent if interrupted.
 */
export async function collectGarbageAssets(
	blobs: BlobStore,
	referencedHashes: ReadonlySet<string>
): Promise<{ deleted: number }> {
	let deleted = 0
	for (const hash of await blobs.list()) {
		if (referencedHashes.has(hash)) continue
		await blobs.delete(hash)
		objectUrlCache.delete(hash)
		deleted++
	}
	return { deleted }
}

/** Test seam: drops cached object URLs so a fresh resolve re-reads from the blob store. */
export function clearAssetUrlCache(): void {
	for (const url of objectUrlCache.values()) URL.revokeObjectURL(url)
	objectUrlCache.clear()
}

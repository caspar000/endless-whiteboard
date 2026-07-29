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

export function createLifeboardAssetStore(blobs: BlobStore): TLAssetStore {
	return {
		async upload(_asset: TLAsset, file: File) {
			// Downscale first, then hash: the hash must identify what we actually store, so that
			// re-pasting the same photo dedupes against the stored (downscaled) blob.
			const { blob } = await downscaleImage(file)
			const hash = await sha256Hex(blob)
			await blobs.put(hash, blob)
			return { src: assetSrcForHash(hash) }
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

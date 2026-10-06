import type { AssetBridge } from '@lifeboard/node-kit'
import { sanitizeSvg, type TLAsset, type TLAssetContext, type TLAssetStore } from '@lifeboard/canvas'
import type { BlobStore } from '../platform/PlatformAdapter'
import { downscaleImage } from './downscale'
import { sha256Hex } from './hash'
import { assetSrcForHash, hashFromAssetSrc, isManagedAssetSrc } from '@lifeboard/schema'

export { ASSET_URL_PREFIX, assetSrcForHash, hashFromAssetSrc, isManagedAssetSrc } from '@lifeboard/schema'

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

/**
 * Where a blob this browser lacks can come from: the server vault, for a board synced from another
 * device. Returns `null` when there is nowhere to ask.
 */
export type FetchMissingBlob = (hash: string) => Promise<Blob | null>

/** The local blob, or the server's copy saved locally on the way through. */
async function getOrFetchBlob(blobs: BlobStore, hash: string, fetchMissing?: FetchMissingBlob): Promise<Blob | null> {
	const local = await blobs.get(hash)
	if (local || !fetchMissing) return local ?? null
	const fetched = await fetchMissing(hash)
	if (fetched) await blobs.put(hash, fetched)
	return fetched
}

/** Blob → cached object URL, shared by tldraw's asset resolve and the extension bridge below. */
async function resolveHashToUrl(
	blobs: BlobStore,
	hash: string,
	fetchMissing?: FetchMissingBlob
): Promise<string | null> {
	const cached = objectUrlCache.get(hash)
	if (cached) return cached

	const blob = await getOrFetchBlob(blobs, hash, fetchMissing)
	if (!blob) return null

	// A concurrent resolve for the same hash may have populated the cache while we awaited.
	const raced = objectUrlCache.get(hash)
	if (raced) return raced

	const url = URL.createObjectURL(blob)
	objectUrlCache.set(hash, url)
	return url
}

/**
 * The `AssetBridge` node-kit hands to extensions (see node-kit's `assets.ts`) — same blob store,
 * same content addressing and object-URL cache as the tldraw asset path above, minus the image
 * downscale: what comes through here is opaque binary (a book file, a rendered cover) that must be
 * stored byte-for-byte.
 *
 * `store` is awaited by its callers *before* they create the shape that references the hash, so
 * unlike tldraw's floating uploads there is no pending window for the drain or GC to worry about.
 */
export function createAssetBridge(blobs: BlobStore, fetchMissing?: FetchMissingBlob): AssetBridge {
	return {
		async store(blob: Blob) {
			const hash = await sha256Hex(blob)
			await blobs.put(hash, blob)
			return assetSrcForHash(hash)
		},
		async resolveUrl(src: string) {
			if (!isManagedAssetSrc(src)) return null
			return resolveHashToUrl(blobs, hashFromAssetSrc(src), fetchMissing)
		},
		async getBlob(src: string) {
			if (!isManagedAssetSrc(src)) return null
			return getOrFetchBlob(blobs, hashFromAssetSrc(src), fetchMissing)
		},
	}
}

export function createLifeboardAssetStore(blobs: BlobStore, fetchMissing?: FetchMissingBlob): TLAssetStore {
	return {
		async upload(_asset: TLAsset, file: File) {
			uploadsInFlight++
			try {
				// Downscale first, then hash: the hash must identify what we actually store, so that
				// re-pasting the same photo dedupes against the stored (downscaled) blob. An SVG is
				// cleaned of anything that could run first (sanitizeSvg); one that isn't an SVG is refused.
				const { blob } = await downscaleImage(await cleanSvg(file))
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

		async resolve(asset: TLAsset, context?: TLAssetContext) {
			const src = 'src' in asset.props ? asset.props.src : null
			if (!src) return null
			// Assets that aren't ours (e.g. a bookmark's remote image) pass through untouched.
			if (!isManagedAssetSrc(src)) return src
			const hash = hashFromAssetSrc(src)
			const original = await resolveHashToUrl(blobs, hash, fetchMissing)
			const width = scaledWidth(asset, context)
			if (!original || !width) return original
			return (await scaledUrl(blobs, hash, width, fetchMissing)) ?? original
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
	for (const pending of scaledCache.values()) void pending.then((url) => url && URL.revokeObjectURL(url))
	scaledCache.clear()
}

/**
 * The width to draw a picture at for how large it is on screen (docs/fork-parity.md P6), or `null`
 * for the picture itself: one drawn at or above its own size, one being exported, and pictures that
 * scale themselves or move (SVG, animated GIF). The editor steps the scale in powers of two, so a
 * picture has at most a few sizes, not one per zoom level.
 */
function scaledWidth(asset: TLAsset, context: TLAssetContext | undefined): number | null {
	if (!context || context.shouldResolveToOriginal || asset.type !== 'image') return null
	const { w, mimeType, isAnimated } = asset.props
	if (!w || isAnimated || mimeType === 'image/svg+xml' || mimeType === 'image/gif') return null
	const scale = context.steppedScreenScale * context.dpr
	if (scale >= 1) return null
	return Math.max(MIN_SCALED_WIDTH, Math.round(w * scale))
}

/** No smaller than this: below it, decoding the full picture once costs less than another copy. */
const MIN_SCALED_WIDTH = 64

/** Smaller copies of pictures, by hash and width, made once and kept for the session. */
const scaledCache = new Map<string, Promise<string | null>>()

function scaledUrl(blobs: BlobStore, hash: string, width: number, fetchMissing?: FetchMissingBlob) {
	const key = `${hash}@${width}`
	let pending = scaledCache.get(key)
	if (!pending) {
		pending = (async () => {
			const blob = await getOrFetchBlob(blobs, hash, fetchMissing)
			if (!blob) return null
			try {
				const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeQuality: 'high' })
				const canvas = document.createElement('canvas')
				canvas.width = bitmap.width
				canvas.height = bitmap.height
				canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
				bitmap.close()
				const scaled = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9))
				return scaled ? URL.createObjectURL(scaled) : null
			} catch {
				// A picture the browser can't scale is shown as it is.
				return null
			}
		})()
		scaledCache.set(key, pending)
	}
	return pending
}

/** An SVG file without scripts, handlers or outside links; anything else as it came. */
async function cleanSvg(file: File): Promise<File> {
	if (file.type !== 'image/svg+xml' && !file.name.toLowerCase().endsWith('.svg')) return file
	const clean = sanitizeSvg(await file.text())
	if (clean === null) throw new Error(`“${file.name}” is not an SVG picture.`)
	return new File([clean], file.name, { type: 'image/svg+xml' })
}

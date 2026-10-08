/**
 * A board refers to stored bytes (images, book files, covers) as `asset:<sha256>`. That form is stable,
 * portable across boards and vaults, and survives export and import untouched, because the hash *is*
 * the identity of the bytes.
 */
export const ASSET_URL_PREFIX = 'asset:'

/**
 * The whole form, not just the prefix: tldraw's own asset *record ids* also start with `asset:`
 * (an image shape's `assetId` is `asset:2038128137`), and the reference walk below reads every string
 * in a shape's props. Matching the prefix alone counted those ids as blobs.
 */
const MANAGED_SRC = /^asset:[0-9a-f]{64}$/

export function isManagedAssetSrc(src: string | null | undefined): src is string {
	return typeof src === 'string' && MANAGED_SRC.test(src)
}

export function hashFromAssetSrc(src: string): string {
	return src.slice(ASSET_URL_PREFIX.length)
}

export function assetSrcForHash(hash: string): string {
	return `${ASSET_URL_PREFIX}${hash}`
}

export interface AssetRefs {
	/** Blob hashes this board definitely references. */
	hashes: Set<string>
	/**
	 * True if the snapshot holds an `asset` record with an empty `src`.
	 *
	 * tldraw creates the record before the upload finishes (see `hasPendingAssetUploads`), so this
	 * means "a blob is about to be referenced and we cannot yet say which". GC must abstain rather
	 * than treat the board as referencing nothing — otherwise it deletes the very blob being written.
	 */
	pending: boolean
}

/**
 * Walks a raw board snapshot for the blob hashes it references. Used by backup export (to know
 * which blobs to pack) and by asset GC (to know which blobs are still reachable) — in the app and on
 * the server, which is why it lives here.
 *
 * Works on the untyped snapshot rather than typed records on purpose: it must stay correct for
 * snapshots written by an older app version, whose records may not match today's types.
 */
export function collectAssetRefs(snapshot: { store: Record<string, unknown> }): AssetRefs {
	const hashes = new Set<string>()
	let pending = false
	for (const record of Object.values(snapshot.store)) {
		if (!record || typeof record !== 'object') continue
		const rec = record as { typeName?: unknown; props?: unknown }
		if (rec.typeName === 'asset') {
			const props = rec.props
			if (!props || typeof props !== 'object') continue
			const src = (props as { src?: unknown }).src
			if (typeof src === 'string' && isManagedAssetSrc(src)) {
				hashes.add(hashFromAssetSrc(src))
			} else if (!src) {
				// Empty or missing `src`: either an upload that hasn't landed yet, or one that was lost
				// when the board unmounted mid-upload. Both mean "unknown", never "nothing".
				pending = true
			}
			// A non-empty foreign `src` (a bookmark's remote image, say) references no blob of ours.
			// A link card's preview picture and icon can be kept as blobs of ours, though: boards brought
			// over from Freeform carry theirs (apps/freeform-import).
			for (const key of ['image', 'favicon']) {
				const kept = (props as Record<string, unknown>)[key]
				if (typeof kept === 'string' && isManagedAssetSrc(kept)) hashes.add(hashFromAssetSrc(kept))
			}
		} else if (rec.typeName === 'shape') {
			// Extension nodes hold `asset:` srcs in their own props (a book's file and cover) rather
			// than in asset records — those blobs are stored *before* the shape is created (see
			// `createAssetBridge`), so a shape reference is never pending.
			collectSrcStrings(rec.props, hashes)
		}
	}
	return { hashes, pending }
}

/** Walks an untyped JSON value for `asset:` src strings, depth-first. */
function collectSrcStrings(value: unknown, hashes: Set<string>): void {
	if (typeof value === 'string') {
		if (isManagedAssetSrc(value)) hashes.add(hashFromAssetSrc(value))
		return
	}
	if (!value || typeof value !== 'object') return
	for (const entry of Array.isArray(value) ? value : Object.values(value)) {
		collectSrcStrings(entry, hashes)
	}
}

/** The hashes only — for callers that have no use for the pending signal. */
export function collectAssetHashes(snapshot: { store: Record<string, unknown> }): Set<string> {
	return collectAssetRefs(snapshot).hashes
}

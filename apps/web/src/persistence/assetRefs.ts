import { hashFromAssetSrc, isManagedAssetSrc } from './assetStore'
import type { RawBoardSnapshot } from './tldrawLocalDb'

/**
 * Walks a raw board snapshot for the blob hashes it references. Used by backup export (to know
 * which blobs to pack) and by asset GC (to know which blobs are still reachable).
 *
 * Works on the untyped snapshot rather than typed records on purpose: it must stay correct for
 * snapshots written by an older app version, whose records may not match today's types.
 */
export function collectAssetHashes(snapshot: RawBoardSnapshot): Set<string> {
	const hashes = new Set<string>()
	for (const record of Object.values(snapshot.store)) {
		if (!record || typeof record !== 'object') continue
		const rec = record as { typeName?: unknown; props?: unknown }
		if (rec.typeName !== 'asset') continue
		const props = rec.props
		if (!props || typeof props !== 'object') continue
		const src = (props as { src?: unknown }).src
		if (typeof src === 'string' && isManagedAssetSrc(src)) hashes.add(hashFromAssetSrc(src))
	}
	return hashes
}

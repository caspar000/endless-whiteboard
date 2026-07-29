import type { PlatformAdapter } from '../platform/PlatformAdapter'
import { collectAssetHashes } from '../persistence/assetRefs'
import { collectGarbageAssets } from '../persistence/assetStore'
import { clearPendingRestore } from '../persistence/pendingRestore'
import { deleteBoardThumbnail } from '../persistence/thumbnails'
import { deleteTldrawDocument, readBoardSnapshot } from '../persistence/tldrawLocalDb'
import { listBoards, removeBoardFromIndex } from './boardIndex'

/**
 * Deleting a board touches four separate stores, and the *order* matters (§4.4).
 *
 * The index entry goes first so the board disappears from the UI immediately and an interrupted
 * delete can never leave a listed-but-gone board. Asset GC goes last and is computed from the
 * boards that *remain*, so a photo shared with another board is never collected.
 */
export async function deleteBoard(platform: PlatformAdapter, boardId: string): Promise<void> {
	await removeBoardFromIndex(platform.kv, boardId)
	await clearPendingRestore(platform.kv, boardId)
	await deleteBoardThumbnail(platform.kv, boardId)

	const { deleted } = await deleteTldrawDocument(boardId)
	if (!deleted) {
		// The index entry is already gone, so the board is out of the UI either way — but the canvas
		// data is still on disk, which is worth saying out loud rather than pretending otherwise.
		// The usual cause is another tab holding the same board open.
		console.warn(
			`Lifeboard: removed board ${boardId} from the index, but its canvas data could not be deleted (is it open in another tab?).`
		)
	}

	// Mark: every hash still reachable from a surviving board. Sweep: everything else.
	const referenced = new Set<string>()
	for (const board of await listBoards(platform.kv)) {
		const snapshot = await readBoardSnapshot(board.id)
		if (!snapshot) continue
		for (const hash of collectAssetHashes(snapshot)) referenced.add(hash)
	}
	await collectGarbageAssets(platform.blobs, referenced)
}

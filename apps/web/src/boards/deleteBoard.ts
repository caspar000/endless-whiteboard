import type { PlatformAdapter } from '../platform/PlatformAdapter'
import { collectAssetRefs } from '../persistence/assetRefs'
import { collectGarbageAssets, waitForAssetUploads } from '../persistence/assetStore'
import { clearPendingRestore } from '../persistence/pendingRestore'
import { deleteBoardThumbnail } from '../persistence/thumbnails'
import {
	deleteTldrawDocument,
	readBoardSnapshotResult,
	waitForPersistFlush,
} from '../persistence/tldrawLocalDb'
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

	await collectUnreferencedAssets(platform)
}

/**
 * Mark-and-sweep over the blob store: mark every hash reachable from a surviving board, sweep the rest.
 *
 * **Conservative by construction, because the failure mode is silent data loss.** Three things bit here,
 * all variants of "the snapshot on disk is not yet the truth":
 *
 * 1. An upload still running means a blob has been written but no `asset` record points at it yet —
 *    tldraw creates that record with `src: ''` and fills it in later. Waiting for uploads to settle,
 *    then for tldraw's write throttle, is what makes the snapshot worth reading at all.
 * 2. A board whose database can't be read tells us *nothing* about what it references. Treating that as
 *    "references nothing" is what turns a locked database into deleted images.
 * 3. A surviving `src: ''` after all that waiting means an upload was lost mid-flight. The blob is real
 *    and orphaned, but we cannot tell it apart from a blob that is genuinely unreachable — so leave it.
 *
 * Cases 2 and 3 abstain from the sweep entirely. Skipping a sweep leaves an orphaned blob until the
 * next delete, which costs disk; getting it wrong destroys a photo. The asymmetry decides the design.
 */
async function collectUnreferencedAssets(platform: PlatformAdapter): Promise<void> {
	await waitForAssetUploads()
	await waitForPersistFlush()

	const referenced = new Set<string>()
	for (const board of await listBoards(platform.kv)) {
		const result = await readBoardSnapshotResult(board.id)

		if (result.status === 'unreadable') {
			console.warn(
				`Lifeboard: skipping unused-image cleanup because board "${board.name}" could not be read. Nothing was deleted.`
			)
			return
		}
		// 'absent' is a definite answer: the board has no canvas data, so it references nothing.
		if (result.status === 'absent') continue

		const refs = collectAssetRefs(result.snapshot)
		if (refs.pending) {
			console.warn(
				`Lifeboard: skipping unused-image cleanup because board "${board.name}" has an image whose upload did not finish. Nothing was deleted.`
			)
			return
		}
		for (const hash of refs.hashes) referenced.add(hash)
	}

	await collectGarbageAssets(platform.blobs, referenced)
}

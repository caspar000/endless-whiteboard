import { collectAssetRefs, createBoardSchema } from '@lifeboard/schema'
import { createTLStore, loadSnapshot, type Editor, type TLStoreSnapshot } from '@lifeboard/canvas'
import { waitForAssetUploads } from '../persistence/assetStore'
import { clearPendingRestore, setPendingRestore, takePendingRestore } from '../persistence/pendingRestore'
import {
	deleteTldrawDocument,
	readBoardSnapshotResult,
	waitForPersistFlush,
	type RawBoardSnapshot,
} from '../persistence/tldrawLocalDb'
import { loadBoardThumbnail, storeBoardThumbnail } from '../persistence/thumbnails'
import type { PlatformAdapter } from '../platform/PlatformAdapter'
import {
	createServerBoard,
	deleteServerBoard,
	fetchServerAsset,
	fetchServerThumbnail,
	missingServerAssets,
	readServerBoard,
	serverHasBoard,
	uploadServerAsset,
	uploadServerThumbnail,
} from '../server/serverVault'
import { addBoard, getBoard, removeBoardFromIndex, type BoardMeta } from './boardIndex'

/**
 * Moving a board between this browser and the server vault. Both directions keep the board's id, so
 * open tabs, thumbnails and links follow it, and both write the destination in full — records and
 * files — before touching the source. A move that fails partway leaves the board where it was.
 */

/** The board as it is now: from its open editor if it has one, else from disk or a pending import. */
async function readLocalBoard(platform: PlatformAdapter, board: BoardMeta, editor?: Editor): Promise<RawBoardSnapshot> {
	await waitForAssetUploads()
	if (editor) return editor.store.getStoreSnapshot('document') as unknown as RawBoardSnapshot
	await waitForPersistFlush()
	const result = await readBoardSnapshotResult(board.id)
	if (result.status === 'ok') return result.snapshot
	if (result.status === 'unreadable') throw new Error(`“${board.name}” could not be read. Is it open in another tab?`)
	// Never opened: either an import still waiting for its first open, or a genuinely empty board.
	return (await takePendingRestore(platform.kv, board.id)) ?? { store: {}, schema: null }
}

/**
 * Brought up to today's schema here rather than on the server: the store migrations (retired node
 * types and the like) run on load, and the server stores what it is given.
 */
function migrate(snapshot: RawBoardSnapshot): TLStoreSnapshot {
	const store = createTLStore({ schema: createBoardSchema() })
	if (snapshot.schema) loadSnapshot(store, snapshot as unknown as TLStoreSnapshot)
	return store.getStoreSnapshot('document')
}

/** Where a move has got to, for the progress the board list and sidebar show. */
export type MoveStage = 'files' | 'board' | 'finishing'
export type MoveProgress = (stage: MoveStage, filesDone?: number, filesTotal?: number) => void

/**
 * Safe to run again after an interruption (a reload, a dropped connection): a board the server
 * already has is not sent twice, and files the server has are skipped. The local copy goes only once
 * the server has the board.
 */
export async function moveBoardToServer(
	platform: PlatformAdapter,
	board: BoardMeta,
	editor: Editor | undefined,
	progress: MoveProgress = () => {}
): Promise<void> {
	if (!(await serverHasBoard(board.id))) {
		const snapshot = migrate(await readLocalBoard(platform, board, editor))

		// The files first: a board that arrives before its images shows holes on every other device.
		const hashes = [...collectAssetRefs(snapshot as unknown as RawBoardSnapshot).hashes]
		const missing = hashes.length ? await missingServerAssets(hashes) : []
		progress('files', 0, missing.length)
		for (const [i, hash] of missing.entries()) {
			const blob = await platform.blobs.get(hash)
			// A damaged file holds up nothing: the board moves, and this device keeps its copy.
			if (blob && !(await uploadServerAsset(hash, blob))) {
				console.warn(`Lifeboard: the server refused a damaged file of “${board.name}” (${hash}).`)
			}
			progress('files', i + 1, missing.length)
		}

		progress('board')
		// A board never opened has no records worth sending; the server makes it an empty board.
		const content = Object.keys(snapshot.store).length ? snapshot : undefined
		await createServerBoard(board.name, board.id, {
			snapshot: content,
			favorite: board.favorite === true,
			createdAt: board.createdAt,
			updatedAt: board.updatedAt,
		})
		// The preview goes with it, so the card has a picture on every device straight away.
		const thumbnail = await loadBoardThumbnail(platform.kv, board.id)
		if (thumbnail) await uploadServerThumbnail(board.id, thumbnail)
	}

	progress('finishing')
	await removeBoardFromIndex(platform.kv, board.id)
	await clearPendingRestore(platform.kv, board.id)
	// The blobs stay: this browser's store is now the server board's cache.
	void deleteTldrawDocument(board.id)
}

/** Safe to run again, like `moveBoardToServer`: the server copy goes only once this device has the board. */
export async function moveBoardToDevice(
	platform: PlatformAdapter,
	board: BoardMeta,
	progress: MoveProgress = () => {}
): Promise<void> {
	if (!(await getBoard(platform.kv, board.id))) {
		const snapshot = await readServerBoard(board.id)

		// Every file must be here before the server copy goes, or the board loses its pictures.
		const hashes = [...collectAssetRefs(snapshot).hashes]
		progress('files', 0, hashes.length)
		for (const [i, hash] of hashes.entries()) {
			if (!(await platform.blobs.has(hash))) {
				const blob = await fetchServerAsset(hash)
				if (!blob) throw new Error(`“${board.name}” uses a file the server could not send, so it was left on the server.`)
				await platform.blobs.put(hash, blob)
			}
			progress('files', i + 1, hashes.length)
		}

		progress('board')
		// Loaded on first open, like an imported backup (persistence/pendingRestore.ts).
		if (Object.keys(snapshot.store).length) await setPendingRestore(platform.kv, board.id, snapshot)
		const thumbnail = await fetchServerThumbnail(board.id)
		if (thumbnail) await storeBoardThumbnail(platform.kv, board.id, thumbnail)
		await addBoard(platform.kv, {
			id: board.id,
			name: board.name,
			createdAt: board.createdAt,
			updatedAt: board.updatedAt,
			...(board.favorite ? { favorite: true } : {}),
		})
	}

	progress('finishing')
	if (await serverHasBoard(board.id)) await deleteServerBoard(board.id)
}

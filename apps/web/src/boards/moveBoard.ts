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
import type { PlatformAdapter } from '../platform/PlatformAdapter'
import {
	createServerBoard,
	deleteServerBoard,
	fetchServerAsset,
	missingServerAssets,
	readServerBoard,
	uploadServerAsset,
} from '../server/serverVault'
import { addBoard, removeBoardFromIndex, type BoardMeta } from './boardIndex'

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

export async function moveBoardToServer(platform: PlatformAdapter, board: BoardMeta, editor?: Editor): Promise<void> {
	const snapshot = migrate(await readLocalBoard(platform, board, editor))

	// The files first: a board that arrives before its images shows holes on every other device.
	const hashes = [...collectAssetRefs(snapshot as unknown as RawBoardSnapshot).hashes]
	for (const hash of hashes.length ? await missingServerAssets(hashes) : []) {
		const blob = await platform.blobs.get(hash)
		if (blob) await uploadServerAsset(hash, blob)
	}

	// A board never opened has no records worth sending; the server makes it an empty board.
	const content = Object.keys(snapshot.store).length ? snapshot : undefined
	await createServerBoard(board.name, board.id, { snapshot: content, favorite: board.favorite === true })

	await removeBoardFromIndex(platform.kv, board.id)
	await clearPendingRestore(platform.kv, board.id)
	// The blobs stay: this browser's store is now the server board's cache.
	void deleteTldrawDocument(board.id)
}

export async function moveBoardToDevice(platform: PlatformAdapter, board: BoardMeta): Promise<void> {
	const snapshot = await readServerBoard(board.id)

	// Every file must be here before the server copy goes, or the board loses its pictures.
	for (const hash of collectAssetRefs(snapshot).hashes) {
		if (await platform.blobs.has(hash)) continue
		const blob = await fetchServerAsset(hash)
		if (!blob) throw new Error(`“${board.name}” uses a file the server could not send, so it was left on the server.`)
		await platform.blobs.put(hash, blob)
	}

	// Loaded on first open, like an imported backup (persistence/pendingRestore.ts).
	if (Object.keys(snapshot.store).length) await setPendingRestore(platform.kv, board.id, snapshot)
	await addBoard(platform.kv, {
		id: board.id,
		name: board.name,
		createdAt: board.createdAt,
		updatedAt: board.updatedAt,
		...(board.favorite ? { favorite: true } : {}),
	})
	await deleteServerBoard(board.id)
}

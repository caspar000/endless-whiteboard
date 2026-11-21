import type { Editor, TLRecord, TLStore } from '@lifeboard/canvas'
import type { KvStore } from '../platform/PlatformAdapter'
import { UNTITLED_BOARD, type BoardMeta } from './boardIndex'

/**
 * Boards made with "New board" that nothing has been done to yet (DARK-12). Leaving one deletes it
 * (`deleteIfUntouched`, called from app/App.tsx), so trying "New board" and walking away doesn't leave
 * an empty board behind.
 *
 * A board is untouched from its making until the first thing done to it: a rename, a new colour or
 * icon (app/useBoards.ts), or a change to its content (`watchUntouchedBoard`). Untouched is never
 * earned back, so a board edited and then undone back to empty stays. Only the plain untitled board is
 * ever marked: a board made as a kind, the demo board, an import or an agent's board arrives with
 * something in it or a name someone chose, and a board made before this existed is never marked.
 *
 * Kept in this device's store rather than in memory, so a reload on an untouched board doesn't turn it
 * into a kept one. One key per board, so every window of the app sees the same marks and a mark set
 * for one board can never write back another's that a second window cleared: each change is one
 * write to its own key, which the store makes whole. Other devices never have the mark: a board is
 * only ever deleted by the device that made it, and a server board only if the server agrees.
 */
const key = (boardId: string) => `untouched:${boardId}`

export function markUntouched(kv: KvStore, boardId: string): Promise<void> {
	return kv.set(key(boardId), true)
}

/** Something was done to the board, or it is gone: leaving it no longer deletes it. */
export function forgetUntouched(kv: KvStore, boardId: string): Promise<void> {
	return kv.delete(key(boardId))
}

export async function isUntouched(kv: KvStore, boardId: string): Promise<boolean> {
	return (await kv.get<boolean>(key(boardId))) === true
}

/**
 * The records that are a board's content, whoever made them: what is drawn on it, its files, and the
 * comments people left on it. The server keeps the same list.
 */
const CONTENT = new Set<string>(['shape', 'binding', 'asset', 'comment-thread', 'comment', 'comment-reaction'])

type Changes = Parameters<Parameters<TLStore['listen']>[0]>[0]['changes']

function changesContent(changes: Changes): boolean {
	return [changes.added, changes.updated, changes.removed].some((records) =>
		Object.values(records).some((record) => CONTENT.has(Array.isArray(record) ? record[1].typeName : record.typeName))
	)
}

/** Whether there is anything on the board: what no automatic delete may ever take. */
export function hasContent(editor: Pick<Editor, 'store'>): boolean {
	return editor.store.allRecords().some((record) => CONTENT.has(record.typeName))
}

/** The same, of a board's records as stored. */
export function snapshotHasContent(store: Record<string, unknown>): boolean {
	return Object.values(store).some((record) => CONTENT.has((record as Partial<TLRecord> | null)?.typeName ?? ''))
}

/**
 * Forgets the board as untouched on the first change to its content. Any change made in this page
 * counts (the user's, an agent's), and so does anything another device or member does to the board's
 * shapes, bindings, files or comments and sync brings here. What sync brings as the board opens is the board's
 * records, not content, on a board nothing was done to. Camera and selection are no edit.
 */
export function watchUntouchedBoard(editor: Pick<Editor, 'store'>, boardId: string, kv: KvStore): () => void {
	let stopped = false
	const stop = () => {
		if (stopped) return
		stopped = true
		unlisten()
	}
	const unlisten = editor.store.listen(
		({ changes, source }) => {
			if (source === 'remote' && !changesContent(changes)) return
			stop()
			void forgetUntouched(kv, boardId)
		},
		{ scope: 'document', source: 'all' }
	)
	// Most boards were never marked: they need no listener.
	void isUntouched(kv, boardId).then((untouched) => {
		if (!untouched) stop()
	})
	return stop
}

export interface LeftBoard {
	kv: KvStore
	/**
	 * Whether the board has nothing on it, as this page can tell now: from its editor while that is
	 * mounted, otherwise from what is stored. Throws when it can't tell, which keeps the board.
	 */
	isEmpty(): Promise<boolean>
	/** The board as it is now: from the server, for a server board, so a rename elsewhere is seen. */
	current(): Promise<BoardMeta | undefined>
	/**
	 * Deletes the board, resolving whether it went. A server board goes only if the server, which has
	 * every device's edits, finds it untouched as it deletes it.
	 */
	remove(): Promise<boolean>
}

/**
 * Deletes a board just left if it is still untouched (DARK-12). Each check stands between the mark and
 * a delete nobody asked for: the mark itself, nothing on the board, and the name and look it was made
 * with, read afresh. The mark and the board are looked at again after every wait, since an edit can
 * arrive during one. Whatever can't be checked keeps the board. Resolves whether it was deleted.
 */
export async function deleteIfUntouched(boardId: string, left: LeftBoard): Promise<boolean> {
	/** `undefined` when it couldn't be told: kept, and still marked for the next time it is left. */
	const stillUntouched = async (): Promise<boolean | undefined> => {
		if (!(await isUntouched(left.kv, boardId))) return false
		try {
			return await left.isEmpty()
		} catch {
			return undefined
		}
	}
	const untouched = await stillUntouched()
	if (untouched !== true) {
		if (untouched === false) await forgetUntouched(left.kv, boardId)
		return false
	}
	let board: BoardMeta | undefined
	try {
		board = await left.current()
	} catch {
		return false
	}
	// A board called anything else was renamed, here or elsewhere.
	if (!board || board.name !== UNTITLED_BOARD || board.color || board.icon) {
		await forgetUntouched(left.kv, boardId)
		return false
	}
	// Again: something may have been done to it while the board was being read.
	const stillSo = await stillUntouched()
	if (stillSo !== true) {
		if (stillSo === false) await forgetUntouched(left.kv, boardId)
		return false
	}
	const deleted = await left.remove()
	await forgetUntouched(left.kv, boardId)
	return deleted
}

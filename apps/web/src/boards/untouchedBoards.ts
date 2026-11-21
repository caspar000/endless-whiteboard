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
 * into a kept one, and read afresh each time, so two windows of the app agree. Other devices never
 * have the mark: a board is only ever deleted by the device that made it.
 */
const KEY = 'untouchedBoards'

/** Each store's last pending change to the list, so the next one starts from what it wrote. */
const pending = new WeakMap<KvStore, Promise<unknown>>()

async function read(kv: KvStore): Promise<string[]> {
	const ids = await kv.get<unknown>(KEY)
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/** One change at a time, as the board index does (boardIndex.ts `updateBoards`). */
function update(kv: KvStore, change: (ids: string[]) => string[]): Promise<void> {
	const run = (pending.get(kv) ?? Promise.resolve()).then(async () => {
		const ids = await read(kv)
		const next = change(ids)
		if (next.length !== ids.length || next.some((id, i) => id !== ids[i])) await kv.set(KEY, next)
	})
	pending.set(kv, run.catch(() => {}))
	return run
}

export function markUntouched(kv: KvStore, boardId: string): Promise<void> {
	return update(kv, (ids) => (ids.includes(boardId) ? ids : [...ids, boardId]))
}

/** Something was done to the board, or it is gone: leaving it no longer deletes it. */
export function forgetUntouched(kv: KvStore, boardId: string): Promise<void> {
	return update(kv, (ids) => ids.filter((id) => id !== boardId))
}

export async function isUntouched(kv: KvStore, boardId: string): Promise<boolean> {
	await pending.get(kv)
	return (await read(kv)).includes(boardId)
}

/** The records that are a board's content, whoever made them. */
const CONTENT = new Set<TLRecord['typeName']>(['shape', 'binding', 'asset'])

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

/**
 * Forgets the board as untouched on the first change to its content. Any change made in this page
 * counts (the user's, an agent's), and so does anything another device or member does to the board's
 * shapes, bindings or files and sync brings here. What sync brings as the board opens is the board's
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
	/** The board's editor, if it is still mounted. */
	editor: Pick<Editor, 'store'> | null
	/** The board as it is now: from the server, for a server board, so a rename elsewhere is seen. */
	current(): Promise<BoardMeta | undefined>
	/** Deletes the board, as the Delete button does. */
	remove(): Promise<void>
}

/**
 * Deletes a board just left if it is still untouched (DARK-12). Each check stands between the mark and
 * a delete nobody asked for: the mark itself, nothing on the board, and the name and look it was made
 * with, read afresh. Whatever can't be checked keeps the board. Returns whether it was deleted.
 */
export async function deleteIfUntouched(boardId: string, left: LeftBoard): Promise<boolean> {
	if (!(await isUntouched(left.kv, boardId))) return false
	if (left.editor && hasContent(left.editor)) {
		await forgetUntouched(left.kv, boardId)
		return false
	}
	let board: BoardMeta | undefined
	try {
		board = await left.current()
	} catch {
		// Not reachable: kept, and still untouched, for the next time it is left.
		return false
	}
	// A board called anything else was renamed, here or elsewhere.
	if (!board || board.name !== UNTITLED_BOARD || board.color || board.icon) {
		await forgetUntouched(left.kv, boardId)
		return false
	}
	await left.remove()
	await forgetUntouched(left.kv, boardId)
	return true
}

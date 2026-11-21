import { describe, expect, it } from 'vitest'
import {
	createShapeId,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	PageRecordType,
	type IndexKey,
	type TLShape,
	type TLStore,
} from '@lifeboard/canvas'
import type { KvStore } from '../platform/PlatformAdapter'
import type { BoardMeta } from './boardIndex'
import { deleteIfUntouched, forgetUntouched, isUntouched, markUntouched, watchUntouchedBoard } from './untouchedBoards'

const PAGE = PageRecordType.createId('page')

/** Store listeners are called on the next flush, not inside the change. */
const settle = (board: TLStore) => board._flushHistory()

/**
 * A board as it is once open: its page and document records are there, and behind it, as the editor's
 * are by the time the watcher starts.
 */
function openBoard(): TLStore {
	const board = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })
	board.put([PageRecordType.create({ id: PAGE, name: 'Page 1', index: 'a1' as IndexKey })])
	// Merging, even nothing, makes the store complete itself with the records every board has.
	board.mergeRemoteChanges(() => {})
	settle(board)
	return board
}

/** A shape (a group: the one with no props to fill in), which is what the board's items are. */
const shape = (): TLShape =>
	({
		id: createShapeId(),
		typeName: 'shape',
		type: 'group',
		parentId: PAGE,
		index: 'a1' as IndexKey,
		x: 0,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		props: {},
		meta: {},
	}) as TLShape

/** This device's store, in memory. */
function memoryKv(): KvStore {
	const values = new Map<string, unknown>()
	return {
		get: async <T,>(key: string) => values.get(key) as T | undefined,
		set: async (key, value) => void values.set(key, value),
		delete: async (key) => void values.delete(key),
		keys: async () => [...values.keys()],
	}
}

const untitled = (id: string, patch: Partial<BoardMeta> = {}): BoardMeta => ({
	id,
	name: 'Untitled board',
	createdAt: 1,
	updatedAt: 1,
	...patch,
})

/** A board made with "New board" and opened: marked, with its editor's store watched. */
async function newBoard(id: string, kv = memoryKv()) {
	await markUntouched(kv, id)
	const store = openBoard()
	const stop = watchUntouchedBoard({ store }, id, kv)
	// The watcher asks whether the board is marked before it decides to keep listening.
	await isUntouched(kv, id)
	return { kv, store, stop }
}

/** Leaves the board: what App.tsx does when the board on screen changes away from it. */
async function leave(
	id: string,
	{ kv, store }: { kv: KvStore; store: TLStore | null },
	current: () => Promise<BoardMeta | undefined> = async () => untitled(id)
) {
	const removed: string[] = []
	const deleted = await deleteIfUntouched(id, {
		kv,
		editor: store && { store },
		current,
		remove: async () => void removed.push(id),
	})
	expect(deleted).toBe(removed.length === 1)
	return deleted
}

describe('leaving an untitled board', () => {
	it('deletes it when nothing was done to it', async () => {
		const board = await newBoard('a')
		expect(await leave('a', board)).toBe(true)
		expect(await isUntouched(board.kv, 'a')).toBe(false)
	})

	it('deletes it after a reload too: the mark is kept on this device', async () => {
		const { kv, stop } = await newBoard('b')
		stop()
		// The page reloads: a new editor over the same board, and nothing done to it.
		const store = openBoard()
		watchUntouchedBoard({ store }, 'b', kv)
		await isUntouched(kv, 'b')
		expect(await leave('b', { kv, store })).toBe(true)
	})

	it('keeps it once it was renamed, even with nothing on it', async () => {
		const board = await newBoard('c')
		// A rename forgets the mark (useBoards.ts), whatever the name.
		await forgetUntouched(board.kv, 'c')
		expect(await leave('c', board, async () => untitled('c', { name: 'Gym plan' }))).toBe(false)
	})

	it('keeps it when it was renamed on another device', async () => {
		const board = await newBoard('d')
		expect(await leave('d', board, async () => untitled('d', { name: 'Gym plan', vault: 'server' }))).toBe(false)
		expect(await isUntouched(board.kv, 'd')).toBe(false)
	})

	it('keeps it when it was given a colour or an icon', async () => {
		const board = await newBoard('e')
		expect(await leave('e', board, async () => untitled('e', { icon: 'dumbbell' }))).toBe(false)
	})

	it('keeps it once something was put on it', async () => {
		const board = await newBoard('f')
		board.store.put([shape()])
		settle(board.store)
		expect(await leave('f', board)).toBe(false)
	})

	it('keeps it when what was put on it was changed and taken off again', async () => {
		const board = await newBoard('g')
		const item = shape()
		board.store.put([item])
		settle(board.store)
		board.store.put([{ ...item, x: 100 }])
		board.store.remove([item.id])
		settle(board.store)
		expect(board.store.get(item.id)).toBeUndefined()
		expect(await leave('g', board)).toBe(false)
	})

	it('keeps it when another device put something on it, and sync brought it here', async () => {
		const board = await newBoard('h')
		const item = shape()
		board.store.mergeRemoteChanges(() => board.store.put([item]))
		settle(board.store)
		// Taken away again over there: the board is empty, and still edited.
		board.store.mergeRemoteChanges(() => board.store.remove([item.id]))
		settle(board.store)
		expect(await leave('h', board)).toBe(false)
	})

	it('still deletes it when sync brought only the board itself', async () => {
		const board = await newBoard('i')
		board.store.mergeRemoteChanges(() => {
			const page = board.store.get(PAGE)!
			board.store.put([{ ...page, name: 'Page one' }])
		})
		settle(board.store)
		expect(board.store.get(PAGE)!.name).toBe('Page one')
		expect(await leave('i', board)).toBe(true)
	})

	it('keeps a board with anything on it, however it got there', async () => {
		const kv = memoryKv()
		await markUntouched(kv, 'j')
		// Content the watcher never saw: it was there before the board opened here.
		const store = openBoard()
		store.put([shape()])
		settle(store)
		expect(await leave('j', { kv, store })).toBe(false)
	})

	it('keeps it, still untouched, when the server can not be asked', async () => {
		const board = await newBoard('k')
		const offline = async (): Promise<BoardMeta | undefined> => {
			throw new Error('offline')
		}
		expect(await leave('k', board, offline)).toBe(false)
		expect(await isUntouched(board.kv, 'k')).toBe(true)
	})

	it('leaves a board that was never marked alone', async () => {
		expect(await leave('l', { kv: memoryKv(), store: openBoard() })).toBe(false)
	})
})

import { describe, expect, it } from 'vitest'
import type { KvStore } from '../platform/PlatformAdapter'
import { addBoard, isBoardColor, listBoards, removeBoardFromIndex, touchBoard, withLook, type BoardMeta } from './boardIndex'

const board: BoardMeta = { id: 'b', name: 'Gym', createdAt: 1, updatedAt: 2 }

describe('withLook', () => {
	it('sets, keeps and clears a colour and an icon', () => {
		const styled = withLook(board, { color: '#e5484d', icon: 'dumbbell' })
		expect(styled).toEqual({ ...board, color: '#e5484d', icon: 'dumbbell' })
		// A missing key leaves that half alone; null takes it off rather than storing null.
		expect(withLook(styled, { icon: 'bike' })).toEqual({ ...board, color: '#e5484d', icon: 'bike' })
		expect(withLook(styled, { color: null })).toEqual({ ...board, icon: 'dumbbell' })
		expect('color' in withLook(styled, { color: null })).toBe(false)
	})

	it('is not an edit', () => {
		expect(withLook(board, { color: '#e5484d' }).updatedAt).toBe(board.updatedAt)
	})
})

describe('isBoardColor', () => {
	it('takes #rrggbb and nothing else', () => {
		expect(isBoardColor('#30A46C')).toBe(true)
		for (const bad of ['red', '#fff', 'url(x)', '#30A46C; x', null, 3]) expect(isBoardColor(bad)).toBe(false)
	})
})

/** An in-memory store whose every read and write takes a turn of the event loop, like IndexedDB. */
function slowKv(): KvStore {
	const data = new Map<string, unknown>()
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
	return {
		get: async <T>(key: string) => (await tick(), structuredClone(data.get(key)) as T | undefined),
		set: async (key, value) => void (await tick(), data.set(key, structuredClone(value))),
		delete: async (key) => void (await tick(), data.delete(key)),
		keys: async () => [...data.keys()],
	}
}

describe('the board index', () => {
	it('keeps a deleted board deleted when an unmounting editor touches it at the same moment', async () => {
		// Deleting an open board closes its tab, and the editor's unmount records its last edit while the
		// delete runs. Each reads the whole index and writes it back.
		for (const removeFirst of [false, true]) {
			const kv = slowKv()
			await addBoard(kv, { ...board, id: 'keep', name: 'Keep' })
			await addBoard(kv, { ...board, id: 'bin', name: 'Bin' })
			const remove = () => removeBoardFromIndex(kv, 'bin')
			const touch = () => touchBoard(kv, 'bin')
			await Promise.all(removeFirst ? [remove(), touch()] : [touch(), remove()])
			expect((await listBoards(kv)).map((b) => b.id)).toEqual(['keep'])
		}
	})
})

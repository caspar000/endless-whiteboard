import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KvStore, PlatformAdapter } from '../platform/PlatformAdapter'
import type { BoardMeta } from './boardIndex'

const moveBoardToServer = vi.fn()
const moveBoardToDevice = vi.fn()
vi.mock('./moveBoard', () => ({ moveBoardToServer, moveBoardToDevice }))

/** The queue keeps its state in the module, so each test loads a fresh copy, as a reload would. */
const load = () => import('./moveQueue')

function memoryKv(store = new Map<string, unknown>()): KvStore {
	return {
		async get<T>(key: string) {
			return store.get(key) as T | undefined
		},
		async set<T>(key: string, value: T) {
			store.set(key, value)
		},
		async delete(key: string) {
			store.delete(key)
		},
		async keys() {
			return [...store.keys()]
		},
	}
}

const board = (id: string, vault?: 'server'): BoardMeta => ({
	id,
	name: id,
	createdAt: 0,
	updatedAt: 0,
	...(vault ? { vault } : {}),
})

function runner(kv: KvStore) {
	const onMoved = vi.fn(async () => {})
	return { platform: { kv } as unknown as PlatformAdapter, editorFor: () => undefined, onMoved }
}

/** Resolves once the queue has nothing left to run. */
async function settle(queue: Awaited<ReturnType<typeof load>>) {
	await vi.waitFor(() => expect(queue.getMoves().every((job) => job.error)).toBe(true))
}

beforeEach(() => {
	vi.resetModules()
	moveBoardToServer.mockReset().mockResolvedValue(undefined)
	moveBoardToDevice.mockReset().mockResolvedValue(undefined)
})

describe('move queue', () => {
	it('moves each board to the side it is not on, in order', async () => {
		const queue = await load()
		const kv = memoryKv()
		const { platform, editorFor, onMoved } = runner(kv)
		await queue.startMoves({ platform, editorFor, onMoved })
		await queue.queueMoves(kv, [board('a'), board('b', 'server')])
		await settle(queue)

		expect(moveBoardToServer.mock.calls.map((call) => call[1].id)).toEqual(['a'])
		expect(moveBoardToDevice.mock.calls.map((call) => call[1].id)).toEqual(['b'])
		expect(queue.getMoves()).toEqual([])
		expect(queue.getMoveBatch()).toEqual({ done: 0, total: 0 })
		expect(await kv.get('moves')).toEqual([])
		expect(onMoved).toHaveBeenCalledTimes(2)
	})

	it('picks up after a reload, starting a cut-off move again', async () => {
		const store = new Map<string, unknown>()
		const kv = memoryKv(store)
		store.set('moves', [
			{ board: board('a'), to: 'server', stage: 'files', filesDone: 3, filesTotal: 9 },
			{ board: board('b'), to: 'server', stage: 'waiting', filesDone: 0, filesTotal: 0 },
		])
		store.set('movesBatch', 5)

		const queue = await load()
		let release!: () => void
		moveBoardToServer.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
		const { platform, editorFor, onMoved } = runner(kv)
		await queue.startMoves({ platform, editorFor, onMoved })

		// Three of five went before the reload; the first left is under way again.
		expect(queue.getMoveBatch()).toEqual({ done: 3, total: 5 })
		await vi.waitFor(() => expect(moveBoardToServer).toHaveBeenCalledOnce())
		expect(queue.moveFor('a')?.stage).toBe('starting')
		release()
		await settle(queue)
		expect(moveBoardToServer.mock.calls.map((call) => call[1].id)).toEqual(['a', 'b'])
	})

	it('keeps a failed move for Retry and goes on with the rest', async () => {
		const queue = await load()
		const kv = memoryKv()
		const { platform, editorFor, onMoved } = runner(kv)
		moveBoardToServer.mockRejectedValueOnce(new Error('offline'))
		await queue.startMoves({ platform, editorFor, onMoved })
		await queue.queueMoves(kv, [board('a'), board('b')])
		await settle(queue)

		expect(queue.getMoves()).toMatchObject([{ board: { id: 'a' }, error: 'offline' }])
		expect(moveBoardToServer).toHaveBeenCalledTimes(2)

		await queue.retryMove(kv, 'a')
		await settle(queue)
		expect(queue.getMoves()).toEqual([])
		expect(moveBoardToServer).toHaveBeenCalledTimes(3)
	})

	it('leaves a board already queued alone, and forgets a dismissed one', async () => {
		const queue = await load()
		const kv = memoryKv()
		const { platform, editorFor, onMoved } = runner(kv)
		moveBoardToServer.mockRejectedValue(new Error('offline'))
		await queue.startMoves({ platform, editorFor, onMoved })
		await queue.queueMoves(kv, [board('a')])
		await settle(queue)
		await queue.queueMoves(kv, [board('a')])
		expect(queue.getMoves()).toHaveLength(1)

		await queue.dismissMove(kv, 'a')
		expect(queue.getMoves()).toEqual([])
		expect(await kv.get('moves')).toEqual([])
	})
})

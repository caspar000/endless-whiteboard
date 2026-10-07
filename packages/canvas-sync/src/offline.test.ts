import { createShapeId, type TLFrameShape, type TLRecord } from '@tldraw/tlschema'
import { describe, expect, it } from 'vitest'
import { MemorySyncCache } from './cache.ts'
import { SyncClient } from './SyncClient.ts'
import { connect, documentOf, frame, newRoom, newStore, schema, settle, shapeOf, TestSocket } from './test/harness.ts'
import type { SyncRoom } from './SyncRoom.ts'

/** Server boards kept on the device (docs/fork-parity.md S5). */

/** A client that keeps its board in `cache`, and a socket that starts online or not. */
function device(room: SyncRoom<TLRecord>, cache: MemorySyncCache<TLRecord>, online = true) {
	const store = newStore()
	const socket = new TestSocket(room)
	socket.online = online
	const client = new SyncClient({ store, socket, pushDelayMs: 0, saveDelayMs: 0, cache })
	return { store, socket, client }
}

/** Waits for the cache to be read and for saves to land. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

const name = (peer: { store: ReturnType<typeof newStore> }, id: string) =>
	(peer.store.get(createShapeId(id)) as TLFrameShape | undefined)?.props.name

describe('a board kept on this device', () => {
	it('opens from the device with no server, and keeps offline edits across reloads until it can send them', async () => {
		const room = newRoom()
		const cache = new MemorySyncCache<TLRecord>()
		const other = connect(room)

		// Online once: the board arrives and is kept.
		const first = device(room, cache)
		await tick()
		await settle(first, other)
		first.store.put([frame('a')])
		await settle(first, other)
		await tick()
		expect(cache.records.has(createShapeId('a'))).toBe(true)
		expect(cache.state?.since).toBeDefined()
		first.client.dispose()

		// A reload with no connection: the board opens from the device.
		const offline = device(room, cache, false)
		await tick()
		expect(offline.client.getStatus()).toEqual({ status: 'synced', online: false, unsent: 0, refused: 0 })
		expect(name(offline, 'a')).toBe('a')

		offline.store.update(createShapeId('a'), (shape) => ({ ...shape, x: 50 }))
		offline.store.put([frame('b')])
		offline.store._flushHistory()
		await tick()
		expect(offline.client.getStatus()).toMatchObject({ unsent: 2 })
		offline.client.dispose()

		// Meanwhile someone else renames the same shape.
		other.store.update(createShapeId('a'), (shape) => {
			const framed = shape as TLFrameShape
			return { ...framed, props: { ...framed.props, name: 'renamed' } }
		})
		await settle(other)

		// Another reload, still offline: the edits are still there, still unsent.
		const again = device(room, cache, false)
		await tick()
		expect(shapeOf(again, 'a')!.x).toBe(50)
		expect(name(again, 'b')).toBe('b')
		expect(again.client.getStatus()).toMatchObject({ online: false, unsent: 2 })

		// Back online: both edits go up, the other device's rename comes down, and they agree.
		again.socket.online = true
		again.socket.open()
		await settle(again, other)
		await tick()
		expect(again.client.getStatus()).toEqual({ status: 'synced', online: true, unsent: 0, refused: 0 })
		expect(shapeOf(other, 'a')).toMatchObject({ x: 50, props: { name: 'renamed' } })
		expect(name(other, 'b')).toBe('b')
		expect(documentOf(again)).toEqual(documentOf(other))
		expect(documentOf(again)).toEqual(room.getSnapshot().store)
		// And the device's copy has caught up with the server.
		expect(cache.state!.base).toEqual([])
		expect((cache.records.get(createShapeId('a')) as TLFrameShape).props.name).toBe('renamed')
	})

	it('keeps what was made offline when the server has started its history again', async () => {
		const room = newRoom()
		const cache = new MemorySyncCache<TLRecord>()
		const first = device(room, cache)
		await tick()
		await settle(first)
		first.client.dispose()

		const offline = device(room, cache, false)
		await tick()
		offline.store.put([frame('made-offline')])
		offline.store._flushHistory()
		await tick()
		offline.client.dispose()

		// A new epoch: the device's clock means nothing to the server any more.
		room.close()
		const fresh = newRoom()
		const back = device(fresh, cache)
		await tick()
		await settle(back)
		expect(name(back, 'made-offline')).toBe('made-offline')
		expect(fresh.getSnapshot().store[createShapeId('made-offline')]).toBeDefined()
	})

	it('ignores a copy saved by a newer app', async () => {
		const room = newRoom()
		const cache = new MemorySyncCache<TLRecord>()
		cache.state = {
			schema: { ...schema.serialize(), sequences: { ...('sequences' in schema.serialize() ? schema.serialize().sequences : {}), 'com.example.future': 3 } },
			base: [],
		}
		cache.records.set(createShapeId('future'), frame('future'))
		const peer = device(room, cache, false)
		await tick()
		expect(peer.client.getStatus()).toEqual({ status: 'loading' })
		expect(shapeOf(peer, 'future')).toBeUndefined()
	})
})

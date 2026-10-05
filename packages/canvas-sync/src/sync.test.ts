import { createShapeId, type TLFrameShape, type TLRecord } from '@tldraw/tlschema'
import { describe, expect, it } from 'vitest'
import { applyOp, compareSchemas, opBetween, PROTOCOL_VERSION } from './protocol.ts'
import { SyncClient, type ClientSocket } from './SyncClient.ts'
import {
	connect,
	documentOf,
	frame,
	MemoryStorage,
	newRoom,
	newStore,
	schema,
	settle,
	shapeOf,
	TestSocket,
} from './test/harness.ts'

describe('record ops', () => {
	const a = frame('a')

	it('patch only the fields that changed, one level into props and meta', () => {
		const b = { ...a, x: 5, props: { ...a.props, w: 300 } }
		expect(opBetween(a, b)).toEqual({ op: 'patch', patch: { fields: { x: 5 }, props: { w: 300 } } })
		expect(applyOp(a, opBetween(a, b)!)).toEqual(b)
	})

	it('send a record whole when a key went away, and say nothing when nothing changed', () => {
		const withMeta = { ...a, meta: { note: 'hi' } }
		expect(opBetween(withMeta, a)).toEqual({ op: 'patch', patch: { fields: { meta: {} } } })
		expect(opBetween(a, { ...a })).toBeNull()
		expect(opBetween(null, a)).toEqual({ op: 'put', record: a })
		expect(opBetween(a, null)).toEqual({ op: 'remove' })
	})

	it('leave a removed record removed when a patch arrives for it', () => {
		expect(applyOp(null, { op: 'patch', patch: { fields: { x: 1 } } })).toBeNull()
	})

	it('compare schemas by their migration sequences', () => {
		const ours = { schemaVersion: 2 as const, sequences: { a: 2, b: 1 } }
		expect(compareSchemas(ours, { schemaVersion: 2, sequences: { a: 2, b: 1 } })).toBe('same')
		expect(compareSchemas(ours, { schemaVersion: 2, sequences: { a: 1, b: 1 } })).toBe('behind')
		expect(compareSchemas(ours, { schemaVersion: 2, sequences: { a: 2 } })).toBe('behind')
		expect(compareSchemas(ours, { schemaVersion: 2, sequences: { a: 3, b: 0 } })).toBe('ahead')
		expect(compareSchemas(ours, { schemaVersion: 2, sequences: { a: 2, b: 1, c: 0 } })).toBe('ahead')
	})
})

describe('two clients', () => {
	it('see each other’s edits', async () => {
		const room = newRoom()
		const a = connect(room)
		const b = connect(room)
		await settle(a, b)
		expect(a.client.getStatus()).toEqual({ status: 'synced', online: true })

		a.store.put([frame('one')])
		await settle(a, b)
		expect(shapeOf(b, 'one')).toMatchObject({ props: { name: 'one' } })

		b.store.update(createShapeId('one'), (shape) => ({ ...shape, x: 40 }))
		await settle(a, b)
		expect(shapeOf(a, 'one')!.x).toBe(40)

		a.store.remove([createShapeId('one')])
		await settle(a, b)
		expect(shapeOf(b, 'one')).toBeUndefined()
		expect(documentOf(a)).toEqual(documentOf(b))
	})

	it('both keep their edits to different fields of one shape made at the same time', async () => {
		const room = newRoom()
		const a = connect(room)
		const b = connect(room)
		a.store.put([frame('shared')])
		await settle(a, b)

		const id = createShapeId('shared')
		a.store.update(id, (shape) => ({ ...shape, x: 10 }))
		b.store.update(id, (shape) => ({ ...(shape as TLFrameShape), props: { ...(shape as TLFrameShape).props, w: 250 } }))
		await settle(a, b)

		expect(shapeOf(a, 'shared')).toMatchObject({ x: 10, props: { w: 250 } })
		expect(documentOf(a)).toEqual(documentOf(b))
	})

	it('agree on the server’s order when both change the same field', async () => {
		const room = newRoom()
		const a = connect(room)
		const b = connect(room)
		a.store.put([frame('contested')])
		await settle(a, b)

		const id = createShapeId('contested')
		a.store.update(id, (shape) => ({ ...shape, x: 1 }))
		b.store.update(id, (shape) => ({ ...shape, x: 2 }))
		// Both pushes reach the server before either client hears anything: a's first, so b's wins.
		await new Promise((resolve) => setTimeout(resolve, 5))
		a.store._flushHistory()
		b.store._flushHistory()
		await new Promise((resolve) => setTimeout(resolve, 5))
		a.socket.deliverToServer()
		b.socket.deliverToServer()
		await settle(a, b)

		expect(shapeOf(a, 'contested')!.x).toBe(2)
		expect(shapeOf(b, 'contested')!.x).toBe(2)
	})

	it('keep an unsent local edit over a change that arrives first', async () => {
		const room = newRoom()
		const a = connect(room)
		const b = connect(room)
		a.store.put([frame('rebased')])
		await settle(a, b)
		const id = createShapeId('rebased')

		b.store.update(id, (shape) => ({ ...shape, y: 99 }))
		await new Promise((resolve) => setTimeout(resolve, 5))
		b.store._flushHistory()
		await new Promise((resolve) => setTimeout(resolve, 5))
		b.socket.deliverToServer()

		// a edits before hearing b's change, then hears it.
		a.store.update(id, (shape) => ({ ...shape, x: 7 }))
		a.socket.deliverToClient()
		expect(shapeOf(a, 'rebased')).toMatchObject({ x: 7, y: 99 })

		await settle(a, b)
		expect(shapeOf(b, 'rebased')).toMatchObject({ x: 7, y: 99 })
		expect(documentOf(a)).toEqual(documentOf(b))
	})
})

describe('a refused push', () => {
	it('is taken back by the client that made it', async () => {
		// A scripted server that accepts the connection and refuses every push.
		const sent: string[] = []
		let handlers: Parameters<ClientSocket['start']>[0] | undefined
		const socket: ClientSocket = {
			start: (h) => {
				handlers = h
				h.open()
			},
			send: (data) => sent.push(data),
			reconnect: () => {},
			stop: () => {},
		}
		const store = newStore()
		const client = new SyncClient({ store, socket, pushDelayMs: 0 })
		const room = newRoom()
		handlers!.message(
			JSON.stringify({
				type: 'connected',
				protocol: PROTOCOL_VERSION,
				epoch: 'e',
				clock: 0,
				full: true,
				diff: Object.fromEntries(Object.entries(room.getSnapshot().store).map(([id, record]) => [id, { op: 'put', record }])),
			})
		)
		expect(client.getStatus()).toEqual({ status: 'synced', online: true })

		store.put([frame('refused')])
		await new Promise((resolve) => setTimeout(resolve, 20))
		store._flushHistory()
		await new Promise((resolve) => setTimeout(resolve, 5))
		const push = JSON.parse(sent.at(-1)!)
		expect(push.type).toBe('push')
		handlers!.message(JSON.stringify({ type: 'pushResult', pushId: push.pushId, clock: 0, action: 'discard' }))
		expect(store.get(createShapeId('refused'))).toBeUndefined()
	})

	it('changes nothing on the server and reaches no one', async () => {
		const room = newRoom()
		const b = connect(room)
		await settle(b)
		const replies: string[] = []
		const session = room.join({ send: (data) => replies.push(data), close: () => {} })
		session.receive(JSON.stringify({ type: 'connect', protocol: PROTOCOL_VERSION, schema: schema.serialize() }))
		const bad = { ...frame('bad'), props: { w: -1, h: 1, name: 'bad', color: 'black' } }
		const good = frame('good')
		session.receive(
			JSON.stringify({
				type: 'push',
				pushId: 1,
				diff: { [good.id]: { op: 'put', record: good }, [bad.id]: { op: 'put', record: bad } },
			})
		)
		expect(JSON.parse(replies.at(-1)!)).toMatchObject({ type: 'pushResult', pushId: 1, action: 'discard' })
		expect(room.getSnapshot().store[good.id]).toBeUndefined()
		await settle(b)
		expect(shapeOf(b, 'good')).toBeUndefined()
	})

	it('is refused for records that are not the document’s, or that change type', () => {
		const room = newRoom()
		const replies: Array<{ action?: string }> = []
		const session = room.join({ send: (data) => replies.push(JSON.parse(data)), close: () => {} })
		session.receive(JSON.stringify({ type: 'connect', protocol: PROTOCOL_VERSION, schema: schema.serialize() }))
		const camera = { id: 'camera:x', typeName: 'camera', x: 0, y: 0, z: 1, meta: {} }
		session.receive(JSON.stringify({ type: 'push', pushId: 1, diff: { [camera.id]: { op: 'put', record: camera } } }))
		session.receive(
			JSON.stringify({ type: 'push', pushId: 2, diff: { 'page:page': { op: 'patch', patch: { fields: { typeName: 'shape' } } } } })
		)
		expect(replies.slice(-2).map((reply) => reply.action)).toEqual(['discard', 'discard'])
	})
})

describe('reconnecting', () => {
	it('catches up on what changed while away, then sends what was edited offline', async () => {
		const room = newRoom()
		const a = connect(room)
		const b = connect(room)
		a.store.put([frame('mine'), frame('theirs')])
		await settle(a, b)

		a.socket.online = false
		a.socket.drop()
		expect(a.client.getStatus()).toEqual({ status: 'synced', online: false })
		a.store.update(createShapeId('mine'), (shape) => ({ ...shape, x: 50 }))
		b.store.remove([createShapeId('theirs')])
		b.store.put([frame('new')])
		await settle(a, b)

		a.socket.online = true
		a.socket.open()
		await settle(a, b)
		expect(shapeOf(a, 'theirs')).toBeUndefined()
		expect(shapeOf(a, 'new')).toBeDefined()
		expect(shapeOf(b, 'mine')!.x).toBe(50)
		expect(documentOf(a)).toEqual(documentOf(b))
	})

	it('gets only the changes since its clock from the same room, even after the server restarts', async () => {
		const storage = new MemoryStorage()
		const room = newRoom(storage)
		const a = connect(room)
		a.store.put([frame('kept')])
		await settle(a)
		a.socket.drop()
		room.close()

		const restarted = newRoom(storage)
		const b = connect(restarted)
		b.store.put([frame('later')])
		await settle(b)

		a.socket.room = restarted
		const seen: Array<{ type: string; full?: boolean; diff?: object }> = []
		const original = a.socket.deliverToClient.bind(a.socket)
		a.socket.deliverToClient = () => {
			seen.push(...a.socket.toClient.map((data) => JSON.parse(data)))
			original()
		}
		a.socket.open()
		await settle(a, b)
		const connected = seen.find((message) => message.type === 'connected')!
		expect(connected.full).toBe(false)
		expect(Object.keys(connected.diff!)).toEqual([createShapeId('later')])
		expect(documentOf(a)).toEqual(documentOf(b))
	})

	it('gets the whole board when it was away past the tombstone horizon, and keeps its offline creations', async () => {
		const room = newRoom(new MemoryStorage(), { maxTombstones: 4 })
		const a = connect(room)
		const b = connect(room)
		const names = ['t1', 't2', 't3', 't4', 't5', 't6']
		a.store.put(names.map((name) => frame(name)))
		await settle(a, b)

		a.socket.online = false
		a.socket.drop()
		a.store.put([frame('offline')])
		for (const name of names) {
			b.store.remove([createShapeId(name)])
			await settle(b)
		}

		a.socket.online = true
		a.socket.open()
		await settle(a, b)
		for (const name of names) expect(shapeOf(a, name)).toBeUndefined()
		expect(shapeOf(b, 'offline')).toBeDefined()
		expect(documentOf(a)).toEqual(documentOf(b))
	})
})

describe('connecting', () => {
	it('is refused with a reason when the client’s schema is behind or ahead', async () => {
		const room = newRoom()
		const statuses: string[] = []
		const behind: Record<string, number> = { 'com.tldraw.shape': 0 }
		const ahead: Record<string, number> = { ...schema.serialize().sequences, 'com.example.new': 1 }
		for (const sequences of [behind, ahead]) {
			const store = newStore()
			const socket = new TestSocket(room)
			const realSerialize = store.schema.serialize.bind(store.schema)
			store.schema.serialize = () => ({ ...realSerialize(), sequences })
			const client = new SyncClient({ store, socket })
			socket.deliverToServer()
			socket.deliverToClient()
			const status = client.getStatus()
			statuses.push(status.status === 'error' ? status.error.reason : status.status)
			store.schema.serialize = realSerialize
			client.dispose()
		}
		expect(statuses).toEqual(['client-too-old', 'server-too-old'])
	})

	it('ends every connection when the room closes, and refuses new ones', async () => {
		const room = newRoom()
		const a = connect(room)
		await settle(a)
		room.close()
		await settle(a)
		const status = a.client.getStatus()
		expect(status.status === 'error' && status.error.reason).toBe('room-closed')
	})

	it('starts a new room with its initial records, validated', () => {
		expect(() =>
			newRoom(new MemoryStorage(), {
				initial: { store: { bad: { ...frame('x'), props: {} } as unknown as TLRecord }, schema: schema.serialize() },
			})
		).toThrow()
	})
})

import { Store } from '@tldraw/store'
import {
	createShapeId,
	createTLSchema,
	DocumentRecordType,
	PageRecordType,
	TLDOCUMENT_ID,
	type TLPageId,
	type TLFrameShape,
	type TLRecord,
	type TLShape,
	type TLStoreProps,
} from '@tldraw/tlschema'
import { SyncClient, type ClientSocket } from '../SyncClient.ts'
import { SyncRoom, type RoomSession, type RoomState, type RoomStorage, type SyncRoomOptions } from '../SyncRoom.ts'

export const schema = createTLSchema()
export const PAGE = 'page:page' as TLPageId

export function newStore(): Store<TLRecord, TLStoreProps> {
	return new Store({ schema, props: { defaultName: '' } as unknown as TLStoreProps })
}

/** A frame, because its props are few and all required. */
export function frame(name: string, props: Partial<{ w: number; h: number; name: string }> = {}, rest: Partial<TLShape> = {}): TLFrameShape {
	return {
		id: createShapeId(name),
		typeName: 'shape',
		type: 'frame',
		x: 0,
		y: 0,
		rotation: 0,
		index: 'a1',
		parentId: PAGE,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: { w: 100, h: 100, name, color: 'black', ...props },
		...rest,
	} as TLFrameShape
}

export const initialBoard = () => ({
	store: {
		[TLDOCUMENT_ID]: DocumentRecordType.create({ id: TLDOCUMENT_ID }),
		[PAGE]: PageRecordType.create({ id: PAGE, name: 'Page 1', index: 'a1' as never }),
	} as Record<string, TLRecord>,
	schema: schema.serialize(),
})

export class MemoryStorage implements RoomStorage<TLRecord> {
	state: RoomState<TLRecord> | null = null
	load() {
		return this.state && structuredClone(this.state)
	}
	commit(change: { clock: number; put: TLRecord[]; removed: string[]; horizon?: number }) {
		const state = this.state!
		for (const record of change.put) {
			state.records.set(record.id, { record, clock: change.clock })
			state.tombstones.delete(record.id)
		}
		for (const id of change.removed) {
			state.records.delete(id)
			state.tombstones.set(id, change.clock)
		}
		state.clock = change.clock
		if (change.horizon !== undefined) {
			for (const [id, clock] of state.tombstones) if (clock <= change.horizon) state.tombstones.delete(id)
			state.horizon = change.horizon
		}
	}
	replace(state: RoomState<TLRecord>) {
		this.state = structuredClone(state)
	}
}

export function newRoom(storage: RoomStorage<TLRecord> = new MemoryStorage(), options: Partial<SyncRoomOptions<TLRecord>> = {}) {
	return new SyncRoom<TLRecord>({ schema, storage, initial: initialBoard(), ...options })
}

/**
 * A connection to an in-process room whose messages wait until the test delivers them, so a test
 * decides what arrives before what.
 */
export class TestSocket implements ClientSocket {
	room: SyncRoom<TLRecord>
	toServer: string[] = []
	toClient: string[] = []
	online = true
	private handlers: Parameters<ClientSocket['start']>[0] | undefined
	private session: RoomSession | undefined
	private stopped = false
	private closedByServer = false

	constructor(room: SyncRoom<TLRecord>) {
		this.room = room
	}

	start(handlers: Parameters<ClientSocket['start']>[0]) {
		this.handlers = handlers
		this.open()
	}
	send(data: string) {
		if (this.session) this.toServer.push(data)
	}
	reconnect() {
		this.drop()
		this.open()
	}
	stop() {
		this.stopped = true
		this.drop()
	}

	open() {
		if (this.stopped || !this.online || this.session) return
		const session = this.room.join({
			send: (data) => {
				if (this.session === session) this.toClient.push(data)
			},
			// As a WebSocket does: what was sent before the close still arrives.
			close: () => {
				if (this.session === session) this.closedByServer = true
			},
		})
		this.session = session
		this.handlers!.open()
	}

	/** The connection breaks: anything in flight is lost. */
	drop() {
		const session = this.session
		if (!session) return
		this.session = undefined
		this.closedByServer = false
		this.toServer = []
		this.toClient = []
		session.leave()
		this.handlers!.close()
	}

	deliverToServer() {
		for (const data of this.toServer.splice(0)) this.session?.receive(data)
	}
	deliverToClient() {
		for (const data of this.toClient.splice(0)) this.handlers!.message(data)
		if (this.closedByServer) this.drop()
	}
}

/** A client, its store and its socket. */
export function connect(room: SyncRoom<TLRecord>) {
	const store = newStore()
	const socket = new TestSocket(room)
	const client = new SyncClient({ store, socket, pushDelayMs: 0 })
	return { store, socket, client }
}

type Peer = ReturnType<typeof connect>

/** Lets local edits reach the push timer, then delivers everything both ways until nothing moves. */
export async function settle(...peers: Peer[]) {
	for (let round = 0; round < 20; round++) {
		await new Promise((resolve) => setTimeout(resolve, 2))
		for (const peer of peers) peer.store._flushHistory()
		await new Promise((resolve) => setTimeout(resolve, 1))
		let moved = false
		for (const peer of peers) {
			moved ||= peer.socket.toServer.length > 0 || peer.socket.toClient.length > 0
			peer.socket.deliverToServer()
		}
		for (const peer of peers) peer.socket.deliverToClient()
		if (!moved && round > 1) return
	}
}

export const shapeOf = (peer: Peer, name: string) => peer.store.get(createShapeId(name)) as TLShape | undefined

/** The document records a store holds, for comparing two clients. */
export function documentOf(peer: Peer) {
	return Object.fromEntries(
		peer.store
			.allRecords()
			.filter((record) => peer.store.scopedTypes.document.has(record.typeName))
			.map((record) => [record.id, record])
	)
}

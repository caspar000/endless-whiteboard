import type { RecordType, SerializedSchema, SerializedStore, StoreSchema, UnknownRecord } from '@tldraw/store'
import {
	applyOp,
	CLOSE_CODES,
	compareSchemas,
	isPlainObject,
	jsonEqual,
	opBetween,
	PROTOCOL_VERSION,
	type ClientMessage,
	type NetworkDiff,
	type RecordOp,
	type ServerMessage,
	type SyncErrorReason,
} from './protocol.ts'

/** Everything a room keeps. Records are in the room's current schema. */
export interface RoomState<R extends UnknownRecord> {
	epoch: string
	schema: SerializedSchema
	/** The clock of the last accepted change. */
	clock: number
	/** Removals at or before this clock are forgotten, so a client last seen before it gets everything. */
	horizon: number
	/** Each record with the clock of its last change. */
	records: Map<string, { record: R; clock: number }>
	/** Removed record ids with the clock of their removal. */
	tombstones: Map<string, number>
}

/** One accepted push, as storage writes it: all of it or none. */
export interface RoomChange<R extends UnknownRecord> {
	clock: number
	put: R[]
	removed: string[]
	/** Set when old tombstones are dropped: forget those at or before it, and make it the horizon. */
	horizon?: number
}

/** Where a room keeps its state. Synchronous: a push is written before anyone hears of it. */
export interface RoomStorage<R extends UnknownRecord> {
	/** The stored state, or `null` for a room that has never been written. */
	load(): RoomState<R> | null
	commit(change: RoomChange<R>): void
	/** Writes the whole state, for a new room or a migrated one. */
	replace(state: RoomState<R>): void
}

/** A connection as the room sees it. The server wires its socket's messages to `RoomSession.receive`. */
export interface RoomSocket {
	send(data: string): void
	close(code?: number, reason?: string): void
}

export interface RoomSession {
	receive(data: string): void
	/** The socket closed. */
	leave(): void
}

export interface SyncRoomOptions<R extends UnknownRecord> {
	schema: StoreSchema<R, unknown>
	storage: RoomStorage<R>
	/** The records a room starts with, when storage has none. Validated and migrated like any other. */
	initial?: { store: Record<string, R>; schema: SerializedSchema }
	/** Called after every accepted change. */
	onChange?(): void
	/** Called when the last session leaves. */
	onEmpty?(): void
	/** Past this many tombstones, the older half is forgotten; clients behind that get the whole board. */
	maxTombstones?: number
	log?: { warn?(...args: unknown[]): void }
}


interface Session extends JoinOptions<UnknownRecord> {
	id: string
	socket: RoomSocket
	connected: boolean
	readOnly: boolean
	presence: UnknownRecord | null
}

/** Who a connection is, and what it may do. */
export interface JoinOptions<R extends UnknownRecord> {
	/** Sees the board and its changes, and may change nothing but what `mayWrite` allows: shared with it to view. */
	readOnly?: boolean
	/**
	 * Whether this connection may make a change: checked for every record of every push (a push with
	 * one it may not make is refused whole). A viewer's comments; anyone's comments being their own.
	 */
	mayWrite?(id: string, before: R | null, after: R | null): boolean
	/** Fields set on this connection's presence before it's relayed: its real name, so nobody can pose as another. */
	identity?: Record<string, unknown>
}

/**
 * One board's live state on the server: it accepts pushes from every client that has the board
 * open, writes them to storage, and relays them to the others.
 *
 * Each push is checked whole before any of it is applied. Every record it writes must be a document
 * record of a type the schema knows, and must pass that type's validator. If anything fails, the
 * push is refused and the client takes it back. Records are last-writer-wins by field: a patch only
 * overwrites the fields it names.
 */
export class SyncRoom<R extends UnknownRecord> {
	private readonly state: RoomState<R>
	private readonly sessions = new Set<Session>()
	private readonly serializedSchema: SerializedSchema
	private closed = false
	private readonly options: SyncRoomOptions<R>
	private readonly types: Record<string, RecordType<R, never> | undefined>

	constructor(options: SyncRoomOptions<R>) {
		this.options = options
		this.types = options.schema.types as unknown as Record<string, RecordType<R, never> | undefined>
		this.serializedSchema = options.schema.serialize()
		const stored = options.storage.load()
		if (stored) {
			this.state = stored
			const schemas = compareSchemas(this.serializedSchema, stored.schema)
			if (schemas === 'ahead') throw new Error('This board was saved under a newer schema than this server has.')
			if (schemas === 'behind') this.migrate()
		} else {
			this.state = this.initialState()
			options.storage.replace(this.state)
		}
	}

	/** The board as it is now: records by id, and the schema they are in. */
	getSnapshot(): { store: Record<string, R>; schema: SerializedSchema } {
		const store: Record<string, R> = {}
		for (const [id, { record }] of this.state.records) store[id] = record
		return { store, schema: this.serializedSchema }
	}

	isClosed(): boolean {
		return this.closed
	}

	join(socket: RoomSocket, options: JoinOptions<R> = {}): RoomSession {
		const session: Session = {
			...(options as JoinOptions<UnknownRecord>),
			id: crypto.randomUUID(),
			socket,
			connected: false,
			readOnly: options.readOnly ?? false,
			presence: null,
		}
		if (this.closed) {
			this.end(session, 'room-closed')
			return { receive() {}, leave() {} }
		}
		this.sessions.add(session)
		return {
			receive: (data) => this.receive(session, data),
			leave: () => {
				if (!this.sessions.delete(session)) return
				this.presenceGone(session)
				if (this.sessions.size === 0) this.options.onEmpty?.()
			},
		}
	}

	/** Ends every session (`room-closed`) and refuses new ones. */
	close(): void {
		this.closed = true
		for (const session of [...this.sessions]) this.end(session, 'room-closed')
	}

	private initialState(): RoomState<R> {
		const state: RoomState<R> = {
			epoch: crypto.randomUUID(),
			schema: this.serializedSchema,
			clock: 0,
			horizon: 0,
			records: new Map(),
			tombstones: new Map(),
		}
		const initial = this.options.initial
		if (!initial) return state
		const migrated = this.options.schema.migrateStoreSnapshot({
			store: initial.store as SerializedStore<R>,
			schema: initial.schema,
		})
		if (migrated.type === 'error') throw new Error(`The board's content could not be migrated: ${migrated.reason}`)
		for (const record of Object.values<R>(migrated.value)) {
			if (!this.isDocumentType(record.typeName)) continue
			const valid = this.validate(record, null)
			if (typeof valid === 'string') throw new Error(valid)
			state.records.set(record.id, { record: valid, clock: 0 })
		}
		return state
	}

	/**
	 * Storage written under an older schema (a deploy brought migrations): migrate every record and
	 * start a new epoch, since clients reconnecting from before have records in the old shape.
	 */
	private migrate(): void {
		const migrated = this.options.schema.migrateStoreSnapshot({
			store: this.getSnapshot().store as SerializedStore<R>,
			schema: this.state.schema,
		})
		if (migrated.type === 'error') throw new Error(`The board could not be migrated: ${migrated.reason}`)
		this.state.epoch = crypto.randomUUID()
		this.state.schema = this.serializedSchema
		this.state.horizon = this.state.clock
		this.state.tombstones.clear()
		this.state.records = new Map(
			Object.values<R>(migrated.value).map((record) => [record.id, { record, clock: this.state.clock }])
		)
		this.options.storage.replace(this.state)
	}

	private send(session: Session, message: ServerMessage<R>): void {
		session.socket.send(JSON.stringify(message))
	}

	private end(session: Session, reason: SyncErrorReason, message?: string): void {
		this.send(session, { type: 'error', reason, ...(message ? { message } : {}) })
		session.socket.close(CLOSE_CODES[reason], reason)
		if (this.sessions.delete(session)) this.presenceGone(session)
	}

	/** Tells the others a connection's cursor has gone with it. */
	private presenceGone(session: Session): void {
		if (!session.presence) return
		session.presence = null
		this.relayPresence(session)
	}

	private relayPresence(from: Session): void {
		for (const other of this.sessions) {
			if (other !== from && other.connected) {
				this.send(other, { type: 'presence', sessionId: from.id, presence: from.presence as R | null })
			}
		}
	}

	/**
	 * A connection's presence, as its identity says (not as it claims), under an id of its own, if it
	 * is a presence-scoped record of a type the schema knows and valid. Anything else is dropped:
	 * presence is decoration, not worth ending a session over.
	 */
	private presence(session: Session, presence: unknown): void {
		if (presence === null) return this.presenceGone(session)
		if (!isPlainObject(presence) || typeof presence.typeName !== 'string') return
		const type = this.types[presence.typeName]
		if (!type || type.scope !== 'presence') return
		const record = { ...presence, ...session.identity, id: `${presence.typeName}:${session.id}` } as unknown as R
		try {
			type.validate(record)
		} catch {
			return
		}
		session.presence = record
		this.relayPresence(session)
	}

	private receive(session: Session, data: string): void {
		if (!this.sessions.has(session)) return
		let message: ClientMessage<R>
		try {
			message = JSON.parse(data)
		} catch {
			return this.end(session, 'bad-request', 'Not JSON.')
		}
		if (!isPlainObject(message)) return this.end(session, 'bad-request', 'Not a message.')
		switch (message.type) {
			case 'ping':
				return this.send(session, { type: 'pong' })
			case 'connect':
				return this.connect(session, message)
			case 'push':
				if (!session.connected) return this.end(session, 'bad-request', 'Push before connect.')
				return this.push(session, message)
			case 'presence':
				if (!session.connected) return
				return this.presence(session, message.presence)
			default:
				return this.end(session, 'bad-request', 'Unknown message type.')
		}
	}

	private connect(session: Session, message: Extract<ClientMessage<R>, { type: 'connect' }>): void {
		if (message.protocol !== PROTOCOL_VERSION) {
			return this.end(session, message.protocol < PROTOCOL_VERSION ? 'client-too-old' : 'server-too-old')
		}
		if (!isPlainObject(message.schema)) return this.end(session, 'bad-request', 'No schema.')
		const schemas = compareSchemas(this.serializedSchema, message.schema)
		if (schemas === 'behind') return this.end(session, 'client-too-old')
		if (schemas === 'ahead') return this.end(session, 'server-too-old')

		const { since } = message
		const state = this.state
		const incremental =
			since !== undefined &&
			since.epoch === state.epoch &&
			since.clock >= state.horizon &&
			since.clock <= state.clock
		const diff: NetworkDiff<R> = {}
		for (const [id, { record, clock }] of state.records) {
			if (!incremental || clock > since.clock) diff[id] = { op: 'put', record }
		}
		if (incremental) {
			for (const [id, clock] of state.tombstones) if (clock > since.clock) diff[id] = { op: 'remove' }
		}
		session.connected = true
		this.send(session, {
			type: 'connected',
			protocol: PROTOCOL_VERSION,
			epoch: state.epoch,
			clock: state.clock,
			full: !incremental,
			diff,
		})
		// Who else is here already.
		for (const other of this.sessions) {
			if (other !== session && other.connected && other.presence) {
				this.send(session, { type: 'presence', sessionId: other.id, presence: other.presence as R })
			}
		}
	}

	private push(session: Session, message: Extract<ClientMessage<R>, { type: 'push' }>): void {
		const { pushId, diff } = message
		if (typeof pushId !== 'number' || !isPlainObject(diff)) return this.end(session, 'bad-request', 'Malformed push.')
		const refuse = (reason: string) =>
			this.send(session, { type: 'pushResult', pushId, clock: this.state.clock, action: 'discard', reason })
		if (session.readOnly && !session.mayWrite) return refuse('read-only')

		// Check everything before changing anything, so a push applies whole or not at all.
		const changes: Array<{ id: string; after: R | null }> = []
		for (const [id, op] of Object.entries(diff)) {
			const before = this.state.records.get(id)?.record ?? null
			const after = this.resolve(id, before, op)
			if (typeof after === 'string') {
				this.options.log?.warn?.(`Refused a push: ${after}`)
				return refuse(after)
			}
			if (session.mayWrite && !session.mayWrite(id, before, after)) return refuse(session.readOnly ? 'read-only' : 'not allowed')
			if (after !== before) changes.push({ id, after })
		}

		if (changes.length === 0) {
			return this.send(session, { type: 'pushResult', pushId, clock: this.state.clock, action: 'commit' })
		}

		const state = this.state
		const clock = state.clock + 1
		const relay: NetworkDiff<R> = {}
		const change: RoomChange<R> = { clock, put: [], removed: [] }
		for (const { id, after } of changes) {
			const op = opBetween(state.records.get(id)?.record ?? null, after)
			if (op) relay[id] = op
			if (after) {
				state.records.set(id, { record: after, clock })
				state.tombstones.delete(id)
				change.put.push(after)
			} else {
				state.records.delete(id)
				state.tombstones.set(id, clock)
				change.removed.push(id)
			}
		}
		state.clock = clock
		if (state.tombstones.size > (this.options.maxTombstones ?? 5000)) change.horizon = this.forgetOldTombstones()
		this.options.storage.commit(change)

		this.send(session, { type: 'pushResult', pushId, clock, action: 'commit' })
		for (const other of this.sessions) {
			if (other !== session && other.connected) this.send(other, { type: 'patch', clock, diff: relay })
		}
		this.options.onChange?.()
	}

	/**
	 * The record `op` leaves behind, `before` itself when nothing changes, or why the op is refused.
	 */
	private resolve(id: string, before: R | null, op: RecordOp<R>): R | null | string {
		if (!isPlainObject(op)) return `${id}: not an op`
		let after: R | null
		switch (op.op) {
			case 'remove':
				return null
			case 'put':
				if (!isPlainObject(op.record) || op.record.id !== id) return `${id}: put of a different record`
				after = op.record
				break
			case 'patch': {
				const { patch } = op
				if (!isPlainObject(patch)) return `${id}: not a patch`
				for (const part of [patch.fields, patch.props, patch.meta]) {
					if (part !== undefined && !isPlainObject(part)) return `${id}: not a patch`
				}
				if (patch.fields && (Object.hasOwn(patch.fields, 'id') || Object.hasOwn(patch.fields, 'typeName'))) {
					return `${id}: a patch can't change a record's id or type`
				}
				after = applyOp(before, op)
				if (!after) return before
				break
			}
			default:
				return `${id}: not an op`
		}
		if (before && jsonEqual(before, after)) return before
		if (!this.isDocumentType(after.typeName)) return `${id}: not a document record`
		if (before && before.typeName !== after.typeName) return `${id}: a record can't change type`
		return this.validate(after, before)
	}

	private isDocumentType(typeName: unknown): boolean {
		if (typeof typeName !== 'string' || !Object.hasOwn(this.types, typeName)) return false
		return this.types[typeName]?.scope === 'document'
	}

	/** The record, or why it is invalid. */
	private validate(record: R, before: R | null): R | string {
		const type = this.types[record.typeName]!
		if (!type.isId(record.id)) return `${record.id}: not an id of a ${record.typeName}`
		try {
			return type.validate(record, before ?? undefined)
		} catch (error) {
			return `${record.id}: ${error instanceof Error ? error.message : String(error)}`
		}
	}

	/** Drops the older half of the tombstones. Returns the new horizon. */
	private forgetOldTombstones(): number {
		const byAge = [...this.state.tombstones].sort((a, b) => a[1] - b[1])
		const forgotten = byAge.slice(0, byAge.length - Math.floor((this.options.maxTombstones ?? 5000) / 2))
		const horizon = forgotten.at(-1)![1]
		for (const [id, clock] of byAge) if (clock <= horizon) this.state.tombstones.delete(id)
		this.state.horizon = horizon
		return horizon
	}
}

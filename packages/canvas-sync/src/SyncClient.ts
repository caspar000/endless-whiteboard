import type { IdOf, RecordsDiff, SerializedStore, Store, UnknownRecord } from '@tldraw/store'
import type { SyncCache, SyncCacheContents } from './cache.ts'
import {
	applyOp,
	compareSchemas,
	jsonEqual,
	opBetween,
	PROTOCOL_VERSION,
	type ClientMessage,
	type NetworkDiff,
	type RecordOp,
	type ServerMessage,
	type SyncErrorReason,
} from './protocol.ts'

/**
 * A connection that comes back by itself: `open` fires on every (re)connection and `close` on every
 * drop, until `stop`. `ReconnectingWebSocket` is the browser one.
 */
export interface ClientSocket {
	start(handlers: { open(): void; message(data: string): void; close(): void }): void
	send(data: string): void
	/** Drops the connection and makes a new one, for a connection that has gone quiet. */
	reconnect(): void
	/** Closes for good. */
	stop(): void
}

export type SyncStatus =
	| { status: 'loading' }
	| {
			status: 'synced'
			online: boolean
			/** Records with edits the server hasn't confirmed yet. */
			unsent: number
			/** Edits the server refused this session, and which were taken back. */
			refused: number
	  }
	| { status: 'error'; error: SyncError }

const ERROR_MESSAGES: Record<SyncErrorReason, string> = {
	'client-too-old': 'This board was saved by a newer version of the app. Reload the page to get it.',
	'server-too-old': 'The server is older than this app, and can’t open this board until it is updated.',
	'bad-request': 'The server could not understand this app.',
	'room-closed': 'This board was deleted.',
}

export class SyncError extends Error {
	readonly reason: SyncErrorReason

	constructor(reason: SyncErrorReason, message?: string) {
		super(message ? `${ERROR_MESSAGES[reason]} (${message})` : ERROR_MESSAGES[reason])
		this.name = 'SyncError'
		this.reason = reason
	}
}

export interface SyncClientOptions<R extends UnknownRecord, P = unknown> {
	store: Store<R, P>
	socket: ClientSocket
	/** How long local edits gather before they are sent. */
	pushDelayMs?: number
	pingIntervalMs?: number
	/** Hearing nothing for this long, the client presumes the connection dead and makes a new one. */
	timeoutMs?: number
	/**
	 * Where the board is kept on this device (docs/fork-parity.md S5). With one, the board opens from
	 * it before the server answers (or if it never does), and edits wait there across reloads.
	 */
	cache?: SyncCache<R>
	/** How long changes gather before they are written to the cache. */
	saveDelayMs?: number
	/** The least time between two presence messages: a cursor moves every frame. */
	presenceDelayMs?: number
}

interface Push<R extends UnknownRecord> {
	pushId: number
	diff: NetworkDiff<R>
}

/**
 * Keeps a store in step with a room on the server.
 *
 * Local edits show at once. For each record with edits the server hasn't confirmed, the client keeps
 * the server's version (`base`); what the store shows is that version, then the pushes in flight,
 * then edits not yet sent. When someone else's change arrives for such a record, it lands on `base`
 * and the local edits are laid over it again. A refused push is dropped the same way. The server
 * answers pushes in order, and relays others' changes in the order it accepted them, so `base` is
 * always exactly what the server has.
 *
 * Edits made while offline wait, and go out after the client reconnects and catches up.
 */
export class SyncClient<R extends UnknownRecord, P = unknown> {
	private status: SyncStatus = { status: 'loading' }
	private readonly listeners = new Set<(status: SyncStatus) => void>()
	private readonly store: Store<R, P>
	private readonly socket: ClientSocket
	private readonly pushDelayMs: number
	private readonly timeoutMs: number

	private readonly base = new Map<string, R | null>()
	private pending: Push<R>[] = []
	/** Records edited since the last push. */
	private readonly dirty = new Set<string>()
	private nextPushId = 1
	private since: { epoch: string; clock: number } | undefined
	private connected = false
	private lastHeard = 0
	private pushTimer: ReturnType<typeof setTimeout> | undefined
	private readonly pingTimer: ReturnType<typeof setInterval>
	private readonly stopListening: () => void
	private refused = 0
	private disposed = false

	private readonly cache: SyncCache<R> | undefined
	private readonly saveDelayMs: number
	/** Records written or removed since the cache was last written. */
	private readonly unsaved = new Set<string>()
	private saveTimer: ReturnType<typeof setTimeout> | undefined
	/** While the cache is being read into the store: those writes are already saved. */
	private restoring = false

	/** This client's presence, as last set, and whether the server has it yet. */
	private presence: R | null = null
	private presenceSent = true
	private presenceTimer: ReturnType<typeof setTimeout> | undefined
	private readonly presenceDelayMs: number
	/** Others' presence records in the store, by their connection. */
	private readonly peers = new Map<string, string>()

	constructor({
		store,
		socket,
		pushDelayMs = 1000 / 30,
		pingIntervalMs = 5000,
		timeoutMs = 15000,
		cache,
		saveDelayMs = 500,
		presenceDelayMs = 50,
	}: SyncClientOptions<R, P>) {
		this.presenceDelayMs = presenceDelayMs
		this.store = store
		this.socket = socket
		this.pushDelayMs = pushDelayMs
		this.timeoutMs = timeoutMs
		this.cache = cache
		this.saveDelayMs = saveDelayMs
		const stopLocal = store.listen(({ changes }) => this.recordLocalChanges(changes), {
			source: 'user',
			scope: 'document',
		})
		const stopCaching = cache
			? store.listen(({ changes }) => this.noteUnsaved(changes), { source: 'all', scope: 'document' })
			: () => {}
		this.stopListening = () => {
			stopLocal()
			stopCaching()
		}
		this.pingTimer = setInterval(() => this.ping(), pingIntervalMs)
		const start = () => {
			if (this.disposed) return
			socket.start({
				open: () => this.onOpen(),
				message: (data) => this.onMessage(data),
				close: () => this.onClose(),
			})
		}
		// The board as this device last had it first, then the server: what arrives then is what changed since.
		if (cache) void this.restore(cache).finally(start)
		else start()
	}

	getStatus(): SyncStatus {
		return this.status
	}

	onStatusChange(listener: (status: SyncStatus) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/** Sends what is unsent, saves what is unsaved, then closes. */
	dispose(): void {
		this.pushNow()
		this.saveNow()
		this.disposed = true
		this.stopListening()
		clearInterval(this.pingTimer)
		clearTimeout(this.pushTimer)
		clearTimeout(this.saveTimer)
		clearTimeout(this.presenceTimer)
		this.socket.stop()
		this.connected = false
		this.forgetPeers()
		this.listeners.clear()
	}

	/**
	 * Where this client is on the board, for the others to see: a presence-scoped record (cursor,
	 * selection, name), or `null`. Sent at most every `presenceDelayMs`, and again on reconnecting.
	 */
	setPresence(presence: R | null): void {
		if (presence === this.presence) return
		this.presence = presence
		this.presenceSent = false
		if (!this.connected || this.presenceTimer) return
		this.presenceTimer = setTimeout(() => {
			this.presenceTimer = undefined
			this.sendPresence()
		}, this.presenceDelayMs)
	}

	private sendPresence(): void {
		if (!this.connected || this.presenceSent) return
		this.presenceSent = true
		this.send({ type: 'presence', presence: this.presence })
	}

	/** Someone else's presence arrived, or went. */
	private onPresence(sessionId: string, presence: R | null): void {
		const known = this.peers.get(sessionId)
		try {
			this.store.mergeRemoteChanges(() => {
				if (presence) {
					this.store.put([presence])
					this.peers.set(sessionId, presence.id)
				} else if (known) {
					this.store.remove([known as IdOf<R>])
					this.peers.delete(sessionId)
				}
			})
		} catch {
			// A presence this store can't hold (a newer app's): there's just no cursor for it.
		}
	}

	/** The others' cursors go with the connection: they may have left while it was down. */
	private forgetPeers(): void {
		const ids = [...this.peers.values()] as IdOf<R>[]
		this.peers.clear()
		if (!ids.length) return
		try {
			this.store.mergeRemoteChanges(() => this.store.remove(ids.filter((id) => this.store.has(id))))
		} catch {
			// The store is going away with them.
		}
	}

	/** Writes what the cache hasn't got yet, now: the page is going away. */
	flush(): void {
		this.saveNow(true)
	}

	private setStatus(status: SyncStatus): void {
		this.status = status
		for (const listener of this.listeners) listener(status)
	}

	private synced(online: boolean): SyncStatus {
		return { status: 'synced', online, unsent: this.base.size, refused: this.refused }
	}

	/** Tells listeners when the count of unsent edits or refusals moved. */
	private updateCounts(): void {
		const status = this.status
		if (status.status !== 'synced') return
		if (status.unsent !== this.base.size || status.refused !== this.refused) this.setStatus(this.synced(status.online))
	}

	/** Reads the cache into the store and picks up where this device left off. */
	private async restore(cache: SyncCache<R>): Promise<void> {
		let cached: SyncCacheContents<R> | null
		try {
			cached = await cache.load()
		} catch (error) {
			console.error('Lifeboard: could not read the board kept on this device.', error)
			return
		}
		if (!cached || this.disposed) return
		const contents = this.migrated(cached)
		if (!contents) return

		this.restoring = true
		try {
			this.store.mergeRemoteChanges(() => this.store.put(contents.records))
			this.store._flushHistory()
		} finally {
			this.restoring = false
		}
		this.since = contents.state.since
		for (const [id, record] of contents.state.base) {
			this.base.set(id, record)
			// Compared again with what the store has when the connection comes: unsent, or already sent.
			this.dirty.add(id)
		}
		this.setStatus(this.synced(false))
	}

	/** The cache in this app's schema, or `null` when it can't be (saved by a newer app). */
	private migrated(cached: SyncCacheContents<R>): SyncCacheContents<R> | null {
		const ours = this.store.schema.serialize()
		const comparison = compareSchemas(ours, cached.state.schema)
		if (comparison === 'same') return cached
		if (comparison === 'ahead') return null
		const migrate = (records: R[]): R[] | null => {
			const result = this.store.schema.migrateStoreSnapshot({
				store: Object.fromEntries(records.map((record) => [record.id, record])) as SerializedStore<R>,
				schema: cached.state.schema,
			})
			return result.type === 'success' ? (Object.values(result.value) as R[]) : null
		}
		const records = migrate(cached.records)
		const baseRecords = migrate(cached.state.base.flatMap(([, record]) => (record ? [record] : [])))
		if (!records || !baseRecords) return null
		const migratedBase = new Map<string, R>(baseRecords.map((record) => [record.id, record]))
		return {
			records,
			state: {
				...cached.state,
				schema: ours,
				base: cached.state.base.map(([id, record]) => [id, record ? (migratedBase.get(id) ?? null) : null]),
			},
		}
	}

	private noteUnsaved(changes: RecordsDiff<R>): void {
		if (this.restoring) return
		for (const record of Object.values<R>(changes.added)) this.unsaved.add(record.id)
		for (const [, to] of Object.values<[R, R]>(changes.updated)) this.unsaved.add(to.id)
		for (const record of Object.values<R>(changes.removed)) this.unsaved.add(record.id)
		this.scheduleSave()
	}

	private scheduleSave(): void {
		if (!this.cache || this.saveTimer || this.disposed) return
		this.saveTimer = setTimeout(() => {
			this.saveTimer = undefined
			this.saveNow()
		}, this.saveDelayMs)
	}

	private saveNow(unloading = false): void {
		if (!this.cache || this.disposed || this.status.status !== 'synced') return
		clearTimeout(this.saveTimer)
		this.saveTimer = undefined
		const put: R[] = []
		const remove: string[] = []
		for (const id of this.unsaved) {
			const record = this.current(id)
			if (record) put.push(record)
			else remove.push(id)
		}
		this.unsaved.clear()
		const changes = {
			put,
			remove,
			state: { schema: this.store.schema.serialize(), ...(this.since ? { since: { ...this.since } } : {}), base: [...this.base] },
		}
		if (unloading && this.cache.saveBeforeUnload) this.cache.saveBeforeUnload(changes)
		else void this.cache.save(changes)
	}

	private send(message: ClientMessage<R>): void {
		this.socket.send(JSON.stringify(message))
	}

	private onOpen(): void {
		this.lastHeard = Date.now()
		this.send({
			type: 'connect',
			protocol: PROTOCOL_VERSION,
			schema: this.store.schema.serialize(),
			...(this.since ? { since: this.since } : {}),
		})
	}

	private onClose(): void {
		this.connected = false
		this.forgetPeers()
		if (this.status.status === 'synced') this.setStatus(this.synced(false))
	}

	private ping(): void {
		if (!this.connected) return
		if (Date.now() - this.lastHeard > this.timeoutMs) this.socket.reconnect()
		else this.send({ type: 'ping' })
	}

	private onMessage(data: string): void {
		this.lastHeard = Date.now()
		const message = JSON.parse(data) as ServerMessage<R>
		switch (message.type) {
			case 'connected': {
				this.since = { epoch: message.epoch, clock: message.clock }
				this.applyRemote(message.diff, message.full)
				this.connected = true
				// Pushes the old connection never answered: the server may or may not have them, and
				// applying one twice leaves the same records.
				for (const push of this.pending) this.send({ type: 'push', ...push })
				this.pushNow()
				this.presenceSent = this.presence === null
				this.sendPresence()
				this.setStatus(this.synced(true))
				this.scheduleSave()
				return
			}
			case 'presence':
				return this.onPresence(message.sessionId, message.presence)
			case 'pushResult':
				this.onPushResult(message)
				this.updateCounts()
				return this.scheduleSave()
			case 'patch':
				if (this.since) this.since.clock = message.clock
				this.applyRemote(message.diff, false)
				return this.scheduleSave()
			case 'pong':
				return
			case 'error':
				this.connected = false
				this.socket.stop()
				return this.setStatus({ status: 'error', error: new SyncError(message.reason, message.message) })
		}
	}

	private onPushResult(message: Extract<ServerMessage<R>, { type: 'pushResult' }>): void {
		this.catchUp()
		const push = this.pending[0]
		if (!push || push.pushId !== message.pushId) {
			// Answers come in push order; anything else means this client lost track. Start over.
			return this.socket.reconnect()
		}
		if (this.since) this.since.clock = message.clock
		if (message.action === 'commit') {
			this.pending.shift()
			for (const [id, op] of Object.entries(push.diff)) this.base.set(id, applyOp(this.base.get(id) ?? null, op))
		} else {
			this.refused++
			console.warn(`Lifeboard: the server refused a change${message.reason ? ` (${message.reason})` : ''}; it was taken back.`)
			const ids = Object.keys(push.diff)
			const unsent = this.unsentOps(ids)
			this.pending.shift()
			this.store.mergeRemoteChanges(() => this.write(this.rebuilt(ids, unsent)))
		}
		this.forgetSettled()
	}

	/** Others' changes, or (when `full`) the whole board. */
	private applyRemote(incoming: NetworkDiff<R>, full: boolean): void {
		this.catchUp()
		const diff = { ...incoming }
		if (full) {
			const documentTypes = this.store.scopedTypes.document
			for (const record of this.store.allRecords()) {
				if (documentTypes.has(record.typeName) && !(record.id in diff)) diff[record.id] = { op: 'remove' }
			}
			for (const id of this.base.keys()) if (!(id in diff)) diff[id] = { op: 'remove' }
		}

		const ids = Object.keys(diff)
		const outstanding = ids.filter((id) => this.base.has(id))
		const unsent = this.unsentOps(outstanding)
		for (const id of outstanding) this.base.set(id, applyOp(this.base.get(id) ?? null, diff[id]!))

		const entries: Array<[string, R | null]> = []
		for (const id of ids) if (!this.base.has(id)) entries.push([id, applyOp(this.current(id), diff[id]!)])
		entries.push(...this.rebuilt(outstanding, unsent))
		this.store.mergeRemoteChanges(() => this.write(entries))
		this.forgetSettled()
	}

	private recordLocalChanges(changes: RecordsDiff<R>): void {
		for (const record of Object.values<R>(changes.added)) this.touch(record.id, null)
		for (const [from] of Object.values<[R, R]>(changes.updated)) this.touch(from.id, from)
		for (const record of Object.values<R>(changes.removed)) this.touch(record.id, record)
		this.updateCounts()
		if (this.connected && !this.pushTimer) {
			this.pushTimer = setTimeout(() => {
				this.pushTimer = undefined
				this.pushNow()
			}, this.pushDelayMs)
		}
	}

	/**
	 * The store tells listeners about changes a frame later. Anything this client does to the store
	 * first hears of local edits still waiting, or it would take the edited record for the server's.
	 */
	private catchUp(): void {
		this.store._flushHistory()
	}

	private touch(id: string, before: R | null): void {
		if (!this.base.has(id)) this.base.set(id, before)
		this.dirty.add(id)
	}

	private pushNow(): void {
		if (!this.connected) return
		this.catchUp()
		const diff: NetworkDiff<R> = {}
		for (const id of this.dirty) {
			const op = opBetween(this.expected(id), this.current(id))
			if (op) diff[id] = op
		}
		this.dirty.clear()
		if (Object.keys(diff).length > 0) {
			const push = { pushId: this.nextPushId++, diff }
			this.pending.push(push)
			this.send({ type: 'push', ...push })
		}
		this.forgetSettled()
	}

	private current(id: string): R | null {
		return (this.store.get(id as IdOf<R>) as R | undefined) ?? null
	}

	/** The server's version with the pushes in flight laid over it: the record before unsent edits. */
	private expected(id: string): R | null {
		if (!this.base.has(id)) return this.current(id)
		let record = this.base.get(id) ?? null
		for (const push of this.pending) {
			const op = push.diff[id]
			if (op) record = applyOp(record, op)
		}
		return record
	}

	/** The unsent edits to these records, as ops. Read before `base` or `pending` change under them. */
	private unsentOps(ids: string[]): Map<string, RecordOp<R>> {
		const ops = new Map<string, RecordOp<R>>()
		for (const id of ids) {
			if (!this.dirty.has(id)) continue
			const op = opBetween(this.expected(id), this.current(id))
			if (op) ops.set(id, op)
		}
		return ops
	}

	/** What the store should show for these records now: `base`, then pushes in flight, then `unsent`. */
	private rebuilt(ids: string[], unsent: Map<string, RecordOp<R>>): Array<[string, R | null]> {
		return ids.map((id) => {
			const op = unsent.get(id)
			const record = this.expected(id)
			return [id, op ? applyOp(record, op) : record]
		})
	}

	private write(entries: Array<[string, R | null]>): void {
		const puts: R[] = []
		const removes: IdOf<R>[] = []
		for (const [id, record] of entries) {
			const now = this.current(id)
			if (record) {
				if (!jsonEqual(now, record)) puts.push(record)
			} else if (now) {
				removes.push(id as IdOf<R>)
			}
		}
		if (removes.length > 0) this.store.remove(removes)
		if (puts.length > 0) this.store.put(puts)
	}

	/** Forgets the server's version of records with nothing outstanding: the store shows it as it is. */
	private forgetSettled(): void {
		for (const id of this.base.keys()) {
			if (!this.dirty.has(id) && !this.pending.some((push) => id in push.diff)) this.base.delete(id)
		}
	}
}

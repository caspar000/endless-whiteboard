import type { SerializedSchema, UnknownRecord } from '@tldraw/store'

/**
 * The sync protocol between a board's room on the server and each client that has the board open.
 *
 * The server holds the truth and orders every change with a clock: a number it raises by one for
 * each push it accepts. A client applies its own edits at once, pushes them, and applies everyone
 * else's as the server relays them. When the server refuses a push, the client takes it back.
 * A client that reconnects says which clock it last saw and gets only what changed since.
 *
 * Only document records travel; the camera, selection and other session records stay in the tab.
 *
 * Bump `PROTOCOL_VERSION` when a message changes shape. Client and server must agree.
 */
export const PROTOCOL_VERSION = 1

/**
 * Fields of a record that changed, with their new values. `props` and `meta` go one level deeper, so
 * two people changing different props of one shape don't overwrite each other.
 */
export interface RecordPatch {
	fields?: Record<string, unknown>
	props?: Record<string, unknown>
	meta?: Record<string, unknown>
}

/** What happened to one record: written whole, some of its fields changed, or removed. */
export type RecordOp<R extends UnknownRecord = UnknownRecord> =
	| { op: 'put'; record: R }
	| { op: 'patch'; patch: RecordPatch }
	| { op: 'remove' }

/** Changes to several records, by record id. */
export type NetworkDiff<R extends UnknownRecord = UnknownRecord> = Record<string, RecordOp<R>>

export type ClientMessage<R extends UnknownRecord = UnknownRecord> =
	| {
			type: 'connect'
			protocol: number
			schema: SerializedSchema
			/** Where a reconnecting client left off. Without it, or if the server can't serve it, the client gets everything. */
			since?: { epoch: string; clock: number }
	  }
	| { type: 'push'; pushId: number; diff: NetworkDiff<R> }
	| { type: 'ping' }

export type ServerMessage<R extends UnknownRecord = UnknownRecord> =
	| {
			type: 'connected'
			protocol: number
			/** Changes when the room's history starts again (a new room, a migration); a client's clock means nothing across epochs. */
			epoch: string
			clock: number
			/** `true`: `diff` is every record, and anything the client has that isn't in it is gone. */
			full: boolean
			diff: NetworkDiff<R>
	  }
	| { type: 'pushResult'; pushId: number; clock: number; action: 'commit' | 'discard'; reason?: string }
	| { type: 'patch'; clock: number; diff: NetworkDiff<R> }
	| { type: 'pong' }
	| { type: 'error'; reason: SyncErrorReason; message?: string }

/**
 * Why the server ended a connection. All of them are final: the client stops reconnecting.
 *
 * - `client-too-old`: the client's schema or protocol is behind the server's. Reloading fixes it.
 * - `server-too-old`: the other way round. The server needs updating.
 * - `bad-request`: a message the server couldn't read.
 * - `room-closed`: the board was deleted.
 */
export type SyncErrorReason = 'client-too-old' | 'server-too-old' | 'bad-request' | 'room-closed'

/** Close codes that go with each reason, for logs and proxies; clients read the `error` message instead. */
export const CLOSE_CODES: Record<SyncErrorReason, number> = {
	'client-too-old': 4409,
	'server-too-old': 4409,
	'bad-request': 4400,
	'room-closed': 4410,
}

type Fields = Record<string, unknown>

/** `record` after `op`. `null` means no record: a patch to a record that is gone stays gone. */
export function applyOp<R extends UnknownRecord>(record: R | null, op: RecordOp<R>): R | null {
	switch (op.op) {
		case 'put':
			return op.record
		case 'remove':
			return null
		case 'patch': {
			if (!record) return null
			const next: Fields = { ...record, ...op.patch.fields }
			if (op.patch.props) next.props = { ...(next.props as Fields), ...op.patch.props }
			if (op.patch.meta) next.meta = { ...(next.meta as Fields), ...op.patch.meta }
			return next as R
		}
	}
}

/** The op that turns `before` into `after`, or `null` when they are the same. */
export function opBetween<R extends UnknownRecord>(before: R | null, after: R | null): RecordOp<R> | null {
	if (!after) return before ? { op: 'remove' } : null
	if (!before) return { op: 'put', record: after }
	if (before === after) return null

	const was = before as Fields
	const now = after as Fields
	// A field that went away can't be said with a patch, and records rarely lose fields: send it whole.
	for (const key of Object.keys(was)) if (!Object.hasOwn(now, key)) return { op: 'put', record: after }

	const patch: RecordPatch = {}
	for (const key of Object.keys(now)) {
		if (jsonEqual(was[key], now[key])) continue
		const nested = key === 'props' || key === 'meta' ? keysChanged(was[key], now[key]) : null
		if (nested) patch[key as 'props' | 'meta'] = nested
		else (patch.fields ??= {})[key] = now[key]
	}
	return patch.fields || patch.props || patch.meta ? { op: 'patch', patch } : null
}

/** The keys of `after` that differ from `before`, or `null` if a key was removed (the whole object has to go). */
function keysChanged(before: unknown, after: unknown): Fields | null {
	if (!isPlainObject(before) || !isPlainObject(after)) return null
	for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) return null
	const changed: Fields = {}
	for (const key of Object.keys(after)) {
		if (!jsonEqual(before[key], after[key])) changed[key] = after[key]
	}
	return changed
}

/** Structural equality for JSON values, which is all records hold. */
export function jsonEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
	if (Array.isArray(a) !== Array.isArray(b)) return false
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]))
	}
	const aKeys = Object.keys(a)
	const bKeys = Object.keys(b)
	if (aKeys.length !== bKeys.length) return false
	return aKeys.every((key) => Object.hasOwn(b, key) && jsonEqual((a as Fields)[key], (b as Fields)[key]))
}

export function isPlainObject(value: unknown): value is Fields {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * How `theirs` stands against `ours`: the same migrations, behind (some sequence older or missing),
 * or ahead (some sequence newer or unknown to us). Ahead wins over behind, because a schema that is
 * ahead anywhere has records we can't read.
 */
export function compareSchemas(ours: SerializedSchema, theirs: SerializedSchema): 'same' | 'behind' | 'ahead' {
	if (!('sequences' in ours)) throw new Error('A current schema serializes with sequences.')
	// Version 1 schemas predate migration sequences: anything still sending one is far behind.
	if (!('sequences' in theirs)) return 'behind'
	let behind = false
	for (const [id, version] of Object.entries(theirs.sequences)) {
		const mine = ours.sequences[id]
		if (mine === undefined || version > mine) return 'ahead'
		if (version < mine) behind = true
	}
	for (const id of Object.keys(ours.sequences)) if (!(id in theirs.sequences)) behind = true
	return behind ? 'behind' : 'same'
}

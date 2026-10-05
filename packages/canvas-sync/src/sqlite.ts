import type { DatabaseSync } from 'node:sqlite'
import type { SerializedSchema, UnknownRecord } from '@tldraw/store'
import type { RoomChange, RoomState, RoomStorage } from './SyncRoom.ts'

/** Bumped when the tables below change shape. */
const FORMAT = 1

/**
 * A room in one SQLite database: its records, its tombstones, and a few values (`room_meta`).
 *
 * A database that still holds a room in tldraw sync-core's layout (`documents`, `tombstones`,
 * `metadata`, `objects`; boards made before this storage existed) is read once with plain SQL and
 * rewritten in this one. The old tables go in the same transaction.
 */
export class SqliteRoomStorage<R extends UnknownRecord> implements RoomStorage<R> {
	private readonly db: DatabaseSync

	constructor(db: DatabaseSync) {
		this.db = db
		db.exec(`
			CREATE TABLE IF NOT EXISTS room_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS room_records (id TEXT PRIMARY KEY, clock INTEGER NOT NULL, record TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS room_tombstones (id TEXT PRIMARY KEY, clock INTEGER NOT NULL);
		`)
	}

	load(): RoomState<R> | null {
		const meta = Object.fromEntries(
			(this.db.prepare('SELECT key, value FROM room_meta').all() as unknown as Array<{ key: string; value: string }>).map(
				(row) => [row.key, row.value]
			)
		)
		if (meta.format === undefined) {
			const old = this.readSyncCoreLayout()
			if (old) this.replace(old)
			return old
		}
		if (Number(meta.format) > FORMAT) throw new Error(`This room was written by a newer server (format ${meta.format}).`)

		const records = new Map<string, { record: R; clock: number }>()
		for (const row of this.db.prepare('SELECT id, clock, record FROM room_records').all() as unknown as RecordRow[]) {
			records.set(row.id, { record: JSON.parse(row.record), clock: row.clock })
		}
		const tombstones = new Map<string, number>()
		for (const row of this.db.prepare('SELECT id, clock FROM room_tombstones').all() as unknown as TombstoneRow[]) {
			tombstones.set(row.id, row.clock)
		}
		return {
			epoch: meta.epoch!,
			schema: JSON.parse(meta.schema!) as SerializedSchema,
			clock: Number(meta.clock),
			horizon: Number(meta.horizon),
			records,
			tombstones,
		}
	}

	commit(change: RoomChange<R>): void {
		this.transaction(() => {
			const putRecord = this.db.prepare('INSERT OR REPLACE INTO room_records (id, clock, record) VALUES (?, ?, ?)')
			const unremove = this.db.prepare('DELETE FROM room_tombstones WHERE id = ?')
			for (const record of change.put) {
				putRecord.run(record.id, change.clock, JSON.stringify(record))
				unremove.run(record.id)
			}
			const removeRecord = this.db.prepare('DELETE FROM room_records WHERE id = ?')
			const putTombstone = this.db.prepare('INSERT OR REPLACE INTO room_tombstones (id, clock) VALUES (?, ?)')
			for (const id of change.removed) {
				removeRecord.run(id)
				putTombstone.run(id, change.clock)
			}
			this.setMeta('clock', String(change.clock))
			if (change.horizon !== undefined) {
				this.db.prepare('DELETE FROM room_tombstones WHERE clock <= ?').run(change.horizon)
				this.setMeta('horizon', String(change.horizon))
			}
		})
	}

	replace(state: RoomState<R>): void {
		this.transaction(() => {
			this.db.exec('DELETE FROM room_meta; DELETE FROM room_records; DELETE FROM room_tombstones;')
			this.setMeta('format', String(FORMAT))
			this.setMeta('epoch', state.epoch)
			this.setMeta('schema', JSON.stringify(state.schema))
			this.setMeta('clock', String(state.clock))
			this.setMeta('horizon', String(state.horizon))
			const putRecord = this.db.prepare('INSERT INTO room_records (id, clock, record) VALUES (?, ?, ?)')
			for (const [id, { record, clock }] of state.records) putRecord.run(id, clock, JSON.stringify(record))
			const putTombstone = this.db.prepare('INSERT INTO room_tombstones (id, clock) VALUES (?, ?)')
			for (const [id, clock] of state.tombstones) putTombstone.run(id, clock)
			this.db.exec('DROP TABLE IF EXISTS documents; DROP TABLE IF EXISTS tombstones; DROP TABLE IF EXISTS metadata; DROP TABLE IF EXISTS objects;')
		})
	}

	private setMeta(key: string, value: string): void {
		this.db.prepare('INSERT OR REPLACE INTO room_meta (key, value) VALUES (?, ?)').run(key, value)
	}

	private transaction(fn: () => void): void {
		this.db.exec('BEGIN')
		try {
			fn()
			this.db.exec('COMMIT')
		} catch (error) {
			this.db.exec('ROLLBACK')
			throw error
		}
	}

	/**
	 * A room in sync-core's tables, as observed in our own databases: `documents (id, state, lastChangedClock)`
	 * with each record as JSON bytes, and one `metadata` row with `documentClock` and `schema`.
	 * Tombstones aren't carried over; the new epoch sends every client the whole board anyway.
	 */
	private readSyncCoreLayout(): RoomState<R> | null {
		const tables = new Set(
			(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name: string }>).map(
				(row) => row.name
			)
		)
		if (!tables.has('documents') || !tables.has('metadata')) return null
		const meta = this.db.prepare('SELECT documentClock, schema FROM metadata').get() as unknown as
			| { documentClock: number; schema: string }
			| undefined
		if (!meta) return null

		const decoder = new TextDecoder()
		const records = new Map<string, { record: R; clock: number }>()
		const rows = this.db.prepare('SELECT id, state, lastChangedClock FROM documents').all() as unknown as Array<{
			id: string
			state: Uint8Array | string
			lastChangedClock: number
		}>
		for (const row of rows) {
			const json = typeof row.state === 'string' ? row.state : decoder.decode(row.state)
			records.set(row.id, { record: JSON.parse(json), clock: row.lastChangedClock })
		}
		return {
			epoch: crypto.randomUUID(),
			schema: JSON.parse(meta.schema) as SerializedSchema,
			clock: meta.documentClock,
			horizon: meta.documentClock,
			records,
			tombstones: new Map(),
		}
	}
}

interface RecordRow {
	id: string
	clock: number
	record: string
}

interface TombstoneRow {
	id: string
	clock: number
}

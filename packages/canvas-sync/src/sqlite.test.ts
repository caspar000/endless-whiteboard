import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createShapeId, type TLRecord, type TLShape } from '@tldraw/tlschema'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRoomStorage } from './sqlite.ts'
import { connect, documentOf, frame, newRoom, settle } from './test/harness.ts'

const open: DatabaseSync[] = []
afterEach(() => {
	for (const db of open.splice(0)) db.close()
})

function database(path = join(mkdtempSync(join(tmpdir(), 'lb-room-')), 'room.sqlite')) {
	const db = new DatabaseSync(path)
	open.push(db)
	return { db, path, storage: new SqliteRoomStorage<TLRecord>(db) }
}

const tables = (db: DatabaseSync) =>
	(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as Array<{ name: string }>).map(
		(row) => row.name
	)

describe('a room in SQLite', () => {
	it('keeps records, removals and the clock across a reopen, and a client catches up from it', async () => {
		const { path, storage } = database()
		const room = newRoom(storage)
		const a = connect(room)
		a.store.put([frame('kept'), frame('gone')])
		await settle(a)
		a.store.remove([createShapeId('gone')])
		a.store.update(createShapeId('kept'), (shape) => ({ ...shape, x: 12 }))
		await settle(a)
		a.socket.drop()
		room.close()
		open.pop()!.close()

		const reopened = database(path)
		const state = reopened.storage.load()!
		expect(state.records.get(createShapeId('kept'))!.record).toMatchObject({ x: 12 })
		expect(state.tombstones.has(createShapeId('gone'))).toBe(true)
		// One push carried both the removal and the move.
		expect(state.clock).toBe(2)

		const restarted = newRoom(reopened.storage)
		a.socket.room = restarted
		a.socket.open()
		const b = connect(restarted)
		await settle(a, b)
		expect(documentOf(a)).toEqual(documentOf(b))
	})

	it('moves a room out of sync-core’s tables, once', () => {
		// Written by tldraw sync-core 5.5.2 through the server before this storage existed: a geo shape
		// moved to x 30, and a text shape created and removed.
		const dir = mkdtempSync(join(tmpdir(), 'lb-old-room-'))
		const path = join(dir, 'room.sqlite')
		copyFileSync(new URL('./fixtures/sync-core-room.sqlite', import.meta.url), path)

		const { db, storage } = database(path)
		const state = storage.load()!
		expect(state.clock).toBe(3)
		expect([...state.records.keys()].sort()).toEqual(['document:document', 'page:page', 'shape:kept'])
		expect((state.records.get('shape:kept')!.record as TLShape).x).toBe(30)
		expect(tables(db)).toEqual(['room_meta', 'room_records', 'room_tombstones'])
		// Read back from the new tables. (A room opening on it is apps/server's test: it needs the board schema.)
		expect(storage.load()).toEqual(state)
	})

	it('refuses to open a room written under a schema newer than its own', () => {
		const dir = mkdtempSync(join(tmpdir(), 'lb-old-room-'))
		const path = join(dir, 'room.sqlite')
		copyFileSync(new URL('./fixtures/sync-core-room.sqlite', import.meta.url), path)
		// The fixture has Lifeboard's node types; the test schema has only tldraw's own shapes.
		expect(() => newRoom(database(path).storage)).toThrow(/newer/)
	})
})

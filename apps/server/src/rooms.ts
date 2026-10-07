import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SyncRoom, type RoomSocket, type SyncRoomOptions } from '@lifeboard/canvas-sync'
import { SqliteRoomStorage } from '@lifeboard/canvas-sync/sqlite'
import { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, type TLRecord, type TLSchema } from '@tldraw/tlschema'
import type { IndexKey } from '@tldraw/utils'

interface OpenRoom {
	room: SyncRoom<TLRecord>
	db: DatabaseSync
}

/** A board's content in the form the app's backups use: records by id, plus the schema they were written with. */
export interface BoardSnapshot {
	store: Record<string, unknown>
	schema: unknown
}

/** The socket of one connection, as `@fastify/websocket` hands it over. */
export interface ServerSocket extends RoomSocket {
	on(event: 'message', listener: (data: Buffer) => void): unknown
	on(event: 'close', listener: () => void): unknown
}

interface RoomsOptions {
	dir: string
	schema: TLSchema
	/** A board's content changed — the vault bumps its "last edited". */
	onChange(boardId: string): void
	log?: { warn?(...args: unknown[]): void; error(...args: unknown[]): void }
}

/**
 * One `SyncRoom` per open board, each over its own SQLite file in `dir`.
 *
 * A room opens on the first connection and closes with the last, so the server holds only the boards
 * someone is looking at. One file per board makes deleting a board deleting a file. A file still in
 * tldraw sync-core's layout is moved to ours the first time it is opened.
 */
export class Rooms {
	private readonly open = new Map<string, OpenRoom>()

	constructor(private readonly options: RoomsOptions) {
		mkdirSync(options.dir, { recursive: true })
	}

	/** `readOnly`: the board's changes come, and the socket's own are refused (shared to view). */
	connect(boardId: string, socket: ServerSocket, { readOnly = false }: { readOnly?: boolean } = {}): void {
		let session
		try {
			session = this.room(boardId).room.join(socket, { readOnly })
		} catch (error) {
			this.options.log?.error(`Board ${boardId} could not be opened`, error)
			socket.close(1011, 'This board could not be opened.')
			return
		}
		socket.on('message', (data) => session.receive(data.toString()))
		socket.on('close', () => session.leave())
	}

	/**
	 * Writes a board's first content, for a board arriving from a local vault. Refuses to overwrite: a
	 * board that already has a file is someone's live board. Throws if the content doesn't validate.
	 */
	seed(boardId: string, snapshot: BoardSnapshot): void {
		if (existsSync(this.path(boardId))) throw new Error(`Board ${boardId} already has content.`)
		const db = this.openDb(boardId)
		try {
			new SyncRoom<TLRecord>({
				schema: this.options.schema,
				storage: new SqliteRoomStorage(db),
				initial: snapshot as SyncRoomOptions<TLRecord>['initial'],
			})
		} finally {
			db.close()
		}
	}

	/** Disconnects everyone, then removes the board's file. */
	delete(boardId: string): void {
		this.close(boardId)
		for (const suffix of ['', '-wal', '-shm']) rmSync(this.path(boardId) + suffix, { force: true })
	}

	/**
	 * The board as it is now, for export and asset GC. `null` for a board nobody has opened yet, which
	 * has no content and so references nothing. Throws if the file is there but unreadable: callers
	 * must not mistake that for an empty board.
	 */
	readSnapshot(boardId: string): BoardSnapshot | null {
		const open = this.open.get(boardId)
		if (open && !open.room.isClosed()) return open.room.getSnapshot()
		if (!existsSync(this.path(boardId))) return null
		const db = this.openDb(boardId)
		try {
			const state = new SqliteRoomStorage<TLRecord>(db).load()
			if (!state) return null
			const store: Record<string, TLRecord> = {}
			for (const [id, { record }] of state.records) store[id] = record
			return { store, schema: state.schema }
		} finally {
			db.close()
		}
	}

	closeAll(): void {
		for (const boardId of [...this.open.keys()]) this.close(boardId)
	}

	private path(boardId: string): string {
		return join(this.options.dir, `${boardId}.sqlite`)
	}

	private openDb(boardId: string): DatabaseSync {
		const db = new DatabaseSync(this.path(boardId))
		db.exec('PRAGMA journal_mode = WAL')
		return db
	}

	private room(boardId: string): OpenRoom {
		const existing = this.open.get(boardId)
		if (existing && !existing.room.isClosed()) return existing

		const db = this.openDb(boardId)
		let room: SyncRoom<TLRecord>
		try {
			room = new SyncRoom<TLRecord>({
				schema: this.options.schema,
				storage: new SqliteRoomStorage(db),
				initial: emptyBoard(this.options.schema),
				onChange: () => this.options.onChange(boardId),
				onEmpty: () => this.close(boardId),
				...(this.options.log ? { log: this.options.log } : {}),
			})
		} catch (error) {
			db.close()
			throw error
		}
		const entry = { room, db }
		this.open.set(boardId, entry)
		return entry
	}

	private close(boardId: string): void {
		const entry = this.open.get(boardId)
		if (!entry) return
		this.open.delete(boardId)
		if (!entry.room.isClosed()) entry.room.close()
		entry.db.close()
	}
}

/**
 * A new board's first records: the document and one page, with the ids an empty editor would give
 * them. Made here rather than by the first client, so two clients opening a new board at once don't
 * each make a page.
 */
function emptyBoard(schema: TLSchema) {
	return {
		store: {
			[TLDOCUMENT_ID]: DocumentRecordType.create({ id: TLDOCUMENT_ID }),
			'page:page': PageRecordType.create({ id: PageRecordType.createId('page'), name: 'Page 1', index: 'a1' as IndexKey }),
		} as Record<string, TLRecord>,
		schema: schema.serialize(),
	}
}

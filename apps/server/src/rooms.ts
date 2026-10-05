import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
	NodeSqliteWrapper,
	SQLiteSyncStorage,
	TLSocketRoom,
	type RoomSnapshot,
	type WebSocketMinimal,
} from '@tldraw/sync-core'
import type { TLRecord, TLSchema } from '@tldraw/tlschema'

interface OpenRoom {
	room: TLSocketRoom<TLRecord, void>
	storage: SQLiteSyncStorage<TLRecord>
	db: DatabaseSync
}

/** A board's content in the form the app's backups use: records by id, plus the schema they were written with. */
export interface BoardSnapshot {
	store: Record<string, unknown>
	schema: unknown
}

const toBoardSnapshot = (snapshot: RoomSnapshot): BoardSnapshot => ({
	store: Object.fromEntries(snapshot.documents.map((doc) => [doc.state.id, doc.state])),
	schema: snapshot.schema,
})

interface RoomsOptions {
	dir: string
	schema: TLSchema
	/** A board's content changed — the vault bumps its "last edited". */
	onChange(boardId: string): void
	log?: { warn?(...args: unknown[]): void; error(...args: unknown[]): void }
}

/**
 * One `TLSocketRoom` per open board, each over its own SQLite file in `dir`.
 *
 * A room opens on the first connection and closes with the last, so the server holds only the boards
 * someone is looking at. One file per board makes deleting a board deleting a file.
 */
export class Rooms {
	private readonly open = new Map<string, OpenRoom>()

	constructor(private readonly options: RoomsOptions) {
		mkdirSync(options.dir, { recursive: true })
	}

	connect(boardId: string, sessionId: string, socket: WebSocketMinimal): void {
		this.room(boardId).room.handleSocketConnect({ sessionId, socket })
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
		if (open && !open.room.isClosed()) return toBoardSnapshot(open.storage.getSnapshot())
		if (!existsSync(this.path(boardId))) return null
		const db = new DatabaseSync(this.path(boardId))
		try {
			return toBoardSnapshot(new SQLiteSyncStorage<TLRecord>({ sql: new NodeSqliteWrapper(db) }).getSnapshot())
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

	private room(boardId: string): OpenRoom {
		const existing = this.open.get(boardId)
		if (existing && !existing.room.isClosed()) return existing

		const db = new DatabaseSync(this.path(boardId))
		db.exec('PRAGMA journal_mode = WAL')
		const storage = new SQLiteSyncStorage<TLRecord>({ sql: new NodeSqliteWrapper(db) })
		storage.onChange(() => this.options.onChange(boardId))
		const room = new TLSocketRoom<TLRecord, void>({
			storage,
			schema: this.options.schema,
			...(this.options.log ? { log: this.options.log } : {}),
			onSessionRemoved: (_room, { numSessionsRemaining }) => {
				if (numSessionsRemaining === 0) this.close(boardId)
			},
		})
		const entry = { room, storage, db }
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

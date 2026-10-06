import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** The UI shows one server vault; every row carries the id so more can come without a migration. */
export const DEFAULT_VAULT = 'default'

export interface ServerBoard {
	id: string
	name: string
	createdAt: number
	updatedAt: number
	favorite: boolean
}

interface BoardRow {
	id: string
	name: string
	created_at: number
	updated_at: number
	favorite: number
}

const toBoard = (row: BoardRow): ServerBoard => ({
	id: row.id,
	name: row.name,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	favorite: row.favorite === 1,
})

/** The board index of the server vault. Board *content* lives in one room database per board. */
export class Vault {
	private readonly db: DatabaseSync

	constructor(path: string) {
		this.db = new DatabaseSync(path)
		this.db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS boards (
				vault_id TEXT NOT NULL,
				id TEXT NOT NULL,
				name TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				favorite INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (vault_id, id)
			);
			CREATE TABLE IF NOT EXISTS settings (
				vault_id TEXT NOT NULL,
				key TEXT NOT NULL,
				value TEXT NOT NULL,
				PRIMARY KEY (vault_id, key)
			);
		`)
	}

	list(): ServerBoard[] {
		const rows = this.db
			.prepare('SELECT * FROM boards WHERE vault_id = ? ORDER BY updated_at DESC')
			.all(DEFAULT_VAULT) as unknown as BoardRow[]
		return rows.map(toBoard)
	}

	get(id: string): ServerBoard | undefined {
		const row = this.db
			.prepare('SELECT * FROM boards WHERE vault_id = ? AND id = ?')
			.get(DEFAULT_VAULT, id) as unknown as BoardRow | undefined
		return row && toBoard(row)
	}

	/**
	 * `id` and the dates are optional so a board moving here from a local vault keeps its own: the same
	 * id, and the same place in the "recently edited" order.
	 */
	create({
		id = randomUUID(),
		name,
		createdAt,
		updatedAt,
	}: {
		id?: string
		name: string
		createdAt?: number
		updatedAt?: number
	}): ServerBoard {
		const now = Date.now()
		this.db
			.prepare('INSERT INTO boards (vault_id, id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
			.run(DEFAULT_VAULT, id, name, createdAt ?? now, updatedAt ?? now)
		return this.get(id)!
	}

	update(id: string, patch: { name?: string; favorite?: boolean }): ServerBoard | undefined {
		if (patch.name !== undefined) {
			this.db
				.prepare('UPDATE boards SET name = ?, updated_at = ? WHERE vault_id = ? AND id = ?')
				.run(patch.name, Date.now(), DEFAULT_VAULT, id)
		}
		// Favouriting is not editing, so it leaves `updated_at` (the "recently edited" order) alone.
		if (patch.favorite !== undefined) {
			this.db
				.prepare('UPDATE boards SET favorite = ? WHERE vault_id = ? AND id = ?')
				.run(patch.favorite ? 1 : 0, DEFAULT_VAULT, id)
		}
		return this.get(id)
	}

	touch(id: string, at = Date.now()): void {
		this.db.prepare('UPDATE boards SET updated_at = ? WHERE vault_id = ? AND id = ?').run(at, DEFAULT_VAULT, id)
	}

	delete(id: string): boolean {
		const result = this.db.prepare('DELETE FROM boards WHERE vault_id = ? AND id = ?').run(DEFAULT_VAULT, id)
		return result.changes > 0
	}

	/** Settings that follow the vault rather than the device, as stored JSON values. Unset keys are absent. */
	settings(): Record<string, unknown> {
		const rows = this.db
			.prepare('SELECT key, value FROM settings WHERE vault_id = ?')
			.all(DEFAULT_VAULT) as unknown as { key: string; value: string }[]
		return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]))
	}

	setSetting(key: string, value: unknown): void {
		this.db
			.prepare('INSERT INTO settings (vault_id, key, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value')
			.run(DEFAULT_VAULT, key, JSON.stringify(value))
	}

	close(): void {
		this.db.close()
	}
}

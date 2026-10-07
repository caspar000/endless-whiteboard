import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** The vault the boards were in before there were accounts: the first account's (`accounts.ts`). */
export const DEFAULT_VAULT = 'default'

export interface ServerBoard {
	id: string
	vaultId: string
	name: string
	createdAt: number
	updatedAt: number
}

interface BoardRow {
	vault_id: string
	id: string
	name: string
	created_at: number
	updated_at: number
}

const toBoard = (row: BoardRow): ServerBoard => ({
	id: row.id,
	vaultId: row.vault_id,
	name: row.name,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
})

/**
 * The board index of every vault on the server, and each vault's settings. Board *content* lives in
 * one room database per board, named by the board's id, which is unique across vaults. Stars are each
 * person's own (`accounts.ts`); the old `favorite` column is read once, when the first account is made.
 */
export class Vault {
	readonly db: DatabaseSync

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

	list(vaultId: string): ServerBoard[] {
		const rows = this.db
			.prepare('SELECT * FROM boards WHERE vault_id = ? ORDER BY updated_at DESC')
			.all(vaultId) as unknown as BoardRow[]
		return rows.map(toBoard)
	}

	/** Every board in every vault: what garbage collection must keep. */
	all(): ServerBoard[] {
		return (this.db.prepare('SELECT * FROM boards').all() as unknown as BoardRow[]).map(toBoard)
	}

	/** A board by id, whichever vault it is in. */
	get(id: string): ServerBoard | undefined {
		const row = this.db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as unknown as BoardRow | undefined
		return row && toBoard(row)
	}

	/**
	 * `id` and the dates are optional so a board moving here from a local vault keeps its own: the same
	 * id, and the same place in the "recently edited" order.
	 */
	create({
		vaultId,
		id = randomUUID(),
		name,
		createdAt,
		updatedAt,
	}: {
		vaultId: string
		id?: string
		name: string
		createdAt?: number
		updatedAt?: number
	}): ServerBoard {
		const now = Date.now()
		this.db
			.prepare('INSERT INTO boards (vault_id, id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
			.run(vaultId, id, name, createdAt ?? now, updatedAt ?? now)
		return this.get(id)!
	}

	rename(id: string, name: string): ServerBoard | undefined {
		this.db.prepare('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), id)
		return this.get(id)
	}

	touch(id: string, at = Date.now()): void {
		this.db.prepare('UPDATE boards SET updated_at = ? WHERE id = ?').run(at, id)
	}

	delete(id: string): boolean {
		return this.db.prepare('DELETE FROM boards WHERE id = ?').run(id).changes > 0
	}

	/** Settings that follow the vault rather than the device, as stored JSON values. Unset keys are absent. */
	settings(vaultId: string): Record<string, unknown> {
		const rows = this.db
			.prepare('SELECT key, value FROM settings WHERE vault_id = ?')
			.all(vaultId) as unknown as { key: string; value: string }[]
		return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]))
	}

	setSetting(vaultId: string, key: string, value: unknown): void {
		this.db
			.prepare('INSERT INTO settings (vault_id, key, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value')
			.run(vaultId, key, JSON.stringify(value))
	}

	close(): void {
		this.db.close()
	}
}

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
	/** Chosen in the app, `#rrggbb`; absent for the colour picked from the id. */
	color?: string
	/** An icon's name in the app's catalogue. */
	icon?: string
}

/** A change to a board's colour or icon; `null` clears one, a missing key leaves it alone. */
export interface BoardLook {
	color?: string | null
	icon?: string | null
}

interface BoardRow {
	vault_id: string
	id: string
	name: string
	created_at: number
	updated_at: number
	color: string | null
	icon: string | null
}

const toBoard = (row: BoardRow): ServerBoard => ({
	id: row.id,
	vaultId: row.vault_id,
	name: row.name,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	...(row.color ? { color: row.color } : {}),
	...(row.icon ? { icon: row.icon } : {}),
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
		// Added after the table: a vault made before them gains the columns, empty.
		const columns = new Set(
			(this.db.prepare('PRAGMA table_info(boards)').all() as unknown as { name: string }[]).map((c) => c.name)
		)
		for (const column of ['color', 'icon']) {
			if (!columns.has(column)) this.db.exec(`ALTER TABLE boards ADD COLUMN ${column} TEXT`)
		}
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
		color,
		icon,
	}: {
		vaultId: string
		id?: string
		name: string
		createdAt?: number
		updatedAt?: number
		color?: string
		icon?: string
	}): ServerBoard {
		const now = Date.now()
		this.db
			.prepare(
				'INSERT INTO boards (vault_id, id, name, created_at, updated_at, color, icon) VALUES (?, ?, ?, ?, ?, ?, ?)'
			)
			.run(vaultId, id, name, createdAt ?? now, updatedAt ?? now, color ?? null, icon ?? null)
		return this.get(id)!
	}

	/** Leaves `updated_at` alone, like a star: how a board looks in the list is not an edit to it. */
	setLook(id: string, look: BoardLook): ServerBoard | undefined {
		for (const key of ['color', 'icon'] as const) {
			if (look[key] !== undefined) this.db.prepare(`UPDATE boards SET ${key} = ? WHERE id = ?`).run(look[key], id)
		}
		return this.get(id)
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

	/** A vault is gone: its settings with it. Its boards are deleted one by one first. */
	forgetVault(vaultId: string): void {
		this.db.prepare('DELETE FROM settings WHERE vault_id = ?').run(vaultId)
	}

	close(): void {
		this.db.close()
	}
}

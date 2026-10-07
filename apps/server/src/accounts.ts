import { randomBytes, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_VAULT } from './vault.ts'

/**
 * People, their vaults, and who else may open a board (docs/fork-parity.md, phase 4).
 *
 * Every account belongs to one vault: its own, or one it was invited into. Everyone in a vault sees and
 * edits all of its boards. A single board can also be shared outside its vault with a link, to view or
 * to edit; opening the link while logged in adds the board to that person's list.
 *
 * A vault has owners and members. Members invite people in with a link. Owners also make accounts
 * directly, with a password the new person must replace when they first log in. Owners can also change
 * who else is an owner, remove people, and rename the vault. An admin can also invite someone to a vault
 * of their own, which they then own. The first account is made from the password the server was set up
 * with (`LIFEBOARD_PASSWORD_HASH`), in the vault the boards were already in.
 */

export interface User {
	id: string
	username: string
	displayName: string
	vaultId: string
	isAdmin: boolean
	vaultRole: VaultRole
	/** Logged in with a password someone else chose: they must choose their own before anything else. */
	mustChangePassword: boolean
	createdAt: number
	passwordHash: string
	/** Sessions begun before this are over: set when the password changes. */
	sessionsValidFrom: number
}

export type VaultRole = 'owner' | 'member'

export interface VaultInfo {
	id: string
	name: string
}

/** How someone stands with a board: in its vault, or shared it to edit or to view. */
export type BoardRole = 'member' | 'edit' | 'view'
export type ShareRole = 'edit' | 'view'

export interface Invite {
	token: string
	kind: 'join' | 'new-vault'
	vaultId: string | null
	createdBy: string
	createdAt: number
	expiresAt: number
	usedBy: string | null
}

export interface Share {
	id: string
	token: string
	boardId: string
	vaultId: string
	role: ShareRole
	createdBy: string
	createdAt: number
	revokedAt: number | null
}

/** Who opened a share link, and through which. */
export interface Grant {
	userId: string
	username: string
	displayName: string
	shareId: string
	role: ShareRole
	addedAt: number
}

const INVITE_DAYS = 7
export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/i
export const MAX_DISPLAY_NAME = 60

interface UserRow {
	id: string
	username: string
	display_name: string
	vault_id: string
	is_admin: number
	vault_role: VaultRole
	must_change_password: number
	created_at: number
	password_hash: string
	sessions_valid_from: number
}

const toUser = (row: UserRow): User => ({
	id: row.id,
	username: row.username,
	displayName: row.display_name,
	vaultId: row.vault_id,
	isAdmin: row.is_admin === 1,
	vaultRole: row.vault_role,
	mustChangePassword: row.must_change_password === 1,
	createdAt: row.created_at,
	passwordHash: row.password_hash,
	sessionsValidFrom: row.sessions_valid_from,
})

interface InviteRow {
	token: string
	kind: 'join' | 'new-vault'
	vault_id: string | null
	created_by: string
	created_at: number
	expires_at: number
	used_by: string | null
}

const toInvite = (row: InviteRow): Invite => ({
	token: row.token,
	kind: row.kind,
	vaultId: row.vault_id,
	createdBy: row.created_by,
	createdAt: row.created_at,
	expiresAt: row.expires_at,
	usedBy: row.used_by,
})

interface ShareRow {
	id: string
	token: string
	board_id: string
	vault_id: string
	role: ShareRole
	created_by: string
	created_at: number
	revoked_at: number | null
}

const toShare = (row: ShareRow): Share => ({
	id: row.id,
	token: row.token,
	boardId: row.board_id,
	vaultId: row.vault_id,
	role: row.role,
	createdBy: row.created_by,
	createdAt: row.created_at,
	revokedAt: row.revoked_at,
})

/** A link's secret: long enough not to be guessed, short enough to paste. */
const newToken = () => randomBytes(24).toString('base64url')

export class Accounts {
	constructor(private readonly db: DatabaseSync) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS vaults (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS users (
				id TEXT PRIMARY KEY,
				username TEXT NOT NULL UNIQUE COLLATE NOCASE,
				display_name TEXT NOT NULL,
				vault_id TEXT NOT NULL,
				is_admin INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL,
				password_hash TEXT NOT NULL,
				sessions_valid_from INTEGER NOT NULL DEFAULT 0,
				vault_role TEXT NOT NULL DEFAULT 'member',
				must_change_password INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS former_users (
				id TEXT PRIMARY KEY,
				vault_id TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS invites (
				token TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				vault_id TEXT,
				created_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				used_by TEXT,
				used_at INTEGER
			);
			CREATE TABLE IF NOT EXISTS shares (
				id TEXT PRIMARY KEY,
				token TEXT NOT NULL UNIQUE,
				board_id TEXT NOT NULL,
				vault_id TEXT NOT NULL,
				role TEXT NOT NULL,
				created_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				revoked_at INTEGER
			);
			CREATE TABLE IF NOT EXISTS board_access (
				user_id TEXT NOT NULL,
				board_id TEXT NOT NULL,
				share_id TEXT NOT NULL,
				added_at INTEGER NOT NULL,
				PRIMARY KEY (user_id, board_id)
			);
			CREATE TABLE IF NOT EXISTS favorites (
				user_id TEXT NOT NULL,
				board_id TEXT NOT NULL,
				PRIMARY KEY (user_id, board_id)
			);
		`)
		const columns = new Set((db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((column) => column.name))
		if (!columns.has('vault_role')) {
			db.exec("ALTER TABLE users ADD COLUMN vault_role TEXT NOT NULL DEFAULT 'member'")
			// Each vault's first account is the one it was made for: the server's owner, or someone invited
			// with a vault of their own. They own it; whoever joined later is a member.
			db.exec(
				"UPDATE users SET vault_role = 'owner' WHERE created_at = (SELECT MIN(created_at) FROM users AS first WHERE first.vault_id = users.vault_id)"
			)
		}
		if (!columns.has('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0')
	}

	/**
	 * The first account, on a server that has none: the owner, with the password the server was set up
	 * with, in the vault the boards were already in, keeping their stars. Returns whether it made one.
	 */
	seedOwner(passwordHash: string | undefined): boolean {
		if (this.countUsers() > 0) return false
		if (!passwordHash) {
			throw new Error('Lifeboard server cannot start: it has no accounts yet, and LIFEBOARD_PASSWORD_HASH is not set to make the first.')
		}
		const now = Date.now()
		this.db.prepare('INSERT OR IGNORE INTO vaults (id, name, created_at) VALUES (?, ?, ?)').run(DEFAULT_VAULT, 'My vault', now)
		const owner = this.createUser({ username: 'owner', displayName: 'Owner', passwordHash, vaultId: DEFAULT_VAULT, isAdmin: true, vaultRole: 'owner' })
		// Stars were the vault's; they become the owner's own.
		this.db
			.prepare('INSERT OR IGNORE INTO favorites (user_id, board_id) SELECT ?, id FROM boards WHERE vault_id = ? AND favorite = 1')
			.run(owner.id, DEFAULT_VAULT)
		return true
	}

	countUsers(): number {
		return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
	}

	/** The account a session from before accounts belongs to: the first admin. */
	firstAdmin(): User | undefined {
		const row = this.db.prepare('SELECT * FROM users WHERE is_admin = 1 ORDER BY created_at LIMIT 1').get() as UserRow | undefined
		return row && toUser(row)
	}

	user(id: string): User | undefined {
		const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
		return row && toUser(row)
	}

	userByName(username: string): User | undefined {
		const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
		return row && toUser(row)
	}

	createUser(user: {
		username: string
		displayName: string
		passwordHash: string
		vaultId: string
		vaultRole: VaultRole
		isAdmin?: boolean
		mustChangePassword?: boolean
	}): User {
		const id = randomUUID()
		this.db
			.prepare(
				'INSERT INTO users (id, username, display_name, vault_id, vault_role, is_admin, must_change_password, created_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
			)
			.run(
				id,
				user.username,
				user.displayName,
				user.vaultId,
				user.vaultRole,
				user.isAdmin ? 1 : 0,
				user.mustChangePassword ? 1 : 0,
				Date.now(),
				user.passwordHash
			)
		return this.user(id)!
	}

	/** A new password ends every session begun before it, and says whether it is one to replace. */
	updateUser(
		id: string,
		patch: { username?: string; displayName?: string; vaultRole?: VaultRole; passwordHash?: string; mustChangePassword?: boolean }
	): User | undefined {
		if (patch.username !== undefined) this.db.prepare('UPDATE users SET username = ? WHERE id = ?').run(patch.username, id)
		if (patch.displayName !== undefined) this.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(patch.displayName, id)
		if (patch.vaultRole !== undefined) this.db.prepare('UPDATE users SET vault_role = ? WHERE id = ?').run(patch.vaultRole, id)
		if (patch.passwordHash !== undefined) {
			this.db
				.prepare('UPDATE users SET password_hash = ?, sessions_valid_from = ?, must_change_password = ? WHERE id = ?')
				.run(patch.passwordHash, Date.now(), patch.mustChangePassword ? 1 : 0, id)
		}
		return this.user(id)
	}

	/**
	 * An account is gone: with it go its stars, the boards shared with it and the invites it left open.
	 * Its vault remembers it was a member, so what it made and wrote is still credited to "a former
	 * member" rather than to no one.
	 */
	deleteUser(id: string): void {
		const user = this.user(id)
		if (!user) return
		this.db.prepare('INSERT OR IGNORE INTO former_users (id, vault_id) VALUES (?, ?)').run(id, user.vaultId)
		this.db.prepare('DELETE FROM favorites WHERE user_id = ?').run(id)
		this.db.prepare('DELETE FROM board_access WHERE user_id = ?').run(id)
		this.db.prepare('DELETE FROM invites WHERE created_by = ? AND used_by IS NULL').run(id)
		this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
	}

	/** The ids of the accounts a vault once had. */
	formerMembers(vaultId: string): string[] {
		return (this.db.prepare('SELECT id FROM former_users WHERE vault_id = ?').all(vaultId) as Array<{ id: string }>).map((row) => row.id)
	}

	members(vaultId: string): User[] {
		return (this.db.prepare('SELECT * FROM users WHERE vault_id = ? ORDER BY created_at').all(vaultId) as unknown as UserRow[]).map(toUser)
	}

	countOwners(vaultId: string): number {
		return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE vault_id = ? AND vault_role = 'owner'").get(vaultId) as { n: number }).n
	}

	vault(id: string): VaultInfo | undefined {
		return this.db.prepare('SELECT id, name FROM vaults WHERE id = ?').get(id) as VaultInfo | undefined
	}

	createVault(name: string): VaultInfo {
		const id = randomUUID()
		this.db.prepare('INSERT INTO vaults (id, name, created_at) VALUES (?, ?, ?)').run(id, name, Date.now())
		return this.vault(id)!
	}

	renameVault(id: string, name: string): void {
		this.db.prepare('UPDATE vaults SET name = ? WHERE id = ?').run(name, id)
	}

	/* ------------------------------------------------------------------------------------ invites */

	createInvite(invite: { kind: Invite['kind']; vaultId: string | null; createdBy: string }): Invite {
		const token = newToken()
		const now = Date.now()
		this.db
			.prepare('INSERT INTO invites (token, kind, vault_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
			.run(token, invite.kind, invite.vaultId, invite.createdBy, now, now + INVITE_DAYS * 24 * 60 * 60 * 1000)
		return this.invite(token)!
	}

	invite(token: string): Invite | undefined {
		const row = this.db.prepare('SELECT * FROM invites WHERE token = ?').get(token) as InviteRow | undefined
		return row && toInvite(row)
	}

	/** An invite that can still be used: not used, not expired, not withdrawn. */
	openInvite(token: string): Invite | undefined {
		const invite = this.invite(token)
		return invite && !invite.usedBy && invite.expiresAt > Date.now() ? invite : undefined
	}

	/** The invites someone made that are still open. */
	invitesBy(userId: string): Invite[] {
		return (
			this.db
				.prepare('SELECT * FROM invites WHERE created_by = ? AND used_by IS NULL AND expires_at > ? ORDER BY created_at DESC')
				.all(userId, Date.now()) as unknown as InviteRow[]
		).map(toInvite)
	}

	useInvite(token: string, userId: string): void {
		this.db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE token = ?').run(userId, Date.now(), token)
	}

	withdrawInvite(token: string, userId: string): boolean {
		return this.db.prepare('DELETE FROM invites WHERE token = ? AND created_by = ? AND used_by IS NULL').run(token, userId).changes > 0
	}

	/* ------------------------------------------------------------------------------------- shares */

	createShare(share: { boardId: string; vaultId: string; role: ShareRole; createdBy: string }): Share {
		const id = randomUUID()
		this.db
			.prepare('INSERT INTO shares (id, token, board_id, vault_id, role, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.run(id, newToken(), share.boardId, share.vaultId, share.role, share.createdBy, Date.now())
		return this.share(id)!
	}

	share(id: string): Share | undefined {
		const row = this.db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined
		return row && toShare(row)
	}

	/** A link that still works. */
	shareByToken(token: string): Share | undefined {
		const row = this.db.prepare('SELECT * FROM shares WHERE token = ? AND revoked_at IS NULL').get(token) as ShareRow | undefined
		return row && toShare(row)
	}

	sharesOf(boardId: string): Share[] {
		return (
			this.db
				.prepare('SELECT * FROM shares WHERE board_id = ? AND revoked_at IS NULL ORDER BY created_at')
				.all(boardId) as unknown as ShareRow[]
		).map(toShare)
	}

	/** Withdraws a link, and with it the access of everyone who came in through it. */
	revokeShare(id: string): void {
		this.db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(Date.now(), id)
		this.db.prepare('DELETE FROM board_access WHERE share_id = ?').run(id)
	}

	/** Someone opened a link: the board is on their list now. A later link replaces an earlier one. */
	grant(userId: string, share: Share): void {
		this.db
			.prepare(
				'INSERT INTO board_access (user_id, board_id, share_id, added_at) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET share_id = excluded.share_id, added_at = excluded.added_at'
			)
			.run(userId, share.boardId, share.id, Date.now())
	}

	removeAccess(userId: string, boardId: string): boolean {
		return this.db.prepare('DELETE FROM board_access WHERE user_id = ? AND board_id = ?').run(userId, boardId).changes > 0
	}

	/** Everyone a board is shared with, and how. */
	grantsOf(boardId: string): Grant[] {
		return (
			this.db
				.prepare(
					`SELECT u.id AS user_id, u.username, u.display_name, s.id AS share_id, s.role, a.added_at
					 FROM board_access a JOIN shares s ON s.id = a.share_id JOIN users u ON u.id = a.user_id
					 WHERE a.board_id = ? AND s.revoked_at IS NULL ORDER BY a.added_at`
				)
				.all(boardId) as unknown as Array<{ user_id: string; username: string; display_name: string; share_id: string; role: ShareRole; added_at: number }>
		).map((row) => ({
			userId: row.user_id,
			username: row.username,
			displayName: row.display_name,
			shareId: row.share_id,
			role: row.role,
			addedAt: row.added_at,
		}))
	}

	/** The boards shared with someone, from outside their vault, and how. */
	sharedWith(userId: string): Array<{ boardId: string; role: ShareRole }> {
		return (
			this.db
				.prepare(
					'SELECT a.board_id, s.role FROM board_access a JOIN shares s ON s.id = a.share_id WHERE a.user_id = ? AND s.revoked_at IS NULL'
				)
				.all(userId) as unknown as Array<{ board_id: string; role: ShareRole }>
		).map((row) => ({ boardId: row.board_id, role: row.role }))
	}

	/** How someone stands with a board in `boardVaultId`, or `null`: they may not open it. */
	roleFor(user: User, boardId: string, boardVaultId: string): BoardRole | null {
		if (user.vaultId === boardVaultId) return 'member'
		const row = this.db
			.prepare(
				'SELECT s.role FROM board_access a JOIN shares s ON s.id = a.share_id WHERE a.user_id = ? AND a.board_id = ? AND s.revoked_at IS NULL'
			)
			.get(user.id, boardId) as { role: ShareRole } | undefined
		return row?.role ?? null
	}

	/** A board is gone: its links and everyone's access and stars with it. */
	forgetBoard(boardId: string): void {
		this.db.prepare('UPDATE shares SET revoked_at = ? WHERE board_id = ? AND revoked_at IS NULL').run(Date.now(), boardId)
		this.db.prepare('DELETE FROM board_access WHERE board_id = ?').run(boardId)
		this.db.prepare('DELETE FROM favorites WHERE board_id = ?').run(boardId)
	}

	/* ---------------------------------------------------------------------------------- favourites */

	favorites(userId: string): Set<string> {
		const rows = this.db.prepare('SELECT board_id FROM favorites WHERE user_id = ?').all(userId) as Array<{ board_id: string }>
		return new Set(rows.map((row) => row.board_id))
	}

	setFavorite(userId: string, boardId: string, favorite: boolean): void {
		if (favorite) this.db.prepare('INSERT OR IGNORE INTO favorites (user_id, board_id) VALUES (?, ?)').run(userId, boardId)
		else this.db.prepare('DELETE FROM favorites WHERE user_id = ? AND board_id = ?').run(userId, boardId)
	}
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MAX_DISPLAY_NAME, USERNAME, type Accounts, type User, type VaultRole } from './accounts.ts'
import { MIN_PASSWORD } from './auth.ts'
import { hashPassword } from './password.ts'
import type { Rooms } from './rooms.ts'
import type { Thumbnails } from './thumbnails.ts'
import type { Vault } from './vault.ts'

const MAX_VAULT_NAME = 200

const isRole = (value: unknown): value is VaultRole => value === 'owner' || value === 'member'

/**
 * Settings → Server: the server admin's view of every account and vault. An admin creates accounts in
 * any vault or a new one, sets passwords (the person replaces it at their next login), makes others
 * admins, and deletes accounts and vaults. The server always keeps an admin, and every vault with
 * people in it keeps an owner.
 */
export function registerAdminApi(
	app: FastifyInstance,
	{ vault, accounts, rooms, thumbnails }: { vault: Vault; accounts: Accounts; rooms: Rooms; thumbnails: Thumbnails }
): void {
	/** The admin on the request, or a 403 sent. */
	const admin = (request: FastifyRequest, reply: FastifyReply): User | null => {
		if (request.user?.isAdmin) return request.user
		void reply.code(403).send({ error: 'Only the server’s admin can do that.' })
		return null
	}

	const account = (user: User) => ({
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		vaultId: user.vaultId,
		role: user.vaultRole,
		isAdmin: user.isAdmin,
		createdAt: user.createdAt,
	})

	/** Why a name or username can't be used, or `null`. `self` may keep its own username. */
	const nameProblem = (displayName: unknown, username: unknown, self?: string): string | null => {
		if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.length > MAX_DISPLAY_NAME)) {
			return 'A name is 1 to 60 characters.'
		}
		if (username !== undefined) {
			if (typeof username !== 'string' || !USERNAME.test(username)) {
				return 'A username is 2 to 32 letters, digits, dots, dashes or underscores.'
			}
			const taken = accounts.userByName(username)
			if (taken && taken.id !== self) return 'That username is taken.'
		}
		return null
	}

	/** A board and everything kept for it: its file, preview, links and stars. */
	const deleteBoard = (id: string) => {
		vault.delete(id)
		accounts.forgetBoard(id)
		rooms.delete(id)
		thumbnails.delete(id)
	}

	/** An account, and its live connections with it. */
	const deleteAccount = (id: string) => {
		accounts.deleteUser(id)
		rooms.disconnectUser(id)
	}

	/** A vault, its boards, and anyone still in it. */
	const deleteVault = (id: string) => {
		for (const member of accounts.members(id)) deleteAccount(member.id)
		for (const board of vault.list(id)) deleteBoard(board.id)
		vault.forgetVault(id)
		accounts.deleteVault(id)
	}

	app.get('/api/admin/accounts', async (request, reply) => {
		if (!admin(request, reply)) return reply
		return accounts.allUsers().map(account)
	})

	app.get('/api/admin/vaults', async (request, reply) => {
		if (!admin(request, reply)) return reply
		return accounts.vaults().map((info) => ({
			...info,
			members: accounts.members(info.id).length,
			boards: vault.list(info.id).length,
		}))
	})

	/** An account in any vault, or a new one; its first login asks for a password of its own. */
	app.post<{
		Body: { username?: unknown; displayName?: unknown; password?: unknown; vaultId?: unknown; newVault?: unknown; role?: unknown; isAdmin?: unknown }
	}>('/api/admin/accounts', async (request, reply) => {
		if (!admin(request, reply)) return reply
		const { username, displayName, password, vaultId, newVault, role, isAdmin } = request.body ?? {}
		const problem = nameProblem(displayName ?? '', username ?? '')
		if (problem) return reply.code(problem.includes('taken') ? 409 : 400).send({ error: problem })
		if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
			return reply.code(400).send({ error: `A password is ${MIN_PASSWORD} characters or more.` })
		}
		if (!isRole(role)) return reply.code(400).send({ error: '`role` is owner or member.' })
		let target: string
		if (typeof newVault === 'string') {
			if (!newVault.trim() || newVault.length > MAX_VAULT_NAME) return reply.code(400).send({ error: 'A vault needs a name.' })
			target = accounts.createVault(newVault.trim()).id
		} else if (typeof vaultId === 'string' && accounts.vault(vaultId)) {
			target = vaultId
		} else {
			return reply.code(400).send({ error: 'Choose a vault, or name a new one.' })
		}
		const made = accounts.createUser({
			username: username as string,
			displayName: (displayName as string).trim(),
			passwordHash: await hashPassword(password),
			vaultId: target,
			vaultRole: role,
			isAdmin: isAdmin === true,
			mustChangePassword: true,
		})
		return reply.code(201).send(account(made))
	})

	/** Names, role, admin, or a new password that logs them out and is theirs to replace. */
	app.patch<{
		Params: { id: string }
		Body: { username?: unknown; displayName?: unknown; role?: unknown; isAdmin?: unknown; password?: unknown }
	}>('/api/admin/accounts/:id', async (request, reply) => {
		const me = admin(request, reply)
		if (!me) return reply
		const target = accounts.user(request.params.id)
		if (!target) return reply.code(404).send({ error: 'No such account.' })
		const { username, displayName, role, isAdmin, password } = request.body ?? {}
		const problem = nameProblem(displayName, username, target.id)
		if (problem) return reply.code(problem.includes('taken') ? 409 : 400).send({ error: problem })
		if (role !== undefined && !isRole(role)) return reply.code(400).send({ error: '`role` is owner or member.' })
		if (role === 'member' && target.vaultRole === 'owner' && accounts.countOwners(target.vaultId) <= 1) {
			return reply.code(409).send({ error: 'A vault keeps at least one owner.' })
		}
		if (isAdmin !== undefined && typeof isAdmin !== 'boolean') return reply.code(400).send({ error: '`isAdmin` is true or false.' })
		if (isAdmin === false && target.isAdmin && accounts.countAdmins() <= 1) {
			return reply.code(409).send({ error: 'The server keeps at least one admin.' })
		}
		if (password !== undefined && (typeof password !== 'string' || password.length < MIN_PASSWORD)) {
			return reply.code(400).send({ error: `A password is ${MIN_PASSWORD} characters or more.` })
		}
		const changed = accounts.updateUser(target.id, {
			...(typeof username === 'string' ? { username } : {}),
			...(typeof displayName === 'string' ? { displayName: displayName.trim() } : {}),
			...(isRole(role) ? { vaultRole: role } : {}),
			...(typeof isAdmin === 'boolean' ? { isAdmin } : {}),
			...(typeof password === 'string' ? { passwordHash: await hashPassword(password), mustChangePassword: true } : {}),
		})!
		if (typeof password === 'string') rooms.disconnectUser(target.id)
		return account(changed)
	})

	/**
	 * Deletes an account. The last owner of a vault others are still in needs `newOwner`, one of them.
	 * The last person in a vault takes it along only with `deleteVault=1`; otherwise it stays, empty.
	 */
	app.delete<{ Params: { id: string }; Querystring: { newOwner?: string; deleteVault?: string } }>(
		'/api/admin/accounts/:id',
		async (request, reply) => {
			const me = admin(request, reply)
			if (!me) return reply
			const target = accounts.user(request.params.id)
			if (!target) return reply.code(404).send({ error: 'No such account.' })
			if (target.id === me.id) return reply.code(400).send({ error: 'You can’t delete your own account.' })
			const others = accounts.members(target.vaultId).filter((member) => member.id !== target.id)
			if (target.vaultRole === 'owner' && others.length && !others.some((member) => member.vaultRole === 'owner')) {
				const next = others.find((member) => member.id === request.query.newOwner)
				if (!next) return reply.code(409).send({ error: 'Choose who owns the vault next.' })
				accounts.updateUser(next.id, { vaultRole: 'owner' })
			}
			deleteAccount(target.id)
			if (!others.length && request.query.deleteVault === '1') deleteVault(target.vaultId)
			return reply.code(204).send()
		}
	)

	app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/admin/vaults/:id', async (request, reply) => {
		if (!admin(request, reply)) return reply
		if (!accounts.vault(request.params.id)) return reply.code(404).send({ error: 'No such vault.' })
		const { name } = request.body ?? {}
		if (typeof name !== 'string' || !name.trim() || name.length > MAX_VAULT_NAME) return reply.code(400).send({ error: 'A vault needs a name.' })
		accounts.renameVault(request.params.id, name.trim())
		return reply.code(204).send()
	})

	/** A vault, with its boards and the accounts in it. Never the admin's own. */
	app.delete<{ Params: { id: string } }>('/api/admin/vaults/:id', async (request, reply) => {
		const me = admin(request, reply)
		if (!me) return reply
		if (!accounts.vault(request.params.id)) return reply.code(404).send({ error: 'No such vault.' })
		if (request.params.id === me.vaultId) return reply.code(400).send({ error: 'You can’t delete the vault you’re in.' })
		deleteVault(request.params.id)
		return reply.code(204).send()
	})
}

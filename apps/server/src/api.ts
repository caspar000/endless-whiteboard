import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MAX_DISPLAY_NAME, USERNAME, type Accounts, type BoardRole, type ShareRole, type User } from './accounts.ts'
import { isAssetHash, type AssetFiles } from './assets.ts'
import { MIN_PASSWORD, startSession } from './auth.ts'
import { deadLinkPage } from './loginPage.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { exportVault } from './exportZip.ts'
import type { Rooms } from './rooms.ts'
import { THEMES, type Theme, type Thumbnails } from './thumbnails.ts'
import type { ServerBoard, Vault } from './vault.ts'

/** Board ids become file names, so only what a UUID can contain. */
const BOARD_ID = /^[A-Za-z0-9-]{1,64}$/
const MAX_NAME = 200
/** The app refuses imports over 64 MB (`MAX_IMPORT_BYTES`); a little over that, for headroom. */
const MAX_ASSET_BYTES = 80 * 1024 * 1024
/** A board's records without its files; the largest real board is well under this. */
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
/** A card's preview: 600 px on its long edge, as WebP. Far under this. */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
/** Enough for every asset on a large board in one question. */
const MAX_HASHES_PER_QUERY = 5000

const isTheme = (value: string): value is Theme => (THEMES as readonly string[]).includes(value)

const isName = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME

const isSnapshot = (value: unknown): value is { store: Record<string, unknown>; schema: unknown } =>
	!!value &&
	typeof value === 'object' &&
	!!(value as { store?: unknown }).store &&
	typeof (value as { store?: unknown }).store === 'object' &&
	!!(value as { schema?: unknown }).schema

/** A board's own date, kept when it moves here: a time in the past, give or take a clock's drift. */
const isPastTime = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < Date.now() + 24 * 60 * 60 * 1000

const isStringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * The settings that follow the vault rather than the device, and what each must look like. Anything
 * else is refused: the client applies these straight into its registries.
 */
const VAULT_SETTINGS: Record<string, (value: unknown) => boolean> = {
	disabledExtensions: isStringArray,
	savedQueries: (value) =>
		Array.isArray(value) &&
		value.every(
			(q) => q && typeof q === 'object' && typeof q.name === 'string' && typeof q.body === 'string'
		),
}

/**
 * The API, per account: its vault's boards and settings, the boards shared with it, its invites and
 * links, and the sync socket for each board it may open (`accounts.ts` has the model).
 */
export function registerApi(
	app: FastifyInstance,
	{
		vault,
		accounts,
		rooms,
		assets,
		thumbnails,
		appVersion,
		secureCookies,
	}: {
		vault: Vault
		accounts: Accounts
		rooms: Rooms
		assets: AssetFiles
		thumbnails: Thumbnails
		appVersion: string
		secureCookies: boolean
	}
): void {
	/** The account on the request; the auth hook has turned away anyone without one. */
	const me = (request: FastifyRequest): User => request.user!

	/** A board this account may open, and how; or a 404 sent (a board you can't open doesn't exist to you). */
	const access = (request: FastifyRequest, reply: FastifyReply, id: string, need: 'view' | 'edit' | 'member' = 'view') => {
		const board = BOARD_ID.test(id) ? vault.get(id) : undefined
		const role = board ? accounts.roleFor(me(request), board.id, board.vaultId) : null
		if (!board || !role) {
			void reply.code(404).send({ error: 'No such board.' })
			return null
		}
		if ((need === 'edit' && role === 'view') || (need === 'member' && role !== 'member')) {
			void reply.code(403).send({ error: need === 'member' ? 'Only its vault can do that.' : 'This board is shared with you to view.' })
			return null
		}
		return { board, role }
	}

	/** A board as the app lists it: with this person's star, and how it's shared with them if it is. */
	const listed = (user: User, board: ServerBoard, role: BoardRole, favorites: Set<string>) => ({
		id: board.id,
		name: board.name,
		createdAt: board.createdAt,
		updatedAt: board.updatedAt,
		favorite: favorites.has(board.id),
		role,
		...(role === 'member' ? {} : { sharedBy: accounts.vault(board.vaultId)?.name ?? 'another vault' }),
	})

	const publicUser = (user: User) => ({ id: user.id, username: user.username, displayName: user.displayName })

	/* ------------------------------------------------------------------------------------ account */

	app.get('/api/me', async (request) => {
		const user = me(request)
		return { ...publicUser(user), isAdmin: user.isAdmin, vault: accounts.vault(user.vaultId) }
	})

	app.patch<{ Body: { username?: unknown; displayName?: unknown } }>('/api/me', async (request, reply) => {
		const { username, displayName } = request.body ?? {}
		if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.length > MAX_DISPLAY_NAME)) {
			return reply.code(400).send({ error: 'A name is 1 to 60 characters.' })
		}
		if (username !== undefined) {
			if (typeof username !== 'string' || !USERNAME.test(username)) {
				return reply.code(400).send({ error: 'A username is 2 to 32 letters, digits, dots, dashes or underscores.' })
			}
			const taken = accounts.userByName(username)
			if (taken && taken.id !== me(request).id) return reply.code(409).send({ error: 'That username is taken.' })
		}
		const user = accounts.updateUser(me(request).id, {
			...(typeof username === 'string' ? { username } : {}),
			...(typeof displayName === 'string' ? { displayName: displayName.trim() } : {}),
		})!
		return publicUser(user)
	})

	/** A new password ends every other session; this one carries on, with a fresh cookie. */
	app.post<{ Body: { current?: unknown; next?: unknown } }>('/api/me/password', async (request, reply) => {
		const { current, next } = request.body ?? {}
		if (typeof current !== 'string' || !(await verifyPassword(current, me(request).passwordHash))) {
			return reply.code(403).send({ error: 'That isn’t your current password.' })
		}
		if (typeof next !== 'string' || next.length < MIN_PASSWORD) {
			return reply.code(400).send({ error: `A password is ${MIN_PASSWORD} characters or more.` })
		}
		const user = accounts.updateUser(me(request).id, { passwordHash: await hashPassword(next) })!
		startSession(reply, user, secureCookies)
		return reply.code(204).send()
	})

	/* -------------------------------------------------------------------------------------- vault */

	app.get('/api/vault', async (request) => {
		const user = me(request)
		return { ...accounts.vault(user.vaultId), members: accounts.members(user.vaultId).map(publicUser) }
	})

	app.patch<{ Body: { name?: unknown } }>('/api/vault', async (request, reply) => {
		const { name } = request.body ?? {}
		if (!isName(name)) return reply.code(400).send({ error: 'A vault needs a name.' })
		accounts.renameVault(me(request).vaultId, name.trim())
		return accounts.vault(me(request).vaultId)
	})

	/** Invites this account made that are still open. */
	app.get('/api/invites', async (request) =>
		accounts.invitesBy(me(request).id).map(({ token, kind, createdAt, expiresAt }) => ({ token, kind, createdAt, expiresAt }))
	)

	/** An invite into this vault; or, from an admin, to a vault of the invitee's own. */
	app.post<{ Body: { kind?: unknown } }>('/api/invites', async (request, reply) => {
		const user = me(request)
		const kind = request.body?.kind ?? 'join'
		if (kind !== 'join' && kind !== 'new-vault') return reply.code(400).send({ error: '`kind` is join or new-vault.' })
		if (kind === 'new-vault' && !user.isAdmin) return reply.code(403).send({ error: 'Only an admin can invite someone to a vault of their own.' })
		const { token, createdAt, expiresAt } = accounts.createInvite({ kind, vaultId: kind === 'join' ? user.vaultId : null, createdBy: user.id })
		return reply.code(201).send({ token, kind, createdAt, expiresAt })
	})

	app.delete<{ Params: { token: string } }>('/api/invites/:token', async (request, reply) => {
		if (!accounts.withdrawInvite(request.params.token, me(request).id)) return reply.code(404).send({ error: 'No such invite.' })
		return reply.code(204).send()
	})

	/* ------------------------------------------------------------------------------------- boards */

	/** This vault's boards, then the ones shared with this account from others. */
	app.get('/api/boards', async (request) => {
		const user = me(request)
		const favorites = accounts.favorites(user.id)
		const own = vault.list(user.vaultId).map((board) => listed(user, board, 'member', favorites))
		const shared = accounts.sharedWith(user.id).flatMap(({ boardId, role }) => {
			const board = vault.get(boardId)
			return board && board.vaultId !== user.vaultId ? [listed(user, board, role, favorites)] : []
		})
		return [...own, ...shared]
	})

	/**
	 * A new board in this vault, empty or — when it arrives from a local vault — with `snapshot` as its
	 * content (`{ store, schema }`, already migrated to the current schema by the app).
	 */
	app.post<{
		Body: { id?: unknown; name?: unknown; favorite?: unknown; snapshot?: unknown; createdAt?: unknown; updatedAt?: unknown }
	}>(
		'/api/boards',
		{ bodyLimit: MAX_SNAPSHOT_BYTES },
		async (request, reply) => {
			const user = me(request)
			const { id, name, favorite, snapshot, createdAt, updatedAt } = request.body ?? {}
			if (!isName(name)) return reply.code(400).send({ error: 'A board needs a name.' })
			if (id !== undefined && (typeof id !== 'string' || !BOARD_ID.test(id))) {
				return reply.code(400).send({ error: 'Not a valid board id.' })
			}
			if (snapshot !== undefined && !isSnapshot(snapshot)) {
				return reply.code(400).send({ error: '`snapshot` is { store, schema }.' })
			}
			for (const date of [createdAt, updatedAt]) {
				if (date !== undefined && !isPastTime(date)) return reply.code(400).send({ error: 'Dates are milliseconds, in the past.' })
			}
			// Ids are unique across vaults: a board's content is filed under its id alone.
			if (typeof id === 'string' && vault.get(id)) return reply.code(409).send({ error: 'That board already exists.' })
			const board = vault.create({
				vaultId: user.vaultId,
				...(typeof id === 'string' ? { id } : {}),
				name,
				...(typeof createdAt === 'number' ? { createdAt } : {}),
				...(typeof updatedAt === 'number' ? { updatedAt } : {}),
			})
			if (snapshot) {
				try {
					rooms.seed(board.id, snapshot)
				} catch (error) {
					vault.delete(board.id)
					rooms.delete(board.id)
					return reply.code(400).send({ error: `That board's content could not be stored: ${String(error)}` })
				}
			}
			if (favorite === true) accounts.setFavorite(user.id, board.id, true)
			return reply.code(201).send(listed(user, board, 'member', accounts.favorites(user.id)))
		}
	)

	/** A board's content as it is now, for moving it to a local vault. */
	app.get<{ Params: { id: string } }>('/api/boards/:id/snapshot', async (request, reply) => {
		if (!access(request, reply, request.params.id)) return reply
		// A board nobody has opened yet has no records; an empty store loads as an empty board.
		return rooms.readSnapshot(request.params.id) ?? { store: {}, schema: null }
	})

	/** Renaming is the vault's; a star is anyone's own. */
	app.patch<{ Params: { id: string }; Body: { name?: unknown; favorite?: unknown } }>(
		'/api/boards/:id',
		async (request, reply) => {
			const { name, favorite } = request.body ?? {}
			if (name !== undefined && !isName(name)) return reply.code(400).send({ error: 'A board needs a name.' })
			if (favorite !== undefined && typeof favorite !== 'boolean') {
				return reply.code(400).send({ error: '`favorite` is true or false.' })
			}
			const found = access(request, reply, request.params.id, name !== undefined ? 'member' : 'view')
			if (!found) return reply
			const board = name !== undefined ? vault.rename(found.board.id, name)! : found.board
			if (favorite !== undefined) accounts.setFavorite(me(request).id, board.id, favorite)
			return listed(me(request), board, found.role, accounts.favorites(me(request).id))
		}
	)

	app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
		if (!access(request, reply, request.params.id, 'member')) return reply
		vault.delete(request.params.id)
		accounts.forgetBoard(request.params.id)
		rooms.delete(request.params.id)
		thumbnails.delete(request.params.id)
		return reply.code(204).send()
	})

	/* ------------------------------------------------------------------------------------- shares */

	const shareView = (share: { id: string; token: string; role: ShareRole; createdAt: number }) => ({
		id: share.id,
		token: share.token,
		role: share.role,
		createdAt: share.createdAt,
	})

	/** A board's links, and who came in through them. */
	app.get<{ Params: { id: string } }>('/api/boards/:id/shares', async (request, reply) => {
		if (!access(request, reply, request.params.id, 'member')) return reply
		return {
			links: accounts.sharesOf(request.params.id).map(shareView),
			people: accounts.grantsOf(request.params.id).map(({ userId, displayName, username, role, addedAt }) => ({
				id: userId,
				displayName,
				username,
				role,
				addedAt,
			})),
		}
	})

	app.post<{ Params: { id: string }; Body: { role?: unknown } }>('/api/boards/:id/shares', async (request, reply) => {
		const found = access(request, reply, request.params.id, 'member')
		if (!found) return reply
		const role = request.body?.role
		if (role !== 'view' && role !== 'edit') return reply.code(400).send({ error: '`role` is view or edit.' })
		const share = accounts.createShare({ boardId: found.board.id, vaultId: found.board.vaultId, role, createdBy: me(request).id })
		return reply.code(201).send(shareView(share))
	})

	/** Withdraws a link: whoever came in through it loses the board. */
	app.delete<{ Params: { id: string } }>('/api/shares/:id', async (request, reply) => {
		const share = accounts.share(request.params.id)
		if (!share || share.revokedAt || share.vaultId !== me(request).vaultId) return reply.code(404).send({ error: 'No such link.' })
		accounts.revokeShare(share.id)
		return reply.code(204).send()
	})

	/** Takes someone off a board: the vault removing a person, or anyone leaving a board shared with them. */
	app.delete<{ Params: { id: string; userId: string } }>('/api/boards/:id/access/:userId', async (request, reply) => {
		const self = request.params.userId === 'me' || request.params.userId === me(request).id
		if (!access(request, reply, request.params.id, self ? 'view' : 'member')) return reply
		accounts.removeAccess(self ? me(request).id : request.params.userId, request.params.id)
		return reply.code(204).send()
	})

	/** Following a share link: the board joins this account's list, and opens. */
	app.get<{ Params: { token: string } }>('/share/:token', async (request, reply) => {
		const share = accounts.shareByToken(request.params.token)
		const board = share && vault.get(share.boardId)
		if (!share || !board) {
			return reply
				.code(404)
				.type('text/html; charset=utf-8')
				.send(deadLinkPage('This link no longer works: it was withdrawn, or the board was deleted.'))
		}
		if (me(request).vaultId !== board.vaultId) accounts.grant(me(request).id, share)
		return reply.redirect(`/#/board/${encodeURIComponent(board.id)}`)
	})

	/* --------------------------------------------------------------------------------- previews */

	app.addContentTypeParser('image/webp', { parseAs: 'buffer', bodyLimit: MAX_THUMBNAIL_BYTES }, (_request, body, done) =>
		done(null, body)
	)

	/**
	 * A board's preview in one theme, as whichever device last drew one sent it. `x-drawn-at` says when,
	 * against the board's `updatedAt`, both by this server's clock.
	 */
	app.get<{ Params: { id: string; theme: string } }>('/api/boards/:id/thumbnail/:theme', async (request, reply) => {
		const { id, theme } = request.params
		if (!access(request, reply, id)) return reply
		const found = isTheme(theme) ? thumbnails.read(id, theme) : null
		if (!found) return reply.code(404).send({ error: 'No preview yet.' })
		return reply
			.header('content-type', 'image/webp')
			.header('cache-control', 'no-cache')
			.header('x-drawn-at', String(found.drawnAt))
			.send(found.bytes)
	})

	app.put<{ Params: { id: string; theme: string }; Body: Buffer }>('/api/boards/:id/thumbnail/:theme', async (request, reply) => {
		const { id, theme } = request.params
		if (!isTheme(theme)) return reply.code(404).send({ error: 'Previews are light or dark.' })
		if (!access(request, reply, id, 'edit')) return reply
		const body = request.body
		// WebP files start "RIFF....WEBP": anything else is not a preview this app drew.
		if (!Buffer.isBuffer(body) || body.subarray(0, 4).toString() !== 'RIFF' || body.subarray(8, 12).toString() !== 'WEBP') {
			return reply.code(400).send({ error: 'A preview is a WebP image.' })
		}
		thumbnails.write(id, theme, body)
		return reply.code(204).send()
	})

	/* -------------------------------------------------------------------------------------- files */

	app.addContentTypeParser(
		'application/octet-stream',
		{ parseAs: 'buffer', bodyLimit: MAX_ASSET_BYTES },
		(_request, body, done) => done(null, body)
	)

	/**
	 * Files are stored by the hash of their bytes, shared by every vault: knowing a hash is knowing the
	 * file, so a logged-in account may read any it can name, and a file is uploaded once however many
	 * boards use it.
	 */
	app.post<{ Body: { hashes?: unknown } }>('/api/assets/missing', async (request, reply) => {
		const hashes = request.body?.hashes
		if (!Array.isArray(hashes) || hashes.length > MAX_HASHES_PER_QUERY || !hashes.every((h) => typeof h === 'string' && isAssetHash(h))) {
			return reply.code(400).send({ error: '`hashes` is a list of SHA-256 hex strings.' })
		}
		return { missing: hashes.filter((hash) => !assets.has(hash)) }
	})

	app.put<{ Params: { hash: string }; Body: Buffer }>('/api/assets/:hash', async (request, reply) => {
		const { hash } = request.params
		if (!isAssetHash(hash)) return reply.code(400).send({ error: 'Not an asset hash.' })
		if (!Buffer.isBuffer(request.body)) return reply.code(415).send({ error: 'Send the bytes as application/octet-stream.' })
		if (!assets.put(hash, request.body)) return reply.code(422).send({ error: 'The bytes do not match that hash.' })
		return reply.code(204).send()
	})

	app.get<{ Params: { hash: string } }>('/api/assets/:hash', async (request, reply) => {
		const { hash } = request.params
		if (!isAssetHash(hash) || !assets.has(hash)) return reply.code(404).send({ error: 'No such asset.' })
		return reply
			// Content-addressed: the bytes behind this URL can never change.
			.header('cache-control', 'private, max-age=31536000, immutable')
			// Opaque bytes, never rendered by the browser as a page: an uploaded SVG or HTML file must not
			// run as this origin. The app reads these through fetch and makes its own object URLs.
			.header('content-type', 'application/octet-stream')
			.header('x-content-type-options', 'nosniff')
			.header('content-disposition', 'attachment')
			.header('content-length', assets.size(hash))
			.send(assets.read(hash))
	})

	/** This vault's boards and their files, as a backup. Boards shared with you are their vault's to keep. */
	app.get('/api/export', async (request, reply) => {
		const user = me(request)
		const date = new Date().toISOString().slice(0, 10)
		return reply
			.header('content-type', 'application/zip')
			.header('content-disposition', `attachment; filename="lifeboard-server-${date}.zip"`)
			.send(exportVault(vault, rooms, assets, appVersion, { vaultId: user.vaultId, favorites: accounts.favorites(user.id) }))
	})

	app.get('/api/vault/settings', async (request) => vault.settings(me(request).vaultId))

	app.put<{ Params: { key: string }; Body: { value?: unknown } }>(
		'/api/vault/settings/:key',
		async (request, reply) => {
			// `hasOwn`, or `constructor` and friends would arrive from the prototype as validators.
			const valid = Object.hasOwn(VAULT_SETTINGS, request.params.key) ? VAULT_SETTINGS[request.params.key] : undefined
			if (!valid) return reply.code(404).send({ error: 'No such setting.' })
			if (!valid(request.body?.value)) return reply.code(400).send({ error: 'Not a valid value for that setting.' })
			vault.setSetting(me(request).vaultId, request.params.key, request.body!.value)
			return reply.code(204).send()
		}
	)

	/** A board's live content. Someone it's shared with to view gets the changes and may make none. */
	app.get<{ Params: { id: string } }>('/api/sync/:id', { websocket: true }, (socket, request) => {
		const { id } = request.params
		const board = BOARD_ID.test(id) ? vault.get(id) : undefined
		const role = board ? accounts.roleFor(me(request), board.id, board.vaultId) : null
		// 4404 rather than an HTTP 404: the upgrade has already happened by the time a handler runs.
		if (!board || !role) return socket.close(4404, 'No such board.')
		rooms.connect(id, socket, { readOnly: role === 'view' })
	})
}

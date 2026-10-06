import type { FastifyInstance } from 'fastify'
import { isAssetHash, type AssetFiles } from './assets.ts'
import { exportVault } from './exportZip.ts'
import type { Rooms } from './rooms.ts'
import type { Thumbnails } from './thumbnails.ts'
import type { Vault } from './vault.ts'

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

/** The server vault's board index and settings, and the sync socket for each board's content. */
export function registerApi(
	app: FastifyInstance,
	{
		vault,
		rooms,
		assets,
		thumbnails,
		appVersion,
	}: { vault: Vault; rooms: Rooms; assets: AssetFiles; thumbnails: Thumbnails; appVersion: string }
): void {
	app.get('/api/boards', async () => vault.list())

	/**
	 * A new board, empty or — when it arrives from a local vault — with `snapshot` as its content
	 * (`{ store, schema }`, already migrated to the current schema by the app).
	 */
	app.post<{
		Body: { id?: unknown; name?: unknown; favorite?: unknown; snapshot?: unknown; createdAt?: unknown; updatedAt?: unknown }
	}>(
		'/api/boards',
		{ bodyLimit: MAX_SNAPSHOT_BYTES },
		async (request, reply) => {
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
			if (typeof id === 'string' && vault.get(id)) return reply.code(409).send({ error: 'That board already exists.' })
			const board = vault.create({
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
			const created = favorite === true ? vault.update(board.id, { favorite: true })! : board
			return reply.code(201).send(created)
		}
	)

	/** A board's content as it is now, for moving it to a local vault. */
	app.get<{ Params: { id: string } }>('/api/boards/:id/snapshot', async (request, reply) => {
		if (!BOARD_ID.test(request.params.id) || !vault.get(request.params.id)) {
			return reply.code(404).send({ error: 'No such board.' })
		}
		// A board nobody has opened yet has no records; an empty store loads as an empty board.
		return rooms.readSnapshot(request.params.id) ?? { store: {}, schema: null }
	})

	app.patch<{ Params: { id: string }; Body: { name?: unknown; favorite?: unknown } }>(
		'/api/boards/:id',
		async (request, reply) => {
			const { name, favorite } = request.body ?? {}
			if (name !== undefined && !isName(name)) return reply.code(400).send({ error: 'A board needs a name.' })
			if (favorite !== undefined && typeof favorite !== 'boolean') {
				return reply.code(400).send({ error: '`favorite` is true or false.' })
			}
			const board = vault.update(request.params.id, {
				...(name !== undefined ? { name } : {}),
				...(favorite !== undefined ? { favorite } : {}),
			})
			return board ?? reply.code(404).send({ error: 'No such board.' })
		}
	)

	app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
		if (!vault.delete(request.params.id)) return reply.code(404).send({ error: 'No such board.' })
		rooms.delete(request.params.id)
		thumbnails.delete(request.params.id)
		return reply.code(204).send()
	})

	app.addContentTypeParser('image/webp', { parseAs: 'buffer', bodyLimit: MAX_THUMBNAIL_BYTES }, (_request, body, done) =>
		done(null, body)
	)

	/** A board's preview, as whichever device last drew one sent it. */
	app.get<{ Params: { id: string } }>('/api/boards/:id/thumbnail', async (request, reply) => {
		const bytes = BOARD_ID.test(request.params.id) ? thumbnails.read(request.params.id) : null
		if (!bytes) return reply.code(404).send({ error: 'No preview yet.' })
		return reply.header('content-type', 'image/webp').header('cache-control', 'no-cache').send(bytes)
	})

	app.put<{ Params: { id: string }; Body: Buffer }>('/api/boards/:id/thumbnail', async (request, reply) => {
		if (!BOARD_ID.test(request.params.id) || !vault.get(request.params.id)) {
			return reply.code(404).send({ error: 'No such board.' })
		}
		const body = request.body
		// WebP files start "RIFF....WEBP": anything else is not a preview this app drew.
		if (!Buffer.isBuffer(body) || body.subarray(0, 4).toString() !== 'RIFF' || body.subarray(8, 12).toString() !== 'WEBP') {
			return reply.code(400).send({ error: 'A preview is a WebP image.' })
		}
		thumbnails.write(request.params.id, body)
		return reply.code(204).send()
	})

	app.addContentTypeParser(
		'application/octet-stream',
		{ parseAs: 'buffer', bodyLimit: MAX_ASSET_BYTES },
		(_request, body, done) => done(null, body)
	)

	/** Which of these the server lacks, so a client uploads only those. */
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

	app.get('/api/export', async (_request, reply) => {
		const date = new Date().toISOString().slice(0, 10)
		return reply
			.header('content-type', 'application/zip')
			.header('content-disposition', `attachment; filename="lifeboard-server-${date}.zip"`)
			.send(exportVault(vault, rooms, assets, appVersion))
	})

	app.get('/api/vault/settings', async () => vault.settings())

	app.put<{ Params: { key: string }; Body: { value?: unknown } }>(
		'/api/vault/settings/:key',
		async (request, reply) => {
			// `hasOwn`, or `constructor` and friends would arrive from the prototype as validators.
			const valid = Object.hasOwn(VAULT_SETTINGS, request.params.key) ? VAULT_SETTINGS[request.params.key] : undefined
			if (!valid) return reply.code(404).send({ error: 'No such setting.' })
			if (!valid(request.body?.value)) return reply.code(400).send({ error: 'Not a valid value for that setting.' })
			vault.setSetting(request.params.key, request.body!.value)
			return reply.code(204).send()
		}
	)

	app.get<{ Params: { id: string } }>('/api/sync/:id', { websocket: true }, (socket, request) => {
		const { id } = request.params
		// 4404 rather than an HTTP 404: the upgrade has already happened by the time a handler runs.
		if (!BOARD_ID.test(id) || !vault.get(id)) return socket.close(4404, 'No such board.')
		rooms.connect(id, socket)
	})
}

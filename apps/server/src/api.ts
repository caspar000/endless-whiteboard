import type { FastifyInstance } from 'fastify'
import type { Rooms } from './rooms.ts'
import type { Vault } from './vault.ts'

/** Board ids become file names, so only what a UUID can contain. */
const BOARD_ID = /^[A-Za-z0-9-]{1,64}$/
const MAX_NAME = 200

const isName = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_NAME

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
export function registerApi(app: FastifyInstance, vault: Vault, rooms: Rooms): void {
	app.get('/api/boards', async () => vault.list())

	app.post<{ Body: { id?: unknown; name?: unknown } }>('/api/boards', async (request, reply) => {
		const { id, name } = request.body ?? {}
		if (!isName(name)) return reply.code(400).send({ error: 'A board needs a name.' })
		if (id !== undefined && (typeof id !== 'string' || !BOARD_ID.test(id))) {
			return reply.code(400).send({ error: 'Not a valid board id.' })
		}
		if (typeof id === 'string' && vault.get(id)) return reply.code(409).send({ error: 'That board already exists.' })
		return reply.code(201).send(vault.create({ ...(typeof id === 'string' ? { id } : {}), name }))
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
		return reply.code(204).send()
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

	app.get<{ Params: { id: string }; Querystring: { sessionId?: string } }>(
		'/api/sync/:id',
		{ websocket: true },
		(socket, request) => {
			const { id } = request.params
			const sessionId = request.query.sessionId
			// 4404 rather than an HTTP 404: the upgrade has already happened by the time a handler runs.
			if (!BOARD_ID.test(id) || !vault.get(id)) return socket.close(4404, 'No such board.')
			if (!sessionId) return socket.close(4400, 'Missing sessionId.')
			rooms.connect(id, sessionId, socket)
		}
	)
}

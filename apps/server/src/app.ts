import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createBoardSchema } from '@lifeboard/schema'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { registerApi } from './api.ts'
import { registerAuth } from './auth.ts'
import type { ServerConfig } from './config.ts'
import { Rooms } from './rooms.ts'
import { Vault } from './vault.ts'

/** Files that must be re-checked on every load, or a deploy never reaches a browser that has the old one. */
const ALWAYS_REVALIDATE = /(^|\/)(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/

export async function buildApp(config: ServerConfig, options: FastifyServerOptions = {}) {
	// Behind Caddy: `request.ip` must be the client's address, or the login limiter counts Caddy.
	const app = Fastify({ trustProxy: true, ...options })

	// The password hash is part of the signing key, so a new password invalidates every session.
	await app.register(fastifyCookie, { secret: `${config.sessionSecret}:${config.passwordHash}` })
	app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
		done(null, Object.fromEntries(new URLSearchParams(body as string)))
	})

	registerAuth(app, config)
	await app.register(fastifyWebsocket)

	app.get('/api/status', async () => ({ ok: true, revision: config.revision }))

	mkdirSync(config.dataDir, { recursive: true })
	const vault = new Vault(join(config.dataDir, 'vault.sqlite'))
	const rooms = new Rooms({
		dir: join(config.dataDir, 'rooms'),
		schema: createBoardSchema(),
		onChange: (boardId) => vault.touch(boardId),
		log: app.log,
	})
	app.addHook('onClose', async () => {
		rooms.closeAll()
		vault.close()
	})
	registerApi(app, vault, rooms)

	if (!existsSync(join(config.webDir, 'index.html'))) {
		app.log.warn(`No built web app in ${config.webDir}: serving the API only.`)
		return app
	}

	await app.register(fastifyStatic, {
		root: config.webDir,
		setHeaders(res, path) {
			if (ALWAYS_REVALIDATE.test(path)) res.header('cache-control', 'no-cache')
			// Vite content-hashes everything under assets/, so a URL there never changes meaning.
			else if (path.includes('/assets/')) res.header('cache-control', 'public, max-age=31536000, immutable')
		},
	})

	// The app routes with `#/…`, but a deep link or a reload of `/something` should still get the app.
	app.setNotFoundHandler((request, reply) => {
		if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
			return reply.header('cache-control', 'no-cache').sendFile('index.html')
		}
		return reply.code(404).send({ error: 'Not found.' })
	})

	return app
}

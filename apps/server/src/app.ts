import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { createBoardSchema } from '@lifeboard/schema'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { registerAdminApi } from './adminApi.ts'
import { registerApi } from './api.ts'
import { AssetFiles } from './assets.ts'
import { collectGarbage, scheduleGarbageCollection } from './gc.ts'
import { registerAuth } from './auth.ts'
import type { ServerConfig } from './config.ts'
import { Accounts } from './accounts.ts'
import { Rooms } from './rooms.ts'
import { Thumbnails } from './thumbnails.ts'
import { Vault } from './vault.ts'

/** Files that must be re-checked on every load, or a deploy never reaches a browser that has the old one. */
const ALWAYS_REVALIDATE = /(^|\/)(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/

export async function buildApp(config: ServerConfig, options: FastifyServerOptions = {}) {
	// Behind Caddy: `request.ip` must be the client's address, or the login limiter counts Caddy.
	const app = Fastify({ trustProxy: true, ...options })

	// The set-up password's hash was part of the signing key before accounts; kept, so sessions from then
	// still verify. Accounts end their own sessions on a password change (`sessionsValidFrom`).
	await app.register(fastifyCookie, { secret: `${config.sessionSecret}:${config.passwordHash ?? ''}` })
	app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
		done(null, Object.fromEntries(new URLSearchParams(body as string)))
	})

	mkdirSync(config.dataDir, { recursive: true })
	const vault = new Vault(join(config.dataDir, 'vault.sqlite'))
	const accounts = new Accounts(vault.db)
	if (accounts.seedOwner(config.passwordHash)) app.log.info('Made the first account, "owner", from LIFEBOARD_PASSWORD_HASH.')

	registerAuth(app, { accounts, secureCookies: config.secureCookies })
	await app.register(fastifyWebsocket)

	app.get('/api/status', async () => ({ ok: true, revision: config.revision }))

	const rooms = new Rooms({
		dir: join(config.dataDir, 'rooms'),
		schema: createBoardSchema(),
		onChange: (boardId) => vault.touch(boardId),
		log: app.log,
	})
	const assets = new AssetFiles(join(config.dataDir, 'assets'))
	const stopGc = scheduleGarbageCollection(() => collectGarbage(vault, rooms, assets), app.log)
	app.addHook('onClose', async () => {
		stopGc()
		rooms.closeAll()
		vault.close()
	})
	const thumbnails = new Thumbnails(join(config.dataDir, 'thumbnails'))
	registerApi(app, {
		vault,
		accounts,
		rooms,
		assets,
		thumbnails,
		appVersion: config.revision ?? 'dev',
		secureCookies: config.secureCookies,
	})
	registerAdminApi(app, { vault, accounts, rooms, thumbnails })

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

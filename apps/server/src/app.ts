import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { registerAuth } from './auth.ts'
import type { ServerConfig } from './config.ts'

/** Files that must be re-checked on every load, or a deploy never reaches a browser that has the old one. */
const ALWAYS_REVALIDATE = /(^|\/)(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/

export async function buildApp(config: ServerConfig, options: FastifyServerOptions = {}) {
	if (!existsSync(join(config.webDir, 'index.html'))) {
		throw new Error(`No built web app in ${config.webDir}. Run \`pnpm build\` first.`)
	}

	// Behind Caddy: `request.ip` must be the client's address, or the login limiter counts Caddy.
	const app = Fastify({ trustProxy: true, ...options })

	// The password hash is part of the signing key, so a new password invalidates every session.
	await app.register(fastifyCookie, { secret: `${config.sessionSecret}:${config.passwordHash}` })
	app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
		done(null, Object.fromEntries(new URLSearchParams(body as string)))
	})

	registerAuth(app, config)

	app.get('/api/status', async () => ({ ok: true, revision: config.revision }))

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

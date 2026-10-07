import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'
import { SESSION_COOKIE } from './auth.ts'
import { loadConfig, type ServerConfig } from './config.ts'
import { hashPassword, verifyPassword } from './password.ts'

const PASSWORD = 'correct horse battery staple'
const HTML = { accept: 'text/html' }

let config: ServerConfig

beforeAll(async () => {
	const webDir = mkdtempSync(join(tmpdir(), 'lb-web-'))
	writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>app</title>')
	mkdirSync(join(webDir, 'assets'))
	writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)')
	writeFileSync(join(webDir, 'icon-192.png'), 'png')
	config = loadConfig({
		LIFEBOARD_PASSWORD_HASH: await hashPassword(PASSWORD),
		LIFEBOARD_SESSION_SECRET: 'x'.repeat(32),
		LIFEBOARD_WEB_DIR: webDir,
		LIFEBOARD_DATA_DIR: mkdtempSync(join(tmpdir(), 'lb-data-')),
		LIFEBOARD_REVISION: 'abc123',
	})
})

async function logIn(app: Awaited<ReturnType<typeof buildApp>>, password = PASSWORD, next = '/') {
	return app.inject({
		method: 'POST',
		url: '/login',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		payload: new URLSearchParams({ username: 'owner', password, next }).toString(),
	})
}

function sessionCookie(response: { cookies: { name: string; value: string }[] }): Record<string, string> {
	const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE)
	return cookie ? { [SESSION_COOKIE]: cookie.value } : {}
}

describe('password', () => {
	it('verifies the password it hashed, and nothing else', async () => {
		const hash = await hashPassword('hunter2hunter2')
		expect(hash).toMatch(/^\$argon2id\$v=19\$/)
		expect(await verifyPassword('hunter2hunter2', hash)).toBe(true)
		expect(await verifyPassword('hunter2hunter3', hash)).toBe(false)
		expect(await verifyPassword('hunter2hunter2', 'not a hash')).toBe(false)
	})
})

describe('config', () => {
	it('refuses to start without a password hash or a long enough secret', () => {
		expect(() => loadConfig({})).toThrow(/LIFEBOARD_SESSION_SECRET/)
	})
})

describe('server', () => {
	it('sends a browser to the login page, keeping where it was going', async () => {
		const app = await buildApp(config)
		const res = await app.inject({ url: '/#/board/1', headers: HTML })
		expect(res.statusCode).toBe(302)
		expect(res.headers.location).toBe('/login?next=%2F')
	})

	it('refuses everything else without a session, including the app bundle', async () => {
		const app = await buildApp(config)
		expect((await app.inject({ url: '/assets/index-abc123.js' })).statusCode).toBe(401)
		expect((await app.inject({ url: '/api/anything' })).statusCode).toBe(401)
	})

	it('serves the status check and the PWA icons without a session', async () => {
		const app = await buildApp(config)
		const status = await app.inject({ url: '/api/status' })
		expect(status.json()).toEqual({ ok: true, revision: 'abc123' })
		expect((await app.inject({ url: '/icon-192.png' })).statusCode).toBe(200)
	})

	it('logs in with the right password and serves the app on that session', async () => {
		const app = await buildApp(config)
		const login = await logIn(app, PASSWORD, '/settings')
		expect(login.statusCode).toBe(303)
		expect(login.headers.location).toBe('/settings')

		const cookies = sessionCookie(login)
		const page = await app.inject({ url: '/', headers: HTML, cookies })
		expect(page.statusCode).toBe(200)
		expect(page.body).toContain('<title>app</title>')
		expect(page.headers['cache-control']).toBe('no-cache')

		const asset = await app.inject({ url: '/assets/index-abc123.js', cookies })
		expect(asset.headers['cache-control']).toContain('immutable')

		// Unknown paths are the app too, so a reload on a deep link works.
		expect((await app.inject({ url: '/some/deep/link', headers: HTML, cookies })).body).toContain('<title>app</title>')
	})

	it('rejects a wrong password, and a forged or tampered cookie', async () => {
		const app = await buildApp(config)
		const res = await logIn(app, 'wrong')
		expect(res.statusCode).toBe(401)
		expect(res.body).toContain('Wrong username or password.')
		expect(sessionCookie(res)).toEqual({})

		const forged = { [SESSION_COOKIE]: String(Date.now()) }
		expect((await app.inject({ url: '/assets/index-abc123.js', cookies: forged })).statusCode).toBe(401)
	})

	it('stops counting guesses after ten wrong ones, even with the right password', async () => {
		const app = await buildApp(config)
		for (let i = 0; i < 10; i++) await logIn(app, 'wrong')
		const res = await logIn(app)
		expect(res.statusCode).toBe(429)
	})

	it('never redirects off the site after login', async () => {
		const app = await buildApp(config)
		for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example']) {
			expect((await logIn(app, PASSWORD, next)).headers.location).toBe('/')
		}
	})

	it('a new password logs out existing sessions', async () => {
		const app = await buildApp(config)
		const cookies = sessionCookie(await logIn(app))
		const rotated = await buildApp({ ...config, passwordHash: await hashPassword('a whole new password') })
		expect((await rotated.inject({ url: '/assets/index-abc123.js', cookies })).statusCode).toBe(401)
	})
})

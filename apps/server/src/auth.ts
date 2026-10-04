import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verifyPassword } from './password.ts'
import { loginPage } from './loginPage.ts'

export const SESSION_COOKIE = 'lb_session'
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

/** Everything a browser fetches without being asked to log in: the login page, and what installs the PWA. */
const PUBLIC_PATH = /^\/(login|api\/status|manifest\.webmanifest|favicon\.svg|apple-touch-icon\.png|icon-[\w-]+\.png)$/

/** Failed logins per IP before the door shuts, and for how long. Plenty for a typo, useless to a script. */
const MAX_FAILURES = 10
const FAILURE_WINDOW_MS = 15 * 60 * 1000

interface AuthOptions {
	passwordHash: string
	secureCookies: boolean
}

/**
 * One owner, one password, a signed cookie carrying when the session began.
 *
 * The cookie is signed with the session secret *and* the password hash (see `app.ts`), so changing the
 * password logs out every device, and so does rotating the secret. There is no session table to keep.
 */
export function registerAuth(app: FastifyInstance, { passwordHash, secureCookies }: AuthOptions): void {
	const failures = new Map<string, { count: number; since: number }>()

	const isLimited = (ip: string) => {
		const entry = failures.get(ip)
		if (!entry) return false
		if (Date.now() - entry.since > FAILURE_WINDOW_MS) {
			failures.delete(ip)
			return false
		}
		return entry.count >= MAX_FAILURES
	}
	const recordFailure = (ip: string) => {
		const entry = failures.get(ip)
		if (entry && Date.now() - entry.since <= FAILURE_WINDOW_MS) entry.count++
		else failures.set(ip, { count: 1, since: Date.now() })
	}

	const hasSession = (request: FastifyRequest) => {
		const raw = request.cookies[SESSION_COOKIE]
		if (!raw) return false
		const { valid, value } = request.unsignCookie(raw)
		if (!valid || !value) return false
		const age = Date.now() - Number(value)
		return age >= 0 && age < SESSION_MAX_AGE_S * 1000
	}

	app.decorateRequest('isAuthenticated', false)
	app.addHook('onRequest', async (request, reply) => {
		request.isAuthenticated = hasSession(request)
		if (request.isAuthenticated || PUBLIC_PATH.test(request.url.split('?')[0]!)) return
		if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
			return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`)
		}
		return reply.code(401).send({ error: 'Not logged in.' })
	})

	const sendLogin = (reply: FastifyReply, status: number, next: string, error?: string) =>
		reply.code(status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(loginPage({ next, error }))

	app.get<{ Querystring: { next?: string } }>('/login', async (request, reply) => {
		const next = safeNext(request.query.next)
		if (request.isAuthenticated) return reply.redirect(next)
		return sendLogin(reply, 200, next)
	})

	app.post<{ Body: { password?: string; next?: string } }>('/login', async (request, reply) => {
		const next = safeNext(request.body?.next)
		if (isLimited(request.ip)) {
			return sendLogin(reply, 429, next, 'Too many wrong passwords. Try again in 15 minutes.')
		}
		const password = typeof request.body?.password === 'string' ? request.body.password : ''
		if (!(await verifyPassword(password, passwordHash))) {
			recordFailure(request.ip)
			return sendLogin(reply, 401, next, 'Wrong password.')
		}
		failures.delete(request.ip)
		reply.setCookie(SESSION_COOKIE, String(Date.now()), {
			signed: true,
			httpOnly: true,
			secure: secureCookies,
			sameSite: 'lax',
			path: '/',
			maxAge: SESSION_MAX_AGE_S,
		})
		return reply.redirect(next, 303)
	})

	app.post('/logout', async (_request, reply) => {
		reply.clearCookie(SESSION_COOKIE, { path: '/' })
		return reply.redirect('/login', 303)
	})
}

/**
 * Only same-origin paths, so the login form can't bounce someone to another site. Browsers read `/\`
 * as `//`, which is why the second character is checked for both.
 */
function safeNext(next: unknown): string {
	return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/'
}

declare module 'fastify' {
	interface FastifyRequest {
		isAuthenticated: boolean
	}
}

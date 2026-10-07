import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { MAX_DISPLAY_NAME, USERNAME, type Accounts, type User } from './accounts.ts'
import { deadLinkPage, invitePage, loginPage } from './loginPage.ts'
import { hashPassword, verifyPassword } from './password.ts'

export const SESSION_COOKIE = 'lb_session'
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

/** Everything a browser fetches without being asked to log in: the login and invite pages, and what installs the PWA. */
const PUBLIC_PATH =
	/^\/(login|invite\/[\w-]+|api\/status|manifest\.webmanifest|favicon\.svg|apple-touch-icon\.png|icon-[\w-]+\.png)$/

/** Failed logins per IP before the door shuts, and for how long. Plenty for a typo, useless to a script. */
const MAX_FAILURES = 10
const FAILURE_WINDOW_MS = 15 * 60 * 1000

export const MIN_PASSWORD = 12

interface AuthOptions {
	accounts: Accounts
	secureCookies: boolean
}

/**
 * Who is asking: a signed cookie carrying the account and when the session began.
 *
 * A session from before accounts carried only the time; it is the first admin's, the owner whose
 * password the server was set up with, so their devices stay logged in through the upgrade. A password
 * change ends every session begun before it (`sessionsValidFrom`).
 */
export function registerAuth(app: FastifyInstance, { accounts, secureCookies }: AuthOptions): void {
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

	const sessionUser = (request: FastifyRequest): User | null => {
		const raw = request.cookies[SESSION_COOKIE]
		if (!raw) return null
		const { valid, value } = request.unsignCookie(raw)
		if (!valid || !value) return null
		const legacy = /^\d+$/.test(value)
		const [userId, issued] = legacy ? [null, value] : value.split('.')
		const issuedAt = Number(issued)
		const age = Date.now() - issuedAt
		if (!Number.isFinite(issuedAt) || age < 0 || age >= SESSION_MAX_AGE_S * 1000) return null
		const user = legacy ? accounts.firstAdmin() : userId ? accounts.user(userId) : undefined
		if (!user || issuedAt < user.sessionsValidFrom) return null
		return user
	}

	app.decorateRequest('user', null)
	app.addHook('onRequest', async (request, reply) => {
		request.user = sessionUser(request)
		if (request.user || PUBLIC_PATH.test(request.url.split('?')[0]!)) return
		if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
			return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`)
		}
		return reply.code(401).send({ error: 'Not logged in.' })
	})

	const sendHtml = (reply: FastifyReply, status: number, html: string) =>
		reply.code(status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html)

	app.get<{ Querystring: { next?: string } }>('/login', async (request, reply) => {
		const next = safeNext(request.query.next)
		if (request.user) return reply.redirect(next)
		return sendHtml(reply, 200, loginPage({ next }))
	})

	app.post<{ Body: { username?: string; password?: string; next?: string } }>('/login', async (request, reply) => {
		const next = safeNext(request.body?.next)
		const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
		if (isLimited(request.ip)) {
			return sendHtml(reply, 429, loginPage({ next, username, error: 'Too many wrong passwords. Try again in 15 minutes.' }))
		}
		const password = typeof request.body?.password === 'string' ? request.body.password : ''
		const user = username ? accounts.userByName(username) : undefined
		// Checked against something even for an unknown name, so the time taken doesn't say which names exist.
		const ok = await verifyPassword(password, user?.passwordHash ?? (await unknownUserHash()))
		if (!user || !ok) {
			recordFailure(request.ip)
			return sendHtml(reply, 401, loginPage({ next, username, error: 'Wrong username or password.' }))
		}
		failures.delete(request.ip)
		startSession(reply, user, secureCookies)
		return reply.redirect(next, 303)
	})

	app.post('/logout', async (_request, reply) => {
		reply.clearCookie(SESSION_COOKIE, { path: '/' })
		return reply.redirect('/login', 303)
	})

	/* ---------------------------------------------------------------------------------- invites */

	const inviteView = (token: string) => {
		const invite = accounts.openInvite(token)
		if (!invite) return null
		const inviter = accounts.user(invite.createdBy)
		const vault = invite.kind === 'join' && invite.vaultId ? accounts.vault(invite.vaultId) : undefined
		if (invite.kind === 'join' && !vault) return null
		return { invite, invitedBy: inviter?.displayName ?? 'Someone', vaultName: vault?.name }
	}
	const DEAD_INVITE = 'This invite has been used, has expired, or was withdrawn. Ask for a new one.'

	app.get<{ Params: { token: string } }>('/invite/:token', async (request, reply) => {
		const view = inviteView(request.params.token)
		if (!view) return sendHtml(reply, 404, deadLinkPage(DEAD_INVITE))
		return sendHtml(reply, 200, invitePage({ token: request.params.token, invitedBy: view.invitedBy, vaultName: view.vaultName }))
	})

	app.post<{ Params: { token: string }; Body: { username?: string; displayName?: string; password?: string; vault?: string } }>(
		'/invite/:token',
		async (request, reply) => {
			const { token } = request.params
			const view = inviteView(token)
			if (!view) return sendHtml(reply, 404, deadLinkPage(DEAD_INVITE))
			const field = (name: 'username' | 'displayName' | 'password' | 'vault') => {
				const value = request.body?.[name]
				return typeof value === 'string' ? value : ''
			}
			const username = field('username').trim()
			const displayName = field('displayName').trim()
			const vaultName = field('vault').trim()
			const password = field('password')
			const again = (error: string) =>
				sendHtml(
					reply,
					400,
					invitePage({ token, invitedBy: view.invitedBy, vaultName: view.vaultName, error, values: { username, displayName, vault: vaultName } })
				)

			if (!displayName || displayName.length > MAX_DISPLAY_NAME) return again('Your name is 1 to 60 characters.')
			if (!USERNAME.test(username)) return again('A username is 2 to 32 letters, digits, dots, dashes or underscores.')
			if (accounts.userByName(username)) return again('That username is taken.')
			if (password.length < MIN_PASSWORD) return again(`A password is ${MIN_PASSWORD} characters or more.`)
			if (view.invite.kind === 'new-vault' && (!vaultName || vaultName.length > MAX_DISPLAY_NAME)) {
				return again('Your vault needs a name, up to 60 characters.')
			}

			const vaultId = view.invite.kind === 'join' ? view.invite.vaultId! : accounts.createVault(vaultName).id
			const user = accounts.createUser({ username, displayName, passwordHash: await hashPassword(password), vaultId })
			accounts.useInvite(token, user.id)
			startSession(reply, user, secureCookies)
			return reply.redirect('/', 303)
		}
	)
}

/** Logs `user` in on this browser. */
export function startSession(reply: FastifyReply, user: User, secureCookies: boolean): void {
	reply.setCookie(SESSION_COOKIE, `${user.id}.${Date.now()}`, {
		signed: true,
		httpOnly: true,
		secure: secureCookies,
		sameSite: 'lax',
		path: '/',
		maxAge: SESSION_MAX_AGE_S,
	})
}

/** A real hash of a password nobody has, made once, for timing a login with an unknown name. */
let unknownHash: Promise<string> | null = null
const unknownUserHash = () => (unknownHash ??= hashPassword(randomUUID()))

/**
 * Only same-origin paths, so the login form can't bounce someone to another site. Browsers read `/\`
 * as `//`, which is why the second character is checked for both.
 */
function safeNext(next: unknown): string {
	return typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/'
}

declare module 'fastify' {
	interface FastifyRequest {
		/** The account logged in on this request; `null` only on the public paths. */
		user: User | null
	}
}

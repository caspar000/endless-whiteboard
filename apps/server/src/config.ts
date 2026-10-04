import { fileURLToPath } from 'node:url'
import { isPasswordHash } from './password.ts'

export interface ServerConfig {
	port: number
	host: string
	/** The built web app (`apps/web/dist`). */
	webDir: string
	passwordHash: string
	sessionSecret: string
	/** Off only for plain-http local runs; browsers drop `Secure` cookies over http. */
	secureCookies: boolean
	/** The deployed git revision, reported by `/api/status`. */
	revision: string | null
}

const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url))

/** Reads the environment, and refuses to start on anything that would leave the boards unprotected. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const problems: string[] = []

	const passwordHash = env.LIFEBOARD_PASSWORD_HASH ?? ''
	if (!isPasswordHash(passwordHash)) {
		problems.push('LIFEBOARD_PASSWORD_HASH must be an argon2id hash. Generate one with `pnpm --filter @lifeboard/server hash-password`.')
	}
	const sessionSecret = env.LIFEBOARD_SESSION_SECRET ?? ''
	if (sessionSecret.length < 32) {
		problems.push('LIFEBOARD_SESSION_SECRET must be at least 32 characters. `openssl rand -hex 32` makes one.')
	}
	const port = Number(env.PORT ?? 8080)
	if (!Number.isInteger(port) || port <= 0) problems.push(`PORT is not a port number: ${env.PORT}`)

	if (problems.length) throw new Error(`Lifeboard server cannot start:\n- ${problems.join('\n- ')}`)

	return {
		port,
		host: env.HOST ?? '0.0.0.0',
		webDir: env.LIFEBOARD_WEB_DIR ?? DEFAULT_WEB_DIR,
		passwordHash,
		sessionSecret,
		secureCookies: env.LIFEBOARD_INSECURE_COOKIES !== '1',
		revision: env.LIFEBOARD_REVISION || null,
	}
}

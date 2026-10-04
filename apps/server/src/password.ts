import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(argon2)

/** OWASP's argon2id baseline. Stored in the hash, so raising it later doesn't break old hashes. */
const DEFAULTS = { memory: 19_456, passes: 2, parallelism: 1 }
const TAG_LENGTH = 32

const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '')

/** A standard PHC string (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`), so any argon2 library can read it. */
export async function hashPassword(password: string): Promise<string> {
	const nonce = randomBytes(16)
	const tag = await derive('argon2id', { message: password, nonce, tagLength: TAG_LENGTH, ...DEFAULTS })
	const { memory, passes, parallelism } = DEFAULTS
	return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(nonce)}$${b64(tag)}`
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

export function isPasswordHash(value: string): boolean {
	return PHC.test(value)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
	const match = PHC.exec(hash)
	if (!match) return false
	const [, memory, passes, parallelism, salt, expected] = match
	const want = Buffer.from(expected!, 'base64')
	const got = await derive('argon2id', {
		message: password,
		nonce: Buffer.from(salt!, 'base64'),
		tagLength: want.length,
		memory: Number(memory),
		passes: Number(passes),
		parallelism: Number(parallelism),
	})
	return timingSafeEqual(got, want)
}

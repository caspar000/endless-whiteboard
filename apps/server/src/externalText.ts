import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { pipeline } from 'node:stream/promises'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { FastifyInstance } from 'fastify'

/**
 * Pages and feeds on other sites, read for the app (`NetworkBridge.getText`): a browser may not read a
 * YouTube channel's feed itself, because YouTube sends no CORS headers, so the server reads it instead.
 *
 * Anyone logged in can ask for any address, so the server must not become a way into the network it
 * sits in. Every connection, redirects included, is checked against the address it actually connects to
 * (the `lookup` below), not a name resolved earlier, so a name that changes its answer in between still
 * cannot reach a private address. Only http and https on their usual ports, only text, and only so much
 * of it.
 */

/** A channel's page on YouTube is about a megabyte; a feed far less. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 10_000
/** Every open feed card asks every quarter of an hour; this keeps several cards and devices to one read. */
const CACHE_MS = 5 * 60 * 1000
const CACHE_ENTRIES = 500

/** Loopback, private, link-local, shared, multicast and reserved: everything that is not the internet. */
const PRIVATE = new BlockList()
for (const [net, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 3],
] as const)
	PRIVATE.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
	['::', 127],
	['64:ff9b::', 96],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8],
] as const)
	PRIVATE.addSubnet(net, prefix, 'ipv6')

/** Whether an address is out on the internet. An IPv4 address written as IPv6 is judged as IPv4. */
export function isPublicAddress(address: string): boolean {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
	if (mapped) return isPublicAddress(mapped[1]!)
	const family = isIP(address)
	if (family === 4) return !PRIVATE.check(address, 'ipv4')
	if (family === 6) return !PRIVATE.check(address, 'ipv6')
	return false
}

export type TextResult =
	| { ok: true; url: string; contentType: string; text: string }
	| { ok: false; status: number; error: string }

export interface ExternalTextOptions {
	/** Which addresses may be connected to. Tests let the loopback through. */
	isAllowed?: (address: string) => boolean
	/** Which ports, besides the usual ones. Tests add their server's. */
	ports?: readonly string[]
	now?: () => number
}

class Refused extends Error {}

/** The address `url` may be read at: http(s), the usual ports, no credentials. */
export function checkUrl(raw: string, ports: readonly string[] = []): URL | string {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		return 'Not an address.'
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Only http and https addresses can be read.'
	if (url.username || url.password) return 'An address with a password in it cannot be read.'
	if (url.port && url.port !== '80' && url.port !== '443' && !ports.includes(url.port)) return 'Only the usual ports can be read.'
	return url
}

/** The charset a response's text is in: its header's, an XML declaration's, or UTF-8. */
function charsetOf(contentType: string, head: Buffer): string {
	const declared =
		/charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /^<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head.toString('latin1', 0, 200))?.[1]
	try {
		return new TextDecoder(declared ?? 'utf-8').encoding
	} catch {
		return 'utf-8'
	}
}

/**
 * Some sites ask a visitor from Europe to agree to cookies before they show anything, and this server is
 * in Europe. Saying "no" up front is how a browser gets past YouTube's.
 */
function cookieFor(url: URL): string | undefined {
	return /(^|\.)youtube\.com$/.test(url.hostname) ? 'SOCS=CAI' : undefined
}

export class ExternalText {
	private readonly isAllowed: (address: string) => boolean
	private readonly ports: readonly string[]
	private readonly now: () => number
	private readonly cache = new Map<string, { at: number; result: TextResult }>()
	private readonly pending = new Map<string, Promise<TextResult>>()

	constructor({ isAllowed = isPublicAddress, ports = [], now = Date.now }: ExternalTextOptions = {}) {
		this.isAllowed = isAllowed
		this.ports = ports
		this.now = now
	}

	/** The text at `raw`, from the cache when it was read in the last few minutes. Never throws. */
	async get(raw: string): Promise<TextResult> {
		const checked = checkUrl(raw, this.ports)
		if (typeof checked === 'string') return { ok: false, status: 400, error: checked }
		const key = checked.href
		const cached = this.cache.get(key)
		if (cached && this.now() - cached.at < CACHE_MS) return cached.result
		const running = this.pending.get(key)
		if (running) return running
		const read = this.read(checked).finally(() => this.pending.delete(key))
		this.pending.set(key, read)
		const result = await read
		// A refusal is about the address, not the moment, so only what came back from the site is kept.
		if (result.ok || result.status === 502) this.remember(key, result)
		return result
	}

	private remember(key: string, result: TextResult): void {
		this.cache.delete(key)
		this.cache.set(key, { at: this.now(), result })
		// A Map keeps insertion order, so the first key is the oldest.
		while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!)
	}

	private async read(start: URL): Promise<TextResult> {
		let url = start
		try {
			for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
				const response = await this.open(url)
				const status = response.statusCode ?? 0
				const location = response.headers.location
				if (status >= 300 && status < 400 && location) {
					response.resume()
					const next = checkUrl(new URL(location, url).href, this.ports)
					if (typeof next === 'string') return { ok: false, status: 403, error: `It sends you on to an address that can't be read. ${next}` }
					url = next
					continue
				}
				if (status < 200 || status >= 300) {
					response.resume()
					return { ok: false, status: 502, error: `The site answered ${status}.` }
				}
				const contentType = String(response.headers['content-type'] ?? '')
				if (contentType && !/^(text\/|application\/([\w.+-]*\+)?(xml|json))/i.test(contentType)) {
					response.resume()
					return { ok: false, status: 502, error: 'That address is not a page or a feed.' }
				}
				const body = await readBody(response)
				return { ok: true, url: url.href, contentType, text: new TextDecoder(charsetOf(contentType, body)).decode(body) }
			}
			return { ok: false, status: 502, error: 'It redirects too many times.' }
		} catch (error) {
			if (error instanceof Refused) return { ok: false, status: 403, error: error.message }
			return { ok: false, status: 502, error: `The site could not be read: ${(error as Error).message}` }
		}
	}

	/** One request, connecting only to an address `isAllowed` accepts. */
	private open(url: URL): Promise<IncomingMessage> {
		const lookup: LookupFunction = (hostname, options, callback) => {
			dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
				if (error) return callback(error, '', 0)
				const allowed = addresses.filter((a) => this.isAllowed(a.address))
				if (!allowed.length) return callback(new Refused(`${hostname} is not on the internet.`), '', 0)
				if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, allowed)
				callback(null, allowed[0]!.address, allowed[0]!.family)
			})
		}
		// An address given as a number never goes through `lookup`, so it is checked here.
		const literal = url.hostname.replace(/^\[|\]$/g, '')
		if (isIP(literal) && !this.isAllowed(literal)) return Promise.reject(new Refused(`${literal} is not on the internet.`))
		const cookie = cookieFor(url)
		return new Promise((resolve, reject) => {
			const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
				url,
				{
					lookup,
					timeout: TIMEOUT_MS,
					headers: {
						'user-agent': 'Mozilla/5.0 (compatible; Lifeboard/1.0; +https://lifeboard.darkroomlab.net)',
						accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
						'accept-encoding': 'gzip, deflate, br',
						'accept-language': 'en',
						...(cookie ? { cookie } : {}),
					},
				},
				resolve
			)
			request.on('timeout', () => request.destroy(new Error('it took too long to answer')))
			request.on('error', reject)
			request.end()
		})
	}
}

/**
 * The body, unpacked, up to `MAX_TEXT_BYTES`. Through `pipeline`, which hands an error on either stream
 * (the site hanging up mid-body, a timeout, a corrupt gzip) to the read and destroys both: a
 * decompressor `pipe`d from the response would leave the response's own errors unheard, and an unheard
 * error ends the server.
 */
async function readBody(response: IncomingMessage): Promise<Buffer> {
	const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase()
	const unpack =
		encoding === 'gzip' || encoding === 'x-gzip'
			? createGunzip()
			: encoding === 'deflate'
				? createInflate()
				: encoding === 'br'
					? createBrotliDecompress()
					: null
	const chunks: Buffer[] = []
	let size = 0
	const collect = async (source: AsyncIterable<Buffer>) => {
		for await (const chunk of source) {
			size += chunk.length
			if (size > MAX_TEXT_BYTES) throw new Error('it is too large')
			chunks.push(chunk)
		}
	}
	await (unpack ? pipeline(response, unpack, collect) : pipeline(response, collect))
	return Buffer.concat(chunks)
}

/**
 * `GET /api/external/text?url=…`: the text at an address on the internet, as JSON, never as a page of
 * this origin (an HTML page served from here would run as the app).
 */
export function registerExternalText(app: FastifyInstance, external: ExternalText): void {
	app.get<{ Querystring: { url?: string } }>('/api/external/text', async (request, reply) => {
		const url = request.query.url
		if (typeof url !== 'string' || !url) return reply.code(400).send({ error: 'Which address?' })
		const result = await external.get(url)
		if (!result.ok) return reply.code(result.status).send({ error: result.error })
		return reply.header('cache-control', 'no-store').send({ url: result.url, contentType: result.contentType, text: result.text })
	})
}

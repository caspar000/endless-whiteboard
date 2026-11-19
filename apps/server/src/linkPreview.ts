import { lookup, type LookupAddress } from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { FastifyInstance } from 'fastify'

/**
 * A link card's details, read from the page it points at: its name, its picture and its icon.
 *
 * The browser can't do this itself: a page's `<head>` is cross-origin, which is why a dropped link
 * was only ever titled with its host. So the server reads the page for the app, the way Freeform and
 * Messages do on a phone, and hands back what the card shows. Nothing is kept here; the app stores
 * the picture as one of the board's own files, so a dead link still shows it.
 *
 * The server fetches on a person's say-so, which makes it a door into wherever it runs. Every address
 * it connects to is checked as it connects (`guardedLookup`), redirects included, so a page can't send
 * it to a private network, the machine itself or a cloud's metadata service.
 */

/** The page's own head is near its top; a page that hasn't named itself by here won't. */
const MAX_PAGE_BYTES = 1024 * 1024
/** A preview picture or an icon. Far above a real one, well under what a board holds. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 5
/**
 * What Messages sends when it previews a link. Pages that answer crawlers differently answer this one
 * with their preview tags, which is the point.
 */
const USER_AGENT =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 facebookexternalhit/1.1 Facebot Twitterbot/1.0'

export interface LinkPreview {
	title: string
	description: string
	siteName: string
	/** The preview picture's address, absolute, or `''`. */
	image: string
	/** The site's icon's address, absolute, or `''`. */
	favicon: string
}

/* ----------------------------------------------------------------------------------- addresses */

const PRIVATE = new BlockList()
for (const [network, prefix] of [
	['0.0.0.0', 8], // "this" network
	['10.0.0.0', 8],
	['100.64.0.0', 10], // carrier-grade NAT, and Tailscale's addresses
	['127.0.0.0', 8],
	['169.254.0.0', 16], // link-local, cloud metadata
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 3], // multicast and reserved, up to the broadcast address
] as const) {
	PRIVATE.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
	['::', 127], // unspecified and loopback
	['64:ff9b::', 96], // NAT64, which reaches IPv4 addresses
	['100::', 64],
	['2001:db8::', 32],
	['fc00::', 7], // unique local
	['fe80::', 10], // link-local
	['ff00::', 8], // multicast
] as const) {
	PRIVATE.addSubnet(network, prefix, 'ipv6')
}

/** Whether connecting to this address reaches the public internet and nothing of ours. */
export function isPublicAddress(address: string): boolean {
	const family = isIP(address)
	if (family === 4) return !PRIVATE.check(address, 'ipv4')
	if (family !== 6) return false
	// An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) is that IPv4 address.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
	if (mapped?.[1]) return isPublicAddress(mapped[1])
	return !PRIVATE.check(address, 'ipv6')
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/**
 * `lookup` for the request: resolves as usual, and refuses a name with any address that isn't public.
 * Checked here rather than before the request so that what is checked is what is connected to: a name
 * that resolves differently the second time (DNS rebinding) is still caught.
 */
function guardedLookup(isAllowed: (address: string) => boolean) {
	return (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) => {
		lookup(hostname, { family: options.family, all: true }, (error, addresses) => {
			if (error) return callback(error, [])
			if (!addresses.length || addresses.some((a) => !isAllowed(a.address))) {
				return callback(Object.assign(new Error(`${hostname} is not on the public internet.`), { code: 'ENOTPUBLIC' }), [])
			}
			const [first] = addresses
			if (options.all) callback(null, addresses)
			else callback(null, first!.address, first!.family)
		})
	}
}

/* ------------------------------------------------------------------------------------- fetching */

export class FetchError extends Error {
	/** The status to answer the app with. */
	readonly status: number
	constructor(message: string, status: number) {
		super(message)
		this.status = status
	}
}

export interface Fetched {
	/** Where the content came from, after redirects: relative addresses in a page resolve against it. */
	url: URL
	contentType: string
	body: Buffer
}

export interface FetchOptions {
	accept: string
	maxBytes: number
	/** Past `maxBytes`, keep what arrived (a page's head) rather than refuse (a picture cut short). */
	truncate?: boolean
	/** For tests, which serve from this machine. */
	isAllowed?: (address: string) => boolean
}

/** Only the web, and only an address that names a host. */
export function parseWebUrl(value: unknown): URL | null {
	if (typeof value !== 'string' || value.length > 2048) return null
	try {
		const url = new URL(value)
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
		if (url.username || url.password) return null
		return url
	} catch {
		return null
	}
}

/** GETs a public web address, following redirects, each one checked as the first. */
export async function fetchPublic(start: URL, options: FetchOptions): Promise<Fetched> {
	let url = start
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await request(url, options)
		const status = response.statusCode ?? 0
		if (status >= 300 && status < 400 && response.headers.location) {
			response.resume()
			const next = parseWebUrl(new URL(response.headers.location, url).href)
			if (!next) throw new FetchError('The page redirects somewhere that is not a web address.', 422)
			url = next
			continue
		}
		if (status < 200 || status >= 300) {
			response.resume()
			throw new FetchError(`The page answered ${status}.`, 502)
		}
		return { url, contentType: String(response.headers['content-type'] ?? ''), body: await readBody(response, options) }
	}
	throw new FetchError('The page redirects too many times.', 502)
}

function request(url: URL, options: FetchOptions): Promise<IncomingMessage> {
	const isAllowed = options.isAllowed ?? isPublicAddress
	// A literal address is connected to without a lookup, so it's checked here instead.
	const literal = url.hostname.replace(/^\[|\]$/g, '')
	if (isIP(literal) && !isAllowed(literal)) {
		return Promise.reject(new FetchError('That address is not on the public internet.', 422))
	}
	return new Promise((resolve, reject) => {
		const req = (url.protocol === 'https:' ? https : http).request(
			url,
			{
				method: 'GET',
				headers: {
					'user-agent': USER_AGENT,
					accept: options.accept,
					'accept-encoding': 'gzip, deflate, br',
					'accept-language': 'en',
				},
				lookup: guardedLookup(isAllowed) as never,
				timeout: TIMEOUT_MS,
			},
			resolve
		)
		req.on('timeout', () => req.destroy(new FetchError('The page took too long to answer.', 504)))
		req.on('error', (error: NodeJS.ErrnoException) => {
			if (error instanceof FetchError) reject(error)
			else if (error.code === 'ENOTPUBLIC') reject(new FetchError(error.message, 422))
			else reject(new FetchError('The page could not be reached.', 502))
		})
		req.end()
	})
}

function readBody(response: IncomingMessage, { maxBytes, truncate }: FetchOptions): Promise<Buffer> {
	const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase()
	const stream =
		encoding === 'gzip' || encoding === 'x-gzip'
			? response.pipe(createGunzip())
			: encoding === 'br'
				? response.pipe(createBrotliDecompress())
				: encoding === 'deflate'
					? response.pipe(createInflate())
					: response
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		let size = 0
		let done = false
		const finish = (error?: Error) => {
			if (done) return
			done = true
			response.destroy()
			if (error) reject(error)
			else resolve(Buffer.concat(chunks, Math.min(size, maxBytes)))
		}
		const timer = setTimeout(() => finish(new FetchError('The page took too long to send.', 504)), TIMEOUT_MS)
		stream.on('data', (chunk: Buffer) => {
			chunks.push(chunk)
			size += chunk.length
			if (size > maxBytes) {
				clearTimeout(timer)
				finish(truncate ? undefined : new FetchError('That file is too large.', 413))
			}
		})
		stream.on('end', () => {
			clearTimeout(timer)
			finish()
		})
		stream.on('error', () => {
			clearTimeout(timer)
			finish(new FetchError('The page could not be read.', 502))
		})
	})
}

/* -------------------------------------------------------------------------------------- reading */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', middot: '·', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === '#') {
			const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
		}
		return ENTITIES[name.toLowerCase()] ?? whole
	})
}

const clean = (text: string | undefined) => (text ? decodeEntities(text).replace(/\s+/g, ' ').trim() : '')

/** A tag's attributes, names lower-cased. */
function attributes(tag: string): Record<string, string> {
	const found: Record<string, string> = {}
	const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
	// Past the tag's name.
	const body = tag.replace(/^<[a-z]+/i, '').replace(/\/?>$/, '')
	for (const match of body.matchAll(pattern)) {
		const name = match[1]!.toLowerCase()
		if (!(name in found)) found[name] = match[2] ?? match[3] ?? match[4] ?? ''
	}
	return found
}

/** The page as text, in the encoding it says it is in. */
export function decodePage(body: Buffer, contentType: string): string {
	const declared =
		/charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
		/<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString('latin1'))?.[1]
	try {
		return new TextDecoder(declared ?? 'utf-8').decode(body)
	} catch {
		return new TextDecoder('utf-8').decode(body)
	}
}

/**
 * The page's name without the site's, which most pages add to their title: "LCD-2 | Audeze" is the
 * LCD-2, and the card already says it's from audeze.com.
 */
export function productName(title: string, siteName: string, host: string): string {
	const letters = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
	const domain = host.replace(/^www\./, '')
	const labels = domain.split('.')
	// `audeze` of audeze.com, `wikipedia` of en.wikipedia.org.
	const names = new Set([letters(siteName), letters(domain), letters(labels[0] ?? ''), letters(labels.at(-2) ?? '')])
	names.delete('')
	const isSite = (part: string) => names.has(letters(part))
	const last = /^(.*\S)\s+[|·•–—:-]\s+(.+)$/.exec(title)
	if (last?.[1] && last[2] && isSite(last[2])) return last[1]
	const first = /^(.+?)\s+[|·•–—:-]\s+(.*\S)$/.exec(title)
	if (first?.[1] && first[2] && isSite(first[1])) return first[2]
	return title
}

/** What a card shows, read from a page's head. Addresses are made absolute against `base`. */
export function readPreview(html: string, base: URL): LinkPreview {
	const head = html.slice(0, Math.max(html.search(/<\/head>/i), 0) || html.length)
	const meta: Record<string, string> = {}
	for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
		const attrs = attributes(tag)
		const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').toLowerCase()
		if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content
	}
	const absolute = (href: string | undefined) => {
		const value = clean(href)
		if (!value) return ''
		try {
			const url = new URL(value, base)
			return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
		} catch {
			return ''
		}
	}

	let favicon = ''
	let faviconRank = 0
	for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
		const attrs = attributes(tag)
		const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/)
		// A big square icon looks better on the card than a 16-pixel one.
		const rank = rel.includes('apple-touch-icon') ? 3 : rel.includes('icon') ? (/\.svg($|\?)/i.test(attrs.href ?? '') ? 1 : 2) : 0
		if (rank > faviconRank && attrs.href) {
			favicon = absolute(attrs.href)
			faviconRank = rank
		}
	}

	const siteName = clean(meta['og:site_name'] ?? meta['application-name'])
	const title = clean(meta['og:title'] ?? meta['twitter:title'] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1])
	return {
		title: title ? productName(title, siteName, base.hostname) : '',
		description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description),
		siteName,
		image: absolute(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src']),
		favicon: favicon || new URL('/favicon.ico', base).href,
	}
}

/* ------------------------------------------------------------------------------------- the API */

/**
 * `GET /api/link-preview?url=` gives what a card shows, and `GET /api/link-preview/image?url=` the
 * bytes of its picture or icon, for the app to keep. Behind the session like the rest of the API.
 */
export function registerLinkPreview(app: FastifyInstance, { isAllowed }: { isAllowed?: (address: string) => boolean } = {}): void {
	app.get<{ Querystring: { url?: string } }>('/api/link-preview', async (request, reply) => {
		const url = parseWebUrl(request.query.url)
		if (!url) return reply.code(400).send({ error: '`url` is a web address.' })
		try {
			const page = await fetchPublic(url, { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', maxBytes: MAX_PAGE_BYTES, truncate: true, isAllowed })
			const html = /html|xml/i.test(page.contentType) || !page.contentType ? decodePage(page.body, page.contentType) : ''
			return readPreview(html, page.url)
		} catch (error) {
			if (!(error instanceof FetchError)) throw error
			return reply.code(error.status).send({ error: error.message })
		}
	})

	app.get<{ Querystring: { url?: string } }>('/api/link-preview/image', async (request, reply) => {
		const url = parseWebUrl(request.query.url)
		if (!url) return reply.code(400).send({ error: '`url` is a web address.' })
		try {
			const image = await fetchPublic(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', maxBytes: MAX_IMAGE_BYTES, isAllowed })
			const type = (image.contentType.split(';')[0] ?? '').trim().toLowerCase()
			// Pictures that can't run anything: an SVG is a document, and the app makes object URLs of these.
			if (!/^image\/(png|jpeg|gif|webp|avif|x-icon|vnd\.microsoft\.icon|bmp)$/.test(type)) {
				return reply.code(415).send({ error: 'That is not a picture the board can keep.' })
			}
			return reply
				.header('content-type', type)
				.header('x-content-type-options', 'nosniff')
				.header('content-disposition', 'attachment')
				.header('cache-control', 'private, max-age=3600')
				.send(image.body)
		} catch (error) {
			if (!(error instanceof FetchError)) throw error
			return reply.code(error.status).send({ error: error.message })
		}
	})
}

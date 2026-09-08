import { lookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { parseLinkPreview } from './parse'
import { emptyLinkPreview, type LinkPreview } from './types'

/**
 * The half of link previews that cannot happen in a browser.
 *
 * A tab cannot read a cross-origin page: a `no-cors` fetch returns an *opaque* response whose body
 * is empty by design. tldraw's default bookmark handler does exactly that and then treats the
 * resulting empty `og:image` as a relative URL, resolving it against the page — so the bookmark card
 * ends up with the HTML document as its `<img src>` and renders a broken image. That is the bug this
 * package fixes, and it cannot be fixed on the client: the fetch has to move to a process that has
 * no same-origin policy.
 *
 * So this module is meant to run wherever the app is *served from* — the dev server today, a
 * self-hosted server or a native shell later — and to be reachable at one same-origin path. Two
 * lines to mount on anything Node:
 *
 * ```ts
 * import { UNFURL_PATH, handleUnfurlRequest } from '@lifeboard/link-preview/node'
 * server.use(UNFURL_PATH, (req, res) => void handleUnfurlRequest(req, res))
 * ```
 *
 * Deliberately no third-party unfurl service. A link someone saved is a private thing, and routing
 * every paste through a company that did not need to know about it is not a trade this app makes.
 * The cost of that choice is that plain static hosting has no endpoint — which the client treats as
 * "no metadata", the same honest fallback it uses when a page has no `og:` tags at all.
 */

/** Where the app looks. Same shape as the agent host's endpoint, on the same reserved prefix. */
export const UNFURL_PATH = '/__lifeboard/unfurl'

/** Enough for any `<head>`; a page that has not finished it by here is not going to. */
const MAX_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 8_000

/**
 * Sent as the `User-Agent`.
 *
 * Honest about what is asking, and shaped like a bot on purpose: a lot of sites serve their richest
 * `og:` tags to crawlers, and none of them owe a preview to something pretending to be Chrome.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; Lifeboard link preview; +https://github.com/lifeboard)'

export interface UnfurlOptions {
	/**
	 * Allow private, loopback and link-local addresses.
	 *
	 * Off by default. This endpoint fetches a URL chosen by whoever can reach it, so on a
	 * self-hosted server it is a way to ask that server to make requests inside its own network —
	 * the classic SSRF shape. A self-hoster who *wants* previews for intranet links can turn it on
	 * (`LIFEBOARD_UNFURL_ALLOW_PRIVATE=1`), which is a decision worth making on purpose.
	 *
	 * The guard checks the addresses the hostname resolves to, at each redirect hop. It is not
	 * proof against a name that resolves differently between the check and the connection; closing
	 * that needs a socket-level hook, and the honest description of what is here is "blocks the
	 * obvious cases", not "airtight".
	 */
	allowPrivateHosts?: boolean
	timeoutMs?: number
}

function isPrivateIPv4(address: string): boolean {
	const parts = address.split('.').map(Number)
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return true
	}
	const [a = 0, b = 0] = parts
	if (a === 0 || a === 10 || a === 127) return true
	if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
	if (a === 172 && b >= 16 && b <= 31) return true
	if (a === 192 && b === 168) return true
	if (a === 192 && b === 0) return true // 192.0.0.0/24 and 192.0.2.0/24 (TEST-NET-1)
	if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
	if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
	if (a >= 224) return true // multicast, reserved, broadcast
	return false
}

function isPrivateAddress(address: string): boolean {
	const family = isIP(address)
	if (family === 4) return isPrivateIPv4(address)
	if (family !== 6) return true

	const lower = address.toLowerCase()
	// An IPv4-mapped address is an IPv4 address wearing a hat; judge the address inside it.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1]
	if (mapped) return isPrivateIPv4(mapped)
	if (lower === '::' || lower === '::1') return true
	const head = lower.split(':')[0] ?? ''
	if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) {
		return true // fe80::/10 link-local
	}
	if (head.startsWith('fc') || head.startsWith('fd')) return true // fc00::/7 unique-local
	if (head.startsWith('ff')) return true // ff00::/8 multicast
	return false
}

async function isReachableHost(hostname: string): Promise<boolean> {
	if (isIP(hostname)) return !isPrivateAddress(hostname)
	// `.local` is mDNS and `localhost` is the loopback by definition; neither needs a DNS round trip.
	const lower = hostname.toLowerCase()
	if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) return false
	try {
		const addresses = await lookup(hostname, { all: true })
		// Every address, not just the first: a name that resolves to one public and one private
		// address is a name the connection could take either way.
		return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address))
	} catch {
		return false
	}
}

/** The charset the response declares, if we can honour it. Most pages are UTF-8; some are not. */
function decodeBody(bytes: Uint8Array, contentType: string): string {
	const declared = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType)?.[1]
	for (const encoding of [declared, 'utf-8']) {
		if (!encoding) continue
		try {
			return new TextDecoder(encoding, { fatal: false }).decode(bytes)
		} catch {
			// An encoding label Node does not know. Fall through to UTF-8.
		}
	}
	return ''
}

/** Reads at most `MAX_BYTES`, then hangs up. A `<head>` arrives first; a 40 MB page is not needed. */
async function readCapped(response: Response): Promise<Uint8Array> {
	const reader = response.body?.getReader()
	if (!reader) return new Uint8Array()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value) continue
			chunks.push(value)
			total += value.byteLength
			if (total >= MAX_BYTES) break
		}
	} finally {
		// Cancelling closes the socket rather than leaving the rest of a large page in flight.
		await reader.cancel().catch(() => {})
	}
	const body = new Uint8Array(total)
	let offset = 0
	for (const chunk of chunks) {
		body.set(chunk, offset)
		offset += chunk.byteLength
	}
	return body
}

/**
 * What a page says about itself, or `null` when it could not be read.
 *
 * Never throws, and never *invents*: a page that answers with no `og:` tags at all comes back as an
 * empty-but-real preview, which is a different answer from `null` and lets the caller tell "there is
 * nothing to show" apart from "the server is not reachable".
 *
 * Redirects are followed by hand (`redirect: 'manual'`) so the host guard runs on every hop —
 * `fetch`'s own redirect following would take a public URL to a private one without asking.
 */
export async function fetchLinkPreview(
	rawUrl: string,
	options: UnfurlOptions = {}
): Promise<LinkPreview | null> {
	let current: URL
	try {
		current = new URL(rawUrl)
	} catch {
		return null
	}
	if (current.protocol !== 'http:' && current.protocol !== 'https:') return null

	const allowPrivate = options.allowPrivateHosts ?? process.env.LIFEBOARD_UNFURL_ALLOW_PRIVATE === '1'
	const signal = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		if (!allowPrivate && !(await isReachableHost(current.hostname))) return null

		let response: Response
		try {
			response = await fetch(current, {
				redirect: 'manual',
				signal,
				headers: {
					accept: 'text/html,application/xhtml+xml',
					'accept-language': 'en',
					'user-agent': USER_AGENT,
				},
			})
		} catch {
			return null
		}

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location')
			await response.body?.cancel().catch(() => {})
			if (!location) return null
			try {
				current = new URL(location, current)
			} catch {
				return null
			}
			if (current.protocol !== 'http:' && current.protocol !== 'https:') return null
			continue
		}

		if (!response.ok) {
			await response.body?.cancel().catch(() => {})
			return null
		}

		const contentType = response.headers.get('content-type') ?? ''
		// A PDF or an image is a perfectly good link; it just has no `<head>` to read. An empty
		// preview for it is the right answer, and parsing its bytes as HTML is not.
		if (contentType && !/^\s*(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
			await response.body?.cancel().catch(() => {})
			return emptyLinkPreview(current.href)
		}

		const bytes = await readCapped(response)
		return parseLinkPreview(decodeBody(bytes, contentType), current.href)
	}

	// Out of hops: a redirect loop, or a chain long enough to be one.
	return null
}

/**
 * The endpoint, as a Node request handler.
 *
 * Same-origin only in practice, exactly like the agent-host endpoint next door: no CORS headers are
 * set, so another site can issue the request but cannot read the reply.
 */
export async function handleUnfurlRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: UnfurlOptions = {}
): Promise<void> {
	response.setHeader('Content-Type', 'application/json')

	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.statusCode = 405
		response.setHeader('Allow', 'GET, HEAD')
		response.end(JSON.stringify({ error: 'Use GET.' }))
		return
	}

	// A mounted middleware sees the path stripped to `/`, a bare server sees the whole path. Parsing
	// against a dummy origin reads the query the same way either way.
	const target = new URL(request.url ?? '/', 'http://localhost')
	const url = target.searchParams.get('url')
	if (!url) {
		response.statusCode = 400
		response.setHeader('Cache-Control', 'no-store')
		response.end(JSON.stringify({ error: 'Pass ?url=' }))
		return
	}

	const preview = await fetchLinkPreview(url, options)
	if (!preview) {
		// 502, not 200-with-nothing: the client falls back to the page's host as its title, and a
		// failure it can see is a failure it can retry on the next paste rather than cache.
		response.statusCode = 502
		response.setHeader('Cache-Control', 'no-store')
		response.end(JSON.stringify({ error: 'Could not read that page.' }))
		return
	}

	response.statusCode = 200
	// A page's own description of itself changes on the scale of days, and the same link gets pasted
	// more than once. Letting the browser's HTTP cache answer the second time needs no code here.
	response.setHeader('Cache-Control', 'public, max-age=86400')
	response.end(JSON.stringify(preview))
}

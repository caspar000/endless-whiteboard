import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { fetchLinkPreview, handleUnfurlRequest, UNFURL_PATH } from './node'

/**
 * The guards, not the happy path.
 *
 * Everything here refuses *before* a socket is opened, so the suite makes no network calls: a test
 * that had to reach the real web would be a test that fails on a plane. The parsing this endpoint
 * exists to do is covered exhaustively in `parse.test.ts`, against fixed HTML.
 */
describe('fetchLinkPreview', () => {
	it('refuses anything that is not http(s)', async () => {
		for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)', 'not a url']) {
			expect(await fetchLinkPreview(url)).toBeNull()
		}
	})

	it('refuses loopback and .local names without resolving them', async () => {
		for (const url of ['http://localhost:8787/', 'http://nas.local/', 'http://app.localhost/']) {
			expect(await fetchLinkPreview(url)).toBeNull()
		}
	})

	it('refuses private and link-local literals, including cloud metadata', async () => {
		for (const url of [
			'http://127.0.0.1/',
			'http://10.1.2.3/',
			'http://192.168.0.1/',
			'http://172.20.0.5/',
			'http://169.254.169.254/latest/meta-data/',
			'http://[::1]/',
			'http://[fd00::1]/',
			'http://[::ffff:10.0.0.1]/',
		]) {
			expect(await fetchLinkPreview(url)).toBeNull()
		}
	})

	it('allows a public literal past the guard (and only then tries to connect)', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
		try {
			// Null either way — the point is *why*: the guard let it through and the connection failed.
			expect(await fetchLinkPreview('http://93.184.216.34/')).toBeNull()
			expect(fetchSpy).toHaveBeenCalledOnce()
		} finally {
			fetchSpy.mockRestore()
		}
	})

	it('does not connect at all when the host is refused', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not run'))
		try {
			expect(await fetchLinkPreview('http://192.168.1.1/')).toBeNull()
			expect(fetchSpy).not.toHaveBeenCalled()
		} finally {
			fetchSpy.mockRestore()
		}
	})
})

/** Minimal stand-ins: the handler only ever touches these four members. */
function fakeExchange(url: string, method = 'GET') {
	const headers: Record<string, string> = {}
	const response = {
		statusCode: 0,
		setHeader: (name: string, value: string) => {
			headers[name.toLowerCase()] = value
		},
		end: vi.fn(),
	}
	return {
		request: { method, url } as IncomingMessage,
		response: response as unknown as ServerResponse,
		headers,
		body: () => JSON.parse(response.end.mock.calls[0]?.[0] as string) as Record<string, unknown>,
		status: () => response.statusCode,
	}
}

describe('handleUnfurlRequest', () => {
	it('is mounted where the app looks for it', () => {
		expect(UNFURL_PATH).toBe('/__lifeboard/unfurl')
	})

	it('needs a url', async () => {
		const exchange = fakeExchange('/')
		await handleUnfurlRequest(exchange.request, exchange.response)
		expect(exchange.status()).toBe(400)
		expect(exchange.headers['cache-control']).toBe('no-store')
	})

	it('reads the query whether or not the mount stripped the path', async () => {
		// A refused host, so both spellings take the same 502 path without touching the network.
		for (const url of ['/?url=http://127.0.0.1/', `${UNFURL_PATH}?url=http://127.0.0.1/`]) {
			const exchange = fakeExchange(url)
			await handleUnfurlRequest(exchange.request, exchange.response)
			expect(exchange.status()).toBe(502)
		}
	})

	it('answers 502 — not an empty 200 — when the page cannot be read', async () => {
		const exchange = fakeExchange('/?url=http://10.0.0.1/')
		await handleUnfurlRequest(exchange.request, exchange.response)
		expect(exchange.status()).toBe(502)
		// Never cached: the next paste of the same link deserves a fresh attempt.
		expect(exchange.headers['cache-control']).toBe('no-store')
	})

	it('refuses anything but a read', async () => {
		const exchange = fakeExchange('/?url=https://example.com/', 'POST')
		await handleUnfurlRequest(exchange.request, exchange.response)
		expect(exchange.status()).toBe(405)
		expect(exchange.headers['allow']).toBe('GET, HEAD')
	})
})

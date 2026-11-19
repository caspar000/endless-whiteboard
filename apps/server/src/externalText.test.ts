import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUrl, ExternalText, isPublicAddress, MAX_TEXT_BYTES } from './externalText.ts'

const FEED = '<?xml version="1.0" encoding="UTF-8"?><feed><title>Ben Eater</title></feed>'

let server: Server
let base: string
let port: string
let hits = 0

beforeAll(async () => {
	server = createServer((request, response) => {
		hits++
		switch (request.url) {
			case '/feed':
				response.writeHead(200, { 'content-type': 'application/atom+xml; charset=utf-8' })
				return response.end(FEED)
			case '/gzip':
				response.writeHead(200, { 'content-type': 'text/xml', 'content-encoding': 'gzip' })
				return response.end(gzipSync(FEED))
			case '/latin1':
				response.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' })
				return response.end(Buffer.from([0x63, 0x61, 0x66, 0xe9]))
			case '/moved':
				response.writeHead(301, { location: '/feed' })
				return response.end()
			case '/away':
				response.writeHead(302, { location: 'file:///etc/passwd' })
				return response.end()
			case '/picture':
				response.writeHead(200, { 'content-type': 'image/png' })
				return response.end('png')
			case '/cut-gzip': {
				// gzip headers and the start of a body, then the connection is reset.
				response.writeHead(200, { 'content-type': 'text/xml', 'content-encoding': 'gzip' })
				response.write(gzipSync(FEED.repeat(50)).subarray(0, 40))
				return setTimeout(() => request.socket.destroy(), 20)
			}
			case '/cut': {
				response.writeHead(200, { 'content-type': 'text/xml', 'content-length': '10000' })
				response.write(FEED)
				return setTimeout(() => request.socket.destroy(), 20)
			}
			case '/huge':
				response.writeHead(200, { 'content-type': 'text/plain' })
				return response.end('x'.repeat(MAX_TEXT_BYTES + 1))
			default:
				response.writeHead(404)
				return response.end()
		}
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	port = String((server.address() as AddressInfo).port)
	base = `http://127.0.0.1:${port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** Reads from the test server: lets the loopback and its port through. */
function local() {
	const external = new ExternalText({ isAllowed: () => true, ports: [port] })
	return { get: (path: string) => external.get(base + path) }
}

describe('addresses', () => {
	it('knows the internet from everything else', () => {
		expect(isPublicAddress('142.250.180.14')).toBe(true)
		expect(isPublicAddress('2a00:1450:4001:82b::200e')).toBe(true)
		for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'localhost'])
			expect(isPublicAddress(address), address).toBe(false)
	})

	it('reads only http and https on their usual ports, without credentials', () => {
		expect(checkUrl('https://www.youtube.com/feeds/videos.xml?channel_id=UC1')).toBeInstanceOf(URL)
		expect(checkUrl('http://example.com:80/feed')).toBeInstanceOf(URL)
		expect(checkUrl('file:///etc/passwd')).toMatch(/http/)
		expect(checkUrl('https://example.com:8080/')).toMatch(/port/)
		expect(checkUrl('https://me:secret@example.com/')).toMatch(/password/)
		expect(checkUrl('not a url')).toMatch(/Not an address/)
	})
})

describe('reading', () => {
	it('reads a feed, unpacks it and decodes its charset', async () => {
		const { get } = local()
		expect(await get('/feed')).toMatchObject({ ok: true, text: FEED, contentType: 'application/atom+xml; charset=utf-8' })
		expect(await get('/gzip')).toMatchObject({ ok: true, text: FEED })
		expect(await get('/latin1')).toMatchObject({ ok: true, text: 'café' })
	})

	it('follows a redirect, and says where it ended up', async () => {
		const { get } = local()
		expect(await get('/moved')).toMatchObject({ ok: true, url: `${base}/feed`, text: FEED })
	})

	it('will not be sent on to an address it would refuse', async () => {
		const { get } = local()
		expect(await get('/away')).toMatchObject({ ok: false, status: 403 })
	})

	it('refuses what is not text, what is too large and what is not there', async () => {
		const { get } = local()
		expect(await get('/picture')).toMatchObject({ ok: false, status: 502 })
		expect(await get('/huge')).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/too large/) })
		expect(await get('/missing')).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/404/) })
	})

	it('fails the read, and only the read, when a site hangs up mid-body', async () => {
		const { get } = local()
		// An error nobody listens for would end the process, and vitest with it.
		expect(await get('/cut-gzip')).toMatchObject({ ok: false, status: 502 })
		expect(await get('/cut')).toMatchObject({ ok: false, status: 502 })
		expect(await get('/feed')).toMatchObject({ ok: true })
	})

	it('never connects to a private address, whatever name it goes by', async () => {
		const external = new ExternalText()
		expect(await external.get('http://127.0.0.1/feed')).toMatchObject({ ok: false, status: 403 })
		expect(await external.get('http://[::1]/feed')).toMatchObject({ ok: false, status: 403 })
		expect(await external.get('http://localhost/feed')).toMatchObject({ ok: false, status: 403 })
	})

	it('keeps what it read for a few minutes', async () => {
		let now = 0
		const external = new ExternalText({ isAllowed: () => true, ports: [port], now: () => now })
		const before = hits
		await external.get(`${base}/feed`)
		await external.get(`${base}/feed`)
		expect(hits - before).toBe(1)
		now += 6 * 60 * 1000
		await external.get(`${base}/feed`)
		expect(hits - before).toBe(2)
	})
})

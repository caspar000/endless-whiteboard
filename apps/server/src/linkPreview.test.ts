import { createServer, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FetchError, decodePage, fetchPublic, isPublicAddress, productName, readPreview, registerLinkPreview } from './linkPreview.ts'

describe('isPublicAddress', () => {
	it('lets the public internet through', () => {
		for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(address)).toBe(true)
	})

	it('refuses this machine, private networks and the cloud metadata service', () => {
		for (const address of [
			'127.0.0.1',
			'10.1.2.3',
			'172.20.0.1',
			'192.168.1.1',
			'169.254.169.254',
			'100.100.1.1',
			'0.0.0.0',
			'::1',
			'::',
			'fd00::1',
			'fe80::1',
			'::ffff:127.0.0.1',
			'::ffff:10.0.0.1',
			'not an address',
		]) {
			expect(isPublicAddress(address), address).toBe(false)
		}
	})
})

describe('productName', () => {
	it('takes the site off the end or the front of a title', () => {
		expect(productName('LCD-2 | Audeze', '', 'www.audeze.com')).toBe('LCD-2')
		expect(productName('LCD-2 – Audeze', 'Audeze', 'audeze.com')).toBe('LCD-2')
		expect(productName('GitHub - tldraw/tldraw: a canvas', 'GitHub', 'github.com')).toBe('tldraw/tldraw: a canvas')
		expect(productName('Whiteboard - Wikipedia', '', 'en.wikipedia.org')).toBe('Whiteboard')
	})

	it('leaves a title alone when no part of it is the site', () => {
		expect(productName('LCD-2', '', 'audeze.com')).toBe('LCD-2')
		expect(productName('Butterick’s Practical Typography', '', 'practicaltypography.com')).toBe('Butterick’s Practical Typography')
		expect(productName('Rock - Paper - Scissors', '', 'example.com')).toBe('Rock - Paper - Scissors')
	})
})

describe('readPreview', () => {
	const base = new URL('https://www.audeze.com/products/lcd-2')

	it('reads the preview tags, making addresses absolute', () => {
		const html = `<!doctype html><html><head>
			<title>Something else</title>
			<meta property="og:title" content="LCD-2 | Audeze">
			<meta property='og:site_name' content='Audeze'>
			<meta name="description" content="Planar &amp; magnetic">
			<meta property="og:image" content="/img/lcd2.jpg">
			<link rel="icon" href="/favicon-32.png">
			<link rel="apple-touch-icon" href="https://cdn.audeze.com/touch.png">
		</head><body><meta property="og:title" content="not this"></body></html>`
		expect(readPreview(html, base)).toEqual({
			title: 'LCD-2',
			description: 'Planar & magnetic',
			siteName: 'Audeze',
			image: 'https://www.audeze.com/img/lcd2.jpg',
			favicon: 'https://cdn.audeze.com/touch.png',
		})
	})

	it('falls back to the title tag and the site’s own favicon', () => {
		const preview = readPreview('<html><head><title>  Practical &#8217;Typography&#x2019;\n </title></head></html>', new URL('https://practicaltypography.com/'))
		expect(preview.title).toBe('Practical ’Typography’')
		expect(preview.image).toBe('')
		expect(preview.favicon).toBe('https://practicaltypography.com/favicon.ico')
	})

	it('drops addresses that are not on the web', () => {
		const preview = readPreview('<head><meta property="og:image" content="javascript:alert(1)"></head>', base)
		expect(preview.image).toBe('')
	})
})

describe('decodePage', () => {
	it('reads the page in the encoding it declares', () => {
		const latin1 = Buffer.from('<meta charset="iso-8859-1"><title>Caf\xe9</title>', 'latin1')
		expect(decodePage(latin1, 'text/html')).toContain('Café')
		expect(decodePage(Buffer.from('<title>Café</title>'), 'text/html; charset=utf-8')).toContain('Café')
	})
})

describe('fetchPublic', () => {
	let server: Server
	let origin: string
	const allowAll = () => true

	beforeAll(async () => {
		server = createServer((req, res) => {
			if (req.url === '/hop') return res.writeHead(302, { location: '/page' }).end()
			if (req.url === '/loop') return res.writeHead(302, { location: '/loop' }).end()
			if (req.url === '/away') return res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end()
			if (req.url === '/page') {
				return res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync('<head><title>Page</title></head>'))
			}
			if (req.url === '/big') return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(4096))
			res.writeHead(404).end()
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
	})

	afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

	it('follows redirects and unpacks a compressed page', async () => {
		const page = await fetchPublic(new URL(`${origin}/hop`), { accept: 'text/html', maxBytes: 1024, isAllowed: allowAll })
		expect(page.url.pathname).toBe('/page')
		expect(page.body.toString()).toBe('<head><title>Page</title></head>')
	})

	it('refuses this machine unless told otherwise, redirects included', async () => {
		await expect(fetchPublic(new URL(`${origin}/page`), { accept: '*/*', maxBytes: 1024 })).rejects.toMatchObject({ status: 422 })
		await expect(fetchPublic(new URL('http://localhost:1/'), { accept: '*/*', maxBytes: 1024 })).rejects.toMatchObject({ status: 422 })
		// This test's server, and otherwise the rule: the redirect to the metadata service is refused.
		const thisServer = (address: string) => address === '127.0.0.1' || isPublicAddress(address)
		const away = fetchPublic(new URL(`${origin}/away`), { accept: '*/*', maxBytes: 1024, isAllowed: thisServer })
		await expect(away).rejects.toBeInstanceOf(FetchError)
		await expect(away).rejects.toMatchObject({ status: 422 })
	})

	it('gives up on a redirect loop and on a file past the limit', async () => {
		await expect(fetchPublic(new URL(`${origin}/loop`), { accept: '*/*', maxBytes: 1024, isAllowed: allowAll })).rejects.toMatchObject({ status: 502 })
		await expect(fetchPublic(new URL(`${origin}/big`), { accept: '*/*', maxBytes: 1024, isAllowed: allowAll })).rejects.toMatchObject({ status: 413 })
		const head = await fetchPublic(new URL(`${origin}/big`), { accept: '*/*', maxBytes: 1024, truncate: true, isAllowed: allowAll })
		expect(head.body.length).toBe(1024)
	})

	it('answers the app through the routes', async () => {
		const app = Fastify()
		registerLinkPreview(app, { isAllowed: allowAll })
		const preview = await app.inject({ url: `/api/link-preview?url=${encodeURIComponent(`${origin}/hop`)}` })
		expect(preview.json()).toMatchObject({ title: 'Page', favicon: `${origin}/favicon.ico` })
		expect((await app.inject({ url: '/api/link-preview?url=ftp://example.com/' })).statusCode).toBe(400)
		// Not a picture the board can keep: the page is HTML.
		expect((await app.inject({ url: `/api/link-preview/image?url=${encodeURIComponent(`${origin}/page`)}` })).statusCode).toBe(415)
		const image = await app.inject({ url: `/api/link-preview/image?url=${encodeURIComponent(`${origin}/big`)}` })
		expect(image.statusCode).toBe(200)
		expect(image.headers['content-type']).toBe('image/png')
	})

	it('refuses a private address through the routes by default', async () => {
		const app = Fastify()
		registerLinkPreview(app)
		expect((await app.inject({ url: `/api/link-preview?url=${encodeURIComponent(`${origin}/page`)}` })).statusCode).toBe(422)
		expect((await app.inject({ url: '/api/link-preview?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data' })).statusCode).toBe(422)
	})
})

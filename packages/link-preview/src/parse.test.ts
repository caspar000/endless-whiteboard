import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities, parseLinkPreview } from './parse'

const PAGE = 'https://www.theburntbuttertable.com/creamy-salmon-pasta/'

describe('parseLinkPreview', () => {
	it('reads the Open Graph set a real recipe page emits', () => {
		const preview = parseLinkPreview(
			`<!doctype html><html><head>
				<title>Creamy Salmon Pasta Recipe - The Burnt Butter Table</title>
				<meta property="og:title" content="Creamy Salmon Pasta Recipe (easy and delicious)" />
				<meta property="og:description" content="Ready in 20 minutes." />
				<meta property="og:image" content="https://cdn.example.com/salmon.jpg" />
				<meta property="og:site_name" content="The Burnt Butter Table" />
				<link rel="icon" href="/favicon-32.png" />
			</head><body>…</body></html>`,
			PAGE
		)
		expect(preview).toEqual({
			url: PAGE,
			title: 'Creamy Salmon Pasta Recipe (easy and delicious)',
			description: 'Ready in 20 minutes.',
			image: 'https://cdn.example.com/salmon.jpg',
			favicon: 'https://www.theburntbuttertable.com/favicon-32.png',
			siteName: 'The Burnt Butter Table',
		})
	})

	/*
	 * The regression that started all of this. tldraw's default handler turned an *absent* image
	 * into `new URL('', pageUrl)` — the page itself — and the bookmark card rendered the HTML
	 * document as an `<img src>`. Absent has to stay absent all the way out of the parser.
	 */
	it('leaves the image empty rather than resolving nothing against the page', () => {
		const preview = parseLinkPreview('<html><head><title>Plain</title></head></html>', PAGE)
		expect(preview.image).toBe('')
		expect(preview.title).toBe('Plain')
	})

	it('reports nothing at all for a page with no head worth reading', () => {
		expect(parseLinkPreview('<html><body>hi</body></html>', PAGE)).toEqual({
			url: PAGE,
			title: '',
			description: '',
			image: '',
			// The one convention it will guess at, because a missing favicon is invisible.
			favicon: 'https://www.theburntbuttertable.com/favicon.ico',
			siteName: '',
		})
	})

	it('returns an empty preview for empty input', () => {
		expect(parseLinkPreview('', PAGE).favicon).toBe('')
	})

	it('resolves relative and protocol-relative image URLs against the page', () => {
		expect(
			parseLinkPreview('<head><meta property="og:image" content="/img/hero.jpg"></head>', PAGE).image
		).toBe('https://www.theburntbuttertable.com/img/hero.jpg')
		expect(
			parseLinkPreview('<head><meta property="og:image" content="//cdn.x.com/h.jpg"></head>', PAGE)
				.image
		).toBe('https://cdn.x.com/h.jpg')
	})

	it('refuses an image that is not http(s), and falls through to the next candidate', () => {
		const preview = parseLinkPreview(
			`<head>
				<meta property="og:image" content="data:image/png;base64,AAA">
				<meta name="twitter:image" content="https://cdn.x.com/ok.jpg">
			</head>`,
			PAGE
		)
		expect(preview.image).toBe('https://cdn.x.com/ok.jpg')
	})

	it('drops a javascript: image entirely', () => {
		const preview = parseLinkPreview(
			'<head><meta property="og:image" content="javascript:alert(1)"></head>',
			PAGE
		)
		expect(preview.image).toBe('')
	})

	it('reads attributes in either order, with either quote style, and unquoted', () => {
		expect(
			parseLinkPreview('<head><meta content="Backwards" property="og:title"></head>', PAGE).title
		).toBe('Backwards')
		expect(
			parseLinkPreview("<head><meta property='og:title' content='Single'></head>", PAGE).title
		).toBe('Single')
		expect(parseLinkPreview('<head><meta property=og:title content=Bare></head>', PAGE).title).toBe(
			'Bare'
		)
	})

	it('collapses the whitespace a wrapped title arrives with', () => {
		expect(
			parseLinkPreview('<head><title>\n\t Creamy   Salmon\n Pasta \n</title></head>', PAGE).title
		).toBe('Creamy Salmon Pasta')
	})

	it('decodes the entities a CMS puts in a headline', () => {
		expect(
			parseLinkPreview('<head><meta property="og:title" content="Mum&#39;s pasta &amp; peas"></head>', PAGE)
				.title
		).toBe("Mum's pasta & peas")
	})

	it('prefers og:title over twitter:title over <title>', () => {
		const head = `<head>
			<title>Least</title>
			<meta name="twitter:title" content="Middle">
			<meta property="og:title" content="Most">
		</head>`
		expect(parseLinkPreview(head, PAGE).title).toBe('Most')
		expect(parseLinkPreview(head.replace(/<meta property="og:title"[^>]*>/, ''), PAGE).title).toBe(
			'Middle'
		)
	})

	it('takes the first of duplicate og tags, as a browser would', () => {
		expect(
			parseLinkPreview(
				'<head><meta property="og:title" content="First"><meta property="og:title" content="Second"></head>',
				PAGE
			).title
		).toBe('First')
	})

	/*
	 * A page *about* Open Graph, or one quoting markup in an article, must not be read as describing
	 * itself. Stopping at `</head>` is what makes that true.
	 */
	it('ignores og tags that appear in the body', () => {
		const preview = parseLinkPreview(
			`<head><title>Real</title></head>
			 <body><meta property="og:title" content="Quoted in an article"></body>`,
			PAGE
		)
		expect(preview.title).toBe('Real')
	})

	it('prefers an apple-touch-icon, and ignores a mask-icon', () => {
		const preview = parseLinkPreview(
			`<head>
				<link rel="mask-icon" href="/mask.svg" color="#000">
				<link rel="shortcut icon" href="/small.ico">
				<link rel="apple-touch-icon" href="/big.png">
			</head>`,
			PAGE
		)
		expect(preview.favicon).toBe('https://www.theburntbuttertable.com/big.png')
	})

	it('falls back to meta description when there is no og:description', () => {
		expect(
			parseLinkPreview('<head><meta name="description" content="From the name tag."></head>', PAGE)
				.description
		).toBe('From the name tag.')
	})

	it('carries the url it was given, so the caller knows what was described', () => {
		expect(parseLinkPreview('<head></head>', 'https://example.com/a').url).toBe(
			'https://example.com/a'
		)
	})
})

describe('decodeHtmlEntities', () => {
	it('handles named, decimal and hex references', () => {
		expect(decodeHtmlEntities('a &amp; b &#39;c&#39; &#x2014; d')).toBe("a & b 'c' — d")
	})

	it('leaves an unknown reference alone rather than eating it', () => {
		expect(decodeHtmlEntities('&notarealentity; &amp;')).toBe('&notarealentity; &')
	})

	it('is a no-op on text with no references', () => {
		expect(decodeHtmlEntities('nothing to do')).toBe('nothing to do')
	})
})

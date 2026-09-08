import { emptyLinkPreview, type LinkPreview } from './types'

/**
 * HTML in, `LinkPreview` out. Pure, synchronous, and free of any dependency — including the DOM.
 *
 * **Why not `DOMParser`.** The fetch has to happen in a Node process (a browser cannot read a
 * cross-origin page; see `node.ts`), and Node has no `DOMParser`. Pulling in a real HTML parser for
 * six fields out of `<head>` is a dependency and a supply-chain surface this package would rather
 * not have, so it scans tags with a regex instead. That is not a general-purpose HTML parser and
 * does not pretend to be one: it never builds a tree, never cares about nesting, and treats a tag it
 * cannot read as a tag that was not there. The failure mode is a missing field, which is already a
 * first-class answer here.
 *
 * Keeping it pure is also what makes it testable against real-world head markup, which is where all
 * of the surprises live — attributes in either order, single quotes, unquoted values, entities in
 * titles, protocol-relative image URLs, `og:image` given as a path.
 */

/** The named entities that actually turn up in titles. Numeric refs are handled generically. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	// Punctuation a CMS loves to emit in a headline.
	hellip: '…',
	mdash: '—',
	ndash: '–',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	middot: '·',
	bull: '•',
	trade: '™',
	reg: '®',
	copy: '©',
	deg: '°',
}

export function decodeHtmlEntities(text: string): string {
	if (!text.includes('&')) return text
	return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
		if (body.startsWith('#')) {
			const isHex = body[1] === 'x' || body[1] === 'X'
			const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
			if (!Number.isInteger(code)) return whole
			try {
				return String.fromCodePoint(code)
			} catch {
				// Out of range. Leaving the reference as written beats throwing over a stray `&#0;`.
				return whole
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? whole
	})
}

/** Titles arrive wrapped, indented and full of newlines far more often than not. */
function collapse(text: string): string {
	return decodeHtmlEntities(text).replace(/\s+/g, ' ').trim()
}

type Attributes = Record<string, string>

const ATTRIBUTE = /([a-z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+)/gi

function attributesOf(tag: string): Attributes {
	const attributes: Attributes = {}
	// A fresh lastIndex per tag: the regex is module-scoped for reuse and `exec` is stateful.
	ATTRIBUTE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = ATTRIBUTE.exec(tag)) !== null) {
		const name = match[1]?.toLowerCase()
		const raw = match[2]
		if (!name || raw === undefined) continue
		const quoted = raw.length > 1 && (raw.startsWith('"') || raw.startsWith("'"))
		attributes[name] = decodeHtmlEntities(quoted ? raw.slice(1, -1) : raw)
	}
	return attributes
}

/**
 * Absolute `http(s)` URL, or `''`.
 *
 * The gate that matters: a `javascript:` or `data:` `og:image` must never reach an `<img src>` in
 * the app, and a path (`/images/hero.jpg`) or a protocol-relative URL (`//cdn/hero.jpg`) has to be
 * resolved against the page it came from rather than dropped.
 */
function absoluteUrl(value: string | undefined, base: string): string {
	const trimmed = value?.trim()
	if (!trimmed) return ''
	try {
		const resolved = new URL(trimmed, base)
		return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : ''
	} catch {
		return ''
	}
}

/** The first non-empty candidate. Order is precedence, best source first. */
function firstOf(values: (string | undefined)[]): string {
	for (const value of values) {
		const collapsed = value ? collapse(value) : ''
		if (collapsed) return collapsed
	}
	return ''
}

/**
 * The first candidate that resolves to an `http(s)` URL.
 *
 * Resolving *per candidate* rather than taking the first present one is the point: a page whose
 * `og:image` is a `data:` URI still has a usable `twitter:image`, and falling through to it is
 * better than reporting no image because the preferred tag existed but was unusable.
 */
function firstAbsoluteUrl(values: (string | undefined)[], base: string): string {
	for (const value of values) {
		const resolved = absoluteUrl(value, base)
		if (resolved) return resolved
	}
	return ''
}

/**
 * `<meta>` values, keyed by `property`/`name`/`itemprop`, lowercased.
 *
 * First occurrence wins, which is what a browser does with duplicate `og:` tags and what a page
 * that emits both a hand-written and a plugin-generated set of them means.
 */
function metaTags(html: string): Map<string, string> {
	const found = new Map<string, string>()
	for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
		const attributes = attributesOf(tag)
		const key = (attributes['property'] ?? attributes['name'] ?? attributes['itemprop'])?.toLowerCase()
		const content = attributes['content']
		if (!key || !content || found.has(key)) continue
		found.set(key, content)
	}
	return found
}

/** `rel` values worth an icon, best first. A `rel` can hold several tokens (`shortcut icon`). */
const ICON_RELS = ['apple-touch-icon-precomposed', 'apple-touch-icon', 'icon', 'shortcut icon']

function iconUrl(html: string, base: string): string {
	const byRel = new Map<string, string>()
	for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
		const attributes = attributesOf(tag)
		const href = attributes['href']
		if (!href) continue
		const rel = attributes['rel']?.toLowerCase().trim()
		if (!rel) continue
		// An SVG-only icon is fine, but a `mask-icon` is a monochrome silhouette, not a favicon.
		if (rel.includes('mask-icon')) continue
		if (!byRel.has(rel)) byRel.set(rel, href)
	}
	for (const candidate of ICON_RELS) {
		for (const [rel, href] of byRel) {
			if (rel === candidate || rel.split(/\s+/).includes(candidate)) {
				const resolved = absoluteUrl(href, base)
				if (resolved) return resolved
			}
		}
	}
	/*
	 * Nothing declared, so guess `/favicon.ico` — the one guess this file allows itself, because it
	 * is a convention every browser already relies on and because a favicon that 404s is *invisible*
	 * (tldraw's bookmark swaps in a link glyph on the image's error event). The preview image gets no
	 * such treatment: a wrong one is a broken box on the canvas.
	 */
	return absoluteUrl('/favicon.ico', base)
}

export function parseLinkPreview(html: string, url: string): LinkPreview {
	const preview = emptyLinkPreview(url)
	if (!html) return preview

	/*
	 * Only the head is worth scanning, and stopping at `</head>` matters for more than speed: a
	 * `<meta property="og:title">` quoted inside an article body — a page *about* Open Graph, an
	 * escaped code sample — would otherwise be read as the page's own. When there is no `</head>`
	 * (there often isn't; it is optional), fall back to a bounded prefix rather than the whole body.
	 */
	const headEnd = html.search(/<\/head\s*>/i)
	const head = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, 128 * 1024)

	const meta = metaTags(head)
	const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]

	preview.title = firstOf([
		meta.get('og:title'),
		meta.get('twitter:title'),
		titleTag,
		meta.get('title'),
	])
	preview.description = firstOf([
		meta.get('og:description'),
		meta.get('twitter:description'),
		meta.get('description'),
	])
	preview.siteName = firstOf([meta.get('og:site_name'), meta.get('application-name')])
	preview.image = firstAbsoluteUrl(
		[
			meta.get('og:image:secure_url'),
			meta.get('og:image'),
			meta.get('og:image:url'),
			meta.get('twitter:image'),
			meta.get('twitter:image:src'),
		],
		url
	)
	preview.favicon = iconUrl(head, url)

	return preview
}

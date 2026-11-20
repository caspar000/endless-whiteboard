/**
 * Atom and RSS, read with the browser's own parser. Both are matched by local name, so a feed is read
 * the same whatever prefix it gives its namespaces (`media:thumbnail`, `yt:videoId`).
 */

export interface ParsedFeed {
	title: string
	/** The site or channel the feed is of. */
	link: string
	entries: ParsedEntry[]
}

export interface ParsedEntry {
	/** The feed's own id for it: Atom's `id`, RSS's `guid`, else its link. */
	id: string
	title: string
	link: string
	/** ISO, or '' when the feed gives no date it can be read from. */
	published: string
	thumbnail: string
	/** The entry's element, for a provider that reads more of it (YouTube's video id). */
	element: Element
}

const children = (el: Element, name: string): Element[] => [...el.children].filter((c) => c.localName === name)
const child = (el: Element, name: string): Element | undefined => children(el, name)[0]
const text = (el: Element | undefined): string => el?.textContent?.trim() ?? ''

/** `el`'s descendants of a name, nearest first: media thumbnails sit inside a `media:group`. */
function descendant(el: Element, name: string): Element | undefined {
	return [...el.getElementsByTagName('*')].find((c) => c.localName === name)
}

function isoDate(raw: string): string {
	if (!raw) return ''
	const time = Date.parse(raw)
	return Number.isNaN(time) ? '' : new Date(time).toISOString()
}

/** An Atom `link`: the `alternate` one, or the first with no `rel`. */
function atomLink(el: Element): string {
	const links = children(el, 'link')
	const alternate = links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate')
	return (alternate ?? links[0])?.getAttribute('href') ?? ''
}

function thumbnailOf(el: Element): string {
	const media = descendant(el, 'thumbnail')?.getAttribute('url')
	if (media) return media
	const image = [...el.getElementsByTagName('*')].find(
		(c) => (c.localName === 'content' && c.getAttribute('medium') === 'image') || (c.localName === 'enclosure' && (c.getAttribute('type') ?? '').startsWith('image/'))
	)
	return image?.getAttribute('url') ?? ''
}

/** A feed's posts and name, or `null` when the text is not Atom or RSS. */
export function parseFeedXml(xml: string): ParsedFeed | null {
	const doc = new DOMParser().parseFromString(xml, 'application/xml')
	if (doc.getElementsByTagName('parsererror').length) return null
	const root = doc.documentElement
	if (root.localName === 'feed') {
		return {
			title: text(child(root, 'title')),
			link: atomLink(root),
			entries: children(root, 'entry').map((entry) => ({
				id: text(child(entry, 'id')) || atomLink(entry),
				title: text(child(entry, 'title')),
				link: atomLink(entry),
				published: isoDate(text(child(entry, 'published')) || text(child(entry, 'updated'))),
				thumbnail: thumbnailOf(entry),
				element: entry,
			})),
		}
	}
	// RSS 2.0 keeps its items in the channel; RSS 1.0 (RDF) beside it.
	const channel = root.localName === 'rss' ? child(root, 'channel') : root.localName === 'RDF' ? child(root, 'channel') : undefined
	if (!channel) return null
	const items = [...children(channel, 'item'), ...children(root, 'item')]
	return {
		title: text(child(channel, 'title')),
		link: text(child(channel, 'link')),
		entries: items.map((item) => {
			const link = text(child(item, 'link'))
			return {
				id: text(child(item, 'guid')) || link,
				title: text(child(item, 'title')),
				link,
				published: isoDate(text(child(item, 'pubDate')) || text(child(item, 'date'))),
				thumbnail: thumbnailOf(item),
				element: item,
			}
		}),
	}
}

/** The feeds a web page points to with `<link rel="alternate">`, as absolute addresses. */
export function discoverFeeds(html: string, pageUrl: string): string[] {
	const doc = new DOMParser().parseFromString(html, 'text/html')
	const out: string[] = []
	for (const link of doc.querySelectorAll('link[rel~="alternate"][href]')) {
		if (!/application\/(rss|atom)\+xml/i.test(link.getAttribute('type') ?? '')) continue
		try {
			out.push(new URL(link.getAttribute('href')!, pageUrl).href)
		} catch {
			// An address that doesn't parse is a page's mistake; the next link may be fine.
		}
	}
	return out
}

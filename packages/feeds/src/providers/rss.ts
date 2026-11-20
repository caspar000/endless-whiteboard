import type { FeedItem } from '../model'
import { Rss } from 'lucide-react'
import type { FeedProvider } from './registry'
import { discoverFeeds, parseFeedXml } from './xml'

/** A site's address as typed: `hackaday.com/feed` is meant as https. */
function addressOf(input: string): string | null {
	const raw = input.trim()
	if (!raw) return null
	try {
		const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
	} catch {
		return null
	}
}

/** Any RSS or Atom feed, or a page that points to one. */
export const rssProvider: FeedProvider = {
	id: 'rss',
	name: 'RSS',
	icon: Rss,
	available: true,
	inputLabel: 'Feed or site URL',
	placeholder: 'https://hackaday.com/blog/feed/',

	async resolve(input, read) {
		const address = addressOf(input)
		if (!address) return { error: 'Paste the address of an RSS or Atom feed, or of a site that has one.' }
		const first = await read(address)
		if (!first.ok) return { error: first.reason === 'unavailable' ? first.message : `Couldn't open that address. ${first.message}` }
		let feed = { url: first.url, parsed: parseFeedXml(first.text) }
		if (!feed.parsed) {
			// A page, not a feed: follow the feed it points to, if it points to one.
			const [found] = discoverFeeds(first.text, first.url)
			if (!found) return { error: "There's no feed at that address, and the page doesn't point to one." }
			const second = await read(found)
			if (!second.ok) return { error: `Couldn't read the feed that page points to. ${second.message}` }
			feed = { url: second.url, parsed: parseFeedXml(second.text) }
			if (!feed.parsed) return { error: "The feed that page points to couldn't be read." }
		}
		const link = feed.parsed!.link ? new URL(feed.parsed!.link, feed.url).href : feed.url
		return { feedUrl: feed.url, link, title: feed.parsed!.title || new URL(feed.url).hostname.replace(/^www\./, '') }
	},

	parse(text, source) {
		const parsed = parseFeedXml(text)
		if (!parsed) return null
		return parsed.entries.flatMap((entry): FeedItem[] => {
			if (!entry.link && !entry.id) return []
			let url: string
			try {
				url = new URL(entry.link || entry.id, source.feedUrl).href
			} catch {
				return []
			}
			return [{ itemId: `rss:${entry.id || url}`, sourceId: source.sourceId, title: entry.title || url, url, published: entry.published, thumbnail: entry.thumbnail }]
		})
	},
}

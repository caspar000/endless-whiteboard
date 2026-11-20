import type { FeedItem } from '../model'
import { YouTubeIcon } from './icons'
import type { FeedProvider } from './registry'
import { parseFeedXml } from './xml'

const CHANNEL_ID = /^UC[\w-]{22}$/
const HOSTS = /^(www\.|m\.|music\.)?youtube\.com$/

const feedOf = (channelId: string) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`

/** A channel id said outright in what was pasted, or the page to read to find one. */
export function channelFrom(input: string): { channelId: string } | { page: string } | { error: string } {
	const raw = input.trim()
	if (!raw) return { error: 'Paste a YouTube channel link or @handle.' }
	if (CHANNEL_ID.test(raw)) return { channelId: raw }
	if (/^@[\w.-]{3,100}$/.test(raw)) return { page: `https://www.youtube.com/${raw}` }
	let url: URL
	try {
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
	} catch {
		return { error: "That doesn't look like a YouTube channel. Paste a channel link (youtube.com/@name) or an @handle." }
	}
	if (url.hostname === 'youtu.be') return { page: `https://www.youtube.com/watch?v=${url.pathname.slice(1)}` }
	if (!HOSTS.test(url.hostname)) return { error: 'That is not a YouTube address. For another site, use RSS.' }
	const channel = /^\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1] ?? url.searchParams.get('channel_id')
	if (channel && CHANNEL_ID.test(channel)) return { channelId: channel }
	if (url.pathname === '/' || url.pathname === '') return { error: 'Paste the address of a channel, not of YouTube itself.' }
	return { page: `https://www.youtube.com${url.pathname}${url.search}` }
}

/** The channel a YouTube page is of: a channel's page says so in its canonical link, a video's in its data. */
export function channelIdInPage(html: string): string | null {
	return (
		/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
		/<meta itemprop="(?:identifier|channelId)" content="(UC[\w-]{22})"/.exec(html)?.[1] ??
		/"(?:externalId|channelId)":"(UC[\w-]{22})"/.exec(html)?.[1] ??
		null
	)
}

const videoIdOf = (url: string) => /[?&]v=([\w-]{11})/.exec(url)?.[1] ?? /\/(?:shorts|embed|live)\/([\w-]{11})/.exec(url)?.[1] ?? null

/**
 * A YouTube channel, read from its public feed: the newest 15 videos, with no key or account. The feed
 * says nothing of a video's length, so the card shows none.
 */
export const youtubeProvider: FeedProvider = {
	id: 'youtube',
	name: 'YouTube',
	icon: YouTubeIcon,
	available: true,
	inputLabel: 'Channel URL or @handle',
	placeholder: 'youtube.com/@BenEater',

	async resolve(input, read) {
		const found = channelFrom(input)
		if ('error' in found) return found
		let channelId = 'channelId' in found ? found.channelId : null
		if (!channelId && 'page' in found) {
			const page = await read(found.page)
			if (!page.ok) return { error: page.reason === 'unavailable' ? page.message : `Couldn't open that channel. ${page.message}` }
			channelId = channelIdInPage(page.text)
			if (!channelId) return { error: "Couldn't find a channel on that page." }
		}
		const feed = await read(feedOf(channelId!))
		if (!feed.ok) return { error: feed.reason === 'unavailable' ? feed.message : `Couldn't read that channel's videos. ${feed.message}` }
		const parsed = parseFeedXml(feed.text)
		if (!parsed) return { error: "YouTube didn't answer with that channel's videos." }
		return { feedUrl: feedOf(channelId!), link: `https://www.youtube.com/channel/${channelId}`, title: parsed.title || channelId! }
	},

	parse(text, source) {
		const parsed = parseFeedXml(text)
		if (!parsed) return null
		return parsed.entries.flatMap((entry): FeedItem[] => {
			const videoId = [...entry.element.children].find((c) => c.localName === 'videoId')?.textContent?.trim() || videoIdOf(entry.link)
			if (!videoId) return []
			return [
				{
					itemId: `yt:${videoId}`,
					sourceId: source.sourceId,
					title: entry.title,
					url: entry.link || `https://www.youtube.com/watch?v=${videoId}`,
					published: entry.published,
					// The feed's own picture is 4:3 with black bars; this one is the video's shape.
					thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
				},
			]
		})
	},

	embedUrl(item) {
		const id = item.itemId.startsWith('yt:') ? item.itemId.slice(3) : null
		return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1` : null
	},
}

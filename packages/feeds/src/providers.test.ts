import type { ExternalText } from '@lifeboard/node-kit'
import { describe, expect, it } from 'vitest'
import type { FeedSource } from './model'
import { rssProvider } from './providers/rss'
import { discoverFeeds, parseFeedXml } from './providers/xml'
import { channelFrom, channelIdInPage, youtubeProvider } from './providers/youtube'
// Ben Eater's channel as YouTube served it, cut to three videos without their descriptions.
import YOUTUBE from '../fixtures/youtube.xml?raw'
import RSS from '../fixtures/rss.xml?raw'
const CHANNEL = 'UCS0N5baNlQWJCUrhCEo8WlA'

const source = (over: Partial<FeedSource> = {}): FeedSource => ({
	sourceId: 'src_1',
	provider: 'youtube',
	feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
	link: '',
	title: 'Ben Eater',
	categories: [],
	addedAt: '',
	boardId: '',
	...over,
})

/** A transport that answers from a table, and remembers what it was asked. */
function site(pages: Record<string, string>) {
	const asked: string[] = []
	const read = async (url: string): Promise<ExternalText> => {
		asked.push(url)
		return url in pages ? { ok: true, url, text: pages[url]! } : { ok: false, reason: 'failed', message: 'The site answered 404.' }
	}
	return { read, asked }
}

describe('reading feeds', () => {
	it('reads an Atom feed: its name, link and entries', () => {
		const feed = parseFeedXml(YOUTUBE)!
		expect(feed.title).toBe('Ben Eater')
		expect(feed.link).toBe(`https://www.youtube.com/channel/${CHANNEL}`)
		expect(feed.entries).toHaveLength(3)
		expect(feed.entries[0]).toMatchObject({
			id: 'yt:video:ou2RFTK86eA',
			title: 'Setting the time on my breadboard clock: Breadboard clock part 5',
			published: '2026-10-18T14:00:12.000Z',
			thumbnail: 'https://i4.ytimg.com/vi/ou2RFTK86eA/hqdefault.jpg',
		})
	})

	it('reads RSS: entities, CDATA, RFC 822 and Dublin Core dates, pictures from either tag', () => {
		const feed = parseFeedXml(RSS)!
		expect(feed.title).toBe('Hackaday')
		expect(feed.entries.map((e) => e.title)).toEqual(['A Tiny CRT Clock & Its Driver', 'Reverse-Engineering a <Cheap> Multimeter', 'No link and no guid'])
		expect(feed.entries[0]).toMatchObject({ id: 'https://hackaday.com/?p=812345', published: '2026-11-18T15:00:00.000Z', thumbnail: 'https://hackaday.com/wp-content/uploads/crt.jpg' })
		expect(feed.entries[1]).toMatchObject({ id: '/2026/11/17/cheap-multimeter/', published: '2026-11-17T09:30:00.000Z', thumbnail: 'https://hackaday.com/wp-content/uploads/meter.png' })
	})

	it('says when the text is not a feed', () => {
		expect(parseFeedXml('<html><body>hi</body></html>')).toBeNull()
		expect(parseFeedXml('not xml at all <')).toBeNull()
	})

	it("finds the feeds a page points to, as full addresses", () => {
		const html = `<html><head>
			<link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/">
			<link rel="alternate" type="text/html" href="/other">
			<link rel="alternate" type="application/atom+xml" href="https://example.com/atom.xml">
		</head></html>`
		expect(discoverFeeds(html, 'https://hackaday.com/blog/')).toEqual(['https://hackaday.com/feed/', 'https://example.com/atom.xml'])
	})
})

describe('YouTube', () => {
	it('knows a channel from every way of writing one', () => {
		expect(channelFrom(CHANNEL)).toEqual({ channelId: CHANNEL })
		expect(channelFrom(`https://www.youtube.com/channel/${CHANNEL}/videos`)).toEqual({ channelId: CHANNEL })
		expect(channelFrom(`youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`)).toEqual({ channelId: CHANNEL })
		expect(channelFrom('@BenEater')).toEqual({ page: 'https://www.youtube.com/@BenEater' })
		expect(channelFrom('https://m.youtube.com/@BenEater/videos')).toEqual({ page: 'https://www.youtube.com/@BenEater/videos' })
		expect(channelFrom('youtube.com/c/EEVblog')).toEqual({ page: 'https://www.youtube.com/c/EEVblog' })
		expect(channelFrom('https://youtu.be/ou2RFTK86eA')).toEqual({ page: 'https://www.youtube.com/watch?v=ou2RFTK86eA' })
		expect(channelFrom('')).toHaveProperty('error')
		expect(channelFrom('https://vimeo.com/someone')).toHaveProperty('error')
		expect(channelFrom('https://www.youtube.com/')).toHaveProperty('error')
	})

	it("finds the channel on a channel's page and on a video's", () => {
		expect(channelIdInPage(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}">`)).toBe(CHANNEL)
		expect(channelIdInPage(`<script>var x = {"videoId":"ou2RFTK86eA","channelId":"${CHANNEL}"}</script>`)).toBe(CHANNEL)
		expect(channelIdInPage('<html>nothing here</html>')).toBeNull()
	})

	it('adds a channel from its @handle: its page, then its feed', async () => {
		const { read, asked } = site({
			'https://www.youtube.com/@BenEater': `<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL}">`,
			[`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`]: YOUTUBE,
		})
		expect(await youtubeProvider.resolve('@BenEater', read)).toEqual({
			feedUrl: `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`,
			link: `https://www.youtube.com/channel/${CHANNEL}`,
			title: 'Ben Eater',
		})
		expect(asked).toHaveLength(2)
	})

	it('says why a channel could not be added', async () => {
		expect(await youtubeProvider.resolve('@nobody', site({}).read)).toEqual({ error: expect.stringMatching(/Couldn't open that channel/) })
		const unavailable = async (): Promise<ExternalText> => ({ ok: false, reason: 'unavailable', message: 'Reading other sites needs the Lifeboard server.' })
		expect(await youtubeProvider.resolve(CHANNEL, unavailable)).toEqual({ error: 'Reading other sites needs the Lifeboard server.' })
	})

	it("reads a channel's videos, with pictures the shape of the video", () => {
		const items = youtubeProvider.parse(YOUTUBE, source())!
		expect(items).toHaveLength(3)
		expect(items[0]).toEqual({
			itemId: 'yt:ou2RFTK86eA',
			sourceId: 'src_1',
			title: 'Setting the time on my breadboard clock: Breadboard clock part 5',
			url: 'https://www.youtube.com/watch?v=ou2RFTK86eA',
			published: '2026-10-18T14:00:12.000Z',
			thumbnail: 'https://i.ytimg.com/vi/ou2RFTK86eA/mqdefault.jpg',
		})
		expect(youtubeProvider.embedUrl!(items[0]!)).toBe('https://www.youtube-nocookie.com/embed/ou2RFTK86eA?autoplay=1')
	})
})

describe('RSS', () => {
	it('adds a feed by its address, or by a page that points to one', async () => {
		const pages = {
			'https://hackaday.com/feed/': RSS,
			'https://hackaday.com/': '<link rel="alternate" type="application/rss+xml" href="/feed/">',
		}
		expect(await rssProvider.resolve('https://hackaday.com/feed/', site(pages).read)).toEqual({
			feedUrl: 'https://hackaday.com/feed/',
			link: 'https://hackaday.com/',
			title: 'Hackaday',
		})
		expect(await rssProvider.resolve('hackaday.com', site(pages).read)).toMatchObject({ feedUrl: 'https://hackaday.com/feed/' })
		expect(await rssProvider.resolve('https://example.com/', site({ 'https://example.com/': '<html></html>' }).read)).toEqual({
			error: expect.stringMatching(/no feed/),
		})
	})

	it('reads the posts, with links made whole and those with nowhere to go left out', () => {
		const items = rssProvider.parse(RSS, source({ provider: 'rss', feedUrl: 'https://hackaday.com/feed/' }))!
		expect(items.map((i) => i.url)).toEqual(['https://hackaday.com/2026/11/18/a-tiny-crt-clock/', 'https://hackaday.com/2026/11/17/cheap-multimeter/'])
		expect(items[0]!.itemId).toBe('rss:https://hackaday.com/?p=812345')
	})
})

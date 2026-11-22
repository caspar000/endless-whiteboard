import { describe, expect, it, vi } from 'vitest'
import type { FeedCategory, FeedItem, FeedSource, SourceItems } from './model'
import { feedChoices, feedEntries, feedKind, feedsRandomizerSource, sourcesOfChoice } from './randomizerSource'
import { replaceSourceItems, replaceSources, replaceWatched, watchedOn } from './store'

const post = (itemId: string, published: string, thumbnail = ''): FeedItem => ({ itemId, sourceId: '', title: `Post ${itemId}`, url: `https://x/${itemId}`, published, thumbnail })
const src = (sourceId: string, title: string, categories: string[], provider = 'youtube', boardId = 'b1'): FeedSource => ({
	sourceId,
	provider,
	feedUrl: `https://f/${sourceId}`,
	link: '',
	title,
	categories,
	addedAt: '',
	boardId,
})
const kept = (sourceId: string, items: FeedItem[]): SourceItems => ({ sourceId, fetchedAt: '2026-11-19T00:00:00Z', items, error: '' })
const cat = (categoryId: string, name: string, order: number): FeedCategory => ({ categoryId, name, color: 'blue', order, boardId: 'b1' })

const SOURCES = {
	ben: src('ben', 'Ben Eater', ['ee']),
	eev: src('eev', 'EEVblog', ['ee']),
	blog: src('blog', 'A blog', [], 'rss'),
}
const CATEGORIES = { ee: cat('ee', 'Electronics', 0) }
const ITEMS = {
	ben: kept('ben', [post('yt:b1', '2026-11-19T08:00:00Z', 'https://i.ytimg.com/vi/b1/mqdefault.jpg')]),
	// The same video under two channels is shuffled once.
	eev: kept('eev', [post('yt:e1', '2026-11-18T10:00:00Z'), post('yt:b1', '2026-11-19T08:00:00Z')]),
	blog: kept('blog', [post('p1', '2026-11-17T08:00:00Z')]),
}

describe('feeds as a randomizer source', () => {
	it('offers a board’s feeds and each of its categories, never one channel alone (DARK-14)', () => {
		expect(feedChoices('b1', CATEGORIES)).toEqual([
			{ id: 'all:b1', label: 'All feeds', group: '' },
			{ id: 'cat:ee', label: 'Electronics', group: 'Categories' },
		])
	})

	it('draws all feeds of its own board only, and all of those from before boards had feeds for a card set to them', () => {
		const sources = { ...SOURCES, other: src('other', 'Elsewhere', [], 'rss', 'b2'), old: src('old', 'Before', [], 'rss', '') }
		const items = { ...ITEMS, other: kept('other', [post('o1', '2026-11-01T00:00:00Z')]), old: kept('old', [post('x1', '2026-11-01T00:00:00Z')]) }
		expect(feedEntries(sources, CATEGORIES, items, 'all:b1').map((e) => e.id)).toEqual(['yt:b1', 'yt:e1', 'p1'])
		expect(feedEntries(sources, CATEGORIES, items, 'all:b2').map((e) => e.id)).toEqual(['o1'])
		expect(feedEntries(sources, CATEGORIES, items, 'all').map((e) => e.id)).toEqual(['x1'])
	})

	it("gives a category's videos newest first, once each, as entries with their channel, day, picture and address", () => {
		const entries = feedEntries(SOURCES, CATEGORIES, ITEMS, 'cat:ee')
		expect(entries.map((e) => e.id)).toEqual(['yt:b1', 'yt:e1'])
		expect(entries[0]).toEqual({
			id: 'yt:b1',
			title: 'Post yt:b1',
			creator: 'Ben Eater',
			year: '19 Nov 2026',
			cover: 'https://i.ytimg.com/vi/b1/mqdefault.jpg',
			url: 'https://x/yt:b1',
		})
		expect(feedEntries(SOURCES, CATEGORIES, ITEMS, 'all:b1').map((e) => e.id)).toEqual(['yt:b1', 'yt:e1', 'p1'])
		expect(feedEntries(SOURCES, CATEGORIES, ITEMS, 'src:blog').map((e) => e.id)).toEqual(['p1'])
	})

	it('has nothing for a category or channel that is gone', () => {
		expect(sourcesOfChoice(SOURCES, CATEGORIES, 'cat:gone')).toBeNull()
		expect(sourcesOfChoice(SOURCES, CATEGORIES, 'src:gone')).toBeNull()
		expect(feedEntries(SOURCES, CATEGORIES, ITEMS, 'cat:gone')).toEqual([])
	})

	it('speaks of videos when every source is a YouTube channel, and of posts otherwise', () => {
		expect(feedKind(SOURCES, CATEGORIES, 'cat:ee')).toMatchObject({ noun: 'videos', creator: 'Channel' })
		expect(feedKind(SOURCES, CATEGORIES, 'all:b1')).toMatchObject({ noun: 'posts' })
	})

	it('opens a video in a new tab and marks it watched on the board it was opened from only, as the feed card does', () => {
		replaceWatched({})
		// Board b2 follows the same channel and has the same video, unwatched.
		replaceSources({ ...SOURCES, other: src('other', 'Ben Eater', [], 'youtube', 'b2') })
		replaceSourceItems({ ...ITEMS, other: kept('other', [post('yt:b1', '2026-11-19T08:00:00Z')]) })
		const open = vi.spyOn(window, 'open').mockImplementation(() => null)
		feedsRandomizerSource.open?.({ id: 'yt:b1', url: 'https://www.youtube.com/watch?v=b1' }, 'b1')
		expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=b1', '_blank', 'noopener,noreferrer')
		expect(watchedOn('b1')['yt:b1']).toBeTruthy()
		expect(watchedOn('b2')['yt:b1']).toBeUndefined()
		open.mockRestore()
	})
})

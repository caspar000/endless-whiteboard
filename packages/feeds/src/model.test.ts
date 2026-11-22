import { beforeEach, describe, expect, it } from 'vitest'
import { checkCategoryName, feedItems, mergeItems, nextColor, pruneWatched, timeAgo, unwatchedCount, type FeedCategory, type FeedItem, type FeedSource, type SourceItems } from './model'
import {
	addCategory,
	addSource,
	categoriesOn,
	claimFeeds,
	getCategories,
	getSourceItems,
	getSources,
	getWatched,
	moveCategory,
	recordRead,
	removeCategory,
	removeSource,
	renameCategory,
	replaceCategories,
	replaceSourceItems,
	replaceSources,
	replaceWatched,
	setSourceInCategory,
	setWatched,
	sourcesOn,
	watchedOn,
} from './store'

const item = (itemId: string, sourceId: string, published: string): FeedItem => ({ itemId, sourceId, title: itemId, url: `https://x/${itemId}`, published, thumbnail: '' })
const src = (sourceId: string, categories: string[], boardId = 'b1'): FeedSource => ({ sourceId, provider: 'youtube', feedUrl: `https://f/${sourceId}`, link: '', title: sourceId, categories, addedAt: '', boardId })
const kept = (sourceId: string, items: FeedItem[]): SourceItems => ({ sourceId, fetchedAt: '2026-11-19T00:00:00Z', items, error: '' })

const SOURCES = { eevblog: src('eevblog', ['ee']), beneater: src('beneater', ['ee', 'computers']), twelvetone: src('twelvetone', ['music']), loose: src('loose', []) }
const ITEMS = {
	eevblog: kept('eevblog', [item('e1', 'eevblog', '2026-11-18T10:00:00Z'), item('e2', 'eevblog', '2026-11-10T10:00:00Z')]),
	beneater: kept('beneater', [item('b1', 'beneater', '2026-11-19T08:00:00Z')]),
	twelvetone: kept('twelvetone', [item('t1', 'twelvetone', '2026-11-17T08:00:00Z')]),
	loose: kept('loose', [item('l1', 'loose', '2026-11-16T08:00:00Z')]),
}

describe('the feed', () => {
	it('shows every source newest first, or one category', () => {
		const ids = (categoryId: string) => feedItems(SOURCES, ITEMS, {}, { categoryId, show: 'all' }).map((i) => i.itemId)
		expect(ids('')).toEqual(['b1', 'e1', 't1', 'l1', 'e2'])
		expect(ids('ee')).toEqual(['b1', 'e1', 'e2'])
		expect(ids('music')).toEqual(['t1'])
		expect(ids('nothing filed')).toEqual([])
	})

	it('leaves out what was watched, unless asked to show it or to keep it', () => {
		const watched = { e1: { itemId: 'e1', at: '2026-11-19T00:00:00Z', boardId: 'b1' } }
		expect(feedItems(SOURCES, ITEMS, watched, { categoryId: 'ee', show: 'unwatched' }).map((i) => i.itemId)).toEqual(['b1', 'e2'])
		expect(feedItems(SOURCES, ITEMS, watched, { categoryId: 'ee', show: 'all' }).map((i) => i.itemId)).toEqual(['b1', 'e1', 'e2'])
		expect(feedItems(SOURCES, ITEMS, watched, { categoryId: 'ee', show: 'unwatched', keep: new Set(['e1']) }).map((i) => i.itemId)).toEqual(['b1', 'e1', 'e2'])
		expect(unwatchedCount(SOURCES, ITEMS, watched, '')).toBe(4)
		expect(unwatchedCount(SOURCES, ITEMS, watched, 'ee')).toBe(2)
	})

	it('shows a post two sources share once', () => {
		const twice = { a: src('a', []), b: src('b', []) }
		const shared = { a: kept('a', [item('same', 'a', '2026-11-01T00:00:00Z')]), b: kept('b', [item('same', 'b', '2026-11-01T00:00:00Z')]) }
		expect(feedItems(twice, shared, {}, { categoryId: '', show: 'all' })).toHaveLength(1)
	})

	it('keeps old posts a feed no longer lists, newest first, up to a limit', () => {
		const old = [item('a', 's', '2026-01-01T00:00:00Z'), item('b', 's', '2026-02-01T00:00:00Z')]
		const fresh = [{ ...item('b', 's', '2026-02-01T00:00:00Z'), title: 'renamed' }, item('c', 's', '2026-03-01T00:00:00Z')]
		const merged = mergeItems(old, fresh)
		expect(merged.map((i) => i.itemId)).toEqual(['c', 'b', 'a'])
		expect(merged[1]!.title).toBe('renamed')
		const many = Array.from({ length: 80 }, (_, i) => item(`n${i}`, 's', new Date(Date.UTC(2026, 0, 1 + i)).toISOString()))
		expect(mergeItems([], many)).toHaveLength(60)
		expect(mergeItems([], many)[0]!.itemId).toBe('n79')
	})

	it('drops watched marks once their posts are long gone', () => {
		const now = new Date('2026-11-19T00:00:00Z')
		const marks = { fresh: { itemId: 'fresh', at: '2026-11-01T00:00:00Z', boardId: 'b1' }, stale: { itemId: 'stale', at: '2026-01-01T00:00:00Z', boardId: 'b1' } }
		expect(Object.keys(pruneWatched(marks, now))).toEqual(['fresh'])
	})

	it('says how long ago', () => {
		const now = Date.parse('2026-11-19T12:00:00Z')
		expect(timeAgo('2026-11-19T11:59:40Z', now)).toBe('just now')
		expect(timeAgo('2026-11-19T11:18:00Z', now)).toBe('42m ago')
		expect(timeAgo('2026-11-19T09:00:00Z', now)).toBe('3h ago')
		expect(timeAgo('2026-11-16T12:00:00Z', now)).toBe('3d ago')
		expect(timeAgo('not a date', now)).toBe('')
	})
})

describe('categories', () => {
	const cat = (categoryId: string, name: string, color: string, order = 0): FeedCategory => ({ categoryId, name, color, order, boardId: 'b1' })

	it('takes a tidy name nobody else has', () => {
		const all = { ee: cat('ee', 'Electrical Engineering', 'blue') }
		expect(checkCategoryName('  Music   theory ', all)).toEqual({ name: 'Music theory' })
		expect(checkCategoryName('electrical engineering', all)).toHaveProperty('error')
		expect(checkCategoryName('Electrical Engineering', all, 'ee')).toEqual({ name: 'Electrical Engineering' })
		expect(checkCategoryName('   ', all)).toHaveProperty('error')
	})

	it('gives a new category the colour fewest have', () => {
		expect(nextColor({})).toBe('blue')
		expect(nextColor({ a: cat('a', 'A', 'blue'), b: cat('b', 'B', 'amber') })).toBe('pink')
	})
})

describe('the store', () => {
	beforeEach(() => {
		replaceSources({})
		replaceCategories({})
		replaceWatched({})
		replaceSourceItems({})
	})

	it('makes, renames, orders and deletes categories; a deleted one leaves its sources be', () => {
		const ee = addCategory('b1', 'Electrical Engineering') as FeedCategory
		const music = addCategory('b1', 'Music') as FeedCategory
		expect(addCategory('b1', 'music')).toHaveProperty('error')
		// Another board makes its own, and may give it the same name.
		expect(addCategory('b2', 'Music')).not.toHaveProperty('error')
		expect(Object.values(categoriesOn('b2')).map((c) => c.name)).toEqual(['Music'])
		expect(Object.values(categoriesOn('b1')).map((c) => [c.name, c.order])).toEqual([
			['Electrical Engineering', 0],
			['Music', 1],
		])
		moveCategory(music.categoryId, -1)
		expect(getCategories()[music.categoryId]!.order).toBe(0)
		expect(renameCategory(ee.categoryId, 'EE')).toBeNull()
		expect(getCategories()[ee.categoryId]!.name).toBe('EE')

		const source = addSource('b1', { provider: 'youtube', feedUrl: 'https://f/1', link: '', title: 'EEVblog', categories: [ee.categoryId] })
		setSourceInCategory(source.sourceId, music.categoryId, true)
		expect(getSources()[source.sourceId]!.categories).toEqual([ee.categoryId, music.categoryId])
		removeCategory(ee.categoryId)
		expect(getCategories()[ee.categoryId]).toBeUndefined()
		expect(getSources()[source.sourceId]!.categories).toEqual([music.categoryId])
	})

	it('files a feed added twice to a board into both places, as one source; another board follows it on its own', () => {
		const a = addSource('b1', { provider: 'youtube', feedUrl: 'https://f/1', link: '', title: 'EEVblog', categories: ['ee'] })
		const b = addSource('b1', { provider: 'youtube', feedUrl: 'https://f/1', link: '', title: 'EEVblog', categories: ['repair'] })
		expect(b.sourceId).toBe(a.sourceId)
		expect(Object.keys(getSources())).toHaveLength(1)
		expect(getSources()[a.sourceId]!.categories).toEqual(['ee', 'repair'])
		recordRead(a.sourceId, { items: [item('v', a.sourceId, '2026-11-01T00:00:00Z')] })
		const other = addSource('b2', { provider: 'youtube', feedUrl: 'https://f/1', link: '', title: 'EEVblog', categories: [] })
		expect(other.sourceId).not.toBe(a.sourceId)
		expect(Object.keys(sourcesOn('b2'))).toEqual([other.sourceId])
		// Its posts already read are the new board's from the start.
		expect(getSourceItems()[other.sourceId]?.items.map((i) => [i.itemId, i.sourceId])).toEqual([['v', other.sourceId]])
	})

	it('records reads: new posts merged in, and a failure keeps what was there', () => {
		recordRead('s', { items: [item('a', 's', '2026-11-01T00:00:00Z')] })
		recordRead('s', { error: 'The site answered 500.' })
		expect(getSourceItems().s).toMatchObject({ error: 'The site answered 500.', items: [{ itemId: 'a' }] })
		recordRead('s', { items: [item('b', 's', '2026-11-02T00:00:00Z')] })
		expect(getSourceItems().s).toMatchObject({ error: '', items: [{ itemId: 'b' }, { itemId: 'a' }] })
		removeSource('s')
		expect(getSourceItems().s).toBeUndefined()
	})

	it('marks watched and unwatched, on one board only', () => {
		setWatched('b1', ['a', 'b'], true)
		setWatched('b1', ['a'], false)
		expect(Object.keys(watchedOn('b1'))).toEqual(['b'])
		expect(watchedOn('b2')).toEqual({})
		replaceWatched(JSON.parse(JSON.stringify(getWatched())))
		expect(Object.keys(watchedOn('b1'))).toEqual(['b'])
	})

	it('gives each board with a feed card its own copy of the feeds from before DARK-14, once (DARK-14)', () => {
		replaceCategories({ ee: { categoryId: 'ee', name: 'EE', color: 'blue', order: 0 } })
		replaceSources({ old: { ...src('old', ['ee']), boardId: undefined } })
		replaceSourceItems({ old: kept('old', [item('o1', 'old', '2026-11-01T00:00:00Z')]) })
		replaceWatched({ o1: { itemId: 'o1', at: new Date().toISOString() } })

		expect(claimFeeds('b1')).toBe(true)
		const [copy] = Object.values(sourcesOn('b1'))
		const [category] = Object.values(categoriesOn('b1'))
		expect(copy).toMatchObject({ title: 'old', feedUrl: 'https://f/old', boardId: 'b1', categories: [category!.categoryId] })
		expect(category).toMatchObject({ name: 'EE', boardId: 'b1' })
		expect(getSourceItems()[copy!.sourceId]?.items.map((i) => i.itemId)).toEqual(['o1'])
		expect(Object.keys(watchedOn('b1'))).toEqual(['o1'])

		// Once: a board that has its copy, even one it changed since, gets no second.
		removeSource(copy!.sourceId)
		expect(claimFeeds('b1')).toBe(false)
		expect(sourcesOn('b1')).toEqual({})
		// Another board gets its own; the old ones stay, for the randomizers set to them.
		expect(claimFeeds('b2')).toBe(true)
		expect(Object.keys(sourcesOn('b2'))).toHaveLength(1)
		expect(getSources().old?.claimedBy).toEqual(['b1', 'b2'])
		// And the marks survive a save.
		replaceSources(JSON.parse(JSON.stringify(getSources())))
		expect(claimFeeds('b2')).toBe(false)
	})

	it('drops what it cannot read when loading a stored copy', () => {
		replaceSources({ ok: src('ok', ['ee']), noFeed: { sourceId: 'noFeed', provider: 'youtube' }, junk: 4 })
		expect(Object.keys(getSources())).toEqual(['ok'])
		replaceSourceItems({ s: { sourceId: 's', fetchedAt: '', items: [item('a', 's', ''), { itemId: 'no url' }], error: '' } })
		expect(getSourceItems().s!.items).toHaveLength(1)
	})
})

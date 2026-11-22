import { afterEach, describe, expect, it, vi } from 'vitest'
import { tick } from './ops'
import { rankedTickReaction, worksFor } from './rankedTick'
import { getItems, putItems, resetSyllabus, type ItemDef } from './syllabus'
import { searchTrack } from './track/search'

// The tick as the list makes it, watched: a ranked work is ticked the same way.
vi.mock('./ops', async (importOriginal) => {
	const real = await importOriginal<typeof import('./ops')>()
	return { ...real, tick: vi.fn(real.tick) }
})

const item = (itemId: string, over: Partial<ItemDef> = {}): ItemDef => ({
	itemId,
	title: itemId,
	kind: 'Study',
	medium: '',
	cover: '',
	tags: [],
	core: false,
	childRule: 'core',
	parent: '',
	children: [],
	done: false,
	doneAt: '',
	draft: '',
	...over,
})

const ITEMS = [
	item('m/chimurenga', { title: 'Chimurenga', medium: 'album', children: ['m/chimurenga/0008', 'm/chimurenga/0009'] }),
	item('m/chimurenga/0008', { title: 'Chimurenga: Thomas Mapfumo - The Chimurenga Singles (1976-1980)', medium: 'album', parent: 'm/chimurenga' }),
	item('m/chimurenga/0009', { title: 'Township Jive: Various - The Kings and Queens of Township Jive (1991)', medium: 'album', parent: 'm/chimurenga' }),
	item('a/homer', { title: 'Homer', children: ['a/homer/iliad', 'a/homer/odyssey', 'a/homer/draft'] }),
	item('a/homer/iliad', { title: 'Iliad', medium: 'book', parent: 'a/homer' }),
	item('a/homer/odyssey', { title: 'Odyssey', medium: 'book', parent: 'a/homer' }),
	item('a/homer/draft', { title: 'Hymns', parent: 'a/homer', draft: 'board:a' }),
	item('a/plato', { title: 'Plato' }),
]
const all = Object.fromEntries(ITEMS.map((i) => [i.itemId, i]))
const entry = (id: string, title: string, creator = '') => ({ id, title, creator })

afterEach(resetSyllabus)

describe('a ranked item ticks its work (DARK-13)', () => {
	it('by id, ranked from a syllabus track', () => {
		expect(worksFor(entry('m/chimurenga/0008', 'The Chimurenga Singles', 'Thomas Mapfumo'), 'syllabus:m/chart', all)).toEqual(['m/chimurenga/0008'])
		// An entry with works is never ticked itself: its works are.
		expect(worksFor(entry('a/homer', 'Homer'), 'syllabus:a/canon', all)).toEqual([])
	})

	it('by album and artist, ranked from anything else', () => {
		expect(worksFor(entry('x', 'The Chimurenga singles', 'thomas mapfumo'), 'stamped:liked', all)).toEqual(['m/chimurenga/0008'])
		expect(worksFor(entry('x', 'The Chimurenga Singles', 'Someone Else'), 'feeds:all', all)).toEqual([])
	})

	it('by title alone when either side has no creator, and never a draft', () => {
		expect(worksFor(entry('x', 'Iliad'), 'list', all)).toEqual(['a/homer/iliad'])
		expect(worksFor(entry('x', 'Odyssey', 'Homer'), 'list', all)).toEqual(['a/homer/odyssey'])
		expect(worksFor(entry('x', 'Plato', 'Somebody'), 'list', all)).toEqual(['a/plato'])
		expect(worksFor(entry('x', 'Hymns'), 'list', all)).toEqual([])
	})

	it('ticks it in the vault, once', () => {
		putItems(ITEMS)
		rankedTickReaction.ranked!({ entry: { ...entry('x', 'Iliad'), year: '', cover: '', url: '' }, from: 'feeds:all', rankingId: 'r1' })
		expect(getItems()['a/homer/iliad']).toMatchObject({ done: true })
		expect(getItems()['a/homer/odyssey']).toMatchObject({ done: false })
	})

	it('ticks it as a tick in the list does, and puts nothing on the board (DARK-14)', () => {
		putItems(ITEMS)
		const createShape = vi.fn()
		const editor = { createShape, run: (fn: () => void) => fn() } as never
		rankedTickReaction.ranked!({ entry: { ...entry('x', 'Odyssey'), year: '', cover: '', url: '' }, from: 'feeds:all', rankingId: 'r1', editor, shapeId: 'shape:rank' })
		expect(tick).toHaveBeenLastCalledWith('a/homer/odyssey', true)
		expect(getItems()['a/homer/odyssey']).toMatchObject({ done: true })
		expect(createShape).not.toHaveBeenCalled()
	})
})

describe('searching a list (DARK-13)', () => {
	const entries = [all['m/chimurenga']!, all['a/homer']!, all['a/plato']!]

	it('finds an entry by its own title, its works left as they are', () => {
		const found = searchTrack(entries, all, 'plato')
		expect([...found.shown]).toEqual(['a/plato'])
		expect(found.within.size).toBe(0)
		expect(found.count).toBe(1)
	})

	it('finds a work inside its entry, unfolding the entry to show only it', () => {
		const found = searchTrack(entries, all, 'odyss')
		expect([...found.shown].sort()).toEqual(['a/homer', 'a/homer/odyssey'])
		expect([...found.within]).toEqual(['a/homer'])
		expect(found.matched.has('a/homer')).toBe(false)
	})

	it('needs every word typed', () => {
		expect(searchTrack(entries, all, 'township kings').count).toBe(1)
		expect(searchTrack(entries, all, 'township homer').count).toBe(0)
	})
})

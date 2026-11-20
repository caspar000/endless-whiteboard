import { afterEach, describe, expect, it } from 'vitest'
import mucoreYaml from '../../../syllabi/mucore.yaml?raw'
import { albumParts, syllabusChoices, syllabusEntries, syllabusKind, worksOf } from './randomizerSource'
import { getItems, getTracks, putItems, putTracks, resetSyllabus, type ItemDef, type TrackDef } from './syllabus'
import { mergeDoc } from './syllabusMerge'
import { parseSyllabus } from './syllabusYaml'

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
const track = (trackId: string, name: string, goal: string, order: string[], draft = ''): TrackDef => ({ trackId, name, goal, state: 'active', order, defaultTags: [], draft })

const COVER = 'https://coverartarchive.org/release-group/1795f337-7004-3d35-a995-f7e1b0c9146e/front-500'
const ITEMS = Object.fromEntries(
	[
		item('m/chimurenga', { title: 'Chimurenga', medium: 'album', children: ['m/chimurenga/0008', 'm/chimurenga/0009'] }),
		item('m/chimurenga/0008', { title: 'Chimurenga: Thomas Mapfumo - The Chimurenga Singles (1976-1980)', medium: 'album', cover: COVER, parent: 'm/chimurenga', done: true }),
		item('m/chimurenga/0009', { title: 'Township Jive: Various - The Kings and Queens of Township Jive (1991)', medium: 'album', parent: 'm/chimurenga' }),
		item('a/homer', { title: 'Homer', children: ['a/homer/iliad', 'a/homer/draft'] }),
		item('a/homer/iliad', { title: 'Iliad', medium: 'work', parent: 'a/homer' }),
		item('a/homer/draft', { title: 'Not confirmed', parent: 'a/homer', draft: 'board:a' }),
		item('a/plato', { title: 'Plato' }),
	].map((i) => [i.itemId, i])
)
const TRACKS = {
	'm/chart': track('m/chart', '/mu/core', 'Music listener', ['m/chimurenga']),
	'a/canon': track('a/canon', 'Great Books', 'Adler', ['a/homer', 'a/plato', 'a/homer']),
	'd/new': track('d/new', 'Dropped just now', 'Draft', ['a/plato'], 'board:a'),
}

afterEach(() => resetSyllabus())

describe('syllabi as a randomizer source', () => {
	it('offers every confirmed track under the name of its syllabus', () => {
		expect(syllabusChoices(TRACKS)).toEqual([
			{ id: 'a/canon', label: 'Great Books', group: 'Adler' },
			{ id: 'm/chart', label: '/mu/core', group: 'Music listener' },
		])
	})

	it("shuffles a track's works in reading order, each once, ticked or not, and an entry with no works as itself", () => {
		expect(worksOf(ITEMS, TRACKS, 'a/canon').map(({ work, entry }) => [work.itemId, entry?.itemId ?? ''])).toEqual([
			['a/homer/iliad', 'a/homer'],
			['a/plato', ''],
		])
		expect(worksOf(ITEMS, TRACKS, 'm/chart').map(({ work }) => work.itemId)).toEqual(['m/chimurenga/0008', 'm/chimurenga/0009'])
		expect(worksOf(ITEMS, TRACKS, 'gone')).toEqual([])
		expect(worksOf(ITEMS, TRACKS, 'd/new')).toEqual([])
	})

	it('gives an album as album, artist and year, with its cover', () => {
		expect(syllabusEntries(ITEMS, TRACKS, 'm/chart')).toEqual([
			{ id: 'm/chimurenga/0008', title: 'The Chimurenga Singles', creator: 'Thomas Mapfumo', year: '1976-1980', cover: COVER, url: '' },
			{ id: 'm/chimurenga/0009', title: 'The Kings and Queens of Township Jive', creator: 'Various', year: '1991', cover: '', url: '' },
		])
		expect(syllabusKind(ITEMS, TRACKS, 'm/chart')).toMatchObject({ noun: 'albums', one: 'album', creator: 'Artist', shape: 'square' })
	})

	it('gives any other work under the name of its entry', () => {
		expect(syllabusEntries(ITEMS, TRACKS, 'a/canon')[0]).toEqual({ id: 'a/homer/iliad', title: 'Iliad', creator: 'Homer', year: '', cover: '', url: '' })
		expect(syllabusKind(ITEMS, TRACKS, 'a/canon')).toMatchObject({ noun: 'works', creator: 'From' })
	})

	it("reads /mu/core's titles, near misses included", () => {
		expect(albumParts('Nguni Folk: Princess Constance Magogo kaDinuzulu -The Zulu Songs (1972)')).toEqual({ title: 'The Zulu Songs', creator: 'Princess Constance Magogo kaDinuzulu', year: '1972' })
		expect(albumParts("Late French Baroque: Jean-Philippe Rameau- Hippolyte et Aricie (1733)")).toEqual({ title: 'Hippolyte et Aricie', creator: 'Jean-Philippe Rameau', year: '1733' })
		expect(albumParts('Ancient Greek: Gregorio Paniagua - Musique de la Grèce antique (800 BC - 600 AD)')).toEqual({ title: 'Musique de la Grèce antique', creator: 'Gregorio Paniagua', year: '800 BC - 600 AD' })
		expect(albumParts('Bogino Duu: J. Nansalmaa - Mongolian Traditional Songs')).toEqual({ title: 'Mongolian Traditional Songs', creator: 'J. Nansalmaa', year: '' })
		expect(albumParts('Iliad')).toBeNull()
	})
})

describe('/mu/core in the randomizer', () => {
	it('fills the shuffle with its 1111 albums, each with an artist and a cover from the web or cut from the chart', () => {
		const parsed = parseSyllabus(mucoreYaml)
		if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
		const merged = mergeDoc(parsed.doc, {}, {}, '')
		putItems(merged.items)
		putTracks(merged.tracks)
		const choice = syllabusChoices(getTracks()).find((c) => c.label === '/mu/core')!
		expect(choice).toEqual({ id: 'mucore/chart', label: '/mu/core', group: 'Music listener' })
		const entries = syllabusEntries(getItems(), getTracks(), choice.id)
		expect(entries).toHaveLength(1111)
		expect(syllabusKind(getItems(), getTracks(), choice.id).noun).toBe('albums')
		expect(entries.filter((e) => !e.creator || !e.title)).toEqual([])
		const web = /^https:\/\/(coverartarchive\.org\/release-group\/[0-9a-f-]{36}\/front-500|cdn-images\.dzcdn\.net\/images\/cover\/[0-9a-f]{32}\/500x500-000000-80-0-0\.jpg)$/
		expect(entries.filter((e) => !web.test(e.cover) && !/^\/covers\/mucore\/\d{4}\.webp$/.test(e.cover))).toEqual([])
		// Most are sharp: the chart's 60 px squares are only for what the web doesn't have.
		expect(entries.filter((e) => web.test(e.cover)).length).toBeGreaterThan(entries.length / 2)
	})
})

import { afterEach, describe, expect, it } from 'vitest'
import mucoreYaml from '../../../syllabi/mucore.yaml?raw'
import type { TreeDefs } from '@lifeboard/skill-tree'
import { albumParts, nodeChoice, nodeChoices, nodeEntries, syllabusChoices, syllabusEntries, syllabusKind, worksOf } from './randomizerSource'
import { getItems, getTracks, putItems, putTracks, resetSyllabus, type ItemDef, type TrackDef } from './syllabus'
import { mergeDoc } from './syllabusMerge'
import { parseSyllabus } from './syllabusYaml'

const item = (itemId: string, over: Partial<ItemDef> = {}): ItemDef => ({
	itemId,
	title: itemId,
	kind: 'Study',
	medium: '',
	cover: '',
	url: '',
	tracks: 0,
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

describe('a skill node in the randomizer', () => {
	const SOURCE = `
goal: m
name: Music
tracks:
  - id: chart
    items:
      - { id: metal, title: Metal, tags: [metal], children: [ { id: a, title: "Metal: A - One", medium: album } ] }
      - { id: black, title: Black Metal, tags: [black-metal], children: [ { id: b, title: "Black Metal: B - Two", medium: album }, { id: c, title: "Black Metal: C - Three", medium: album } ] }
      - { id: doom, title: Doom Metal, tags: [doom-metal], children: [ { id: d, title: "Doom Metal: D - Four", medium: album } ] }
tree:
  id: m
  name: /mu/core
  nodes:
    - { id: root, name: Listen Widely, kind: root }
    - { id: rock, name: Rock, requires: [ { node: [root] } ] }
    - { id: metal, name: Metal, requires: [ { node: [rock] } ] }
    - { id: black-metal, name: Black Metal, requires: [ { node: [metal] } ] }
    - { id: doom-metal, name: Doom Metal, requires: [ { node: [metal] } ] }
    - { id: punk, name: Punk, requires: [ { node: [rock] } ] }
`
	const load = () => {
		const parsed = parseSyllabus(SOURCE)
		if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
		const items = Object.fromEntries(mergeDoc(parsed.doc, {}, {}, '').items.map((i) => [i.itemId, { ...i, draft: '' }]))
		const trees: TreeDefs = Object.fromEntries(
			parsed.doc.trees.map((t) => [t.treeId, { ...t, sectors: '', rings: '', removed: [], draft: '', ticked: {}, madeFrom: [], deleted: false }])
		)
		return { items, trees }
	}

	it('offers every node with works below it, by its path, the root first and families above their genres', () => {
		const { items, trees } = load()
		expect(nodeChoices(items, trees).map((c) => [c.id, c.label, c.group])).toEqual([
			['node:m/root', 'Listen Widely', '/mu/core (skill tree)'],
			['node:m/rock', 'Rock', '/mu/core (skill tree)'],
			['node:m/metal', 'Rock › Metal', '/mu/core (skill tree)'],
			['node:m/black-metal', 'Rock › Metal › Black Metal', '/mu/core (skill tree)'],
			['node:m/doom-metal', 'Rock › Metal › Doom Metal', '/mu/core (skill tree)'],
		])
		expect(nodeChoice(trees, 'node:m/doom-metal')?.label).toBe('Rock › Metal › Doom Metal')
		expect(nodeChoice(trees, 'node:m/gone')).toBeNull()
	})

	it("shuffles a node's own works and those of every node below it", () => {
		const { items, trees } = load()
		const titles = (id: string) => nodeEntries(items, trees, id).map((e) => e.title)
		expect(titles('node:m/black-metal')).toEqual(['Two', 'Three'])
		expect(titles('node:m/metal').sort()).toEqual(['Four', 'One', 'Three', 'Two'])
		expect(titles('node:m/punk')).toEqual([])
		expect(syllabusKind(items, {}, 'node:m/metal', trees).noun).toBe('albums')
	})

	it('leaves out a tree not yet confirmed, and one deleted', () => {
		const { items, trees } = load()
		expect(nodeChoices(items, { m: { ...trees.m!, draft: 'board:a' } })).toEqual([])
		expect(nodeChoices(items, { m: { ...trees.m!, deleted: true } })).toEqual([])
	})
})

describe('a work with a link and a track count', () => {
	afterEach(resetSyllabus)

	it('opens its link and says how many tracks it has; a work without either says nothing', () => {
		const url = 'https://www.youtube.com/results?search_query=burzum+filosofem'
		const items = {
			g: item('g', { title: 'Black Metal', medium: 'album', children: ['g/a', 'g/b', 'g/c'] }),
			'g/a': item('g/a', { title: 'Black Metal: Burzum - Filosofem (1996)', medium: 'album', parent: 'g', url, tracks: 6 }),
			'g/b': item('g/b', { title: 'Black Metal: Mayhem - Deathcrush', medium: 'album', parent: 'g', tracks: 1 }),
			'g/c': item('g/c', { title: 'Black Metal: Darkthrone - Transilvanian Hunger', medium: 'album', parent: 'g' }),
		}
		const entries = syllabusEntries(items, { t: track('t', 'T', 'g', ['g']) }, 't')
		expect(entries.map((e) => [e.url, e.detail])).toEqual([
			[url, '6 tracks'],
			['', '1 track'],
			['', undefined],
		])
	})

	it('keeps them through an import, and a re-import that leaves them out', () => {
		const source = (fields: string) => `goal: m\nname: M\ntracks:\n  - id: t\n    items:\n      - { id: a, title: "A - B", medium: album${fields} }\n`
		const first = parseSyllabus(source(', url: "https://www.youtube.com/results?search_query=a+b", tracks: 9'))
		if (!first.ok) throw new Error(first.errors.join('\n'))
		putItems(mergeDoc(first.doc, {}, {}, '').items)
		const again = parseSyllabus(source(''))
		if (!again.ok) throw new Error(again.errors.join('\n'))
		const merged = mergeDoc(again.doc, getItems(), getTracks(), '').items.find((i) => i.itemId === 'm/a')!
		expect([merged.url, merged.tracks]).toEqual(['https://www.youtube.com/results?search_query=a+b', 9])
	})
})

describe('/mu/core in the randomizer', () => {
	it('fills the shuffle with its 1111 albums and the Essential Charts\' 11506, the 1111 each with an artist and a cover from the web or cut from the chart', () => {
		const parsed = parseSyllabus(mucoreYaml)
		if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
		const merged = mergeDoc(parsed.doc, {}, {}, '')
		putItems(merged.items)
		putTracks(merged.tracks)
		const choice = syllabusChoices(getTracks()).find((c) => c.label === '/mu/core')!
		expect(choice).toEqual({ id: 'mucore/chart', label: '/mu/core', group: 'Music listener' })
		const all = syllabusEntries(getItems(), getTracks(), choice.id)
		expect(all).toHaveLength(1111 + 11506)
		expect(all.filter((e) => !e.title)).toEqual([])
		// /mu/core's own works sit in its first 84 entries; the Essential Charts' albums after them, some
		// with no cover, or (a chart printing titles only) no artist.
		const families = new Set(parsed.doc.tracks[0]!.items.slice(0, 84).flatMap((u) => u.children.map((c) => c.itemId)))
		const entries = all.filter((e) => families.has(e.id))
		expect(entries).toHaveLength(1111)
		expect(syllabusKind(getItems(), getTracks(), choice.id).noun).toBe('albums')
		expect(entries.filter((e) => !e.creator || !e.title)).toEqual([])
		const web = /^https:\/\/(coverartarchive\.org\/release-group\/[0-9a-f-]{36}\/front-500|cdn-images\.dzcdn\.net\/images\/cover\/[0-9a-f]{32}\/500x500-000000-80-0-0\.jpg)$/
		expect(entries.filter((e) => !web.test(e.cover) && !/^\/covers\/mucore\/\d{4}\.webp$/.test(e.cover))).toEqual([])
		// Its tree's nodes are choices too: a genre shuffles its own albums, a family every genre's under it.
		const trees: TreeDefs = Object.fromEntries(
			parsed.doc.trees.map((t) => [t.treeId, { ...t, sectors: '', rings: '', removed: [], draft: '', ticked: {}, madeFrom: [], deleted: false }])
		)
		const started = performance.now()
		const nodes = nodeChoices(getItems(), trees)
		expect(performance.now() - started).toBeLessThan(2000)
		expect(nodes.find((c) => c.id === 'node:mucore/black-metal')?.label).toBe('Rock › Metal › Black Metal')
		expect(nodeEntries(getItems(), trees, 'node:mucore/black-metal')).toHaveLength(541)
		const metal = nodeEntries(getItems(), trees, 'node:mucore/rock-metal')
		const genres = nodes.filter((c) => c.label.startsWith('Rock › Metal › ')).reduce((n, c) => n + nodeEntries(getItems(), trees, c.id).length, 0)
		expect(metal).toHaveLength(25 + genres)
		expect(nodeEntries(getItems(), trees, 'node:mucore/root')).toHaveLength(all.length)
		// Most are sharp: the chart's 60 px squares are only for what the web doesn't have.
		expect(entries.filter((e) => web.test(e.cover)).length).toBeGreaterThan(entries.length / 2)
	})
})

import { beforeEach, describe, expect, it } from 'vitest'
import {
	buildIndex,
	confirmDrafts,
	discardDrafts,
	getItem,
	getItems,
	getTrack,
	isItemDone,
	nextLeafOf,
	putItems,
	putTracks,
	removeItems,
	resetSyllabus,
	setDone,
	type EvidenceEntry,
	type ItemDef,
} from './syllabus'
import { mergeDoc } from './syllabusMerge'
import { parseSyllabus } from './syllabusYaml'

const item = (itemId: string, over: Partial<ItemDef> = {}): ItemDef => ({
	itemId,
	title: itemId,
	kind: 'Study',
	medium: 'book',
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

/** Homer with the Iliad (core) and the Odyssey, under the rule given. */
function homer(childRule = 'core', draft = '') {
	putItems([
		item('a/homer', { children: ['a/homer/iliad', 'a/homer/odyssey'], childRule, tags: ['a/epic'], draft }),
		item('a/homer/iliad', { parent: 'a/homer', core: true, draft }),
		item('a/homer/odyssey', { parent: 'a/homer', draft }),
	])
}

beforeEach(resetSyllabus)

describe('ticking', () => {
	it('ticks a leaf with the day, and leaves a parent to its works', () => {
		homer()
		expect(setDone('a/homer', true)).toBe(false)
		expect(setDone('a/homer/iliad', true, '2026-10-17')).toBe(true)
		expect(getItem('a/homer/iliad')).toMatchObject({ done: true, doneAt: '2026-10-17' })
		// Core rule: the Iliad is its only core work.
		expect(isItemDone('a/homer')).toBe(true)
		setDone('a/homer/iliad', false)
		expect(getItem('a/homer/iliad')).toMatchObject({ done: false, doneAt: '' })
		expect(isItemDone('a/homer')).toBe(false)
	})

	it('needs every work under the all rule, and walks to the next undone one', () => {
		homer('all')
		expect(nextLeafOf('a/homer')?.itemId).toBe('a/homer/iliad')
		setDone('a/homer/iliad', true)
		expect(isItemDone('a/homer')).toBe(false)
		expect(nextLeafOf('a/homer')?.itemId).toBe('a/homer/odyssey')
		setDone('a/homer/odyssey', true)
		expect(isItemDone('a/homer')).toBe(true)
		expect(nextLeafOf('a/homer')).toBeNull()
	})

	it('lists a new work under its parent, and removing an entry takes its works and its place in tracks', () => {
		putItems([item('a/plato')])
		putItems([item('a/plato/republic', { parent: 'a/plato' })])
		expect(getItem('a/plato')?.children).toEqual(['a/plato/republic'])
		putTracks([{ trackId: 'a/canon', name: 'Canon', goal: 'g', state: 'active', order: ['a/plato'], defaultTags: [], draft: '' }])
		removeItems(['a/plato'])
		expect(Object.keys(getItems())).toEqual([])
		expect(getTrack('a/canon')?.order).toEqual([])
	})
})

describe('drafts', () => {
	it('confirms or discards only what this board imported', () => {
		homer('core', 'board:a')
		putItems([item('b/other', { draft: 'board:b' })])
		expect(discardDrafts('board:a')).toBe(3)
		expect(Object.keys(getItems())).toEqual(['b/other'])
		expect(confirmDrafts('board:b')).toBe(1)
		expect(getItem('b/other')?.draft).toBe('')
	})
})

describe('buildIndex', () => {
	const note = (itemId: string, written: boolean): EvidenceEntry => ({ itemId, boardId: 'b', shapeId: `shape:${itemId}`, written, method: 'analytical' })

	it('gives works their parent tags, counts a tick as evidence only when written up, and leaves drafts out', () => {
		homer()
		putItems([item('d/draft', { draft: 'board:a' })])
		setDone('a/homer/iliad', true, '2026-10-01')
		setDone('a/homer/odyssey', true, '2026-10-05')
		const index = buildIndex(getItems(), { x: note('a/homer/iliad', true), y: note('a/homer/odyssey', false) })
		expect(index['a/homer/iliad']).toMatchObject({ tags: ['a/epic'], evidence: true, method: 'analytical', position: 0 })
		expect(index['a/homer/odyssey']).toMatchObject({ evidence: false, position: 1 })
		// A parent is done by its rule, on the day its last work was done, and is never evidence itself.
		expect(index['a/homer']).toMatchObject({ done: true, doneAt: '2026-10-05', evidence: false, hasChildren: true })
		expect(index['d/draft']).toBeUndefined()
	})
})

describe('mergeDoc', () => {
	const doc = (yaml: string) => {
		const parsed = parseSyllabus(yaml)
		if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
		return parsed.doc
	}
	const YAML = `goal: a
name: Canon
tracks:
  - id: canon
    name: Canon
    defaultTags: [reading]
    items:
      - id: homer
        title: Homer
        tags: [epic]
        children:
          - { id: iliad, title: Iliad, core: true }
          - { id: odyssey, title: Odyssey }
`

	it('makes new items and the track drafts of the importing board, with the track tags on its entries', () => {
		const merged = mergeDoc(doc(YAML), {}, {}, 'board:a')
		expect(merged.created).toBe(4)
		expect(merged.items.map((i) => [i.itemId, i.draft, i.parent])).toEqual([
			['a/homer', 'board:a', ''],
			['a/homer/iliad', 'board:a', 'a/homer'],
			['a/homer/odyssey', 'board:a', 'a/homer'],
		])
		expect(merged.items[0]!.tags).toEqual(['a/epic', 'a/reading'])
		expect(merged.items[1]!.tags).toEqual([])
		expect(merged.tracks[0]).toMatchObject({ trackId: 'a/canon', order: ['a/homer'], draft: 'board:a', goal: 'Canon' })
	})

	it('updates what the vault has without touching its ticks, and keeps works the document leaves out', () => {
		homer()
		putItems([item('a/homer/fragments', { parent: 'a/homer' })])
		setDone('a/homer/iliad', true, '2026-10-01')
		const merged = mergeDoc(doc(YAML), getItems(), {}, 'board:a')
		const byId = Object.fromEntries(merged.items.map((i) => [i.itemId, i]))
		expect(byId['a/homer/iliad']).toMatchObject({ done: true, doneAt: '2026-10-01', draft: '' })
		expect(byId['a/homer']!.children).toEqual(['a/homer/iliad', 'a/homer/odyssey', 'a/homer/fragments'])
		expect(merged.updated).toBe(3)
	})
})

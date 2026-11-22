import { describe, expect, it } from 'vitest'
import { addCollection, addItem, addTyped, backlogEntries, itemKey, newBacklog, parseTyped, readBacklog, removeEntry, renameBacklog, type Backlog } from './model'

const entry = (id: string, title = `Work ${id}`) => ({ id, title, creator: 'Someone', year: '', cover: '', url: '' })
let n = 0
const nextId = () => `id${++n}`

describe('adding to a backlog', () => {
	it('reads a typed line as title, creator and year', () => {
		expect(parseTyped('Late Spring — Yasujirō Ozu — 1949')).toEqual({ title: 'Late Spring', creator: 'Yasujirō Ozu', year: '1949' })
		expect(parseTyped('The Waves - Virginia Woolf')).toEqual({ title: 'The Waves', creator: 'Virginia Woolf', year: '' })
		expect(parseTyped('Mirror — 1975')).toEqual({ title: 'Mirror', creator: '', year: '1975' })
		expect(parseTyped('   ')).toBeNull()
	})

	it('puts a typed item on top, and refuses a line with no title', () => {
		const b = addTyped(addTyped(newBacklog('b'), 'First', nextId)!, 'Second', nextId)!
		expect(b.entries.map((e) => (e.kind === 'item' ? e.title : e.id))).toEqual(['Second', 'First'])
		expect(addTyped(b, '  ')).toBeNull()
	})

	it('keeps one of an item dragged in twice, moved to the top', () => {
		let b = addItem(newBacklog('b'), entry('1'), 'feeds:all', 'Feeds')
		b = addItem(b, entry('2'), 'feeds:all', 'Feeds')
		b = addItem(b, entry('1'), 'feeds:all', 'Feeds')
		expect(b.entries.map((e) => e.id)).toEqual([itemKey('feeds:all', '1'), itemKey('feeds:all', '2')])
		expect(b.entries[0]).toMatchObject({ kind: 'item', via: 'Feeds', title: 'Work 1' })
	})

	it('keeps one of an album that came by two cards', () => {
		let b = addItem(newBacklog('b'), entry('1', 'Loveless'), 'stamped:liked', 'Randomizer stamps')
		b = addItem(b, { ...entry('1', ' loveless ') }, 'ranking:r', 'Rankings')
		expect(b.entries.map((e) => e.id)).toEqual([itemKey('ranking:r', '1')])
	})

	it('keeps a whole source as one collection, once', () => {
		let b = addCollection(newBacklog('b'), 'syllabus:mucore', 'Syllabi')
		b = addTyped(b, 'Something', nextId)!
		b = addCollection(b, 'syllabus:mucore', 'Syllabi')
		expect(b.entries.map((e) => e.kind)).toEqual(['collection', 'item'])
	})

	it('takes an entry out, and is renamed, never to nothing', () => {
		const b = addCollection(newBacklog('b'), 'syllabus:mucore', 'Syllabi')
		expect(removeEntry(b, 'syllabus:mucore').entries).toEqual([])
		expect(renameBacklog(b, '  To watch ').name).toBe('To watch')
		expect(renameBacklog(b, '  ').name).toBe('Backlog')
	})
})

describe('a backlog as a source', () => {
	const sources: Record<string, ReturnType<typeof entry>[]> = { 'syllabus:mucore': [entry('a'), entry('b')], 'feeds:all': [entry('v')] }
	const entriesOf = (key: string) => sources[key] ?? []

	it('opens its collections out into what their source holds now, each thing once', () => {
		let b: Backlog = newBacklog('b')
		b = addItem(b, entry('a'), 'syllabus:mucore', 'Syllabi')
		b = addCollection(b, 'syllabus:mucore', 'Syllabi')
		b = addTyped(b, 'Typed one', () => 't')!
		expect(backlogEntries(b, entriesOf).map((e) => e.id)).toEqual(['typed|t', itemKey('syllabus:mucore', 'a'), itemKey('syllabus:mucore', 'b')])
	})

	it('leaves a ranking’s weights behind: in a backlog everything counts the same', () => {
		const b = addCollection(newBacklog('b'), 'ranking:r', 'Rankings')
		expect(backlogEntries(b, () => [{ ...entry('a'), weight: 4 }])[0]).not.toHaveProperty('weight')
	})

	it('is read back whole from storage, and what can’t be read is dropped', () => {
		const b = addCollection(addItem(newBacklog('b'), entry('1'), 'feeds:all', 'Feeds'), 'syllabus:mucore', 'Syllabi')
		expect(readBacklog(JSON.parse(JSON.stringify(b)))).toEqual(b)
		expect(readBacklog({ backlogId: 'b', entries: [{ kind: 'item', id: 'x' }, { kind: 'odd', id: 'y' }, 3] })).toEqual({ backlogId: 'b', boardId: '', name: 'Backlog', entries: [] })
		expect(readBacklog({})).toBeNull()
	})
})

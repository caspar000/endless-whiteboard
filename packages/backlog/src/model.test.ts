import { describe, expect, it } from 'vitest'
import { addCollection, addItem, addTyped, backlogEntries, itemKey, newBacklog, parseTyped, readBacklog, removeEntry, renameBacklog, setMedia, whereIs, workKey, type Backlog } from './model'

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

describe('the same thing twice', () => {
	const album = (id: string, title: string, creator: string) => ({ id, title, creator, year: '', cover: '', url: '' })

	it('is one thing however it is spelled: case, accents, punctuation, a leading "the" and brackets aside', () => {
		expect(workKey({ title: 'Filosofem (Remastered)', creator: 'Burzum' })).toBe(workKey({ title: 'filosofem', creator: 'BURZUM' }))
		expect(workKey({ title: 'The Queen Is Dead', creator: 'The Smiths' })).toBe(workKey({ title: 'Queen Is Dead', creator: 'Smiths' }))
		expect(workKey({ title: 'Ágætis byrjun', creator: 'Sigur Rós' })).toBe(workKey({ title: 'Agaetis Byrjun', creator: 'Sigur Ros' }))
		expect(workKey({ title: 'Hvis lyset tar oss', creator: 'Burzum' })).not.toBe(workKey({ title: 'Filosofem', creator: 'Burzum' }))
		// Brackets that are the whole title still count.
		expect(workKey({ title: '(I)', creator: 'X' })).not.toBe(workKey({ title: '(II)', creator: 'X' }))
	})

	it('is listed once: an item and a collection holding it, or two collections holding the same', () => {
		let b = addItem(newBacklog('b'), album('x', 'Filosofem', 'Burzum'), 'ranking:r', 'Rankings')
		b = addCollection(b, 'syllabus:mucore', 'Syllabi')
		b = addCollection(b, 'syllabus:node:mucore/black-metal', 'Syllabi')
		const held: Record<string, ReturnType<typeof album>[]> = {
			'syllabus:mucore': [album('1', 'Filosofem (Remastered)', 'Burzum'), album('2', 'Transilvanian Hunger', 'Darkthrone'), album('3', 'Dummy', 'Portishead')],
			'syllabus:node:mucore/black-metal': [album('2', 'Transilvanian Hunger', 'Darkthrone'), album('4', 'Deathcrush', 'Mayhem')],
		}
		const listed = backlogEntries(b, (key) => held[key] ?? [])
		expect(listed.map((e) => e.title)).toEqual(['Transilvanian Hunger', 'Deathcrush', 'Filosofem (Remastered)', 'Dummy'])
	})

	it('says where it already is, and moves a typed one already here to the top', () => {
		let b = addTyped(newBacklog('b'), 'Late Spring — Yasujirō Ozu', () => 't1')!
		b = addTyped(b, 'Mirror — Andrei Tarkovsky', () => 't2')!
		b = addCollection(b, 'syllabus:mucore', 'Syllabi')
		const held = (key: string) => (key === 'syllabus:mucore' ? [album('1', 'Dummy', 'Portishead')] : [])
		expect(whereIs(b, held, { title: 'dummy', creator: 'portishead' })?.id).toBe('syllabus:mucore')
		expect(whereIs(b, held, { title: 'Late spring', creator: 'Yasujiro Ozu' })?.id).toBe('typed|t1')
		expect(whereIs(b, held, { title: 'Stalker', creator: 'Andrei Tarkovsky' })).toBeNull()
		const again = addTyped(b, 'late spring - yasujiro ozu', () => 't3')!
		expect(again.entries.map((e) => e.id)).toEqual(['typed|t1', 'syllabus:mucore', 'typed|t2'])
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

	it('passes on what its sources say beside the year, for things added one by one and in collections', () => {
		let b = addItem(newBacklog('b'), { ...entry('1'), detail: '9 tracks' }, 'syllabus:mucore', 'Syllabi')
		b = addCollection(b, 'syllabus:mucore', 'Syllabi')
		const counted = (key: string) => (key === 'syllabus:mucore' ? [{ ...entry('a'), detail: '11 tracks' }, entry('b')] : [])
		expect(backlogEntries(b, counted).map((e) => e.detail)).toEqual(['11 tracks', undefined, '9 tracks'])
	})

	it('is read back whole from storage, and what can’t be read is dropped', () => {
		const b = addCollection(addItem(newBacklog('b'), { ...entry('1'), detail: '9 tracks' }, 'feeds:all', 'Feeds'), 'syllabus:mucore', 'Syllabi')
		expect(readBacklog(JSON.parse(JSON.stringify(b)))).toEqual(b)
		expect(readBacklog({ backlogId: 'b', entries: [{ kind: 'item', id: 'x' }, { kind: 'odd', id: 'y' }, 3] })).toEqual({ backlogId: 'b', boardId: '', name: 'Backlog', entries: [] })
		expect(readBacklog({})).toBeNull()
	})

	it('keeps what a backlog holds, and drops a media type it does not know', () => {
		const film = setMedia(newBacklog('b'), 'film')
		expect(readBacklog(JSON.parse(JSON.stringify(film)))?.media).toBe('film')
		expect(setMedia(film, null)).toEqual(newBacklog('b'))
		expect(readBacklog({ backlogId: 'b', media: 'podcasts' })).toEqual(newBacklog('b'))
	})
})

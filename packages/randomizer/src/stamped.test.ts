import { describe, expect, it } from 'vitest'
import { TYPED_SOURCE, isOut, withRankings, type RandomItem, type Stamp } from './model'
import {
	cardKey,
	getStamped,
	nextStamped,
	parseStampedChoice,
	pinLegacyIds,
	scopeToBoard,
	scopedCard,
	rankedStampsOf,
	rankingCard,
	replaceStamped,
	stampOf,
	stampRanked,
	stampedChoiceId,
	stampedChoices,
	stampedEntries,
	stampedKey,
} from './stamped'

const item = (id: string, stamps: Stamp[], source = TYPED_SOURCE, extra: Partial<RandomItem> = {}): RandomItem => ({
	id,
	source,
	title: `Title ${id}`,
	creator: `Artist ${id}`,
	year: '',
	cover: '',
	stamps,
	...extra,
})
const liked = (date: string): Stamp => ({ kind: 'liked', date })
const disliked = (date: string): Stamp => ({ kind: 'disliked', date })
const none = () => undefined
const A = cardKey('board-1', 'shape:a')
const B = cardKey('board-2', 'shape:b')
const titles = (all: Parameters<typeof stampedEntries>[0], kind: string) => stampedEntries(all, kind).map((e) => e.title)

describe('the stamped list', () => {
	it('holds what a card has stamped, by its latest stamp', () => {
		const next = nextStamped({}, A, [item('a', [liked('2026-11-01')]), item('b', []), item('c', [liked('2026-11-01'), disliked('2026-11-02')])], none)
		expect(titles(next, 'liked')).toEqual(['Title a'])
		expect(titles(next, 'disliked')).toEqual(['Title c'])
	})

	it('follows a stamp and its undo', () => {
		const stamped = nextStamped({}, A, [item('a', [liked('2026-11-02')])], none)
		expect(titles(stamped, 'liked')).toEqual(['Title a'])
		expect(nextStamped(stamped, A, [item('a', [])], none)).toEqual({})
	})

	it('takes back only the undoing card’s stamp, never another card’s newer one', () => {
		const video = (stamps: Stamp[]) => item('v', stamps, 'feeds:all')
		let all = nextStamped({}, A, [video([liked('2026-11-01')])], none)
		all = nextStamped(all, B, [video([liked('2026-11-02')])], none)
		all = nextStamped(all, A, [video([])], none)
		expect(titles(all, 'liked')).toEqual(['Title v'])
		// And the other way round: B's undo leaves A's.
		all = nextStamped(all, A, [video([liked('2026-11-03')])], none)
		all = nextStamped(all, B, [], none)
		expect(titles(all, 'liked')).toEqual(['Title v'])
	})

	it('lists an item by its newest stamp of any card', () => {
		const video = (stamps: Stamp[]) => item('v', stamps, 'feeds:all')
		let all = nextStamped({}, A, [video([liked('2026-11-01')])], none)
		all = nextStamped(all, B, [video([disliked('2026-11-04')])], none)
		expect(titles(all, 'liked')).toEqual([])
		expect(titles(all, 'disliked')).toEqual(['Title v'])
		all = nextStamped(all, B, [video([])], none)
		expect(titles(all, 'liked')).toEqual(['Title v'])
	})

	it('keeps the picture and the address of a source’s entry, which the card does not store', () => {
		const next = nextStamped({}, A, [item('v', [liked('2026-11-02')], 'feeds:all')], () => ({ id: 'v', title: '', creator: '', year: '', cover: 'https://i/v.jpg', url: 'https://v' }))
		expect(stampedEntries(next, 'liked')[0]).toMatchObject({ id: stampedKey('feeds:all', 'v'), cover: 'https://i/v.jpg', url: 'https://v' })
	})

	it('leaves alone what a card stamps while shuffling this list itself', () => {
		expect(nextStamped({}, A, [item('list|a', [disliked('2026-11-03')], 'stamped:liked')], none)).toEqual({})
	})

	it('lists one album stamped on two cards once, in its newest stamp’s list, under its first id', () => {
		let all = nextStamped({}, A, [item('a', [liked('2026-11-01')], 'list', { title: 'Ran', creator: 'Akira Kurosawa' }), item('b', [liked('2026-11-03')])], none)
		all = nextStamped(all, B, [item('list|a', [disliked('2026-11-05')], 'ranking:r', { title: 'Ran', creator: 'akira kurosawa ' })], none)
		expect(titles(all, 'liked')).toEqual(['Title b'])
		expect(stampedEntries(all, 'disliked').map((e) => [e.title, e.id])).toEqual([['Ran', stampedKey('list', 'a')]])
	})
})

describe('a list per board and per source (DARK-14)', () => {
	const mucore = (id: string, stamps: Stamp[]) => item(id, stamps, 'syllabus:mucore')

	it('offers each source stamped from on this board, never another board’s', () => {
		let all = nextStamped({}, A, [mucore('a', [liked('2026-11-01')]), item('t', [liked('2026-11-01')])], none)
		all = nextStamped(all, B, [item('v', [liked('2026-11-02')], 'feeds:all')], none)
		const ids = stampedChoices(all, 'board-1').map((c) => c.id)
		expect(ids).toContain(stampedChoiceId('liked', { board: 'board-1', origin: 'syllabus:mucore' }))
		expect(ids).toContain(stampedChoiceId('unsure', { board: 'board-1', origin: 'list' }))
		expect(ids.some((id) => id.includes('feeds:all'))).toBe(false)
		expect(stampedChoices(all, 'board-1').find((c) => c.id.endsWith('|list'))?.label).toBe('Liked on my lists')
	})

	it('lists only what was stamped from that source on that board', () => {
		let all = nextStamped({}, A, [mucore('a', [liked('2026-11-01')]), item('t', [liked('2026-11-01')])], none)
		all = nextStamped(all, B, [mucore('b', [liked('2026-11-02')])], none)
		const onOne = stampedEntries(all, 'liked', { board: 'board-1', origin: 'syllabus:mucore' }).map((e) => e.title)
		expect(onOne).toEqual(['Title a'])
		expect(stampedEntries(all, 'liked', { board: 'board-2', origin: 'syllabus:mucore' }).map((e) => e.title)).toEqual(['Title b'])
		// A list from before DARK-14 still holds everything, for a card already set to one.
		expect(titles(all, 'liked').sort()).toEqual(['Title a', 'Title b', 'Title t'])
		expect(parseStampedChoice('liked')).toEqual({ kind: 'liked' })
	})
})

describe('a card set to a list from before stamps had boards (DARK-14)', () => {
	it('moves onto its board’s own list as the board opens, so another board’s stamps never reach it', () => {
		// Card A, on board 1, shuffles "Everything I liked", and keeps its picks and own stamps under it.
		const legacy = { source: 'stamped:liked', items: [item('list|x', [disliked('2026-11-01')], 'stamped:liked'), item('t', [], 'list')], picks: [{ source: 'stamped:liked', id: 'list|x' }] }
		const moved = scopedCard(legacy, 'board-1')!
		expect(moved.source).toBe(`stamped:${stampedChoiceId('liked', { board: 'board-1', origin: '*' })}`)
		expect(moved.items.map((i) => i.source)).toEqual([moved.source, 'list'])
		expect(moved.picks).toEqual([{ source: moved.source, id: 'list|x' }])
		expect(scopedCard({ ...legacy, source: moved.source }, 'board-1')).toBeNull()
		expect(scopeToBoard('feeds:all', 'board-1')).toBeNull()

		// What is liked on board 1, from any source, is in it; what is liked on board 2 after it is not.
		let all = nextStamped({}, A, [item('a', [liked('2026-11-01')]), item('v', [liked('2026-11-02')], 'feeds:all')], none)
		all = nextStamped(all, B, [item('b', [liked('2026-11-23')])], none)
		const scope = parseStampedChoice(moved.source.slice('stamped:'.length))!.scope!
		expect(stampedEntries(all, 'liked', scope).map((e) => e.title).sort()).toEqual(['Title a', 'Title v'])
		// The same items keep their ids, so a ranking's placements still find them.
		expect(stampedEntries(all, 'liked', scope).map((e) => e.id).sort()).toEqual(stampedEntries(all, 'liked').filter((e) => e.title !== 'Title b').map((e) => e.id).sort())
	})
})

describe('an album stamped under different ids on two boards (DARK-14)', () => {
	const ran = (id: string, stamps: Stamp[]) => item(id, stamps, 'list', { title: 'Ran', creator: 'Akira Kurosawa' })

	it('keeps the id the list from before boards gave it on a board’s list, whatever another board stamps after', () => {
		// Board 2 stamps a typed album as list|b on 1 Nov; board 1 stamps the same album as list|a on 2 Nov.
		let all = nextStamped({}, B, [ran('b', [liked('2026-11-01')])], none)
		all = nextStamped(all, A, [ran('a', [liked('2026-11-02')])], none)
		const legacyId = stampedEntries(all, 'liked')[0]!.id
		expect(legacyId).toBe(stampedKey('list', 'b'))
		replaceStamped(all)

		// A ranking on board 1 placed it under that id. Its list moves onto board 1's, and still gives it.
		const scoped = scopeToBoard('stamped:liked', 'board-1')!
		const scope = parseStampedChoice(scoped.slice('stamped:'.length))!.scope!
		const ids = () => stampedEntries(getStamped(), 'liked', scope).map((e) => e.id)
		expect(ids()).toEqual([legacyId])
		// A randomizer's picks and stamps under it move with the card, unchanged.
		const card = scopedCard({ source: 'stamped:liked', items: [item(legacyId, [disliked('2026-11-03')], 'stamped:liked')], picks: [{ source: 'stamped:liked', id: legacyId }] }, 'board-1')!
		expect(card.items[0]!.id).toBe(legacyId)
		expect(card.picks[0]!.id).toBe(legacyId)

		// Board 2 then stamps it Unsure: board 1's id stays.
		replaceStamped(nextStamped(getStamped(), B, [ran('b', [liked('2026-11-01'), { kind: 'unsure', date: '2026-11-03' }])], none))
		expect(ids()).toEqual([legacyId])
		// Board 2 takes its stamp back altogether: board 1's id stays.
		replaceStamped(nextStamped(getStamped(), B, [ran('b', [])], none))
		expect(ids()).toEqual([legacyId])
		// Board 1 stamps it again on another card of its own: still the same id, and it survives a save.
		replaceStamped(nextStamped(getStamped(), cardKey('board-1', 'shape:c'), [ran('c', [liked('2026-11-05')])], none))
		expect(ids()).toEqual([legacyId])
		replaceStamped(JSON.parse(JSON.stringify(getStamped())))
		expect(ids()).toEqual([legacyId])
		// Pinning again changes nothing.
		expect(pinLegacyIds(getStamped(), 'board-1')).toBe(getStamped())
		replaceStamped({})
	})

	it('pins nothing where a board’s own first stamp is already the old id', () => {
		const all = nextStamped({}, A, [ran('a', [liked('2026-11-01')])], none)
		expect(pinLegacyIds(all, 'board-1')).toBe(all)
	})
})

describe('ranking an item (DARK-13, DARK-14)', () => {
	const entry = { id: 'x1', title: 'Solaris', creator: 'Tarkovsky', year: '1972', cover: 'https://example.test/s.jpg', url: '' }
	const today = '2026-11-21'
	const ranked = (all: Parameters<typeof stampRanked>[0], boardId = 'board-1') => stampRanked(all, { entry, from: 'feeds:all', rankingId: 'r1', boardId }, today)

	it('stamps an item nobody stamped Liked, on the ranking’s board, under the ranking’s own card', () => {
		const all = ranked({})
		const [stamp] = Object.values(all)
		expect(stamp).toMatchObject({ card: rankingCard('r1'), board: 'board-1', source: 'feeds:all', id: 'x1', kind: 'liked', date: today, cover: entry.cover })
		expect(stampedEntries(all, 'liked', { board: 'board-1', origin: 'feeds:all' }).map((e) => e.title)).toEqual(['Solaris'])
	})

	it('never stamps again an item already stamped on its board, whatever the stamp', () => {
		for (const stamp of [liked('2026-11-01'), disliked('2026-11-01'), { kind: 'unsure' as const, date: '2026-11-01' }]) {
			const all = nextStamped({}, A, [item('x1', [stamp], 'feeds:all', { title: 'solaris', creator: 'Tarkovsky ' })], none)
			expect(ranked(all)).toBe(all)
		}
		// Ranked again, or moved between tiers, by the same ranking: still the one stamp.
		const once = ranked({})
		expect(ranked(once)).toBe(once)
	})

	it('stamps it on its own board when only another board has stamped it', () => {
		const all = nextStamped({}, B, [item('x1', [disliked('2026-11-01')], 'feeds:all', { title: 'Solaris', creator: 'Tarkovsky' })], none)
		expect(Object.values(ranked(all)).filter((e) => e.board === 'board-1')).toHaveLength(1)
	})

	it('takes an item ranked on a board out of that board’s randomizers, and no other board’s', () => {
		replaceStamped(ranked({}))
		const card = [item('x1', [], 'feeds:all', { title: 'Solaris', creator: 'Tarkovsky' })]
		expect(isOut(withRankings(card, (i) => rankedStampsOf(i, 'board-1'))[0]!)).toBe(true)
		expect(isOut(withRankings(card, (i) => rankedStampsOf(i, 'board-2'))[0]!)).toBe(false)
		replaceStamped({})
	})

	it('keeps the ranking’s stamp when a randomizer writes its own', () => {
		const next = nextStamped(ranked({}), A, [item('b', [liked('2026-11-02')])], none)
		expect(titles(next, 'liked').sort()).toEqual(['Solaris', 'Title b'])
	})
})

describe('an item’s latest stamp, for a ranking’s badges and queue', () => {
	it('is found by title and creator, case and spacing aside, on its own board only', () => {
		replaceStamped(nextStamped({}, A, [item('a', [liked('2026-11-01'), disliked('2026-11-03')])], none))
		expect(stampOf({ title: 'title A', creator: 'artist a' }, 'board-1')).toEqual({ kind: 'disliked', date: '2026-11-03' })
		expect(stampOf({ title: 'title A', creator: 'artist a' }, 'board-2')).toBeNull()
		expect(stampOf({ title: 'Something else', creator: '' }, 'board-1')).toBeNull()
		replaceStamped({})
	})

	it('counts a ranking’s stamp from before stamps had boards on every board', () => {
		replaceStamped({ old: { key: 'old', card: rankingCard('r0'), item: 'feeds:all|x', source: 'feeds:all', id: 'x', title: 'Old', creator: '', year: '', cover: '', url: '', kind: 'liked', date: '2026-10-01' } })
		expect(getStamped().old?.board).toBe('')
		expect(stampOf({ title: 'Old', creator: '' }, 'board-7')).toEqual({ kind: 'liked', date: '2026-10-01' })
		replaceStamped({})
	})
})

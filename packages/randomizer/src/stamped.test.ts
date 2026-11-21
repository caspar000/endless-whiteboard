import { describe, expect, it } from 'vitest'
import { TYPED_SOURCE, isOut, withRankings, type RandomItem, type Stamp } from './model'
import { cardKey, getStamped, nextStamped, rankedStampsOf, rankingCard, replaceStamped, stampOf, stampRanked, stampedEntries, stampedKey } from './stamped'

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

describe('ranking an item (DARK-13)', () => {
	const entry = { id: 'x1', title: 'Solaris', creator: 'Tarkovsky', year: '1972', cover: 'https://example.test/s.jpg', url: '' }
	const today = '2026-11-21'

	it('stamps it Liked, under the ranking’s own card, so it is in “Everything I liked”', () => {
		const all = stampRanked({}, { entry, from: 'feeds:all', rankingId: 'r1' }, today)
		expect(titles(all, 'liked')).toEqual(['Solaris'])
		const [stamp] = Object.values(all)
		expect(stamp).toMatchObject({ card: rankingCard('r1'), source: 'feeds:all', id: 'x1', kind: 'liked', date: today, cover: entry.cover })
	})

	it('files its own stamp on an item a randomizer already Liked, and keeps it when ranked again', () => {
		const all = nextStamped({}, A, [item('x1', [liked('2026-11-01')], 'feeds:all', { title: 'solaris', creator: 'Tarkovsky ' })], none)
		const next = stampRanked(all, { entry, from: 'feeds:all', rankingId: 'r1' }, today)
		expect(Object.values(next).filter((e) => e.card === rankingCard('r1'))).toHaveLength(1)
		expect(stampRanked(next, { entry, from: 'feeds:all', rankingId: 'r1' }, '2026-12-01')).toBe(next)
	})

	it('takes an album Liked on one card and ranked from Everything I liked out of every other card', () => {
		// Liked on card A; card B shuffles the same feed and has never stamped it.
		const all = nextStamped({}, A, [item('x1', [liked('2026-11-01')], 'feeds:all', { title: 'Solaris', creator: 'Tarkovsky' })], none)
		const [listed] = stampedEntries(all, 'liked')
		replaceStamped(stampRanked(all, { entry: { ...listed!, year: '', cover: '', url: '' }, from: 'stamped:liked', rankingId: 'r1' }, today))
		const onB = withRankings([item('x1', [], 'feeds:all', { title: 'Solaris', creator: 'Tarkovsky' })], (i) => rankedStampsOf(i))
		expect(isOut(onB[0]!)).toBe(true)
		expect(titles(getStamped(), 'liked')).toEqual(['Solaris'])
		replaceStamped({})
	})

	it('moves one stamped Unsure into Liked', () => {
		const all = nextStamped({}, A, [item('x1', [{ kind: 'unsure', date: '2026-11-01' }], 'feeds:all', { title: 'Solaris', creator: 'Tarkovsky' })], none)
		const next = stampRanked(all, { entry, from: 'feeds:all', rankingId: 'r1' }, today)
		expect(titles(next, 'liked')).toEqual(['Solaris'])
		expect(titles(next, 'unsure')).toEqual([])
	})

	it('stamps what a ranking of the stamped lists ranks as the same item, so it keeps its id', () => {
		const all = nextStamped({}, A, [item('x1', [{ kind: 'unsure', date: '2026-11-01' }], 'feeds:all', { title: 'Solaris', creator: 'Tarkovsky' })], none)
		const [listed] = stampedEntries(all, 'unsure')
		const next = stampRanked(all, { entry: { ...listed!, year: '', cover: '', url: '' }, from: 'stamped:unsure', rankingId: 'r1' }, today)
		expect(stampedEntries(next, 'unsure')).toEqual([])
		const [liked] = stampedEntries(next, 'liked')
		expect(liked?.id).toBe(listed!.id)
		expect(Object.values(next).find((e) => e.card === rankingCard('r1'))).toMatchObject({ source: 'feeds:all', id: 'x1', item: listed!.id })
	})

	it('keeps the ranking’s stamp when a randomizer writes its own', () => {
		const all = stampRanked({}, { entry, from: 'feeds:all', rankingId: 'r1' }, today)
		const next = nextStamped(all, A, [item('b', [liked('2026-11-02')])], none)
		expect(titles(next, 'liked').sort()).toEqual(['Solaris', 'Title b'])
	})
})

describe('an item’s latest stamp, for a ranking’s badges', () => {
	it('is found by title and creator, case and spacing aside', () => {
		replaceStamped(nextStamped({}, A, [item('a', [liked('2026-11-01'), disliked('2026-11-03')])], none))
		expect(stampOf({ title: 'title A', creator: 'artist a' })).toEqual({ kind: 'disliked', date: '2026-11-03' })
		expect(stampOf({ title: 'Something else', creator: '' })).toBeNull()
		replaceStamped({})
	})
})

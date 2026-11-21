import { describe, expect, it } from 'vitest'
import { TYPED_SOURCE, type RandomItem, type Stamp } from './model'
import { cardKey, nextStamped, stampedEntries, stampedKey } from './stamped'

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

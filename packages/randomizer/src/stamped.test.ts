import { describe, expect, it } from 'vitest'
import { TYPED_SOURCE, type RandomItem, type Stamp } from './model'
import { nextStamped, stampedEntries, stampedKey, type StampedEntry } from './stamped'

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

describe('the stamped list', () => {
	it('takes what a card holds when it opens, and never takes anything away then', () => {
		const current = { [stampedKey('list', 'old')]: { key: stampedKey('list', 'old'), kind: 'liked' } as StampedEntry }
		const next = nextStamped(current, null, [item('a', [liked('2026-11-01')]), item('b', [])], none)
		expect(Object.keys(next).sort()).toEqual([stampedKey('list', 'a'), stampedKey('list', 'old')])
		expect(next[stampedKey('list', 'a')]).toMatchObject({ kind: 'liked', title: 'Title a', date: '2026-11-01' })
	})

	it('follows a stamp, and its undo', () => {
		const before = [item('a', [])]
		const stamped = nextStamped({}, before, [item('a', [liked('2026-11-02')])], none)
		expect(stamped[stampedKey('list', 'a')]?.kind).toBe('liked')
		const undone = nextStamped(stamped, [item('a', [liked('2026-11-02')])], [item('a', [])], none)
		expect(undone).toEqual({})
	})

	it('lets an item go that left the card stamped (a feed video unstamped is no longer kept)', () => {
		const key = stampedKey('feeds:all', 'v')
		const stamped = nextStamped({}, [], [item('v', [liked('2026-11-02')], 'feeds:all')], none)
		expect(nextStamped(stamped, [item('v', [liked('2026-11-02')], 'feeds:all')], [], none)).toEqual({})
		expect(stamped[key]).toBeDefined()
	})

	it('keeps the picture and the address of a source’s entry, which the card does not store', () => {
		const next = nextStamped({}, [], [item('v', [liked('2026-11-02')], 'feeds:all')], () => ({ id: 'v', title: '', creator: '', year: '', cover: 'https://i/v.jpg', url: 'https://v' }))
		expect(next[stampedKey('feeds:all', 'v')]).toMatchObject({ cover: 'https://i/v.jpg', url: 'https://v' })
	})

	it('leaves alone what a card stamps while shuffling this list itself', () => {
		expect(nextStamped({}, [], [item('list|a', [disliked('2026-11-03')], 'stamped:liked')], none)).toEqual({})
	})

	it('lists one album stamped on two cards once, in its newest stamp’s list, under its first id', () => {
		const all = nextStamped(
			{},
			null,
			[
				item('a', [liked('2026-11-01')], 'list', { title: 'Ran', creator: 'Akira Kurosawa' }),
				item('list|a', [disliked('2026-11-05')], 'ranking:r', { title: 'Ran', creator: 'Akira Kurosawa' }),
				item('b', [liked('2026-11-03')]),
			],
			none
		)
		expect(stampedEntries(all, 'liked').map((e) => e.title)).toEqual(['Title b'])
		expect(stampedEntries(all, 'disliked').map((e) => [e.title, e.id])).toEqual([['Ran', stampedKey('list', 'a')]])
	})
})

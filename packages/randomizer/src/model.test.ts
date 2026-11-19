import { describe, expect, it } from 'vitest'
import {
	MAX_SHUFFLE_MS,
	PICKS_KEPT_PER_LIST,
	currentItem,
	flipCount,
	flipDurations,
	flipSequence,
	formatLine,
	formatList,
	inShuffle,
	isOut,
	lastPicks,
	mergeList,
	parseLine,
	pickNext,
	postmarkDate,
	randomIndex,
	recordPick,
	shortDate,
	type RandomItem,
	type RandomWords,
	type Stamp,
} from './model'

const item = (id: string, stamps: Stamp[] = [], list: RandomItem['list'] = 'albums'): RandomItem => ({
	id,
	list,
	title: `Title ${id}`,
	creator: `Artist ${id}`,
	year: '',
	cover: '',
	stamps,
})

/** Hands out the given words in turn, so a test decides what "random" says. */
const scripted = (...draws: number[]): RandomWords => {
	let i = 0
	return (out) => {
		out[0] = draws[i++ % draws.length]!
	}
}

describe('parseLine', () => {
	it('reads title, creator and year from any of the usual separators', () => {
		expect(parseLine('Low Tide Radio — Marlow Vance — 1978')).toEqual({ title: 'Low Tide Radio', creator: 'Marlow Vance', year: '1978' })
		expect(parseLine('Low Tide Radio - Marlow Vance')).toEqual({ title: 'Low Tide Radio', creator: 'Marlow Vance', year: '' })
		expect(parseLine('Low Tide Radio\tMarlow Vance\t1978')).toEqual({ title: 'Low Tide Radio', creator: 'Marlow Vance', year: '1978' })
		expect(parseLine('Low Tide Radio | Marlow Vance')).toEqual({ title: 'Low Tide Radio', creator: 'Marlow Vance', year: '' })
	})

	it('keeps a hyphen inside a word, and drops list bullets and numbers', () => {
		expect(parseLine('- Spider-Man — Sam Raimi')).toEqual({ title: 'Spider-Man', creator: 'Sam Raimi', year: '' })
		expect(parseLine('12. Blue Hour Tapes — Mina Kaur')).toEqual({ title: 'Blue Hour Tapes', creator: 'Mina Kaur', year: '' })
	})

	it('reads a second part that is a year as the year', () => {
		expect(parseLine('Slow Weather — 2002')).toEqual({ title: 'Slow Weather', creator: '', year: '2002' })
	})

	it('skips blank lines', () => {
		expect(parseLine('   ')).toBeNull()
	})
})

describe('mergeList', () => {
	it('keeps covers and stamps of items still in the list, and adds new lines as items', () => {
		const kept = { ...item('a', [{ kind: 'unsure', date: '2026-11-02' }]), cover: 'asset:abc' }
		const film = item('f', [], 'films')
		let n = 0
		const next = mergeList([kept, item('gone'), film], 'albums', 'Title a — Artist a — 1999\nNew one — Someone', () => `new${n++}`)
		expect(next).toEqual([
			film,
			{ ...kept, year: '1999' },
			{ id: 'new0', list: 'albums', title: 'New one', creator: 'Someone', year: '', cover: '', stamps: [] },
		])
	})

	it('round-trips through the text it shows', () => {
		const items = [item('a'), { ...item('b'), year: '1978' }]
		expect(mergeList(items, 'albums', formatList(items, 'albums'))).toEqual(items)
	})

	it('reads back every line it writes, including the ambiguous two-part ones', () => {
		const cases = [
			{ title: 'Book', creator: '', year: 'c. 1600' },
			{ title: 'Book', creator: '', year: '1600' },
			{ title: 'Book', creator: '1349', year: '' },
			{ title: 'Book', creator: 'Someone', year: 'c. 1600' },
			{ title: 'Book', creator: '', year: '' },
		]
		for (const fields of cases) expect(parseLine(formatLine(fields))).toEqual(fields)
	})

	it('keeps the cover and stamps of a year-only item through an unrelated edit', () => {
		const book: RandomItem = {
			id: 'b',
			list: 'books',
			title: 'Book',
			creator: '',
			year: 'c. 1600',
			cover: 'asset:abc',
			stamps: [{ kind: 'liked', date: '2026-11-19' }],
		}
		const next = mergeList([book], 'books', `${formatList([book], 'books')}\nAnother — Someone`, () => 'new')
		expect(next[0]).toEqual(book)
		expect(next).toHaveLength(2)
	})
})

describe('stamps and the shuffle', () => {
	it('takes Liked and Disliked out, leaves Unsure in, and only the latest stamp counts', () => {
		expect(isOut(item('a', [{ kind: 'liked', date: '2026-11-19' }]))).toBe(true)
		expect(isOut(item('a', [{ kind: 'disliked', date: '2026-11-19' }]))).toBe(true)
		expect(isOut(item('a', [{ kind: 'unsure', date: '2026-11-19' }]))).toBe(false)
		expect(isOut(item('a', [{ kind: 'unsure', date: '2026-11-02' }, { kind: 'liked', date: '2026-11-19' }]))).toBe(true)
		const items = [item('a'), item('b', [{ kind: 'liked', date: '2026-11-19' }]), item('c', [], 'films')]
		expect(inShuffle(items, 'albums').map((i) => i.id)).toEqual(['a'])
	})

	it('never lands on a stamped-out item or the one on show', () => {
		const items = [item('a'), item('b', [{ kind: 'liked', date: '2026-11-19' }]), item('c'), item('d')]
		for (let draw = 0; draw < 6; draw++) {
			const pick = pickNext(items, 'albums', 'a', scripted(draw))
			expect(['c', 'd']).toContain(pick?.id)
		}
	})

	it('returns the only one left, and nothing when every item is out', () => {
		expect(pickNext([item('a')], 'albums', 'a')?.id).toBe('a')
		expect(pickNext([item('a', [{ kind: 'disliked', date: '2026-11-19' }])], 'albums', null)).toBeNull()
	})
})

describe('randomIndex', () => {
	it('throws away draws in the short tail instead of folding them onto low indexes', () => {
		// 2^32 is not a multiple of 3, so the top draw is in the discarded tail.
		expect(randomIndex(3, scripted(2 ** 32 - 1, 4))).toBe(1)
	})

	it('reaches every index', () => {
		const seen = new Set(Array.from({ length: 5 }, (_, i) => randomIndex(5, scripted(i))))
		expect(seen.size).toBe(5)
	})
})

describe('picks', () => {
	it('shows the newest pick, and the ones before it as last picks', () => {
		const items = [item('a'), item('b'), item('c')]
		let picks = recordPick([], { list: 'albums', id: 'b' })
		picks = recordPick(picks, { list: 'albums', id: 'c' })
		expect(currentItem(items, picks, 'albums')?.id).toBe('c')
		expect(lastPicks(items, picks, 'albums').map((i) => i.id)).toEqual(['b'])
	})

	it('falls back to the first item, and keeps a bounded history per list', () => {
		expect(currentItem([item('a'), item('b')], [], 'albums')?.id).toBe('a')
		let picks = recordPick([], { list: 'films', id: 'x' })
		for (let i = 0; i < 9; i++) picks = recordPick(picks, { list: 'albums', id: String(i) })
		expect(picks.filter((p) => p.list === 'albums')).toHaveLength(PICKS_KEPT_PER_LIST)
		expect(picks.some((p) => p.list === 'films')).toBe(true)
	})
})

describe('the shuffle grows with the list', () => {
	it('flips about 24 times for a dozen, more for a backlog, never past 80', () => {
		expect(flipCount(12)).toBe(24)
		expect(flipCount(300)).toBeGreaterThan(flipCount(12))
		expect(flipCount(100_000)).toBe(80)
		expect(flipCount(1)).toBe(6)
	})

	it('stays under the time limit however long the list, and ends slower than it runs', () => {
		for (const n of [1, 2, 12, 50, 300, 5000]) {
			const durations = flipDurations(flipCount(n))
			expect(durations.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_SHUFFLE_MS)
			expect(durations.at(-1)!).toBeGreaterThan(durations[Math.floor(durations.length / 2)]!)
		}
	})

	it('flips through the list without repeating a cover and lands on the answer', () => {
		const seq = flipSequence(['a', 'b', 'c'], 'a', 'b', 10, scripted(0, 1, 2, 3))
		expect(seq).toHaveLength(10)
		expect(seq.at(-1)).toBe('b')
		expect(seq.at(-2)).not.toBe('b')
		expect(seq[0]).not.toBe('a')
		for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1])
	})
})

describe('dates', () => {
	it('prints a postmark date and a timeline date', () => {
		expect(postmarkDate('2026-11-19')).toBe('19 NOV 26')
		expect(shortDate('2026-11-02')).toBe('2 Nov')
	})
})

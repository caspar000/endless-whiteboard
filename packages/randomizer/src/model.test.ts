import { describe, expect, it } from 'vitest'
import {
	MAX_SHUFFLE_MS,
	PICKS_KEPT_PER_SOURCE,
	TYPED_SOURCE,
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
	oneTypedList,
	parseSourceKey,
	shortDate,
	sourceKey,
	storeItem,
	withEntries,
	withRankings,
	type RandomItem,
	type SourceEntry,
	type RandomWords,
	type Stamp,
	weightedIndex,
} from './model'

const FEED = 'feeds:all'

const item = (id: string, stamps: Stamp[] = [], source: string = TYPED_SOURCE): RandomItem => ({
	id,
	source,
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
		const video = item('v', [{ kind: 'liked', date: '2026-11-19' }], FEED)
		let n = 0
		const next = mergeList([kept, item('gone'), video], 'Title a — Artist a — 1999\nNew one — Someone', () => `new${n++}`)
		expect(next).toEqual([
			video,
			{ ...kept, year: '1999' },
			{ id: 'new0', source: TYPED_SOURCE, title: 'New one', creator: 'Someone', year: '', cover: '', stamps: [] },
		])
	})

	it('round-trips through the text it shows', () => {
		const items = [item('a'), { ...item('b'), year: '1978' }]
		expect(mergeList(items, formatList(items))).toEqual(items)
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
			source: TYPED_SOURCE,
			title: 'Book',
			creator: '',
			year: 'c. 1600',
			cover: 'asset:abc',
			stamps: [{ kind: 'liked', date: '2026-11-19' }],
		}
		const next = mergeList([book], `${formatList([book])}\nAnother — Someone`, () => 'new')
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
		const items = [item('a'), item('b', [{ kind: 'liked', date: '2026-11-19' }]), item('c', [], FEED)]
		expect(inShuffle(items, TYPED_SOURCE).map((i) => i.id)).toEqual(['a'])
	})

	it('never lands on a stamped-out item or the one on show', () => {
		const items = [item('a'), item('b', [{ kind: 'liked', date: '2026-11-19' }]), item('c'), item('d')]
		for (let draw = 0; draw < 6; draw++) {
			const pick = pickNext(items, TYPED_SOURCE, 'a', scripted(draw))
			expect(['c', 'd']).toContain(pick?.id)
		}
	})

	it('returns the only one left, and nothing when every item is out', () => {
		expect(pickNext([item('a')], TYPED_SOURCE, 'a')?.id).toBe('a')
		expect(pickNext([item('a', [{ kind: 'disliked', date: '2026-11-19' }])], TYPED_SOURCE, null)).toBeNull()
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
		let picks = recordPick([], { source: TYPED_SOURCE, id: 'b' })
		picks = recordPick(picks, { source: TYPED_SOURCE, id: 'c' })
		expect(currentItem(items, picks, TYPED_SOURCE)?.id).toBe('c')
		expect(lastPicks(items, picks, TYPED_SOURCE).map((i) => i.id)).toEqual(['b'])
	})

	it('falls back to the first item, and keeps a bounded history per source', () => {
		expect(currentItem([item('a'), item('b')], [], TYPED_SOURCE)?.id).toBe('a')
		let picks = recordPick([], { source: FEED, id: 'x' })
		for (let i = 0; i < 9; i++) picks = recordPick(picks, { source: TYPED_SOURCE, id: String(i) })
		expect(picks.filter((p) => p.source === TYPED_SOURCE)).toHaveLength(PICKS_KEPT_PER_SOURCE)
		expect(picks.some((p) => p.source === FEED)).toBe(true)
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

describe('source keys', () => {
	it('takes a key apart at its first colon, so a choice may have colons of its own', () => {
		expect(parseSourceKey(sourceKey('feeds', 'cat:abc'))).toEqual({ sourceId: 'feeds', choiceId: 'cat:abc' })
	})

	it('reads no source and the typed list as neither', () => {
		expect(parseSourceKey('')).toBeNull()
		expect(parseSourceKey(TYPED_SOURCE)).toBeNull()
	})
})

describe("another source's entries", () => {
	const entry = (id: string, over: Partial<SourceEntry> = {}): SourceEntry => ({
		id,
		title: `Video ${id}`,
		creator: 'A channel',
		year: '12 Nov 2026',
		cover: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
		url: `https://www.youtube.com/watch?v=${id}`,
		...over,
	})

	it('become items in their own order, carrying the stamps and the cover the card put on them', () => {
		const stamped = { ...item('b', [{ kind: 'unsure', date: '2026-11-19' }], FEED), cover: 'asset:mine' }
		const items = withEntries([stamped, item('a')], FEED, [entry('a'), entry('b')])
		expect(items.map((i) => [i.id, i.source])).toEqual([
			['a', FEED],
			['b', FEED],
		])
		expect(items[0]).toMatchObject({ stamps: [], cover: entry('a').cover, url: entry('a').url })
		expect(items[1]).toMatchObject({ stamps: stamped.stamps, cover: 'asset:mine' })
	})

	it('are stored only while stamped or covered, and never with the source\'s url, picture or detail', () => {
		const [shown] = withEntries([], FEED, [entry('a', { detail: '11 tracks' })])
		expect(shown!.detail).toBe('11 tracks')
		const stamps: Stamp[] = [{ kind: 'liked', date: '2026-11-20' }]
		const stored = storeItem([], shown!, { stamps })
		expect(stored).toEqual([{ id: 'a', source: FEED, title: 'Video a', creator: 'A channel', year: '12 Nov 2026', cover: '', stamps }])
		// Unstamped again, nothing of it is left on the card.
		const [again] = withEntries(stored, FEED, [entry('a')])
		expect(storeItem(stored, again!, { stamps: [] })).toEqual([])
	})

	it('keeps a dropped cover through a later stamp', () => {
		const [shown] = withEntries([], FEED, [entry('a')])
		const covered = storeItem([], shown!, { cover: 'asset:mine' })
		const [again] = withEntries(covered, FEED, [entry('a')])
		expect(storeItem(covered, again!, { stamps: [{ kind: 'unsure', date: '2026-11-20' }] })[0]?.cover).toBe('asset:mine')
	})

	it('leave the typed list alone, which is stored whole even unstamped', () => {
		const typed = item('t')
		expect(storeItem([typed], typed, { stamps: [] })).toEqual([typed])
	})
})

describe('cards from before DARK-7', () => {
	it('put the three lists into one typed list, the one on show first, keeping every stamp and pick', () => {
		const stamps = [{ kind: 'liked', date: '2026-11-19' }]
		const before = {
			list: 'films',
			items: [
				{ id: 'a', list: 'albums', title: 'An album', creator: '', year: '', cover: '', stamps },
				{ id: 'f', list: 'films', title: 'A film', creator: '', year: '', cover: 'asset:x', stamps: [] },
			],
			picks: [
				{ list: 'albums', id: 'a' },
				{ list: 'films', id: 'f' },
			],
		}
		const after = oneTypedList(before)
		expect(after.source).toBe(TYPED_SOURCE)
		expect(after.items).toEqual([
			{ id: 'f', source: TYPED_SOURCE, title: 'A film', creator: '', year: '', cover: 'asset:x', stamps: [] },
			{ id: 'a', source: TYPED_SOURCE, title: 'An album', creator: '', year: '', cover: '', stamps },
		])
		// The film was on show, so the card still opens on it.
		expect(after.picks[0]).toEqual({ source: TYPED_SOURCE, id: 'f' })
		expect(after.picks).toHaveLength(2)
	})

	it('leave an empty card waiting for a source, as a new one does', () => {
		expect(oneTypedList({ list: 'albums', items: [], picks: [] })).toEqual({ source: '', items: [], picks: [] })
	})
})

describe('a weighted draw (DARK-11)', () => {
	it('lands on each index as often as its weight says, from one fair draw over their sum', () => {
		// Weights 4, 1, 3: draws 0–3 are the first, 4 the second, 5–7 the third.
		const seen = Array.from({ length: 8 }, (_, d) => weightedIndex([4, 1, 3], scripted(d)))
		expect(seen).toEqual([0, 0, 0, 0, 1, 2, 2, 2])
	})

	it('draws evenly when every weight is nothing', () => {
		expect(weightedIndex([0, 0], scripted(1))).toBe(1)
	})

	it('picks a weighted source’s items by weight, and others evenly', () => {
		const heavy = { ...item('h', [], FEED), weight: 3 }
		const light = { ...item('l', [], FEED), weight: 1 }
		// Sum 4: draws 0–2 are the heavy one, 3 the light one.
		expect(pickNext([heavy, light], FEED, null, scripted(2))?.id).toBe('h')
		expect(pickNext([heavy, light], FEED, null, scripted(3))?.id).toBe('l')
		expect(pickNext([item('a', [], FEED), item('b', [], FEED)], FEED, null, scripted(1))?.id).toBe('b')
	})

	it('draws by weight from the whole pool, the one on show included, so the odds hold draw after draw', () => {
		const heavy = { ...item('h', [], FEED), weight: 4 }
		const light = { ...item('l', [], FEED), weight: 1 }
		// With heavy on show, draws 0–3 still land on it: four in five, not every other time.
		const next = Array.from({ length: 5 }, (_, d) => pickNext([heavy, light], FEED, 'h', scripted(d))?.id)
		expect(next).toEqual(['h', 'h', 'h', 'h', 'l'])
		// Over many successive draws, each one from the last, heavy comes up about four times as often.
		let current: string | null = null
		const seen = { h: 0, l: 0 }
		for (let i = 0; i < 4000; i++) {
			current = pickNext([heavy, light], FEED, current)!.id
			seen[current as 'h' | 'l']++
		}
		expect(seen.h / 4000).toBeGreaterThan(0.75)
		expect(seen.h / 4000).toBeLessThan(0.85)
	})

	it('still never repeats the one on show when drawing evenly', () => {
		const next = Array.from({ length: 4 }, (_, d) => pickNext([item('a', [], FEED), item('b', [], FEED)], FEED, 'a', scripted(d))?.id)
		expect(next).toEqual(['b', 'b', 'b', 'b'])
	})

	it('carries a source’s weight onto the card’s item, never into what it stores', () => {
		const [shown] = withEntries([], FEED, [{ id: 'a', title: 'A', creator: '', year: '', cover: '', url: '', weight: 4 }])
		expect(shown?.weight).toBe(4)
		expect(storeItem([], shown!, { stamps: [{ kind: 'liked', date: '2026-11-21' }] })[0]).not.toHaveProperty('weight')
	})
})

describe('stamps a ranking gave (DARK-13)', () => {
	const ranked = (date: string): Stamp => ({ kind: 'liked', date, ranked: true })

	it('count on the card: a ranked album is Liked, and out of the shuffle', () => {
		const items = withRankings([item('a'), item('b')], (i) => (i.id === 'a' ? [ranked('2026-11-21')] : []))
		expect(isOut(items[0]!)).toBe(true)
		expect(inShuffle(items, TYPED_SOURCE).map((i) => i.id)).toEqual(['b'])
	})

	it('sit among the card’s own by day, after the card’s on the same day', () => {
		const [a] = withRankings([item('a', [{ kind: 'unsure', date: '2026-11-21' }, { kind: 'disliked', date: '2026-11-25' }])], () => [ranked('2026-11-21')])
		expect(a!.stamps.map((s) => [s.kind, !!s.ranked])).toEqual([
			['unsure', false],
			['liked', true],
			['disliked', false],
		])
	})

	it('are never stored on the card', () => {
		const [a] = withRankings([item('a', [{ kind: 'unsure', date: '2026-11-20' }])], () => [ranked('2026-11-21')])
		const stored = storeItem([], a!, { stamps: [...a!.stamps, { kind: 'disliked', date: '2026-11-22' }] })
		expect(stored[0]!.stamps).toEqual([
			{ kind: 'unsure', date: '2026-11-20' },
			{ kind: 'disliked', date: '2026-11-22' },
		])
	})
})

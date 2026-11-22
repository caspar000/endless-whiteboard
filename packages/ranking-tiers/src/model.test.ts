import { describe, expect, it } from 'vitest'
import {
	MAX_TIERS,
	MAX_WEIGHT,
	UNRANKED,
	addTier,
	formatOdds,
	mergeEntries,
	moveItem,
	moveTier,
	newRanking,
	nextWeight,
	rankedKeys,
	rankingView,
	readRanking,
	removeTier,
	renameTier,
	setTierLook,
	setTierWeight,
	showsStamp,
	siblingList,
	splitUnranked,
	emptyTier,
	plateColor,
	tierShares,
	weightedEntries,
	type Ranking,
} from './model'
import { getPrefs, parseTiers, formatTiers } from './prefs'
import { rankingChoices, tierChoiceId } from './source'

const entry = (id: string) => ({ id, title: `Album ${id}`, creator: 'Artist', year: '', cover: '', url: '' })
const entries = ['a', 'b', 'c', 'd', 'e'].map(entry)
const ranked = (): Ranking => ({ ...newRanking('r1'), source: 'stamped:liked' })
const ids = (ranking: Ranking) => rankingView(ranking, entries).bands.map((b) => b.items.map((i) => i.id))

describe('a new ranking', () => {
	it('starts with the listening tiers, heaviest first, weighted shuffle off', () => {
		const r = newRanking('r1')
		expect(r.tiers.map((t) => [t.name, t.weight])).toEqual([
			['Heavy rotation', 4],
			['Often', 3],
			['Now and then', 2],
			['Rarely', 1],
		])
		expect(r.weighted).toBe(false)
	})

	it('draws the same before it is stored, so a card can show it before the first change', () => {
		expect(newRanking('r1')).toEqual(newRanking('r1'))
	})

	it('starts with the tiers Settings gives new cards', () => {
		expect(getPrefs().tiers.length).toBe(4)
		expect(newRanking('r1', parseTiers('S × 5\nA × 3\nB')).tiers.map((t) => [t.name, t.weight])).toEqual([
			['S', 5],
			['A', 3],
			['B', 1],
		])
	})
})

describe('sorting items', () => {
	it('puts everything unranked until it is moved, in the source’s own order', () => {
		const view = rankingView(ranked(), entries)
		expect(view.bands.every((b) => b.items.length === 0)).toBe(true)
		expect(view.unranked.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
	})

	it('moves an item into a tier, before another or at the end, and back out', () => {
		let r = ranked()
		r = moveItem(r, 'a', 't1')
		r = moveItem(r, 'b', 't1')
		r = moveItem(r, 'c', 't1', 'a')
		expect(ids(r)[0]).toEqual(['c', 'a', 'b'])
		r = moveItem(r, 'a', 't2')
		expect(ids(r).slice(0, 2)).toEqual([['c', 'b'], ['a']])
		r = moveItem(r, 'a', UNRANKED)
		expect(rankingView(r, entries).unranked.map((e) => e.id)).toEqual(['a', 'd', 'e'])
	})

	it('keeps each source’s arrangement apart', () => {
		let r = moveItem(ranked(), 'a', 't1')
		r = { ...r, source: 'feeds:all' }
		expect(ids(r)[0]).toEqual([])
		r = { ...r, source: 'stamped:liked' }
		expect(ids(r)[0]).toEqual(['a'])
	})

	it('leaves out an item the source no longer has, and keeps its place in case it comes back', () => {
		const r = moveItem(ranked(), 'gone', 't1')
		expect(ids(r)[0]).toEqual([])
		expect(r.placed['stamped:liked']?.t1).toEqual(['gone'])
	})
})

describe('changing the tiers', () => {
	it('adds, renames, reweighs and moves tiers', () => {
		let r = addTier(ranked(), 'Once a year', () => 'new')!
		expect(r.tiers.map((t) => t.name).at(-1)).toBe('Once a year')
		r = renameTier(r, 'new', '  Yearly ')
		r = renameTier(r, 'new', '   ')
		expect(r.tiers.at(-1)?.name).toBe('Yearly')
		r = setTierWeight(r, 't1', 9)
		expect(r.tiers[0]?.weight).toBe(MAX_WEIGHT)
		r = moveTier(r, 't1', 1)
		expect(r.tiers.slice(0, 2).map((t) => t.id)).toEqual(['t2', 't1'])
		expect(moveTier(r, 't2', -1)).toBe(r)
	})

	it('stops at the most tiers a ranking has', () => {
		let r: Ranking | null = ranked()
		for (let i = 0; i < MAX_TIERS; i++) r = addTier(r!, `T${i}`) ?? r
		expect(r!.tiers.length).toBe(MAX_TIERS)
		expect(addTier(r!, 'one more')).toBeNull()
	})

	it('unranks a removed tier’s items, in every source, and keeps the last tier', () => {
		let r = moveItem(ranked(), 'a', 't1')
		r = moveItem({ ...r, source: 'feeds:all' }, 'x', 't1')
		r = removeTier({ ...r, source: 'stamped:liked' }, 't1')
		expect(r.tiers.map((t) => t.id)).toEqual(['t2', 't3', 't4'])
		expect(rankingView(r, entries).unranked.map((e) => e.id)).toContain('a')
		expect(r.placed['feeds:all']).toEqual({})
		const one = { ...r, tiers: r.tiers.slice(0, 1) }
		expect(removeTier(one, one.tiers[0]!.id)).toBe(one)
	})

	it('cycles the die down a pip, and from one back round to the most', () => {
		expect([4, 3, 2, 1].map(nextWeight)).toEqual([3, 2, 1, MAX_WEIGHT])
	})
})

describe('weights and odds', () => {
	// Heavy rotation ×4 with one album, Often ×3 with two, Rarely ×1 with one: 4 + 6 + 1 = 11.
	const r = moveItem(moveItem(moveItem(moveItem(ranked(), 'a', 't1'), 'b', 't2'), 'c', 't2'), 'd', 't4')

	it('gives each tier its weight times its items over the whole draw', () => {
		const shares = tierShares(rankingView(r, entries).bands)
		expect(shares.map((s) => Math.round(s * 11))).toEqual([4, 6, 0, 1])
	})

	it('writes a chance as “1 in N”, or as a percentage', () => {
		expect(formatOdds(4 / 11, false)).toBe('1 in 3')
		expect(formatOdds(4 / 11, true)).toBe('36%')
		expect(formatOdds(0.004, true)).toBe('<1%')
		expect(formatOdds(0, false)).toBe('—')
	})

	it('offers the ranked items with their tier’s weight, and none of the unranked', () => {
		expect(weightedEntries(r, entries).map((e) => [e.id, e.weight])).toEqual([
			['a', 4],
			['b', 3],
			['c', 3],
			['d', 1],
		])
	})

	it('is offered whole only with weighted shuffle on, a tier at a time always, and only on its own board (DARK-14)', () => {
		const on = (x: Ranking) => ({ ...x, boardId: 'b1' })
		const all = { r1: on({ ...r, weighted: true }), r2: on({ ...r, rankingId: 'r2' }), r3: on({ ...newRanking('r3'), weighted: true }), r4: { ...r, rankingId: 'r4', boardId: 'b2' } }
		const ids = rankingChoices(all, 'b1').map((c) => c.id)
		expect(ids).toContain('r1')
		expect(ids).not.toContain('r2')
		expect(ids).toContain(tierChoiceId('r2', 't1'))
		expect(ids.some((id) => id.startsWith('r3'))).toBe(false)
		expect(ids.some((id) => id.startsWith('r4'))).toBe(false)
		expect(rankingChoices(all, 'b2').map((c) => c.id)).toEqual(r.tiers.map((t) => tierChoiceId('r4', t.id)))
	})
})

describe('a stored ranking', () => {
	it('is read back whole', () => {
		const r = { ...moveItem(ranked(), 'a', 't1'), weighted: true, name: 'Rotation' }
		expect(readRanking(JSON.parse(JSON.stringify(r)))).toEqual(r)
	})

	it('drops what can’t be read rather than trusting it', () => {
		expect(readRanking({ rankingId: '' })).toBeNull()
		expect(readRanking({ rankingId: 'x', tiers: [] })).toBeNull()
		const read = readRanking({ rankingId: 'x', tiers: [{ id: 't', name: 'T', weight: 'lots' }, { name: 'no id' }], placed: { k: { t: ['a', 3] }, bad: 4 } })
		expect(read?.tiers).toEqual([{ id: 't', name: 'T', weight: 1, color: '', border: '', icon: '' }])
		// Made before DARK-14: no board until one claims it, and drawn as tiers.
		expect(read).toMatchObject({ boardId: '', display: 'tiers' })
		expect(read?.placed).toEqual({ k: { t: ['a'] } })
	})

	it('writes Settings’ tiers so they read back the same', () => {
		const tiers = parseTiers('Heavy rotation × 4\nOften x 3\nRarely')
		expect(parseTiers(formatTiers(tiers))).toEqual(tiers)
	})
})

describe('stamps on a ranking (DARK-13, DARK-14)', () => {
	const KINDS = ['liked', 'disliked', 'unsure']
	const of = (source: string, stampFilter: Record<string, boolean> = {}) => ({ source, stampFilter })

	it('shows every stamp on a ranking of anything else, until one is switched off', () => {
		expect(KINDS.map((k) => showsStamp(of('feeds:all'), k, 'stamped'))).toEqual([true, true, true])
		expect(showsStamp(of('feeds:all', { disliked: false }), 'disliked', 'stamped')).toBe(false)
	})

	it('shows only the kind a ranking of a stamped list was pointed at, until more are switched on', () => {
		const list = 'stamped:liked|b1|syllabus:mucore'
		expect(KINDS.map((k) => showsStamp(of(list), k, 'stamped'))).toEqual([true, false, false])
		expect(KINDS.map((k) => showsStamp(of('stamped:liked'), k, 'stamped'))).toEqual([true, false, false])
		expect(showsStamp(of(list, { unsure: true }), 'unsure', 'stamped')).toBe(true)
	})

	it('reads every kind of the same stamped list, so a cover whose stamp changes is still found', () => {
		const list = 'stamped:liked|b1|syllabus:mucore'
		expect(siblingList(list, 'stamped', 'unsure')).toBe('stamped:unsure|b1|syllabus:mucore')
		expect(rankedKeys(of(list), 'stamped', KINDS)).toEqual([list, 'stamped:disliked|b1|syllabus:mucore', 'stamped:unsure|b1|syllabus:mucore'])
		expect(rankedKeys(of('stamped:liked'), 'stamped', KINDS)).toEqual(['stamped:liked', 'stamped:disliked', 'stamped:unsure'])
	})

	it('reads only its own source when nothing stamps, or it ranks something else', () => {
		expect(rankedKeys(of('feeds:all', { unsure: true }), 'stamped', KINDS)).toEqual(['feeds:all'])
		expect(rankedKeys(of('stamped:liked', { unsure: true }), null, [])).toEqual(['stamped:liked'])
		expect(rankedKeys(of(''), 'stamped', KINDS)).toEqual([])
	})

	it('puts the stamped of a shown kind in the queue, newest first, the never stamped in the rail, and the hidden nowhere', () => {
		const stamps: Record<string, { kind: string; date: string }> = {
			a: { kind: 'liked', date: '2026-11-01' },
			b: { kind: 'disliked', date: '2026-11-03' },
			d: { kind: 'unsure', date: '2026-11-05' },
		}
		const split = (shown: string[]) => splitUnranked(entries, (e) => stamps[e.id], (k) => shown.includes(k))
		const all = split(KINDS)
		expect(all.queue.map((e) => e.id)).toEqual(['d', 'b', 'a'])
		expect(all.rail.map((e) => e.id)).toEqual(['c', 'e'])
		// Unsure and Disliked switched off: the queue holds only the liked, and they wait nowhere else.
		const likedOnly = split(['liked'])
		expect(likedOnly.queue.map((e) => e.id)).toEqual(['a'])
		expect(likedOnly.rail.map((e) => e.id)).toEqual(['c', 'e'])
	})

	it('merges lists as one, each item once', () => {
		expect(mergeEntries([[entry('a'), entry('b')], [entry('b'), entry('c')]]).map((e) => e.id)).toEqual(['a', 'b', 'c'])
	})

	it('keeps its filters, badges, cover shape, board, display and tier looks through a save, and starts without them', () => {
		const r = setTierLook(
			{ ...ranked(), stampFilter: { liked: true, disliked: false }, badges: true, aspect: '16:9', boardId: 'b1', display: 'shelf' as const },
			't2',
			{ color: 'plum', border: 'teal', icon: 'star' }
		)
		expect(readRanking(JSON.parse(JSON.stringify(r)))).toEqual(r)
		expect(readRanking({ rankingId: 'x', tiers: [{ id: 't', name: 'T', weight: 1 }], stampFilter: { liked: 'yes', unsure: false } })).toMatchObject({
			stampFilter: { unsure: false },
			badges: false,
			aspect: '',
		})
	})
})

describe('a tier’s look (DARK-14)', () => {
	it('starts the listening tiers with colours and icons, and any tier can change them', () => {
		const r = newRanking('r1')
		expect(r.tiers.map((t) => [t.color, t.icon])).toEqual([
			['ember', 'flame'],
			['teal', 'repeat'],
			['amber', 'clock'],
			['slate', 'moon'],
		])
		const changed = setTierLook(r, 't1', { border: 'rose' })
		expect(changed.tiers[0]).toMatchObject({ color: 'ember', border: 'rose', icon: 'flame' })
		expect(addTier(r, 'Plain')!.tiers[4]).toMatchObject({ color: '', border: '', icon: '' })
	})

	it('gives a shelf without a colour a nameplate of its own', () => {
		expect(plateColor({ color: 'plum' }, 0)).toBe('#7a3f8c')
		expect(plateColor({ color: '' }, 0)).not.toBe(plateColor({ color: '' }, 1))
	})

	it('takes everything off a tier, back to unranked', () => {
		const r = moveItem(moveItem(ranked(), 'a', 't1'), 'b', 't1')
		expect(ids(emptyTier(r, 't1'))[0]).toEqual([])
		expect(rankingView(emptyTier(r, 't1'), entries).unranked.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
	})
})

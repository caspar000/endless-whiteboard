import { describe, expect, it } from 'vitest'
import { MAX_DICE_IN_HAND } from './kinds'
import { formatNotation, parseNotation } from './notation'

describe('formatNotation', () => {
	it('writes the count even when it is one', () => {
		expect(formatNotation(new Map([['d20', 1]]))).toBe('1d20')
	})

	it('joins terms in tray order, not insertion order', () => {
		expect(formatNotation(new Map([['d12', 1], ['d6', 2]]))).toBe('2d6 + 1d12')
	})

	it('skips kinds held at zero, and is empty for an empty hand', () => {
		expect(formatNotation(new Map([['d6', 0], ['d4', 3]]))).toBe('3d4')
		expect(formatNotation(new Map())).toBe('')
	})
})

describe('parseNotation', () => {
	const counts = (input: string) => {
		const parsed = parseNotation(input)
		if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.error}`)
		return [...parsed.counts]
	}

	const modifier = (input: string) => {
		const parsed = parseNotation(input)
		if (!parsed.ok) throw new Error(`expected a parse, got: ${parsed.error}`)
		return parsed.modifier
	}

	it('reads a bare die as one of them', () => {
		expect(counts('d20')).toEqual([['d20', 1]])
	})

	it('reads counts, and several terms', () => {
		expect(counts('2d6 + 1d12')).toEqual([['d6', 2], ['d12', 1]])
		expect(counts('3d8')).toEqual([['d8', 3]])
	})

	it('is indifferent to case, whitespace and term order', () => {
		expect(counts('  2D6+D12 ')).toEqual([['d6', 2], ['d12', 1]])
		expect(counts('d12 + 2d6')).toEqual([['d6', 2], ['d12', 1]])
	})

	it('adds a die named twice', () => {
		expect(counts('d6 + d6 + 2d6')).toEqual([['d6', 4]])
	})

	it('round-trips its own output', () => {
		const hand = new Map([['d4', 1], ['d6', 2], ['d100', 3]] as const)
		expect(counts(formatNotation(hand))).toEqual([...hand])
	})

	it('names the dice that exist when given one that does not', () => {
		const parsed = parseNotation('d7')
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.error).toContain('no d7')
		// The correction has to carry the alternatives — an agent's only way to recover is to read this.
		expect(parsed.error).toContain('d20')
	})

	it('refuses a hand larger than one roll holds', () => {
		const parsed = parseNotation(`${MAX_DICE_IN_HAND + 1}d6`)
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.error).toContain(String(MAX_DICE_IN_HAND))
	})

	it('counts the whole expression against the cap, not each term', () => {
		const half = Math.ceil(MAX_DICE_IN_HAND / 2)
		expect(parseNotation(`${half}d6 + ${half}d8 + 1d4`).ok).toBe(false)
	})

	it('reads a flat modifier', () => {
		expect(modifier('2d20 + 10')).toBe(10)
		expect(counts('2d20 + 10')).toEqual([['d20', 2]])
		expect(modifier('1d6 + 2d4 + 1d20 + 4')).toBe(4)
		expect(counts('1d6 + 2d4 + 1d20 + 4')).toEqual([['d4', 2], ['d6', 1], ['d20', 1]])
	})

	it('reads a negative modifier, and sums several', () => {
		expect(modifier('2d6 - 1')).toBe(-1)
		// Several modifiers are one modifier: `d20 + 2 + 3` is `d20 + 5`.
		expect(modifier('d20 + 2 + 3')).toBe(5)
		expect(modifier('d20 + 5 - 2')).toBe(3)
		expect(modifier('d20')).toBe(0)
	})

	it('does not care where the modifier sits', () => {
		expect(modifier('10 + 2d20')).toBe(10)
		expect(counts('10 + 2d20')).toEqual([['d20', 2]])
	})

	it('refuses to subtract dice, which it cannot throw', () => {
		const parsed = parseNotation('2d6 - 1d4')
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.error).toContain('cannot be subtracted')
	})

	it('refuses a modifier with no dice', () => {
		// `+5` is arithmetic, not a roll, and there would be nothing to throw on the board.
		const parsed = parseNotation('5')
		expect(parsed.ok).toBe(false)
		if (parsed.ok) return
		expect(parsed.error).toContain('no dice')
	})

	it('round-trips a modifier through its own formatting', () => {
		const written = formatNotation(new Map([['d20', 2]]), 10)
		expect(written).toBe('2d20 + 10')
		expect(modifier(written.replace('−', '-'))).toBe(10)
		expect(formatNotation(new Map([['d6', 1]]), -2)).toBe('1d6 − 2')
	})

	it('refuses what is not notation', () => {
		for (const input of ['', '   ', 'd', '2d', 'six', '2d6 +', '2 d 6', 'd6*2', 'd20 +', '2d6 + d']) {
			expect(parseNotation(input).ok, input).toBe(false)
		}
	})

	it('refuses an explicit zero rather than reading it as one', () => {
		expect(parseNotation('0d6').ok).toBe(false)
	})

	it('accepts a leading plus, which means nothing and costs nothing', () => {
		expect(counts('+2d6')).toEqual([['d6', 2]])
	})
})

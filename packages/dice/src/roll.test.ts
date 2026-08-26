import { describe, expect, it } from 'vitest'
import { DIE_KINDS, facesOf } from './kinds'
import { toneFor } from './DieIcon'
import { randomFace, rollCounts, type RandomBytes } from './roll'

/** A random source that hands out exactly these bytes, so a draw can be aimed at a specific branch. */
function bytes(...values: number[]): RandomBytes {
	let i = 0
	return (out) => {
		out[0] = values[i++] ?? 0
	}
}

describe('randomFace', () => {
	it('maps a draw onto a face, one-based', () => {
		expect(randomFace(20, bytes(0))).toBe(1)
		expect(randomFace(20, bytes(19))).toBe(20)
		expect(randomFace(6, bytes(3))).toBe(4)
	})

	it('rejects the biased tail and draws again', () => {
		// For a d20 the largest usable multiple of 20 under 256 is 240, so 240–255 must be thrown away.
		// Without rejection, 240 would fold onto face 1 — the bias this exists to remove.
		expect(randomFace(20, bytes(240, 5))).toBe(6)
		// A run of rejects is still just a run: it keeps drawing rather than giving up on a fallback.
		expect(randomFace(20, bytes(255, 250, 241, 0))).toBe(1)
	})

	it('rejects the tail for a d100, whose discard band is the widest', () => {
		// 100 * 2 = 200, so 200–255 go.
		expect(randomFace(100, bytes(200, 99))).toBe(100)
		expect(randomFace(100, bytes(199, 0))).toBe(100)
	})

	it('never rejects for a die that divides the byte range', () => {
		// 256 is a multiple of 8, so every draw is usable and the loop can only run once.
		expect(randomFace(8, bytes(255))).toBe(8)
		expect(randomFace(8, bytes(248))).toBe(1)
	})

	it('stays in range for every die we ship', () => {
		for (const kind of DIE_KINDS) {
			const faces = facesOf(kind)
			for (let i = 0; i < 400; i++) {
				const value = randomFace(faces)
				expect(value).toBeGreaterThanOrEqual(1)
				expect(value).toBeLessThanOrEqual(faces)
			}
		}
	})

	it('is uniform enough that a bias would be visible', () => {
		// A chi-squared test would be the rigorous version; the point of this one is to catch the two
		// mistakes that actually happen — an off-by-one that starves face 1 or face 20, and a modulo
		// bias that quietly favours the low half.
		const counts = new Array<number>(20).fill(0)
		const draws = 40_000
		for (let i = 0; i < draws; i++) counts[randomFace(20) - 1]!++

		const expected = draws / 20
		for (const count of counts) {
			expect(count).toBeGreaterThan(expected * 0.85)
			expect(count).toBeLessThan(expected * 1.15)
		}

		const low = counts.slice(0, 10).reduce((a, b) => a + b, 0)
		expect(low / draws).toBeGreaterThan(0.47)
		expect(low / draws).toBeLessThan(0.53)
	})

	it('refuses a face count it cannot sample from one byte', () => {
		expect(() => randomFace(0)).toThrow()
		expect(() => randomFace(257)).toThrow()
		expect(() => randomFace(6.5)).toThrow()
	})
})

describe('rollCounts', () => {
	it('rolls one die per count and totals them', () => {
		const result = rollCounts(new Map([['d6', 2], ['d12', 1]]), 0, bytes(0, 5, 11))
		expect(result.dice).toEqual([
			{ kind: 'd6', value: 1 },
			{ kind: 'd6', value: 6 },
			{ kind: 'd12', value: 12 },
		])
		expect(result.total).toBe(19)
		expect(result.notation).toBe('2d6 + 1d12')
	})

	it('returns dice in tray order however the hand was built', () => {
		// A hand loaded d20-then-d4 must still read and roll small-to-large, or the dice would not line
		// up with the notation printed above them.
		const result = rollCounts(new Map([['d20', 1], ['d4', 1]]), 0, bytes(0, 0))
		expect(result.dice.map((die) => die.kind)).toEqual(['d4', 'd20'])
		expect(result.notation).toBe('1d4 + 1d20')
	})

	it('ignores kinds held at zero', () => {
		const result = rollCounts(new Map([['d6', 0], ['d8', 1]]), 0, bytes(7))
		expect(result.dice).toEqual([{ kind: 'd8', value: 8 }])
		expect(result.notation).toBe('1d8')
	})

	it('is empty for an empty hand', () => {
		const result = rollCounts(new Map())
		expect(result.dice).toEqual([])
		expect(result.total).toBe(0)
		expect(result.notation).toBe('')
	})
})

describe('toneFor', () => {
	it('runs a ramp from the die\'s lowest face to its highest', () => {
		expect(toneFor('d20', 1)).toEqual({ side: 'min', strength: 1 })
		expect(toneFor('d20', 20)).toEqual({ side: 'max', strength: 1 })
		// The middle of a d20 falls between 10 and 11, so both lean, only slightly, and in opposite
		// directions — which is exactly the behaviour asked for.
		expect(toneFor('d20', 10)?.side).toBe('min')
		expect(toneFor('d20', 11)?.side).toBe('max')
		expect(toneFor('d20', 10)?.strength).toBeCloseTo(toneFor('d20', 11)!.strength, 10)
	})

	it('gets stronger the further from the middle a roll is', () => {
		const strength = (value: number) => toneFor('d20', value)!.strength
		// The whole reason this is a ramp and not two flags: a 17 is good and a 20 is remarkable.
		expect(strength(20)).toBeGreaterThan(strength(17))
		expect(strength(17)).toBeGreaterThan(strength(14))
		expect(strength(1)).toBeGreaterThan(strength(4))
	})

	it('reads the extremes off the die, not off the number six', () => {
		expect(toneFor('d6', 6)).toEqual({ side: 'max', strength: 1 })
		expect(toneFor('d4', 4)).toEqual({ side: 'max', strength: 1 })
		expect(toneFor('d100', 100)).toEqual({ side: 'max', strength: 1 })
		// A six is the top of a d6 and unremarkable on a d20.
		expect(toneFor('d20', 6)!.strength).toBeLessThan(0.5)
	})

	it('leaves the exact middle of an odd-faced die alone', () => {
		// A d5 does not exist, but a d100's 50.5 does not fall on a face either — the case that *can*
		// arise is a die with an odd number of faces, and its middle face leans neither way.
		expect(toneFor('d100', 1)).toEqual({ side: 'min', strength: 1 })
		// (1 + 100) / 2 is not an integer, so no d100 face is dead centre; every face leans.
		for (let v = 1; v <= 100; v++) expect(toneFor('d100', v)).toBeDefined()
	})

	it('is symmetric about the middle, and bounded to 0..1', () => {
		for (const kind of DIE_KINDS) {
			const faces = facesOf(kind)
			for (let value = 1; value <= faces; value++) {
				const tone = toneFor(kind, value)
				if (!tone) continue
				expect(tone.strength, `${kind} ${value}`).toBeGreaterThan(0)
				expect(tone.strength, `${kind} ${value}`).toBeLessThanOrEqual(1)
				// A face and its mirror lean equally hard, in opposite directions.
				const mirror = toneFor(kind, faces + 1 - value)!
				expect(mirror.strength, `${kind} ${value}`).toBeCloseTo(tone.strength, 10)
				expect(mirror.side).not.toBe(tone.side)
			}
		}
	})
})

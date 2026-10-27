import { describe, expect, it } from 'vitest'
import { PILE_DEPTH, RISE, riseOf, slotStyle } from './pile'

describe('the pile', () => {
	it('climbs by ever smaller strips and never past its rise', () => {
		let last = 0
		let lastStrip = Infinity
		for (let k = 1; k <= PILE_DEPTH + 1; k++) {
			const strip = riseOf(k) - riseOf(k - 1)
			expect(strip).toBeGreaterThan(0)
			expect(strip).toBeLessThan(lastStrip)
			expect(riseOf(k)).toBeLessThan(RISE)
			lastStrip = strip
			last = riseOf(k)
		}
		expect(last).toBeGreaterThan(RISE * 0.9)
	})

	it('shows more than three cards behind, and numbers only on the strips with room for one', () => {
		const seen = Array.from({ length: PILE_DEPTH + 2 }, (_, k) => slotStyle(k)).filter((s) => s.opacity === 1)
		expect(seen.length).toBeGreaterThan(4)
		const numbered = Array.from({ length: PILE_DEPTH }, (_, k) => (slotStyle(k + 1) as Record<string, unknown>)['--zs-id'])
		expect(numbered.slice(0, 2)).toEqual([1, 1])
		expect(numbered.at(-1)).toBe(0)
	})

	it('has the same list of transforms in every slot, so a flip interpolates', () => {
		const shape = (slot: number) => String(slotStyle(slot).transform).replace(/-?[\d.]+/g, '#')
		for (const slot of [-1, 1, 5, PILE_DEPTH + 3]) expect(shape(slot)).toBe(shape(0))
	})
})

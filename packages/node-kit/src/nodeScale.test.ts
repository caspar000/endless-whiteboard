import { describe, expect, it } from 'vitest'
import { MAX_NODE_SCALE, MIN_NODE_SCALE, SCALE_META_KEY, nodeScale, scaleStep } from './nodeScale'

describe('nodeScale', () => {
	it('is 1 for a node that was never scaled, as every node from before is', () => {
		expect(nodeScale({ meta: {} })).toBe(1)
		expect(nodeScale({})).toBe(1)
	})

	it('reads the scale a Shift-drag stored', () => {
		expect(nodeScale({ meta: { [SCALE_META_KEY]: 1.5 } })).toBe(1.5)
	})

	it('treats anything unreadable as 1 rather than drawing a node at zero or NaN', () => {
		for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, '2', null]) {
			expect(nodeScale({ meta: { [SCALE_META_KEY]: bad } })).toBe(1)
		}
	})
})

describe('scaleStep', () => {
	it('grows the scale by the drag, and the box by the same factor', () => {
		expect(scaleStep(1, 2, 2)).toEqual({ scale: 2, factor: 2 })
		expect(scaleStep(2, 0.5, 0.5)).toEqual({ scale: 1, factor: 0.5 })
	})

	it('takes the smaller axis, so a node never ends bigger than the drag', () => {
		expect(scaleStep(1, 3, 2).scale).toBe(2)
	})

	it('ignores which way the drag went: past the edge is a size, not a mirror', () => {
		expect(scaleStep(1, -2, -2)).toEqual({ scale: 2, factor: 2 })
	})

	it('holds the scale within bounds, and the box with it', () => {
		const big = scaleStep(4, 10, 10)
		expect(big.scale).toBe(MAX_NODE_SCALE)
		expect(big.factor).toBeCloseTo(MAX_NODE_SCALE / 4)
		const small = scaleStep(0.5, 0, 0)
		expect(small.scale).toBe(MIN_NODE_SCALE)
		expect(small.factor).toBeCloseTo(MIN_NODE_SCALE / 0.5)
	})
})

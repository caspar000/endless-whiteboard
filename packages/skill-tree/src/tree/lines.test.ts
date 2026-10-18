import { describe, expect, it } from 'vitest'
import { arcBend, lineEnds } from './lines'

describe('lineEnds', () => {
	it("gives a skill node a spoke to each entry and chains each entry's works in order", () => {
		const items = [
			['homer', { parent: 'epic', variant: 'entry' }],
			['iliad', { parent: 'homer', variant: 'work' }],
			['odyssey', { parent: 'homer', variant: 'work' }],
			['virgil', { parent: 'epic', variant: 'entry' }],
			['aeneid', { parent: 'virgil', variant: 'work' }],
		] as const
		expect(lineEnds(items)).toEqual([
			{ from: 'epic', to: 'item:homer' },
			{ from: 'item:homer', to: 'item:iliad' },
			{ from: 'item:iliad', to: 'item:odyssey' },
			{ from: 'epic', to: 'item:virgil' },
			{ from: 'item:virgil', to: 'item:aeneid' },
		])
	})
})

describe('arcBend', () => {
	const centre = { x: 0, y: 0 }
	// The canvas's middle point for a bend: the chord's middle plus per(u) × −bend, per(u) = (u.y, −u.x).
	const middle = (a: { x: number; y: number }, b: { x: number; y: number }, bend: number) => {
		const len = Math.hypot(b.x - a.x, b.y - a.y)
		const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
		return { x: (a.x + b.x) / 2 - bend * u.y, y: (a.y + b.y) / 2 + bend * u.x }
	}

	it('bends a line between two works the same distance out onto the circle through them, away from the entry', () => {
		const a = { x: 100, y: 0 }
		const b = { x: 0, y: 100 }
		for (const [from, to] of [[a, b], [b, a]] as const) {
			const m = middle(from, to, arcBend(from, to, centre))
			expect(Math.hypot(m.x, m.y)).toBeCloseTo(100, 5)
		}
	})

	it('leaves a step out to the next arc straight', () => {
		expect(arcBend({ x: 100, y: 0 }, { x: 0, y: 220 }, centre)).toBe(0)
	})
})

import { describe, expect, it } from 'vitest'
import { OUTLINE_BOX, dieOutline } from './dieOutline'
import { DIE_KINDS } from './kinds'

/**
 * The icons, checked as *projections* rather than as strings.
 *
 * None of these tests know what the paths say — they check the properties a drawing of a convex solid
 * has to have. That is what makes them worth having: the paths are generated, so asserting their text
 * would only pin the generator to itself.
 */
describe('dieOutline', () => {
	const numbers = (path: string) => [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))

	it('draws a closed silhouette for every die', () => {
		for (const kind of DIE_KINDS) {
			const { silhouette } = dieOutline(kind)
			expect(silhouette, kind).toMatch(/^M/)
			// Closed, so `stroke-linejoin` can join the corners instead of them butting together.
			expect(silhouette, kind).toMatch(/Z$/)
		}
	})

	it('shows interior creases, so the icon reads as a solid rather than an outline', () => {
		// The whole point of projecting rather than drawing a silhouette: a d8 and a d10 are both "a
		// diamond" in outline, and it is the facets that tell them apart.
		for (const kind of DIE_KINDS) {
			expect(dieOutline(kind).creases, kind).not.toBe('')
		}
	})

	it('keeps every point inside the box, with room for a stroke', () => {
		for (const kind of DIE_KINDS) {
			const { silhouette, creases } = dieOutline(kind)
			for (const value of [...numbers(silhouette), ...numbers(creases)]) {
				expect(value, kind).toBeGreaterThanOrEqual(0)
				expect(value, kind).toBeLessThanOrEqual(OUTLINE_BOX)
			}
		}
	})

	it('fills the box, so the dice are the same visual weight as each other', () => {
		// Each is scaled to its own projected radius, so they should all reach about as far.
		for (const kind of DIE_KINDS) {
			const values = numbers(dieOutline(kind).silhouette)
			const reach = Math.max(...values.map((v) => Math.abs(v - OUTLINE_BOX / 2)))
			expect(reach, kind).toBeGreaterThan(OUTLINE_BOX * 0.4)
			expect(reach, kind).toBeLessThanOrEqual(OUTLINE_BOX / 2)
		}
	})

	it('gives the cube a corner view, because face-on it is just a square', () => {
		// A cube looked at down a face normal has no visible interior edges at all. The isometric view is
		// the one that reads as a die.
		const cube = dieOutline('d6')
		// Three visible faces meeting at the near corner: three creases.
		expect(cube.creases.match(/M/g)).toHaveLength(3)
	})

	it('gives the percentile die the d10 it is', () => {
		expect(dieOutline('d100')).toEqual(dieOutline('d10'))
	})

	it('walks the silhouette once, without doubling back', () => {
		/*
		 * The property that matters about the loop: a convex solid's silhouette is a simple polygon, so
		 * every point on it is visited exactly once. A walk that re-used an edge or stopped early would
		 * still produce a closed path — just the wrong one — and this is what tells them apart.
		 */
		for (const kind of DIE_KINDS) {
			const points = [...dieOutline(kind).silhouette.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
				(m) => `${m[1]},${m[2]}`
			)
			// The walk closes back onto its start, which `Z` then makes explicit — so the last point is the
			// first, and everything before it is visited once.
			expect(points.at(-1), kind).toBe(points[0])
			const walked = points.slice(0, -1)
			expect(new Set(walked).size, kind).toBe(walked.length)
			// A silhouette needs at least a triangle.
			expect(walked.length, kind).toBeGreaterThanOrEqual(3)
		}
	})
})

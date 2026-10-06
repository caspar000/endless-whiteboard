import { Box2d } from '../../../../primitives/Box2d'
import { ElbowEnd, getElbowArrowPath, routeElbow } from './elbow-arrow'

/** A shape's end of an arrow, aiming at its centre, as an unanchored binding does. */
const boxEnd = (x: number, y: number, gap = 0, w = 120, h = 80): ElbowEnd => ({
	box: new Box2d(x, y, w, h),
	point: { x: x + w / 2, y: y + h / 2 },
	gap,
})
const free = (x: number, y: number): ElbowEnd => ({ point: { x, y }, gap: 0 })
const route = (a: ElbowEnd, b: ElbowEnd, m = 0.5) => routeElbow(a, b, m).points.map((p) => [p.x, p.y])

// The end gap tldraw 5 leaves for a medium arrowhead at a medium shape: 10 + 1.75 + 1.75.
const GAP = 13.5

describe('routeElbow', () => {
	// Each case is one tldraw 5 drew (measured from its rendering); the routes match it.
	it('crosses the gap between shapes side by side in a Z, its middle run halfway', () => {
		expect(route(boxEnd(0, 0), boxEnd(300, 150, GAP))).toEqual([[120, 40], [210, 40], [210, 190], [286.5, 190]])
		expect(route(boxEnd(1100, 520), boxEnd(900, 400, GAP))).toEqual([[1100, 560], [1060, 560], [1060, 440], [1033.5, 440]])
	})

	it('goes straight between shapes in line', () => {
		expect(route(boxEnd(600, 0), boxEnd(600, 200, GAP))).toEqual([[660, 80], [660, 186.5]])
		expect(route(boxEnd(0, 400), boxEnd(300, 400, GAP))).toEqual([[120, 440], [286.5, 440]])
	})

	it('turns once when that is shorter', () => {
		expect(route(boxEnd(1000, 0), boxEnd(850, 180, GAP))).toEqual([[1000, 40], [910, 40], [910, 166.5]])
	})

	it('runs down and across between shapes that overlap sideways, its arrowhead gap giving way', () => {
		expect(route(boxEnd(600, 400), boxEnd(650, 520, GAP))).toEqual([[660, 480], [660, 500], [710, 500], [710, 514]])
	})

	it('turns a free arrow along its longer side, at the midpoint it is given', () => {
		expect(route(free(0, 0), free(300, 150))).toEqual([[0, 0], [150, 0], [150, 150], [300, 150]])
		expect(route(free(0, 0), free(300, 150), 0.2)).toEqual([[0, 0], [60, 0], [60, 150], [300, 150]])
		expect(route(free(0, 0), free(150, 300))).toEqual([[0, 0], [0, 150], [150, 150], [150, 300]])
		expect(routeElbow(free(0, 0), free(300, 150), 0.5).mid).toEqual({ axis: 'x', from: 0, to: 300 })
	})

	it('goes around rather than through a shape', () => {
		// The end shape is behind the start: no route out of the start's right side is clean.
		const points = routeElbow(boxEnd(400, 0), boxEnd(0, 0, GAP), 0.5).points
		const through = (box: Box2d) =>
			points.some((p, i) => {
				const q = points[i + 1]
				if (!q) return false
				const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
				return mid.x > box.minX + 1 && mid.x < box.maxX - 1 && mid.y > box.minY + 1 && mid.y < box.maxY - 1
			})
		expect(through(new Box2d(400, 0, 120, 80))).toBe(false)
		expect(through(new Box2d(0, 0, 120, 80))).toBe(false)
		for (let i = 1; i < points.length; i++) {
			// Every run is across or down.
			expect(points[i]!.x === points[i - 1]!.x || points[i]!.y === points[i - 1]!.y).toBe(true)
		}
	})

	it('rounds its corners', () => {
		expect(getElbowArrowPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 7)).toBe(
			'M0,0L93,0Q100,0 100,7L100,100'
		)
	})
})

import { describe, expect, it } from 'vitest'
import { fitCamera, readingOrder } from './quickLook'

const box = (id: string, x: number, y: number, w = 100, h = 100) => ({ id, x, y, w, h })
const ids = (boxes: { id: string }[]) => boxes.map((b) => b.id)

describe('readingOrder', () => {
	it('reads rows top to bottom and left to right', () => {
		const order = readingOrder([
			box('d', 200, 300),
			box('b', 200, 0),
			box('c', 0, 300),
			box('a', 0, 0),
		])
		expect(ids(order)).toEqual(['a', 'b', 'c', 'd'])
	})

	it('keeps a slightly lower neighbour in the same row', () => {
		// `b` starts 40px lower, but its centre is still above `a`'s bottom edge.
		expect(ids(readingOrder([box('b', 200, 40), box('a', 0, 0)]))).toEqual(['a', 'b'])
	})

	it('starts a new row once a box sits mostly below the row', () => {
		expect(ids(readingOrder([box('a', 200, 0), box('b', 0, 80)]))).toEqual(['a', 'b'])
	})
})

describe('fitCamera', () => {
	const viewport = { w: 1000, h: 800 }

	it('fills the viewport by the binding axis and centres the box', () => {
		const camera = fitCamera(box('a', 0, 0, 200, 100), viewport, { fill: 0.8, maxZoom: null }, 8)
		expect(camera.z).toBe(4) // 1000 * 0.8 / 200
		// The box's centre lands on the viewport's centre.
		expect((100 + camera.x) * camera.z).toBeCloseTo(500)
		expect((50 + camera.y) * camera.z).toBeCloseTo(400)
	})

	it("caps at the preset's zoom", () => {
		expect(fitCamera(box('a', 0, 0, 50, 50), viewport, { fill: 0.8, maxZoom: 2.5 }, 8).z).toBe(2.5)
	})

	it("never passes the canvas's own limit", () => {
		expect(fitCamera(box('a', 0, 0, 10, 10), viewport, { fill: 0.8, maxZoom: null }, 8).z).toBe(8)
	})
})

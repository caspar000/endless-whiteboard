import { decodeSegments, encodeSegments } from './segments'

describe('stroke segments', () => {
	const points = [
		{ x: 0, y: 0, z: 0.5 },
		{ x: 10.25, y: -4.5, z: 0.6 },
		{ x: 30, y: 12, z: 0.5 },
	]

	it('round-trips points through the stored path', () => {
		const back = decodeSegments({ segments: encodeSegments([{ type: 'free', points }]) })
		expect(back[0]!.type).toBe('free')
		back[0]!.points.forEach((p, i) => {
			expect(p.x).toBeCloseTo(points[i]!.x, 1)
			expect(p.y).toBeCloseTo(points[i]!.y, 1)
		})
	})

	it('applies the stroke scale on read and removes it on write', () => {
		const segments = encodeSegments([{ type: 'free', points }], { scaleX: 2, scaleY: 3 })
		const back = decodeSegments({ segments, scaleX: 2, scaleY: 3 })
		expect(back[0]!.points[1]!.x).toBeCloseTo(10.25, 1)
		expect(decodeSegments({ segments })[0]!.points[1]!.x).toBeCloseTo(10.25 / 2, 1)
	})

	it('stores strokes without pressure in two dimensions, and reads them back', () => {
		const flat = points.map((p) => ({ ...p, z: 0.5 }))
		const [segment] = encodeSegments([{ type: 'free', points: flat }])
		expect(segment!.dim).toBe(2)
		const back = decodeSegments({ segments: [segment!] })[0]!.points
		expect(back.map((p) => p.z)).toEqual([0.5, 0.5, 0.5])
		expect(back[2]!.x).toBeCloseTo(30, 1)
		expect(encodeSegments([{ type: 'free', points }])[0]!.dim).toBe(3)
	})
})

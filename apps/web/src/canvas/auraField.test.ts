import { describe, expect, it } from 'vitest'
import {
	auraLoops,
	cellSizeFor,
	sdCapsule,
	sdRoundRect,
	smin,
	type FieldBox,
	type FieldCapsule,
} from './auraField'

const box = (x: number, y: number, w = 120, h = 80): FieldBox => ({ x, y, w, h, r: 20 })

/** Shapes with no relations in them — what most of these tests are about. */
const nodes = (boxes: FieldBox[]) => ({ boxes, capsules: [] })

describe('sdRoundRect', () => {
	const B = box(100, 100, 200, 100)

	it('is negative inside, positive outside, and zero on the edge', () => {
		expect(sdRoundRect(200, 150, B)).toBeLessThan(0)
		expect(sdRoundRect(400, 150, B)).toBeGreaterThan(0)
		expect(Math.abs(sdRoundRect(100, 150, B))).toBeLessThan(0.001)
	})

	it('measures the real distance straight out from a face', () => {
		// 40 to the left of the left edge.
		expect(sdRoundRect(60, 150, B)).toBeCloseTo(40)
		// And below the bottom edge.
		expect(sdRoundRect(200, 225, B)).toBeCloseTo(25)
	})

	it('rounds the corners, so the aura turns rather than coming to a point', () => {
		/*
		 * Diagonally out from a corner, the rounded box reads *further* than the square one — the radius
		 * takes material away from the corner, so the nearest point on the shape has retreated. That is
		 * exactly why the contour comes out rounded there: the iso-line follows an arc centred on the
		 * corner's centre of curvature instead of turning a right angle.
		 */
		const square = { ...B, r: 0 }
		const at = { x: B.x - 30, y: B.y - 30 }
		expect(sdRoundRect(at.x, at.y, B)).toBeGreaterThan(sdRoundRect(at.x, at.y, square))
		// And straight out from a face the radius makes no difference at all.
		expect(sdRoundRect(B.x - 30, B.y + 50, B)).toBeCloseTo(sdRoundRect(B.x - 30, B.y + 50, square))
	})
})

describe('smin', () => {
	it('is exactly Math.min when the blend is off, so "no merging" needs no special case', () => {
		expect(smin(12, 30, 0)).toBe(12)
		expect(smin(30, 12, 0)).toBe(12)
	})

	it('dips below both values where they are close — the waist between two shapes', () => {
		// This is what fuses two outlines: near the midpoint of a gap both distances are similar, and
		// the blend pulls the field below either of them, so the contour bulges out to meet itself.
		expect(smin(20, 22, 40)).toBeLessThan(20)
	})

	it('leaves a lone shape alone', () => {
		// Far apart, the blend contributes nothing, so one shape's field is its own exact distance.
		expect(smin(10, 400, 40)).toBe(10)
	})
})

describe('cellSizeFor', () => {
	it('holds the sample count roughly constant, and clamps at both ends', () => {
		expect(cellSizeFor(200, 150)).toBe(5)
		expect(cellSizeFor(8000, 6000)).toBe(16)
		const middling = cellSizeFor(1200, 800)
		expect(middling).toBeGreaterThan(5)
		expect(middling).toBeLessThan(16)
	})
})

describe('auraLoops', () => {
	const OFFSET = 19
	const MERGE = 40

	it('draws one closed loop around one shape', () => {
		const loops = auraLoops(nodes([box(200, 200)]), OFFSET, MERGE, 40)
		expect(loops).toHaveLength(1)
		expect(loops[0]!.length).toBeGreaterThan(20)
	})

	it('runs at the offset distance from the shape', () => {
		const b = box(200, 200, 200, 120)
		const loop = auraLoops(nodes([b]), OFFSET, MERGE, 40)[0]!
		for (const point of loop) {
			// Every point of the contour is where the distance field equals the offset, so this is really
			// a test that the marching-squares interpolation lands on the iso-line.
			expect(Math.abs(sdRoundRect(point.x, point.y, b) - OFFSET)).toBeLessThan(1.5)
		}
	})

	it('points its normals away from the shape', () => {
		const b = box(200, 200, 200, 120)
		const loop = auraLoops(nodes([b]), OFFSET, MERGE, 40)[0]!
		// The leftmost point of the loop is directly out from the left face, so "away" is -x.
		const leftmost = loop.reduce((best, point) => (point.x < best.x ? point : best), loop[0]!)
		expect(leftmost.nx).toBeLessThan(-0.9)
		expect(Math.abs(leftmost.ny)).toBeLessThan(0.3)
	})

	it('keeps two distant shapes apart', () => {
		// Far enough that nothing should join: two shapes, two outlines.
		const loops = auraLoops(nodes([box(100, 100), box(900, 100)]), OFFSET, MERGE, 40)
		expect(loops).toHaveLength(2)
	})

	it('fuses two shapes brought close together — the whole point', () => {
		// A 30px gap, well inside the blend width: one outline around both, with a waist between them.
		const loops = auraLoops(nodes([box(100, 100), box(250, 100)]), OFFSET, MERGE, 40)
		expect(loops).toHaveLength(1)
	})

	it('fuses more eagerly the wider the blend', () => {
		/*
		 * The same pair at a 60px gap, which a hard union leaves alone and a wide blend joins — so
		 * `merge` is a dial rather than a switch.
		 *
		 * The arithmetic, because it is the useful thing to know when setting the dial: halfway across a
		 * gap of `g` both shapes are `g/2` away, and the blend pulls the field down by `merge/4` there.
		 * They fuse when that lands inside the offset — `g/2 - merge/4 <= offset`.
		 */
		const pair = [box(100, 100), box(280, 100)]
		expect(auraLoops(nodes(pair), OFFSET, 0, 40)).toHaveLength(2)
		expect(auraLoops(nodes(pair), OFFSET, 110, 40)).toHaveLength(1)
	})

	it('encloses a gap as a hole rather than filling it in', () => {
		// Four shapes in a closed frame: the contour comes back as an outer loop *and* an inner one, and
		// drawing both in one path with `evenodd` is what makes the middle read as a hole.
		const frame = [
			box(100, 100, 300, 50),
			box(100, 350, 300, 50),
			box(100, 100, 50, 300),
			box(350, 100, 50, 300),
		]
		const loops = auraLoops(nodes(frame), OFFSET, MERGE, 40)
		expect(loops.length).toBeGreaterThanOrEqual(2)
	})

	it('draws nothing for nothing', () => {
		expect(auraLoops(nodes([]), OFFSET, MERGE, 40)).toEqual([])
	})
})

describe('sdCapsule', () => {
	const LINE: FieldCapsule = { ax: 100, ay: 100, bx: 300, by: 100, r: 6 }

	it('measures from the line, less the radius', () => {
		// 40 above the middle of the segment, minus the 6 of thickness.
		expect(sdCapsule(200, 60, LINE)).toBeCloseTo(34)
		// On the line itself, inside by the radius.
		expect(sdCapsule(200, 100, LINE)).toBeCloseTo(-6)
	})

	it('caps the ends rather than running on forever', () => {
		// Past the end, the nearest point is the endpoint — so distance is radial, not perpendicular.
		expect(sdCapsule(340, 100, LINE)).toBeCloseTo(34)
		expect(sdCapsule(300 + 30, 100 + 40, LINE)).toBeCloseTo(50 - 6)
	})

	it('treats a zero-length relation as a circle instead of dividing by zero', () => {
		const point: FieldCapsule = { ax: 50, ay: 50, bx: 50, by: 50, r: 10 }
		expect(sdCapsule(80, 50, point)).toBeCloseTo(20)
	})
})

describe('relations in the field', () => {
	const OFFSET = 19
	const MERGE = 40
	const RIBBON = 6

	/** Two shapes far enough apart that only a relation could join them. */
	const FAR = [box(100, 100), box(700, 100)]
	const relation = (r = RIBBON): FieldCapsule => ({ ax: 220, ay: 140, bx: 700, by: 140, r })

	it('joins the shapes at its ends into one envelope', () => {
		// Apart, they are two outlines…
		expect(auraLoops(nodes(FAR), OFFSET, MERGE, 40)).toHaveLength(2)
		// …and with the relation in the field, one, with a ribbon running between them. This is the whole
		// of request #4: the arrow is part of the shape being drawn round, not a line drawn beside it.
		const joined = auraLoops({ boxes: FAR, capsules: [relation()] }, OFFSET, MERGE, 40)
		expect(joined).toHaveLength(1)
	})

	it('stands the outline off the line, which is what it is for', () => {
		const capsule = relation()
		const loop = auraLoops({ boxes: [], capsules: [capsule] }, OFFSET, MERGE, 40)[0]!
		// Beside the middle of the run, the nearest the outline comes to the line is the ribbon's radius
		// plus the offset — never *on* it, which is where the first version drew it and lost it under the
		// arrow's own stroke.
		const beside = loop.filter((point) => point.x > 400 && point.x < 500)
		expect(beside.length).toBeGreaterThan(0)
		for (const point of beside) {
			expect(Math.abs(point.y - capsule.ay)).toBeGreaterThan(RIBBON + OFFSET - 2)
		}
	})

	it('widens with the ribbon', () => {
		const width = (r: number) => {
			const loop = auraLoops({ boxes: [], capsules: [relation(r)] }, OFFSET, MERGE, 60)[0]!
			const ys = loop.filter((p) => p.x > 400 && p.x < 500).map((p) => p.y)
			return Math.max(...ys) - Math.min(...ys)
		}
		expect(width(20)).toBeGreaterThan(width(4) + 20)
	})
})

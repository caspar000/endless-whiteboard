import { createShapeId, dashPolylines, flattenPath, strokeTriangles, type GpuStroke, type TLArrowShape, type TLLineShape } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

// Strokes for the GPU layer (docs/gpu-renderer-plan.md, phase 3).

const length = (pts: number[]) => {
	let n = 0
	for (let i = 2; i + 1 < pts.length; i += 2) n += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!)
	return n
}

describe('flattening paths', () => {
	it('keeps lines as they are, and closes what Z closes', () => {
		expect(flattenPath('M0,0 L10,0 L10,10')).toEqual([{ points: [0, 0, 10, 0, 10, 10], closed: false }])
		expect(flattenPath('M0,0L10,0L10,10Z')[0]).toEqual({ points: [0, 0, 10, 0, 10, 10, 0, 0], closed: true })
	})

	it('reads relative commands as the page does', () => {
		expect(flattenPath('m5,5 l10,0 h5 v5 l-20,0')[0]!.points).toEqual([5, 5, 15, 5, 20, 5, 20, 10, 0, 10])
	})

	it('cuts curves and arcs finely: a half circle of radius 100 comes out its length, ending where it should', () => {
		const [arc] = flattenPath('M0,0 A100 100 0 0 1 200,0', 0.02)
		const p = arc!.points
		expect(length(p)).toBeCloseTo(Math.PI * 100, 0)
		expect(p.slice(-2)).toEqual([200, 0])
		// Every point on the circle round (100, 0).
		for (let i = 0; i < p.length; i += 2) expect(Math.hypot(p[i]! - 100, p[i + 1]!)).toBeCloseTo(100, 1)
		const [q] = flattenPath('M0,0 Q50,100 100,0')
		expect(q!.points.slice(-2)).toEqual([100, 0])
		expect(Math.max(...q!.points.filter((_, i) => i % 2))).toBeCloseTo(50, 0)
	})
})

describe('dashing', () => {
	it('lays the dash array along the line by length, from its offset', () => {
		const line = [{ points: [0, 0, 100, 0], closed: false }]
		const dashes = dashPolylines(line, [10, 10], 0)
		expect(dashes).toHaveLength(5)
		expect(dashes.map((d) => [d.points[0], d.points[d.points.length - 2]])).toEqual([
			[0, 10],
			[20, 30],
			[40, 50],
			[60, 70],
			[80, 90],
		])
		// 5 into the pattern: the first dash is half one.
		expect(dashPolylines(line, [10, 10], 5)[0]!.points.slice(0, 1).concat(dashPolylines(line, [10, 10], 5)[0]!.points.slice(-2, -1))).toEqual([0, 5])
	})

	it('carries a dash round a corner', () => {
		const dashes = dashPolylines([{ points: [0, 0, 5, 0, 5, 5], closed: false }], [8, 2], 0)
		expect(dashes[0]!.points).toEqual([0, 0, 5, 0, 5, 3])
	})
})

describe('strip building', () => {
	it('makes a straight stroke a strip with two round caps, offsets at most 1 across', () => {
		const v = strokeTriangles([{ points: [0, 0, 100, 0], closed: false }])
		expect(v.length % 12).toBe(0)
		for (let i = 0; i < v.length; i += 4) expect(Math.hypot(v[i + 2]!, v[i + 3]!)).toBeLessThan(1.05)
		// The strip's two triangles plus two half-circle fans.
		expect(v.length / 12).toBe(2 + 2 * 12)
	})

	it('makes a dot of a dash with no length', () => {
		const v = strokeTriangles([{ points: [5, 5, 5, 5], closed: false }])
		expect(v.length / 12).toBe(24)
	})
})

describe('arrows and lines on the GPU', () => {
	let editor: TestEditor
	beforeEach(() => {
		editor = new TestEditor()
	})
	const gpu = (id: string) => {
		const shape = editor.getShape(id as never)!
		return editor.getShapeUtil(shape).toGpu!(shape, { isDarkMode: false })
	}

	it('draws an arrow as its halo, its body and its heads', () => {
		const id = createShapeId('a')
		editor.createShapes<TLArrowShape>([{ id, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, arrowheadEnd: 'arrow', dash: 'dashed' } }])
		const prims = gpu(id)! as GpuStroke[]
		expect(prims.map((p) => [p.halo ?? false, !!p.dash])).toEqual([
			[true, true],
			[true, false],
			[false, true],
			[false, false],
		])
	})

	it('draws no halo for an arrow kept behind', () => {
		const id = createShapeId('a')
		editor.createShapes<TLArrowShape>([{ id, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, arrowheadEnd: 'none' }, meta: { 'lifeboard:arrowStaysBehind': true } }])
		expect((gpu(id) as GpuStroke[]).every((p) => !p.halo)).toBe(true)
	})

	it('leaves to the page an arrow with a label, or with a head that cuts the line', () => {
		const a = createShapeId('a')
		const b = createShapeId('b')
		editor.createShapes<TLArrowShape>([
			{ id: a, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] } } },
			{ id: b, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, arrowheadEnd: 'triangle' } },
		])
		expect(gpu(a)).toBeNull()
		expect(gpu(b)).toBeNull()
	})

	it('draws a line, each dashed segment with its own dash, and leaves the hand-drawn one to the page', () => {
		const id = createShapeId('l')
		editor.createShapes<TLLineShape>([
			{
				id,
				type: 'line',
				x: 0,
				y: 0,
				props: {
					dash: 'dashed',
					points: {
						a1: { id: 'a1', index: 'a1' as never, x: 0, y: 0 },
						a2: { id: 'a2', index: 'a2' as never, x: 100, y: 0 },
						a3: { id: 'a3', index: 'a3' as never, x: 100, y: 100 },
					},
				},
			},
		])
		const prims = gpu(id) as GpuStroke[]
		expect(prims).toHaveLength(2)
		expect(prims.every((p) => !!p.dash)).toBe(true)
		editor.updateShape<TLLineShape>({ id, type: 'line', props: { dash: 'draw' } })
		expect(gpu(id)).toBeNull()
	})
})

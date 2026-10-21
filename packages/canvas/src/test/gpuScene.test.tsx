import { BaseBoxShapeUtil, T, createShapeId, getGpuScene, gpuColor, readGpuColor, setRendererMode, type GpuPrimitive, type RecordProps, type TLBaseShape, type TLLineShape } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

// The GPU scene (docs/gpu-renderer-plan.md, phase 1): which shapes the GPU layer draws, and their
// instance data in drawing order, kept from the store.

type BoxShape = TLBaseShape<'gpu-box', { w: number; h: number; draw: boolean }>
class BoxUtil extends BaseBoxShapeUtil<BoxShape> {
	static override type = 'gpu-box' as const
	static override props: RecordProps<BoxShape> = { w: T.nonZeroNumber, h: T.nonZeroNumber, draw: T.boolean }
	override getDefaultProps(): BoxShape['props'] {
		return { w: 100, h: 50, draw: true }
	}
	override canEdit() {
		return true
	}
	override component() {
		return null
	}
	override indicator() {
		return null
	}
	override toGpu(shape: BoxShape): GpuPrimitive[] | null {
		return shape.props.draw ? [{ kind: 'rect', x: 0, y: 0, w: shape.props.w, h: shape.props.h, fill: gpuColor('#ff0000') }] : null
	}
}

const FLOATS = 21
let editor: TestEditor
const a = createShapeId('a')
const b = createShapeId('b')
const geo = createShapeId('geo')

beforeEach(() => {
	editor = new TestEditor({ shapeUtils: [BoxUtil] })
	editor.createShapes([
		{ id: a, type: 'gpu-box', x: 10, y: 20 },
		{ id: b, type: 'gpu-box', x: 300, y: 0, opacity: 0.5 },
		{ id: geo, type: 'geo', x: 0, y: 200, props: { w: 100, h: 100 } },
	])
})

afterEach(() => setRendererMode('auto'))

const rects = () => {
	const f = getGpuScene(editor).frame.get()
	return { data: f.rects, count: f.rects.length / FLOATS, frame: f }
}
const up = () => getGpuScene(editor).layerUp.set(true)

describe('the GPU scene', () => {
	it('draws nothing until the renderer is gpu and the layer is up', () => {
		expect(rects().count).toBe(0)
		setRendererMode('gpu')
		expect(rects().count).toBe(0)
		up()
		expect(rects().count).toBe(2)
		expect(getGpuScene(editor).hidesElement(a)).toBe(true)
		// A type without `toGpu` stays the page's.
		expect(getGpuScene(editor).isDrawn(geo)).toBe(false)
	})

	it('keeps each rect in drawing order with its page transform and opacity', () => {
		setRendererMode('gpu')
		up()
		const { data } = rects()
		// a: identity rotation, at (10, 20), 100 × 50, opacity 1; b: opacity 0.5.
		expect([...data.slice(0, 10)]).toEqual([1, 0, 0, 1, 10, 20, 0, 0, 100, 50])
		expect(data[FLOATS - 1]).toBe(1)
		expect(data[FLOATS + 4]).toBe(300)
		expect(data[2 * FLOATS - 1]).toBe(0.5)
	})

	it('draws in z-order, not in the order of ids', () => {
		setRendererMode('gpu')
		up()
		editor.sendToBack([b])
		// b (x 300) is now under a (x 10): its rect comes first.
		expect(rects().data[4]).toBe(300)
		expect(rects().data[FLOATS + 4]).toBe(10)
	})

	it('follows a shape that moves, and recomputes only when something changes', () => {
		setRendererMode('gpu')
		up()
		const before = rects().frame
		expect(rects().frame).toBe(before)
		editor.updateShape({ id: a, type: 'gpu-box', x: 50 })
		expect(rects().frame).not.toBe(before)
		expect(rects().data[4]).toBe(50)
	})

	it('hands a shape back to the page while it is edited, when it draws nothing, and in compare', () => {
		setRendererMode('gpu')
		up()
		editor.setEditingShape(a)
		expect(getGpuScene(editor).isDrawn(a)).toBe(false)
		expect(rects().count).toBe(1)
		editor.setEditingShape(null)
		editor.updateShape({ id: b, type: 'gpu-box', props: { draw: false } })
		expect(rects().count).toBe(1)
		setRendererMode('compare')
		expect(getGpuScene(editor).isDrawn(a)).toBe(true)
		expect(getGpuScene(editor).hidesElement(a)).toBe(false)
	})

	it('gives everything back to the page when the layer goes down', () => {
		setRendererMode('gpu')
		up()
		getGpuScene(editor).layerUp.set(false)
		expect(rects().count).toBe(0)
		expect(getGpuScene(editor).hidesElement(a)).toBe(false)
	})
})

describe('the GPU scene, switching', () => {
	const many = (n: number, at = 0) =>
		editor.createShapes(Array.from({ length: n }, (_, i) => ({ id: createShapeId(`m${at + i}`), type: 'gpu-box' as const, x: (i % 10) * 20, y: Math.floor(i / 10) * 20, props: { w: 10, h: 10 } })))

	it('in auto, comes on above the budget of its shapes on screen and goes off only well below it', () => {
		setRendererMode('auto')
		const scene = getGpuScene(editor)
		scene.setBudget(10)
		expect(scene.onScreen.get()).toBe(2)
		expect(scene.wanted.get()).toBe(false)
		many(9)
		expect(scene.onScreen.get()).toBe(11)
		expect(scene.autoOn.get()).toBe(true)
		expect(scene.wanted.get()).toBe(true)
		// Back to 9: under the budget, but not under 70% of it, so it stays on.
		editor.deleteShapes([createShapeId('m0'), createShapeId('m1')])
		expect(scene.autoOn.get()).toBe(true)
		// Down to 6: off.
		editor.deleteShapes([createShapeId('m2'), createShapeId('m3'), createShapeId('m4')])
		expect(scene.autoOn.get()).toBe(false)
	})

	it('wants no layer for a board that is not on screen', () => {
		setRendererMode('gpu')
		const scene = getGpuScene(editor)
		expect(scene.wanted.get()).toBe(true)
		scene.shown.set(false)
		expect(scene.wanted.get()).toBe(false)
	})

	it('leaves to the page a shape under one the page draws that overlaps it, and only that', () => {
		setRendererMode('gpu')
		up()
		// The geo shape (page-drawn) sits at (0, 200)–(100, 300); one box under it, one beside it, one over it.
		const under = createShapeId('under')
		const beside = createShapeId('beside')
		editor.createShapes([
			{ id: under, type: 'gpu-box', x: 50, y: 250 },
			{ id: beside, type: 'gpu-box', x: 600, y: 250 },
		])
		editor.sendToBack([under])
		const over = createShapeId('over')
		editor.createShapes([{ id: over, type: 'gpu-box', x: 20, y: 220 }])
		const scene = getGpuScene(editor)
		expect(scene.isDrawn(under)).toBe(false)
		expect(scene.isDrawn(beside)).toBe(true)
		expect(scene.isDrawn(over)).toBe(true)
		// And a shape under *that* page-drawn box goes to the page as well.
		const lower = createShapeId('lower')
		editor.createShapes([{ id: lower, type: 'gpu-box', x: 120, y: 260 }])
		editor.sendToBack([lower])
		expect(scene.isDrawn(lower)).toBe(false)
	})
	it('goes by where a line runs, not its bounds: a page shape inside the bend of an L leaves it to the GPU', () => {
		setRendererMode('gpu')
		up()
		// Along y = 150 and then down x = 300: its bounds take in the geo shape at (0, 200)–(100, 300), its line doesn't.
		const ell = createShapeId('ell')
		const pt = (id: string, index: string, x: number, y: number) => ({ id, index: index as never, x, y })
		editor.createShapes<TLLineShape>([{ id: ell, type: 'line', x: 0, y: 0, props: { dash: 'solid', points: { a1: pt('a1', 'a1', -200, 150), a2: pt('a2', 'a2', 300, 150), a3: pt('a3', 'a3', 300, 400) } } }])
		editor.sendToBack([ell])
		const scene = getGpuScene(editor)
		expect(scene.isDrawn(ell)).toBe(true)
		// Moved so its line runs through the geo shape, under it: the page's.
		editor.updateShape<TLLineShape>({ id: ell, type: 'line', y: 100 })
		expect(scene.isDrawn(ell)).toBe(false)
	})
})

describe('reading computed colours', () => {
	it('reads what getComputedStyle gives, and says when it cannot', () => {
		expect(readGpuColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1])
		expect(readGpuColor('rgba(0, 0, 255, 0.5)')).toEqual([0, 0, 1, 0.5])
		expect(readGpuColor('color(srgb 1 0.5 0 / 0.25)')).toEqual([1, 0.5, 0, 0.25])
		expect(readGpuColor('transparent')).toEqual([0, 0, 0, 0])
		expect(readGpuColor('#ff000080')![3]).toBeCloseTo(0.5, 2)
		expect(readGpuColor('oklch(0.7 0.1 200)')).toBeNull()
	})
})

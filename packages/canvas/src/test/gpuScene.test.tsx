import { BaseBoxShapeUtil, T, createShapeId, getGpuScene, gpuColor, setRendererMode, type GpuPrimitive, type RecordProps, type TLBaseShape } from '@lifeboard/canvas-editor'
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

const rects = () => getGpuScene(editor).rects.get()
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

	it('follows a shape that moves, and recomputes only when something changes', () => {
		setRendererMode('gpu')
		up()
		const before = rects()
		expect(rects()).toBe(before)
		editor.updateShape({ id: a, type: 'gpu-box', x: 50 })
		expect(rects()).not.toBe(before)
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

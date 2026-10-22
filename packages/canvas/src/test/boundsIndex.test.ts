import { TLArrowBinding, createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

/**
 * Culling and the page's bounds from the editor's bounds index (docs/gpu-renderer-plan.md, phase 8,
 * step 2): a box per shape kept from the store's changes rather than a computed per shape. What
 * moves a shape's box without changing its record has to reach it too: its frame moving, the shapes
 * an arrow joins moving, a change from elsewhere.
 */

let editor: TestEditor
const frame = createShapeId('frame')
const child = createShapeId('child')
const a = createShapeId('a')
const b = createShapeId('b')
const arrow = createShapeId('arrow')

const culled = (id: ReturnType<typeof createShapeId>) => editor.getCulledShapeIds().has(id)

beforeEach(() => {
	editor = new TestEditor()
	editor.setScreenBounds({ x: 0, y: 0, w: 1000, h: 800 })
	editor.renderingBoundsMargin = 100
	editor.createShapes([
		{ id: frame, type: 'frame', x: 100, y: 100, props: { w: 300, h: 300 } },
		{ id: child, type: 'geo', parentId: frame, x: 50, y: 50, props: { w: 100, h: 100 } },
		{ id: a, type: 'geo', x: 500, y: 100, props: { w: 100, h: 100 } },
		{ id: b, type: 'geo', x: 700, y: 100, props: { w: 100, h: 100 } },
		{ id: arrow, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } },
	])
	const bind = (terminal: 'start' | 'end', toId: typeof a) => ({
		type: 'arrow' as const,
		fromId: arrow,
		toId,
		props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false },
	})
	editor.createBindings<TLArrowBinding>([bind('start', a), bind('end', b)])
	editor.selectNone()
})

it("culls a frame's child once the frame has moved off screen", () => {
	expect(culled(child)).toBe(false)
	editor.updateShape({ id: frame, type: 'frame', x: 5000, y: 5000 })
	expect(culled(child)).toBe(true)
	editor.updateShape({ id: frame, type: 'frame', x: 100, y: 100 })
	expect(culled(child)).toBe(false)
})

it('culls an arrow once the shapes it joins have moved off screen', () => {
	expect(culled(arrow)).toBe(false)
	editor.updateShapes([
		{ id: a, type: 'geo', x: 5000, y: 5000 },
		{ id: b, type: 'geo', x: 5200, y: 5000 },
	])
	expect(culled(arrow)).toBe(true)
	editor.updateShape({ id: b, type: 'geo', x: 700, y: 100 })
	expect(culled(arrow)).toBe(false)
})

it('follows a change from elsewhere', () => {
	editor.store.mergeRemoteChanges(() => {
		editor.store.put([{ ...editor.getShape(a)!, x: 5000, y: 5000 }])
	})
	expect(culled(a)).toBe(true)
})

it("takes a shape's new size into the page's bounds", () => {
	const before = editor.getCurrentPageBounds()!
	editor.updateShape({ id: b, type: 'geo', props: { w: 1000 } })
	expect(editor.getCurrentPageBounds()!.maxX).toBeCloseTo(before.maxX + 900)
})

it("keeps the page's bounds exact round an arrow at the edge, bent out past the shapes", () => {
	editor.updateShape({ id: arrow, type: 'arrow', props: { bend: 300 } })
	const exact = [...editor.getCurrentPageShapeIds()]
		.map((id) => editor.getShapeMaskedPageBounds(id)!)
		.reduce((a, b) => a.clone().expand(b))
	const bounds = editor.getCurrentPageBounds()!
	expect([bounds.x, bounds.y, bounds.maxX, bounds.maxY]).toEqual([exact.x, exact.y, exact.maxX, exact.maxY])
})

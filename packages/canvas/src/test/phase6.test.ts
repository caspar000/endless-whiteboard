import { GeoShapeGeoStyle, PageRecordType, createShapeId, type TLDrawShape, type TLGeoShape } from '@lifeboard/canvas-editor'
import { getGeoType, registerGeoType } from '../lib/shapes/geo/customGeoTypes'
import { TestEditor } from './TestEditor'

/** Phase 6 of the parity work: I8, I9, B10 and custom geo kinds (B6). */

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor.user.updateUserPreferences({ isDynamicSizeMode: null })
	editor?.dispose()
})

describe('in and out by keyboard (I8)', () => {
	const frame = createShapeId('frame')
	const a = createShapeId('a')
	const b = createShapeId('b')
	beforeEach(() => {
		editor.createShapes([
			{ id: frame, type: 'frame', x: 0, y: 0, props: { w: 400, h: 300 } },
			{ id: a, type: 'geo', parentId: frame, x: 20, y: 20, props: { w: 50, h: 50 } },
			{ id: b, type: 'geo', parentId: frame, x: 120, y: 20, props: { w: 50, h: 50 } },
		])
	})

	it('Enter on a frame selects what is in it, and Shift+Enter goes back out', () => {
		editor.select(frame)
		editor.keyDown('Enter').keyUp('Enter')
		expect([...editor.getSelectedShapeIds()].sort()).toEqual([a, b].sort())

		editor.keyDown('Enter', { shiftKey: true }).keyUp('Enter', { shiftKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([frame])
	})

	it('Option+Up and Down go to the page before and after', () => {
		const second = PageRecordType.createId('second')
		editor.createPage({ id: second, name: 'Second' })
		const first = editor.getCurrentPageId()
		editor.keyDown('ArrowDown', { altKey: true }).keyUp('ArrowDown', { altKey: true })
		expect(editor.getCurrentPageId()).toBe(second)
		editor.keyDown('ArrowUp', { altKey: true }).keyUp('ArrowUp', { altKey: true })
		expect(editor.getCurrentPageId()).toBe(first)
	})
})

describe('pressure from a tablet that says it is a mouse (I9)', () => {
	const draw = (pressure: number) => {
		editor.setCurrentTool('draw')
		editor.pointerDown(0, 0, { point: { x: 0, y: 0, z: pressure } })
		editor.pointerMove(40, 40, { point: { x: 40, y: 40, z: pressure } })
		editor.pointerMove(80, 10, { point: { x: 80, y: 10, z: pressure } })
		editor.pointerUp()
		return editor.getCurrentPageShapes().at(-1) as TLDrawShape
	}

	it('draws with its pressure, where a mouse gets pressure simulated', () => {
		expect(draw(0.3).props.isPen).toBe(true)
		expect(draw(0.5).props.isPen).toBe(false)
	})
})

describe('dynamic size (B10)', () => {
	it('makes new shapes at the inverse of the zoom, a clicked one at that size', () => {
		editor.setCamera({ x: 0, y: 0, z: 0.5 })
		editor.user.updateUserPreferences({ isDynamicSizeMode: true })
		editor.setCurrentTool('geo')
		editor.click(100, 100)
		const shape = editor.getCurrentPageShapes().at(-1) as TLGeoShape
		expect(shape.props.scale).toBeCloseTo(2)
		expect(shape.props.w).toBeCloseTo(400)

		editor.user.updateUserPreferences({ isDynamicSizeMode: false })
		editor.setCurrentTool('geo')
		editor.click(400, 400)
		expect((editor.getCurrentPageShapes().at(-1) as TLGeoShape).props.scale).toBe(1)
	})
})

describe('custom geo kinds (B6)', () => {
	it('register as a geo value with their own outline and click size', () => {
		registerGeoType('chevron', {
			getVertices: (w, h) => [
				{ x: 0, y: 0 },
				{ x: w * 0.7, y: 0 },
				{ x: w, y: h / 2 },
				{ x: w * 0.7, y: h },
				{ x: 0, y: h },
				{ x: w * 0.3, y: h / 2 },
			],
			defaultSize: { w: 240, h: 120 },
		})
		expect(getGeoType('chevron')).toBeDefined()

		editor.setStyleForNextShapes(GeoShapeGeoStyle, 'chevron' as TLGeoShape['props']['geo'])
		editor.setCurrentTool('geo')
		editor.click(300, 300)
		const shape = editor.getCurrentPageShapes().at(-1) as TLGeoShape
		expect(shape.props).toMatchObject({ geo: 'chevron', w: 240, h: 120 })
		const outline = editor.getShapeGeometry(shape)
		// The body is the chevron's six corners (the label is the group's other child).
		const body = 'children' in outline ? (outline as unknown as { children: Array<{ vertices: unknown[] }> }).children[0]! : outline
		expect(body.vertices).toHaveLength(6)
	})
})

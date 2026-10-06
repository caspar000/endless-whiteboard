import { TLArrowShape, TLGeoShape, createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor

beforeEach(() => {
	editor = new TestEditor()
	editor.updateInstanceState({ isGridMode: true })
	editor.updateDocumentSettings({ gridSize: 10 })
})

describe('snapping to the grid (I2)', () => {
	it('starts a drawn shape on the grid, not where the pointer went down', () => {
		editor.setCurrentTool('geo')
		editor.pointerDown(103, 107).pointerMove(253, 188).pointerUp()
		const shape = editor.getOnlySelectedShape() as TLGeoShape
		expect([shape.x, shape.y]).toEqual([100, 110])
		expect([shape.props.w, shape.props.h]).toEqual([150, 80])
	})

	it('puts a clicked-in sticky on the grid', () => {
		editor.setCurrentTool('note')
		editor.pointerDown(203, 207).pointerUp()
		const shape = editor.getOnlySelectedShape()!
		expect(shape.x % 10).toBe(0)
		expect(shape.y % 10).toBe(0)
	})

	it('puts a dragged arrow end on the grid', () => {
		const id = createShapeId('arrow')
		editor.createShapes([{ id, type: 'arrow', x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }])
		editor.select(id)
		editor.pointerDown(100, 0, { target: 'handle', shape: editor.getShape(id)!, handle: editor.getShapeHandles(id)!.find((h) => h.id === 'end')! })
		editor.pointerMove(143, 57).pointerUp()
		const { end } = editor.getShape<TLArrowShape>(id)!.props
		expect([end.x, end.y]).toEqual([140, 60])
	})

	it('leaves things where they are with ⌘/Ctrl held', () => {
		editor.setCurrentTool('geo')
		editor.pointerDown(103, 107, { ctrlKey: true }).pointerMove(253, 188, { ctrlKey: true }).pointerUp()
		const shape = editor.getOnlySelectedShape()!
		expect([shape.x, shape.y]).toEqual([103, 107])
	})
})

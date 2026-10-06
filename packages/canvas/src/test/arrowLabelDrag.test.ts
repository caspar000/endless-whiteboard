import { TLArrowShape, createShapeId, toRichText } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const id = createShapeId('arrow')

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id, type: 'arrow', x: 0, y: 100, props: { start: { x: 0, y: 0 }, end: { x: 600, y: 0 }, richText: toRichText('label') } },
	])
	editor.select(id)
})

const label = () => editor.getShapeGeometry(id).bounds && (editor.getShapeGeometry(id) as unknown as { children: { center: { x: number } }[] }).children[1]!.center

describe('dragging an arrow label (B2)', () => {
	it('slides the label along the arrow, and undo puts it back', () => {
		expect(label().x).toBeCloseTo(300, 0)
		editor.pointerDown(300, 100, id).pointerMove(320, 110).pointerMove(450, 140).pointerUp()
		const shape = editor.getShape<TLArrowShape>(id)!
		expect(shape.props.labelPosition).toBeCloseTo(0.75, 2)
		// The arrow itself didn't move.
		expect(shape.x).toBe(0)
		expect(label().x).toBeCloseTo(450, 0)
		editor.undo()
		expect(editor.getShape<TLArrowShape>(id)!.props.labelPosition).toBe(0.5)
	})

	it('moves the arrow when the drag starts off the label', () => {
		editor.pointerDown(100, 100, id).pointerMove(120, 130).pointerUp()
		const shape = editor.getShape<TLArrowShape>(id)!
		expect(shape.props.labelPosition).toBe(0.5)
		expect(shape.x).toBe(20)
	})
})

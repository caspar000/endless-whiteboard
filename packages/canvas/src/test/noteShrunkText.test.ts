import { createShapeId, type TLNoteShape } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

it('a note with shrunk text keeps it until a size is picked, which takes over', () => {
	const id = createShapeId()
	editor.createShapes([{ id, type: 'note', props: { size: 's', fontSizeAdjustment: 12 } }])
	expect((editor.getShape(id) as TLNoteShape).props.fontSizeAdjustment).toBe(12)

	editor.updateShapes([{ id, type: 'note', props: { color: 'blue' } }])
	expect((editor.getShape(id) as TLNoteShape).props.fontSizeAdjustment).toBe(12)

	editor.updateShapes([{ id, type: 'note', props: { size: 'l' } }])
	expect((editor.getShape(id) as TLNoteShape).props).toMatchObject({ size: 'l', fontSizeAdjustment: 0 })
})

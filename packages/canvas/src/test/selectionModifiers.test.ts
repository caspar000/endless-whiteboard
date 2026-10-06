import { createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const ids = {
	a: createShapeId('a'),
	b: createShapeId('b'),
	frame: createShapeId('frame'),
	inside1: createShapeId('inside1'),
	inside2: createShapeId('inside2'),
}

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id: ids.a, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
		{ id: ids.b, type: 'geo', x: 200, y: 0, props: { w: 100, h: 100 } },
		{ id: ids.frame, type: 'frame', x: 0, y: 300, props: { w: 400, h: 300 } },
		{ id: ids.inside1, type: 'geo', parentId: ids.frame, x: 20, y: 20, props: { w: 50, h: 50 } },
		{ id: ids.inside2, type: 'geo', parentId: ids.frame, x: 120, y: 20, props: { w: 50, h: 50 } },
	])
	editor.selectNone()
})

describe('selection (I3)', () => {
	it('⌘/Ctrl-click adds a shape to the selection, and a second ⌘/Ctrl-click takes it away', () => {
		editor.click(50, 50, ids.a)
		editor.click(250, 50, ids.b, { ctrlKey: true })
		expect([...editor.getSelectedShapeIds()].sort()).toEqual([ids.a, ids.b].sort())
		editor.click(250, 50, ids.b, { ctrlKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([ids.a])
	})

	it('select all goes from the inside out: the frame’s shapes first, then the page', () => {
		editor.select(ids.inside1)
		editor.selectAll()
		expect([...editor.getSelectedShapeIds()].sort()).toEqual([ids.inside1, ids.inside2].sort())
		editor.selectAll()
		expect([...editor.getSelectedShapeIds()].sort()).toEqual([ids.a, ids.b, ids.frame].sort())
	})
})

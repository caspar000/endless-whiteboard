import { createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const id = createShapeId('box')

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([{ id, type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } }])
})

describe('edge scrolling (I1)', () => {
	it('pans the board while a dragged shape is held at the edge, and the shape comes along', () => {
		const { w } = editor.getViewportScreenBounds()
		editor.pointerDown(150, 150, id)
		editor.pointerMove(400, 150)
		editor.pointerMove(w - 2, 150)
		const camera = editor.getCamera().x
		const shape = editor.getShape(id)!.x

		// Passing the edge for a moment doesn't scroll.
		jest.advanceTimersByTime(100)
		expect(editor.getCamera().x).toBe(camera)

		jest.advanceTimersByTime(500)
		expect(editor.getCamera().x).toBeLessThan(camera)
		expect(editor.getShape(id)!.x).toBeGreaterThan(shape)
		// The shape stays under the pointer as the board moves.
		expect(editor.getShapePageBounds(id)!.center.x).toBeCloseTo(editor.inputs.currentPagePoint.x, 0)

		// Back from the edge, it stops.
		editor.pointerMove(400, 150)
		const stopped = editor.getCamera().x
		jest.advanceTimersByTime(300)
		expect(editor.getCamera().x).toBe(stopped)
		editor.pointerUp()
	})

	it('leaves the board alone when not dragging', () => {
		const camera = editor.getCamera()
		editor.pointerMove(1, 1)
		jest.advanceTimersByTime(600)
		expect(editor.getCamera()).toEqual(camera)
	})
})

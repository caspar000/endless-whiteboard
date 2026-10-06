import { TLGeoShape, createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const ids = {
	a: createShapeId('a'),
	b: createShapeId('b'),
	c: createShapeId('c'),
	d: createShapeId('d'),
}

/**
 * A  B
 * C  D   (C a little lower than A, still the same row as D)
 */
beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id: ids.d, type: 'geo', x: 300, y: 310, props: { w: 100, h: 100 } },
		{ id: ids.a, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
		{ id: ids.c, type: 'geo', x: 0, y: 320, props: { w: 100, h: 100 } },
		{ id: ids.b, type: 'geo', x: 300, y: 20, props: { w: 100, h: 100 } },
	])
	editor.selectNone()
})

describe('keyboard navigation (A1)', () => {
	it('Tab steps through the shapes in reading order, and Shift+Tab back, wrapping around', () => {
		const order: string[] = []
		for (let i = 0; i < 5; i++) {
			editor.keyDown('Tab', { code: 'Tab' })
			order.push(editor.getOnlySelectedShape()!.id)
		}
		expect(order).toEqual([ids.a, ids.b, ids.c, ids.d, ids.a])
		editor.keyDown('Tab', { code: 'Tab', shiftKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([ids.d])
	})

	it('⌘/Ctrl+arrow goes to the nearest shape that way, and plain arrows still nudge', () => {
		editor.select(ids.a)
		editor.keyDown('ArrowRight', { code: 'ArrowRight', ctrlKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([ids.b])
		editor.keyDown('ArrowDown', { code: 'ArrowDown', ctrlKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([ids.d])
		editor.keyDown('ArrowLeft', { code: 'ArrowLeft', ctrlKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([ids.c])
		// Nothing further that way: the selection stays.
		editor.keyDown('ArrowLeft', { code: 'ArrowLeft', ctrlKey: true })
		expect(editor.getSelectedShapeIds()).toEqual([ids.c])
		expect(editor.getShape(ids.c)).toMatchObject({ x: 0, y: 320 })
	})

	it('Alt+Shift+arrow grows and shrinks the selection from its top left', () => {
		editor.select(ids.a)
		editor.keyDown('ArrowRight', { code: 'ArrowRight', altKey: true, shiftKey: true })
		editor.keyRepeat('ArrowRight', { code: 'ArrowRight', altKey: true, shiftKey: true })
		editor.keyDown('ArrowUp', { code: 'ArrowUp', altKey: true, shiftKey: true })
		expect(editor.getShape<TLGeoShape>(ids.a)).toMatchObject({ x: 0, y: 0, props: { w: 120, h: 90 } })
		editor.undo()
		expect(editor.getShape<TLGeoShape>(ids.a)!.props).toMatchObject({ w: 120, h: 100 })
	})
})

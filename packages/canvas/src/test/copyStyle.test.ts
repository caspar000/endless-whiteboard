import { DefaultColorStyle, DefaultDashStyle, TLGeoShape, createShapeId } from '@lifeboard/canvas-editor'
import { copyShapeStyle } from '../lib/utils/styles/copyStyle'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const source = createShapeId('source')
const target = createShapeId('target')

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id: source, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100, color: 'violet', dash: 'dotted', fill: 'solid' } },
		{ id: target, type: 'geo', x: 300, y: 0, props: { w: 100, h: 100 } },
	])
})

describe('copying a style (I7)', () => {
	it('makes the shape under the pointer’s style the next shapes’, and gives it to the selection', () => {
		editor.select(target)
		editor.pointerMove(50, 50)
		expect(copyShapeStyle(editor)?.id).toBe(source)
		expect(editor.getStyleForNextShape(DefaultColorStyle)).toBe('violet')
		expect(editor.getStyleForNextShape(DefaultDashStyle)).toBe('dotted')
		expect(editor.getShape<TLGeoShape>(target)!.props).toMatchObject({ color: 'violet', dash: 'dotted', fill: 'solid' })
		editor.undo()
		expect(editor.getShape<TLGeoShape>(target)!.props.color).toBe('black')
	})

	it('does nothing over empty paper with nothing selected', () => {
		editor.pointerMove(1000, 1000)
		expect(copyShapeStyle(editor)).toBeNull()
	})
})

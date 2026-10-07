import { createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
beforeEach(() => {
	editor = new TestEditor()
})
afterEach(() => {
	editor?.dispose()
})

const isCulled = (id: ReturnType<typeof createShapeId>) =>
	editor.getRenderingShapes().find((s) => s.id === id)!.isCulled

it('shows what a quick pan brings into view while the camera is still moving', () => {
	const far = createShapeId('far')
	editor.createShapes([{ id: far, type: 'geo', x: 3000, y: 100, props: { w: 100, h: 100 } }])
	editor.setCamera({ x: -10, y: 0, z: 1 })
	editor.setCamera({ x: -2900, y: 0, z: 1 })
	expect(editor.getCameraState()).toBe('moving')
	expect(isCulled(far)).toBe(false)
})

it('keeps pictures shown half a screen past the edge, other shapes 100px', () => {
	const picture = createShapeId('picture')
	const box = createShapeId('box')
	// The viewport is 1080 wide; both start 400px past its right edge.
	editor.createShapes([
		{ id: picture, type: 'image', x: 1480, y: 100, props: { w: 100, h: 100 } },
		{ id: box, type: 'geo', x: 1480, y: 300, props: { w: 100, h: 100 } },
	])
	editor.setCamera({ x: 0, y: 0, z: 1 })
	expect(isCulled(picture)).toBe(false)
	expect(isCulled(box)).toBe(true)
})

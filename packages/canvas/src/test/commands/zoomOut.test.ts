import { ZOOMS } from '@lifeboard/canvas-editor'
import { TestEditor } from '../TestEditor'

let editor: TestEditor

beforeEach(() => {
	editor = new TestEditor()
})

it('zooms by increments', () => {
	// Starts at 1, and steps down through the zooms below it to the first (5%)
	const one = ZOOMS.indexOf(1)
	expect(editor.getZoomLevel()).toBe(1)
	for (let i = one - 1; i >= 0; i--) {
		editor.zoomOut()
		expect(editor.getZoomLevel()).toBe(ZOOMS[i])
	}
	expect(ZOOMS[0]).toBe(0.05)
	// does not zoom out past min
	editor.zoomOut()
	expect(editor.getZoomLevel()).toBe(ZOOMS[0])
})

it('does not zoom out when camera is frozen', () => {
	editor.setCamera({ x: 0, y: 0, z: 1 })
	expect(editor.getCamera()).toMatchObject({ x: 0, y: 0, z: 1 })
	editor.updateInstanceState({ canMoveCamera: false })
	editor.zoomOut()
	expect(editor.getCamera()).toMatchObject({ x: 0, y: 0, z: 1 })
})

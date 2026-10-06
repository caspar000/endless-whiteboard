import { ZOOMS } from '@lifeboard/canvas-editor'
import { TestEditor } from '../TestEditor'

let editor: TestEditor

beforeEach(() => {
	editor = new TestEditor()
})

it('zooms by increments', () => {
	// Starts at 1, and steps up through the zooms above it to the last
	const one = ZOOMS.indexOf(1)
	expect(editor.getZoomLevel()).toBe(1)
	for (let i = one + 1; i < ZOOMS.length; i++) {
		editor.zoomIn()
		expect(editor.getZoomLevel()).toBe(ZOOMS[i])
	}

	// does not zoom in past max
	editor.zoomIn()
	expect(editor.getZoomLevel()).toBe(ZOOMS[ZOOMS.length - 1])
})

it('zooms to from B to D when B >= (C - A)/2, else zooms from B to C', () => {
	editor.setCamera({ x: 0, y: 0, z: (ZOOMS[2] + ZOOMS[3]) / 2 })
	editor.zoomIn()
	expect(editor.getZoomLevel()).toBe(ZOOMS[4])
	editor.setCamera({ x: 0, y: 0, z: (ZOOMS[2] + ZOOMS[3]) / 2 - 0.1 })
	editor.zoomIn()
	expect(editor.getZoomLevel()).toBe(ZOOMS[3])
})

it('does not zoom when camera is frozen', () => {
	editor.setCamera({ x: 0, y: 0, z: 1 })
	expect(editor.getCamera()).toMatchObject({ x: 0, y: 0, z: 1 })
	editor.updateInstanceState({ canMoveCamera: false })
	editor.zoomIn()
	expect(editor.getCamera()).toMatchObject({ x: 0, y: 0, z: 1 })
})

import { DefaultGrid, useEditor, useValue } from 'tldraw'
import { useCanvasPrefs } from '../app/canvasPrefs'
import { DottedPaper } from './DottedPaper'

/**
 * The canvas backdrop, and the thing that decouples "show a grid" from "snap to the grid".
 *
 * tldraw draws its own grid only when `isGridMode` is on (`DefaultCanvas`: `isGridMode && Grid && …`),
 * and that same flag is what `Translating`/`Resizing` read to snap. So going through tldraw's `Grid`
 * slot would make the two settings one setting again. Instead the grid is drawn here, in the
 * `Background` slot, which renders unconditionally — and `Grid` is set to `null` in Board.tsx so
 * tldraw's gated copy never appears on top of ours.
 */
export function CanvasBackground() {
	const { showGrid, gridStyle } = useCanvasPrefs()
	if (!showGrid) return null
	return gridStyle === 'native' ? <NativeGrid /> : <DottedPaper />
}

/**
 * tldraw's own grid, rendered by hand.
 *
 * `DefaultGrid` is a pure function of the camera and grid size — tldraw normally feeds it from its
 * `GridWrapper`, which we cannot use here (see above), so those values are read directly.
 */
function NativeGrid() {
	const editor = useEditor()
	const camera = useValue('lifeboard:grid-camera', () => editor.getCamera(), [editor])
	const size = useValue(
		'lifeboard:grid-size',
		() => editor.getDocumentSettings().gridSize,
		[editor]
	)
	return <DefaultGrid x={camera.x} y={camera.y} z={camera.z} size={size} />
}

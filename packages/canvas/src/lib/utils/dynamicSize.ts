import type { Editor } from '@lifeboard/canvas-editor'

/**
 * The scale a shape is made at (docs/fork-parity.md B10): with dynamic size on, the inverse of the
 * zoom, so a shape drawn zoomed out is as big on screen as one drawn at 100%; 1 otherwise. A shape's
 * scale multiplies its stroke and its text, not its outline, which the drawing gesture already sets.
 */
export function getNewShapeScale(editor: Editor): number {
	return editor.user.getIsDynamicSizeMode() ? 1 / editor.getZoomLevel() : 1
}

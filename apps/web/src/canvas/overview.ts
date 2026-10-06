import type { Editor, TLCamera } from '@lifeboard/canvas'

/**
 * A quick look at the whole board (docs/fork-parity.md I4): zoom out to fit everything, and back to
 * exactly where you were with the same key. The way back is kept per board.
 */
const before = new WeakMap<Editor, TLCamera>()

export function toggleOverview(editor: Editor): void {
	const camera = before.get(editor)
	if (camera) {
		before.delete(editor)
		editor.setCamera(camera, { duration: OVERVIEW_MS })
		return
	}
	if (editor.getCurrentPageShapeIds().size === 0) return
	before.set(editor, editor.getCamera())
	editor.zoomToFit({ duration: OVERVIEW_MS })
}

const OVERVIEW_MS = 220

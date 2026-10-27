import type { Editor } from '@lifeboard/canvas'
import { INDEX_ID, INDEX_ZID, shapeByZid } from './box'
import { announce, isStackOpen, showCard } from './stack/state'

/**
 * Following a chip: to the note or source it names, or to the index with a keyword picked out. In the
 * stack the card comes to the front; on the table the camera goes to it.
 */
export function goToCard(editor: Editor, zid: string): void {
	const shape = shapeByZid(editor, zid)
	if (!shape) {
		announce(`There is no ${zid} in this box.`)
		return
	}
	if (isStackOpen(editor)) {
		editor.complete()
		showCard(editor, zid)
		return
	}
	editor.select(shape.id)
	editor.zoomToSelection({ animation: { duration: 220 } })
}

export function goToKeyword(editor: Editor, keyword: string): void {
	if (isStackOpen(editor)) {
		editor.complete()
		showCard(editor, INDEX_ZID, keyword)
		return
	}
	if (!editor.getShape(INDEX_ID)) return
	editor.select(INDEX_ID)
	editor.zoomToSelection({ animation: { duration: 220 } })
}

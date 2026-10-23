import type { Editor } from '@lifeboard/canvas'
import { isTree } from '../board'
import { syncBoard } from '../treeSync'
import { recalculate } from './viewSync'

/** Nodes take their new sizes, then every tree view on the board is laid out again with the settings. */
export function relayout(editor: Editor): void {
	syncBoard(editor)
	for (const header of editor.getCurrentPageShapes().filter(isTree)) recalculate(editor, header)
}

/** One layout run per pause in the changes: the whole board takes a second or so to lay out. */
const timers = new WeakMap<Editor, ReturnType<typeof setTimeout>>()
export function relayoutSoon(editor: Editor): void {
	clearTimeout(timers.get(editor))
	timers.set(
		editor,
		setTimeout(() => relayout(editor), 450)
	)
}

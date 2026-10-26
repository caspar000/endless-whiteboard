import type { Editor } from '@lifeboard/canvas'
import { isBox, isCard, settleDuplicateIds } from './box'
import { announce } from './stack/state'

const watched = new WeakSet<Editor>()

/**
 * Keeps one box's ids unique as other devices' notes arrive (box.ts, `settleDuplicateIds`). Wired from
 * `onBoardOpen`, once per editor; side effects go when the editor does.
 */
export function watchBox(editor: Editor): void {
	if (watched.has(editor)) return
	watched.add(editor)

	let scheduled = false
	const settle = () => {
		scheduled = false
		if (!isBox(editor)) return
		const moved = settleDuplicateIds(editor)
		for (const { from, to } of moved) {
			announce(`Another device also wrote a note ${from}. One of them is ${to} now.`)
		}
	}
	// After the change that brought the card in, not inside it: a write made while another device's
	// changes are being merged would count as theirs and never be sent.
	const schedule = () => {
		if (scheduled) return
		scheduled = true
		setTimeout(settle, 0)
	}

	editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
		if (source === 'remote' && isCard(shape)) schedule()
	})
	schedule()
}

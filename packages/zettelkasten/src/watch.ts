import type { Editor } from '@lifeboard/canvas'
import { ensureIndex, INDEX_ID, isBox, isNumbered, layoutBox, retireId, settleDuplicateIds } from './box'
import { announce } from './stack/state'

const watched = new WeakSet<Editor>()

/**
 * Keeps one box's ids unique as other devices' notes arrive (box.ts, `settleDuplicateIds`), and holds
 * the ordinary ways of removing or copying a shape to the box's rules. Wired from `onBoardOpen`, once
 * per editor; side effects go when the editor does.
 */
export function watchBox(editor: Editor): void {
	if (watched.has(editor)) return
	watched.add(editor)

	let scheduled = false
	const settle = () => {
		scheduled = false
		if (!isBox(editor)) return
		ensureIndex(editor)
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

	const copies = new Set<string>()
	editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
		if (!isNumbered(shape) || !isBox(editor)) return
		if (source === 'remote') return schedule()
		// Made here but not by placing it: a duplicate or a paste of a card whose number is taken. A
		// copy of a note has no place of its own in the box, so it doesn't stay.
		const twin = editor
			.getCurrentPageShapes()
			.some((other) => other.id !== shape.id && isNumbered(other) && other.props.zid === shape.props.zid)
		if (twin) {
			copies.add(shape.id)
			editor.deleteShapes([shape.id])
		} else {
			layoutBox(editor)
		}
	})
	// Deleted on the table (the selection toolbar, ⌫): the number is retired as the stack's delete
	// retires it, and the cards close up. Not when ⌘Z took back a note just written, which deletes a
	// card too: undo and redo announce themselves once they have replayed, so the retiring waits a
	// microtask and is dropped if one of them did.
	let pending: string[] = []
	editor.on('change-history', ({ reason }: { reason: string }) => {
		if (reason === 'undo' || reason === 'redo') pending = []
	})
	// A card is where its number puts it. One moved some other way (an agent's node.update, a script) is
	// put back, after the change rather than refused before it, so that undo, and another device laying
	// out its own new note, still go through; the layout is worked out from the ids alone, so putting it
	// back is always the same answer.
	let relaying = false
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
		if (source !== 'user' || relaying || (prev.x === next.x && prev.y === next.y)) return
		if (!isNumbered(next) && next.id !== INDEX_ID) return
		relaying = true
		queueMicrotask(() => {
			relaying = false
			if (isBox(editor)) editor.run(() => layoutBox(editor), { history: 'ignore' })
		})
	})
	editor.sideEffects.registerAfterDeleteHandler('shape', (shape, source) => {
		// The index goes with the box, not on its own: deleted on the table, it comes straight back.
		if (shape.id === INDEX_ID && isBox(editor)) return schedule()
		if (source !== 'user' || !isNumbered(shape) || !isBox(editor)) return
		// A copy taken off as it arrived (above) never had a number of its own to retire.
		if (copies.delete(shape.id)) return
		layoutBox(editor)
		if (!pending.length) {
			queueMicrotask(() => {
				const zids = pending
				pending = []
				if (zids.length) editor.run(() => zids.forEach((zid) => retireId(editor, zid)), { history: 'ignore' })
			})
		}
		pending.push(shape.props.zid)
	})
	schedule()
}

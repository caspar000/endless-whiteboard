import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { ITEM_TYPE, TRACK_TYPE } from './board'
import { nextLeafOf, setDone } from './syllabus'

/**
 * What ticking does (docs/skill-tree-plan.md, "Completion and evidence"), and putting syllabus views
 * on a board. A tick is vault data, the same on every board.
 *
 * A tick files nothing on the board (DARK-14): the write-up note it used to file beside what you
 * ticked from was, for most media, one more card to tidy away. A work ticked counts on its own.
 */

export const ITEM_WIDTH = 260
export const ITEM_HEIGHT = 56
const GAP = 40
/** Room below a stacked shape for the property card that hangs under it. */
const STACK_GAP = 48

/** Ticks or unticks a leaf. Vault data, undone by ticking again. */
export function tick(itemId: string, done: boolean): void {
	setDone(itemId, done)
}

/** Ticks an item if it is a leaf, or the next undone work under it if it has works. */
export function tickNext(itemId: string): void {
	const step = nextLeafOf(itemId)
	if (step) tick(step.itemId, true)
}

/**
 * Where something `width` wide goes beside the anchor: its right, below anything already in that
 * column (cards put there), so a second card never covers the first.
 */
function besideAnchor(editor: Editor, anchor: TLShapeId | undefined, width: number): { x: number; y: number } {
	const bounds = anchor ? editor.getShapePageBounds(anchor) : undefined
	if (!bounds) {
		const c = editor.getViewportPageBounds().center
		return { x: c.x - width / 2, y: c.y }
	}
	const x = bounds.maxX + GAP
	let y = bounds.y
	const inColumn = editor
		.getCurrentPageShapes()
		.filter((s) => s.id !== anchor && s.type !== 'arrow' && s.parentId === editor.getCurrentPageId())
		.flatMap((s) => editor.getShapePageBounds(s.id) ?? [])
		.filter((b) => b.x < x + width && b.maxX > x)
		.sort((a, b) => a.y - b.y)
	for (const b of inColumn) if (b.y < y + ITEM_HEIGHT && b.maxY > y) y = b.maxY + STACK_GAP
	return { x, y }
}

export const TRACK_WIDTH = 380
export const TRACK_HEIGHT = 560

/** Puts a list of a vault track on the board. One undo step. */
export function showTrack(editor: Editor, trackId: string, at: { x: number; y: number }): TLShapeId {
	const id = createShapeId()
	editor.run(() => {
		editor.markHistoryStoppingPoint('show track')
		editor.createShape({ id, type: TRACK_TYPE, parentId: editor.getCurrentPageId(), x: at.x, y: at.y, props: { trackId } } as never)
	})
	return id
}

/** Puts a card for a vault item beside `anchor` (or at `at`), clear of what is already there. One undo step. */
export function putCard(editor: Editor, itemId: string, at: { x: number; y: number } | { beside: TLShapeId }): TLShapeId {
	if ('beside' in at) at = besideAnchor(editor, at.beside, ITEM_WIDTH)
	const id = createShapeId()
	editor.run(() => {
		editor.markHistoryStoppingPoint('put card')
		editor.createShape({ id, type: ITEM_TYPE, parentId: editor.getCurrentPageId(), x: at.x, y: at.y, props: { itemId } } as never)
	})
	return id
}

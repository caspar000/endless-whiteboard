import { connectShapes, updateShapeProperties } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { evidenceNoteFor, ITEM_TYPE, NOTE_TYPE, TRACK_TYPE } from './board'
import { ensureProperties, hideOnCard, PROP_ID } from './properties'
import { getItem, nextLeafOf, setDone } from './syllabus'
import { templateFor } from './templates'

/**
 * What ticking does (docs/skill-tree-plan.md, "Completion and evidence"), and putting syllabus views
 * on a board. A tick is vault data, the same on every board; the write-up it files is a note on the
 * board you ticked on, beside whatever you ticked it from.
 */

export const ITEM_WIDTH = 260
export const ITEM_HEIGHT = 56
const NOTE_WIDTH = 300
const GAP = 40
/** Room below a stacked shape for the property card that hangs under it (a write-up's Method). */
const STACK_GAP = 48

/**
 * Ticks or unticks a leaf, and on a tick files its write-up note beside `anchor` (the card, list or
 * node it was ticked from) unless this board already has one. The note is one undo step; the tick
 * itself is vault data and is undone by ticking again.
 */
export function tick(editor: Editor | null, itemId: string, done: boolean, anchor?: TLShapeId): void {
	if (!setDone(itemId, done)) return
	if (done && editor) fileEvidence(editor, itemId, anchor)
}

/** Ticks an item if it is a leaf, or the next undone work under it if it has works. */
export function tickNext(editor: Editor | null, itemId: string, anchor?: TLShapeId): void {
	const step = nextLeafOf(itemId)
	if (step) tick(editor, step.itemId, true, anchor)
}

/**
 * The write-up note for an item, from its medium's template, beside the anchor and below any notes
 * already stacked there. Reused rather than replaced on a second tick: unticking keeps the note,
 * because it may hold writing.
 */
function fileEvidence(editor: Editor, itemId: string, anchor?: TLShapeId): void {
	if (evidenceNoteFor(editor, itemId)) return
	const item = getItem(itemId)
	if (!item) return
	const template = templateFor(item.medium)
	const at = notePosition(editor, anchor)
	const noteId = createShapeId()
	editor.run(() => {
		editor.markHistoryStoppingPoint('file write-up')
		editor.createShape({
			id: noteId,
			type: NOTE_TYPE,
			parentId: editor.getCurrentPageId(),
			x: at.x,
			y: at.y,
			props: { md: `# ${item.title || 'Notes'}\n\n${template.md}`, autoHeight: true, w: NOTE_WIDTH },
		} as never)
		ensureProperties(editor, ['evidenceOf', 'method'])
		const note = editor.getShape(noteId)
		if (note) {
			updateShapeProperties(editor, note, { [PROP_ID.evidenceOf]: itemId, [PROP_ID.method]: template.method })
			// The item id means nothing to read; the method is worth seeing on the note.
			hideOnCard(editor, noteId, ['evidenceOf'])
		}
		if (anchor && editor.getShape(anchor)) connectShapes(editor, anchor, noteId, { hidden: true })
	})
}

/** To the right of the anchor, below what is already in that column; the viewport's middle without one. */
function notePosition(editor: Editor, anchor?: TLShapeId): { x: number; y: number } {
	return besideAnchor(editor, anchor, NOTE_WIDTH)
}

/**
 * Where something `width` wide goes beside the anchor: its right, below anything already in that
 * column (notes filed there, cards put there), so a second write-up or card never covers the first.
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

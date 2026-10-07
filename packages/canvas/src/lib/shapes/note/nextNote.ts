import { Editor, TLShape, TLShapeId, Vec2d, createShapeId } from '@lifeboard/canvas-editor'

/**
 * The next note along (docs/fork-parity.md B3): the note of the same kind beside this one, or a new
 * one there in the same colours, and editing moves into it. What a note's clone handles and Tab while
 * writing one both do, so a run of notes can be written without touching the mouse.
 */
export type NoteDirection = 'right' | 'left' | 'below' | 'above'

/** The space between a note and the next. */
const NOTE_GAP = 20

const STEP: Record<NoteDirection, { x: number; y: number }> = {
	right: { x: 1, y: 0 },
	left: { x: -1, y: 0 },
	below: { x: 0, y: 1 },
	above: { x: 0, y: -1 },
}

export function isNoteLike(shape: TLShape | undefined): boolean {
	return shape?.type === 'note' || shape?.type === 'pinned-note'
}

/** Where the next note goes, as its top-left corner and its centre. */
export function getNextNotePlacement(editor: Editor, note: TLShape, direction: NoteDirection) {
	const bounds = editor.getShapePageBounds(note)!
	const step = STEP[direction]
	const x = bounds.minX + step.x * (bounds.width + NOTE_GAP)
	const y = bounds.minY + step.y * (bounds.height + NOTE_GAP)
	return { x, y, centre: new Vec2d(x + bounds.width / 2, y + bounds.height / 2) }
}

export function goToNextNote(editor: Editor, noteId: TLShapeId, direction: NoteDirection): TLShapeId | null {
	const note = editor.getShape(noteId)
	if (!note || !isNoteLike(note)) return null
	const { x, y, centre } = getNextNotePlacement(editor, note, direction)

	const existing = editor
		.getShapesAtPoint(centre, { hitInside: true })
		.find((shape) => shape.type === note.type && shape.id !== note.id)

	editor.mark('next note')
	let nextId = existing?.id ?? null
	if (!nextId) {
		nextId = createShapeId()
		const { color, labelColor, size, font, align, verticalAlign, scale } = note.props as Record<string, unknown>
		const pin = 'pinColor' in note.props ? { pinColor: (note.props as { pinColor: unknown }).pinColor } : {}
		const parentTransform = editor.getShapeParentTransform(note)
		const local = parentTransform ? parentTransform.clone().invert().applyToPoint({ x, y }) : { x, y }
		editor.createShape({
			id: nextId,
			type: note.type,
			parentId: note.parentId,
			x: local.x,
			y: local.y,
			props: { color, labelColor, size, font, align, verticalAlign, scale, ...pin },
		})
	}

	// Through idle, so the note being left ends its edit as any other (trimmed, and so on).
	editor.setCurrentTool('select.idle')
	editor.select(nextId)
	editor.setEditingShape(nextId)
	editor.setCurrentTool('select.editing_shape')
	return nextId
}

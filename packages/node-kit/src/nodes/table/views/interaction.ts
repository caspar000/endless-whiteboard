import { react, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { propertyMap, readPropertyRegistry } from '../../../properties/schema'
import { emptyValueForType, type PropertyValue } from '../../../properties/types'
import { updateShapeProperties } from '../../../properties/values'
import type { DropTarget } from '../../../registry'
import { getTableResult } from '../engine'
import { LABEL_COLUMN, groupProperty, type TableNodeProps } from '../spec'
import { getViewDefinition } from './index'
import { hasViewHome, isPlaceableBy, readViewHome, viewHomePatch } from './ownership'
import { canPlace } from './placement'

/**
 * Dropping a card onto a view — the half that makes space an **input**.
 *
 * Every view decides for itself what a point on it means (`ViewDefinition.dropAt`): a kanban's lanes
 * write a status, a calendar's days write a date. What is shared is everything after that, which is why
 * it lives here: the write, its undo entry, and the bookkeeping for a view that owns positions.
 *
 * The two directions are one code path on purpose. Setting a status in the properties panel moves the
 * card, because `placement.ts` watches the query; dropping the card in a lane *sets the status*, and then
 * the same pass moves it the last few pixels. So this file writes properties and nothing about position:
 * there is no "drop layout" to keep in step with the one already there.
 *
 * That is also why undo behaves: the write here is one history entry, the move that follows it is
 * `history: 'ignore'`, and ⌘Z therefore takes back the *decision* — whereupon the card walks out of the
 * lane on its own.
 */

/** Whether this shape is a view that has anywhere to put a dropped card. */
export function acceptsViewDrop(shape: { props: object }): boolean {
	const props = shape.props as unknown as TableNodeProps
	const view = getViewDefinition(props.layout.mode)
	if (!view?.dropAt) return false
	// A view that cannot draw itself cannot be dropped on either: its geometry is not settled, and the
	// message on its face is asking for the very thing a drop would need.
	return (view.blockedReason?.(props, new Map()) ?? null) === null
}

/**
 * What the point under the cursor means, asked of the view that is drawing.
 *
 * Reads the view's own cache entry, so what the card *draws* and what a drop *hits* come from one answer
 * — the same reason the chrome and the placement pass share their geometry.
 */
export function viewDropTarget(
	editor: Editor,
	view: TLShape,
	point: { x: number; y: number }
): DropTarget | null {
	const props = view.props as unknown as TableNodeProps
	const definition = getViewDefinition(props.layout.mode)
	if (!definition?.dropAt) return null
	const box = view.props as { w: number; h: number }
	return definition.dropAt({
		props,
		properties: propertyMap(readPropertyRegistry(editor)),
		result: getTableResult(editor, view.id),
		local: editor.getPointInShapeSpace(view, point),
		width: box.w,
		height: box.h,
	})
}

/**
 * Files the dropped shapes into the lane, in one undo entry.
 *
 * What a drop *is*, in three parts:
 *
 * 1. **The lane's value is written to the property.** Dropping on the empty lane clears it instead of
 *    writing an em dash — that lane stands for an absence, and storing its label as a value would put a
 *    card in a state no picker offers.
 * 2. **A shape that does not carry the property gains it.** This is how a plain sticky joins the board:
 *    drag it into To-do and it *becomes* a card with a status. Membership is "carries the lane property"
 *    (see `ViewDefinition.columnsFor`), so this line is the whole of what makes the gesture work on
 *    something that was not a member a moment ago.
 * 3. **An unowned shape's home is recorded here**, at the position it was dropped, marked `drop`. That
 *    is what stops it being teleported back to the far side of the board when it later stops matching:
 *    it was handed over deliberately. A shape the view had already adopted keeps the home it came with,
 *    so a card dragged from one lane to another still remembers where it originally lived.
 */
/** A shape as it stood when a drag began, so the gesture can tell a move from a click. */
interface HeldShape {
	id: TLShapeId
	x: number
	y: number
}

/**
 * Dragging a card **out** of a view: the inverse gesture, and the way off a board.
 *
 * Take a card out of the lanes and drop it on open canvas, and its lane property is *removed* — not
 * blanked. Blanking would leave the card carrying an empty Status, which is still membership (see
 * `ViewDefinition.columnsFor`), so the view would pull it straight back into the empty lane. Removing
 * says what the gesture says: this is not on that board any more.
 *
 * Its home is cleared with it, so nothing sends it anywhere afterwards. That is the point of dragging
 * it somewhere specific.
 *
 * ### Why a reaction on `isDragging` rather than a tldraw hook
 *
 * There is no "dropped outside me" callback: `onDragShapesOut` fires mid-drag, while the pointer is
 * still moving, and a release over empty canvas reaches no shape at all. So the gesture is recognised
 * from the drag itself — `inputs.getIsDragging()` is atom-backed, so this wakes exactly twice per drag.
 *
 * Two conditions have to hold, and each rules out a false positive that would otherwise delete
 * somebody's property for them:
 *
 * - **It moved.** `isDragging` is set for marquee-selecting and resizing too, and a card whose lane
 *   overflows can legitimately have its centre outside the card it belongs to — so a gesture that did
 *   not change the shape's position is not this gesture.
 * - **Its centre ended up outside the view.** The same test tldraw's own paste-reparenting uses, and it
 *   means a card dropped on another lane — or half-hanging off the edge of one — stays put.
 */
export function watchViewDragOut(editor: Editor): () => void {
	let held: HeldShape[] = []
	return react('lifeboard:view-drag-out', () => {
		if (editor.inputs.getIsDragging()) {
			// Recorded once, on the first frame of the drag. Re-reading it as the shapes move would compare
			// each position against itself, and nothing would ever look like it had moved.
			if (held.length) return
			held = editor
				.getSelectedShapeIds()
				.map((id) => {
					const shape = editor.getShape(id)
					return shape ? { id, x: shape.x, y: shape.y } : null
				})
				.filter((entry): entry is HeldShape => entry !== null)
			return
		}
		if (!held.length) return
		const released = held
		held = []
		freeDraggedOutMembers(editor, released)
	})
}

/** Removes the lane property from every released shape whose gesture took it off its board. */
function freeDraggedOutMembers(editor: Editor, released: readonly HeldShape[]): void {
	const leaving: { shape: TLShape; lane: string }[] = []

	for (const entry of released) {
		const shape = editor.getShape(entry.id)
		if (!shape) continue
		// Unmoved: a click, a marquee, a resize. Not this gesture.
		if (shape.x === entry.x && shape.y === entry.y) continue

		const home = readViewHome(shape)
		if (!home) continue
		const view = editor.getShape(home.viewId as TLShapeId)
		// A view that has gone, or stopped placing, is the placement pass's business — it releases its
		// members and sends the query-adopted ones home. Removing a property on top of that would turn
		// "this card's board was deleted" into "this card's status was deleted".
		if (!view || !acceptsViewDrop(view)) continue

		// Whatever the view groups by is what it filed the card under, and so what taking it out removes.
		// Through `groupProperty`, so this reads a prefixed grouping (a date's day) as the property behind
		// it rather than as a key nothing carries.
		const grouped = (view.props as unknown as TableNodeProps).groupBy
		const lane = grouped === LABEL_COLUMN ? null : groupProperty(grouped)
		if (!lane) continue
		const viewBounds = editor.getShapePageBounds(view)
		const bounds = editor.getShapePageBounds(shape)
		if (!viewBounds || !bounds) continue
		if (viewBounds.containsPoint(bounds.center)) continue

		leaving.push({ shape, lane })
	}

	if (!leaving.length) return
	editor.run(() => {
		editor.markHistoryStoppingPoint('drag out of view')
		for (const { shape, lane } of leaving) {
			// `undefined` *removes* the property rather than emptying it — see `updateShapeProperties`.
			updateShapeProperties(editor, shape, { [lane]: undefined })
			// And let go of it where it stands, so the placement pass has nothing to send home.
			editor.updateShape(viewHomePatch(shape, null))
		}
	})
}

export function applyViewDrop(
	editor: Editor,
	view: TLShape,
	shapes: readonly TLShape[],
	target: DropTarget
): void {
	const props = view.props as unknown as TableNodeProps
	const places = getViewDefinition(props.layout.mode)?.placesMembers === true
	const registry = propertyMap(readPropertyRegistry(editor))

	/*
	 * `null` in a target means "empty this property", and empty is per type: a checkbox's is `false`, a
	 * multi-select's is an empty list. Only the property's own definition knows, which is why the target
	 * says `null` rather than trying to name the value itself.
	 */
	const values: Record<string, PropertyValue> = {}
	for (const [id, value] of Object.entries(target.values)) {
		const def = registry.get(id)
		values[id] = value === null && def ? emptyValueForType(def.type) : value
	}
	if (!Object.keys(values).length) return

	const receiving = shapes.filter(
		(shape) => canPlace(shape) && isPlaceableBy(shape, view.id)
	)
	if (!receiving.length) return

	editor.run(() => {
		editor.markHistoryStoppingPoint('drop into view')
		for (const shape of receiving) {
			// Nested `run`s join the outer batch, so this stays one undo entry however many shapes were
			// dragged — the same reason `collectionPatch` exists as a patch rather than a write.
			updateShapeProperties(editor, shape, values)
			// Only a view that *owns positions* records a home; a calendar sets a date and leaves the card
			// exactly where it was, so it has nothing to give back later and nothing to remember.
			if (places && !hasViewHome(shape)) {
				editor.updateShape(
					viewHomePatch(shape, { viewId: view.id, x: shape.x, y: shape.y, adopted: 'drop' })
				)
			}
		}
	})
}

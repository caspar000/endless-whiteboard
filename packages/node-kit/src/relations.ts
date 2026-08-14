import { createShapeId, type Editor, type TLShapeId } from 'tldraw'

/**
 * Drawing and undrawing a relation.
 *
 * `edges.ts` reads relations *out* of a board — an arrow with a binding at both ends is an edge, and
 * one with a loose end stays a doodle. This is the other direction, and until now nothing owned it:
 * the only code that created a relation had it inlined (the books extension's `addQuoteToBoard`),
 * which was fine as long as there was exactly one caller. There are about to be several, and a
 * copied four-line binding literal is precisely the thing that drifts.
 *
 * Kept next to `edges.ts` on purpose: the definition of a relation — both ends bound, no self-loops —
 * is one fact, and a writer that disagreed with the reader would produce arrows the board renders but
 * no table can see.
 */

/**
 * The centre of a shape, unprecise: tldraw recomputes the line from the two shapes' bounds every
 * frame, so binding to the middle lets it pick the sensible edge points and keep doing so as either
 * shape moves. A precise anchor would pin the arrow to a spot that stops making sense on the first
 * drag.
 */
const CENTRE_ANCHOR = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }

export interface ConnectOptions {
	/**
	 * Mark a history stopping point first, so the connection is one undo step. Off when the caller is
	 * already inside its own `editor.run` and owns the entry — as `addQuoteToBoard` does, where
	 * undoing must take the quote *and* its arrow.
	 */
	markHistory?: boolean
}

/**
 * Joins two shapes with a bound arrow and returns its id, or `null` if it could not.
 *
 * Returns rather than throws for the reasons the callers need: an operation turns `null` into a
 * readable failure, and a UI caller does nothing. The refusals are deliberate:
 *
 * - a missing shape — the id may name something already deleted;
 * - `from === to` — a self-arrow is decoration on one shape, and `getPageEdges` drops it, so
 *   creating one would draw a line that no query can ever see.
 */
export function connectShapes(
	editor: Editor,
	from: TLShapeId,
	to: TLShapeId,
	options: ConnectOptions = {}
): TLShapeId | null {
	if (from === to) return null
	if (!editor.getShape(from) || !editor.getShape(to)) return null

	const arrowId = createShapeId()
	editor.run(() => {
		if (options.markHistory) editor.markHistoryStoppingPoint('connect shapes')
		// Placeholder geometry: both ends are bound, so tldraw recomputes the line on the next frame.
		editor.createShape({ id: arrowId, type: 'arrow', x: 0, y: 0 })
		editor.createBindings([
			{ type: 'arrow', fromId: arrowId, toId: from, props: { terminal: 'start', ...CENTRE_ANCHOR } },
			{ type: 'arrow', fromId: arrowId, toId: to, props: { terminal: 'end', ...CENTRE_ANCHOR } },
		])
	})
	return arrowId
}

/**
 * Removes a relation by deleting its arrow. `true` when there was one to delete.
 *
 * Takes the arrow's own id, which is what an `Edge` carries (`edges.ts`: "`id` is the arrow's own
 * shape id — so an edge can carry properties"), so anything that read the graph can unpick it
 * without a second lookup. Deleting the shape takes its bindings with it — that is tldraw's own
 * cleanup, not something to do by hand.
 */
export function disconnectShapes(editor: Editor, arrowId: TLShapeId): boolean {
	const arrow = editor.getShape(arrowId)
	if (!arrow || arrow.type !== 'arrow') return false
	editor.deleteShape(arrowId)
	return true
}

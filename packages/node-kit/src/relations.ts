import { createShapeId, type Editor, type TLShape, type TLShapeId } from 'tldraw'

/**
 * Drawing and undrawing a relation, and deciding whether it is drawn at all.
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
 * Hidden relations: the connection is real, it just isn't drawn.
 *
 * A board earns its arrows quickly — thirteen of them crossing a page is a ball of string, and most
 * of them are structure you set up once and never want to look at again. So a relation carries one
 * bit saying whether it should be *shown*, and nothing else changes: `edges.ts` never learns about
 * it, `getPageEdges` never filters on it, and every table, rollup, collection and `{…}` expression
 * goes on counting a hidden relation exactly as before. That is the whole promise of hiding — the
 * data stays, the clutter goes — and it holds by construction rather than by care, because the code
 * that answers "what is connected to this?" cannot see this flag at all.
 *
 * Deliberately **not** on `Edge`. `edges.ts` keeps an edge free of anything that isn't topology so
 * that `areEdgeIndexesEqual` reports no change during a drag; visibility is a view decision, and
 * putting it there would re-query every table on the board because somebody tidied their arrows.
 */
export const HIDDEN_RELATION_META = 'lifeboard:relHidden'

/**
 * The two shapes an arrow joins, or `null` when it joins nothing — a drawing rather than a relation.
 *
 * The rule `edges.ts` describes, in the one place both sides of the app read it from: `getPageEdges`
 * builds the graph with this, and every UI control that asks "is this thing I have selected a
 * relation?" answers with it too. Written out twice, the two copies would eventually disagree about
 * something like a self-arrow, and then a toolbar would offer to hide a relation no query can see.
 */
export function relationEnds(
	editor: Editor,
	shape: TLShape | undefined
): { from: string; to: string } | null {
	if (!shape || shape.type !== 'arrow') return null
	let from: string | undefined
	let to: string | undefined
	for (const binding of editor.getBindingsFromShape(shape, 'arrow')) {
		if (binding.props.terminal === 'start') from = binding.toId
		else to = binding.toId
	}
	// Both ends bound, and not a loop. A loose end means someone drew a line, not a relation; a
	// self-arrow is decoration on a single shape and would only ever match itself.
	if (!from || !to || from === to) return null
	return { from, to }
}

/** Whether this shape is a relation at all — the question every "hide this" control has to ask. */
export function isRelation(editor: Editor, shape: TLShape | undefined): boolean {
	return relationEnds(editor, shape) !== null
}

/**
 * Whether this shape is a relation that has been hidden.
 *
 * The one definition of the bit, so the several readers — the arrow's own renderer, the selection
 * toolbar, an agent listing relations — cannot disagree about what counts. Anything that isn't an
 * arrow is `false` rather than an error: callers hand this whatever is selected.
 */
export function isHiddenRelation(shape: Pick<TLShape, 'type' | 'meta'> | undefined): boolean {
	if (!shape || shape.type !== 'arrow') return false
	return shape.meta[HIDDEN_RELATION_META] === true
}

/**
 * Shows or hides a relation. `true` when there was an arrow to change.
 *
 * Writes `false` rather than dropping the key, because a shape partial cannot delete one: tldraw
 * merges `meta` entry by entry (`applyPartialToRecordWithProps`), so an `undefined` here would be
 * written *as* `undefined` and fail validation rather than removing anything. `isHiddenRelation`
 * tests for `true` exactly, so a leftover `false` means the same as no key at all.
 */
export function setRelationHidden(
	editor: Editor,
	arrowId: TLShapeId,
	hidden: boolean,
	options: HistoryOptions = {}
): boolean {
	const arrow = editor.getShape(arrowId)
	if (!arrow || arrow.type !== 'arrow') return false

	editor.run(() => {
		if (options.markHistory) editor.markHistoryStoppingPoint('show or hide relation')
		editor.updateShape({
			id: arrowId,
			type: 'arrow',
			meta: { [HIDDEN_RELATION_META]: hidden },
		})
	})
	return true
}

/**
 * The centre of a shape, unprecise: tldraw recomputes the line from the two shapes' bounds every
 * frame, so binding to the middle lets it pick the sensible edge points and keep doing so as either
 * shape moves. A precise anchor would pin the arrow to a spot that stops making sense on the first
 * drag.
 */
const CENTRE_ANCHOR = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }

export interface HistoryOptions {
	/**
	 * Mark a history stopping point first, so the write is one undo step. Off when the caller is
	 * already inside its own `editor.run` and owns the entry — as `addQuoteToBoard` does, where
	 * undoing must take the quote *and* its arrow.
	 */
	markHistory?: boolean
}

export interface ConnectOptions extends HistoryOptions {
	/** Create it hidden — a relation that counts everywhere but isn't drawn. */
	hidden?: boolean
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
		editor.createShape({
			id: arrowId,
			type: 'arrow',
			x: 0,
			y: 0,
			...(options.hidden ? { meta: { [HIDDEN_RELATION_META]: true } } : {}),
		})
		editor.createBindings([
			{ type: 'arrow', fromId: arrowId, toId: from, props: { terminal: 'start', ...CENTRE_ANCHOR } },
			{ type: 'arrow', fromId: arrowId, toId: to, props: { terminal: 'end', ...CENTRE_ANCHOR } },
		])
	})
	return arrowId
}

/**
 * Takes an arrow with the shape it was attached to.
 *
 * Without this, deleting one end of a relation leaves the arrow behind with a loose end, pointing at
 * the empty space the shape used to occupy. Every query stops counting it the moment the binding goes
 * (`edges.ts`: both ends bound, or it is not an edge), so what is left is not a broken relation but
 * *litter* — a line that means nothing and that nobody asked for.
 *
 * **Watching bindings rather than shapes, which is the only thing that works.** The obvious version of
 * this is a `beforeDelete` handler on the *shape* that looks up what is bound to it — and it finds
 * nothing, every time, because tldraw's own binding cleanup is registered first and has already
 * removed them. What survives is the binding's own removal, and it carries exactly what is needed to
 * tell the two cases apart:
 *
 *  - the shape it pointed at is **gone** — the binding died with it, and the arrow should follow;
 *  - the shape is **still there** — somebody dragged the arrow's end off it, which is how a relation
 *    becomes a drawing, and that must not delete anything.
 *
 * An arrow attached to nothing at all is untouched either way: it has no bindings, so nothing here ever
 * hears about it. That is the line this draws — an *attached* arrow goes with what it was attached to,
 * a free sketch is nobody's business but the person who drew it.
 */
export function deleteRelationsWithShapes(editor: Editor): () => void {
	return editor.sideEffects.registerAfterDeleteHandler('binding', (binding) => {
		if (binding.type !== 'arrow') return
		// Still there: an unbind, not a bereavement.
		if (editor.getShape(binding.toId)) return
		const arrow = editor.getShape(binding.fromId)
		if (!arrow || arrow.type !== 'arrow') return
		// Already gone when both ends were deleted at once — the first binding's handler took it.
		editor.deleteShapes([arrow.id])
	})
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

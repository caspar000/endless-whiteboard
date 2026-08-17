import { isHiddenRelation, isRelation, isRelationDrawn, readRelationView } from '@lifeboard/node-kit'
import { react, type Editor, type TLShape } from 'tldraw'
import { getTrace } from './tracing'

/**
 * Which shapes tldraw draws — the one place hiding a relation actually takes effect.
 *
 * `getShapeVisibility` is a *view* hook: it changes nothing in the store, so hiding a relation makes
 * no undo entry, syncs nothing to another tab, and survives being toggled a hundred times. tldraw
 * takes a hidden shape out of rendering, hit-testing, hovering and brush selection for free, which is
 * exactly the whole behaviour we want and none of which we would get right by hand.
 *
 * Three rules govern the body, and each of them is load-bearing:
 *
 * 1. **Only arrows.** Everything else returns `inherit` immediately — this runs for every shape on
 *    the board, so the common case has to be one comparison.
 *
 * 2. **Only relations.** An arrow with a loose end is a drawing, and a "relation view" that made
 *    someone's sketch vanish would be a bug. That question is asked with `isRelation`, which reads
 *    the shape's bindings, and deliberately *not* with the edge index: `getPageEdges` depends on
 *    every shape on the page, so consulting it here would tie every shape's visibility to every
 *    shape's position.
 *
 * 3. **Cheap.** `Editor.isShapeHidden` memoises per shape and invalidates when a signal read in here
 *    changes, so the whole board repaints when the view mode does — but the body itself re-runs per
 *    shape, and anything that walked the page here would be paid for on every one of them.
 *
 * Must be a **module-scope constant**. It feeds the Editor constructor, so a new identity on each
 * render would remount the editor — and a remount inside tldraw's persistence throttle discards the
 * pending write along with the camera, the selection and the undo history (see Board.tsx).
 */
export const getShapeVisibility = (shape: TLShape, editor: Editor): 'hidden' | 'inherit' => {
	if (shape.type !== 'arrow') return 'inherit'

	/*
	 * Decide it from the arrow's own record first, and only ask what it is *bound to* if the answer
	 * could still come out "hidden".
	 *
	 * The ordering is the point, not a micro-optimisation. `isRelation` goes through
	 * `getBindingsFromShape`, which is a store query — so asking it here makes this shape's cached
	 * visibility depend on the binding index, and tldraw consults that cache from the middle of its
	 * rendering and hit-testing paths. Asking it for every arrow on every board, including the
	 * overwhelmingly common case where nothing is hidden and the answer cannot matter, was enough to
	 * destabilise rich-text editing: `e2e/ui.spec.ts`'s sticky-suggestion test lost its keystrokes,
	 * reproducibly, and got them back the moment this query stopped running.
	 *
	 * So: a board in the default view with no hidden relations never reaches the query at all.
	 */
	const traced = getTrace(editor).get()?.arrows.has(shape.id) === true
	if (!isRelationDrawn(readRelationView(editor), isHiddenRelation(shape), traced)) {
		// Only a *relation* obeys the relation view. An arrow with a loose end is a drawing, and a view
		// that made someone's sketch vanish would be a bug rather than a feature.
		return isRelation(editor, shape) ? 'hidden' : 'inherit'
	}
	return 'inherit'
}

/**
 * Drops a shape from the selection when it stops being drawn.
 *
 * Hiding is a view, so tldraw has no reason to touch the selection — which leaves the primary gesture
 * looking broken: click a relation, press the eye button that appears, and the arrow disappears while
 * its selection ring and the toolbar that just acted on it stay floating over empty canvas. The same
 * thing happens on the way in from every other door (⌘K, the keyboard, an agent setting the board to
 * `none`), which is why this is one reaction over the selection rather than a line in each of them.
 *
 * `isShapeHidden` is a computed over the shape *and* the board's view, so this re-runs when either
 * moves. It converges: the write makes the filtered list equal the selection, so the next run is a
 * no-op.
 */
export function deselectHiddenShapes(editor: Editor): () => void {
	return react('lifeboard:deselect-hidden', () => {
		const selected = editor.getSelectedShapeIds()
		if (!selected.length) return
		const visible = selected.filter((id) => !editor.isShapeHidden(id))
		if (visible.length !== selected.length) editor.setSelectedShapes(visible)
	})
}

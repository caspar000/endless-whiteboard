import { HIDDEN_RELATION_META, isHiddenRelation, useExpressionShape } from '@lifeboard/node-kit'
import {
	ArrowShapeUtil,
	GeoShapeUtil,
	NoteShapeUtil,
	TextShapeUtil,
	getArrowBindings,
	type TLArrowShape,
	type TLGeoShape,
	type TLHandleDragInfo,
	type TLNoteShape,
	type TLTextShape,
} from 'tldraw'

/**
 * tldraw's own text-bearing shapes, taught to evaluate `{…}`.
 *
 * The note node renders its own markdown, so it could do this itself. A sticky cannot: its text is
 * drawn by a component we do not own. So the substitution happens one level up — each util hands its
 * parent a shape whose `richText` has already been evaluated, and the parent draws it none the wiser.
 * Nothing reaches the store; the sticky still says `{sum price in}` when you go back to edit it.
 *
 * `component()` is called during a React render — tldraw's own image util uses `useState` and
 * `useEffect` in exactly this position — so a hook here is legal, and `super` resolves inside the
 * arrow because it is lexically bound to the method.
 *
 * Replacing a built-in works the same way the frame does: `<Tldraw>` merges shape utils by type with
 * `mergeArraysAndReplaceDefaults('type', …)`, so a `note` util here takes the default's place.
 */

class ExpressionNoteShapeUtil extends NoteShapeUtil {
	override component(shape: TLNoteShape) {
		return super.component(useExpressionShape(this.editor, shape))
	}
}

class ExpressionTextShapeUtil extends TextShapeUtil {
	override component(shape: TLTextShape) {
		return super.component(useExpressionShape(this.editor, shape))
	}
}

/** Covers the label on a rectangle, ellipse, cloud and the rest — they are all one shape type. */
class ExpressionGeoShapeUtil extends GeoShapeUtil {
	override component(shape: TLGeoShape) {
		return super.component(useExpressionShape(this.editor, shape))
	}
}

/**
 * A hidden relation reads as dashed, derived rather than stored.
 *
 * The meta flag is the single source of truth for whether a relation is drawn (see node-kit's
 * `relations.ts`). Writing `dash: 'dashed'` into the record instead would give the same picture and a
 * second truth: change an arrow's dash style from the style panel and it would be half-unhidden —
 * dotted but still counted as hidden, or solid and still invisible. So the dash is computed on the
 * way to the renderer, exactly as the `{…}` substitution is, and nothing reaches the store.
 *
 * Same reference back when there is nothing to change, so every memo downstream still hits.
 */
function withRelationDash(shape: TLArrowShape): TLArrowShape {
	if (!isHiddenRelation(shape) || shape.props.dash === 'dashed') return shape
	return { ...shape, props: { ...shape.props, dash: 'dashed' } }
}

/**
 * Which terminal is on the other end of the one being dragged. `null` for the bend handle, which is
 * neither.
 */
function oppositeTerminal(handleId: string): 'start' | 'end' | null {
	if (handleId === 'start') return 'end'
	if (handleId === 'end') return 'start'
	return null
}

class ExpressionArrowShapeUtil extends ArrowShapeUtil {
	override component(shape: TLArrowShape) {
		return super.component(useExpressionShape(this.editor, withRelationDash(shape)))
	}

	/**
	 * Shift, while you are drawing a *relation*, means "make it a hidden one".
	 *
	 * Shift already meant something here: `DraggingHandle` snaps the dragged endpoint to 15° steps
	 * around the opposite terminal before this method is ever called. Left alone, that would break
	 * the gesture rather than merely decorate it — `onTerminalHandleDrag` picks the shape to bind to
	 * from the handle point it is given, so a snapped point that lands beside the target binds to
	 * nothing and the relation you drew silently stays a doodle.
	 *
	 * So the lock is undone, but only where it was already meaningless: once the other end is bound
	 * to a shape, tldraw recomputes the whole line from the two shapes' bounds every frame and throws
	 * the dragged geometry away, so angle-locking a relation never had a visible effect. Shift keeps
	 * its normal meaning for every arrow that is not one — a doodle across empty space still locks.
	 *
	 * Restricted to `isCreatingShape`: dragging an existing relation's endpoint is a repair, and
	 * having it flip to hidden because shift happened to be down would be a trap.
	 */
	// Return type inferred from `super`: `ArrowShapeUtil` narrows the base's `… | void` to a union of
	// partials, and re-declaring it here would only be a copy that drifts.
	override onHandleDrag(
		shape: TLArrowShape,
		info: TLHandleDragInfo<TLArrowShape>
	): ReturnType<ArrowShapeUtil['onHandleDrag']> {
		const opposite = info.isCreatingShape ? oppositeTerminal(info.handle.id) : null
		const drawingRelation = opposite !== null && !!getArrowBindings(this.editor, shape)[opposite]
		const shift = this.editor.inputs.getShiftKey()

		let next = info
		if (drawingRelation && shift) {
			// The pointer's real position, in the arrow's own space — the point `DraggingHandle` would
			// have passed on if shift did not rotate it first, and the same conversion tldraw's own
			// arrow tool does. This also discards the snap nudge, which is the same bargain: neither
			// can survive a bound terminal anyway.
			const local = this.editor.getPointInShapeSpace(shape, this.editor.inputs.getCurrentPagePoint())
			next = { ...info, handle: { ...info.handle, x: local.x, y: local.y } }
		}

		const changes = super.onHandleDrag(shape, next)

		// Written only on the frame the state actually changes — press or release, not every pointer
		// move. A fresh `meta` object each frame would invalidate this arrow's cached facts on every
		// one of them, which is exactly the churn the facts pipeline (§4.3) is built to avoid.
		const hidden = drawingRelation && shift
		if (!drawingRelation || hidden === isHiddenRelation(shape)) return changes
		return {
			...(changes ?? { id: shape.id, type: 'arrow' as const }),
			meta: { [HIDDEN_RELATION_META]: hidden },
		}
	}
}

export const expressionShapeUtils = [
	ExpressionNoteShapeUtil,
	ExpressionTextShapeUtil,
	ExpressionGeoShapeUtil,
	ExpressionArrowShapeUtil,
]

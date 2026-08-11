import { useExpressionShape } from '@lifeboard/node-kit'
import {
	ArrowShapeUtil,
	GeoShapeUtil,
	NoteShapeUtil,
	TextShapeUtil,
	type TLArrowShape,
	type TLGeoShape,
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

class ExpressionArrowShapeUtil extends ArrowShapeUtil {
	override component(shape: TLArrowShape) {
		return super.component(useExpressionShape(this.editor, shape))
	}
}

export const expressionShapeUtils = [
	ExpressionNoteShapeUtil,
	ExpressionTextShapeUtil,
	ExpressionGeoShapeUtil,
	ExpressionArrowShapeUtil,
]

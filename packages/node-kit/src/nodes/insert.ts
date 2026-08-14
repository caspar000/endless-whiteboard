import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import type { NodeDefinition } from '../registry'

/**
 * Putting a node on a board, without deciding what should happen next.
 *
 * The app's `insertNode` adds selection and edit mode on top, because a person who just clicked "Add
 * note" wants a cursor in it. An agent does not — there is nobody typing, and entering edit mode
 * would steal the caret from whoever is. Both need the *same* shape created at the same place, so
 * that part lives here and the two callers differ only in what they do afterwards.
 */
export function createNodeShape(
	editor: Editor,
	def: NodeDefinition<never>,
	/** Page coordinates the shape is centred on. */
	point: { x: number; y: number },
	/** Overrides merged onto the definition's defaults — tldraw fills in whatever is missing. */
	props?: Record<string, unknown>
): TLShapeId {
	const id = createShapeId()
	editor.run(() => {
		editor.createShapes([
			{
				id,
				type: def.type,
				x: point.x - def.defaultSize.w / 2,
				y: point.y - def.defaultSize.h / 2,
				...(props ? { props } : {}),
			} as never,
		])
	})
	return id
}

/**
 * Which prop holds this node's text, if any — `md` for a markdown note, `text` for a quote.
 *
 * A *heuristic*, deliberately, and read off `defaultProps()` rather than hardcoded per type: nothing
 * in `NodeDefinition` declares a text prop today, and adding one would change the SDK contract for
 * every extension including the runtime-loaded ones that do not exist yet. `shapeLabel` has the same
 * problem in the read direction and solves it with a ladder; this is that ladder's other half.
 *
 * When a `NodeDefinition.textProp` field eventually earns its place, this function becomes its
 * fallback and no operation signature changes.
 */
const TEXT_PROPS = ['md', 'text'] as const

export function textPropFor(def: NodeDefinition<never>): string | null {
	const defaults = def.defaultProps() as Record<string, unknown>
	for (const key of TEXT_PROPS) {
		if (typeof defaults[key] === 'string') return key
	}
	return null
}

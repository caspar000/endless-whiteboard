import { useValue, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { getPageEdges, getPageFacts } from '../nodes/rollup/engine'
import { getCurrentRates } from '../properties/rates'
import { propertyMap, readPropertyRegistry } from '../properties/schema'
import { readShapeProperties, readShapePropertyUnits } from '../properties/values'
import { renderExpressions } from './expressions'

/**
 * `{…}` in the text of tldraw's own shapes — stickies, text, labelled rectangles, arrow labels.
 *
 * The note node got expressions first because it owns its renderer. Everywhere else the text belongs
 * to a component we do not control, so the substitution happens one level up: the shape util hands
 * its parent a shape whose `richText` has already been evaluated, and the parent renders it none the
 * wiser. Nothing is written to the store — the shape on disk still says `{sum price in}`.
 *
 * Legal as a hook because tldraw calls `component()` during a React render and its own utils call
 * hooks there too (the image util uses `useState` and `useEffect` in exactly this position).
 */

/**
 * A shape whose text we can substitute.
 *
 * Asks for only what is read — an id, meta, and a `richText` of unknown shape — rather than naming
 * the four shape types. `TLShape` is a closed union, so extending it would mean listing them and
 * relisting them whenever tldraw adds a fifth; this way any util can pass its own shape through
 * without a cast, and the type still says something true.
 */
export interface ShapeWithRichText {
	id: TLShapeId
	meta: TLShape['meta']
	props: { richText: unknown }
}

export function useExpressionShape<S extends ShapeWithRichText>(editor: Editor, shape: S): S {
	const richText = useValue(
		'lifeboard:shape-expressions',
		() => {
			/*
			 * While you are editing, the shape shows what you typed.
			 *
			 * Without this the caret would sit in text that rewrites itself as you type — you would go
			 * to correct `{sum pric` and find the editor had replaced it with a number under your
			 * hands. Reading the editing id inside the computed means switching in and out of edit mode
			 * re-runs this on its own.
			 */
			if (editor.getEditingShapeId() === shape.id) return shape.props.richText
			return substituteRichText(shape.props.richText, (text) =>
				renderExpressions(text, {
					facts: getPageFacts(editor).get(),
					edges: getPageEdges(editor).get(),
					properties: propertyMap(readPropertyRegistry(editor)),
					rates: getCurrentRates(),
					selfId: shape.id,
					values: readShapeProperties(shape),
					units: readShapePropertyUnits(shape),
				})
			)
		},
		// Narrow on purpose: a sticky rewrites its own record as it auto-sizes, and none of that can
		// change the text.
		[editor, shape.id, shape.props.richText, shape.meta]
	)

	// Same reference when nothing was substituted, so the shape passed on is the one that arrived and
	// every memo downstream still hits.
	return richText === shape.props.richText ? shape : { ...shape, props: { ...shape.props, richText } }
}

/**
 * Applies `fn` to every text node in a rich-text document, returning the original when nothing moved.
 *
 * Walks untyped rather than against a schema: `TLRichText` is ProseMirror's JSON, which tldraw
 * validates but does not expose a node type for, and a walker that only touches `{ text: string }`
 * cannot be wrong about the rest of the tree whatever ends up in it.
 *
 * An expression split across two text nodes — half of it bolded — is left alone. Recombining spans
 * would mean deciding which half's formatting the answer inherits, and the answer is that nobody
 * bolds half an expression.
 */
export function substituteRichText(rich: unknown, fn: (text: string) => string): unknown {
	if (Array.isArray(rich)) {
		let changed = false
		const next = rich.map((entry) => {
			const mapped = substituteRichText(entry, fn)
			if (mapped !== entry) changed = true
			return mapped
		})
		return changed ? next : rich
	}
	if (!rich || typeof rich !== 'object') return rich

	const node = rich as Record<string, unknown>
	let changed = false
	const next: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(node)) {
		if (key === 'text' && typeof value === 'string') {
			const replaced = fn(value)
			if (replaced !== value) changed = true
			next[key] = replaced
			continue
		}
		const mapped = substituteRichText(value, fn)
		if (mapped !== value) changed = true
		next[key] = mapped
	}
	return changed ? next : rich
}

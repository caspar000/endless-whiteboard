import { T, type Editor, type TLShape, type TLShapePartial } from 'tldraw'
import {
	SUMMARY_OPS,
	tableSourceValidator,
	type SummaryOp,
	type TableSource,
} from '../nodes/table/spec'
import type { ShapeWithMeta } from '../properties/values'

/**
 * What a shape **gathers**, as opposed to what it **is**.
 *
 * The distinction is the whole design. A shape's own values say "this sticky costs ₾2,000"; a
 * collection says "show me everything pointing at me". Both live in `shape.meta`, but they are
 * different kinds of statement and the panel keeps them in separate sections — merging them into one
 * list is how a table ended up being a *type of node* instead of a thing any node can do.
 *
 * Deliberately **not** a `PropertyType`. A property value is a JSON scalar carried by the shape and
 * compared one level deep, which is what keeps dragging free of recomputes; a collection is a query,
 * and putting a query where a scalar goes would have broken that for every property at once.
 *
 * Stored under its own meta key, flat like the rest, because `updateShape` merges meta only one level
 * deep — see `properties/values.ts` for the same reasoning applied to values, order and units.
 */
const COLLECTION_KEY = 'lifeboard:collection'

/**
 * How a gathered set is shown.
 *
 * `value` is one number: the case that was impossible before without building a whole table beside
 * the thing you wanted the number for. `list` is the rows themselves, labelled.
 */
export const COLLECTION_VIEWS = ['value', 'list'] as const
export type CollectionView = (typeof COLLECTION_VIEWS)[number]

export interface Collection {
	/**
	 * Which shapes are in scope. The same selector a table uses — page, frame, arrows in or out, plus
	 * filters — because "what counts" is one question whatever you do with the answer.
	 */
	source: TableSource
	view: CollectionView
	/** What to do with them: sum, count, average… */
	op: SummaryOp
	/** The property to summarise. `null` counts rows and ignores `op`'s numeric half. */
	property: string | null
}

export const collectionValidator: T.Validatable<Collection> = T.object({
	source: tableSourceValidator,
	view: T.literalEnum(...COLLECTION_VIEWS),
	op: T.literalEnum(...SUMMARY_OPS),
	property: T.string.nullable(),
})

/**
 * What a shape starts gathering when you switch it on.
 *
 * Arrows in, counting. Not "everything on the page": a shape that suddenly reports a number about the
 * whole board is a shape you have to go and configure before it says anything true, whereas one that
 * counts what points at it says nothing until you draw an arrow — and then says something obviously
 * right. Counting rather than summing for the same reason: a count is correct before a property has
 * been chosen, a sum of nothing is a zero that looks like an answer.
 */
export function defaultCollection(): Collection {
	return {
		source: { shapeTypes: null, scope: 'connected', frameId: null, direction: 'in', filters: [] },
		view: 'value',
		op: 'count',
		property: null,
	}
}

/** The collection a shape carries, or `null`. Malformed meta reads as absent, never as a throw. */
export function readCollection(shape: ShapeWithMeta): Collection | null {
	const raw = shape.meta[COLLECTION_KEY]
	if (!raw) return null
	try {
		return collectionValidator.validate(raw)
	} catch {
		return null
	}
}

/** Cheap enough to run over every shape on the page — no validation, just presence. */
export function hasCollection(shape: ShapeWithMeta): boolean {
	return Boolean(shape.meta[COLLECTION_KEY])
}

export function setCollection(editor: Editor, shape: TLShape, next: Collection | null): void {
	editor.run(() => {
		editor.markHistoryStoppingPoint('collection')
		editor.updateShape({
			id: shape.id,
			type: shape.type,
			// One key, not a spread: `updateShape` merges meta one level deep, which is the same reason
			// every property sidecar is a flat top-level key rather than a nested object.
			//
			// `false` rather than a delete when switching off — `undefined` is not a JSON value, and
			// meta is validated as one.
			meta: { [COLLECTION_KEY]: next ? next : false },
		} as TLShapePartial)
	})
}

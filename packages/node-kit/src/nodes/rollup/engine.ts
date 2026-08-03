import {
	computed,
	createComputedCache,
	type Computed,
	type Editor,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import { areFactsEqual, areFactsMapsEqual, type FactsMap, type ShapeFacts } from '../../facts'
import { shapeLabel } from '../../properties/labels'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import { readShapeProperties } from '../../properties/values'
import { getNodeDefinition } from '../../registry'
import { aggregate, EMPTY_ROLLUP, type RollupResult } from './aggregate'
import { ROLLUP_NODE_TYPE } from './definition'

/**
 * The reactive pipeline (§4.3), three stages since properties went universal.
 *
 * Stage 0 — `factsCache`: one `createComputedCache` entry per *shape*, holding that shape's facts.
 * This is what makes universality affordable. Facts now come from every shape on the board, so
 * without it a single pointer move would re-validate meta and re-extract text for all 500 shapes.
 * With it, a drag frame is 500 cheap signal reads returning the **same object references**, so
 * `areFactsEqual`'s `a === b` fast path fires and stage 1 is nearly free.
 *
 * Stage 1 — `pageFacts`: one `computed` per page mapping shape id → facts, with a custom `isEqual`.
 * tldraw's store is signals-based, so this computed is invalidated by *any* shape write, including
 * the x/y churn of a drag. But dragging leaves facts identical, so `isEqual` reports no change and
 * nothing downstream recomputes. (Pointer, camera and selection live in session-scoped records this
 * never reads, so pan, zoom and hover are already invisible to it.)
 *
 * Stage 2 — one cache entry per rollup shape, aggregating the facts map against that shape's spec.
 * Components subscribe via `useValue`.
 *
 * Results are never written back to the store: a rollup is a pure derivation, which keeps undo
 * history clean, avoids feedback loops, and is safe under future CRDT sync.
 */

/** Dev-only recompute counters — the regression tripwire for milestone 6's acceptance check. */
export const rollupStats = {
	factsRecomputes: 0,
	shapeFactsRecomputes: 0,
	aggregateRecomputes: 0,
	reset() {
		this.factsRecomputes = 0
		this.shapeFactsRecomputes = 0
		this.aggregateRecomputes = 0
	},
}

/**
 * Stage 0. The comparator is the entire point: it lists everything facts are derived from and
 * **nothing positional**, so moving a shape does not invalidate its facts.
 */
const factsCache = createComputedCache<Editor, ShapeFacts, TLShape>(
	'lifeboard:shapeFacts',
	(editor, shape) => {
		rollupStats.shapeFactsRecomputes++
		const stored = readShapeProperties(shape)
		// A node may also *compute* values from its own props — the legacy item node's route, and the
		// seam a future computed node would use. Stored values win: they are what the user edited.
		const computedValues = getNodeDefinition(shape.type)?.extractValues?.(shape as never)
		return {
			type: shape.type,
			parentId: shape.parentId ?? null,
			label: shapeLabel(editor, shape),
			values: computedValues ? { ...computedValues, ...stored } : stored,
		}
	},
	{
		// `updateShape` replaces the `props`/`meta` objects only when they actually change, so
		// reference equality is the right (and cheapest) test. Dragging rewrites x/y, which appear
		// nowhere here — that omission is what keeps a drag free of recomputes.
		areRecordsEqual: (a, b) =>
			a.id === b.id &&
			a.type === b.type &&
			a.props === b.props &&
			a.meta === b.meta &&
			a.parentId === b.parentId,
		areResultsEqual: areFactsEqual,
	}
)

// One facts computed per editor instance. Keyed weakly so a disposed editor (board switch) doesn't
// retain its facts map.
const factsByEditor = new WeakMap<Editor, Computed<FactsMap>>()

export function getPageFacts(editor: Editor): Computed<FactsMap> {
	const existing = factsByEditor.get(editor)
	if (existing) return existing

	const facts = computed<FactsMap>(
		'lifeboard:pageFacts',
		() => {
			rollupStats.factsRecomputes++
			const map = new Map<string, ShapeFacts>()
			// `getCurrentPageShapes` reads only shape records, so the computed depends on shapes and
			// the current page id — not on camera or pointer state.
			for (const shape of editor.getCurrentPageShapes()) {
				// Every shape, not just registered node types: that is what "any shape can carry a
				// property" means downstream.
				const shapeFacts = factsCache.get(editor, shape.id)
				if (shapeFacts) map.set(shape.id, shapeFacts)
			}
			return map
		},
		{ isEqual: areFactsMapsEqual }
	)

	factsByEditor.set(editor, facts)
	return facts
}

/**
 * Per-rollup aggregation. `createComputedCache` gives one cache entry per shape id, invalidated when
 * that shape record changes — so editing one rollup's config doesn't recompute the others.
 */
const rollupCache = createComputedCache<Editor, RollupResult, TLShape>(
	'lifeboard:rollup',
	(editor, shape) => {
		if (shape.type !== ROLLUP_NODE_TYPE) return EMPTY_ROLLUP
		rollupStats.aggregateRecomputes++
		const { source, agg } = shape.props
		const properties = propertyMap(readPropertyRegistry(editor))
		return aggregate(getPageFacts(editor).get(), source, agg, shape.id, properties)
	},
	{
		// A rollup shape being dragged rewrites x/y. Without this, the cache entry would be
		// invalidated and re-aggregate on every pointer move even though its spec is unchanged.
		//
		// `meta` is compared too, and must be: a rollup's own properties live there now, so a
		// meta-only change is a real change. Omitting it was a latent bug the moment properties
		// stopped living exclusively in props.
		areRecordsEqual: (a, b) => a.id === b.id && a.props === b.props && a.meta === b.meta,
		areResultsEqual: areRollupResultsEqual,
	}
)

export function getRollupResult(editor: Editor, shapeId: TLShapeId): RollupResult {
	return rollupCache.get(editor, shapeId) ?? EMPTY_ROLLUP
}

export function areRollupResultsEqual(a: RollupResult, b: RollupResult): boolean {
	if (a === b) return true
	if (
		a.total !== b.total ||
		a.matched !== b.matched ||
		a.skipped !== b.skipped ||
		a.inferredUnit !== b.inferredUnit ||
		a.rows.length !== b.rows.length
	) {
		return false
	}
	for (let i = 0; i < a.rows.length; i++) {
		const rowA = a.rows[i]!
		const rowB = b.rows[i]!
		if (rowA.group !== rowB.group || rowA.value !== rowB.value || rowA.count !== rowB.count) {
			return false
		}
	}
	return true
}

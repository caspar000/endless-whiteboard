import {
	computed,
	createComputedCache,
	type Computed,
	type Editor,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import {
	areEdgeIndexesEqual,
	buildEdgeIndex,
	type Edge,
	type EdgeIndex,
} from '../../edges'
import { areFactsEqual, areFactsMapsEqual, type FactsMap, type ShapeFacts } from '../../facts'
import { shapeLabel } from '../../properties/labels'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import { readShapeProperties, readShapePropertyUnits } from '../../properties/values'
import { getNodeDefinition } from '../../registry'
import { relationEnds } from '../../relations'
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
	edgeRecomputes: 0,
	reset() {
		this.factsRecomputes = 0
		this.shapeFactsRecomputes = 0
		this.aggregateRecomputes = 0
		this.edgeRecomputes = 0
	},
}

/**
 * Stage 0. The comparator is the entire point: it lists everything facts are derived from and
 * **nothing positional**, so moving a shape does not invalidate its facts.
 */
/**
 * What one shape's facts *are*, with no caching in the way.
 *
 * Split out from the cache below so there is one definition of a shape's facts and two ways to
 * reach it. The reactive path exists to keep the UI free of recomputes during a drag; a one-shot
 * caller — an agent operation asking a board a question — has nothing to keep quiet and should not
 * have to stand up tldraw's computed-cache machinery to ask.
 */
export function shapeFacts(editor: Editor, shape: TLShape): ShapeFacts {
	const stored = readShapeProperties(shape)
	// A node may also *compute* values from its own props — the legacy item node's route, and the
	// seam a future computed node would use. Stored values win: they are what the user edited.
	const computedValues = getNodeDefinition(shape.type)?.extractValues?.(shape as never)
	return {
		type: shape.type,
		parentId: shape.parentId ?? null,
		label: shapeLabel(editor, shape),
		values: computedValues ? { ...computedValues, ...stored } : stored,
		units: readShapePropertyUnits(shape),
	}
}

const factsCache = createComputedCache<Editor, ShapeFacts, TLShape>(
	'lifeboard:shapeFacts',
	(editor, shape) => {
		rollupStats.shapeFactsRecomputes++
		return shapeFacts(editor, shape)
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
 * The whole page's facts, computed once and not cached — the one-shot counterpart to
 * `getPageFacts`.
 *
 * For a caller that asks a question and is done: an agent operation, a script, a test. It walks the
 * page and returns a plain map, taking no reactive dependency and leaving no cache entry behind.
 * Anything that renders should use `getPageFacts` instead, or it will recompute on every frame of a
 * drag — which is precisely what the cached path was built to avoid.
 */
export function readPageFacts(editor: Editor): FactsMap {
	const map = new Map<string, ShapeFacts>()
	for (const shape of editor.getCurrentPageShapes()) map.set(shape.id, shapeFacts(editor, shape))
	return map
}

const edgesByEditor = new WeakMap<Editor, Computed<EdgeIndex>>()

/**
 * The page's arrows as a graph, alongside the facts map and on the same terms.
 *
 * Rebuilt whenever any shape changes — a drag included, since moving a shape moves the arrows bound
 * to it — and guarded by `areEdgeIndexesEqual`, which compares topology and nothing else. So the
 * rebuild is a cheap walk of the arrows and the query behind it never notices.
 *
 * Read *only* by tables scoped to `connected`. Everything else avoids the call and so never takes the
 * dependency at all, which keeps the common case exactly as cheap as it was.
 */
export function getPageEdges(editor: Editor): Computed<EdgeIndex> {
	const existing = edgesByEditor.get(editor)
	if (existing) return existing

	const edges = computed<EdgeIndex>(
		'lifeboard:pageEdges',
		() => {
			rollupStats.edgeRecomputes++
			const found: Edge[] = []
			for (const shape of editor.getCurrentPageShapes()) {
				// What counts as a relation lives in `relations.ts`, so the graph read here and the
				// controls that write it cannot drift apart. Visibility is deliberately not consulted:
				// a hidden relation is still an edge, which is the whole point of being able to hide one.
				const ends = relationEnds(editor, shape)
				if (ends) found.push({ id: shape.id, ...ends })
			}
			return buildEdgeIndex(found)
		},
		{ isEqual: areEdgeIndexesEqual }
	)

	edgesByEditor.set(editor, edges)
	return edges
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

import {
	computed,
	createComputedCache,
	type Computed,
	type Editor,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import { areFactsMapsEqual, type FactsMap, type NodeFacts } from '../../facts'
import { getNodeDefinition } from '../../registry'
import { aggregate, EMPTY_ROLLUP, type RollupResult } from './aggregate'
import { ROLLUP_NODE_TYPE, type RollupNodeProps } from './definition'

/**
 * The two-stage reactive pipeline (§4.3).
 *
 * Stage 1 — `pageFacts`: one `computed` per page that maps shape id → `NodeFacts`, with a custom
 * `isEqual`. tldraw's store is signals-based, so this computed's inputs are invalidated by *any*
 * shape write, including the x/y churn of a drag. But dragging leaves facts identical, so `isEqual`
 * returns true and the computed's value is considered unchanged — nothing downstream recomputes.
 * (Pointer, camera and selection live in session-scoped records, which this never reads, so pan,
 * zoom and hover are already invisible to it.)
 *
 * Stage 2 — one `createComputedCache` entry per rollup shape, which aggregates the facts map
 * against that shape's own spec. Components subscribe via `useValue`.
 *
 * Results are never written back to the store: a rollup is a pure derivation, which keeps undo
 * history clean, avoids feedback loops, and is safe under future CRDT sync.
 */

// One facts computed per editor instance. Keyed weakly so a disposed editor (board switch) doesn't
// retain its facts map.
const factsByEditor = new WeakMap<Editor, Computed<FactsMap>>()

/** Dev-only recompute counters — the regression tripwire for milestone 6's acceptance check. */
export const rollupStats = {
	factsRecomputes: 0,
	aggregateRecomputes: 0,
	reset() {
		this.factsRecomputes = 0
		this.aggregateRecomputes = 0
	},
}

export function getPageFacts(editor: Editor): Computed<FactsMap> {
	const existing = factsByEditor.get(editor)
	if (existing) return existing

	const facts = computed<FactsMap>(
		'lifeboard:pageFacts',
		() => {
			rollupStats.factsRecomputes++
			const map = new Map<string, NodeFacts>()
			// `getCurrentPageShapes` reads only shape records, so the computed depends on shapes and
			// the current page id — not on camera or pointer state.
			for (const shape of editor.getCurrentPageShapes()) {
				const def = getNodeDefinition(shape.type)
				if (!def?.extractFacts) continue
				const extracted = def.extractFacts(shape as never)
				if (extracted) map.set(shape.id, extracted)
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
		return aggregate(getPageFacts(editor).get(), source, agg, shape.id)
	},
	{
		// A rollup shape being dragged rewrites x/y. Without this, the cache entry would be
		// invalidated and re-aggregate on every pointer move even though its spec is unchanged.
		// tldraw's `updateShape` replaces the props object only when props actually change, so
		// reference equality is the right (and cheapest) test here.
		areRecordsEqual: (a, b) => a.id === b.id && a.props === b.props,
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

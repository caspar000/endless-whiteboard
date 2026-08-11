import { useValue, type Editor } from 'tldraw'
import { getPageEdges, getPageFacts } from '../nodes/rollup/engine'
import { formatCurrency, formatNumber } from '../properties/format'
import { getCurrentRates } from '../properties/rates'
import { propertyMap, readPropertyRegistry } from '../properties/schema'
import type { ShapeWithMeta } from '../properties/values'
import { runCollection, type CollectionResult } from './engine'
import { readCollection } from './spec'

/**
 * What a shape gathers, drawn under what the shape *is*.
 *
 * Alongside rather than instead of: a sticky that says "October" and shows ₾4,200 underneath is still
 * a sticky you wrote, with a derived footer. Replacing the content would turn every collecting shape
 * into a readout and lose the label that says what the number means.
 *
 * Sits directly below `PropertyStrip` in every layout, because the two answer adjacent questions —
 * what this is, then what it adds up to — and a reader should not have to look in two places.
 */
export function CollectionStrip({ shape, editor }: { shape: ShapeWithMeta; editor: Editor }) {
	const state = useValue(
		'lifeboard:collection-strip',
		() => {
			const collection = readCollection(shape)
			if (!collection) return null
			/*
			 * Read straight from the pipeline rather than through a per-shape computed cache.
			 *
			 * A collection is a *view* concern, like `ForeignPropertyStrips`: it may re-render freely
			 * while shapes move. The facts map and the edge index are the memoised parts, and both
			 * report no change during a drag — so this recomputes only when something it actually
			 * depends on moves, and the rollup recompute budget the perf spec guards is untouched.
			 */
			const facts = getPageFacts(editor).get()
			const edges = getPageEdges(editor).get()
			const registry = propertyMap(readPropertyRegistry(editor))
			const selfId = (shape as unknown as { id: string }).id
			return {
				view: collection.view,
				result: runCollection(facts, collection, selfId, registry, getCurrentRates(), edges),
			}
		},
		[editor, shape]
	)

	if (!state) return null
	return state.view === 'list' ? (
		<CollectionList result={state.result} />
	) : (
		<CollectionValue result={state.result} />
	)
}

/** The number, with the count that produced it — a total nobody can size up is a total nobody trusts. */
function CollectionValue({ result }: { result: CollectionResult }) {
	const text =
		result.value === null
			? '—'
			: result.unit
				? formatCurrency(result.value, result.unit)
				: formatNumber(result.value)
	return (
		<div className="lb-collect">
			<span className="lb-collect__value">{text}</span>
			<span className="lb-collect__count">
				{result.matched} {result.matched === 1 ? 'item' : 'items'}
			</span>
		</div>
	)
}

function CollectionList({ result }: { result: CollectionResult }) {
	if (!result.rows.length) {
		return (
			<div className="lb-collect">
				<span className="lb-collect__count">Nothing yet</span>
			</div>
		)
	}
	return (
		<dl className="lb-collect__list">
			{result.rows.map((row) => (
				<div className="lb-collect__line" key={row.shapeId}>
					{/* Never blank: an unnamed shape still has to occupy a line, or the list silently
					    under-reports what it found. */}
					<dt>{row.label || 'Untitled'}</dt>
					{row.text && <dd>{row.text}</dd>}
				</div>
			))}
		</dl>
	)
}

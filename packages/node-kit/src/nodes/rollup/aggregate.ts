import {
	areFactsMapsEqual,
	isEmptyValue,
	listValuesOf,
	type FactsMap,
	type ShapeFacts,
} from '../../facts'
import {
	formatCurrency,
	formatNumber,
	groupKeysForValue,
	numericPropertyValue,
} from '../../properties/format'
import type { PropertyDef } from '../../properties/types'

export const AGG_OPS = ['sum', 'count', 'avg', 'min', 'max'] as const
export type AggOp = (typeof AGG_OPS)[number]

export const SOURCE_SCOPES = ['page', 'frame', 'tags'] as const
export type SourceScope = (typeof SOURCE_SCOPES)[number]

export const FORMAT_STYLES = ['number', 'currency'] as const
export type FormatStyle = (typeof FORMAT_STYLES)[number]

export interface RollupSource {
	scope: SourceScope
	frameId: string | null
	tags: string[]
	nodeType: string | null
}

export interface RollupAgg {
	op: AggOp
	/**
	 * The **property id** to aggregate.
	 *
	 * Still named `fieldKey` because it is a persisted prop on every existing `node.rollup`, and the
	 * item→note migration derives property ids with the same slug function that produced field keys —
	 * so an existing rollup keeps pointing at the same data with no props migration at all.
	 */
	fieldKey: string | null
	/** The property id to group by. */
	groupBy: string | null
}

export interface RollupFormat {
	style: FormatStyle
	unit?: string
}

/** One row of output. Ungrouped rollups produce a single row with `group: null`. */
export interface RollupRow {
	group: string | null
	value: number
	count: number
}

export interface RollupResult {
	rows: RollupRow[]
	/** Total across every matched node, regardless of grouping. */
	total: number
	/** Number of nodes that matched the source selector. */
	matched: number
	/** Matched nodes that had no usable numeric value for `fieldKey`. */
	skipped: number
	/** Unit inferred from the source data when the rollup itself doesn't pin one. */
	inferredUnit: string | undefined
}

export const EMPTY_ROLLUP: RollupResult = {
	rows: [],
	total: 0,
	matched: 0,
	skipped: 0,
	inferredUnit: undefined,
}

function matchesSource(
	facts: ShapeFacts,
	source: RollupSource,
	selfId: string,
	id: string,
	properties: ReadonlyMap<string, PropertyDef>
): boolean {
	// A rollup never counts itself, which would otherwise be a feedback loop the moment rollups
	// expose values of their own.
	if (id === selfId) return false
	if (source.nodeType && facts.type !== source.nodeType) return false

	switch (source.scope) {
		case 'page':
			return true
		case 'frame':
			// Parenting, not geometric containment (§4.3): tldraw auto-reparents shapes dropped into
			// a frame, and parent ids don't change while a shape is merely dragged around.
			return source.frameId !== null && facts.parentId === source.frameId
		case 'tags': {
			// Any-of. A shape tagged `desk` matches a rollup scoped to `desk`+`chair`.
			//
			// "The tags of a shape" is now derived rather than stored: tags were folded into properties
			// as a multi-select type, so this reads every list-valued property the shape carries.
			if (source.tags.length === 0) return false
			const tags = listValuesOf(facts.values, properties)
			return source.tags.some((t) => tags.includes(t))
		}
		default:
			return false
	}
}

function reduceOp(op: AggOp, values: number[]): number {
	if (op === 'count') return values.length
	if (values.length === 0) return 0
	switch (op) {
		case 'sum':
			return values.reduce((a, b) => a + b, 0)
		case 'avg':
			return values.reduce((a, b) => a + b, 0) / values.length
		case 'min':
			return Math.min(...values)
		case 'max':
			return Math.max(...values)
		default:
			return 0
	}
}

/**
 * The pure aggregation step. Takes a facts map and a structured spec (never a formula string, §2.3)
 * and returns rows. No store access, no side effects — which is what makes it directly unit
 * testable and safe to call from inside a computed.
 */
export function aggregate(
	facts: FactsMap,
	source: RollupSource,
	agg: RollupAgg,
	selfId: string,
	properties: ReadonlyMap<string, PropertyDef> = new Map()
): RollupResult {
	const groups = new Map<string | null, number[]>()
	let matched = 0
	let skipped = 0

	const valueDef = agg.fieldKey ? properties.get(agg.fieldKey) : undefined
	const groupDef = agg.groupBy ? properties.get(agg.groupBy) : undefined

	for (const [id, shapeFacts] of facts) {
		if (!matchesSource(shapeFacts, source, selfId, id, properties)) continue

		// **A shape that doesn't carry the property at all is not matched** — not matched-and-skipped.
		//
		// This distinction only started to matter when facts went universal: a page-scoped `sum(price)`
		// on a 500-shape board would otherwise report `matched: 500, skipped: 480`, which reads as "480
		// things are missing a price" when really 480 of them are arrows and scribbles. `skipped` now
		// means what the UI claims it means: things that *have* the property but no usable value.
		//
		// `count` is exempt: it counts what the source selects, and its field picker is hidden, so a
		// stale `fieldKey` left on a count rollup must not silently shrink the count.
		if (agg.op !== 'count' && agg.fieldKey && !(agg.fieldKey in shapeFacts.values)) continue

		matched++

		const groupKey = groupKeyFor(shapeFacts, agg.groupBy, groupDef)

		let bucket = groups.get(groupKey)
		if (!bucket) {
			bucket = []
			groups.set(groupKey, bucket)
		}

		if (agg.op === 'count') {
			// `count` counts shapes, so every match contributes regardless of values.
			bucket.push(1)
			continue
		}

		if (!agg.fieldKey) {
			// Nothing chosen yet: every match is reported as unusable, which is what drives the
			// "pick a property" empty state rather than a misleading zero.
			skipped++
			continue
		}
		// Numeric-ness is decided by the property's *registered type*, so a text property holding "12"
		// never contributes to a total. Without a registry entry the value can't be interpreted at all.
		const value = valueDef ? numericPropertyValue(valueDef, shapeFacts.values[agg.fieldKey]!) : null
		if (value === null) {
			skipped++
			continue
		}
		bucket.push(value)
	}

	const rows: RollupRow[] = [...groups.entries()]
		.map(([group, values]) => ({
			group,
			value: reduceOp(agg.op, values),
			count: values.length,
		}))
		// Largest first for grouped output (the interesting spend categories float to the top);
		// alphabetical tiebreak keeps the order stable across recomputes.
		.sort((a, b) => b.value - a.value || String(a.group).localeCompare(String(b.group)))

	const allValues: number[] = []
	for (const values of groups.values()) allValues.push(...values)

	return {
		rows,
		total: reduceOp(agg.op, allValues),
		matched,
		skipped,
		// The unit is a property of the *definition* now, not something inferred by counting which unit
		// appears most often across shapes. One place to look, and it can't disagree with itself.
		inferredUnit: valueDef?.unit,
	}
}

/**
 * The bucket a shape falls into.
 *
 * A list-valued group property puts the shape in its *first* value's bucket rather than in all of
 * them, because a rollup's rows must partition its matches — otherwise the rows would sum to more
 * than the total. Multi-bucket membership is a table-view feature (Phase 3), where rows are a view of
 * shapes rather than a decomposition of one number.
 */
function groupKeyFor(
	facts: ShapeFacts,
	groupBy: string | null,
	groupDef: PropertyDef | undefined
): string | null {
	if (groupBy === null) return null
	const value = facts.values[groupBy]
	if (isEmptyValue(value)) return '—'
	if (groupDef) {
		const keys = groupKeysForValue(groupDef, value!)
		return keys[0] ?? '—'
	}
	// No definition: fall back to a plain string so grouping still does something sensible on a board
	// whose registry lost the entry.
	return Array.isArray(value) ? (value[0] ?? '—') : String(value)
}

export function formatRollupValue(
	value: number,
	format: RollupFormat,
	inferredUnit: string | undefined
): string {
	if (format.style === 'currency') return formatCurrency(value, format.unit ?? inferredUnit)
	return formatNumber(value)
}

export { areFactsMapsEqual }

import { areFactsMapsEqual, dominantUnit, type FactsMap, type NodeFacts } from '../../facts'
import { formatCurrency, formatNumber } from '../../fields'

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
	fieldKey: string | null
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

function matchesSource(facts: NodeFacts, source: RollupSource, selfId: string, id: string): boolean {
	// A rollup never counts itself, which would otherwise be a feedback loop the moment rollups
	// gain an `extractFacts`.
	if (id === selfId) return false
	if (source.nodeType && facts.type !== source.nodeType) return false

	switch (source.scope) {
		case 'page':
			return true
		case 'frame':
			// Parenting, not geometric containment (§4.3): tldraw auto-reparents shapes dropped into
			// a frame, and parent ids don't change while a shape is merely dragged around.
			return source.frameId !== null && facts.parentId === source.frameId
		case 'tags':
			// Any-of. A node tagged `desk` matches a rollup scoped to `desk`+`chair`.
			return source.tags.length > 0 && source.tags.some((t) => facts.tags.includes(t))
		default:
			return false
	}
}

function numberFrom(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
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
	selfId: string
): RollupResult {
	const groups = new Map<string | null, number[]>()
	let matched = 0
	let skipped = 0

	for (const [id, nodeFacts] of facts) {
		if (!matchesSource(nodeFacts, source, selfId, id)) continue
		matched++

		const groupKey =
			agg.groupBy === null
				? null
				: nodeFacts.fields[agg.groupBy] === null || nodeFacts.fields[agg.groupBy] === undefined
					? '—'
					: String(nodeFacts.fields[agg.groupBy])

		let bucket = groups.get(groupKey)
		if (!bucket) {
			bucket = []
			groups.set(groupKey, bucket)
		}

		if (agg.op === 'count') {
			// `count` counts nodes, so every match contributes regardless of field values.
			bucket.push(1)
			continue
		}

		if (!agg.fieldKey) {
			skipped++
			continue
		}
		const value = numberFrom(nodeFacts.fields[agg.fieldKey])
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
		inferredUnit: agg.fieldKey ? dominantUnit(facts, agg.fieldKey) : undefined,
	}
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

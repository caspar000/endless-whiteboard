import { T } from 'tldraw'
import type { PropertyDef, PropertyType } from '../../properties/types'

/**
 * The table node's spec: what it selects, what it shows, how it summarises.
 *
 * **Structured JSON, never a formula string.** A saved view is data the app can read, migrate and
 * later render a UI for; a string would have to be parsed, and every future change to the language
 * would be a breaking change to every board that used it.
 */

/** The column key for the shape's own name, which is not a property. */
export const LABEL_COLUMN = '__label'

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const FILTER_OPS = [
	'isNotEmpty',
	'isEmpty',
	'is',
	'isNot',
	'contains',
	'doesNotContain',
	'gt',
	'gte',
	'lt',
	'lte',
	'before',
	'after',
] as const

export type FilterOp = (typeof FILTER_OPS)[number]

export type FilterValue = string | number | boolean | null

export interface TableFilter {
	propertyId: string
	op: FilterOp
	value: FilterValue
}

/**
 * Which operators make sense for a property's registered type.
 *
 * Gating by type is what makes the config UI honest: offering `before` on a currency, or `gt` on a
 * multi-select, produces a filter that can only ever match nothing. The emptiness operators apply to
 * everything because every type has an empty state.
 */
export function filterOpsForType(type: PropertyType): FilterOp[] {
	const always: FilterOp[] = ['isNotEmpty', 'isEmpty']
	switch (type) {
		case 'number':
		case 'currency':
			return [...always, 'is', 'isNot', 'gt', 'gte', 'lt', 'lte']
		case 'date':
			return [...always, 'is', 'isNot', 'before', 'after']
		case 'checkbox':
			return ['is']
		case 'multiSelect':
			// `is` on a list means "contains exactly this entry", which reads worse than `contains` and
			// does the same thing — so a list gets containment only.
			return [...always, 'contains', 'doesNotContain']
		case 'select':
			return [...always, 'is', 'isNot']
		default:
			return [...always, 'is', 'isNot', 'contains', 'doesNotContain']
	}
}

/** Operators that ignore `value` entirely, so the config UI hides the value input. */
export function filterOpNeedsValue(op: FilterOp): boolean {
	return op !== 'isEmpty' && op !== 'isNotEmpty'
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/**
 * Notion's summary list, minus the workspace-specific ones (`percentPerGroup`, and anything about
 * people or files). `range` is max − min for numbers and the span in days for dates.
 */
export const SUMMARY_OPS = [
	'count',
	'countValues',
	'countUnique',
	'countEmpty',
	'countNotEmpty',
	'percentEmpty',
	'percentNotEmpty',
	'sum',
	'avg',
	'median',
	'min',
	'max',
	'range',
	'earliest',
	'latest',
] as const

export type SummaryOp = (typeof SUMMARY_OPS)[number]

const UNIVERSAL_SUMMARIES: SummaryOp[] = [
	'count',
	'countValues',
	'countUnique',
	'countEmpty',
	'countNotEmpty',
	'percentEmpty',
	'percentNotEmpty',
]

const NUMERIC_SUMMARIES: SummaryOp[] = ['sum', 'avg', 'median', 'min', 'max', 'range']

const DATE_SUMMARIES: SummaryOp[] = ['earliest', 'latest', 'range']

/** Which summaries a column can carry, given the property behind it. */
export function summaryOpsForType(type: PropertyType | null): SummaryOp[] {
	if (type === 'number' || type === 'currency')
		return [...UNIVERSAL_SUMMARIES, ...NUMERIC_SUMMARIES]
	if (type === 'date') return [...UNIVERSAL_SUMMARIES, ...DATE_SUMMARIES]
	// `null` is the label column: countable, never summable.
	return UNIVERSAL_SUMMARIES
}

/** Whether a summary's result is a count/percentage rather than a value in the column's own unit. */
export function summaryIsCount(op: SummaryOp): boolean {
	return UNIVERSAL_SUMMARIES.includes(op)
}

export function summaryIsPercent(op: SummaryOp): boolean {
	return op === 'percentEmpty' || op === 'percentNotEmpty'
}

/**
 * Whether a summary's result should be formatted with the column property's own formatting.
 *
 * `sum` of a currency is money; `avg` is too. `range` of dates is a number of days, not a date — which
 * is why it can't simply be "numeric ops keep the unit".
 */
export function summaryKeepsUnit(op: SummaryOp, type: PropertyType | null): boolean {
	if (type !== 'number' && type !== 'currency') return false
	return (
		op === 'sum' ||
		op === 'avg' ||
		op === 'median' ||
		op === 'min' ||
		op === 'max' ||
		op === 'range'
	)
}

// ---------------------------------------------------------------------------
// The spec
// ---------------------------------------------------------------------------

export const TABLE_SCOPES = ['page', 'frame'] as const
export type TableScope = (typeof TABLE_SCOPES)[number]

export interface TableSource {
	/** `null` = any shape type. Otherwise an allow-list of `shape.type`. */
	shapeTypes: string[] | null
	scope: TableScope
	/** Frame *parenting*, never geometric containment — see `query.ts`. */
	frameId: string | null
	/** ANDed. An OR would need a group structure, which is deferred until something needs it. */
	filters: TableFilter[]
}

export interface TableColumn {
	/** A property id, or {@link LABEL_COLUMN} for the shape's own name. */
	key: string
	/** `null` = no summary for this column. */
	summary: SummaryOp | null
	/** Relative width. Rendered as a flex-grow weight, so it survives the shape being resized. */
	width: number
}

export interface TableSort {
	key: string
	dir: 'asc' | 'desc'
}

export const LAYOUT_MODES = ['value', 'table'] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

export interface TableLayout {
	/**
	 * `value` shows one big number — the whole of what the old rollup node did.
	 *
	 * Kept inside this node type rather than split into a separate KPI node: a lone ₾4,409 is a
	 * genuinely good object on a whiteboard, and a second node type would duplicate the spec, the
	 * migration and the config UI to gain nothing.
	 */
	mode: LayoutMode
	/**
	 * Rows rendered before the table stops and says "+N more".
	 *
	 * A cap rather than a scrollbar, because a whiteboard table should *show* its rows: `canScroll` only
	 * applies to the shape being edited, and in display mode the shape must not swallow pointer events
	 * or it stops behaving like a shape. Auto-height then sizes the card to whatever fits.
	 */
	maxRows: number
}

export interface TableNodeProps {
	title: string
	source: TableSource
	columns: TableColumn[]
	groupBy: string | null
	sorts: TableSort[]
	layout: TableLayout
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const filterValueValidator: T.Validatable<FilterValue> = T.jsonValue.refine((v): FilterValue => {
	if (v === null) return null
	const t = typeof v
	if (t === 'string' || t === 'number' || t === 'boolean') return v as FilterValue
	throw new Error(`A filter value must be a JSON scalar, got ${t}`)
})

export const tableFilterValidator: T.Validatable<TableFilter> = T.object({
	propertyId: T.string,
	op: T.literalEnum(...FILTER_OPS),
	value: filterValueValidator,
})

export const tableSourceValidator: T.Validatable<TableSource> = T.object({
	shapeTypes: T.arrayOf(T.string).nullable(),
	scope: T.literalEnum(...TABLE_SCOPES),
	frameId: T.string.nullable(),
	filters: T.arrayOf(tableFilterValidator),
})

export const tableColumnValidator: T.Validatable<TableColumn> = T.object({
	key: T.string,
	summary: T.literalEnum(...SUMMARY_OPS).nullable(),
	width: T.positiveNumber,
})

export const tableSortValidator: T.Validatable<TableSort> = T.object({
	key: T.string,
	dir: T.literalEnum('asc', 'desc'),
})

export const tableLayoutValidator: T.Validatable<TableLayout> = T.object({
	mode: T.literalEnum(...LAYOUT_MODES),
	maxRows: T.positiveInteger,
})

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_ROWS = 12
export const DEFAULT_COLUMN_WIDTH = 1

export function defaultTableProps(): TableNodeProps {
	return {
		title: 'Table',
		// `shapeTypes: null` — anything carrying the columns' properties counts. Filtering by shape type
		// is the exception now, not the default: that is what universal properties changed.
		source: { shapeTypes: null, scope: 'page', frameId: null, filters: [] },
		columns: [{ key: LABEL_COLUMN, summary: 'count', width: DEFAULT_COLUMN_WIDTH }],
		groupBy: null,
		sorts: [],
		layout: { mode: 'table', maxRows: DEFAULT_MAX_ROWS },
	}
}

/** The property behind a column, or `null` for the label column (and for an unknown id). */
export function columnProperty(
	key: string,
	properties: ReadonlyMap<string, PropertyDef>
): PropertyDef | null {
	if (key === LABEL_COLUMN) return null
	return properties.get(key) ?? null
}

export function columnTitle(key: string, properties: ReadonlyMap<string, PropertyDef>): string {
	if (key === LABEL_COLUMN) return 'Name'
	return properties.get(key)?.name ?? key
}

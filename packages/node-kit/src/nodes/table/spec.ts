import { T } from 'tldraw'
import { EDGE_DIRECTIONS, type EdgeDirection } from '../../edges'
import { isNumericType, type PropertyDef, type PropertyType } from '../../properties/types'

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
	/**
	 * The currency the threshold is stated in, for a money property.
	 *
	 * Without it, `price > 100` means a different thing on every row — 100 GEL on one card and 100 USD
	 * on the next — which is a filter that looks precise and isn't. Absent means the property's default.
	 */
	unit?: string
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
		case 'financial':
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

/**
 * What a summary is called in a menu.
 *
 * `countNotEmpty` is a fine identifier and a poor thing to read in a dropdown. Only the ones whose
 * camel case hides the meaning need an entry; the rest are already words.
 */
const SUMMARY_LABELS: Partial<Record<SummaryOp, string>> = {
	count: 'the count',
	countValues: 'values',
	countUnique: 'unique values',
	countEmpty: 'empty',
	countNotEmpty: 'filled in',
	percentEmpty: 'percent empty',
	percentNotEmpty: 'percent filled in',
	sum: 'the total',
	avg: 'the average',
	min: 'the smallest',
	max: 'the largest',
}

export function summaryLabel(op: SummaryOp): string {
	return SUMMARY_LABELS[op] ?? op
}

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
	if (type && isNumericType(type)) return [...UNIVERSAL_SUMMARIES, ...NUMERIC_SUMMARIES]
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
	if (type !== 'number' && type !== 'financial') return false
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

export const TABLE_SCOPES = ['page', 'frame', 'connected'] as const
export type TableScope = (typeof TABLE_SCOPES)[number]

export interface TableSource {
	/** `null` = any shape type. Otherwise an allow-list of `shape.type`. */
	shapeTypes: string[] | null
	scope: TableScope
	/** Frame *parenting*, never geometric containment — see `query.ts`. */
	frameId: string | null
	/**
	 * For `scope: 'connected'` — which way an arrow must point to count.
	 *
	 * Optional because every table persisted before this existed has no value for it, and tldraw
	 * validates props on load: a required field would turn every one of those into a broken shape.
	 * Read through {@link edgeDirectionOf}, never directly.
	 */
	direction?: EdgeDirection
	/**
	 * For `scope: 'connected'` — only follow arrows with this label, so one board can carry several
	 * kinds of relation at once. Empty or absent follows every arrow.
	 */
	edgeLabel?: string | null
	/**
	 * For `scope: 'connected'` — treat an arrow's direction as a sign: what points *at* this table
	 * adds, what it points at subtracts.
	 *
	 * Which is what an arrow already looks like it means. Without it, modelling money flowing in and
	 * out means typing the outgoing amounts as negatives, and a shape then reads as "−2,000" on the
	 * canvas when what is true is that 2,000 went somewhere.
	 */
	signed?: boolean
	/** ANDed. An OR would need a group structure, which is deferred until something needs it. */
	filters: TableFilter[]
}

/** Arrows point *at* the table by default: "what feeds this" is the question people draw. */
export function edgeDirectionOf(source: Pick<TableSource, 'direction'>): EdgeDirection {
	return source.direction ?? 'in'
}

export interface TableColumn {
	/** A property id, or {@link LABEL_COLUMN} for the shape's own name. */
	key: string
	/** `null` = no summary for this column. */
	summary: SummaryOp | null
	/** Relative width. Rendered as a flex-grow weight, so it survives the shape being resized. */
	width: number
	/** Currency handling for this column's summary. Absent = don't convert. See {@link MoneyConfig}. */
	money?: MoneyConfig
}

export interface TableSort {
	key: string
	dir: 'asc' | 'desc'
}

/**
 * The views this node can draw — its ViewSpec, in the vocabulary of `docs/views-plan.md`.
 *
 * A member is added here in the same change that adds its entry to the view registry
 * (`views/index.ts`), never before: a mode with no view behind it is a value the validator accepts,
 * an agent can write through `node.config`, and nothing can render.
 */
export const LAYOUT_MODES = ['value', 'table', 'kanban', 'calendar'] as const
export type LayoutMode = (typeof LAYOUT_MODES)[number]

export interface TableLayout {
	/**
	 * `value` shows one big number — the whole of what the old rollup node did.
	 *
	 * Kept inside this node type rather than split into a separate KPI node: a lone ₾4,409 is a
	 * genuinely good object on a whiteboard, and a second node type would duplicate the spec, the
	 * migration and the config UI to gain nothing. Every later view (kanban, calendar) arrives the
	 * same way and for the same reason — one selector, one set of columns, one config panel.
	 */
	mode: LayoutMode
	/**
	 * For `value` — which column to headline. Absent picks one, which is what every table persisted
	 * before this existed relies on: see `headlineColumn` for the rule and why it prefers a summary
	 * that produces a value over one that merely counts.
	 *
	 * Optional rather than required for the reason `TableSource.direction` is: tldraw validates props
	 * on load, so a required field turns every existing table into a broken shape.
	 */
	valueColumn?: string | null
	/**
	 * For `kanban` — the lanes to draw, in this order, whether or not anything is in them.
	 *
	 * Absent derives them from the group property's own options and stages (`laneKeys`), which is the
	 * right answer until someone drags a lane heading. Values present on the board but missing from
	 * this list are still drawn, appended: a list of lanes must never be able to hide a card.
	 */
	lanes?: string[] | null
	/**
	 * For `calendar` — a month at a time, or a week. Absent means a month.
	 */
	span?: 'month' | 'week'
	/**
	 * For `calendar` — which period to show, as `YYYY-MM` or a full ISO day.
	 *
	 * Absent follows **today**, which is what a board wants nine times in ten; a card that opened on the
	 * month it was created in would be showing last April by the summer. Stored rather than kept in
	 * session state because a board *about* October should still be about October tomorrow.
	 */
	anchor?: string | null
	/**
	 * Rows rendered before the table stops and says "+N more".
	 *
	 * A cap rather than a scrollbar, because a whiteboard table should *show* its rows: `canScroll` only
	 * applies to the shape being edited, and in display mode the shape must not swallow pointer events
	 * or it stops behaving like a shape. Auto-height then sizes the card to whatever fits.
	 */
	maxRows: number
}

/**
 * How a money column's summary handles more than one currency.
 *
 * Absent means the old behaviour: don't convert, and say "(mixed)" when the rows disagree. That stays
 * the default deliberately — converting silently would change what an existing total means.
 */
export interface MoneyConfig {
	/**
	 * What the answer is expressed in. `null` means don't convert.
	 */
	to: string | null
	/**
	 * Which source currencies take part. `null` is all of them; a list sums only those and reports the
	 * rest as excluded, which is what lets you total your USD spend without pretending the GEL is not
	 * there.
	 */
	include: string[] | null
}

export interface TableNodeProps {
	title: string
	/**
	 * Whether the card's height follows its content. Absent means yes — see `useAutoHeight`.
	 *
	 * A **placing** view turns this off (`views/mode.ts`): a kanban's height comes from its tallest
	 * lane, which is a fact about the cards it has arranged and not about the HTML it drew, so the
	 * placement pass sets `h` and the measurement must stay out of it. With both writing, they disagree
	 * by the card's 2px border and grow it forever.
	 */
	autoHeight?: boolean
	source: TableSource
	columns: TableColumn[]
	groupBy: string | null
	sorts: TableSort[]
	layout: TableLayout
	/**
	 * Hand-entered rates for this table, against the display currency, beating anything fetched.
	 *
	 * Per table because that is where the question is asked: one board can hold a trip budgeted at the
	 * rate you actually got and a shopping list at today's. Fetched rates are a shared cache and stay
	 * out of the document; these are what someone typed, so they are part of the board and travel with
	 * it in a backup.
	 */
	rates: Record<string, number>
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

export const tableFilterValidator = T.object({
	unit: T.string.optional(),
	propertyId: T.string,
	op: T.literalEnum(...FILTER_OPS),
	value: filterValueValidator,
})

export const tableSourceValidator: T.Validatable<TableSource> = T.object({
	shapeTypes: T.arrayOf(T.string).nullable(),
	scope: T.literalEnum(...TABLE_SCOPES),
	frameId: T.string.nullable(),
	direction: T.literalEnum(...EDGE_DIRECTIONS).optional(),
	edgeLabel: T.string.nullable().optional(),
	signed: T.boolean.optional(),
	filters: T.arrayOf(tableFilterValidator),
})

export const moneyConfigValidator = T.object({
	to: T.string.nullable(),
	include: T.arrayOf(T.string).nullable(),
})

export const tableColumnValidator: T.Validatable<TableColumn> = T.object({
	key: T.string,
	summary: T.literalEnum(...SUMMARY_OPS).nullable(),
	width: T.positiveNumber,
	money: moneyConfigValidator.optional(),
})

export const tableSortValidator: T.Validatable<TableSort> = T.object({
	key: T.string,
	dir: T.literalEnum('asc', 'desc'),
})

export const tableLayoutValidator: T.Validatable<TableLayout> = T.object({
	mode: T.literalEnum(...LAYOUT_MODES),
	maxRows: T.positiveInteger,
	valueColumn: T.string.nullable().optional(),
	lanes: T.arrayOf(T.string).nullable().optional(),
	span: T.literalEnum('month', 'week').optional(),
	anchor: T.string.nullable().optional(),
})

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

/**
 * A `groupBy` of `currency:<propertyId>` buckets rows by the currency of that money column.
 *
 * A separate namespace rather than a reserved property id, so it can never collide with a real one.
 * Worth having because it answers "what did I spend in USD" with no rates at all — subtotals per
 * currency, each in its own, nothing converted and nothing to be stale.
 */
export const CURRENCY_GROUP_PREFIX = 'currency:'

/** The property id behind a currency grouping, or `null` if this isn't one. */
export function currencyGroupProperty(groupBy: string | null): string | null {
	if (!groupBy?.startsWith(CURRENCY_GROUP_PREFIX)) return null
	return groupBy.slice(CURRENCY_GROUP_PREFIX.length) || null
}

/**
 * A `groupBy` of `date:<propertyId>` buckets rows by the **day** of that date property.
 *
 * The same trick as the currency prefix, and it exists for the calendar: a month grid is a bucket per
 * day, so the view can be filled from `buildGroups` rather than growing a second way to group. A date
 * property's raw value is a day already (`YYYY-MM-DD`), but bucketing on it *as a grouping* is what
 * makes the calendar's cells and a grouped table's rows the same mechanism — and what would let
 * `date:` later mean by-week or by-month without the view changing at all.
 */
export const DATE_GROUP_PREFIX = 'date:'

/** The property id behind a date grouping, or `null` if this isn't one. */
export function dateGroupProperty(groupBy: string | null): string | null {
	if (!groupBy?.startsWith(DATE_GROUP_PREFIX)) return null
	return groupBy.slice(DATE_GROUP_PREFIX.length) || null
}

/**
 * The property a grouping reads, whichever kind of grouping it is.
 *
 * One function because three places have to agree on it — what the query *reads* for a row, what it
 * buckets on, and what a view calls the thing it is grouped by. They disagreed once already: the date
 * prefix worked in `buildGroups` and not in `neededKeys`, so every cell came back `undefined` and every
 * row landed in the empty bucket.
 */
export function groupProperty(groupBy: string | null): string | null {
	if (!groupBy) return null
	return currencyGroupProperty(groupBy) ?? dateGroupProperty(groupBy) ?? groupBy
}

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
		rates: {},
	}
}

/**
 * A table drawn inside a frame is a table *about* that frame.
 *
 * The default is the whole board, which is right for a table on open canvas and almost never what
 * someone dropping one into a frame meant: a frame is already the gesture for "these things belong
 * together", so the table arrives asking the question the frame asks, with its Frame picker filled
 * in rather than empty. Widening it back to the board is one menu away; narrowing it by hand was two
 * menus and a look at a list of frame names.
 *
 * **Only an untouched source.** Duplicating or pasting a table runs the creation hook too, so a
 * source anyone has configured — a different scope, a frame already chosen — has to survive
 * unchanged; matching the default exactly is the one signal available here for "nobody has said yet".
 */
export function frameScopedSource(
	props: TableNodeProps,
	/** The shape the new table is parented to, which tldraw has already resolved. */
	parent: { id: string; type: string } | null
): Partial<TableNodeProps> | null {
	const { source } = props
	if (source.scope !== 'page' || source.frameId !== null) return null
	if (parent?.type !== 'frame') return null
	return { source: { ...source, scope: 'frame', frameId: parent.id } }
}

/**
 * A column reading a property off the **arrow** rather than off the shape it points at.
 *
 * This is what a relation with data on it looks like in a table: "this meal uses 200g of that
 * ingredient" belongs to neither the meal nor the ingredient, it belongs to the pairing — and the
 * pairing is the arrow. Notion needs a junction database for this; here the arrow is already a shape,
 * so it already carries properties, and a column only has to say which end to read from.
 *
 * A prefix rather than a second list of columns: everything downstream — widths, summaries, sorting,
 * grouping — is keyed by column key and works unchanged.
 */
export const EDGE_COLUMN_PREFIX = 'edge:'

/** The property id an edge column reads, or `null` if this key is an ordinary column. */
export function edgeColumnProperty(key: string): string | null {
	return key.startsWith(EDGE_COLUMN_PREFIX) ? key.slice(EDGE_COLUMN_PREFIX.length) : null
}

export function edgeColumnKey(propertyId: string): string {
	return `${EDGE_COLUMN_PREFIX}${propertyId}`
}

/** The property behind a column, or `null` for the label column (and for an unknown id). */
export function columnProperty(
	key: string,
	properties: ReadonlyMap<string, PropertyDef>
): PropertyDef | null {
	if (key === LABEL_COLUMN) return null
	return properties.get(edgeColumnProperty(key) ?? key) ?? null
}

export function columnTitle(key: string, properties: ReadonlyMap<string, PropertyDef>): string {
	if (key === LABEL_COLUMN) return 'Name'
	const onEdge = edgeColumnProperty(key)
	// Named for where it comes from, because the same property can appear twice in one table — once
	// off the shape and once off the arrow — and two identical headings would be unreadable.
	if (onEdge) return `${properties.get(onEdge)?.name ?? onEdge} (arrow)`
	return properties.get(key)?.name ?? key
}

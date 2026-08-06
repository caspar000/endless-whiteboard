import { isEmptyValue, listValuesOf, type FactsMap, type ShapeFacts } from '../../facts'
import { numericPropertyValue } from '../../properties/format'
import { isListType, type PropertyDef, type PropertyValue } from '../../properties/types'
import {
	LABEL_COLUMN,
	columnProperty,
	type FilterOp,
	type SummaryOp,
	type TableColumn,
	type TableFilter,
	type TableNodeProps,
	type TableSort,
} from './spec'

/**
 * The pure query step: facts + spec → rows, groups and summaries.
 *
 * No store access and no side effects, which is what makes it directly unit-testable and safe to call
 * from inside a computed. It is the successor to `aggregate.ts` and keeps all of its hard-won
 * semantics: an empty selection totals 0 rather than NaN, a shape that lacks the column's property is
 * *not matched* rather than matched-and-skipped, a non-numeric value is skipped rather than coerced,
 * shapes with no group value fall into a `—` bucket, and a table never counts itself.
 */

/**
 * A cell's value, where `undefined` means the shape doesn't carry that property at all.
 *
 * Absent and empty are different states throughout this file — a blank cell the user cleared is not the
 * same as a property the shape never had — so the distinction is in the type rather than erased by a
 * cast at each use.
 */
type Cell = PropertyValue | undefined

/** One row: a read-only mirror of one shape. */
export interface TableRow {
	shapeId: string
	label: string
	/** Cell values by column key, already resolved but not yet formatted. */
	cells: Readonly<Record<string, PropertyValue>>
}

export interface TableGroup {
	/** `null` for an ungrouped table; `'—'` for shapes with no value for the group property. */
	key: string | null
	rows: TableRow[]
	/** Summary per column key, for this group only. */
	summaries: Readonly<Record<string, number | null>>
}

export interface TableResult {
	groups: TableGroup[]
	/** Summary per column key, across every matched row. */
	summaries: Readonly<Record<string, number | null>>
	/** Rows that matched the source. */
	matched: number
	/**
	 * Matched rows carrying the *first summarised* column's property with an unusable value.
	 *
	 * Deliberately about one column: "3 things have no price yet" is a useful sentence, whereas a total
	 * across every column would count the same shape repeatedly and mean nothing.
	 */
	skipped: number
}

export const EMPTY_TABLE: TableResult = {
	groups: [],
	summaries: {},
	matched: 0,
	skipped: 0,
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchesSource(
	facts: ShapeFacts,
	props: TableNodeProps,
	selfId: string,
	id: string,
	properties: ReadonlyMap<string, PropertyDef>
): boolean {
	// A table never includes itself. Tables contribute no property values at all, so a table-of-tables
	// cycle is impossible by construction — this is belt to that braces.
	if (id === selfId) return false

	const { source } = props
	if (source.shapeTypes && !source.shapeTypes.includes(facts.type)) return false

	// Frame *parenting*, not geometric containment: tldraw reparents shapes dropped into a frame, and a
	// parent id doesn't change while a shape is merely dragged around — so this survives a drag, which
	// a geometry test would not.
	if (source.scope === 'frame') {
		if (source.frameId === null || facts.parentId !== source.frameId) return false
	}

	for (const filter of source.filters) {
		if (!matchesFilter(facts, filter, properties)) return false
	}

	// Whether the shape carries any of the table's *column* properties is decided in `queryTable`,
	// where the columns are in hand — a shape that carries none of them is not a row at all.
	return true
}

export function matchesFilter(
	facts: ShapeFacts,
	filter: TableFilter,
	properties: ReadonlyMap<string, PropertyDef>
): boolean {
	const def = properties.get(filter.propertyId)
	const value = facts.values[filter.propertyId]
	const empty = isEmptyValue(value)

	switch (filter.op) {
		case 'isEmpty':
			return empty
		case 'isNotEmpty':
			return !empty
	}

	// Every remaining operator compares against a value, so an empty cell can never satisfy one.
	if (empty) return false

	if (def && isListType(def.type)) {
		const entries = Array.isArray(value) ? value : []
		const needle = String(filter.value ?? '')
		switch (filter.op) {
			case 'contains':
				return entries.includes(needle)
			case 'doesNotContain':
				return !entries.includes(needle)
			default:
				// A scalar comparison on a list is a config the UI won't produce; refusing to guess beats
				// inventing a meaning for it.
				return false
		}
	}

	switch (filter.op) {
		case 'is':
			return looseEquals(value, filter.value)
		case 'isNot':
			return !looseEquals(value, filter.value)
		case 'contains':
			return String(value)
				.toLowerCase()
				.includes(String(filter.value ?? '').toLowerCase())
		case 'doesNotContain':
			return !String(value)
				.toLowerCase()
				.includes(String(filter.value ?? '').toLowerCase())
		case 'gt':
		case 'gte':
		case 'lt':
		case 'lte':
			return compareNumeric(filter.op, value, filter.value)
		case 'before':
		case 'after':
			return compareDate(filter.op, value, filter.value)
		default:
			return false
	}
}

/**
 * Compares a stored value with a filter's value, tolerating the type difference between them.
 *
 * A filter's value arrives from a text input, so `"2399"` must match the number `2399` — otherwise
 * every numeric `is` filter silently matches nothing, which looks like the table being broken.
 */
function looseEquals(value: Cell, target: FilterValueLike): boolean {
	if (value === target) return true
	if (typeof value === 'boolean' || typeof target === 'boolean') {
		return Boolean(value) === Boolean(target)
	}
	if (value === null || target === null || target === undefined) return false
	return String(value) === String(target)
}

type FilterValueLike = string | number | boolean | null | undefined

function compareNumeric(
	op: 'gt' | 'gte' | 'lt' | 'lte',
	value: Cell,
	target: FilterValueLike
): boolean {
	const a = Number(value)
	const b = Number(target)
	if (!Number.isFinite(a) || !Number.isFinite(b)) return false
	if (op === 'gt') return a > b
	if (op === 'gte') return a >= b
	if (op === 'lt') return a < b
	return a <= b
}

function compareDate(op: 'before' | 'after', value: Cell, target: FilterValueLike): boolean {
	const a = Date.parse(String(value))
	const b = Date.parse(String(target))
	if (Number.isNaN(a) || Number.isNaN(b)) return false
	return op === 'before' ? a < b : a > b
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/**
 * One column's summary over a set of rows.
 *
 * Returns `null` when the op cannot say anything — a `sum` over a column with no numeric values, say.
 * `null` renders as `—`, which is honest; `0` would claim the total is zero.
 */
export function summarise(
	op: SummaryOp,
	rows: readonly TableRow[],
	columnKey: string,
	def: PropertyDef | null
): number | null {
	const values = rows.map((row) => row.cells[columnKey])
	const present = values.filter((v) => !isEmptyValue(v))

	switch (op) {
		case 'count':
			return rows.length
		case 'countValues':
			// Counts *values*, so a list cell contributes each entry — the one summary where a
			// multi-select differs from a scalar.
			return present.reduce<number>((total, v) => total + (Array.isArray(v) ? v.length : 1), 0)
		case 'countUnique': {
			const seen = new Set<string>()
			for (const v of present) {
				if (Array.isArray(v)) for (const entry of v) seen.add(entry)
				else seen.add(String(v))
			}
			return seen.size
		}
		case 'countEmpty':
			return values.length - present.length
		case 'countNotEmpty':
			return present.length
		case 'percentEmpty':
			return values.length === 0 ? null : ((values.length - present.length) / values.length) * 100
		case 'percentNotEmpty':
			return values.length === 0 ? null : (present.length / values.length) * 100
	}

	if (op === 'earliest' || op === 'latest') {
		const times = present.map((v) => Date.parse(String(v))).filter((t) => !Number.isNaN(t))
		if (!times.length) return null
		return op === 'earliest' ? Math.min(...times) : Math.max(...times)
	}

	// `range` means max − min for a number, and a span in *days* for a date. Same word, different unit,
	// so the date case is handled before falling through to the numeric ops.
	if (op === 'range' && def?.type === 'date') {
		const times = present.map((v) => Date.parse(String(v))).filter((t) => !Number.isNaN(t))
		if (times.length < 2) return null
		return (Math.max(...times) - Math.min(...times)) / 86_400_000
	}

	// Numeric ops. Numeric-ness comes from the *registered type*, so a text column holding "12" never
	// contributes — the same rule the rollup engine established, for the same reason.
	if (!def) return null
	const numbers: number[] = []
	for (const v of present) {
		const n = numericPropertyValue(def, v ?? null)
		if (n !== null) numbers.push(n)
	}
	if (!numbers.length) return null

	switch (op) {
		case 'sum':
			return numbers.reduce((a, b) => a + b, 0)
		case 'avg':
			return numbers.reduce((a, b) => a + b, 0) / numbers.length
		case 'median': {
			const sorted = [...numbers].sort((a, b) => a - b)
			const mid = Math.floor(sorted.length / 2)
			return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
		}
		case 'min':
			return Math.min(...numbers)
		case 'max':
			return Math.max(...numbers)
		case 'range':
			return Math.max(...numbers) - Math.min(...numbers)
		default:
			return null
	}
}

function summariseColumns(
	columns: readonly TableColumn[],
	rows: readonly TableRow[],
	properties: ReadonlyMap<string, PropertyDef>
): Record<string, number | null> {
	const out: Record<string, number | null> = {}
	for (const column of columns) {
		if (!column.summary) continue
		out[column.key] = summarise(
			column.summary,
			rows,
			column.key,
			columnProperty(column.key, properties)
		)
	}
	return out
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function compareRows(a: TableRow, b: TableRow, sorts: readonly TableSort[]): number {
	for (const sort of sorts) {
		const av = sort.key === LABEL_COLUMN ? a.label : a.cells[sort.key]
		const bv = sort.key === LABEL_COLUMN ? b.label : b.cells[sort.key]

		// Emptiness is decided *before* the direction is applied, and deliberately so: a blank is not a
		// small value, it is a missing one, so it belongs at the bottom whichever way the column is
		// sorted. Folding this into `compareValues` meant reversing the sort floated the blanks to the
		// top, which reads as the table being broken.
		const aEmpty = isEmptyValue(av)
		const bEmpty = isEmptyValue(bv)
		if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
		if (aEmpty && bEmpty) continue

		const cmp = compareValues(av, bv)
		if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp
	}
	return 0
}

/** Compares two non-empty values. Emptiness is handled by the caller, which owns direction. */
function compareValues(a: Cell, b: Cell): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b
	if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b)

	const as = Array.isArray(a) ? a.join(', ') : String(a)
	const bs = Array.isArray(b) ? b.join(', ') : String(b)
	// Numeric collation so "Item 2" sorts before "Item 10".
	return as.localeCompare(bs, undefined, { numeric: true })
}

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

export function queryTable(
	facts: FactsMap,
	props: TableNodeProps,
	selfId: string,
	properties: ReadonlyMap<string, PropertyDef> = new Map()
): TableResult {
	const { columns, groupBy, sorts } = props

	// Every property a row needs, not just the visible columns: grouping and sorting by a property you
	// have chosen *not* to show is a normal thing to want, and reading only the columns made both
	// silently do nothing.
	const neededKeys = new Set<string>()
	for (const column of columns) if (column.key !== LABEL_COLUMN) neededKeys.add(column.key)
	if (groupBy && groupBy !== LABEL_COLUMN) neededKeys.add(groupBy)
	for (const sort of sorts) if (sort.key !== LABEL_COLUMN) neededKeys.add(sort.key)

	// The property columns, without the built-in label. What decides row membership below.
	const columnKeys = columns.filter((c) => c.key !== LABEL_COLUMN).map((c) => c.key)

	const rows: TableRow[] = []
	for (const [id, shapeFacts] of facts) {
		if (!matchesSource(shapeFacts, props, selfId, id, properties)) continue

		const cells: Record<string, PropertyValue> = {}
		for (const key of neededKeys) {
			const value = shapeFacts.values[key]
			if (value !== undefined) cells[key] = value
		}

		// A row must *carry* at least one of the table's column properties. A board is full of
		// shapes that have nothing to do with this table — drawings, frames, the intro note — and a
		// row of "—" for each of them buries the rows the table is about. Attached-but-empty is the
		// opposite case: that shape opted into the property, so its row stays, with a blank cell.
		// A table with no property columns at all is a plain list of labels and keeps every match.
		if (columnKeys.length && !columnKeys.some((key) => key in cells)) continue

		rows.push({ shapeId: id, label: shapeFacts.label, cells })
	}

	if (sorts.length) rows.sort((a, b) => compareRows(a, b, sorts))

	const matched = rows.length
	const groups: TableGroup[] =
		groupBy === null
			? rows.length
				? [{ key: null, rows, summaries: summariseColumns(columns, rows, properties) }]
				: []
			: buildGroups(rows, groupBy, columns, properties)

	return {
		groups,
		summaries: summariseColumns(columns, rows, properties),
		matched,
		skipped: countSkipped(rows, columns, properties),
	}
}

/**
 * Buckets rows by a property.
 *
 * A list-valued group property puts a row in **every** bucket it carries — the opposite of the old
 * rollup, which had to pick one because its rows decomposed a single total and would otherwise
 * double-count. A table's rows are a view of shapes, so appearing under both `furniture` and `decor`
 * is exactly right, and each group's summaries are computed over the rows it actually holds.
 */
function buildGroups(
	rows: readonly TableRow[],
	groupBy: string,
	columns: readonly TableColumn[],
	properties: ReadonlyMap<string, PropertyDef>
): TableGroup[] {
	const def = properties.get(groupBy)
	const buckets = new Map<string, TableRow[]>()

	for (const row of rows) {
		const value = groupBy === LABEL_COLUMN ? row.label : row.cells[groupBy]
		let keys: string[]
		if (isEmptyValue(value)) {
			keys = ['—']
		} else if (Array.isArray(value) && (!def || isListType(def.type))) {
			keys = value.length ? [...value] : ['—']
		} else {
			// The raw value, not its display form: a bucket key is an identity, and formatting a number
			// property would file a year under "2,026".
			keys = [Array.isArray(value) ? (value[0] ?? '—') : String(value)]
		}
		for (const key of keys) {
			let bucket = buckets.get(key)
			if (!bucket) {
				bucket = []
				buckets.set(key, bucket)
			}
			bucket.push(row)
		}
	}

	return (
		[...buckets.entries()]
			.map(([key, groupRows]) => ({
				key,
				rows: groupRows,
				summaries: summariseColumns(columns, groupRows, properties),
			}))
			// Biggest first — the interesting buckets float to the top — with an alphabetical tiebreak so the
			// order is stable across recomputes. `—` sorts last: it is an absence, not a category.
			.sort((a, b) => {
				if (a.key === '—') return 1
				if (b.key === '—') return -1
				return (
					b.rows.length - a.rows.length || a.key.localeCompare(b.key, undefined, { numeric: true })
				)
			})
	)
}

/** Matched rows carrying the first summarised column's property with an unusable value. */
function countSkipped(
	rows: readonly TableRow[],
	columns: readonly TableColumn[],
	properties: ReadonlyMap<string, PropertyDef>
): number {
	const column = columns.find((c) => c.summary && c.key !== LABEL_COLUMN)
	if (!column) return 0
	const def = properties.get(column.key)
	if (!def) return 0
	let skipped = 0
	for (const row of rows) {
		if (!(column.key in row.cells)) continue
		if (isEmptyValue(row.cells[column.key])) skipped++
	}
	return skipped
}

/** Every distinct value present for a property among the rows — used by the filter value picker. */
export function valuesInRows(
	rows: readonly TableRow[],
	propertyId: string,
	properties: ReadonlyMap<string, PropertyDef>
): string[] {
	const def = properties.get(propertyId)
	const out = new Set<string>()
	for (const row of rows) {
		const value = row.cells[propertyId]
		if (isEmptyValue(value)) continue
		if (Array.isArray(value) && (!def || isListType(def.type))) {
			for (const entry of value) out.add(entry)
		} else {
			out.add(String(value))
		}
	}
	return [...out].sort()
}

export { listValuesOf }

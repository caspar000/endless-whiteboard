import {
	EMPTY_EDGE_INDEX,
	edgesTouching,
	otherEnd,
	type Edge,
	type EdgeIndex,
} from '../../edges'
import { isEmptyValue, listValuesOf, type FactsMap, type ShapeFacts } from '../../facts'
import { numericPropertyValue } from '../../properties/format'
import {
	convertAmount,
	normaliseCurrency,
	rateBetween,
	type RateTable,
} from '../../properties/rates'
import { isListType, type PropertyDef, type PropertyValue } from '../../properties/types'
import {
	LABEL_COLUMN,
	columnProperty,
	currencyGroupProperty,
	edgeColumnProperty,
	edgeDirectionOf,
	type FilterOp,
	type MoneyConfig,
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
	/**
	 * The shape's own unit overrides, so a money cell renders in *its* currency rather than the
	 * column's. Two rows of the same column can legitimately differ.
	 */
	units: Readonly<Record<string, string>>
}

/** What a money summary is, beyond its number. Computed by the query so the view never needs rates. */
export interface MoneyOutcome {
	unit: string | undefined
	mixed: boolean
	excluded: number
	converted: boolean
	/** When the rates behind a conversion were last recalculated, so a total can admit its age. */
	asOf?: number
	/** True when those rates are past their refresh time — offline, usually. */
	stale?: boolean
}

export interface TableGroup {
	/** `null` for an ungrouped table; `'—'` for shapes with no value for the group property. */
	key: string | null
	rows: TableRow[]
	/** Summary per column key, for this group only. */
	summaries: Readonly<Record<string, number | null>>
	/** Currency provenance per column key, for this group only. */
	money: Readonly<Record<string, MoneyOutcome>>
}

export interface TableResult {
	groups: TableGroup[]
	/** Summary per column key, across every matched row. */
	summaries: Readonly<Record<string, number | null>>
	/**
	 * Currency provenance per column key.
	 *
	 * Computed here rather than in the component because the component has no rates — and when it tried
	 * to work this out for itself with `rates: null`, every convertible row looked unconvertible and the
	 * total reported five exclusions that had not happened.
	 */
	money: Readonly<Record<string, MoneyOutcome>>
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
	money: {},
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
	properties: ReadonlyMap<string, PropertyDef>,
	rates: RateTable | null,
	/** For `scope: 'connected'`: the shapes the table's arrows reach. `null` for every other scope. */
	connected: ReadonlyMap<string, unknown> | null
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

	// Membership rather than a per-shape test, because "connected" is a property of the *pair* and the
	// set is one walk of this table's own edges — cheaper than asking every shape on the board whether
	// an arrow reaches it.
	if (source.scope === 'connected' && !connected?.has(id)) return false

	for (const filter of source.filters) {
		if (!matchesFilter(facts, filter, properties, rates)) return false
	}

	// Whether the shape carries any of the table's *column* properties is decided in `queryTable`,
	// where the columns are in hand — a shape that carries none of them is not a row at all.
	return true
}

export function matchesFilter(
	facts: ShapeFacts,
	filter: TableFilter,
	properties: ReadonlyMap<string, PropertyDef>,
	rates: RateTable | null = null
): boolean {
	const def = properties.get(filter.propertyId)
	let value = facts.values[filter.propertyId]

	/*
	 * A money threshold is stated in one currency, so the row has to be expressed in that currency
	 * before the comparison means anything. Without this `price > 100` matched a 100 USD row and a
	 * 100 GEL row identically, which looks precise and isn't.
	 *
	 * A row that cannot be converted drops out rather than being compared at par — the same choice the
	 * summaries make, for the same reason.
	 */
	if (def?.type === 'financial' && typeof value === 'number') {
		const target = normaliseCurrency(filter.unit) ?? normaliseCurrency(def.unit)
		const unit = facts.units[filter.propertyId] ?? def.unit
		const converted = convertAmount(value, unit, target, rates)
		if (converted === null) return false
		value = converted
	}
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
/**
 * The one unit shared by the rows contributing to a column, or `null` when they disagree.
 *
 * Needed because a unit is per shape now: a column of prices can legitimately hold GEL and USD at once,
 * and printing their sum with either symbol would be a confident lie. The caller shows the number
 * without a currency instead, and says the currencies are mixed.
 */
export function sharedUnit(
	rows: readonly TableRow[],
	columnKey: string,
	fallback: string | undefined
): string | undefined | null {
	let seen: string | undefined
	let found = false
	for (const row of rows) {
		if (row.cells[columnKey] === undefined) continue
		const unit = row.units[columnKey] ?? fallback
		if (!found) {
			seen = unit
			found = true
		} else if (unit !== seen) {
			return null
		}
	}
	return found ? seen : fallback
}

/** Everything a money column needs to turn a set of amounts into one comparable number. */
export interface MoneyContext {
	config?: MoneyConfig
	rates: RateTable | null
	/** The property's default currency, used for rows carrying no override of their own. */
	fallbackUnit?: string
}

/** Whether a row's currency takes part, per the column's `include` list. */
function included(unit: string | undefined, config: MoneyConfig | undefined): boolean {
	if (!config?.include) return true
	const code = normaliseCurrency(unit)
	return config.include.some((entry) => normaliseCurrency(entry) === code)
}

/**
 * What a money column's summary is, beyond its number: the currency it is in, whether the rows
 * disagreed, and how many were left out.
 *
 * Separate from `summarise` so the number stays a number and the UI still gets what it needs to be
 * honest about it — a converted total that looks identical to a native one is how people get misled.
 */
export function moneyOutcome(
	rows: readonly TableRow[],
	columnKey: string,
	def: PropertyDef | null,
	money: MoneyContext | undefined
): MoneyOutcome {
	const fallback = money?.fallbackUnit ?? def?.unit
	if (def?.type !== 'financial') {
		return { unit: fallback, mixed: false, excluded: 0, converted: false }
	}

	const target = normaliseCurrency(money?.config?.to ?? undefined)
	let excluded = 0
	let seen: string | undefined
	let found = false
	let mixed = false

	for (const row of rows) {
		if (row.cells[columnKey] === undefined) continue
		const unit = row.units[columnKey] ?? fallback
		if (!included(unit, money?.config)) {
			excluded++
			continue
		}
		if (target) {
			// Excluded for want of a rate, which is a different sentence from "you chose to leave it out"
			// but has the same effect on the total, so it is counted the same way.
			if (rateBetween(money?.rates ?? null, unit, target) === null) excluded++
			continue
		}
		if (!found) {
			seen = unit
			found = true
		} else if (unit !== seen) {
			mixed = true
		}
	}

	if (target) {
		return {
			unit: target,
			mixed: false,
			excluded,
			converted: true,
			asOf: money?.rates?.asOf,
			stale: money?.rates?.stale,
		}
	}
	return { unit: found ? seen : fallback, mixed, excluded, converted: false }
}

export function summarise(
	op: SummaryOp,
	rows: readonly TableRow[],
	columnKey: string,
	def: PropertyDef | null,
	money?: MoneyContext
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
	if (def.type === 'financial') {
		/*
		 * Money is converted *before* it is reduced, not after — and that ordering is the whole point.
		 * `max` over unconverted amounts picks the largest number regardless of currency, so $100 loses
		 * to ₾200 and the answer is wrong in a way nobody notices. Same for min, avg, median and range.
		 *
		 * Rows are read here rather than the flat `present` list because a currency belongs to a row.
		 */
		const fallback = money?.fallbackUnit ?? def.unit
		const target = normaliseCurrency(money?.config?.to ?? undefined)
		for (const row of rows) {
			const raw = row.cells[columnKey]
			if (isEmptyValue(raw)) continue
			const n = numericPropertyValue(def, raw ?? null)
			if (n === null) continue
			const unit = row.units[columnKey] ?? fallback
			if (!included(unit, money?.config)) continue
			if (!target) {
				numbers.push(n)
				continue
			}
			const converted = convertAmount(n, unit, target, money?.rates ?? null)
			// No rate: left out rather than counted at par. `moneyOutcome` reports how many.
			if (converted !== null) numbers.push(converted)
		}
	} else {
		for (const v of present) {
			const n = numericPropertyValue(def, v ?? null)
			if (n !== null) numbers.push(n)
		}
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
	properties: ReadonlyMap<string, PropertyDef>,
	rates: RateTable | null
): { summaries: Record<string, number | null>; money: Record<string, MoneyOutcome> } {
	const summaries: Record<string, number | null> = {}
	const money: Record<string, MoneyOutcome> = {}
	for (const column of columns) {
		if (!column.summary) continue
		const def = columnProperty(column.key, properties)
		const context = { config: column.money, rates, fallbackUnit: def?.unit }
		summaries[column.key] = summarise(column.summary, rows, column.key, def, context)
		money[column.key] = moneyOutcome(rows, column.key, def, context)
	}
	return { summaries, money }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function compareRows(
	a: TableRow,
	b: TableRow,
	sorts: readonly TableSort[],
	properties: ReadonlyMap<string, PropertyDef>,
	rates: RateTable | null
): number {
	for (const sort of sorts) {
		let av = sort.key === LABEL_COLUMN ? a.label : a.cells[sort.key]
		let bv = sort.key === LABEL_COLUMN ? b.label : b.cells[sort.key]

		/*
		 * Money is compared in one currency, not as raw numbers. Sorting a mixed column by its digits
		 * puts 200 GEL above 100 USD and the order is nonsense — the same trap `max` had.
		 *
		 * The rate table's own base is the yardstick: any consistent currency gives the same ordering,
		 * and it needs no configuration. When a value cannot be converted it keeps its raw number, which
		 * is a worse answer than converting but a better one than dropping the row out of the table.
		 */
		const def = properties.get(sort.key)
		if (def?.type === 'financial' && rates) {
			const toBase = (value: Cell, units: Readonly<Record<string, string>>) => {
				if (typeof value !== 'number') return value
				return convertAmount(value, units[sort.key] ?? def.unit, rates.base, rates) ?? value
			}
			av = toBase(av, a.units)
			bv = toBase(bv, b.units)
		}

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

/** How one shape is wired to the table asking about it. */
interface Connection {
	/** Every arrow between the two, since a pair can be joined more than once. */
	edges: Edge[]
	/** `1` when the arrow points at the table, `-1` when it points away. Only used when signed. */
	sign: 1 | -1
}

/**
 * The value an edge column shows for one row.
 *
 * Several arrows can reach the same shape — two meals wanting the same ingredient — so numbers are
 * summed, which is the answer the shopping list wants. Anything else takes the first value it finds:
 * joining text across arrows would produce a cell that means nothing.
 */
function edgeCellValue(
	facts: FactsMap,
	connection: Connection | undefined,
	propertyId: string,
	properties: ReadonlyMap<string, PropertyDef>
): PropertyValue | undefined {
	if (!connection) return undefined
	const def = properties.get(propertyId)
	let total: number | null = null
	for (const edge of connection.edges) {
		const value = facts.get(edge.id)?.values[propertyId]
		if (value === undefined || value === null) continue
		const numeric = def ? numericPropertyValue(def, value) : null
		if (numeric === null) return value
		total = (total ?? 0) + numeric
	}
	return total ?? undefined
}

export function queryTable(
	facts: FactsMap,
	props: TableNodeProps,
	selfId: string,
	properties: ReadonlyMap<string, PropertyDef> = new Map(),
	/**
	 * Rates are *passed in*, never fetched here.
	 *
	 * This runs inside a computed cache whose whole job is to not recompute while a shape is dragged.
	 * An async fetch in here would make that impossible; taking the table as an input means rates
	 * arriving invalidates the cache exactly once, and dragging still touches nothing.
	 */
	rates: RateTable | null = null,
	/**
	 * The board's arrows. Passed in for the same reason rates are: this runs inside a computed cache,
	 * and reaching for the editor here would tie a pure function to a live store.
	 */
	edges: EdgeIndex = EMPTY_EDGE_INDEX
): TableResult {
	const { columns, groupBy, sorts } = props

	/*
	 * The shapes this table's arrows reach, resolved once.
	 *
	 * Filtered by the arrow's own *label* when one is asked for, which is what lets a single board hold
	 * "blocks" and "pays for" as separate relations without either knowing about the other. The label
	 * comes from the facts map, so it costs nothing extra — arrows are shapes, and the pipeline has
	 * always read every shape.
	 */
	let connected: ReadonlyMap<string, Connection> | null = null
	if (props.source.scope === 'connected') {
		const wanted = props.source.edgeLabel?.trim().toLowerCase()
		const found = new Map<string, Connection>()
		for (const edge of edgesTouching(edges, selfId, edgeDirectionOf(props.source))) {
			if (wanted && facts.get(edge.id)?.label.trim().toLowerCase() !== wanted) continue
			const other = otherEnd(edge, selfId)
			const existing = found.get(other)
			if (existing) {
				existing.edges.push(edge)
				// Fed *and* drained by the same shape: it is a source on balance, so it adds. Arbitrary
				// either way, but silently picking the negative reads as a bug when a total goes down.
				if (edge.to === selfId) existing.sign = 1
			} else {
				found.set(other, { edges: [edge], sign: edge.to === selfId ? 1 : -1 })
			}
		}
		connected = found
	}
	const signed = props.source.scope === 'connected' && props.source.signed === true

	// Every property a row needs, not just the visible columns: grouping and sorting by a property you
	// have chosen *not* to show is a normal thing to want, and reading only the columns made both
	// silently do nothing.
	const neededKeys = new Set<string>()
	for (const column of columns) if (column.key !== LABEL_COLUMN) neededKeys.add(column.key)
	if (groupBy && groupBy !== LABEL_COLUMN) {
		// A currency grouping needs the money column's *cell* present, since a row with no value for it
		// belongs in no currency bucket.
		neededKeys.add(currencyGroupProperty(groupBy) ?? groupBy)
	}
	for (const sort of sorts) if (sort.key !== LABEL_COLUMN) neededKeys.add(sort.key)

	// The property columns, without the built-in label. What decides row membership below.
	const columnKeys = columns.filter((c) => c.key !== LABEL_COLUMN).map((c) => c.key)

	const rows: TableRow[] = []
	for (const [id, shapeFacts] of facts) {
		if (!matchesSource(shapeFacts, props, selfId, id, properties, rates, connected)) continue

		const connection = connected?.get(id)
		const cells: Record<string, PropertyValue> = {}
		for (const key of neededKeys) {
			const onEdge = edgeColumnProperty(key)
			const value = onEdge
				? edgeCellValue(facts, connection, onEdge, properties)
				: shapeFacts.values[key]
			if (value === undefined) continue
			// A negated cell is the shape's contribution *to this table*, not a claim about the shape:
			// the note still says 2,000 on the canvas. Showing the sign in the row is what makes the
			// total below it add up in front of you rather than by assertion.
			cells[key] =
				signed && connection?.sign === -1 && typeof value === 'number' ? -value : value
		}

		// A row must *carry* at least one of the table's column properties. A board is full of
		// shapes that have nothing to do with this table — drawings, frames, the intro note — and a
		// row of "—" for each of them buries the rows the table is about. Attached-but-empty is the
		// opposite case: that shape opted into the property, so its row stays, with a blank cell.
		// A table with no property columns at all is a plain list of labels and keeps every match.
		if (columnKeys.length && !columnKeys.some((key) => key in cells)) continue

		rows.push({ shapeId: id, label: shapeFacts.label, cells, units: shapeFacts.units })
	}

	if (sorts.length) rows.sort((a, b) => compareRows(a, b, sorts, properties, rates))

	const matched = rows.length
	const groups: TableGroup[] =
		groupBy === null
			? rows.length
				? [{ key: null, rows, ...summariseColumns(columns, rows, properties, rates) }]
				: []
			: buildGroups(rows, groupBy, columns, properties, rates)

	return {
		groups,
		...summariseColumns(columns, rows, properties, rates),
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
	properties: ReadonlyMap<string, PropertyDef>,
	rates: RateTable | null
): TableGroup[] {
	const currencyOf = currencyGroupProperty(groupBy)
	const def = properties.get(currencyOf ?? groupBy)
	const buckets = new Map<string, TableRow[]>()

	for (const row of rows) {
		// Grouping by currency buckets on the row's *unit* rather than its value, so each bucket totals
		// its own currency and nothing has to be converted at all.
		if (currencyOf) {
			const code =
				row.cells[currencyOf] === undefined
					? '—'
					: (normaliseCurrency(row.units[currencyOf] ?? def?.unit) ?? '—')
			let bucket = buckets.get(code)
			if (!bucket) {
				bucket = []
				buckets.set(code, bucket)
			}
			bucket.push(row)
			continue
		}

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
				...summariseColumns(columns, groupRows, properties, rates),
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

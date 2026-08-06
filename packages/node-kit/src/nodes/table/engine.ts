import { createComputedCache, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { getCurrentRates, mergeRates, type ManualRates } from '../../properties/rates'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import { getPageFacts, rollupStats } from '../rollup/engine'
import {
	EMPTY_TABLE,
	queryTable,
	type MoneyOutcome,
	type TableGroup,
	type TableResult,
	type TableRow,
} from './query'
import { TABLE_NODE_TYPE } from './definition'

/**
 * Stage 2 for tables, over the **unchanged** stage 0/1 pipeline (`nodes/rollup/engine.ts`).
 *
 * Reusing `getPageFacts` rather than building a second facts pipeline is the point: facts are what
 * absorbs drag churn, and one shared computed means N tables on a board still cost one facts pass.
 *
 * A table contributes **no property values of its own**, which is what makes table-of-table cycles
 * impossible by construction — the same reason the rollup never had an `extractValues`.
 */
const tableCache = createComputedCache<Editor, TableResult, TLShape>(
	'lifeboard:table',
	(editor, shape) => {
		if (shape.type !== TABLE_NODE_TYPE) return EMPTY_TABLE
		rollupStats.aggregateRecomputes++
		const properties = propertyMap(readPropertyRegistry(editor))
		// Rates read reactively, so they are a *dependency* of this computed rather than something
		// fetched inside it: they arrive, this invalidates once, and a drag still recomputes nothing.
		// The table's own hand-entered rates win — see `mergeRates`.
		const rates = mergeRates(getCurrentRates(), (shape.props as { rates?: ManualRates }).rates)
		return queryTable(
			getPageFacts(editor).get(),
			shape.props as never,
			shape.id,
			properties,
			rates
		)
	},
	{
		// Dragging a table rewrites its x/y. Without this the entry would be invalidated and the whole
		// query would re-run on every pointer move even though the spec is unchanged. `meta` is compared
		// too, because a table can carry properties of its own like any other shape.
		areRecordsEqual: (a, b) => a.id === b.id && a.props === b.props && a.meta === b.meta,
		areResultsEqual: areTableResultsEqual,
	}
)

export function getTableResult(editor: Editor, shapeId: TLShapeId): TableResult {
	return tableCache.get(editor, shapeId) ?? EMPTY_TABLE
}

/**
 * Structural equality over a whole query result.
 *
 * Needed because the query rebuilds every row object on each run, so reference equality never fires —
 * and without this the table component would re-render on any board change at all, not just the ones
 * that alter what it shows. Compares only what is rendered: ids, labels, cells and summaries.
 */
export function areTableResultsEqual(a: TableResult, b: TableResult): boolean {
	if (a === b) return true
	if (a.matched !== b.matched || a.skipped !== b.skipped) return false
	if (!areSummariesEqual(a.summaries, b.summaries)) return false
	// Compared for the same reason units are, one function down: provenance is rendered, so a change to
	// it has to invalidate the cache or the note under the total goes stale.
	if (!areMoneyEqual(a.money, b.money)) return false
	if (a.groups.length !== b.groups.length) return false
	for (let i = 0; i < a.groups.length; i++) {
		if (!areGroupsEqual(a.groups[i]!, b.groups[i]!)) return false
	}
	return true
}

function areGroupsEqual(a: TableGroup, b: TableGroup): boolean {
	if (a.key !== b.key) return false
	if (a.rows.length !== b.rows.length) return false
	if (!areSummariesEqual(a.summaries, b.summaries)) return false
	if (!areMoneyEqual(a.money, b.money)) return false
	for (let i = 0; i < a.rows.length; i++) {
		if (!areRowsEqual(a.rows[i]!, b.rows[i]!)) return false
	}
	return true
}

function areMoneyEqual(
	a: Readonly<Record<string, MoneyOutcome>>,
	b: Readonly<Record<string, MoneyOutcome>>
): boolean {
	if (a === b) return true
	const aKeys = Object.keys(a)
	if (aKeys.length !== Object.keys(b).length) return false
	for (const key of aKeys) {
		const x = a[key]
		const y = b[key]
		if (!y || !x) return false
		if (
			x.unit !== y.unit ||
			x.mixed !== y.mixed ||
			x.excluded !== y.excluded ||
			x.converted !== y.converted
		) {
			return false
		}
	}
	return true
}

function areUnitsEqual(
	a: Readonly<Record<string, string>>,
	b: Readonly<Record<string, string>>
): boolean {
	if (a === b) return true
	const aKeys = Object.keys(a)
	if (aKeys.length !== Object.keys(b).length) return false
	for (const key of aKeys) if (a[key] !== b[key]) return false
	return true
}

function areRowsEqual(a: TableRow, b: TableRow): boolean {
	// Row *order* is part of the result — a re-sort is a real change — so rows are compared positionally
	// rather than as a set.
	if (a.shapeId !== b.shapeId || a.label !== b.label) return false
	/*
	 * Units are part of what is rendered, so they belong in this comparison.
	 *
	 * Leaving them out was a real bug and an instructive one: repricing a shape in USD changed nothing
	 * else about the result, so this returned "equal", the computed cache kept its previous value, and
	 * the table went on rendering the old currency. The card beside it — which reads the shape directly
	 * rather than through the cache — updated immediately, which is what made it look like a formatting
	 * problem rather than a caching one.
	 */
	if (!areUnitsEqual(a.units, b.units)) return false
	const aKeys = Object.keys(a.cells)
	if (aKeys.length !== Object.keys(b.cells).length) return false
	for (const key of aKeys) {
		if (!(key in b.cells)) return false
		const av = a.cells[key]
		const bv = b.cells[key]
		if (av === bv) continue
		// A list cell is a fresh array on every read, so reference equality never fires for tags.
		if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
			if (av.every((v, i) => v === bv[i])) continue
		}
		return false
	}
	return true
}

function areSummariesEqual(
	a: Readonly<Record<string, number | null>>,
	b: Readonly<Record<string, number | null>>
): boolean {
	if (a === b) return true
	const aKeys = Object.keys(a)
	if (aKeys.length !== Object.keys(b).length) return false
	for (const key of aKeys) {
		if (!(key in b) || a[key] !== b[key]) return false
	}
	return true
}

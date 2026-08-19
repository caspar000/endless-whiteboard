import { formatNumber, formatPropertyValue } from '../../../properties/format'
import type { PropertyDef } from '../../../properties/types'
import type { TableResult } from '../query'
import {
	summaryIsCount,
	summaryIsPercent,
	summaryKeepsUnit,
	type SummaryOp,
	type TableNodeProps,
} from '../spec'

/**
 * What every view is handed, and all it is handed.
 *
 * The result comes from the shape's cache entry (`getTableResult`) rather than being re-queried per
 * view, so two views can never disagree about what the board says — and a view that took an `editor`
 * could quietly start reading things the query deliberately leaves out, positions first among them
 * (see `docs/views-plan.md`, "The invariant that makes placement safe").
 */
export interface ViewProps {
	/** The card's own shape id — what a view needs to recognise feedback aimed at it (the drop hint). */
	id: string
	result: TableResult
	props: TableNodeProps
	properties: ReadonlyMap<string, PropertyDef>
	/**
	 * The card's own width, which `TableNodeProps` does not declare — `w`/`h` are injected into every
	 * node's props by the factory (`registry.tsx`), so a view has to be handed it.
	 *
	 * Here because a kanban divides it into lanes. Passed rather than read off the shape so that this
	 * stays the whole of a view's input: two views given the same props draw the same thing.
	 */
	width: number
	/**
	 * The card's height. Only a view that *divides* it needs this — a calendar has a fixed number of rows
	 * and shares out whatever room it is given, where a kanban's height is derived from its content
	 * instead (the placement pass writes it).
	 */
	height: number
}

/** Appends the red-negative modifier when the value behind a cell is a negative number. */
export function negClass(base: string, value: number | null | undefined | false | ''): string {
	return typeof value === 'number' && value < 0 ? `${base} ${base}--neg` : base
}

/**
 * Formats a summary in the right units.
 *
 * Three cases that genuinely differ: counts are plain integers, percentages get a `%`, and a `sum` of a
 * currency is money. `range` over dates is a count of days — which is why this asks the *op* what it
 * produced rather than assuming the column's own type applies to it.
 */
export function formatSummary(
	// `undefined` reaches here when a column has a summary configured but the result holds no entry for
	// it — same meaning as `null`: nothing to show.
	value: number | null | undefined,
	op: SummaryOp,
	def: PropertyDef | null,
	// `null` means the contributing rows disagree about the unit; `undefined` means "no unit".
	unit: string | undefined | null = def?.unit
): string {
	if (value === null || value === undefined) return '—'
	if (summaryIsPercent(op)) return `${Math.round(value)}%`
	if (summaryIsCount(op)) return formatNumber(value, 0)
	if (op === 'earliest' || op === 'latest') {
		return new Date(value).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		})
	}
	if (def && summaryKeepsUnit(op, def.type)) {
		// Mixed currencies: show the bare number and say so, rather than stamping one currency's symbol
		// on a total that is part something else. Converting between them is a separate feature.
		if (unit === null) return `${formatNumber(value)} (mixed)`
		return formatPropertyValue(def, value, unit)
	}
	return formatNumber(value)
}

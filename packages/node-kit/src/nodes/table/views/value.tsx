import {
	columnProperty,
	columnTitle,
	summaryIsCount,
	type TableColumn,
	type TableLayout,
} from '../spec'
import { formatSummary, negClass, type ViewProps } from './shared'

/**
 * Which column the big number comes from.
 *
 * `layout.valueColumn` when it names a column that has a summary — the explicit answer. Otherwise the
 * original rule: prefer a summary that *produces a value* (a sum, an average) over one that merely
 * counts, because the row count is already in the header and headlining it wastes the one number this
 * view exists to show. A table with only counting summaries still headlines the count — that is
 * genuinely all it has.
 *
 * Returns `null` when no column has a summary at all, which is a configuration that cannot draw
 * anything rather than an empty result. `blockedReason` reads this, so the two can never disagree
 * about whether there is a number to show.
 */
export function headlineColumn(
	columns: readonly TableColumn[],
	valueColumn: TableLayout['valueColumn']
): TableColumn | null {
	if (valueColumn) {
		const chosen = columns.find((c) => c.key === valueColumn && c.summary)
		// A chosen column that has since lost its summary (or been removed) falls through to the
		// heuristic rather than blanking the card: the number the user wanted is gone either way, and a
		// stale `valueColumn` should not be able to break a view that has other totals to show.
		if (chosen) return chosen
	}
	return (
		columns.find((c) => c.summary && !summaryIsCount(c.summary)) ??
		columns.find((c) => c.summary) ??
		null
	)
}

/**
 * The single big number — the whole of what the rollup node used to be, and what a table collapses to
 * when it is zoomed out past legibility (see `TableNodeComponent`).
 */
export function ValueView({ result, props, properties }: ViewProps) {
	const column = headlineColumn(props.columns, props.layout.valueColumn)
	// Guarded rather than assumed: the dispatcher renders `blockedReason` instead of this component when
	// there is no summarised column, so this branch is unreachable — and a component that would throw if
	// that ever changed is a worse thing to leave behind than one dash.
	if (!column?.summary) return <div className="lb-table__value">—</div>

	const value = result.summaries[column.key]
	const def = columnProperty(column.key, properties)
	// From the query, which has the rates. Recomputing it here with `rates: null` made every
	// convertible row look unconvertible and reported exclusions that had not happened.
	const money = result.money[column.key]
	return (
		<>
			<div className={negClass('lb-table__value', value)}>
				{formatSummary(value, column.summary, def, money?.mixed ? null : money?.unit)}
			</div>
			{/* A converted total must never look identical to a native one. */}
			{money && (money.converted || money.excluded > 0) && (
				<div className="lb-table__note">
					{[
						money.converted ? 'converted' : '',
						// Rates that are past their refresh time say so. A converted total that looks
						// current when it is a week old is worse than one that admits it.
						money.converted && money.asOf
							? `rates ${new Date(money.asOf).toLocaleDateString('en-GB', {
									day: 'numeric',
									month: 'short',
								})}${money.stale ? ' (stale)' : ''}`
							: '',
						money.excluded > 0 ? `${money.excluded} excluded` : '',
					]
						.filter(Boolean)
						.join(' · ')}
				</div>
			)}
			<div className="lb-table__op">
				{column.summary} · {columnTitle(column.key, properties)}
			</div>
		</>
	)
}

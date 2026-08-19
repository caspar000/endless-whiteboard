import { formatPropertyValue, numericPropertyValue } from '../../../properties/format'
import type { PropertyDef } from '../../../properties/types'
import type { TableGroup, TableRow } from '../query'
import { LABEL_COLUMN, columnProperty, columnTitle, type TableColumn } from '../spec'
import { formatSummary, negClass, type ViewProps } from './shared'

/**
 * The rows themselves — the view this node is named after.
 *
 * A read-only mirror of the shapes that matched: editing a cell would mean writing back to a shape
 * from a view, which raises questions about undo, about which shape a grouped row refers to, and about
 * what happens when a filter no longer matches after the edit. Editing the shape is the way to change
 * a value. (The kanban view is where a view *does* write back, and it writes a property rather than a
 * cell — see `docs/views-plan.md`.)
 */
export function TableView({ result, props, properties }: ViewProps) {
	const { columns, layout } = props

	if (!result.matched) {
		return <div className="lb-table__empty">Nothing matches yet</div>
	}

	const grouped = result.groups.length > 1 || result.groups[0]?.key !== null
	// The cap is shared across groups so the card's height stays bounded no matter how the rows are
	// bucketed; each group then shows its share and says what it held back.
	let budget = layout.maxRows

	return (
		<div className="lb-table__grid" style={{ gridTemplateColumns: templateFor(columns) }}>
			<div className="lb-table__row lb-table__row--head">
				{columns.map((column) => (
					<span className="lb-table__cell lb-table__cell--head" key={column.key}>
						{columnTitle(column.key, properties)}
					</span>
				))}
			</div>

			{result.groups.map((group) => {
				const shown = Math.max(0, Math.min(group.rows.length, budget))
				budget -= shown
				return (
					<GroupRows
						key={group.key ?? '__all'}
						group={group}
						columns={columns}
						properties={properties}
						shown={shown}
						showHeader={grouped}
					/>
				)
			})}

			{columns.some((c) => c.summary) && (
				<div className="lb-table__row lb-table__row--summary">
					{columns.map((column) => (
						<span
							className={negClass('lb-table__cell', column.summary && result.summaries[column.key])}
							key={column.key}
						>
							{column.summary
								? formatSummary(
										result.summaries[column.key],
										column.summary,
										columnProperty(column.key, properties),
										result.money[column.key]?.mixed ? null : result.money[column.key]?.unit
									)
								: ''}
						</span>
					))}
				</div>
			)}
		</div>
	)
}

function GroupRows({
	group,
	columns,
	properties,
	shown,
	showHeader,
}: {
	group: TableGroup
	columns: readonly TableColumn[]
	properties: ReadonlyMap<string, PropertyDef>
	shown: number
	showHeader: boolean
}) {
	const hidden = group.rows.length - shown
	return (
		<>
			{showHeader && (
				// The group's own summaries live here, in their columns — a grouped table whose buckets
				// showed only a row count would have lost what "By category" was for.
				<div className="lb-table__row lb-table__row--group">
					{columns.map((column, i) => (
						<span
							className={negClass(
								'lb-table__cell',
								i > 0 && column.summary ? group.summaries[column.key] : null
							)}
							key={column.key}
						>
							{i === 0 ? (
								<>
									<span className="lb-table__group-key">{group.key}</span>{' '}
									<span className="lb-table__group-count">{group.rows.length}</span>
								</>
							) : column.summary ? (
								formatSummary(
									group.summaries[column.key],
									column.summary,
									columnProperty(column.key, properties),
									group.money[column.key]?.mixed ? null : group.money[column.key]?.unit
								)
							) : (
								''
							)}
						</span>
					))}
				</div>
			)}
			{group.rows.slice(0, shown).map((row) => (
				<Row key={row.shapeId} row={row} columns={columns} properties={properties} />
			))}
			{hidden > 0 && (
				// Said out loud rather than silently truncated: a table that shows 12 of 40 rows without
				// mentioning it is lying about the board.
				<div className="lb-table__row lb-table__row--more">
					<span className="lb-table__more">+{hidden} more</span>
				</div>
			)}
		</>
	)
}

function Row({
	row,
	columns,
	properties,
}: {
	row: TableRow
	columns: readonly TableColumn[]
	properties: ReadonlyMap<string, PropertyDef>
}) {
	return (
		// `--data` marks a row that mirrors a shape, as against the head, group, summary and "+N more"
		// rows. Without it, "the rows of this table" has no selector — a chain of `:not()`s in every
		// caller, and a test looking for "Desk" matching the group header "desk".
		<div className="lb-table__row lb-table__row--data">
			{columns.map((column) => (
				<span
					className={negClass('lb-table__cell', cellNumeric(row, column, properties))}
					key={column.key}
					title={cellText(row, column, properties)}
				>
					{cellText(row, column, properties)}
				</span>
			))}
		</div>
	)
}

/** The cell's numeric value, when its column is a numeric property — what the red-negative check reads. */
function cellNumeric(
	row: TableRow,
	column: TableColumn,
	properties: ReadonlyMap<string, PropertyDef>
): number | null {
	if (column.key === LABEL_COLUMN) return null
	const def = properties.get(column.key)
	if (!def) return null
	const value = row.cells[column.key]
	return value === undefined ? null : numericPropertyValue(def, value)
}

function cellText(
	row: TableRow,
	column: TableColumn,
	properties: ReadonlyMap<string, PropertyDef>
): string {
	if (column.key === LABEL_COLUMN) return row.label || '—'
	const def = properties.get(column.key)
	const value = row.cells[column.key]
	if (value === undefined) return '—'
	// With no definition there is no way to format the value truthfully, so it is shown raw rather than
	// guessed at. The unit comes from the *row*, not the column: money is a property of the amount, so
	// two rows of one column can be in different currencies.
	return def
		? formatPropertyValue(def, value, row.units[column.key] ?? def.unit)
		: String(value ?? '—')
}

/** Column widths as flex weights, so they hold their proportions as the shape is resized. */
function templateFor(columns: readonly TableColumn[]): string {
	return columns.map((c) => `minmax(0, ${Math.max(c.width, 0.1)}fr)`).join(' ')
}

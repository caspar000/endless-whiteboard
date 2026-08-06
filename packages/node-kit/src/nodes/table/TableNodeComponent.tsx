import { memo } from 'react'
import { stopEventPropagation, useValue } from 'tldraw'
import { NodeEditorPopover } from '../../NodeEditorPopover'
import { formatNumber, formatPropertyValue, numericPropertyValue } from '../../properties/format'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import type { PropertyDef } from '../../properties/types'
import type { NodeComponentProps } from '../../registry'
import { getTableResult } from './engine'
import { moneyOutcome, type TableGroup, type TableResult, type TableRow } from './query'
import { TableConfig } from './TableConfig'
import {
	LABEL_COLUMN,
	columnProperty,
	columnTitle,
	summaryIsCount,
	summaryIsPercent,
	summaryKeepsUnit,
	type SummaryOp,
	type TableColumn,
	type TableNodeProps,
} from './spec'

/**
 * Below this zoom a row of cells is a few pixels tall and unreadable, so the table collapses to the
 * headline number it would otherwise bury. Chosen to match the point at which the 11px cell text stops
 * being legible rather than a round number.
 */
const COLLAPSE_ZOOM = 0.35

function TableNodeComponentImpl({ shape, isEditing, editor }: NodeComponentProps<TableNodeProps>) {
	const { title, columns, layout } = shape.props

	// Subscribes to this table's cache entry. Its `areResultsEqual` is structural, so this re-renders
	// only when what it displays actually changes — not on every board edit.
	const result = useValue('table', () => getTableResult(editor, shape.id), [editor, shape.id])
	const properties = useValue('table-properties', () => propertyMap(readPropertyRegistry(editor)), [
		editor,
	])
	// Zoom, unlike everything above, is *expected* to change constantly — but it lives in a
	// session-scoped record the facts pipeline never reads, so this costs a re-render of this component
	// and nothing downstream (§4.3).
	const zoom = useValue('zoom', () => editor.getZoomLevel(), [editor])

	const collapsed = layout.mode === 'value' || (zoom < COLLAPSE_ZOOM && !isEditing)

	const body = (
		<div className="lb-table__body">
			<div className="lb-table__header">
				<span className="lb-table__title">{title || 'Table'}</span>
				<span className="lb-table__count">
					{result.matched} {result.matched === 1 ? 'row' : 'rows'}
				</span>
			</div>

			{collapsed ? (
				<Headline result={result} columns={columns} properties={properties} />
			) : (
				<Grid result={result} columns={columns} properties={properties} maxRows={layout.maxRows} />
			)}

			{result.skipped > 0 && <div className="lb-table__meta">{result.skipped} without a value</div>}
		</div>
	)

	if (!isEditing) return <div className="lb-table">{body}</div>

	return (
		<div
			className="lb-table lb-table--editing"
			onPointerDown={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			style={{ pointerEvents: 'all' }}
		>
			{body}
			<NodeEditorPopover shape={shape} editor={editor} width={340}>
				<TableConfig shape={shape} editor={editor} />
			</NodeEditorPopover>
		</div>
	)
}

/**
 * The single big number — the whole of what the rollup node used to be.
 *
 * Prefers a column whose summary *produces a value* (a sum, an average) over one that merely counts:
 * the row count is already in the header, so headlining it wastes the one number this mode exists to
 * show. A table with only counting summaries still headlines the count — that is genuinely all it has.
 *
 * With no summary configured at all there is nothing to headline, so it says so rather than showing a
 * misleading zero.
 */
function Headline({
	result,
	columns,
	properties,
}: {
	result: TableResult
	columns: readonly TableColumn[]
	properties: ReadonlyMap<string, PropertyDef>
}) {
	const column =
		columns.find((c) => c.summary && !summaryIsCount(c.summary)) ?? columns.find((c) => c.summary)
	if (!column?.summary) {
		return <div className="lb-table__empty">Pick a column summary to show a total</div>
	}

	const value = result.summaries[column.key]
	const def = columnProperty(column.key, properties)
	const allRows = result.groups.flatMap((g) => g.rows)
	const money = moneyOutcome(allRows, column.key, def, { config: column.money, rates: null })
	return (
		<>
			<div className={negClass('lb-table__value', value)}>
				{formatSummary(value, column.summary, def, money.mixed ? null : money.unit)}
			</div>
			{/* A converted total must never look identical to a native one. */}
			{(money.converted || money.excluded > 0) && (
				<div className="lb-table__note">
					{[
						money.converted ? 'converted' : '',
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

function Grid({
	result,
	columns,
	properties,
	maxRows,
}: {
	result: TableResult
	columns: readonly TableColumn[]
	properties: ReadonlyMap<string, PropertyDef>
	maxRows: number
}) {
	if (!result.matched) {
		return <div className="lb-table__empty">Nothing matches yet</div>
	}

	const grouped = result.groups.length > 1 || result.groups[0]?.key !== null
	// The cap is shared across groups so the card's height stays bounded no matter how the rows are
	// bucketed; each group then shows its share and says what it held back.
	let budget = maxRows

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
										summaryUnit(
											result.groups.flatMap((g) => g.rows),
											column,
											properties
										)
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
									summaryUnit(group.rows, column, properties)
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

/** Appends the red-negative modifier when the value behind a cell is a negative number. */
function negClass(base: string, value: number | null | undefined | false | ''): string {
	return typeof value === 'number' && value < 0 ? `${base} ${base}--neg` : base
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

/** The unit a summary is expressed in, or `null` when its rows disagree and nothing converted them. */
function summaryUnit(
	rows: readonly TableRow[],
	column: TableColumn,
	properties: ReadonlyMap<string, PropertyDef>
): string | undefined | null {
	const def = columnProperty(column.key, properties)
	const money = moneyOutcome(rows, column.key, def, { config: column.money, rates: null })
	return money.mixed ? null : money.unit
}

/** Column widths as flex weights, so they hold their proportions as the shape is resized. */
function templateFor(columns: readonly TableColumn[]): string {
	return columns.map((c) => `minmax(0, ${Math.max(c.width, 0.1)}fr)`).join(' ')
}

export const TableNodeComponent = memo(
	TableNodeComponentImpl,
	(prev, next) =>
		prev.isEditing === next.isEditing &&
		prev.shape.props === next.shape.props &&
		// A property edit changes only `meta` — a table can carry properties like any other shape.
		prev.shape.meta === next.shape.meta
)

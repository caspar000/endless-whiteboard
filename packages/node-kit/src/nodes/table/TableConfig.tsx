import { useValue, type Editor } from 'tldraw'
import { currenciesUsed, getCurrentRates, normaliseCurrency } from '../../properties/rates'
import { propertyMap, readPropertyRegistry } from '../../properties/schema'
import type { PropertyDef } from '../../properties/types'
import { updateNodeProps, type NodeShape } from '../../registry'
import { getPageFacts } from '../rollup/engine'
import { getTableResult } from './engine'
import {
	DEFAULT_COLUMN_WIDTH,
	LABEL_COLUMN,
	LAYOUT_MODES,
	CURRENCY_GROUP_PREFIX,
	TABLE_SCOPES,
	columnTitle,
	filterOpNeedsValue,
	filterOpsForType,
	summaryOpsForType,
	type FilterOp,
	type LayoutMode,
	type MoneyConfig,
	type SummaryOp,
	type TableColumn,
	type TableFilter,
	type TableNodeProps,
	type TableScope,
} from './spec'

/**
 * The table's configuration: Source, Columns, Group and Sort.
 *
 * Every picker is populated from what exists — properties from the board's registry, frames and shape
 * types from the current page — so a mistyped name can never appear as an option, and operators are
 * gated by the chosen property's type so a filter that could only ever match nothing can't be built.
 *
 * **Rendered in the popover, not a docked panel** as the plan proposed. The popover already tracks the
 * shape through pans and zooms and already scrolls (`max-height` in CSS); docking would be a new UI
 * pattern introduced for one node type. If the config outgrows this, docking is a contained change —
 * the panel is one component.
 */
export function TableConfig({
	shape,
	editor,
}: {
	shape: NodeShape<TableNodeProps>
	editor: Editor
}) {
	const { title, source, columns, groupBy, sorts, layout } = shape.props
	const update = (props: Partial<TableNodeProps>) => updateNodeProps(editor, shape, props)

	const properties = useValue('properties', () => readPropertyRegistry(editor), [editor])
	const frames = useValue(
		'frames',
		() =>
			editor
				.getCurrentPageShapes()
				.filter((s) => s.type === 'frame')
				.map((s) => ({ id: s.id, name: (s.props as { name?: string }).name || 'Frame' })),
		[editor]
	)
	// The shape types actually on the board, so the type filter offers what is there rather than a list
	// of everything tldraw can make.
	const shapeTypes = useValue(
		'shape-types',
		() => [...new Set([...getPageFacts(editor).get().values()].map((f) => f.type))].sort(),
		[editor]
	)

	const byId = new Map(properties.map((p) => [p.id, p]))
	/** Every column key that can be chosen: the shape's own name, plus each defined property. */
	const columnKeys = [LABEL_COLUMN, ...properties.map((p) => p.id)]
	const unusedKeys = columnKeys.filter((key) => !columns.some((c) => c.key === key))

	return (
		<div className="lb-tcfg">
			<label className="lb-tcfg__row">
				<span>Title</span>
				<input
					aria-label="Table title"
					value={title}
					onChange={(e) => update({ title: e.currentTarget.value })}
					onKeyDown={(e) => e.stopPropagation()}
				/>
			</label>

			<label className="lb-tcfg__row">
				<span>Show as</span>
				<select
					aria-label="Show as"
					value={layout.mode}
					onChange={(e) =>
						update({ layout: { ...layout, mode: e.currentTarget.value as LayoutMode } })
					}
				>
					{LAYOUT_MODES.map((mode) => (
						<option key={mode} value={mode}>
							{mode === 'value' ? 'one big number' : 'a table'}
						</option>
					))}
				</select>
			</label>

			<Section title="Source">
				<label className="lb-tcfg__row">
					<span>Scope</span>
					<select
						aria-label="Scope"
						value={source.scope}
						onChange={(e) =>
							update({ source: { ...source, scope: e.currentTarget.value as TableScope } })
						}
					>
						{TABLE_SCOPES.map((scope) => (
							<option key={scope} value={scope}>
								{scope === 'page' ? 'whole board' : 'inside frame'}
							</option>
						))}
					</select>
				</label>

				{source.scope === 'frame' && (
					<label className="lb-tcfg__row">
						<span>Frame</span>
						<select
							aria-label="Frame"
							value={source.frameId ?? ''}
							onChange={(e) =>
								update({ source: { ...source, frameId: e.currentTarget.value || null } })
							}
						>
							<option value="">— pick a frame —</option>
							{frames.map((frame) => (
								<option key={frame.id} value={frame.id}>
									{frame.name}
								</option>
							))}
						</select>
					</label>
				)}

				<label className="lb-tcfg__row">
					<span>Kind</span>
					<select
						aria-label="Kind"
						value={source.shapeTypes?.[0] ?? ''}
						onChange={(e) => {
							const value = e.currentTarget.value
							update({ source: { ...source, shapeTypes: value ? [value] : null } })
						}}
					>
						<option value="">anything</option>
						{shapeTypes.map((type) => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>
				</label>

				{source.filters.map((filter, i) => (
					<FilterRow
						key={i}
						filter={filter}
						index={i}
						properties={properties}
						onChange={(next) =>
							update({
								source: { ...source, filters: source.filters.map((f, j) => (j === i ? next : f)) },
							})
						}
						onRemove={() =>
							update({ source: { ...source, filters: source.filters.filter((_, j) => j !== i) } })
						}
					/>
				))}

				{properties.length > 0 && (
					<button
						className="lb-tcfg__add"
						onClick={() => {
							const first = properties[0]!
							update({
								source: {
									...source,
									filters: [
										...source.filters,
										{ propertyId: first.id, op: filterOpsForType(first.type)[0]!, value: null },
									],
								},
							})
						}}
					>
						+ Filter
					</button>
				)}
			</Section>

			<CurrencySection shape={shape} editor={editor} update={update} />

			<Section title="Columns">
				{columns.map((column, i) => (
					<div className="lb-tcfg__col" key={column.key}>
						<span className="lb-tcfg__col-name" title={columnTitle(column.key, byId)}>
							{columnTitle(column.key, byId)}
						</span>
						<select
							aria-label={`Summary of ${columnTitle(column.key, byId)}`}
							value={column.summary ?? ''}
							onChange={(e) =>
								update({
									columns: columns.map((c, j) =>
										j === i
											? { ...c, summary: (e.currentTarget.value || null) as SummaryOp | null }
											: c
									),
								})
							}
						>
							<option value="">no summary</option>
							{summaryOpsForType(byId.get(column.key)?.type ?? null).map((op) => (
								<option key={op} value={op}>
									{op}
								</option>
							))}
						</select>
						<button
							className="lb-tcfg__move"
							aria-label={`Move ${columnTitle(column.key, byId)} left`}
							disabled={i === 0}
							onClick={() => update({ columns: swap(columns, i, i - 1) })}
						>
							‹
						</button>
						<button
							className="lb-tcfg__move"
							aria-label={`Move ${columnTitle(column.key, byId)} right`}
							disabled={i === columns.length - 1}
							onClick={() => update({ columns: swap(columns, i, i + 1) })}
						>
							›
						</button>
						<button
							className="lb-tcfg__remove"
							aria-label={`Remove ${columnTitle(column.key, byId)} column`}
							onClick={() => update({ columns: columns.filter((_, j) => j !== i) })}
						>
							×
						</button>
					</div>
				))}

				{unusedKeys.length > 0 && (
					<div className="lb-tcfg__chips">
						{unusedKeys.map((key) => (
							<button
								key={key}
								className="lb-tcfg__chip"
								onClick={() =>
									update({
										columns: [...columns, { key, summary: null, width: DEFAULT_COLUMN_WIDTH }],
									})
								}
							>
								+ {columnTitle(key, byId)}
							</button>
						))}
					</div>
				)}
			</Section>

			<Section title="Group & sort">
				<label className="lb-tcfg__row">
					<span>Group by</span>
					<select
						aria-label="Group by"
						value={groupBy ?? ''}
						onChange={(e) => update({ groupBy: e.currentTarget.value || null })}
					>
						<option value="">— none —</option>
						{columnKeys.map((key) => (
							<option key={key} value={key}>
								{columnTitle(key, byId)}
							</option>
						))}
						{/*
						 * Grouping by a money column's *currency* rather than its value: a subtotal per
						 * currency, each in its own, with nothing converted and so nothing to be stale.
						 * Often the honest answer to "what did I spend in USD".
						 */}
						{columnKeys
							.filter((key) => byId.get(key)?.type === 'financial')
							.map((key) => (
								<option key={`cur-${key}`} value={`${CURRENCY_GROUP_PREFIX}${key}`}>
									{columnTitle(key, byId)} currency
								</option>
							))}
					</select>
				</label>

				<label className="lb-tcfg__row">
					<span>Sort by</span>
					<select
						aria-label="Sort by"
						value={sorts[0]?.key ?? ''}
						onChange={(e) => {
							const key = e.currentTarget.value
							update({ sorts: key ? [{ key, dir: sorts[0]?.dir ?? 'asc' }] : [] })
						}}
					>
						<option value="">— board order —</option>
						{columnKeys.map((key) => (
							<option key={key} value={key}>
								{columnTitle(key, byId)}
							</option>
						))}
					</select>
				</label>

				{sorts.length > 0 && (
					<label className="lb-tcfg__row">
						<span>Direction</span>
						<select
							aria-label="Sort direction"
							value={sorts[0]!.dir}
							onChange={(e) =>
								update({ sorts: [{ ...sorts[0]!, dir: e.currentTarget.value as 'asc' | 'desc' }] })
							}
						>
							<option value="asc">ascending</option>
							<option value="desc">descending</option>
						</select>
					</label>
				)}
			</Section>
		</div>
	)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="lb-tcfg__section">
			<div className="lb-tcfg__section-title">{title}</div>
			{children}
		</div>
	)
}

function FilterRow({
	filter,
	index,
	properties,
	onChange,
	onRemove,
}: {
	filter: TableFilter
	index: number
	properties: readonly PropertyDef[]
	onChange: (next: TableFilter) => void
	onRemove: () => void
}) {
	const def = properties.find((p) => p.id === filter.propertyId)
	const ops = def ? filterOpsForType(def.type) : (['is'] as FilterOp[])

	return (
		<div className="lb-tcfg__filter">
			<select
				aria-label={`Filter ${index + 1} property`}
				value={filter.propertyId}
				onChange={(e) => {
					const next = properties.find((p) => p.id === e.currentTarget.value)
					if (!next) return
					// Retyping the property can invalidate the operator, so it falls back to one that fits
					// rather than leaving a filter that silently matches nothing.
					const nextOps = filterOpsForType(next.type)
					onChange({
						propertyId: next.id,
						op: nextOps.includes(filter.op) ? filter.op : nextOps[0]!,
						value: filter.value,
					})
				}}
			>
				{properties.map((p) => (
					<option key={p.id} value={p.id}>
						{p.name}
					</option>
				))}
			</select>

			<select
				aria-label={`Filter ${index + 1} operator`}
				value={filter.op}
				onChange={(e) => onChange({ ...filter, op: e.currentTarget.value as FilterOp })}
			>
				{ops.map((op) => (
					<option key={op} value={op}>
						{op}
					</option>
				))}
			</select>

			{filterOpNeedsValue(filter.op) ? (
				def?.type === 'checkbox' ? (
					<select
						aria-label={`Filter ${index + 1} value`}
						value={filter.value === true ? 'true' : 'false'}
						onChange={(e) => onChange({ ...filter, value: e.currentTarget.value === 'true' })}
					>
						<option value="true">checked</option>
						<option value="false">unchecked</option>
					</select>
				) : (
					<input
						aria-label={`Filter ${index + 1} value`}
						value={filter.value === null ? '' : String(filter.value)}
						type={def?.type === 'date' ? 'date' : 'text'}
						list={def?.options?.length ? `lb-fopts-${filter.propertyId}` : undefined}
						onChange={(e) => onChange({ ...filter, value: e.currentTarget.value })}
						onKeyDown={(e) => e.stopPropagation()}
					/>
				)
			) : (
				<span />
			)}

			{def?.options?.length ? (
				<datalist id={`lb-fopts-${filter.propertyId}`}>
					{def.options.map((opt) => (
						<option key={opt} value={opt} />
					))}
				</datalist>
			) : null}

			<button
				className="lb-tcfg__remove"
				aria-label={`Remove filter ${index + 1}`}
				onClick={onRemove}
			>
				×
			</button>
		</div>
	)
}

function swap(columns: readonly TableColumn[], a: number, b: number): TableColumn[] {
	const next = [...columns]
	const tmp = next[a]!
	next[a] = next[b]!
	next[b] = tmp
	return next
}

/**
 * Currency handling, per money column.
 *
 * Only rendered when the table actually has a summarised money column *and* the rows carry more than
 * one currency — a board priced entirely in one currency has no question to answer, and a section
 * offering to convert GEL into GEL is noise.
 *
 * The currencies offered are the ones present in the data rather than a list of every ISO code, so an
 * option that could only ever match nothing cannot be picked. Same principle as the filter operators.
 */
function CurrencySection({
	shape,
	editor,
	update,
}: {
	shape: NodeShape<TableNodeProps>
	editor: Editor
	update: (props: Partial<TableNodeProps>) => void
}) {
	const { columns, rates } = shape.props
	const properties = useValue('properties', () => readPropertyRegistry(editor), [editor])
	const byId = propertyMap(properties)

	// The currencies actually in the rows this table matches.
	const result = useValue('table-result', () => getTableResult(editor, shape.id), [editor, shape.id])
	const moneyColumns = columns.filter(
		(c) => c.summary && byId.get(c.key)?.type === 'financial'
	)
	const present = currenciesUsed(
		result.groups.flatMap((g) =>
			g.rows.flatMap((row) =>
				moneyColumns.map((c) => row.units[c.key] ?? byId.get(c.key)?.unit)
			)
		)
	)
	if (!moneyColumns.length || present.length < 2) return null

	const base = normaliseCurrency(getCurrentRates()?.base) ?? 'GEL'
	const setColumn = (key: string, money: MoneyConfig | undefined) =>
		update({ columns: columns.map((c) => (c.key === key ? { ...c, money } : c)) })

	return (
		<Section title="Currency">
			{moneyColumns.map((column) => {
				const name = columnTitle(column.key, byId)
				const to = column.money?.to ?? ''
				const include = column.money?.include
				return (
					<div className="lb-tcfg__money" key={column.key}>
						<div className="lb-tcfg__col">
							<span className="lb-tcfg__col-name" title={name}>
								{name}
							</span>
							<select
								aria-label={`Show ${name} in`}
								value={to}
								onChange={(e) => {
									const next = e.currentTarget.value
									setColumn(
										column.key,
										next ? { to: next, include: include ?? null } : undefined
									)
								}}
							>
								{/* Not converting is a real choice, and the default one. */}
								<option value="">don't convert</option>
								{present.map((code) => (
									<option key={code} value={code}>
										in {code}
									</option>
								))}
							</select>
						</div>

						{to && (
							<div className="lb-tcfg__chips" role="group" aria-label={`Currencies in ${name}`}>
								{present.map((code) => {
									const on = !include || include.includes(code)
									return (
										<button
											key={code}
											className={on ? 'lb-tcfg__cur lb-tcfg__cur--on' : 'lb-tcfg__cur'}
											aria-pressed={on}
											onClick={() => {
												const current = include ?? present
												const next = on
													? current.filter((c) => c !== code)
													: [...current, code]
												// Everything selected is stored as `null`, so a currency added to the
												// board later is included by default rather than silently dropped.
												setColumn(column.key, {
													to,
													include: next.length === present.length ? null : next,
												})
											}}
										>
											{code}
										</button>
									)
								})}
							</div>
						)}
					</div>
				)
			})}

			{/*
			 * Hand-entered rates, which beat the fetched ones. Stated in the same direction the provider
			 * uses — units of the currency per one base — so what is stored and what is shown agree.
			 */}
			{present
				.filter((code) => code !== base)
				.map((code) => (
					<label className="lb-tcfg__rate" key={code}>
						<span>
							1 {base} =
						</span>
						<input
							aria-label={`Rate for ${code}`}
							inputMode="decimal"
							placeholder={String(getCurrentRates()?.rates[code] ?? '')}
							value={rates[code] ?? ''}
							onChange={(e) => {
								const raw = e.currentTarget.value.trim()
								const next = { ...rates }
								const parsed = Number.parseFloat(raw)
								// Cleared or unparseable falls back to the fetched rate rather than sticking at
								// the last good number, which would be a rate nobody chose.
								if (raw && Number.isFinite(parsed) && parsed > 0) next[code] = parsed
								else delete next[code]
								update({ rates: next })
							}}
							onKeyDown={(e) => e.stopPropagation()}
						/>
						<span>{code}</span>
					</label>
				))}
		</Section>
	)
}

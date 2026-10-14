import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { useValue, type Editor, type TLShape } from '@lifeboard/canvas'
import {
	CARD_WIDTH_RANGE,
	DATE_STYLES,
	LAYOUT_SIZES,
	ROW_ALIGNS,
	SLOTS,
	displaysFor,
	layoutFromAuto,
	readPropertyLayout,
	type DateStyle,
	type LayoutElement,
	type LayoutSize,
	type LayoutWeight,
	type PropertyDisplay,
	type PropertyLayout,
	type RowAlign,
	type Slot,
} from './layout'
import {
	addElement,
	addRow,
	elementAt,
	layoutsMatch,
	moveElement,
	moveRow,
	removeElement,
	removeRow,
	replaceElement,
	setPropertyLayouts,
	setRowAlign,
	setWidth,
	type ElementPath,
} from './layoutEdit'
import { findProperty, readPropertyRegistry } from './schema'
import type { PropertyDef } from './types'
import { orderedPropertyIds, readHiddenPropertyIds } from './values'

const SLOT_LABELS: Record<Slot, string> = { left: 'Left', center: 'Centre', right: 'Right' }
const DEFAULT_FIXED_WIDTH = 240

/**
 * The Display tab: builds a card layout by hand (docs/property-display-plan.md).
 *
 * Works on every target at once when their layouts match, which is what makes per-node copies
 * bearable: select the thirty event cards and change them together. When they differ, it offers to
 * make them match rather than guessing which one you meant.
 */
export function LayoutPanel({
	editor,
	shape,
	targets,
	onEditYaml,
}: {
	editor: Editor
	/** The shape the panel was opened on. Its layout is the one shown. */
	shape: TLShape
	/** Every shape an edit goes to: the selection, or just `shape`. */
	targets: readonly TLShape[]
	onEditYaml?: () => void
}) {
	const registry = useValue('lifeboard:layout-panel-registry', () => readPropertyRegistry(editor), [editor])
	const layout = readPropertyLayout(shape)
	const match = layoutsMatch(targets)
	const [selected, setSelected] = useState<ElementPath | null>(null)
	const dragging = useRef<ElementPath | null>(null)

	const commit = (next: PropertyLayout | null) => setPropertyLayouts(editor, targets, next)
	const many = targets.length > 1

	if (!match) {
		return (
			<div className="lb-display">
				<p className="lb-props__empty">These {targets.length} cards have different layouts.</p>
				<button className="lb-display__button" onClick={() => commit(layout)}>
					Use this card’s layout on all
				</button>
			</div>
		)
	}

	if (!layout) {
		const customise = () => {
			const hidden = readHiddenPropertyIds(shape)
			const defs = orderedPropertyIds(shape)
				.filter((id) => !hidden.has(id))
				.flatMap((id) => findProperty(registry, id) ?? [])
			commit(layoutFromAuto(defs))
		}
		return (
			<div className="lb-display">
				<p className="lb-props__empty">
					{many ? `These ${targets.length} cards use` : 'This card uses'} the automatic layout: badges,
					one line of values, chips and bars.
				</p>
				<div className="lb-display__footer">
					<button className="lb-display__button lb-display__button--primary" onClick={customise}>
						Customise
					</button>
					{onEditYaml && (
						<button className="lb-display__button" onClick={onEditYaml}>
							Edit as YAML
						</button>
					)}
				</div>
			</div>
		)
	}

	const current = selected ? elementAt(layout, selected) : undefined

	const drop = (e: DragEvent, to: ElementPath) => {
		e.preventDefault()
		e.stopPropagation()
		const from = dragging.current
		dragging.current = null
		if (!from) return
		commit(moveElement(layout, from, to))
		setSelected(null)
	}

	return (
		<div className="lb-display">
			{many && <p className="lb-props__empty">Editing {targets.length} cards together.</p>}
			<WidthControl layout={layout} onChange={commit} />

			{layout.rows.map((row, r) => (
				<div key={r} className="lb-display__row">
					<div className="lb-display__row-head">
						<span className="lb-display__row-title">Row {r + 1}</span>
						<select
							className="lb-display__select"
							aria-label={`Alignment of row ${r + 1}`}
							value={row.align ?? 'middle'}
							onChange={(e) => commit(setRowAlign(layout, r, e.target.value as RowAlign))}
						>
							{ROW_ALIGNS.map((align) => (
								<option key={align} value={align}>
									{align}
								</option>
							))}
						</select>
						<button
							className="lb-display__icon"
							aria-label={`Move row ${r + 1} up`}
							disabled={r === 0}
							onClick={() => (commit(moveRow(layout, r, -1)), setSelected(null))}
						>
							<ArrowUp size={12} />
						</button>
						<button
							className="lb-display__icon"
							aria-label={`Move row ${r + 1} down`}
							disabled={r === layout.rows.length - 1}
							onClick={() => (commit(moveRow(layout, r, 1)), setSelected(null))}
						>
							<ArrowDown size={12} />
						</button>
						<button
							className="lb-display__icon"
							aria-label={`Remove row ${r + 1}`}
							onClick={() => (commit(removeRow(layout, r)), setSelected(null))}
						>
							<X size={12} />
						</button>
					</div>
					{SLOTS.map((slot) => (
						<div
							key={slot}
							className="lb-display__slot"
							onDragOver={(e) => e.preventDefault()}
							onDrop={(e) => drop(e, { row: r, slot, index: Infinity })}
						>
							<span className="lb-display__slot-name">{SLOT_LABELS[slot]}</span>
							<div className="lb-display__chips">
								{(row[slot] ?? []).map((element, index) => {
									const path = { row: r, slot, index }
									const isSelected =
										selected?.row === r && selected.slot === slot && selected.index === index
									return (
										<button
											key={index}
											className={`lb-display__chip${isSelected ? ' lb-display__chip--selected' : ''}`}
											draggable
											aria-pressed={isSelected}
											onDragStart={(e) => {
												e.dataTransfer.effectAllowed = 'move'
												e.dataTransfer.setData('text/plain', 'layout-element')
												dragging.current = path
											}}
											onDragOver={(e) => e.preventDefault()}
											onDrop={(e) => drop(e, path)}
											onClick={() => setSelected(isSelected ? null : path)}
										>
											<GripVertical size={11} aria-hidden />
											{elementLabel(element, registry)}
										</button>
									)
								})}
								<AddElement
									registry={registry}
									label={`Add to row ${r + 1}, ${SLOT_LABELS[slot].toLowerCase()}`}
									onAdd={(element) => commit(addElement(layout, r, slot, element))}
								/>
							</div>
						</div>
					))}
					{current && selected?.row === r && (
						<ElementEditor
							element={current}
							registry={registry}
							onChange={(element) => commit(replaceElement(layout, selected, element))}
							onRemove={() => (commit(removeElement(layout, selected)), setSelected(null))}
						/>
					)}
				</div>
			))}

			<div className="lb-display__footer">
				<button className="lb-display__button" onClick={() => commit(addRow(layout))}>
					+ Row
				</button>
				<button
					className="lb-display__button"
					onClick={() => commit(addRow(layout, { left: [{ kind: 'separator' }] }))}
				>
					+ Separator
				</button>
			</div>
			<div className="lb-display__footer">
				{onEditYaml && (
					<button className="lb-display__button" onClick={onEditYaml}>
						Edit as YAML
					</button>
				)}
				<button className="lb-display__button" onClick={() => (commit(null), setSelected(null))}>
					Use automatic
				</button>
			</div>
		</div>
	)
}

function elementLabel(element: LayoutElement, registry: readonly PropertyDef[]): string {
	switch (element.kind) {
		case 'property': {
			const name = findProperty(registry, element.property)?.name ?? element.property
			return element.as ? `${name} · ${element.as}` : name
		}
		case 'text':
			return `“${element.text}”`
		case 'table':
			return `Table (${element.properties.length})`
		case 'separator':
			return 'Separator'
	}
}

/** A native select as the add button: compact, keyboard-friendly, and it lists everything at once. */
function AddElement({
	registry,
	label,
	onAdd,
}: {
	registry: readonly PropertyDef[]
	label: string
	onAdd: (element: LayoutElement) => void
}) {
	return (
		<select
			className="lb-display__add"
			aria-label={label}
			value=""
			onChange={(e) => {
				const value = e.target.value
				if (value === 'text') onAdd({ kind: 'text', text: 'Label' })
				else if (value === 'table') onAdd({ kind: 'table', properties: [] })
				else if (value === 'separator') onAdd({ kind: 'separator' })
				else if (value.startsWith('property:')) onAdd({ kind: 'property', property: value.slice(9) })
			}}
		>
			<option value="">+</option>
			<optgroup label="Properties">
				{registry.map((def) => (
					<option key={def.id} value={`property:${def.id}`}>
						{def.name}
					</option>
				))}
			</optgroup>
			<optgroup label="Other">
				<option value="text">Text</option>
				<option value="table">Table</option>
				<option value="separator">Separator</option>
			</optgroup>
		</select>
	)
}

function WidthControl({
	layout,
	onChange,
}: {
	layout: PropertyLayout
	onChange: (layout: PropertyLayout) => void
}) {
	const width = layout.width
	const mode = width === undefined ? 'default' : typeof width === 'number' ? 'fixed' : width
	return (
		<div className="lb-display__width">
			<span className="lb-display__slot-name">Width</span>
			<select
				className="lb-display__select"
				aria-label="Card width"
				value={mode}
				onChange={(e) => {
					const next = e.target.value
					onChange(
						setWidth(
							layout,
							next === 'default' ? undefined : next === 'fixed' ? DEFAULT_FIXED_WIDTH : (next as 'fit' | 'full')
						)
					)
				}}
			>
				<option value="default">Default</option>
				<option value="fixed">Fixed</option>
				<option value="fit">Fit content</option>
				<option value="full">Node’s width</option>
			</select>
			{typeof width === 'number' && (
				<input
					className="lb-display__number"
					type="number"
					aria-label="Card width in pixels"
					min={CARD_WIDTH_RANGE.min}
					max={CARD_WIDTH_RANGE.max}
					step={10}
					defaultValue={width}
					key={width}
					onBlur={(e) => {
						const value = Math.round(Number(e.target.value))
						if (value >= CARD_WIDTH_RANGE.min && value <= CARD_WIDTH_RANGE.max) onChange(setWidth(layout, value))
					}}
				/>
			)}
		</div>
	)
}

function ElementEditor({
	element,
	registry,
	onChange,
	onRemove,
}: {
	element: LayoutElement
	registry: readonly PropertyDef[]
	onChange: (element: LayoutElement) => void
	onRemove: () => void
}) {
	const remove = (
		<button className="lb-display__button lb-display__button--danger" onClick={onRemove}>
			Remove
		</button>
	)
	if (element.kind === 'separator') return <div className="lb-display__editor">{remove}</div>

	if (element.kind === 'table') {
		return (
			<div className="lb-display__editor">
				<span className="lb-display__slot-name">Rows of the table</span>
				<div className="lb-display__checks">
					{registry.map((def) => (
						<label key={def.id} className="lb-display__check">
							<input
								type="checkbox"
								checked={element.properties.includes(def.id)}
								onChange={(e) =>
									onChange({
										...element,
										properties: e.target.checked
											? [...element.properties, def.id]
											: element.properties.filter((id) => id !== def.id),
									})
								}
							/>
							{def.name}
						</label>
					))}
				</div>
				<SizePicker value={element.size} onChange={(size) => onChange(withOptional(element, 'size', size))} />
				{remove}
			</div>
		)
	}

	if (element.kind === 'text') {
		return (
			<div className="lb-display__editor">
				<input
					className="lb-display__text"
					aria-label="Label text"
					defaultValue={element.text}
					onBlur={(e) => e.target.value !== element.text && onChange({ ...element, text: e.target.value })}
				/>
				<SizePicker value={element.size} onChange={(size) => onChange(withOptional(element, 'size', size))} />
				<BoldToggle element={element} onChange={onChange} />
				{remove}
			</div>
		)
	}

	const def = findProperty(registry, element.property)
	if (!def) return <div className="lb-display__editor">No such property. {remove}</div>
	const displays = displaysFor(def.type)
	const numeric = def.type === 'number' || def.type === 'financial' || def.type === 'progress'

	return (
		<div className="lb-display__editor">
			<label className="lb-display__field">
				<span>Show as</span>
				<select
					className="lb-display__select"
					aria-label={`Show ${def.name} as`}
					value={element.as ?? displays[0]}
					onChange={(e) =>
						onChange(
							withOptional(element, 'as', e.target.value === displays[0] ? undefined : (e.target.value as PropertyDisplay))
						)
					}
				>
					{displays.map((display) => (
						<option key={display} value={display}>
							{display}
						</option>
					))}
				</select>
			</label>
			<SizePicker value={element.size} onChange={(size) => onChange(withOptional(element, 'size', size))} />
			<BoldToggle element={element} onChange={onChange} />
			<label className="lb-display__check">
				<input
					type="checkbox"
					checked={element.showName === true}
					onChange={(e) => onChange(withOptional(element, 'showName', e.target.checked || undefined))}
				/>
				Show name
			</label>
			{numeric && (
				<label className="lb-display__field">
					<span>Decimals</span>
					<input
						className="lb-display__number"
						type="number"
						min={0}
						max={6}
						placeholder="auto"
						aria-label={`Decimals of ${def.name}`}
						value={element.format?.decimals ?? ''}
						onChange={(e) => {
							const raw = e.target.value
							const decimals = raw === '' ? undefined : Math.min(6, Math.max(0, Math.round(Number(raw))))
							onChange(withFormat(element, 'decimals', decimals))
						}}
					/>
				</label>
			)}
			{(def.type === 'number' || def.type === 'financial') && (
				<label className="lb-display__check">
					<input
						type="checkbox"
						checked={element.format?.symbol !== false}
						onChange={(e) => onChange(withFormat(element, 'symbol', e.target.checked ? undefined : false))}
					/>
					{def.type === 'financial' ? 'Currency symbol' : 'Unit'}
				</label>
			)}
			{def.type === 'date' && (
				<label className="lb-display__field">
					<span>Date</span>
					<select
						className="lb-display__select"
						aria-label={`Date style of ${def.name}`}
						value={element.format?.date ?? 'medium'}
						onChange={(e) =>
							onChange(withFormat(element, 'date', e.target.value === 'medium' ? undefined : (e.target.value as DateStyle)))
						}
					>
						{DATE_STYLES.map((style) => (
							<option key={style} value={style}>
								{style}
							</option>
						))}
					</select>
				</label>
			)}
			{remove}
		</div>
	)
}

function SizePicker({
	value,
	onChange,
}: {
	value: LayoutSize | undefined
	onChange: (size: LayoutSize | undefined) => void
}) {
	const current = value ?? 'm'
	return (
		<div className="lb-display__segments" role="group" aria-label="Size">
			{LAYOUT_SIZES.map((size) => (
				<button
					key={size}
					className={`lb-display__segment${size === current ? ' lb-display__segment--on' : ''}`}
					aria-pressed={size === current}
					onClick={() => onChange(size === 'm' ? undefined : size)}
				>
					{size.toUpperCase()}
				</button>
			))}
		</div>
	)
}

function BoldToggle<T extends { weight?: LayoutWeight }>({
	element,
	onChange,
}: {
	element: T
	onChange: (element: T) => void
}) {
	const bold = element.weight === 'bold'
	return (
		<button
			className={`lb-display__segment lb-display__bold${bold ? ' lb-display__segment--on' : ''}`}
			aria-pressed={bold}
			aria-label="Bold"
			onClick={() => onChange({ ...withOptional(element, 'weight', undefined), ...(bold ? {} : { weight: 'bold' }) })}
		>
			B
		</button>
	)
}

/** Sets a field, or removes it for `undefined`, so a layout stores only what differs from the defaults. */
function withOptional<T, K extends keyof T>(element: T, key: K, value: T[K] | undefined): T {
	const next = { ...element }
	if (value === undefined) delete next[key]
	else next[key] = value
	return next
}

function withFormat<K extends 'decimals' | 'symbol' | 'date'>(
	element: Extract<LayoutElement, { kind: 'property' }>,
	key: K,
	value: NonNullable<Extract<LayoutElement, { kind: 'property' }>['format']>[K] | undefined
): LayoutElement {
	const format = withOptional({ ...element.format }, key, value)
	return withOptional(element, 'format', Object.keys(format).length ? format : undefined)
}

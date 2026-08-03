import { useEffect, useState } from 'react'
import { useValue, type Editor, type TLShape } from 'tldraw'
import { NodeEditorPopover } from '../NodeEditorPopover'
import { shapeLabel } from './labels'
import { coercePropertyValue, formatPropertyValue } from './format'
import { createProperty, findProperty, readPropertyRegistry } from './schema'
import {
	PROPERTY_TYPES,
	defaultUnitForType,
	emptyValueForType,
	isListType,
	type PropertyDef,
	type PropertyType,
	type PropertyValue,
} from './types'
import { readShapeProperties, removeShapeProperty, updateShapeProperties } from './values'

const PANEL_WIDTH = 320

/**
 * The properties panel — for **any** shape, ours or tldraw's.
 *
 * This is where the property system becomes visible: the same panel opens on a note, a dragged-in
 * photo and a sticky note, because values live in `shape.meta` and nothing here knows or cares what
 * kind of shape it is looking at.
 *
 * Reached by right-click → Properties, or `alt+p` on a selection. Never by double-click, which keeps
 * meaning "edit the content" — that separation is what lets a note be both prose and a row of data.
 * (⌘-click, which the plan called for, is not available: tldraw's select tool already uses `accelKey`
 * on a shape click to select inside a group.)
 */
export function PropertiesPopover({
	shape,
	editor,
	onClose,
}: {
	shape: TLShape
	editor: Editor
	onClose: () => void
}) {
	// Escape closes it, the way every other panel in the app does. Captured at the window rather than
	// on the panel, because focus is usually on the canvas or in a value input — neither of which would
	// bubble a keydown to this element.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [onClose])

	// Read reactively: the panel stays open across edits, and an edit replaces the shape record.
	const live = useValue(
		'lifeboard:properties-panel',
		() => {
			const current = editor.getShape(shape.id)
			if (!current) return null
			// The panel belongs to the selected shape, so selecting something else closes it rather than
			// leaving a panel floating over a shape the user has moved on from.
			if (!editor.getSelectedShapeIds().includes(shape.id)) return null
			return {
				shape: current,
				values: readShapeProperties(current),
				registry: readPropertyRegistry(editor),
				label: shapeLabel(editor, current),
			}
		},
		[editor, shape.id]
	)

	// The shape was deleted while the panel was open.
	if (!live) return null

	const { values, registry, label } = live
	const attached = Object.keys(values)
	const available = registry.filter((def) => !(def.id in values))

	return (
		<NodeEditorPopover shape={shape} editor={editor} width={PANEL_WIDTH}>
			<div className="lb-props">
				<div className="lb-props__header">
					<span className="lb-props__title" title={label}>
						{label || 'Properties'}
					</span>
					<button className="lb-props__close" aria-label="Close properties" onClick={onClose}>
						×
					</button>
				</div>

				{attached.length === 0 && (
					<p className="lb-props__empty">
						No properties yet. Add one to make this shape part of a rollup.
					</p>
				)}

				<div className="lb-props__rows">
					{attached.map((id) => (
						<PropertyRow
							key={id}
							editor={editor}
							shape={live.shape}
							def={findProperty(registry, id)}
							id={id}
							value={values[id]!}
						/>
					))}
				</div>

				<AddProperty editor={editor} shape={live.shape} available={available} />
			</div>
		</NodeEditorPopover>
	)
}

/**
 * One property's row.
 *
 * `def` may be missing: deleting a property from the registry deliberately leaves values on shapes
 * (sweeping every shape would be a large unbatchable write, and undo would have to restore them all).
 * Such a value is shown read-only with a way to drop it, rather than hidden — silently invisible data
 * is worse than visibly orphaned data.
 */
function PropertyRow({
	editor,
	shape,
	def,
	id,
	value,
}: {
	editor: Editor
	shape: TLShape
	def: PropertyDef | undefined
	id: string
	value: PropertyValue
}) {
	const remove = () => removeShapeProperty(editor, shape, id)

	if (!def) {
		return (
			<div className="lb-props__row lb-props__row--orphan">
				<span className="lb-props__name" title={`No definition for "${id}"`}>
					{id}
				</span>
				<span className="lb-props__orphan-value">{String(value ?? '—')}</span>
				<button className="lb-props__remove" aria-label={`Remove ${id}`} onClick={remove}>
					×
				</button>
			</div>
		)
	}

	return (
		<div className="lb-props__row">
			<span className="lb-props__name" title={def.name}>
				{def.name}
			</span>
			<PropertyValueEditor editor={editor} shape={shape} def={def} value={value} />
			<button className="lb-props__remove" aria-label={`Remove ${def.name}`} onClick={remove}>
				×
			</button>
		</div>
	)
}

function PropertyValueEditor({
	editor,
	shape,
	def,
	value,
}: {
	editor: Editor
	shape: TLShape
	def: PropertyDef
	value: PropertyValue
}) {
	const set = (raw: unknown) =>
		updateShapeProperties(editor, shape, { [def.id]: coercePropertyValue(def.type, raw) })

	// `onKeyDown` stops propagation on every control: the canvas treats bare keys as tool shortcuts,
	// so without it typing "d" in a value box would switch to the draw tool.
	const stop = (e: { stopPropagation(): void }) => e.stopPropagation()

	if (def.type === 'checkbox') {
		return (
			<input
				className="lb-props__value"
				type="checkbox"
				aria-label={`Value of ${def.name}`}
				checked={value === true}
				onChange={(e) => set(e.currentTarget.checked)}
			/>
		)
	}

	if (isListType(def.type)) {
		return <ListValueEditor def={def} value={value} onChange={set} />
	}

	if (def.type === 'date') {
		return (
			<input
				className="lb-props__value"
				type="date"
				aria-label={`Value of ${def.name}`}
				value={typeof value === 'string' ? value : ''}
				onChange={(e) => set(e.currentTarget.value)}
				onKeyDown={stop}
			/>
		)
	}

	const numeric = def.type === 'number' || def.type === 'currency'
	return (
		<>
			<input
				className="lb-props__value"
				aria-label={`Value of ${def.name}`}
				value={value === null || value === undefined ? '' : String(value)}
				inputMode={numeric ? 'decimal' : 'text'}
				placeholder={def.type === 'currency' ? '2399' : ''}
				list={def.options?.length ? `lb-opts-${def.id}` : undefined}
				onChange={(e) => set(e.currentTarget.value)}
				onKeyDown={stop}
			/>
			{def.options?.length ? (
				// A datalist rather than a <select>: a select would make the recorded options a
				// constraint, and they are explicitly a convenience list you can type past.
				<datalist id={`lb-opts-${def.id}`}>
					{def.options.map((opt) => (
						<option key={opt} value={opt} />
					))}
				</datalist>
			) : null}
		</>
	)
}

/** Chips plus an input, for a multi-select. What tags used to be, now just a property type. */
function ListValueEditor({
	def,
	value,
	onChange,
}: {
	def: PropertyDef
	value: PropertyValue
	onChange: (raw: unknown) => void
}) {
	const [draft, setDraft] = useState('')
	const list = Array.isArray(value) ? value : []

	const add = () => {
		const next = draft.trim()
		if (!next) return
		if (!list.includes(next)) onChange([...list, next])
		setDraft('')
	}

	return (
		<div className="lb-props__list">
			{list.map((entry) => (
				<button
					key={entry}
					className="lb-props__chip"
					title={`Remove ${entry}`}
					onClick={() => onChange(list.filter((v) => v !== entry))}
				>
					{entry} ×
				</button>
			))}
			<input
				className="lb-props__chip-input"
				aria-label={`Value of ${def.name}`}
				value={draft}
				placeholder="add…"
				list={def.options?.length ? `lb-opts-${def.id}` : undefined}
				onChange={(e) => setDraft(e.currentTarget.value)}
				onBlur={add}
				onKeyDown={(e) => {
					if (e.key === 'Enter') add()
					e.stopPropagation()
				}}
			/>
			{def.options?.length ? (
				<datalist id={`lb-opts-${def.id}`}>
					{def.options.map((opt) => (
						<option key={opt} value={opt} />
					))}
				</datalist>
			) : null}
		</div>
	)
}

/**
 * Attach an existing property, or define a new one.
 *
 * Two paths on purpose, following Notion and AFFiNE: reusing a property the board already knows is the
 * common case and must be one click, while defining a new one is the rarer, wordier act. Collapsing
 * them into a single free-text box is what produces boards with `price`, `Price` and `cost`.
 */
function AddProperty({
	editor,
	shape,
	available,
}: {
	editor: Editor
	shape: TLShape
	available: readonly PropertyDef[]
}) {
	const [creating, setCreating] = useState(false)
	const [name, setName] = useState('')
	const [type, setType] = useState<PropertyType>('text')

	const attach = (def: PropertyDef) =>
		updateShapeProperties(editor, shape, { [def.id]: emptyValueForType(def.type) })

	const create = () => {
		const unit = defaultUnitForType(type)
		const def = createProperty(editor, { name, type, ...(unit ? { unit } : {}) })
		if (!def) return
		attach(def)
		setName('')
		setCreating(false)
	}

	return (
		<div className="lb-props__add">
			{available.length > 0 && (
				<div className="lb-props__available">
					{available.map((def) => (
						<button
							key={def.id}
							className="lb-props__attach"
							title={`Add ${def.name} (${def.type})`}
							onClick={() => attach(def)}
						>
							+ {def.name}
						</button>
					))}
				</div>
			)}

			{creating ? (
				<div className="lb-props__new">
					<input
						className="lb-props__new-name"
						aria-label="New property name"
						value={name}
						placeholder="Property name"
						autoFocus
						onChange={(e) => setName(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') create()
							if (e.key === 'Escape') setCreating(false)
							e.stopPropagation()
						}}
					/>
					<select
						className="lb-props__new-type"
						aria-label="New property type"
						value={type}
						onChange={(e) => setType(e.currentTarget.value as PropertyType)}
					>
						{PROPERTY_TYPES.map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
					<button className="lb-props__create" onClick={create}>
						Add
					</button>
				</div>
			) : (
				<button className="lb-props__new-btn" onClick={() => setCreating(true)}>
					New property…
				</button>
			)}
		</div>
	)
}

/** Re-exported so the panel's read-only rendering and the node cards agree on formatting. */
export { formatPropertyValue }

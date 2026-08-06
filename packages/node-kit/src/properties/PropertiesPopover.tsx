import { Eye, EyeOff, GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor, type TLShape } from 'tldraw'
import { NodeEditorPopover } from '../NodeEditorPopover'
import { shapeLabel } from './labels'
import { coercePropertyValue, currencySymbol, formatPropertyValue } from './format'
import { encodeLinkValue, linkHref, parseLinkValue, type LinkParts } from './link'
import { createProperty, findProperty, readPropertyRegistry, updateProperty } from './schema'
import {
	PROPERTY_TYPES,
	defaultUnitForType,
	emptyValueForType,
	isListType,
	type PropertyDef,
	type PropertyType,
	type PropertyValue,
} from './types'
import {
	orderedPropertyIds,
	readHiddenPropertyIds,
	readShapeProperties,
	readShapePropertyUnits,
	removeShapeProperty,
	setShapePropertyHidden,
	setShapePropertyOrder,
	setShapePropertyUnit,
	unitForShapeProperty,
	updateShapeProperties,
} from './values'

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
			// The panel is per-shape, so it belongs to a *single* selection: it hides when the shape
			// is deselected (and reopens with the next individual re-select, since the target
			// persists), and it must never surface inside a multi-selection — properties edited
			// "through" one shape of many reads as editing the whole selection, which this isn't.
			if (editor.getOnlySelectedShape()?.id !== shape.id) return null
			return {
				shape: current,
				values: readShapeProperties(current),
				order: orderedPropertyIds(current),
				hidden: readHiddenPropertyIds(current),
				registry: readPropertyRegistry(editor),
				label: shapeLabel(editor, current),
			}
		},
		[editor, shape.id]
	)

	/**
	 * Reordering is local state while the drag is in flight and one store write on drop. Writing on
	 * every row crossed would spray undo entries and re-render the panel mid-drag; this way one drag
	 * is one undo entry, like every other edit.
	 */
	const [draftOrder, setDraftOrder] = useState<string[] | null>(null)
	const draggingId = useRef<string | null>(null)

	// The shape was deleted while the panel was open.
	if (!live) return null

	const { values, registry, label, hidden } = live
	const attached = draftOrder ?? live.order
	const available = registry.filter((def) => !(def.id in values))

	const startDrag = (id: string) => {
		draggingId.current = id
		setDraftOrder(live.order)
	}
	const dragOver = (overId: string) => {
		const dragging = draggingId.current
		if (!dragging || dragging === overId) return
		setDraftOrder((current) => {
			const order = current ?? live.order
			const from = order.indexOf(dragging)
			const to = order.indexOf(overId)
			if (from === -1 || to === -1 || from === to) return order
			// Take the dragged row out and drop it at the hovered row's index: moving down lands it
			// after the hovered row, moving up lands it before — the usual list-drag feel.
			const next = [...order]
			next.splice(from, 1)
			next.splice(to, 0, dragging)
			return next
		})
	}
	const endDrag = () => {
		if (draftOrder && draggingId.current) setShapePropertyOrder(editor, live.shape, draftOrder)
		draggingId.current = null
		setDraftOrder(null)
	}

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
							hidden={hidden.has(id)}
							dragging={draftOrder !== null && draggingId.current === id}
							onDragStart={() => startDrag(id)}
							onDragOver={() => dragOver(id)}
							onDragEnd={endDrag}
						/>
					))}
				</div>

				<AddProperty editor={editor} shape={live.shape} available={available} />
			</div>
		</NodeEditorPopover>
	)
}

/**
 * One property's row: drag handle, name (click to rename), value, visibility toggle, remove.
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
	hidden,
	dragging,
	onDragStart,
	onDragOver,
	onDragEnd,
}: {
	editor: Editor
	shape: TLShape
	def: PropertyDef | undefined
	id: string
	value: PropertyValue
	hidden: boolean
	dragging: boolean
	onDragStart: () => void
	onDragOver: () => void
	onDragEnd: () => void
}) {
	const remove = () => removeShapeProperty(editor, shape, id)

	const classes = [
		'lb-props__row',
		def ? '' : 'lb-props__row--orphan',
		hidden ? 'lb-props__row--hidden' : '',
		dragging ? 'lb-props__row--dragging' : '',
	]
		.filter(Boolean)
		.join(' ')

	return (
		<div
			className={classes}
			// Draggable via the grip only (see its handlers); the row hosts the drop targets so the
			// hit area for reordering is the whole row, not the 14px handle.
			onDragOver={(e) => {
				e.preventDefault()
				onDragOver()
			}}
			onDrop={(e) => e.preventDefault()}
		>
			<span
				className="lb-props__grip"
				title="Drag to reorder"
				aria-label={`Reorder ${def?.name ?? id}`}
				role="button"
				draggable
				onDragStart={(e) => {
					e.dataTransfer.effectAllowed = 'move'
					// Some browsers require data for a drag to start at all.
					e.dataTransfer.setData('text/plain', id)
					onDragStart()
				}}
				onDragEnd={onDragEnd}
			>
				<GripVertical size={13} aria-hidden="true" />
			</span>

			{def ? (
				<PropertyName editor={editor} def={def} />
			) : (
				<span className="lb-props__name" title={`No definition for "${id}"`}>
					{id}
				</span>
			)}

			{def ? (
				<PropertyValueEditor editor={editor} shape={shape} def={def} value={value} />
			) : (
				<span className="lb-props__orphan-value">{String(value ?? '—')}</span>
			)}

			{def ? (
				<button
					className="lb-props__eye"
					aria-label={hidden ? `Show ${def.name} on the card` : `Hide ${def.name} from the card`}
					aria-pressed={hidden}
					title={hidden ? 'Hidden on the card — click to show' : 'Shown on the card — click to hide'}
					onClick={() => setShapePropertyHidden(editor, shape, id, !hidden)}
				>
					{hidden ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
				</button>
			) : (
				// Keeps the grid aligned; an orphan renders nowhere, so visibility is meaningless.
				<span className="lb-props__eye" aria-hidden="true" />
			)}

			<button className="lb-props__remove" aria-label={`Remove ${def?.name ?? id}`} onClick={remove}>
				×
			</button>
		</div>
	)
}

/**
 * The property's name — click to rename.
 *
 * Renaming edits the board-level definition (the display name every shape and table shows), not
 * this shape: values are keyed by the property's stable id, so the rename touches no shape data.
 */
function PropertyName({ editor, def }: { editor: Editor; def: PropertyDef }) {
	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState(def.name)

	const commit = () => {
		const name = draft.trim()
		if (name && name !== def.name) updateProperty(editor, def.id, { name })
		setEditing(false)
	}

	if (!editing) {
		return (
			<button
				className="lb-props__name lb-props__name--btn"
				title={`${def.name} — click to rename`}
				onClick={() => {
					setDraft(def.name)
					setEditing(true)
				}}
			>
				{def.name}
			</button>
		)
	}

	return (
		<input
			className="lb-props__name-input"
			aria-label={`Rename ${def.name}`}
			value={draft}
			// eslint-disable-next-line jsx-a11y/no-autofocus
			autoFocus
			onChange={(e) => setDraft(e.currentTarget.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') commit()
				if (e.key === 'Escape') setEditing(false)
				// Otherwise the canvas reads keystrokes as tool shortcuts.
				e.stopPropagation()
			}}
		/>
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

	if (def.type === 'number' || def.type === 'financial') {
		return <NumericValueEditor editor={editor} shape={shape} def={def} value={value} />
	}

	if (def.type === 'link') {
		return <LinkValueEditor def={def} value={value} onChange={set} />
	}

	return (
		<>
			<input
				className="lb-props__value"
				aria-label={`Value of ${def.name}`}
				value={value === null || value === undefined ? '' : String(value)}
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

/**
 * The editor for a `link` value: what it is called, and where it goes.
 *
 * Two inputs over one encoded string — the encoding (`[title](url)`) is storage, and making anyone
 * type it would be a worse version of the two boxes. Both are uncontrolled, so a keystroke re-renders
 * nothing; the pair is re-encoded and committed on every change, which keeps the card's own link live
 * as you type.
 *
 * The title is an input, so clicking it edits rather than navigates — the launch button beside it is
 * how you follow a link from in here. On the card itself the title *is* a plain link (see
 * PropertyStrip), which is where clicking to open belongs.
 */
function LinkValueEditor({
	def,
	value,
	onChange,
}: {
	def: PropertyDef
	value: PropertyValue
	onChange: (next: string | null) => void
}) {
	const parts = parseLinkValue(value)
	const href = linkHref(value)
	const commit = (next: LinkParts) => onChange(encodeLinkValue(next))

	return (
		<div className="lb-props__link">
			<input
				className="lb-props__value"
				aria-label={`Title of ${def.name}`}
				placeholder="Title"
				value={parts.title}
				onChange={(e) => commit({ ...parts, title: e.currentTarget.value })}
				onKeyDown={(e) => e.stopPropagation()}
			/>
			<div className="lb-props__link-row">
				<input
					className="lb-props__value"
					aria-label={`URL of ${def.name}`}
					placeholder="lifeboard.app"
					inputMode="url"
					value={parts.url}
					onChange={(e) => commit({ ...parts, url: e.currentTarget.value })}
					onKeyDown={(e) => e.stopPropagation()}
				/>
				{href ? (
					<a
						className="lb-props__link-open"
						href={href}
						target="_blank"
						rel="noreferrer noopener"
						title={`Open ${href}`}
						aria-label={`Open ${def.name}`}
					>
						↗
					</a>
				) : null}
			</div>
		</div>
	)
}

/**
 * The editor for `number` and `financial` values.
 *
 * The input keeps a local draft while focused, because a controlled input that coerces every
 * keystroke cannot be typed into: "1." coerces to 1 and re-renders as "1", so the decimal point can
 * never land, and a leading "-" coerces to empty. The draft is what you see while typing; every
 * *parseable* state commits to the store live (so the card updates as you type), and blur snaps the
 * text back to the committed value.
 *
 * A `financial` value additionally shows its symbol and an editable currency code — the code edits
 * the *definition's* unit, so every shape carrying the property switches currency together.
 */
function NumericValueEditor({
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
	const [draft, setDraft] = useState<string | null>(null)

	const display = value === null || value === undefined ? '' : String(value)
	const negative = typeof value === 'number' && value < 0

	const onChange = (raw: string) => {
		setDraft(raw)
		// Only parseable states (or a deliberate clear) reach the store; "-" and "1." wait in the
		// draft until they become numbers.
		const coerced = coercePropertyValue(def.type, raw)
		if (raw.trim() === '' || coerced !== null) {
			updateShapeProperties(editor, shape, { [def.id]: coerced })
		}
	}

	const input = (
		<input
			className={negative ? 'lb-props__value lb-props__value--neg' : 'lb-props__value'}
			aria-label={`Value of ${def.name}`}
			value={draft ?? display}
			inputMode="decimal"
			placeholder={def.type === 'financial' ? '1000.00' : ''}
			onFocus={() => setDraft(display)}
			onChange={(e) => onChange(e.currentTarget.value)}
			onBlur={() => setDraft(null)}
			onKeyDown={(e) => e.stopPropagation()}
		/>
	)

	if (def.type !== 'financial') return input

	const unit = unitForShapeProperty(def, readShapePropertyUnits(shape))

	return (
		<div className="lb-props__money">
			<span className="lb-props__money-symbol" aria-hidden="true">
				{currencySymbol(unit)}
			</span>
			{input}
			<CurrencyCodeInput editor={editor} shape={shape} def={def} unit={unit} />
		</div>
	)
}

/**
 * The currency code beside a financial value — `GEL`, `USD`, anything ISO-4217-ish.
 *
 * Edits *this shape's* currency, not the board's. It used to write the definition's unit, which meant
 * pricing one card in USD silently reprised every other card carrying the same property — money is a
 * property of the amount, not of the column it sits in. The definition's unit survives as the default
 * a new value inherits, so a board whose prices really are all in one currency still only says so once.
 */
function CurrencyCodeInput({
	editor,
	shape,
	def,
	unit,
}: {
	editor: Editor
	shape: TLShape
	def: PropertyDef
	unit: string | undefined
}) {
	const [draft, setDraft] = useState<string | null>(null)

	const commit = () => {
		if (draft === null) return
		const code = draft.trim().toUpperCase()
		if (code !== (unit ?? '')) setShapePropertyUnit(editor, shape, def.id, code)
		setDraft(null)
	}

	return (
		<input
			className="lb-props__money-code"
			aria-label={`Currency of ${def.name}`}
			value={draft ?? unit ?? ''}
			placeholder="GEL"
			maxLength={4}
			onFocus={() => setDraft(unit ?? '')}
			onChange={(e) => setDraft(e.currentTarget.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === 'Enter') commit()
				if (e.key === 'Escape') setDraft(null)
				e.stopPropagation()
			}}
		/>
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

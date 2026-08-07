import { Eye, EyeOff, GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useValue, type Editor, type TLShape } from 'tldraw'
import { NodeEditorPopover } from '../NodeEditorPopover'
import { shapeLabel } from './labels'
import { coercePropertyValue, currencySymbol, formatPropertyValue } from './format'
import { encodeLinkValue, linkHref, parseLinkValue, type LinkParts } from './link'
import { optionStyle } from './options'
import {
	createProperty,
	deleteProperty,
	findProperty,
	readPropertyRegistry,
	updateProperty,
} from './schema'
import {
	PROPERTY_TYPES,
	defaultUnitForType,
	emptyValueForType,
	isChoiceType,
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
			/*
			 * Which property ids anything on this page actually carries.
			 *
			 * Suggestions come from this rather than from the whole registry — a definition whose every
			 * shape has been deleted isn't a useful thing to offer, and offering it is how the chip row
			 * fills with the names of things that no longer exist.
			 *
			 * Walked here rather than taken from the facts pipeline, which lives in `nodes/rollup/engine`
			 * — and that already imports this folder, so the two would form a cycle. `useValue` memoises
			 * it, and it only runs while the panel is open on a single shape.
			 */
			const inUse = new Set<string>()
			for (const other of editor.getCurrentPageShapes()) {
				for (const id of Object.keys(readShapeProperties(other))) inUse.add(id)
			}

			return {
				shape: current,
				values: readShapeProperties(current),
				order: orderedPropertyIds(current),
				hidden: readHiddenPropertyIds(current),
				registry: readPropertyRegistry(editor),
				label: shapeLabel(editor, current),
				inUse,
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

	const { values, registry, label, hidden, inUse } = live
	const attached = draftOrder ?? live.order
	// Offered: on the board somewhere, but not yet on *this* shape. Creating a property attaches it
	// straight away, so one you just made is in use by definition and keeps appearing on other shapes —
	// which is the suggestion behaviour worth keeping.
	const available = registry.filter((def) => !(def.id in values) && inUse.has(def.id))
	// Defined but carried by nothing. Only reachable by deleting every shape that had it.
	const unused = registry.filter((def) => !inUse.has(def.id))

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

				<AddProperty editor={editor} shape={live.shape} available={available} unused={unused} />
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

	if (isChoiceType(def.type)) {
		return <ChoiceValueEditor editor={editor} def={def} value={value} onChange={set} />
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
		<input
			className="lb-props__value"
			aria-label={`Value of ${def.name}`}
			value={value === null || value === undefined ? '' : String(value)}
			onChange={(e) => set(e.currentTarget.value)}
			onKeyDown={stop}
		/>
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

/**
 * The editor for `select` and `multiSelect`: a menu of the property's known options.
 *
 * One component for both, because they differ only in whether picking replaces or toggles. Before
 * this they were a text box with a `datalist` attached, which was two problems in one — nothing in the
 * app ever wrote `options`, so the list was always empty, and a bare text box makes a "choice" out of
 * whatever you happen to type, which is how you end up with `Doing`, `doing` and `DOING`.
 *
 * The menu expands **inline** rather than floating over the panel. `.lb-popover` scrolls and is
 * height-capped, so an absolutely-positioned menu would be clipped by its own container; pushing the
 * rows below it down costs a little movement and nothing else.
 *
 * Options stay a convenience list rather than a constraint, which is the invariant the rest of the
 * property system already assumes (see `collectPropertyIds`). A value that isn't in `options` — every
 * value typed before this existed, for one — still shows, and still appears in the menu so it can be
 * unpicked.
 */
function ChoiceValueEditor({
	editor,
	def,
	value,
	onChange,
}: {
	editor: Editor
	def: PropertyDef
	value: PropertyValue
	onChange: (raw: unknown) => void
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')

	const multi = isListType(def.type)
	const options = def.options ?? []
	const selected = multi
		? Array.isArray(value)
			? value
			: []
		: typeof value === 'string' && value !== ''
			? [value]
			: []

	// Recorded options first, then anything selected that was never recorded, so a legacy free-text
	// value is visible in the menu instead of being silently unreachable.
	const entries = [...options, ...selected.filter((v) => !options.includes(v))]
	const needle = query.trim().toLowerCase()
	const shown = needle ? entries.filter((e) => e.toLowerCase().includes(needle)) : entries
	// Only offered when it would actually add something — an exact match means "pick it", not "make
	// a second one".
	const creatable = query.trim() && !entries.some((e) => e.toLowerCase() === needle) ? query.trim() : null

	const pick = (option: string) => {
		if (!multi) {
			onChange(option)
			setOpen(false)
			setQuery('')
			return
		}
		onChange(selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option])
	}

	const create = () => {
		if (!creatable) return
		updateProperty(editor, def.id, { options: [...options, creatable] })
		pick(creatable)
		setQuery('')
	}

	/*
	 * Removing an option takes it off the list without touching any shape, matching what deleting a
	 * property definition does. Sweeping every shape would be a large unbatchable write that undo
	 * would have to reverse one by one, and a value left behind still renders — so nothing is lost,
	 * it just stops being offered.
	 */
	const forget = (option: string) =>
		updateProperty(editor, def.id, { options: options.filter((o) => o !== option) })

	return (
		<div className="lb-choice">
			<div className="lb-choice__current">
				{/*
				 * One chosen value is the button itself, so clicking what you see opens the menu — the
				 * two extra controls a separate trigger would need are worth avoiding on a 1fr column.
				 * Several values need their own remove buttons, so those chips can't be inside one.
				 */}
				{multi &&
					selected.map((option) => (
						<span className="lb-chip" key={option} style={optionStyle(option)}>
							{option}
							<button
								className="lb-chip__x"
								aria-label={`Remove ${option} from ${def.name}`}
								onClick={() => pick(option)}
							>
								×
							</button>
						</span>
					))}
				<button
					className="lb-choice__open"
					aria-label={multi ? `Add to ${def.name}` : `Value of ${def.name}`}
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
				>
					{multi ? (
						'+'
					) : selected[0] !== undefined ? (
						<span className="lb-chip" style={optionStyle(selected[0])}>
							{selected[0]}
						</span>
					) : (
						'Empty'
					)}
				</button>
			</div>

			{open && (
				<div className="lb-choice__menu">
					<input
						className="lb-choice__search"
						aria-label={`Search or create an option for ${def.name}`}
						placeholder="Search or create…"
						value={query}
						// eslint-disable-next-line jsx-a11y/no-autofocus
						autoFocus
						onChange={(e) => setQuery(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') creatable ? create() : shown[0] && pick(shown[0])
							if (e.key === 'Escape') setOpen(false)
							// Otherwise the canvas reads keystrokes as tool shortcuts.
							e.stopPropagation()
						}}
					/>
					{shown.map((option) => (
						<div className="lb-choice__row" key={option}>
							<button
								className={
									selected.includes(option) ? 'lb-choice__opt lb-choice__opt--on' : 'lb-choice__opt'
								}
								aria-pressed={selected.includes(option)}
								onClick={() => pick(option)}
							>
								<span className="lb-chip" style={optionStyle(option)}>
									{option}
								</span>
							</button>
							{options.includes(option) && (
								<button
									className="lb-choice__forget"
									aria-label={`Remove ${option} from ${def.name}'s options`}
									title="Remove from the list of options"
									onClick={() => forget(option)}
								>
									×
								</button>
							)}
						</div>
					))}
					{creatable && (
						<button className="lb-choice__create" onClick={create}>
							Create “{creatable}”
						</button>
					)}
					{!shown.length && !creatable && (
						<p className="lb-choice__empty">No options yet. Type to create one.</p>
					)}
					{!multi && selected.length > 0 && (
						<button
							className="lb-choice__clear"
							onClick={() => {
								onChange(null)
								setOpen(false)
							}}
						>
							Clear
						</button>
					)}
				</div>
			)}
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
	unused,
}: {
	editor: Editor
	shape: TLShape
	available: readonly PropertyDef[]
	unused: readonly PropertyDef[]
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

	/*
	 * Explicit rather than automatic, and that is the whole design of it.
	 *
	 * Pruning the moment a property loses its last shape would fire on an ordinary delete, and undoing
	 * that delete would bring the shape back to a board that no longer defines what its values mean —
	 * the values would survive as orphans. Offering the cleanup instead means the registry only shrinks
	 * when someone says so.
	 */
	const removeUnused = () => {
		editor.run(() => {
			editor.markHistoryStoppingPoint('remove unused properties')
			for (const def of unused) deleteProperty(editor, def.id)
		})
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
			{unused.length > 0 && (
				<button className="lb-props__prune" onClick={removeUnused}>
					{`Remove ${unused.length} unused ${unused.length === 1 ? 'property' : 'properties'}`}
				</button>
			)}
		</div>
	)
}

/** Re-exported so the panel's read-only rendering and the node cards agree on formatting. */
export { formatPropertyValue }

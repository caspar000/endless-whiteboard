import { useState, useSyncExternalStore } from 'react'
import { DieIcon } from './DieIcon'
import { DIE_KINDS, type DieKind } from './kinds'
import {
	DEFAULT_DICE_COLOUR,
	DICE_SWATCHES,
	bodyColourFor,
	edgeColourFor,
	getDicePrefs,
	inkOn,
	setDicePrefs,
	setKindColour,
	subscribeToDicePrefs,
} from './prefs'

/**
 * How the dice look — the extension's own panel on its Settings page.
 *
 * Rendered through `Extension.settings`, which is why this lives in the package rather than in the app:
 * the colour of the dice is the dice extension's business, and the host only owns the page it sits on.
 *
 * The notable thing is what is *not* here. The numerals have no colour picker: they follow the body by
 * luminance (`inkOn`), because a dark die with dark numbers is unreadable in a way choosing could only
 * get wrong. The preview shows the consequence rather than stating the rule.
 */
export function DiceSettings() {
	const prefs = useSyncExternalStore(subscribe, getDicePrefs)
	const edgesOn = prefs.edges !== 'off'
	const edgeFollows = prefs.edges === 'follow'

	return (
		<div className="lb-appearance__card">
			<Row
				title="Colour"
				hint="The numerals pick themselves: light on a dark die, dark on a light one."
			>
				{prefs.colourful ? (
					<span className="lb-dice-setting__note">Set per die below</span>
				) : (
					<ColourPicker
						value={prefs.colour}
						onChange={(colour) => setDicePrefs({ colour })}
						onReset={prefs.colour === DEFAULT_DICE_COLOUR ? null : () => setDicePrefs({ colour: DEFAULT_DICE_COLOUR })}
						label="Dice colour"
					/>
				)}
			</Row>

			<Row
				title="Colourful dice"
				hint="A colour per die instead of one for the set, the way a bought set arrives."
			>
				<input
					type="checkbox"
					className="lb-toggle__input"
					checked={prefs.colourful}
					onChange={(e) => setDicePrefs({ colourful: e.target.checked })}
					aria-label="Colourful dice"
				/>
			</Row>

			{/* One picker per die, and only while there is a per-die colour to set. */}
			{prefs.colourful &&
				DIE_KINDS.map((kind) => (
					<Row key={kind} title={kind} icon={kind} indented>
						<ColourPicker
							value={bodyColourFor(kind)}
							onChange={(colour) => setKindColour(kind, colour)}
							onReset={
								prefs.kindColours[kind] === undefined ? null : () => setKindColour(kind, null)
							}
							label={`${kind} colour`}
						/>
					</Row>
				))}

			<Row
				title="Edges"
				hint="The line round each face. Following the numerals is what a real die looks like."
			>
				<span className="lb-dice-setting__control">
					{edgesOn && (
						<ColourPicker
							value={edgeFollows ? inkOn(bodyColourFor('d20')) : prefs.edges}
							onChange={(edges) => setDicePrefs({ edges })}
							onReset={edgeFollows ? null : () => setDicePrefs({ edges: 'follow' })}
							resetLabel="Follow numerals"
							label="Edge colour"
						/>
					)}
					<input
						type="checkbox"
						className="lb-toggle__input"
						checked={edgesOn}
						onChange={(e) => setDicePrefs({ edges: e.target.checked ? 'follow' : 'off' })}
						aria-label="Show edges"
					/>
				</span>
			</Row>

			<Row
				title="Keep results"
				hint="Each roll lands as a card on the board, with its total as a property a table can total."
			>
				<input
					type="checkbox"
					className="lb-toggle__input"
					checked={prefs.keepResults}
					onChange={(e) => setDicePrefs({ keepResults: e.target.checked })}
					aria-label="Keep results"
				/>
			</Row>

			<DicePreview />
		</div>
	)
}

function Row({
	title,
	hint,
	icon,
	indented,
	children,
}: {
	title: string
	hint?: string
	icon?: DieKind
	indented?: boolean
	children: React.ReactNode
}) {
	return (
		<div className="lb-dice-setting" data-indented={indented || undefined}>
			<span className="lb-dice-setting__label">
				<span className="lb-dice-setting__title">
					{icon && <DieIcon kind={icon} size={18} />}
					{title}
				</span>
				{hint && <span className="lb-dice-setting__hint">{hint}</span>}
			</span>
			{children}
		</div>
	)
}

/**
 * A colour: one circle that opens a menu of swatches, with the full editor behind **Advanced**.
 *
 * The same gesture as the selection toolbar's colour control and the dock's pen expansion — click the
 * swatch, pick from the row that appears — because a swatch should mean the same thing wherever it turns
 * up. It reuses those surfaces' own classes (`lb-swatch`, `lb-seltb__palette`) rather than restating
 * them: this started out as a permanently-open grid of squares, which was a look nobody had asked for
 * and a flow nobody would recognise.
 *
 * Collapsed by default, which is also what makes seven per-die pickers fit on one page.
 */
function ColourPicker({
	value,
	onChange,
	onReset,
	resetLabel = 'Reset',
	label,
}: {
	value: string
	onChange: (colour: string) => void
	/** `null` when there is nothing to go back to, which is when the control is hidden. */
	onReset: (() => void) | null
	resetLabel?: string
	label: string
}) {
	const [open, setOpen] = useState(false)
	const [advanced, setAdvanced] = useState(false)
	const normalised = value.toLowerCase()

	const choose = (colour: string) => {
		onChange(colour)
		setOpen(false)
		setAdvanced(false)
	}

	return (
		<span className="lb-dice-picker">
			<button
				type="button"
				className="lb-swatch"
				style={{ background: normalised }}
				title={`${label}: ${normalised}`}
				aria-label={label}
				aria-expanded={open}
				onPointerDown={(e) => e.preventDefault()}
				onClick={() => setOpen((v) => !v)}
			/>

			{open && (
				<span className="lb-seltb__palette lb-dice-picker__menu">
					<span className="lb-dice-picker__swatches" role="group" aria-label={label}>
						{DICE_SWATCHES.map((swatch) => (
							<button
								type="button"
								key={swatch}
								className={
									swatch.toLowerCase() === normalised
										? 'lb-swatch lb-swatch--active'
										: 'lb-swatch'
								}
								style={{ background: swatch }}
								aria-label={swatch}
								aria-pressed={swatch.toLowerCase() === normalised}
								title={swatch}
								onPointerDown={(e) => e.preventDefault()}
								onClick={() => choose(swatch)}
							/>
						))}
					</span>

					<span className="lb-dice-picker__actions">
						<button
							type="button"
							className="lb-dice-setting__reset"
							aria-expanded={advanced}
							onClick={() => setAdvanced((v) => !v)}
						>
							Advanced
						</button>
						{onReset && (
							<button
								type="button"
								className="lb-dice-setting__reset"
								onClick={() => {
									onReset()
									setOpen(false)
								}}
							>
								{resetLabel}
							</button>
						)}
					</span>

					{advanced && (
						<span className="lb-dice-picker__advanced">
							<input
								type="color"
								className="lb-dice-swatch--input"
								value={normalised}
								onChange={(e) => onChange(e.target.value)}
								aria-label={`${label}, colour picker`}
							/>
							<input
								type="text"
								className="lb-dice-picker__hex"
								defaultValue={normalised}
								spellCheck={false}
								// Applied only once it is a complete colour: repainting every die on the way from
								// `#` to `#4465e9` would flash through six wrong ones. `defaultValue` so typing is
								// not fought by the store echoing a half-finished value back.
								onChange={(e) => {
									const next = e.target.value.trim()
									if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase())
								}}
								aria-label={`${label}, hex`}
							/>
						</span>
					)}
				</span>
			)}
		</span>
	)
}

/**
 * The set, as it will look.
 *
 * Flat silhouettes rather than the real 3D dice: this is a Settings page, and spinning up a WebGL scene
 * and a physics world to show someone a colour would load the whole roll chunk to answer a question the
 * tray icons already answer. It uses the same `DieIcon` the tray does, so it cannot drift from the app.
 */
function DicePreview() {
	useSyncExternalStore(subscribe, getDicePrefs)
	return (
		<div className="lb-dice-preview" aria-label="Preview of the dice">
			{DIE_KINDS.map((kind) => {
				const body = bodyColourFor(kind)
				const edge = edgeColourFor(kind)
				return (
					<span
						className="lb-dice-preview__die"
						key={kind}
						title={`${kind} — ${body}`}
						style={{ background: body, color: inkOn(body), borderColor: edge ?? 'transparent' }}
					>
						<DieIcon kind={kind} size={26} />
					</span>
				)
			})}
		</div>
	)
}

/**
 * The store's subscribe function, as a module-level constant.
 *
 * `useSyncExternalStore` re-subscribes whenever this identity changes, so passing an inline arrow would
 * tear down and rebuild the listener on every render — which, during a colour drag, is every frame.
 */
const subscribe = subscribeToDicePrefs

import { Grid2x2, Magnet, Monitor, Moon, RefreshCw, Squircle, Sun, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { isAutoFetchEnabled, setAutoFetchEnabled } from '../persistence/rateStore'
import { ROUNDNESS_STEPS, type CanvasPrefs, type GridStyle, type Roundness } from './canvasPrefs'
import type { Theme } from './useTheme'

/**
 * Appearance settings: the app's theme, and how the canvas paper looks and behaves.
 *
 * Its own panel rather than a section of SettingsPanel, which is deliberately about storage and backup
 * only. None of the state lives here — the theme is held by `useTheme` and the canvas preferences by
 * `useCanvasPrefsState`, both in App.tsx, because they have to stay live on every route rather than only
 * while this screen is mounted.
 */
const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
	{ value: 'light', label: 'Light', icon: Sun },
	{ value: 'dark', label: 'Dark', icon: Moon },
	{ value: 'system', label: 'System', icon: Monitor },
]

/** `off` is the toggle's job, so the size row only offers the sizes. */
const SIZES: { value: Roundness; label: string }[] = ROUNDNESS_STEPS.filter(
	(step) => step !== 'off'
).map((step) => ({ value: step, label: step.toUpperCase() }))

const GRID_STYLES: { value: GridStyle; label: string }[] = [
	{ value: 'lifeboard', label: 'Lifeboard' },
	{ value: 'native', label: 'tldraw' },
]

function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string
	value: T
	options: { value: T; label: string; icon?: LucideIcon }[]
	onChange: (value: T) => void
}) {
	const id = `lb-seg-${label.toLowerCase().replace(/\s+/g, '-')}`
	return (
		<div className="lb-appearance__row">
			<div className="lb-appearance__label" id={id}>
				{label}
			</div>
			<div className="lb-appearance__seg" role="group" aria-labelledby={id}>
				{options.map(({ value: option, label: optionLabel, icon: Icon }) => (
					<button
						key={option}
						className={
							value === option ? 'lb-appearance__opt lb-appearance__opt--active' : 'lb-appearance__opt'
						}
						onClick={() => onChange(option)}
						aria-pressed={value === option}
					>
						{Icon && <Icon size={15} />}
						{optionLabel}
					</button>
				))}
			</div>
		</div>
	)
}

/** A labelled on/off switch, for the settings that are genuinely binary. */
function Toggle({
	label,
	hint,
	icon: Icon,
	checked,
	onChange,
}: {
	label: string
	hint: string
	icon: LucideIcon
	checked: boolean
	onChange: (checked: boolean) => void
}) {
	// `aria-label` rather than letting the <label> supply the name: without it the accessible name is the
	// label *and* the hint run together, which reads badly and makes the control awkward to target.
	const hintId = `lb-toggle-hint-${label.toLowerCase().replace(/\s+/g, '-')}`
	return (
		<label className="lb-toggle">
			<Icon className="lb-toggle__icon" size={16} />
			<span className="lb-toggle__text">
				<span className="lb-toggle__label">{label}</span>
				<span className="lb-toggle__hint" id={hintId}>
					{hint}
				</span>
			</span>
			<input
				type="checkbox"
				className="lb-toggle__input"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				aria-label={label}
				aria-describedby={hintId}
			/>
		</label>
	)
}

export function AppearancePanel({
	theme,
	onThemeChange,
	canvas,
}: {
	theme: Theme
	onThemeChange: (theme: Theme) => void
	canvas: CanvasPrefs
}) {
	/*
	 * Three sections rather than one stack of cards.
	 *
	 * The headings used to be hidden, on the reasoning that the sidebar already said "Settings". That
	 * held while this was one panel; it stopped holding the moment there were several, because a card
	 * with no heading above it belongs to whatever happens to be above it — which is how a currency
	 * switch ended up reading as part of the theme.
	 */
	return (
		<>
			<section className="lb-settings">
				<h2>Appearance</h2>

				<div className="lb-appearance__card">
					<Segmented label="Theme" value={theme} options={THEMES} onChange={onThemeChange} />
					<p className="lb-appearance__hint">
						{theme === 'system'
							? 'Following your system appearance.'
							: `Always ${theme}, whatever your system is set to.`}
					</p>
				</div>

				<div className="lb-appearance__card">
					<Toggle
						label="Rounded corners"
						hint="Softens the corners of frames and images."
						icon={Squircle}
						checked={canvas.roundness !== 'off'}
						// Turning it back on returns to the default step rather than whatever it was before:
						// remembering a size nobody can see is a worse surprise than a predictable one.
						onChange={(on) => canvas.setRoundness(on ? 'sm' : 'off')}
					/>
					{canvas.roundness !== 'off' && (
						<Segmented
							label="Radius"
							value={canvas.roundness}
							options={SIZES}
							onChange={canvas.setRoundness}
						/>
					)}
				</div>
			</section>

			<section className="lb-settings">
				<h2>Canvas</h2>

				<div className="lb-appearance__card">
					<Toggle
						label="Grid"
						hint="The dotted paper behind every board."
						icon={Grid2x2}
						checked={canvas.showGrid}
						onChange={canvas.setShowGrid}
					/>
					{canvas.showGrid && (
						<Segmented
							label="Grid style"
							value={canvas.gridStyle}
							options={GRID_STYLES}
							onChange={canvas.setGridStyle}
						/>
					)}
					<Toggle
						label="Snap to grid"
						hint="Dragging and resizing land on grid steps. Hold ⌘ to override."
						icon={Magnet}
						checked={canvas.snapToGrid}
						onChange={canvas.setSnapToGrid}
					/>
				</div>
			</section>

			<section className="lb-settings">
				<h2>Currency</h2>

				<div className="lb-appearance__card">
					<ExchangeRateToggle />
				</div>
			</section>
		</>
	)
}

/**
 * The app's only outbound network call, so it gets a switch.
 *
 * Local state rather than a hook: nothing else in the app reacts to this, and the rate store reads the
 * flag straight from storage when it next needs rates. Switching it off leaves any cached table in
 * place, so totals keep converting — just with rates that stop moving.
 */
function ExchangeRateToggle() {
	const [enabled, setEnabled] = useState(isAutoFetchEnabled)
	return (
		<Toggle
			label="Update exchange rates"
			hint="Fetches daily rates to convert between currencies. Nothing about your boards is sent."
			icon={RefreshCw}
			checked={enabled}
			onChange={(next) => {
				setEnabled(next)
				setAutoFetchEnabled(next)
			}}
		/>
	)
}

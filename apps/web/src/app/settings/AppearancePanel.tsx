import { Monitor, Moon, Squircle, Sun, type LucideIcon } from 'lucide-react'
import { ROUNDNESS_STEPS, type CanvasPrefs, type Roundness } from '../canvasPrefs'
import type { Theme } from '../useTheme'
import { Segmented, Toggle } from './controls'

/**
 * Appearance: how the app itself looks. The canvas paper has its own tab next door.
 *
 * None of the state lives here — the theme is held by `useTheme` and the canvas preferences by
 * `useCanvasPrefsState`, both in App.tsx, because they have to stay live on every route rather than
 * only while this tab is shown.
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

export function AppearancePanel({
	theme,
	onThemeChange,
	canvas,
}: {
	theme: Theme
	onThemeChange: (theme: Theme) => void
	canvas: CanvasPrefs
}) {
	return (
		<>
			<section className="lb-settings">
				<h2>Theme</h2>

				<div className="lb-appearance__card">
					{/* "Mode", not "Theme": the section above already says Theme, and a card whose only row
					    repeats its own heading reads as a rendering bug. */}
					<Segmented label="Mode" value={theme} options={THEMES} onChange={onThemeChange} />
					<p className="lb-appearance__hint">
						{theme === 'system'
							? 'Following your system appearance.'
							: `Always ${theme}, whatever your system is set to.`}
					</p>
				</div>
			</section>

			<section className="lb-settings">
				<h2>Shapes</h2>

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
		</>
	)
}

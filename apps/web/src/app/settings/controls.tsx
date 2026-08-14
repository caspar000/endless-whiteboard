import type { LucideIcon } from 'lucide-react'

/**
 * The two controls the settings tabs are built out of.
 *
 * They live here rather than in the panel that first needed them because a tab is now one of several
 * — a switch has to look and behave identically under Appearance and under Canvas, and the surest way
 * to get that is for there to be one of it.
 */

/** A row of mutually exclusive options — the right control when "off" isn't one of the choices. */
export function Segmented<T extends string>({
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
export function Toggle({
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

import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The controls the reader's settings are built from.
 *
 * They exist as components rather than as markup repeated in two files because the panel and the
 * settings window ask the same questions in different amounts of space, and a switch that is a
 * switch in one place and a checkbox in the other is how the reader came to look like a different
 * application from the board behind it. The looks themselves are the app's — `.lb-range`,
 * `.lb-switch`, `.lb-select` and `.lb-colour` are in the stylesheet's own controls section, not in
 * anything book-shaped.
 */

/** A slider. The filled half is drawn from the value, which is what makes it look the same everywhere. */
export function Range({
	id,
	value,
	min,
	max,
	step,
	label,
	onChange,
}: {
	id?: string
	value: number
	min: number
	max: number
	step: number
	label?: string
	onChange(value: number): void
}) {
	const fill = max === min ? 0 : ((value - min) / (max - min)) * 100
	return (
		<input
			id={id}
			type="range"
			className="lb-range"
			min={min}
			max={max}
			step={step}
			value={value}
			aria-label={label}
			style={{ ['--lb-range-fill' as string]: `${fill}%` }}
			onChange={(event) => onChange(event.target.valueAsNumber)}
		/>
	)
}

/** An on/off setting. A real checkbox underneath, restyled — see `.lb-switch`. */
export function Switch({
	id,
	checked,
	label,
	small,
	onChange,
}: {
	id?: string
	checked: boolean
	label?: string
	/** The narrow panel draws it a size down; the settings window at full size. */
	small?: boolean
	onChange(checked: boolean): void
}) {
	return (
		<input
			id={id}
			type="checkbox"
			className={small ? 'lb-switch lb-switch--sm' : 'lb-switch'}
			checked={checked}
			aria-label={label}
			onChange={(event) => onChange(event.target.checked)}
		/>
	)
}

/** A menu, with our own caret over a `<select>` stripped of its native one. */
export function Select({
	id,
	value,
	options,
	label,
	onChange,
}: {
	id?: string
	value: string
	options: readonly { id: string; label: string }[]
	label?: string
	onChange(value: string): void
}) {
	return (
		<span className="lb-select">
			<select
				id={id}
				value={value}
				aria-label={label}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
			<ChevronDown className="lb-select__caret" size={13} aria-hidden />
		</span>
	)
}

/**
 * A colour. The swatch is what you see and the native picker is what you get — laid transparently
 * over it, so the operating system still owns the hard part and the panel still looks like itself.
 */
export function Colour({
	id,
	value,
	label,
	onChange,
}: {
	id?: string
	value: string
	label: string
	onChange(value: string): void
}) {
	return (
		<span className="lb-colour" style={{ background: value }}>
			<input
				id={id}
				type="color"
				value={value}
				aria-label={label}
				onChange={(event) => onChange(event.target.value)}
			/>
		</span>
	)
}

/**
 * The colours a highlight can be.
 *
 * A dozen, not a spectrum: a highlighter comes in a handful of colours, and picking one from a list
 * is both faster and more repeatable than landing on 197° twice by hand. The four defaults are in
 * here, so an untouched set of tags is a set of tags you could have chosen.
 */
export const TAG_HUES: readonly number[] = [
	4, 20, 42, 60, 95, 135, 168, 197, 225, 265, 300, 330,
]

/**
 * A hue, chosen the way a shape's colour is: one swatch, and a palette under it.
 *
 * The swatch is painted in the ink the highlight will actually be — same hue, same alpha as the mark
 * left in the book — because the question it answers is what the page will look like.
 */
export function HuePicker({
	hue,
	label,
	onChange,
}: {
	hue: number
	label: string
	onChange(hue: number): void
}) {
	const [open, setOpen] = useState(false)
	const host = useRef<HTMLDivElement>(null)

	// A click anywhere else closes it. Capture-phase, because the settings window stops pointer events
	// from propagating out of itself and this listener sits on the window.
	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			if (!host.current?.contains(event.target as Node)) setOpen(false)
		}
		window.addEventListener('pointerdown', onPointerDown, { capture: true })
		return () => window.removeEventListener('pointerdown', onPointerDown, { capture: true })
	}, [open])

	return (
		<div className="lb-hue" ref={host}>
			<Swatch
				hue={hue}
				label={`${label} colour`}
				expanded={open}
				onClick={() => setOpen((value) => !value)}
			/>
			{open && (
				<div className="lb-hue__palette" role="group" aria-label={`${label} colour`}>
					{TAG_HUES.map((option) => (
						<Swatch
							key={option}
							hue={option}
							label={`Colour ${option}`}
							pressed={option === hue}
							onClick={() => {
								onChange(option)
								setOpen(false)
							}}
						/>
					))}
				</div>
			)}
		</div>
	)
}

/** One circle of highlighter ink. Also the palette's own buttons, which is why it is separate. */
export function Swatch({
	hue,
	label,
	pressed,
	expanded,
	onClick,
}: {
	hue: number
	label: string
	pressed?: boolean
	expanded?: boolean
	onClick(): void
}): ReactNode {
	return (
		<button
			type="button"
			className={pressed ? 'lb-hue__swatch lb-hue__swatch--on' : 'lb-hue__swatch'}
			style={{ ['--lb-opt-h' as string]: String(hue) }}
			title={label}
			aria-label={label}
			aria-pressed={pressed}
			aria-expanded={expanded}
			onClick={onClick}
		/>
	)
}

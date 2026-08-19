import { ChevronDown, Check } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * The composer's pop-up controls: a shell that handles the trigger and dismissal, and a pick-one menu
 * built on it.
 *
 * Modelled on T3 Code's composer controls — a low-contrast text button with a chevron, sitting on the
 * same row as the send button rather than in a settings screen. The two are split because the model
 * picker is not a list of options: it has a rail, a search box and its own keyboard handling. What it
 * shares with the reasoning menu is exactly the trigger and where the popover lands, so that is what
 * `AgentMenuShell` is and no more.
 *
 * Both open *upwards*. The composer is pinned to the bottom of the panel, so a menu that dropped down
 * would render below the viewport; there is no floating-position library here and none is needed,
 * because the panel is a fixed column and the trigger is always at its foot.
 */

export interface AgentMenuOption<T extends string> {
	value: T
	label: string
	/** Shown under the label. What this choice costs, in the panel's terms. */
	description?: string
	/** Marks the provider's own default, so a deliberate choice is distinguishable from inheriting one. */
	isDefault?: boolean
}

export function AgentMenuShell({
	title,
	trigger,
	open,
	onOpenChange,
	disabled,
	wide,
	children,
}: {
	/** The trigger's accessible name — "Model", "Reasoning". */
	title: string
	/** What the closed trigger reads, which is the current choice rather than the title. */
	trigger: ReactNode
	open: boolean
	onOpenChange: (open: boolean) => void
	disabled?: boolean
	/** Fill the composer's width. The picker needs it; a five-row menu does not. */
	wide?: boolean
	children: ReactNode
}) {
	const root = useRef<HTMLDivElement>(null)
	const popoverId = useId()

	/**
	 * Dismissal, both ways round.
	 *
	 * `pointerdown` rather than `click`: a click that starts inside the popover and ends outside it (a
	 * drag over a long description, or a text selection in the search box) is not a dismissal, and
	 * `click` fires on the common ancestor and would close it. Escape is listened for on the document
	 * because focus may be on a row, on the search box, on the trigger, or nowhere in particular.
	 */
	useEffect(() => {
		if (!open) return

		const onPointerDown = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) onOpenChange(false)
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			// Stopped here so Escape closing this popover does not also reach the panel or the board.
			event.stopPropagation()
			onOpenChange(false)
			// Focus goes back to the trigger, or Escape would leave nothing focused and the next Tab
			// would start from the top of the document.
			root.current?.querySelector<HTMLButtonElement>('.lb-agent-control')?.focus()
		}

		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown, true)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown, true)
		}
	}, [open, onOpenChange])

	return (
		<div className="lb-agent-control-wrap" ref={root}>
			<button
				type="button"
				className="lb-agent-control"
				disabled={disabled}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? popoverId : undefined}
				aria-label={title}
				onClick={() => onOpenChange(!open)}
			>
				<span className="lb-agent-control__label">{trigger}</span>
				<ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" className="lb-agent-control__chevron" />
			</button>

			{open && (
				<div className="lb-agent-pop" data-wide={wide || undefined} id={popoverId}>
					{children}
				</div>
			)}
		</div>
	)
}

/**
 * A pick-one menu: a heading, then rows that each carry a label and a sentence about what picking it
 * means. The sentence is the part worth copying — "Medium" tells you nothing, and a control nobody
 * understands is a control nobody moves.
 */
export function AgentMenu<T extends string>({
	title,
	trigger,
	value,
	options,
	onPick,
	disabled,
}: {
	title: string
	trigger: ReactNode
	value: T
	options: readonly AgentMenuOption<T>[]
	onPick: (value: T) => void
	disabled?: boolean
}) {
	const [open, setOpen] = useState(false)

	/** Arrow keys walk the rows, which is what `role="menu"` promises a keyboard user. */
	const onMenuKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
		event.preventDefault()
		const rows = [
			...(event.currentTarget.querySelectorAll<HTMLButtonElement>('.lb-agent-menu__item') ?? []),
		]
		const here = rows.indexOf(document.activeElement as HTMLButtonElement)
		const step = event.key === 'ArrowDown' ? 1 : -1
		// Wraps, because a list of five is short enough that running off the end is an annoyance rather
		// than a boundary worth respecting.
		rows[(here + step + rows.length) % rows.length]?.focus()
	}

	return (
		<AgentMenuShell
			title={title}
			trigger={trigger}
			open={open}
			onOpenChange={setOpen}
			disabled={disabled}
		>
			<div className="lb-agent-menu" role="menu" aria-label={title} onKeyDown={onMenuKeyDown}>
				<p className="lb-agent-menu__title">{title}</p>
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						className="lb-agent-menu__item"
						role="menuitemradio"
						aria-checked={option.value === value}
						// The checked row is focused on open, so Enter re-picks what is already set rather than
						// whatever happens to be first.
						autoFocus={option.value === value}
						onClick={() => {
							onPick(option.value)
							setOpen(false)
						}}
					>
						<span className="lb-agent-menu__tick">
							{option.value === value && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
						</span>
						<span className="lb-agent-menu__body">
							<span className="lb-agent-menu__label">
								{option.label}
								{option.isDefault && <span className="lb-agent-menu__badge">Default</span>}
							</span>
							{option.description && (
								<span className="lb-agent-menu__description">{option.description}</span>
							)}
						</span>
					</button>
				))}
			</div>
		</AgentMenuShell>
	)
}

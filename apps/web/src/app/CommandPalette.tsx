import {
	getVisibleCommands,
	stepSelection,
	subscribeToCommands,
	type CommandContext,
} from '@lifeboard/node-kit'
import { Command as CommandIcon, LayoutGrid } from 'lucide-react'
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { BoardMeta } from '../boards/boardIndex'
import {
	buildPaletteItems,
	formatKbd,
	isMacPlatform,
	parseQuery,
	type PaletteItem,
} from './paletteItems'

/**
 * The ⌘K palette — the command registry's first consumer, and deliberately nothing more than a view
 * over it. Every item it can run comes from `getVisibleCommands()` or the board index; there is no
 * per-command branching here, which is the same rule the dock follows for node types.
 *
 * A combobox, not a menu: the input keeps DOM focus for the whole interaction while a *virtual*
 * highlight moves through the listbox. Moving real focus into the list would take the caret out of
 * the input, and every keystroke after that would have to be routed back by hand.
 */
export interface CommandPaletteProps {
	open: boolean
	onClose: () => void
	/**
	 * Built at the moment of use, never stored, so a command can't act on a board that has since been
	 * closed. Must be referentially stable (a `useCallback`) — it feeds the item-building memo.
	 */
	getContext: () => CommandContext
	boards: readonly BoardMeta[]
	onOpenBoard: (board: BoardMeta) => void
}

export function CommandPalette({
	open,
	onClose,
	getContext,
	boards,
	onOpenBoard,
}: CommandPaletteProps) {
	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	// The registry's own store, so the palette follows a registration or an extension toggle live —
	// `getVisibleCommands` returns a stable snapshot between changes, which is what makes this legal.
	const commands = useSyncExternalStore(subscribeToCommands, getVisibleCommands)

	const items = useMemo(
		() => (open ? buildPaletteItems({ query, ctx: getContext(), boards, commands }) : []),
		[open, query, getContext, boards, commands]
	)

	// Clamped rather than corrected in an effect: the list shrinks as you type, and an effect would
	// render one frame with the highlight past the end — briefly highlighting nothing.
	const active = items.length === 0 ? 0 : Math.min(selected, items.length - 1)

	const mac = useMemo(() => isMacPlatform(), [])
	const mode = parseQuery(query).mode

	// Each opening is a fresh question. A query left over from last time is invisible until you
	// wonder why the board you're looking for isn't listed.
	useEffect(() => {
		if (!open) return
		setQuery('')
		setSelected(0)
		inputRef.current?.focus()
	}, [open])

	/*
	 * Scrolled by hand within the list rather than with `scrollIntoView`, for the reason
	 * `suggestMenu.ts` documents: that call walks up the tree and scrolls every scrollable ancestor
	 * it finds — here, the settings page or a board host behind the overlay. Only this box may move.
	 */
	useEffect(() => {
		const list = listRef.current
		const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`)
		if (!list || !row) return
		const top = row.offsetTop
		const bottom = top + row.offsetHeight
		if (top < list.scrollTop) list.scrollTop = top
		else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
	}, [active, items])

	const run = useCallback(
		(item: PaletteItem) => {
			// Closed *before* running: a command may navigate or open a board, and the overlay must not
			// still be sitting over the screen it moved you to.
			onClose()
			if (item.kind === 'board') {
				onOpenBoard(item.board)
				return
			}
			// Re-checked, because `when` was last evaluated when the list was built and the active board
			// can have changed since.
			const ctx = getContext()
			if (item.command.when?.(ctx) === false) return
			void item.command.run(ctx)
		},
		[onClose, onOpenBoard, getContext]
	)

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		// Nothing typed in here is the canvas's business. App blurs the editors while the palette is
		// open, which is what actually stops tldraw (its shortcuts are gated on `isFocused`); this is
		// the second fence, and the idiom every other input in the app uses.
		event.stopPropagation()
		if (event.key === 'Escape') {
			event.preventDefault()
			onClose()
			return
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			setSelected(stepSelection(active, event.key === 'ArrowDown' ? 1 : -1, items.length))
			return
		}
		if (event.key === 'Enter') {
			event.preventDefault()
			const item = items[active]
			if (item) run(item)
		}
	}

	if (!open) return null

	return createPortal(
		<div
			className="lb-palette"
			// Pointer-down rather than click, the same reason the `{…}` menu gives: the press is what
			// moves focus, so the decision has to be made before that rather than after.
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) onClose()
			}}
		>
			<div
				className="lb-palette__panel"
				role="dialog"
				aria-modal="true"
				aria-label="Command palette"
				onKeyDown={onKeyDown}
			>
				<input
					ref={inputRef}
					className="lb-palette__input"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value)
						// The highlight indexes a list that is about to be a different list.
						setSelected(0)
					}}
					placeholder="Search boards, or type > for commands"
					aria-label="Search boards, or type > for commands"
					role="combobox"
					aria-expanded={true}
					aria-controls="lb-palette-list"
					aria-activedescendant={items[active] ? `lb-palette-item-${active}` : undefined}
					autoComplete="off"
					spellCheck={false}
				/>

				<div ref={listRef} id="lb-palette-list" className="lb-palette__list" role="listbox">
					{items.length === 0 ? (
						<div className="lb-palette__empty">No matches</div>
					) : (
						items.map((item, index) => {
							const on = index === active
							const kbd = item.kind === 'command' ? item.command.kbd : undefined
							const Icon = item.kind === 'command' ? item.command.icon : undefined
							return (
								<Fragment key={item.key}>
									{(index === 0 || items[index - 1]?.group !== item.group) && (
										<div className="lb-palette__section">{item.group}</div>
									)}
									<div
										id={`lb-palette-item-${index}`}
										className={on ? 'lb-palette__row lb-palette__row--on' : 'lb-palette__row'}
										data-index={index}
										role="option"
										aria-selected={on}
										onPointerDown={(event) => {
											event.preventDefault()
											run(item)
										}}
										// Move, not enter: the list scrolls under a stationary pointer while you
										// arrow through it, and `onPointerEnter` would leave the highlight behind.
										onPointerMove={() => setSelected(index)}
									>
										<span className="lb-palette__icon" aria-hidden="true">
											{Icon ? (
												<Icon size={14} />
											) : item.kind === 'board' ? (
												<LayoutGrid size={14} />
											) : (
												<CommandIcon size={14} />
											)}
										</span>
										<span className="lb-palette__name">{item.title}</span>
										{kbd && <kbd className="lb-kbd lb-palette__hint">{formatKbd(kbd, mac)}</kbd>}
									</div>
								</Fragment>
							)
						})
					)}
				</div>

				{mode === 'navigate' && (
					<div className="lb-palette__footer">
						Type <kbd className="lb-kbd">&gt;</kbd> for commands
					</div>
				)}
			</div>
		</div>,
		document.body
	)
}

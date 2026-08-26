import {
	createNativeShape,
	createOperationContext,
	getNativeShape,
	getOperation,
	getVisibleCommands,
	requiredParams,
	runOperation,
	stepSelection,
	subscribeToCommands,
	type CommandContext,
	type NodeToolbarIcon,
} from '@lifeboard/node-kit'
import {
	Command as CommandIcon,
	CornerDownRight,
	Crosshair,
	LayoutGrid,
	Sigma,
} from 'lucide-react'
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
import { readExpression } from './expressionMode'
import { forgetSavedQuery, saveQuery } from './savedQueries'
import { readBoardShapes } from './findOnBoard'
import {
	answerDrillIn,
	beginDrillIn,
	buildPaletteItems,
	currentParam,
	drillInArgs,
	drillInCrumbs,
	drillInEmptyMessage,
	drillInItems,
	emptyMessage,
	expressionBody,
	expressionFooter,
	formatKbd,
	isComplete,
	isMacPlatform,
	parseQuery,
	popDrillIn,
	type DrillIn,
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

/**
 * Names the prefixes without spelling out what each does — the footer below the list does that, and
 * a placeholder long enough to explain four modes is one nobody finishes reading.
 */
const PROMPT = 'Search boards, or type >, @ or ='

/**
 * The row's own icon, when the thing it names has one — a command's, or the node type's for a shape
 * found on the board, so a note found by name looks like the note it is. Boards never have one, and
 * neither do tldraw's own shape types.
 */
function rowIcon(item: PaletteItem): NodeToolbarIcon | undefined {
	if (item.kind === 'command') return item.command.icon
	if (item.kind === 'shape') return item.icon
	return undefined
}

/**
 * Whether running this command opens argument pages instead of doing something.
 *
 * The join `operations.ts` describes: a command and the operation it was projected from share an id,
 * so the palette can ask the richer table whether there is anything to collect. Nothing is
 * hard-coded per command — an operation that gains a required parameter grows a page here by itself.
 */
function opensPages(commandId: string): boolean {
	const op = getOperation(commandId)
	return op ? requiredParams(op).length > 0 : false
}

/**
 * The answer to an expression is set apart from the rows around it: it is the *result*, not another
 * thing to pick from a list, and at list weight it reads as though the board were offering it as an
 * option.
 */
function rowClass(item: PaletteItem, on: boolean): string {
	const answer = item.kind === 'expression' && item.action === 'copy'
	return [
		'lb-palette__row',
		on ? 'lb-palette__row--on' : '',
		answer ? 'lb-palette__row--answer' : '',
	]
		.filter(Boolean)
		.join(' ')
}

/** What a row draws when it has no icon of its own: one glyph per kind of thing. */
function FallbackIcon({ kind }: { kind: PaletteItem['kind'] }) {
	if (kind === 'board') return <LayoutGrid size={14} />
	// A crosshair rather than a shape glyph: the row's promise is "take me there", not "this is a
	// rectangle" — and the shapes it lists are every type on the board, including tldraw's own.
	if (kind === 'shape') return <Crosshair size={14} />
	if (kind === 'arg' || kind === 'complete') return <CornerDownRight size={14} />
	if (kind === 'expression') return <Sigma size={14} />
	return <CommandIcon size={14} />
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
	/**
	 * The open drill-in, or `null` at the top level. Its own state rather than a mode of the query,
	 * because the query becomes the *field* once you are inside one — there is no prefix to parse.
	 */
	const [drill, setDrill] = useState<DrillIn | null>(null)
	/**
	 * An operation's refusal, shown in the panel rather than sent to a toast.
	 *
	 * The palette lives outside `<Tldraw>`, so tldraw's toasts (the app's only ones) are not reachable
	 * from here — and staying open with the reason in view is the better answer anyway: the argument
	 * that was wrong is one Enter away from being retyped.
	 */
	const [error, setError] = useState<string | null>(null)
	const [running, setRunning] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)

	// The registry's own store, so the palette follows a registration or an extension toggle live —
	// `getVisibleCommands` returns a stable snapshot between changes, which is what makes this legal.
	const commands = useSyncExternalStore(subscribeToCommands, getVisibleCommands)

	const mode = parseQuery(query).mode
	const finding = mode === 'find'
	// Only for what the palette *says*: whether to offer `@` in the footer, and what an empty find
	// list explains. Anything that acts reads the editor from a context built at that moment instead.
	const hasBoard = open && getContext().editor !== null

	/*
	 * Gathered once on entering find mode, not per keystroke: it reads every shape's page bounds, and
	 * the answer cannot change while the palette is open — the board underneath is blurred and
	 * nothing else is running. Filtering the result is what each keystroke costs, which is a
	 * substring test over at most a page of labels.
	 */
	const shapes = useMemo(() => {
		if (!open || !finding) return []
		const editor = getContext().editor
		return editor ? readBoardShapes(editor) : []
	}, [open, finding, getContext])

	/*
	 * Re-evaluated on every keystroke, unlike find mode's shape list — because the answer *is* what
	 * changed. It reads the same cached facts the board renders from, so this is a computed read plus
	 * one collection run over the page, which is what a note holding an expression does per render.
	 */
	const expression = useMemo(() => {
		if (!open || mode !== 'expression') return undefined
		const editor = getContext().editor
		return editor ? readExpression(editor, expressionBody(query)) : undefined
	}, [open, mode, query, getContext])

	const items = useMemo(() => {
		if (!open) return []
		// Inside a drill-in the list is that page's answers and nothing else: the top-level modes are
		// not reachable from here, and mixing them in would offer "New board" as a value for a URL.
		if (drill) return drillInItems(drill, query)
		return buildPaletteItems({ query, ctx: getContext(), boards, commands, shapes, expression })
	}, [open, drill, query, getContext, boards, commands, shapes, expression])

	// Clamped rather than corrected in an effect: the list shrinks as you type, and an effect would
	// render one frame with the highlight past the end — briefly highlighting nothing.
	const active = items.length === 0 ? 0 : Math.min(selected, items.length - 1)

	const mac = useMemo(() => isMacPlatform(), [])

	// A parameter's `description` is written for someone deciding what to supply, which is exactly
	// what a field's prompt has to say — so the page asks the operation rather than restating it.
	const prompt = drill ? (currentParam(drill)?.spec.description ?? PROMPT) : PROMPT

	// Each opening is a fresh question. A query left over from last time is invisible until you
	// wonder why the board you're looking for isn't listed.
	useEffect(() => {
		if (!open) return
		setQuery('')
		setSelected(0)
		setDrill(null)
		setError(null)
		setRunning(false)
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

	/** Moves to the next page, or runs the operation once every answer is in. */
	const advance = useCallback(
		async (next: DrillIn) => {
			setQuery('')
			setSelected(0)
			setError(null)
			if (!isComplete(next)) {
				setDrill(next)
				return
			}

			const opCtx = createOperationContext(getContext().editor)
			if (!opCtx) {
				// No board bridge means the host never installed one — a build-time fact, not something
				// the user did. Say so plainly rather than blaming the arguments.
				setError('This build cannot run operations.')
				return
			}

			setRunning(true)
			const result = await runOperation(next.opId, opCtx, drillInArgs(next))
			setRunning(false)
			if (result.ok) {
				onClose()
				return
			}
			// Kept open, one page back, with the reason above the list: the last answer is the one most
			// likely to be wrong and is now the one being asked for again.
			setError(result.error)
			setDrill(popDrillIn(next) ?? next)
		},
		[getContext, onClose]
	)

	const run = useCallback(
		(item: PaletteItem) => {
			// The list is replaced by "Working…" while an operation is in flight, but the rows are still
			// in `items` and Enter still reaches them — so the guard has to be here, not in the render.
			// `node.image` fetches over the network, which is long enough to press Enter twice.
			if (running) return

			if (item.kind === 'arg') {
				if (drill) void advance(answerDrillIn(drill, item.value))
				return
			}

			// Rewrites the input rather than doing anything — the palette stays open and you keep typing.
			if (item.kind === 'complete') {
				setQuery(item.query)
				setSelected(0)
				return
			}

			if (item.kind === 'command') {
				const op = getOperation(item.command.id)
				const pages = op ? beginDrillIn(item.command, op) : null
				// A command with arguments to collect is a doorway: it opens pages instead of running,
				// and the palette stays open behind them.
				if (pages) {
					void advance(pages)
					return
				}
			}

			// Closed *before* running: a command may navigate or open a board, and the overlay must not
			// still be sitting over the screen it moved you to.
			onClose()
			if (item.kind === 'board') {
				onOpenBoard(item.board)
				return
			}
			const ctx = getContext()
			if (item.kind === 'expression') {
				if (item.action === 'copy') {
					// Optional-chained and unawaited: a clipboard the browser refuses is not worth
					// failing a keypress over, and there is nothing useful to say about it.
					void navigator.clipboard?.writeText(item.result)
					return
				}
				if (item.action === 'save') {
					saveQuery({ name: item.name, body: item.body })
					return
				}
				if (item.action === 'forget') {
					forgetSavedQuery(item.name)
					return
				}
				// The *question*, not the answer. Text shapes run `{…}` through the same evaluator when
				// they render (`collections/shapeText.tsx`), so what lands on the board keeps itself up
				// to date — which is the whole reason to put it there rather than paste a number.
				const editor = ctx.editor
				const spec = getNativeShape('text')
				if (!editor || !spec) return
				const id = createNativeShape(
					editor,
					spec,
					editor.getViewportPageBounds().center,
					`{${item.explicit}}`
				)
				editor.select(id)
				return
			}
			if (item.kind === 'shape') {
				// Selected before the camera moves, so the animation lands on something already
				// highlighted rather than picking it out afterwards. `zoomToSelection` frames it at a
				// readable size — an off-screen shape found by name is usually one you now want to read.
				ctx.editor?.select(item.shapeId)
				ctx.editor?.zoomToSelection({ animation: { duration: 320 } })
				return
			}
			// Re-checked, because `when` was last evaluated when the list was built and the active board
			// can have changed since.
			if (item.command.when?.(ctx) === false) return
			void item.command.run(ctx)
		},
		[onClose, onOpenBoard, getContext, drill, advance, running]
	)

	/**
	 * Back one step, wherever you are: a page of the drill-in, then the drill-in itself, then the
	 * palette. One rule, reached by both Escape and Backspace-on-empty, so neither can strand you on a
	 * page with no way out but the mouse.
	 */
	const goBack = useCallback(() => {
		if (!drill) {
			onClose()
			return
		}
		setDrill(popDrillIn(drill))
		setQuery('')
		setSelected(0)
		setError(null)
	}, [drill, onClose])

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		// Nothing typed in here is the canvas's business. App blurs the editors while the palette is
		// open, which is what actually stops tldraw (its shortcuts are gated on `isFocused`); this is
		// the second fence, and the idiom every other input in the app uses.
		event.stopPropagation()
		if (event.key === 'Escape') {
			event.preventDefault()
			goBack()
			return
		}
		// Only on an empty field, so Backspace stays Backspace while there is something to delete.
		if (event.key === 'Backspace' && drill && query === '') {
			event.preventDefault()
			goBack()
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
				{drill && (
					<div className="lb-palette__crumbs">
						{drillInCrumbs(drill).map((crumb, index) => (
							<Fragment key={`${index}:${crumb}`}>
								{index > 0 && <span className="lb-palette__crumb-sep">›</span>}
								<span className="lb-palette__crumb">{crumb}</span>
							</Fragment>
						))}
					</div>
				)}

				<input
					ref={inputRef}
					className="lb-palette__input"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value)
						// The highlight indexes a list that is about to be a different list.
						setSelected(0)
					}}
					placeholder={prompt}
					aria-label={prompt}
					role="combobox"
					aria-expanded={true}
					aria-controls="lb-palette-list"
					aria-activedescendant={items[active] ? `lb-palette-item-${active}` : undefined}
					autoComplete="off"
					spellCheck={false}
				/>

				{error && (
					<div className="lb-palette__error" role="alert">
						{error}
					</div>
				)}

				<div ref={listRef} id="lb-palette-list" className="lb-palette__list" role="listbox">
					{running ? (
						<div className="lb-palette__empty">Working…</div>
					) : items.length === 0 ? (
						<div className="lb-palette__empty">
							{drill ? drillInEmptyMessage(drill) : emptyMessage(mode, hasBoard)}
						</div>
					) : (
						items.map((item, index) => {
							const on = index === active
							// A command that opens pages shows where it goes rather than a binding it cannot
							// have: there is no chord that can supply an argument.
							const pages = item.kind === 'command' && opensPages(item.command.id)
							const kbd = item.kind === 'command' && !pages ? item.command.kbd : undefined
							const Icon = rowIcon(item)
							return (
								<Fragment key={item.key}>
									{(index === 0 || items[index - 1]?.group !== item.group) && (
										<div className="lb-palette__section">{item.group}</div>
									)}
									<div
										id={`lb-palette-item-${index}`}
										className={rowClass(item, on)}
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
									{item.kind === 'complete' && (
										<span className="lb-palette__hint lb-palette__detail">{item.hint}</span>
									)}
									{pages && (
										<span className="lb-palette__hint lb-palette__more" aria-hidden="true">
											→
										</span>
									)}
									</div>
								</Fragment>
							)
						})
					)}
				</div>

				{!drill && mode === 'expression' && expressionFooter(expression) && (
					<div className="lb-palette__footer">{expressionFooter(expression)}</div>
				)}

				{!drill && mode === 'navigate' && (
					<div className="lb-palette__footer">
						Type <kbd className="lb-kbd">&gt;</kbd> for commands
						{hasBoard && (
							<>
								, <kbd className="lb-kbd">@</kbd> to find something on this board,{' '}
								<kbd className="lb-kbd">=</kbd> to ask it a question
							</>
						)}
					</div>
				)}
			</div>
		</div>,
		document.body
	)
}

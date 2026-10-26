import { stopEventPropagation, useEditor, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type WheelEvent as ReactWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { boxOrder, deleteNote, isCard, placeNote, type BoxEntry, type Placement } from '../box'
import { CardFace } from '../card/CardFace'
import { beginJump } from './jump'
import { frontIndex, getStack, showCard } from './state'

/** The cards drawn around the front one: one already flipped away, the front, and three behind. */
const BEFORE = 1
const BEHIND = 3

/** How much wheel makes one flip, and how soon after one the next may come (a flick riffles, it doesn't fly). */
const WHEEL_STEP = 60
const MIN_FLIP_GAP_MS = 55
/** How far a finger has to travel up or down to flip. */
const SWIPE_PX = 40

/** Whether this editor's board is the one on screen: a tab in the background keeps its editor. */
function onScreen(editor: Editor): boolean {
	const container = editor.getContainer()
	return (
		container.isConnected &&
		getComputedStyle(container).visibility !== 'hidden' &&
		container.getClientRects().length > 0
	)
}

/** Somewhere text is being typed: the card's own editor, the jump field, the palette. */
function typingIn(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * Puts the caret in a card. At the point that was clicked, or at the end: the sticky note's editor
 * starts with all of its text selected, so that typing replaces a label, and on a note that is a way
 * to lose a paragraph to the first key pressed.
 */
export function startEditing(editor: Editor, id: TLShapeId, at?: { x: number; y: number }, mark = true): void {
	// What is typed is one undo step of its own; a note just written already has one, for being written.
	if (mark) editor.markHistoryStoppingPoint('edit a note')
	editor.select(id)
	editor.setEditingShape(id)
	editor.setCurrentTool('select.editing_shape')
	placeCaret(editor, at)
}

/** Once the card's text editor exists (it mounts on the next render), moves its caret. */
export function placeCaret(editor: Editor, at?: { x: number; y: number }): void {
	let tries = 0
	const attempt = () => {
		const text = editor.getRichTextEditor()
		if (!text) {
			if (++tries < 5) requestAnimationFrame(attempt)
			return
		}
		const pos = at ? text.view.posAtCoords({ left: at.x, top: at.y })?.pos : undefined
		text.commands.focus(pos ?? 'end')
	}
	requestAnimationFrame(attempt)
}

/** Writes a new note where `how` says, brings it to the front and puts the caret in it. */
export function writeNote(editor: Editor, how: Placement): void {
	// On the table, the card picked out; in the stack, the one in front. From the gap a deleted note
	// left, a new note still goes behind it: that id still has its place.
	const selected = editor.getOnlySelectedShape()
	const order = boxOrder(editor)
	const from =
		!getStack(editor).open && isCard(selected)
			? selected.props.zid
			: (order[frontIndex(editor, order)]?.zid ?? null)
	const { id, zid } = placeNote(editor, how, from)
	showCard(editor, zid)
	requestAnimationFrame(() => startEditing(editor, id, undefined, false))
}

/**
 * The stack: the box as a pile of cards, the front one readable and the next ones' top edges stepping
 * up behind it (docs/zettelkasten-plan.md, "Stack").
 *
 * A surface over the board, as the book reader is, portalled into the editor's container so it covers
 * the canvas and leaves the box's own bar (the dock, drawn above it) in reach. While it is open the
 * editor counts a menu as open, which is what stops the board's own keys (tool letters, digits,
 * Backspace deleting the selection) reaching the canvas under it; this surface binds its own instead,
 * like the reader does.
 */
export function StackView() {
	const editor = useEditor()
	const open = useValue('lifeboard:zettel-stack-open', () => getStack(editor).open, [editor])
	const order = useValue('lifeboard:zettel-order', () => boxOrder(editor), [editor])
	const index = useValue('lifeboard:zettel-front', () => frontIndex(editor), [editor])
	const editingId = useValue('lifeboard:zettel-editing', () => editor.getEditingShapeId(), [editor])
	const [confirming, setConfirming] = useState<string | null>(null)
	const front = index >= 0 ? order[index] : undefined

	const go = useCallback(
		(to: number) => {
			const list = boxOrder(editor)
			if (!list.length) return
			const clamped = Math.max(0, Math.min(list.length - 1, to))
			if (clamped === frontIndex(editor, list)) return
			editor.complete()
			setConfirming(null)
			showCard(editor, list[clamped]!.zid)
		},
		[editor]
	)
	const step = useCallback((by: number) => go(frontIndex(editor) + by), [editor, go])

	// The board's own keys are off while the stack is up (see the component's comment).
	useEffect(() => {
		if (!open) return
		editor.addOpenMenu(STACK_MENU)
		return () => {
			editor.deleteOpenMenu(STACK_MENU)
		}
	}, [editor, open])

	// The stack's keys. A window listener, as the reader's are, and only for the board on screen.
	useEffect(() => {
		if (!open) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || !onScreen(editor)) return
			const editing = editor.getEditingShapeId() !== null
			if (editing) {
				// Escape puts the card down. Taken in the capture phase, before the text or the canvas can.
				if (event.key === 'Escape') {
					event.preventDefault()
					event.stopPropagation()
					editor.complete()
				}
				return
			}
			// Not deferring to an earlier handler that took the key: over the stack the board's keys are
			// meant to be silent, and for the moment after a box opens the app's dispatcher may not yet
			// know which board is on screen and claim one (N as the sticky tool) anyway.
			if (typingIn(event.target)) return
			const accel = event.metaKey || event.ctrlKey
			if (accel && event.key.toLowerCase() === 'z') {
				event.preventDefault()
				if (event.shiftKey) editor.redo()
				else editor.undo()
				return
			}
			if (accel || event.altKey) return
			const order = boxOrder(editor)
			const current = order[frontIndex(editor, order)]
			let handled = true
			switch (event.key) {
				case 'ArrowDown':
				case 'ArrowRight':
				case 'PageDown':
				case 'j':
					step(1)
					break
				case 'ArrowUp':
				case 'ArrowLeft':
				case 'PageUp':
				case 'k':
					step(-1)
					break
				case 'Home':
					go(0)
					break
				case 'End':
					go(order.length - 1)
					break
				case 'n':
					writeNote(editor, 'behind')
					break
				case 'N':
					writeNote(editor, 'branch')
					break
				case 'Enter':
					if (current?.id) startEditing(editor, current.id)
					break
				case 'Backspace':
				case 'Delete':
					if (current?.id) setConfirming(current.zid)
					break
				case 'Escape':
					setConfirming(null)
					break
				default:
					// A digit begins a note's number: the dock's "Go to" field takes it from there.
					if (/^[0-9]$/.test(event.key)) beginJump(event.key)
					else handled = false
			}
			if (handled) event.preventDefault()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [editor, open, go, step])

	// The wheel: one flip per notch, and a trackpad's stream of small deltas adds up to flips that come
	// no faster than MIN_FLIP_GAP_MS apart, so a flick riffles through a handful rather than fifty.
	const wheel = useRef({ total: 0, last: 0 })
	const onWheel = (event: ReactWheelEvent) => {
		stopEventPropagation(event)
		const body = (event.target as HTMLElement).closest('.lb-zstack__front .lb-zcard__body')
		if (body && body.scrollHeight > body.clientHeight) {
			// A long note scrolls first; it flips once its end is reached.
			const atTop = body.scrollTop <= 0
			const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 1
			if ((event.deltaY > 0 && !atEnd) || (event.deltaY < 0 && !atTop)) return
		}
		const delta = event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY
		const state = wheel.current
		state.total += delta
		const now = performance.now()
		if (Math.abs(state.total) < WHEEL_STEP) return
		if (now - state.last < MIN_FLIP_GAP_MS) {
			state.total = Math.sign(state.total) * WHEEL_STEP
			return
		}
		state.last = now
		step(Math.sign(state.total))
		state.total = 0
	}

	// A swipe: up for the next card, down for the one before.
	const swipe = useRef<{ y: number; id: number } | null>(null)
	const swiped = useRef(false)
	const onPointerDown = (event: ReactPointerEvent) => {
		stopEventPropagation(event)
		swiped.current = false
		const inText = (event.target as HTMLElement).closest('.tl-rich-text-editor, .lb-zstack__confirm, button, input')
		// A press anywhere but the text being written ends the writing.
		if (editor.getEditingShapeId() && !inText) editor.complete()
		if (!inText) swipe.current = { y: event.clientY, id: event.pointerId }
	}
	const onPointerUp = (event: ReactPointerEvent) => {
		const start = swipe.current
		swipe.current = null
		if (!start || start.id !== event.pointerId) return
		const dy = event.clientY - start.y
		if (Math.abs(dy) < SWIPE_PX) return
		// The click that follows is the end of the swipe, not a press on the card.
		swiped.current = true
		step(dy < 0 ? 1 : -1)
	}

	if (!open) return null

	const visible: { entry: BoxEntry; slot: number }[] = []
	for (let slot = -BEFORE; slot <= BEHIND; slot++) {
		const entry = order[index + slot]
		if (entry) visible.push({ entry, slot })
	}

	return createPortal(
		<div
			className="lb-zstack"
			onWheel={onWheel}
			onPointerDown={onPointerDown}
			onPointerUp={onPointerUp}
			onTouchStart={stopEventPropagation}
			onContextMenu={stopEventPropagation}
		>
			{order.length === 0 ? (
				<EmptyBox editor={editor} />
			) : (
				<div className="lb-zstack__pile">
					{/* Later cards first, so the front one is last in the document and on top. */}
					{[...visible].reverse().map(({ entry, slot }) => (
						<StackCard
							key={entry.id ?? `gap:${entry.zid}`}
							editor={editor}
							entry={entry}
							slot={slot}
							editing={slot === 0 && entry.id !== null && editingId === entry.id}
							swiped={swiped}
						/>
					))}
					{confirming && front?.zid === confirming && front.id && (
						<div className="lb-zstack__confirm" role="alertdialog" aria-label={`Delete ${confirming}?`}>
							<p>
								Delete <strong>{confirming}</strong>? Its number won’t be given to another note.
							</p>
							<button
								type="button"
								className="lb-btn lb-btn--danger"
								autoFocus
								onClick={() => {
									deleteNote(editor, front.id!)
									setConfirming(null)
								}}
							>
								Delete
							</button>
							<button type="button" className="lb-btn" onClick={() => setConfirming(null)}>
								Keep
							</button>
						</div>
					)}
				</div>
			)}
			{order.length > 0 && (
				<div className="lb-zstack__position" aria-live="polite">
					{index + 1} of {order.length}
				</div>
			)}
		</div>,
		editor.getContainer()
	)
}

/** The editor counts this as an open menu while the stack is up: see `StackView`. */
const STACK_MENU = 'lifeboard.zettelkasten.stack'

function StackCard({
	editor,
	entry,
	slot,
	editing,
	swiped,
}: {
	editor: Editor
	entry: BoxEntry
	slot: number
	editing: boolean
	swiped: { current: boolean }
}) {
	const shape = useValue('lifeboard:zettel-card', () => (entry.id ? editor.getShape(entry.id) : undefined), [editor, entry.id])
	const style = { '--slot': slot } as CSSProperties
	if (!entry.id) {
		return (
			<div className="lb-zstack__card lb-zstack__card--gap" data-slot={slot} style={style} aria-hidden={slot !== 0}>
				<div className="lb-zcard lb-zcard--gap">
					<div className="lb-zcard__id">{entry.zid}</div>
					<p className="lb-zcard__empty">Deleted. Its branches follow.</p>
				</div>
			</div>
		)
	}
	if (!isCard(shape)) return null
	return (
		<div
			className={slot === 0 ? 'lb-zstack__card lb-zstack__front' : 'lb-zstack__card'}
			data-slot={slot}
			style={style}
			aria-hidden={slot !== 0}
			onClick={(event) => {
				if (slot !== 0 || editing || swiped.current) return
				if ((event.target as HTMLElement).closest('.lb-zcard__body')) {
					startEditing(editor, shape.id, { x: event.clientX, y: event.clientY })
				}
			}}
		>
			<CardFace shape={shape} live={slot === 0} editing={editing} />
		</div>
	)
}

function EmptyBox({ editor }: { editor: Editor }) {
	return (
		<div className="lb-zstack__empty">
			<p>An empty box.</p>
			<p className="lb-zstack__hint">
				Every note gets its number from where you put it. The first one is <strong>1</strong>.
			</p>
			<button type="button" className="lb-btn lb-btn--primary" onClick={() => writeNote(editor, 'train')}>
				Write the first note
			</button>
		</div>
	)
}

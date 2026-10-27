import { stopEventPropagation, useEditor, useValue, type Editor } from '@lifeboard/canvas'
import { X } from 'lucide-react'
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { boxOrder, isCard, isSource, removeChip, shapeByZid } from '../box'
import { CardFace } from '../card/CardFace'
import { SourceFace } from '../card/SourceFace'
import { chainPath } from '../chain'
import { outgoingLinks } from '../links'
import { ChipPicker } from './Picker'
import { startEditing } from './StackView'
import { closeChain, frontIndex, getStack, openChain, stepChain, turnChain } from './state'
import { onControl, onScreen, typingIn } from './surface'

/**
 * Starts following the chain from where the person is: the card in front of the stack, or the card
 * picked out on the table, or else the box's first note.
 */
export function followChain(editor: Editor): void {
	const order = boxOrder(editor)
	const { open } = getStack(editor)
	const selected = editor.getOnlySelectedShape()
	const front = order[frontIndex(editor, order)]
	const here = open ? (front?.kind === 'note' ? front.zid : null) : isCard(selected) ? selected.props.zid : null
	const start = here ?? order.find((entry) => entry.kind === 'note')?.zid
	if (!start) return
	editor.complete()
	openChain(editor, start)
}

/** How many of a card's links are shown beside it; the rest are counted. */
const PEEKS = 3
/** How long a taken link takes to slide into the path. */
const TURN_MS = 340

/** The editor counts this as an open menu while the chain is up, as it does for the stack. */
const CHAIN_MENU = 'lifeboard.zettelkasten.chain'

/** Where a taken link was on screen, so its card can slide from there into its row. */
interface Slide {
	row: number
	from: DOMRect
}

/**
 * Following a chain of thought (docs/zettelkasten-plan.md, "Chain"; the path is chain.ts). The middle
 * column is the path: a note and the rest of its train of thought, in order. Beside each card, blurred,
 * the notes it links to. Taking one turns the path there: the card slides into the row under the one it
 * was linked from, and the path goes on from it. The turns are a trail across the top, to step back by.
 *
 * A full-screen surface like the stack, over whichever of the stack or the table it was opened from,
 * and while it is up it has the cards' live text: click a card's text to write on it.
 */
export function ChainView() {
	const editor = useEditor()
	const turns = useValue('lifeboard:zettel-chain', () => getStack(editor).chain, [editor])
	const order = useValue('lifeboard:zettel-order', () => boxOrder(editor), [editor])
	const editingId = useValue('lifeboard:zettel-editing', () => editor.getEditingShapeId(), [editor])
	const path = useMemo(() => (turns ? chainPath(order, turns) : []), [order, turns])
	// The row being written on: a path can pass one note twice, and only one copy may be live.
	const [editRow, setEditRow] = useState<number | null>(null)
	const scroller = useRef<HTMLDivElement>(null)
	const slide = useRef<Slide | null>(null)
	const open = turns !== null

	// The board's own keys are off while the chain is up, and the formatting bar, placed for the card's
	// spot on the canvas underneath, goes (as for the stack).
	useEffect(() => {
		if (!open) return
		editor.addOpenMenu(CHAIN_MENU)
		const container = editor.getContainer()
		container.classList.add('lb-zstack-open')
		return () => {
			editor.deleteOpenMenu(CHAIN_MENU)
			container.classList.remove('lb-zstack-open')
		}
	}, [editor, open])

	// Nothing to follow (the note it started from is gone): back to where it was opened.
	useEffect(() => {
		if (open && path.length === 0) closeChain(editor)
	}, [editor, open, path.length])

	useEffect(() => {
		if (editingId === null) setEditRow(null)
	}, [editingId])

	const turn = (row: number, to: string, from?: DOMRect) => {
		if (!shapeByZid(editor, to)) return
		editor.complete()
		if (from) slide.current = { row: row + 1, from }
		turnChain(editor, row, to)
	}

	// The taken link's card slides from where it was shown into its row: brought into view first, then
	// started at the old place and let go.
	useLayoutEffect(() => {
		const pending = slide.current
		slide.current = null
		const list = scroller.current
		const card = pending && list?.querySelector<HTMLElement>(`[data-row="${pending.row}"] .lb-zchain__card`)
		if (!pending || !list || !card) return
		const view = list.getBoundingClientRect()
		let to = card.getBoundingClientRect()
		if (to.bottom > view.bottom - 24) {
			list.scrollTop += to.bottom - view.bottom + 24
			to = card.getBoundingClientRect()
		}
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
		const scale = pending.from.width / to.width
		card.style.transition = 'none'
		card.style.transformOrigin = '0 0'
		card.style.transform = `translate(${pending.from.left - to.left}px, ${pending.from.top - to.top}px) scale(${scale})`
		card.getBoundingClientRect()
		card.style.transition = `transform ${TURN_MS}ms cubic-bezier(0.25, 0.8, 0.25, 1)`
		card.style.transform = ''
		const done = () => {
			card.style.transition = ''
			card.style.transformOrigin = ''
		}
		card.addEventListener('transitionend', done, { once: true })
	}, [path])

	// The chain's keys: Escape puts a card down or leaves; Backspace steps back a turn; ⌘Z undoes.
	useEffect(() => {
		if (!open) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || !onScreen(editor)) return
			if (editor.getEditingShapeId() !== null) {
				if (event.key === 'Escape') {
					event.preventDefault()
					event.stopPropagation()
					editor.complete()
				}
				return
			}
			if (typingIn(event.target)) return
			const accel = event.metaKey || event.ctrlKey
			if (accel && event.key.toLowerCase() === 'z') {
				event.preventDefault()
				if (event.shiftKey) editor.redo()
				else editor.undo()
				return
			}
			if (accel || event.altKey) return
			const chain = getStack(editor).chain ?? []
			const list = scroller.current
			let handled = true
			switch (event.key) {
				case 'Escape':
					closeChain(editor)
					break
				case 'Backspace':
					if (chain.length > 1) stepChain(editor, chain.length - 2)
					break
				case 'ArrowDown':
				case 'j':
					list?.scrollBy({ top: rowHeight(list), behavior: 'smooth' })
					break
				case 'ArrowUp':
				case 'k':
					list?.scrollBy({ top: -rowHeight(list), behavior: 'smooth' })
					break
				default:
					handled = false
			}
			if (handled) event.preventDefault()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [editor, open])

	if (!turns || path.length === 0) return null

	return createPortal(
		<div
			className="lb-zchain"
			onWheel={stopEventPropagation}
			onTouchStart={stopEventPropagation}
			onContextMenu={stopEventPropagation}
			onPointerDown={(event) => {
				stopEventPropagation(event)
				const inside = (event.target as HTMLElement).closest('.tl-rich-text-editor, button, input, textarea, .lb-zpick')
				if (editor.getEditingShapeId() && !inside) editor.complete()
			}}
		>
			<nav className="lb-zchain__trail" aria-label="The turns taken">
				{turns.map((step, i) => (
					<span key={i} className="lb-zchain__step">
						{i > 0 && <span className="lb-zchain__sep">›</span>}
						<button
							type="button"
							className={i === turns.length - 1 ? 'lb-zchain__turn lb-zchain__turn--here' : 'lb-zchain__turn'}
							aria-current={i === turns.length - 1 || undefined}
							onClick={() => stepChain(editor, i)}
						>
							{step.to}
						</button>
					</span>
				))}
				<button type="button" className="lb-zchain__close" aria-label="Leave the chain (Esc)" title="Leave the chain (Esc)" onClick={() => closeChain(editor)}>
					<X aria-hidden="true" />
				</button>
			</nav>
			<div className="lb-zchain__scroll" ref={scroller}>
				{path.map((zid, row) => (
					<ChainRow
						key={`${row}:${zid}`}
						editor={editor}
						zid={zid}
						row={row}
						editing={row === editRow && editingId !== null}
						onEdit={(at) => {
							const shape = shapeByZid(editor, zid)
							if (!isCard(shape)) return
							setEditRow(row)
							startEditing(editor, shape.id, at)
						}}
						onTurn={turn}
					/>
				))}
				<div className="lb-zchain__row lb-zchain__row--end">
					<p className="lb-zchain__end">
						{turns.length > 1 ? 'The end of this train of thought. To go back, pick an earlier turn at the top.' : 'The end of this train of thought.'}
					</p>
				</div>
			</div>
		</div>,
		editor.getContainer()
	)
}

function rowHeight(list: HTMLElement): number {
	return list.querySelector<HTMLElement>('.lb-zchain__row')?.offsetHeight ?? 300
}

function ChainRow({
	editor,
	zid,
	row,
	editing,
	onEdit,
	onTurn,
}: {
	editor: Editor
	zid: string
	row: number
	editing: boolean
	onEdit: (at: { x: number; y: number }) => void
	onTurn: (row: number, to: string, from?: DOMRect) => void
}) {
	const shape = useValue('lifeboard:zettel-chain-card', () => shapeByZid(editor, zid), [editor, zid])
	const peeks = useValue(
		'lifeboard:zettel-chain-links',
		() => {
			const card = shapeByZid(editor, zid)
			if (!isCard(card)) return []
			const { richText, links = [], keywords = [], cites = [] } = card.props
			const targets = [...outgoingLinks({ zid, richText, links, keywords, cites }), ...cites]
			return [...new Set(targets)].filter((target) => shapeByZid(editor, target))
		},
		[editor, zid]
	)
	if (!shape) return null

	return (
		<div className="lb-zchain__row" data-row={row}>
			<div
				className="lb-zchain__card"
				// A link or a number pressed on the card is a turn here, not a trip to the stack.
				onClickCapture={(event) => {
					const target = (event.target as HTMLElement).closest<HTMLElement>('[data-zid]')
					if (!target?.dataset.zid) return
					event.stopPropagation()
					event.preventDefault()
					onTurn(row, target.dataset.zid)
				}}
				onClick={(event) => {
					if (editing || onControl(event.target)) return
					if ((event.target as HTMLElement).closest('.lb-zcard__body')) onEdit({ x: event.clientX, y: event.clientY })
				}}
			>
				{isSource(shape) ? (
					<SourceFace shape={shape} />
				) : (
					<CardFace
						shape={shape}
						live
						editing={editing}
						add={editing ? undefined : <ChipPicker editor={editor} card={shape} />}
						onRemove={(kind, value) => removeChip(editor, shape.id, kind, value)}
					/>
				)}
			</div>
			<div className="lb-zchain__side">
				{peeks.slice(0, PEEKS).map((target, i) => (
					<Peek key={target} editor={editor} zid={target} index={i} onTake={(from) => onTurn(row, target, from)} />
				))}
				{peeks.length > PEEKS && <span className="lb-zchain__more">and {peeks.length - PEEKS} more on the card</span>}
			</div>
		</div>
	)
}

/** A card this one links to, out of focus beside it until it is taken. */
function Peek({ editor, zid, index, onTake }: { editor: Editor; zid: string; index: number; onTake: (from: DOMRect) => void }) {
	const shape = useValue('lifeboard:zettel-peek', () => shapeByZid(editor, zid), [editor, zid])
	if (!shape) return null
	const take = (element: HTMLElement) => onTake(element.getBoundingClientRect())
	return (
		<div
			className="lb-zchain__peek"
			role="button"
			tabIndex={0}
			aria-label={`Follow the link to ${zid}`}
			style={{ '--peek': index } as CSSProperties}
			onPointerDown={stopEventPropagation}
			onClick={(event) => take(event.currentTarget)}
			onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
				if (event.key !== 'Enter' && event.key !== ' ') return
				event.preventDefault()
				take(event.currentTarget)
			}}
		>
			{isSource(shape) ? <SourceFace shape={shape} /> : <CardFace shape={shape} live={false} />}
		</div>
	)
}

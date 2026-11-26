import { CalendarDays, LayoutGrid, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { isSharedWithMe, type BoardMeta } from '../boards/boardIndex'
import { BoardBadgeButton } from './boardLook/BoardBadge'
import { otherTabIds, tabIdsAfter, type Tab, type TabsState } from './tabsModel'

/**
 * A label's side: one S-shaped slope from the label's foot up to the window edge, in the label's own
 * fill and outline. The bends sit near the ends — a round shoulder at the foot, a steep middle, a flare
 * at the top — so it reads as an S rather than a diagonal.
 *
 * It sweeps over the start of the label behind, in `--tab-bg` and `--tab-line`, and is stretched to
 * whatever size the CSS gives it; the outline keeps its 1px width.
 *
 * The fill reaches a few units back under the label's body so there is no seam, stopping just above
 * the body's bottom line so it doesn't cover it.
 */
function Slope({ side }: { side: 'left' | 'right' }) {
	return (
		<svg
			className={`lb-tabs__slope lb-tabs__slope--${side}`}
			viewBox="-4 0 104 100"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<path className="lb-tabs__slope-fill" d="M-4 0H100C25 0 75 100 0 100V96H-4Z" />
			<path className="lb-tabs__slope-line" d="M100 0C25 0 75 100 0 100" />
		</svg>
	)
}

/** How far a press moves before it is a drag rather than a click, in px. */
const DRAG_THRESHOLD = 5

/**
 * Dragging a label along the row. The row reorders as the pointer passes the middle of a neighbour, so
 * the labels' stacking and slopes stay right throughout. Listened for on the window: a label moved in
 * the DOM loses pointer capture.
 */
function useTabDrag(onMove: (id: string, index: number) => void) {
	const [dragging, setDragging] = useState<string | null>(null)
	const labels = useRef(new Map<string, HTMLElement>())
	const press = useRef<{ id: string; x: number; moved: boolean } | null>(null)
	// The click a drag ends with is not a click on the label.
	const swallowClick = useRef(false)
	const moveRef = useRef(onMove)
	moveRef.current = onMove

	useEffect(() => {
		const onPointerMove = (e: globalThis.PointerEvent) => {
			const held = press.current
			if (!held) return
			if (!held.moved) {
				if (Math.abs(e.clientX - held.x) < DRAG_THRESHOLD) return
				held.moved = true
				setDragging(held.id)
			}
			// The labels in row order, without the one being dragged: it lands after every one whose middle
			// the pointer has passed.
			const others = [...labels.current.entries()]
				.filter(([id]) => id !== held.id)
				.map(([, el]) => el.getBoundingClientRect())
				.sort((a, b) => a.left - b.left)
			moveRef.current(held.id, others.filter((rect) => rect.left + rect.width / 2 < e.clientX).length)
		}
		const onPointerUp = () => {
			if (press.current?.moved) {
				swallowClick.current = true
				setTimeout(() => (swallowClick.current = false))
			}
			press.current = null
			setDragging(null)
		}
		window.addEventListener('pointermove', onPointerMove)
		window.addEventListener('pointerup', onPointerUp)
		window.addEventListener('pointercancel', onPointerUp)
		return () => {
			window.removeEventListener('pointermove', onPointerMove)
			window.removeEventListener('pointerup', onPointerUp)
			window.removeEventListener('pointercancel', onPointerUp)
		}
	}, [])

	return {
		dragging,
		handlersFor: (id: string) => ({
			ref: (el: HTMLElement | null) => {
				if (el) labels.current.set(id, el)
				else labels.current.delete(id)
			},
			onPointerDown: (e: PointerEvent) => {
				if (e.button !== 0 || (e.target as Element).closest('.lb-tabs__close, input')) return
				press.current = { id, x: e.clientX, moved: false }
			},
		}),
		/** Whether this click ends a drag, and should do nothing. */
		swallowsClick: () => swallowClick.current,
	}
}

/**
 * The open tabs, as folder labels hanging from the top edge of the window beside the sidebar, after a
 * pinned "All Boards" label that leads home. Shown on every screen, so a board is one click away from
 * Settings or Help too; there no label is in front.
 *
 * A tab is a board, the daily page, or a New tab, which shows the home screen until a board is picked
 * there (`tabsModel.ts`).
 *
 * The labels overlap like a stack of folder tabs, the active one in front and each step away from it
 * one layer further back. A label's side away from the active one is a slope that sweeps over the
 * start of the label behind; that label keeps its own rounded foot a few px further on, so a notch of
 * the board shows between the two. The first label meets the window edge square, and "+" sits after
 * the last label's slope.
 *
 * Drag a label along the row to move it; right-click it for its menu; middle-click closes it.
 * Double-clicking the active board's label renames the board in place.
 */
export function TabStrip({
	boards,
	tabs,
	homeActive,
	onHome,
	onSelect,
	onClose,
	onMove,
	onNew,
	onRename,
}: {
	boards: BoardMeta[]
	tabs: TabsState
	/** The pinned All Boards is in front: the home screen, outside any New tab. */
	homeActive: boolean
	onHome: () => void
	onSelect: (tab: Tab) => void
	onClose: (ids: readonly string[]) => void
	onMove: (id: string, index: number) => void
	onNew: () => void
	onRename: (boardId: string, name: string) => void
}) {
	const [renaming, setRenaming] = useState<string | null>(null)
	const [menu, setMenu] = useState<{ tab: Tab; x: number; y: number } | null>(null)
	const { dragging, handlersFor, swallowsClick } = useTabDrag(onMove)

	const byId = new Map(boards.map((b) => [b.id, b]))
	// A board's tab shows once the index knows the board.
	const open = tabs.tabs.flatMap((tab): { tab: Tab; board: BoardMeta | null }[] => {
		if (tab.route.view !== 'board') return [{ tab, board: null }]
		const board = byId.get(tab.route.boardId)
		return board ? [{ tab, board }] : []
	})
	// The labels' places in the stack, "All Boards" being the first: 0 is All Boards, 1 the first tab. On
	// Settings and Help (or a board that is gone) none is in front, and every label slopes to the right,
	// like those after an active one.
	const tabIndex = open.findIndex(({ tab }) => tab.id === tabs.activeId)
	const activeIndex = homeActive ? 0 : tabIndex >= 0 ? tabIndex + 1 : -1
	const layer = (index: number) => ({ zIndex: 50 - Math.abs(index - activeIndex) })
	const shape = (index: number) => {
		const active = index === activeIndex
		// Left of the active label the right side is covered, right of it the left side.
		const slopeLeft = index > 0 && index <= activeIndex
		const slopeRight = index >= activeIndex
		const className = [
			'lb-tabs__tab',
			active ? 'lb-tabs__tab--active' : '',
			slopeLeft ? 'lb-tabs__tab--slope-left' : '',
			slopeRight ? 'lb-tabs__tab--slope-right' : '',
		]
			.filter(Boolean)
			.join(' ')
		return { active, slopeLeft, slopeRight, className }
	}
	const home = shape(0)

	const openMenu = (tab: Tab) => (e: MouseEvent<HTMLElement>) => {
		e.preventDefault()
		// From the keyboard (the menu key, ⇧F10) there is no pointer: the menu drops from the label.
		const rect = e.currentTarget.getBoundingClientRect()
		const fromKeyboard = e.clientX === 0 && e.clientY === 0
		setMenu({ tab, x: fromKeyboard ? rect.left : e.clientX, y: fromKeyboard ? rect.bottom : e.clientY })
	}

	return (
		<>
			<div
				className={dragging ? 'lb-tabs lb-tabs--dragging lb-stagger' : 'lb-tabs lb-stagger'}
				role="tablist"
				aria-label="Open tabs"
			>
				<div
					role="tab"
					tabIndex={0}
					aria-selected={home.active}
					className={`${home.className} lb-tabs__tab--home`}
					style={layer(0)}
					onClick={onHome}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault()
							onHome()
						}
					}}
				>
					{home.slopeRight && <Slope side="right" />}
					<LayoutGrid className="lb-tabs__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
					<span className="lb-tabs__label">All Boards</span>
					{/* Room after the name (16px with the gap), so it doesn't look cut short against the slope. */}
					<span className="lb-tabs__close-space" aria-hidden="true" />
				</div>

				{open.map(({ tab, board }, i) => {
					const index = i + 1
					const { active, slopeLeft, slopeRight, className } = shape(index)
					const name = board ? board.name : tab.route.view === 'daily' ? 'Daily' : 'New tab'
					return (
						// The whole label is the click target, like a browser tab — not just the text. A <div>
						// with button semantics rather than a <button>, because the close control is a real
						// button and buttons cannot nest.
						<div
							key={tab.id}
							{...handlersFor(tab.id)}
							role="tab"
							tabIndex={0}
							aria-selected={active}
							className={dragging === tab.id ? `${className} lb-tabs__tab--dragging` : className}
							style={layer(index)}
							// The click a drag ends with reaches nothing in the label, the colour badge included.
							onClickCapture={(e) => {
								if (swallowsClick()) e.stopPropagation()
							}}
							onClick={() => onSelect(tab)}
							// Middle click closes, as a browser tab does. Pressing the wheel would otherwise start
							// the browser's autoscroll.
							onMouseDown={(e) => {
								if (e.button === 1) e.preventDefault()
							}}
							onAuxClick={(e) => {
								if (e.button !== 1) return
								e.preventDefault()
								onClose([tab.id])
							}}
							onContextMenu={openMenu(tab)}
							onDoubleClick={() => active && board && !isSharedWithMe(board) && setRenaming(board.id)}
							onKeyDown={(e) => {
								if (renaming === null && (e.key === 'Enter' || e.key === ' ')) {
									e.preventDefault()
									onSelect(tab)
								}
							}}
							title={active && board ? 'Double-click to rename' : name}
						>
							{slopeLeft && <Slope side="left" />}
							{slopeRight && <Slope side="right" />}
							{board ? (
								<BoardBadgeButton board={board} className="lb-tabs__thumb" />
							) : tab.route.view === 'daily' ? (
								<CalendarDays className="lb-tabs__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
							) : (
								<LayoutGrid className="lb-tabs__icon" size={16} strokeWidth={1.75} aria-hidden="true" />
							)}
							{board && renaming === board.id ? (
								<form
									className="lb-tabs__rename"
									// A click in the field is not a click on the label, which would bring a tab behind to the front.
									onClick={(e) => e.stopPropagation()}
									onSubmit={(e) => {
										e.preventDefault()
										const value = new FormData(e.currentTarget).get('name')
										if (typeof value === 'string' && value.trim()) onRename(board.id, value.trim())
										setRenaming(null)
									}}
								>
									{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
									<input
										autoFocus
										name="name"
										defaultValue={board.name}
										aria-label="Board name"
										onBlur={() => setRenaming(null)}
										onKeyDown={(e) => {
											if (e.key === 'Escape') setRenaming(null)
											// Otherwise the canvas would read these as tool shortcuts.
											e.stopPropagation()
										}}
									/>
								</form>
							) : (
								<span className="lb-tabs__label">{name}</span>
							)}
							<button
								className="lb-tabs__close"
								onClick={(e) => {
									e.stopPropagation()
									onClose([tab.id])
								}}
								aria-label={`Close ${name}`}
							>
								<X size={14} strokeWidth={1.75} aria-hidden="true" />
							</button>
						</div>
					)
				})}

				<button className="lb-tabs__new" onClick={onNew} aria-label="New tab" title="New tab">
					<Plus size={18} strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>

			{/* Outside the strip, which scrolls sideways and would clip it. */}
			{menu && (
				<TabMenu x={menu.x} y={menu.y} onDismiss={() => setMenu(null)}>
					{(() => {
						const board = menu.tab.route.view === 'board' ? byId.get(menu.tab.route.boardId) : undefined
						const others = otherTabIds(tabs, menu.tab.id)
						const after = tabIdsAfter(tabs, menu.tab.id)
						return (
							<>
								{board && !isSharedWithMe(board) && (
									// In its label where it is: bringing it to the front would hand the focus to its board.
									<TabMenuItem onPick={() => setRenaming(board.id)}>
										Rename board
									</TabMenuItem>
								)}
								<TabMenuItem onPick={() => onClose([menu.tab.id])}>Close tab</TabMenuItem>
								<TabMenuItem disabled={others.length === 0} onPick={() => onClose(others)}>
									Close other tabs
								</TabMenuItem>
								<TabMenuItem disabled={after.length === 0} onPick={() => onClose(after)}>
									Close tabs to the right
								</TabMenuItem>
							</>
						)
					})()}
				</TabMenu>
			)}
		</>
	)
}

/**
 * A label's right-click menu, where the pointer was. A press elsewhere or Escape puts it away; arrow
 * keys walk the rows, which is what `role="menu"` promises a keyboard user.
 */
function TabMenu({ x, y, onDismiss, children }: { x: number; y: number; onDismiss: () => void; children: ReactNode }) {
	const root = useRef<HTMLDivElement>(null)
	const dismiss = useRef(onDismiss)
	dismiss.current = onDismiss

	useEffect(() => {
		// The focus goes back where it was, a label or the board, when the menu goes, unless a row moved it
		// on (Rename focuses the name field).
		const before = document.activeElement as HTMLElement | null
		root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
		const onPointerDown = (e: globalThis.PointerEvent) => {
			if (!root.current?.contains(e.target as Node)) dismiss.current()
		}
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === 'Escape') dismiss.current()
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKey)
		window.addEventListener('blur', dismiss.current)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKey)
			window.removeEventListener('blur', dismiss.current)
			if (document.activeElement === document.body) before?.focus({ preventScroll: true })
		}
	}, [])

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		// The canvas would otherwise read the keys pressed here as its shortcuts.
		e.stopPropagation()
		if (e.key === 'Escape') onDismiss()
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
		e.preventDefault()
		const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
		const here = rows.indexOf(document.activeElement as HTMLButtonElement)
		rows[(here + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus()
	}

	return (
		<div
			ref={root}
			className="lb-tabmenu lb-float"
			role="menu"
			aria-label="Tab"
			style={{ left: Math.min(x, window.innerWidth - 228), top: y }}
			onKeyDown={onKeyDown}
			// A row picked puts the menu away.
			onClick={(e) => {
				if ((e.target as Element).closest('button')) onDismiss()
			}}
		>
			{children}
		</div>
	)
}

function TabMenuItem({ disabled, onPick, children }: { disabled?: boolean; onPick: () => void; children: ReactNode }) {
	return (
		<button type="button" role="menuitem" className="lb-tabmenu__item" disabled={disabled} onClick={onPick}>
			{children}
		</button>
	)
}

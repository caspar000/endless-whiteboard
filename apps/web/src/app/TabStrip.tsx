import { LayoutGrid, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { BoardBadgeButton } from './boardLook/BoardBadge'

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

/**
 * The open boards, as folder labels hanging from the top edge of the window beside the sidebar, after
 * a pinned "All Boards" label that leads home. Shown on every screen, so a board is one click away
 * from Settings or Help too; there no label is in front.
 *
 * The labels overlap like a stack of folder tabs, the active one in front and each step away from it
 * one layer further back. A label's side away from the active one is a slope that sweeps over the
 * start of the label behind; that label keeps its own rounded foot a few px further on, so a notch of
 * the board shows between the two. The first label meets the window edge square, and "+" sits after
 * the last label's slope.
 * Double-clicking the active board's label renames the board in place.
 */
export function TabStrip({
	boards,
	tabs,
	view,
	activeBoardId,
	onHome,
	onSelect,
	onClose,
	onNew,
	onRename,
}: {
	boards: BoardMeta[]
	tabs: string[]
	view: 'list' | 'settings' | 'help' | 'board'
	activeBoardId: string | null
	onHome: () => void
	onSelect: (board: BoardMeta) => void
	onClose: (id: string) => void
	onNew: () => void
	onRename: (id: string, name: string) => void
}) {
	const [renaming, setRenaming] = useState<string | null>(null)

	const byId = new Map(boards.map((b) => [b.id, b]))
	const open = tabs.flatMap((id) => {
		const board = byId.get(id)
		return board ? [board] : []
	})
	// The labels' places in the stack, "All Boards" being the first: 0 is All Boards, 1 the first board.
	// On Settings and Help (or a board that is gone) none is in front, and every label slopes to the
	// right, like those after an active one.
	const boardIndex = view === 'board' ? open.findIndex((board) => board.id === activeBoardId) : -1
	const activeIndex = view === 'list' ? 0 : boardIndex >= 0 ? boardIndex + 1 : -1
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

	return (
		<div className="lb-tabs lb-stagger" role="tablist" aria-label="Open boards">
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

			{open.map((board, i) => {
				const { id } = board
				const index = i + 1
				const { active, slopeLeft, slopeRight, className } = shape(index)
				return (
					// The whole label is the click target, like a browser tab — not just the text.
					// A <div> with button semantics rather than a <button>, because the close control
					// is a real button and buttons cannot nest.
					<div
						key={id}
						role="tab"
						tabIndex={0}
						aria-selected={active}
						className={className}
						style={layer(index)}
						onClick={() => onSelect(board)}
						// Middle click closes, as a browser tab does. Pressing the wheel would otherwise
						// start the browser's autoscroll.
						onMouseDown={(e) => {
							if (e.button === 1) e.preventDefault()
						}}
						onAuxClick={(e) => {
							if (e.button !== 1) return
							e.preventDefault()
							onClose(id)
						}}
						onDoubleClick={() => active && setRenaming(id)}
						onKeyDown={(e) => {
							if (renaming !== id && (e.key === 'Enter' || e.key === ' ')) {
								e.preventDefault()
								onSelect(board)
							}
						}}
						title={active ? 'Double-click to rename' : board.name}
					>
						{slopeLeft && <Slope side="left" />}
						{slopeRight && <Slope side="right" />}
						<BoardBadgeButton board={board} className="lb-tabs__thumb" />
						{renaming === id ? (
							<form
								className="lb-tabs__rename"
								onSubmit={(e) => {
									e.preventDefault()
									const value = new FormData(e.currentTarget).get('name')
									if (typeof value === 'string' && value.trim()) onRename(id, value.trim())
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
							<span className="lb-tabs__label">{board.name}</span>
						)}
						<button
							className="lb-tabs__close"
							onClick={(e) => {
								e.stopPropagation()
								onClose(id)
							}}
							aria-label={`Close ${board.name}`}
						>
							<X size={14} strokeWidth={1.75} aria-hidden="true" />
						</button>
					</div>
				)
			})}

			<button className="lb-tabs__new" onClick={onNew} aria-label="New board" title="New board">
				<Plus size={18} strokeWidth={1.75} aria-hidden="true" />
			</button>
		</div>
	)
}

import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { boardTint } from './boardTint'

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
 * The open boards, as folder labels hanging from the top edge of the window beside the sidebar.
 * Shown on a board only: everywhere else the sidebar is the way to a board.
 *
 * The labels overlap like a stack of folder tabs, the active one in front and each step away from it
 * one layer further back. A label's side away from the active one is a slope that sweeps over the
 * start of the label behind; that label keeps its own rounded foot a few px further on, so a notch of
 * the board shows between the two. The first label meets the window edge square, and "+" sits after
 * the last label's slope.
 * Double-clicking the active label renames the board in place.
 */
export function TabStrip({
	boards,
	tabs,
	activeBoardId,
	onSelect,
	onClose,
	onNew,
	onRename,
}: {
	boards: BoardMeta[]
	tabs: string[]
	activeBoardId: string | null
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
	const activeIndex = open.findIndex((board) => board.id === activeBoardId)

	return (
		<div className="lb-tabs" role="tablist" aria-label="Open boards">
			{open.map((board, index) => {
				const { id } = board
				const active = index === activeIndex
				// Left of the active label the right side is covered, right of it the left side.
				const slopeLeft = index > 0 && index <= activeIndex
				const slopeRight = index >= activeIndex
				const classes = [
					'lb-tabs__tab',
					active ? 'lb-tabs__tab--active' : '',
					slopeLeft ? 'lb-tabs__tab--slope-left' : '',
					slopeRight ? 'lb-tabs__tab--slope-right' : '',
				]
					.filter(Boolean)
					.join(' ')
				return (
					// The whole label is the click target, like a browser tab — not just the text.
					// A <div> with button semantics rather than a <button>, because the close control
					// is a real button and buttons cannot nest.
					<div
						key={id}
						role="tab"
						tabIndex={0}
						aria-selected={active}
						className={classes}
						style={{ zIndex: 50 - Math.abs(index - activeIndex) }}
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
						<span className="lb-tabs__thumb" style={{ background: boardTint(id) }} aria-hidden="true" />
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

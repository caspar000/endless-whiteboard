import { LayoutGrid, PanelRight, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'

/**
 * The tab strip across the top of the shell — Affine's browser-tab model. A pinned "All boards"
 * tab is the home screen; each open board is a closable tab beside it; "+" creates a board and
 * opens it. Double-clicking the active board tab renames the board in place, which replaces the
 * old floating board chrome.
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
	agentOpen,
	onToggleAgent,
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
	agentOpen: boolean
	onToggleAgent: () => void
}) {
	const [renaming, setRenaming] = useState<string | null>(null)

	const byId = new Map(boards.map((b) => [b.id, b]))

	return (
		<div className="lb-tabs" role="tablist" aria-label="Open boards">
			<button
				role="tab"
				aria-selected={view !== 'board'}
				className={view !== 'board' ? 'lb-tabs__tab lb-tabs__tab--active' : 'lb-tabs__tab'}
				onClick={onHome}
			>
				<LayoutGrid className="lb-tabs__icon" size={13} aria-hidden="true" />
				<span className="lb-tabs__label">All boards</span>
			</button>

			{tabs.map((id) => {
				const board = byId.get(id)
				if (!board) return null
				const active = view === 'board' && id === activeBoardId
				return (
					// The whole tab is the click target, like a browser tab — not just the label text.
					// A <div> with button semantics rather than a <button>, because the close control
					// is a real button and buttons cannot nest.
					<div
						key={id}
						role="tab"
						tabIndex={0}
						aria-selected={active}
						className={active ? 'lb-tabs__tab lb-tabs__tab--active' : 'lb-tabs__tab'}
						onClick={() => onSelect(board)}
						onDoubleClick={() => active && setRenaming(id)}
						onKeyDown={(e) => {
							if (renaming !== id && (e.key === 'Enter' || e.key === ' ')) {
								e.preventDefault()
								onSelect(board)
							}
						}}
						title={active ? 'Double-click to rename' : board.name}
					>
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
							<X size={12} aria-hidden="true" />
						</button>
					</div>
				)
			})}

			<button className="lb-tabs__new" onClick={onNew} aria-label="New board" title="New board">
				<Plus size={15} aria-hidden="true" />
			</button>

			{/* Pushes the agent toggle to the far right, mirroring the sidebar's collapse control on the
			    far left — the two panels the shell can show, each toggled from its own edge. */}
			<span className="lb-tabs__spacer" />
			<button
				className={
					agentOpen ? 'lb-tabs__panel lb-tabs__panel--active' : 'lb-tabs__panel'
				}
				onClick={onToggleAgent}
				aria-label={agentOpen ? 'Close agent panel' : 'Open agent panel'}
				aria-pressed={agentOpen}
				title={`${agentOpen ? 'Close' : 'Open'} agent panel  ⌘⇧A`}
			>
				<PanelRight size={15} aria-hidden="true" />
			</button>
		</div>
	)
}

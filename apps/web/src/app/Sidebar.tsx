import { CircleHelp, LayoutGrid, PenLine, Plus, Settings, Star } from 'lucide-react'
import type { BoardMeta } from '../boards/boardIndex'

/**
 * The shell's left rail, visible on every screen — Affine's structure: a couple of fixed sections
 * up top, then favourites as a flat list of documents (boards, here) you can jump straight into.
 *
 * Every entry is backed by real data: the favourites list is the actual favourited boards, not a
 * placeholder for a feature that doesn't exist.
 */
export function Sidebar({
	view,
	activeBoardId,
	boards,
	onAllBoards,
	onSettings,
	onHelp,
	onOpenBoard,
	onNewBoard,
}: {
	view: 'list' | 'settings' | 'help' | 'board'
	activeBoardId: string | null
	boards: BoardMeta[]
	onAllBoards: () => void
	onSettings: () => void
	onHelp: () => void
	onOpenBoard: (board: BoardMeta) => void
	onNewBoard: () => void
}) {
	const favorites = boards.filter((b) => b.favorite)

	return (
		<aside className="lb-sidebar">
			<div className="lb-sidebar__brand">
				<span className="lb-sidebar__mark" aria-hidden="true">
					<PenLine size={14} />
				</span>
				<span className="lb-sidebar__name">Lifeboard</span>
			</div>

			<button className="lb-sidebar__new" onClick={onNewBoard}>
				<Plus size={15} aria-hidden="true" /> New board
			</button>

			<nav className="lb-sidebar__nav" aria-label="Sections">
				<button
					className={
						view === 'list' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'
					}
					onClick={onAllBoards}
					aria-current={view === 'list' ? 'page' : undefined}
				>
					<span className="lb-sidebar__icon" aria-hidden="true">
						<LayoutGrid size={15} />
					</span>
					<span className="lb-sidebar__label">All boards</span>
					<span className="lb-sidebar__count">{boards.length}</span>
				</button>
				<button
					className={
						view === 'settings' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'
					}
					onClick={onSettings}
					aria-current={view === 'settings' ? 'page' : undefined}
				>
					<span className="lb-sidebar__icon" aria-hidden="true">
						<Settings size={15} />
					</span>
					<span className="lb-sidebar__label">Settings</span>
				</button>
				<button
					className={
						view === 'help' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'
					}
					onClick={onHelp}
					aria-current={view === 'help' ? 'page' : undefined}
				>
					<span className="lb-sidebar__icon" aria-hidden="true">
						<CircleHelp size={15} />
					</span>
					<span className="lb-sidebar__label">Help</span>
				</button>
			</nav>

			{favorites.length > 0 && (
				<nav className="lb-sidebar__section" aria-label="Favourites">
					<div className="lb-sidebar__section-title">Favourites</div>
					{favorites.map((board) => (
						<button
							key={board.id}
							className={
								view === 'board' && board.id === activeBoardId
									? 'lb-sidebar__item lb-sidebar__item--active'
									: 'lb-sidebar__item'
							}
							onClick={() => onOpenBoard(board)}
							aria-current={view === 'board' && board.id === activeBoardId ? 'page' : undefined}
							title={board.name}
						>
							<span className="lb-sidebar__icon lb-sidebar__icon--star" aria-hidden="true">
								<Star size={13} fill="currentColor" />
							</span>
							<span className="lb-sidebar__label">{board.name}</span>
						</button>
					))}
				</nav>
			)}
		</aside>
	)
}

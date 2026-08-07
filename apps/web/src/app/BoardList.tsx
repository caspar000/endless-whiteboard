import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { BoardCard } from './BoardCard'
import type { BoardsApi } from './useBoards'

/**
 * The home screen's content pane: a grid of board cards. The sidebar and tab strip around it are
 * the shell's (see App.tsx) — this renders inside the shell's content area.
 */
export function BoardList({
	api,
	onOpen,
}: {
	api: BoardsApi
	onOpen: (board: BoardMeta) => void
}) {
	const [renaming, setRenaming] = useState<string | null>(null)

	const createAndOpen = async () => {
		const board = await api.create()
		onOpen(board)
	}

	return (
		<main className="lb-home__main">
			<header className="lb-home__header">
				<h1>All boards</h1>
				<button className="lb-btn lb-btn--primary" onClick={() => void createAndOpen()}>
					New board
				</button>
			</header>

			{api.loading ? (
				<p className="lb-list__empty">Loading…</p>
			) : api.boards.length === 0 ? (
				<div className="lb-list__empty">
					<p>No boards yet.</p>
					<p className="lb-list__hint">
						Create one, then pick a note or a table from the dock at the bottom of the canvas.
					</p>
					<button className="lb-btn lb-btn--primary" onClick={() => void createAndOpen()}>
						New board
					</button>
				</div>
			) : (
				<ul className="lb-grid lb-list__boards">
					{api.boards.map((board) => (
						<BoardCard
							key={board.id}
							board={board}
							onOpen={() => onOpen(board)}
							onRename={() => setRenaming(board.id)}
							renaming={renaming === board.id}
							onRenameSubmit={(name) => {
								const trimmed = name.trim()
								if (trimmed && trimmed !== board.name) void api.rename(board.id, trimmed)
								setRenaming(null)
							}}
							onRenameCancel={() => setRenaming(null)}
							onToggleFavorite={() => void api.setFavorite(board.id, !board.favorite)}
							onDelete={() => void api.remove(board.id)}
						/>
					))}
				</ul>
			)}
		</main>
	)
}

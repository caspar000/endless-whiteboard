import { useMemo, useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { BoardCard } from './BoardCard'
import { SettingsPanel } from './SettingsPanel'
import { RECENTS_LIMIT, Sidebar, sectionTitle, type HomeSection } from './Sidebar'
import type { BoardsApi } from './useBoards'

/**
 * The home screen: a sidebar of sections beside a grid of board cards.
 *
 * Modelled on Freeform's board browser — thumbnail cards, section counts, a bold section heading —
 * with Affine's darker, lower-contrast chrome.
 */
export function BoardList({
	api,
	onOpen,
}: {
	api: BoardsApi
	onOpen: (board: BoardMeta) => void
}) {
	const [section, setSection] = useState<HomeSection>('all')
	const [renaming, setRenaming] = useState<string | null>(null)

	const visible = useMemo(() => {
		// `api.boards` is already sorted by `updatedAt` descending, so "recents" is just the head of it.
		switch (section) {
			case 'recents':
				return api.boards.slice(0, RECENTS_LIMIT)
			case 'favorites':
				return api.boards.filter((b) => b.favorite)
			default:
				return api.boards
		}
	}, [api.boards, section])

	const createAndOpen = async () => {
		const board = await api.create()
		onOpen(board)
	}

	return (
		<div className="lb-home">
			<Sidebar
				section={section}
				onSelect={setSection}
				boards={api.boards}
				onNewBoard={() => void createAndOpen()}
			/>

			<main className="lb-home__main">
				<header className="lb-home__header">
					<h1>{sectionTitle(section)}</h1>
					{section !== 'storage' && (
						<button className="lb-btn lb-btn--primary" onClick={() => void createAndOpen()}>
							New board
						</button>
					)}
				</header>

				{section === 'storage' ? (
					<SettingsPanel api={api} onImported={() => setSection('all')} />
				) : api.loading ? (
					<p className="lb-list__empty">Loading…</p>
				) : visible.length === 0 ? (
					<EmptyState section={section} onNewBoard={() => void createAndOpen()} />
				) : (
					<ul className="lb-grid lb-list__boards">
						{visible.map((board) => (
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
		</div>
	)
}

function EmptyState({
	section,
	onNewBoard,
}: {
	section: HomeSection
	onNewBoard: () => void
}) {
	if (section === 'favorites') {
		return (
			<div className="lb-list__empty">
				<p>No favourites yet.</p>
				<p className="lb-list__hint">Star a board to keep it here.</p>
			</div>
		)
	}
	return (
		<div className="lb-list__empty">
			<p>No boards yet.</p>
			<p className="lb-list__hint">
				Create one, then double-click anywhere on the canvas to add an item, a note, or a rollup
				that totals them up.
			</p>
			<button className="lb-btn lb-btn--primary" onClick={onNewBoard}>
				New board
			</button>
		</div>
	)
}

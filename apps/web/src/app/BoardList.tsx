import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { BoardCard } from './BoardCard'
import type { BoardsApi } from './useBoards'

const MOVE_OFFERED_KEY = 'lifeboard:moveOffered'

/** The "move your boards to the server" offer is made once per browser, whichever way it is answered. */
function wasMoveOffered(): boolean {
	try {
		return localStorage.getItem(MOVE_OFFERED_KEY) === '1'
	} catch {
		return false
	}
}

function rememberMoveOffered(): void {
	try {
		localStorage.setItem(MOVE_OFFERED_KEY, '1')
	} catch {
		// Private-mode Safari: the offer comes back next time, which is harmless.
	}
}

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
	const [moving, setMoving] = useState<string | null>(null)
	const [moveError, setMoveError] = useState<string | null>(null)
	const [offerDismissed, setOfferDismissed] = useState(wasMoveOffered)

	const localBoards = api.boards.filter((board) => !board.vault)

	/** One at a time and in order, so a failure says which board and leaves the rest where they were. */
	const move = async (boards: BoardMeta[]) => {
		setMoveError(null)
		try {
			for (const [i, board] of boards.entries()) {
				setMoving(boards.length > 1 ? `Moving ${i + 1} of ${boards.length}: ${board.name}…` : `Moving ${board.name}…`)
				await api.move(board)
			}
		} catch (error) {
			setMoveError(error instanceof Error ? error.message : String(error))
		} finally {
			setMoving(null)
		}
	}

	const dismissOffer = () => {
		rememberMoveOffered()
		setOfferDismissed(true)
	}

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

			{api.hasServer && localBoards.length > 0 && !offerDismissed && !moving && (
				<div className="lb-list__offer">
					<p>
						{localBoards.length === 1
							? '1 board is only on this device. Move it to your server to open it anywhere.'
							: `${localBoards.length} boards are only on this device. Move them to your server to open them anywhere.`}
					</p>
					<button
						className="lb-btn lb-btn--primary lb-btn--tiny"
						onClick={() => {
							dismissOffer()
							void move(localBoards)
						}}
					>
						Move to server
					</button>
					<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={dismissOffer}>
						Keep them here
					</button>
				</div>
			)}
			{moving && <p className="lb-list__status">{moving}</p>}
			{moveError && <p className="lb-settings__warn">{moveError}</p>}

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
							{...(api.hasServer && !moving
								? {
										onMove: () => void move([board]),
										moveLabel: board.vault === 'server' ? 'Move to this device' : 'Move to server',
									}
								: {})}
						/>
					))}
				</ul>
			)}
		</main>
	)
}

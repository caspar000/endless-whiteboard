import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { dismissMove, retryMove } from '../boards/moveQueue'
import { usePlatform } from '../platform/PlatformContext'
import { ThumbnailBackfill } from '../canvas/ThumbnailBackfill'
import { BoardCard } from './BoardCard'
import { useMoves, type BoardsApi } from './useBoards'

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
	const platform = usePlatform()
	const [renaming, setRenaming] = useState<string | null>(null)
	const [offerDismissed, setOfferDismissed] = useState(wasMoveOffered)
	const moves = useMoves()
	const moving = moves.some((job) => !job.error)
	const moveOf = (id: string) => moves.find((job) => job.board.id === id)

	const localBoards = api.boards.filter((board) => !board.vault)

	/** Queued, so a reload neither stops the moves nor hides them (boards/moveQueue.ts). */
	const move = (boards: BoardMeta[]) => void api.move(boards)

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

			{api.serverOffline && (
				<div className="lb-list__offer" data-testid="lb.server-offline">
					<p>
						Offline. Server boards open from this device as they were last seen, and changes go up
						when the server is back. New boards stay on this device.
					</p>
				</div>
			)}

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
							{...(moveOf(board.id) ? { moveJob: moveOf(board.id)! } : {})}
							onRetryMove={() => void retryMove(platform.kv, board.id)}
							onDismissMove={() => void dismissMove(platform.kv, board.id)}
							{...(api.hasServer && !moveOf(board.id)
								? {
										onMove: () => void move([board]),
										moveLabel: board.vault === 'server' ? 'Move to this device' : 'Move to server',
									}
								: {})}
						/>
					))}
				</ul>
			)}
			{!api.loading && <ThumbnailBackfill boards={api.boards} />}
		</main>
	)
}

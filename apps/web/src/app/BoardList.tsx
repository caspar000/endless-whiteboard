import { useEffect, useState } from 'react'
import { isSharedWithMe, type BoardMeta } from '../boards/boardIndex'
import { dismissMove, retryMove } from '../boards/moveQueue'
import { usePlatform } from '../platform/PlatformContext'
import { ThumbnailBackfill } from '../canvas/ThumbnailBackfill'
import { BoardCard } from './BoardCard'
import { openShareDialog } from './ShareDialog'
import { useMoves, type BoardsApi } from './useBoards'

const MOVE_OFFERED_KEY = 'lifeboard:moveOffered'

/**
 * Which boards the grid shows, with a server: all of them, the server's, or this device's alone.
 * Remembered for the session, so opening a board and coming back keeps the view.
 */
type Where = 'all' | 'server' | 'device'
let lastWhere: Where = 'all'

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
	const [where, setWhereState] = useState<Where>(lastWhere)
	const setWhere = (next: Where) => {
		lastWhere = next
		setWhereState(next)
	}
	// Only worth showing when there are boards in both places.
	const filtering = api.hasServer && localBoards.length > 0 && localBoards.length < api.boards.length
	const shown =
		!filtering || where === 'all' ? api.boards : where === 'device' ? localBoards : api.boards.filter((board) => board.vault)
	const filters: { value: Where; label: string; count: number }[] = [
		{ value: 'all', label: 'All', count: api.boards.length },
		{ value: 'server', label: 'On the server', count: api.boards.length - localBoards.length },
		{ value: 'device', label: 'On this device', count: localBoards.length },
	]

	/** Queued, so a reload neither stops the moves nor hides them (boards/moveQueue.ts). */
	const move = (boards: BoardMeta[]) => void api.move(boards)

	const dismissOffer = () => {
		rememberMoveOffered()
		setOfferDismissed(true)
	}

	// Picking boards for one action on them all. Escape leaves it, as it leaves any mode.
	const [selecting, setSelecting] = useState(false)
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const stopSelecting = () => {
		setSelecting(false)
		setSelected(new Set())
		setConfirmDelete(false)
	}
	const toggle = (id: string) => {
		setConfirmDelete(false)
		setSelected((current) => {
			const next = new Set(current)
			if (!next.delete(id)) next.add(id)
			return next
		})
	}
	useEffect(() => {
		if (!selecting) return
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') stopSelecting()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [selecting])
	const deleteSelected = async () => {
		setDeleting(true)
		try {
			// One after another: each removal refreshes the list, and a board can be on the server.
			for (const id of selected) await api.remove(id)
		} finally {
			setDeleting(false)
			stopSelecting()
		}
	}

	const createAndOpen = async () => {
		const board = await api.create()
		onOpen(board)
	}

	return (
		<main className="lb-home__main">
			<header className="lb-home__header">
				<h1>All boards</h1>
				<div className="lb-home__header-actions">
					{api.boards.length > 0 && !selecting && (
						<button className="lb-btn" onClick={() => setSelecting(true)}>
							Select
						</button>
					)}
					<button className="lb-btn lb-btn--primary" onClick={() => void createAndOpen()}>
						New board
					</button>
				</div>
			</header>

			{selecting && (
				<div className="lb-list__offer lb-list__selection" role="toolbar" aria-label="Selected boards">
					<p>
						{selected.size === 0
							? 'Click boards to select them.'
							: `${selected.size} ${selected.size === 1 ? 'board' : 'boards'} selected`}
					</p>
					<button
						className="lb-btn lb-btn--ghost lb-btn--tiny"
						onClick={() => setSelected(new Set(shown.filter((board) => !moveOf(board.id)).map((board) => board.id)))}
					>
						Select all{filtering && where !== 'all' ? ' shown' : ''}
					</button>
					{confirmDelete ? (
						<button
							className="lb-btn lb-btn--danger lb-btn--tiny"
							disabled={deleting}
							onClick={() => void deleteSelected()}
						>
							{deleting ? 'Deleting…' : `Delete ${selected.size} for good`}
						</button>
					) : (
						<button
							className="lb-btn lb-btn--tiny"
							disabled={selected.size === 0}
							onClick={() => setConfirmDelete(true)}
						>
							Delete
						</button>
					)}
					<button className="lb-btn lb-btn--ghost lb-btn--tiny" disabled={deleting} onClick={stopSelecting}>
						Cancel
					</button>
				</div>
			)}

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

			{filtering && (
				<div className="lb-appearance__seg lb-list__filter" role="group" aria-label="Where the boards are">
					{filters.map((filter) => (
						<button
							key={filter.value}
							className={where === filter.value ? 'lb-appearance__opt lb-appearance__opt--active' : 'lb-appearance__opt'}
							aria-pressed={where === filter.value}
							onClick={() => setWhere(filter.value)}
						>
							{filter.label} <span className="lb-list__filter-count">{filter.count}</span>
						</button>
					))}
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
					{shown.map((board) => (
						<BoardCard
							key={board.id}
							board={board}
							deviceOnly={api.hasServer && !board.vault}
							{...(selecting ? { selection: { selected: selected.has(board.id), onToggle: () => toggle(board.id) } } : {})}
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
							{...(api.hasServer && board.vault === 'server' && !isSharedWithMe(board)
								? { onShare: () => openShareDialog(board) }
								: {})}
							{...(moveOf(board.id) ? { moveJob: moveOf(board.id)! } : {})}
							onRetryMove={() => void retryMove(platform.kv, board.id)}
							onDismissMove={() => void dismissMove(platform.kv, board.id)}
							{...(api.hasServer && !moveOf(board.id) && !isSharedWithMe(board)
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

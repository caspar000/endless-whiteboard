import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isSharedWithMe, type BoardMeta } from '../boards/boardIndex'
import { searchBoards } from '../boards/boardSearch'
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

const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color']

/** Whether a key landed where text is being typed, which a "/" there is part of. */
function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
	return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.includes(target.type)
}

/**
 * The home screen's content pane: a grid of board cards. The sidebar and tab strip around it are
 * the shell's (see App.tsx) — this renders inside the shell's content area.
 */
export function BoardList({
	api,
	onOpen,
	mountedIds,
}: {
	api: BoardsApi
	onOpen: (board: BoardMeta) => void
	/** Boards with a live editor, whose previews the shell draws from that editor (app/App.tsx). */
	mountedIds: readonly string[]
}) {
	const platform = usePlatform()
	const mountedKey = mountedIds.join(' ')
	// Drawing these off screen as well would draw them twice, from an older copy.
	const unmounted = useMemo(() => {
		const live = new Set(mountedKey.split(' '))
		return api.boards.filter((board) => !live.has(board.id))
	}, [api.boards, mountedKey])
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

	// The search narrows the boards by name; the filter's counts are of the boards that match it.
	// Not remembered like the filter: a board made while a search was on would come back hidden.
	const [query, setQuery] = useState('')
	const searching = query.trim() !== ''
	const searchRef = useRef<HTMLInputElement>(null)
	const matches = searchBoards(api.boards, query)
	const localMatches = matches.filter((board) => !board.vault)
	const shown =
		!filtering || where === 'all' ? matches : where === 'device' ? localMatches : matches.filter((board) => board.vault)
	const filters: { value: Where; label: string; count: number }[] = [
		{ value: 'all', label: 'All', count: matches.length },
		{ value: 'server', label: 'On the server', count: matches.length - localMatches.length },
		{ value: 'device', label: 'On this device', count: localMatches.length },
	]
	// "/" goes to the search, as on most sites with one. Only this page is mounted while it shows.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
			if (isTyping(event.target)) return
			const input = searchRef.current
			if (!input) return
			event.preventDefault()
			input.focus()
			input.select()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [])

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
						Select all{searching || (filtering && where !== 'all') ? ' shown' : ''}
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

			{!api.loading && api.boards.length > 0 && (
				<div className="lb-list__tools">
					<div className="lb-list__search" role="search">
						<Search className="lb-list__search-icon" size={16} strokeWidth={1.75} aria-hidden="true" />
						<input
							ref={searchRef}
							type="search"
							placeholder="Search boards"
							aria-label="Search boards"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== 'Escape') return
								// The first Escape clears the search, the next one leaves it; neither ends Select.
								event.stopPropagation()
								if (query) setQuery('')
								else event.currentTarget.blur()
							}}
						/>
						{query && (
							<button
								type="button"
								className="lb-list__search-clear"
								aria-label="Clear search"
								title="Clear search"
								onClick={() => {
									setQuery('')
									searchRef.current?.focus()
								}}
							>
								<X size={14} strokeWidth={2} aria-hidden="true" />
							</button>
						)}
					</div>
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
			) : shown.length === 0 && searching ? (
				<div className="lb-list__empty" role="status">
					<p>No boards match “{query.trim()}”.</p>
					<button className="lb-btn" onClick={() => setQuery('')}>
						Clear search
					</button>
				</div>
			) : (
				<ul className="lb-grid lb-list__boards lb-stagger">
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
			{!api.loading && <ThumbnailBackfill boards={unmounted} />}
		</main>
	)
}

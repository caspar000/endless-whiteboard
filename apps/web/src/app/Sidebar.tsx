import {
	ChevronDown,
	CircleHelp,
	LayoutGrid,
	PanelLeftClose,
	PanelLeftOpen,
	PanelsTopLeft,
	PenLine,
	Plus,
	Settings,
	Star,
	HardDrive,
	LoaderCircle,
	RefreshCw,
	TriangleAlert,
} from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { getMoveBatch } from '../boards/moveQueue'
import { getImportProgress, importDetail, importShare, subscribeToImportProgress } from '../persistence/importProgress'
import { isUpdateReady, reloadToUpdate, subscribeToUpdate } from '../pwa/registerServiceWorker'
import { useMoves } from './useBoards'

const ALL_BOARDS_EXPANDED_KEY = 'lifeboard:sidebar:allBoardsExpanded'

function loadAllBoardsExpanded(): boolean {
	try {
		return localStorage.getItem(ALL_BOARDS_EXPANDED_KEY) !== 'false'
	} catch {
		return true
	}
}

/**
 * The shell's left navigation rail.
 *
 * Favourites are shortcuts to the boards someone returns to most; All boards is the complete,
 * recently-edited catalogue. Keeping those two ideas separate also leaves the catalogue ready to
 * become a folder tree later without changing the board index today.
 */
export function Sidebar({
	view,
	activeBoardId,
	boards,
	collapsed,
	onToggleCollapsed,
	onAllBoards,
	onSettings,
	onHelp,
	onOpenBoard,
	onNewBoard,
}: {
	view: 'list' | 'settings' | 'help' | 'board'
	activeBoardId: string | null
	boards: BoardMeta[]
	collapsed: boolean
	onToggleCollapsed: () => void
	onAllBoards: () => void
	onSettings: () => void
	onHelp: () => void
	onOpenBoard: (board: BoardMeta) => void
	onNewBoard: () => void
}) {
	const favorites = boards.filter((board) => board.favorite)
	// Only worth saying once there are two kinds side by side.
	const mixed = boards.some((board) => board.vault === 'server') && boards.some((board) => !board.vault)
	const [allBoardsExpanded, setAllBoardsExpanded] = useState(loadAllBoardsExpanded)

	const toggleAllBoards = () => {
		setAllBoardsExpanded((expanded) => {
			const next = !expanded
			try {
				localStorage.setItem(ALL_BOARDS_EXPANDED_KEY, String(next))
			} catch {
				// A private-mode storage failure should not make the disclosure unusable.
			}
			return next
		})
	}

	return (
		<aside className={collapsed ? 'lb-sidebar lb-sidebar--collapsed' : 'lb-sidebar'}>
			<div className="lb-sidebar__brand">
				<span className="lb-sidebar__mark" aria-hidden="true">
					<PenLine size={14} />
				</span>
				<span className="lb-sidebar__name">Lifeboard</span>
				<button
					type="button"
					className="lb-sidebar__collapse"
					onClick={onToggleCollapsed}
					aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
					title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					{collapsed ? (
						<PanelLeftOpen size={16} aria-hidden="true" />
					) : (
						<PanelLeftClose size={16} aria-hidden="true" />
					)}
				</button>
			</div>

			<button
				type="button"
				className="lb-sidebar__new"
				onClick={onNewBoard}
				aria-label="New board"
				title={collapsed ? 'New board' : undefined}
			>
				<Plus size={15} aria-hidden="true" />
				<span className="lb-sidebar__label">New board</span>
			</button>

			<div className="lb-sidebar__sections lb-sidebar__nav">
				<nav className="lb-sidebar__section lb-sidebar__favorites" aria-label="Favourites">
					<button
						type="button"
						className="lb-sidebar__favorites-shortcut"
						onClick={onToggleCollapsed}
						aria-label={`Favourites (${favorites.length})`}
						title={`Favourites (${favorites.length})`}
					>
						<Star size={14} fill={favorites.length > 0 ? 'currentColor' : 'none'} aria-hidden="true" />
					</button>
					<div className="lb-sidebar__section-title">Favourites</div>
					{favorites.length === 0 ? (
						<p className="lb-sidebar__empty">Star a board to keep it here.</p>
					) : (
						favorites.map((board) => (
							<BoardLink
								key={board.id}
								board={board}
								active={view === 'board' && board.id === activeBoardId}
								favorite
								collapsed={collapsed}
								onOpen={onOpenBoard}
							/>
						))
					)}
				</nav>

				<section className="lb-sidebar__catalog" aria-label="All boards">
					<div className="lb-sidebar__catalog-header">
						<button
							type="button"
							className={
								view === 'list'
									? 'lb-sidebar__item lb-sidebar__catalog-link lb-sidebar__item--active'
									: 'lb-sidebar__item lb-sidebar__catalog-link'
							}
							onClick={onAllBoards}
							aria-current={view === 'list' ? 'page' : undefined}
							aria-label={`All boards ${boards.length}`}
							title={collapsed ? `All boards (${boards.length})` : undefined}
						>
							<span className="lb-sidebar__icon" aria-hidden="true">
								<LayoutGrid size={15} />
							</span>
							<span className="lb-sidebar__label">All boards</span>
							<span className="lb-sidebar__count">{boards.length}</span>
						</button>
						<button
							type="button"
							className="lb-sidebar__disclosure"
							onClick={toggleAllBoards}
							aria-label={allBoardsExpanded ? 'Collapse All boards' : 'Expand All boards'}
							aria-expanded={allBoardsExpanded}
						>
							<ChevronDown size={14} aria-hidden="true" />
						</button>
					</div>

					{allBoardsExpanded && (
						<nav className="lb-sidebar__board-list" aria-label="Boards">
							{boards.length === 0 ? (
								<p className="lb-sidebar__empty">No boards yet.</p>
							) : (
								boards.map((board) => (
									<BoardLink
										key={board.id}
										board={board}
										active={view === 'board' && board.id === activeBoardId}
										deviceOnly={mixed && !board.vault}
										collapsed={collapsed}
										onOpen={onOpenBoard}
									/>
								))
							)}
						</nav>
					)}
				</section>
			</div>

			<UpdateStatus />
			<ImportStatus />
			<MoveStatus onShow={onAllBoards} />

			<nav className="lb-sidebar__footer" aria-label="Application">
				<button
					type="button"
					className={
						view === 'help' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'
					}
					onClick={onHelp}
					aria-current={view === 'help' ? 'page' : undefined}
					aria-label="Help"
					title={collapsed ? 'Help' : undefined}
				>
					<span className="lb-sidebar__icon" aria-hidden="true">
						<CircleHelp size={15} />
					</span>
					<span className="lb-sidebar__label">Help</span>
				</button>
				<button
					type="button"
					className={
						view === 'settings'
							? 'lb-sidebar__item lb-sidebar__item--active'
							: 'lb-sidebar__item'
					}
					onClick={onSettings}
					aria-current={view === 'settings' ? 'page' : undefined}
					aria-label="Settings"
					title={collapsed ? 'Settings' : undefined}
				>
					<span className="lb-sidebar__icon" aria-hidden="true">
						<Settings size={15} />
					</span>
					<span className="lb-sidebar__label">Settings</span>
				</button>
			</nav>
		</aside>
	)
}

function BoardLink({
	board,
	active,
	favorite = false,
	deviceOnly = false,
	collapsed,
	onOpen,
}: {
	board: BoardMeta
	active: boolean
	favorite?: boolean
	/** A local board shown next to server ones: it exists in this browser and nowhere else. */
	deviceOnly?: boolean
	collapsed: boolean
	onOpen: (board: BoardMeta) => void
}) {
	return (
		<button
			type="button"
			className={active ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'}
			onClick={() => onOpen(board)}
			aria-current={active ? 'page' : undefined}
			aria-label={board.name}
			title={deviceOnly ? `${board.name} — only on this device` : collapsed ? board.name : undefined}
		>
			<span
				className={favorite ? 'lb-sidebar__icon lb-sidebar__icon--star' : 'lb-sidebar__icon'}
				aria-hidden="true"
			>
				{favorite ? (
					<Star size={13} fill="currentColor" />
				) : deviceOnly ? (
					<HardDrive size={14} />
				) : (
					<PanelsTopLeft size={14} />
				)}
			</span>
			<span className="lb-sidebar__label">{board.name}</span>
		</button>
	)
}

/** A new version of the app is waiting; one click moves to it (pwa/registerServiceWorker.ts). */
function UpdateStatus() {
	const ready = useSyncExternalStore(subscribeToUpdate, isUpdateReady)
	if (!ready) return null
	return (
		<button type="button" className="lb-sidebar__moves lb-sidebar__moves--still" onClick={reloadToUpdate}>
			<span className="lb-sidebar__moves-icon" aria-hidden="true">
				<RefreshCw size={16} />
			</span>
			<span className="lb-sidebar__moves-text" role="status" aria-live="polite">
				<span className="lb-sidebar__moves-title">A new version is ready</span>
				<span className="lb-sidebar__moves-detail">Reload to use it</span>
			</span>
		</button>
	)
}

/** A backup being imported, on every screen: the import carries on if you leave Settings. */
function ImportStatus() {
	const progress = useSyncExternalStore(subscribeToImportProgress, getImportProgress)
	if (!progress) return null
	return (
		<div className="lb-sidebar__moves" data-testid="lb.import-status">
			<span className="lb-sidebar__moves-icon" aria-hidden="true">
				<LoaderCircle size={16} />
			</span>
			<span className="lb-sidebar__moves-text" role="status" aria-live="polite">
				<span className="lb-sidebar__moves-title">Importing a backup</span>
				<span className="lb-sidebar__moves-detail">{importDetail(progress)}</span>
				<span className="lb-progress" aria-hidden="true">
					<span className="lb-progress__bar" style={{ width: `${Math.round(importShare(progress) * 100)}%` }} />
				</span>
			</span>
		</div>
	)
}

/**
 * Boards moving between this browser and the server, on every screen: how many of how many, and the
 * one under way. The queue outlives a reload (boards/moveQueue.ts), so this shows again after one.
 * Clicking goes to All boards, where each moving card shows its own progress.
 */
function MoveStatus({ onShow }: { onShow: () => void }) {
	const jobs = useMoves()
	if (!jobs.length) return null
	const { done, total } = getMoveBatch()
	const failed = jobs.filter((job) => job.error).length
	const current = jobs.find((job) => !job.error)
	const where = current?.to === 'device' ? 'to this device' : 'to your server'
	const title = current
		? `Moving ${done + 1} of ${total} ${where}`
		: `${failed} ${failed === 1 ? 'board' : 'boards'} couldn’t move`
	const detail = current
		? current.stage === 'files' && current.filesTotal
			? `${current.board.name} · files ${current.filesDone} of ${current.filesTotal}`
			: current.board.name
		: 'Open All boards to retry'
	return (
		<button
			type="button"
			className={failed && !current ? 'lb-sidebar__moves lb-sidebar__moves--failed' : 'lb-sidebar__moves'}
			onClick={onShow}
			title={`${title}: ${detail}`}
		>
			<span className="lb-sidebar__moves-icon" aria-hidden="true">
				{current ? <LoaderCircle size={16} /> : <TriangleAlert size={16} />}
			</span>
			<span className="lb-sidebar__moves-text" role="status" aria-live="polite">
				<span className="lb-sidebar__moves-title">{title}</span>
				<span className="lb-sidebar__moves-detail">{detail}</span>
				{current && (
					<span className="lb-progress" aria-hidden="true">
						<span
							className="lb-progress__bar"
							style={{ width: `${Math.round(((done + 0.5) / Math.max(total, 1)) * 100)}%` }}
						/>
					</span>
				)}
			</span>
		</button>
	)
}

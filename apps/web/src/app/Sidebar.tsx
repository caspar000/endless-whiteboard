import {
	ChevronDown,
	CircleHelp,
	Clock,
	HardDrive,
	LayoutGrid,
	LoaderCircle,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	RefreshCw,
	Settings,
	Star,
	TriangleAlert,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { getMoveBatch } from '../boards/moveQueue'
import { getImportProgress, importDetail, importShare, subscribeToImportProgress } from '../persistence/importProgress'
import { usePlatform } from '../platform/PlatformContext'
import { isUpdateReady, reloadToUpdate, subscribeToUpdate } from '../pwa/registerServiceWorker'
import { BoardBadgeButton } from './boardLook/BoardBadge'
import { formatBytes } from './settings/StoragePanel'
import { useMoves } from './useBoards'

/** How many recently edited boards the sidebar lists. */
const RECENT_COUNT = 5

type SectionId = 'favourites' | 'recents' | 'allBoards'

/** `allBoards` keeps the key it had before the sections could all fold. */
const SECTION_KEYS: Record<SectionId, string> = {
	favourites: 'lifeboard:sidebar:favouritesExpanded',
	recents: 'lifeboard:sidebar:recentsExpanded',
	allBoards: 'lifeboard:sidebar:allBoardsExpanded',
}

function loadExpanded(id: SectionId): boolean {
	try {
		return localStorage.getItem(SECTION_KEYS[id]) !== 'false'
	} catch {
		return true
	}
}

function useSectionExpanded(id: SectionId): [boolean, (expanded: boolean) => void] {
	const [expanded, setExpanded] = useState(() => loadExpanded(id))
	const update = (next: boolean) => {
		setExpanded(next)
		try {
			localStorage.setItem(SECTION_KEYS[id], String(next))
		} catch {
			// A private-mode storage failure should not make the disclosure unusable.
		}
	}
	return [expanded, update]
}

/** What this browser holds, for the Storage row. Re-read when the number of boards changes. */
function useStorageUsage(boardCount: number): number | null {
	const platform = usePlatform()
	const [usage, setUsage] = useState<number | null>(null)
	useEffect(() => {
		let live = true
		void platform.estimateStorage().then((estimate) => {
			if (live) setUsage(estimate.usage)
		})
		return () => {
			live = false
		}
	}, [platform, boardCount])
	return usage
}

/**
 * The shell's left navigation, floating over the board.
 *
 * The library rows at the top are the ways into the boards: everything, what was edited lately, what
 * is starred, and how much room they take. Below them the same groups are listed board by board, each
 * folding on its own. Collapsed, the panel slides away entirely and a round button takes its place
 * (`SidebarReopen`).
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
	onStorage,
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
	onStorage: () => void
	onOpenBoard: (board: BoardMeta) => void
	onNewBoard: () => void
}) {
	const favorites = boards.filter((board) => board.favorite)
	// Starred boards already have their own section, so the recent list leaves them out.
	const recents = [...boards]
		.filter((board) => !board.favorite)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, RECENT_COUNT)
	// Only worth saying once there are two kinds side by side.
	const mixed = boards.some((board) => board.vault === 'server') && boards.some((board) => !board.vault)
	const usage = useStorageUsage(boards.length)

	const [favouritesOpen, setFavouritesOpen] = useSectionExpanded('favourites')
	const [recentsOpen, setRecentsOpen] = useSectionExpanded('recents')
	const [allBoardsOpen, setAllBoardsOpen] = useSectionExpanded('allBoards')
	const favouritesRef = useRef<HTMLElement>(null)
	const recentsRef = useRef<HTMLElement>(null)

	/** The library's Recents and Favourites rows unfold their section and bring it into view. */
	const reveal = (section: React.RefObject<HTMLElement | null>, open: (expanded: boolean) => void) => {
		open(true)
		requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
	}

	const row = (board: BoardMeta) => (
		<BoardLink
			key={board.id}
			board={board}
			active={view === 'board' && board.id === activeBoardId}
			deviceOnly={mixed && !board.vault}
			onOpen={onOpenBoard}
		/>
	)

	return (
		<aside
			className={collapsed ? 'lb-sidebar lb-float lb-sidebar--collapsed' : 'lb-sidebar lb-float'}
			// Off screen while collapsed, so it must not be reachable with Tab either.
			inert={collapsed}
			aria-label="Boards sidebar"
		>
			<div className="lb-sidebar__brand">
				<span className="lb-sidebar__mark" aria-hidden="true">
					<LayoutGrid size={16} />
				</span>
				<span className="lb-sidebar__name">Lifeboard</span>
				<button
					type="button"
					className="lb-icon-btn lb-sidebar__collapse"
					onClick={onToggleCollapsed}
					aria-label="Collapse sidebar"
					title="Collapse sidebar  ⌘\"
				>
					<PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />
				</button>
			</div>

			<button type="button" className="lb-sidebar__new" onClick={onNewBoard}>
				<Plus size={18} strokeWidth={1.75} aria-hidden="true" />
				New board
			</button>

			<div className="lb-sidebar__sections lb-sidebar__nav">
				<nav className="lb-sidebar__library" aria-label="Library">
					<LibraryRow
						icon={<LayoutGrid size={18} strokeWidth={1.75} />}
						label="All boards"
						count={boards.length}
						active={view === 'list'}
						onClick={onAllBoards}
					/>
					<LibraryRow
						icon={<Clock size={18} strokeWidth={1.75} />}
						label="Recents"
						count={recents.length}
						onClick={() => reveal(recentsRef, setRecentsOpen)}
					/>
					<LibraryRow
						icon={<Star size={18} strokeWidth={1.75} />}
						label="Favourites"
						count={favorites.length}
						onClick={() => reveal(favouritesRef, setFavouritesOpen)}
					/>
					<LibraryRow
						icon={<HardDrive size={18} strokeWidth={1.75} />}
						label="Storage"
						count={usage === null ? '' : formatBytes(usage)}
						onClick={onStorage}
					/>
				</nav>

				<Section
					sectionRef={favouritesRef}
					title="Favourites"
					className="lb-sidebar__favorites"
					expanded={favouritesOpen}
					onToggle={() => setFavouritesOpen(!favouritesOpen)}
				>
					{favorites.length === 0 ? (
						<p className="lb-sidebar__empty">Star a board to keep it here.</p>
					) : (
						favorites.map(row)
					)}
				</Section>

				{recents.length > 0 && (
					<Section
						sectionRef={recentsRef}
						title="Recent boards"
						expanded={recentsOpen}
						onToggle={() => setRecentsOpen(!recentsOpen)}
					>
						{recents.map(row)}
					</Section>
				)}

				<Section
					title="All boards"
					listLabel="Boards"
					expanded={allBoardsOpen}
					onToggle={() => setAllBoardsOpen(!allBoardsOpen)}
				>
					{boards.length === 0 ? <p className="lb-sidebar__empty">No boards yet.</p> : boards.map(row)}
				</Section>
			</div>

			<UpdateStatus />
			<ImportStatus />
			<MoveStatus onShow={onAllBoards} />

			<nav className="lb-sidebar__footer" aria-label="Application">
				<button
					type="button"
					className={view === 'help' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'}
					onClick={onHelp}
					aria-current={view === 'help' ? 'page' : undefined}
				>
					<CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" />
					<span className="lb-sidebar__label">Help</span>
				</button>
				<button
					type="button"
					className={view === 'settings' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'}
					onClick={onSettings}
					aria-current={view === 'settings' ? 'page' : undefined}
				>
					<Settings size={18} strokeWidth={1.75} aria-hidden="true" />
					<span className="lb-sidebar__label">Settings</span>
				</button>
			</nav>
		</aside>
	)
}

/** The round button that stands in for the collapsed sidebar, top left. */
export function SidebarReopen({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
	return (
		<button
			type="button"
			className="lb-sidebar-reopen lb-float"
			onClick={onExpand}
			inert={!collapsed}
			aria-label="Expand sidebar"
			title="Expand sidebar  ⌘\"
		>
			<PanelLeftOpen size={20} strokeWidth={1.75} aria-hidden="true" />
		</button>
	)
}

function LibraryRow({
	icon,
	label,
	count,
	active = false,
	onClick,
}: {
	icon: ReactNode
	label: string
	count: number | string
	active?: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			className={active ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'}
			onClick={onClick}
			aria-current={active ? 'page' : undefined}
			aria-label={count === '' ? label : `${label} ${count}`}
		>
			<span className="lb-sidebar__icon" aria-hidden="true">
				{icon}
			</span>
			<span className="lb-sidebar__label">{label}</span>
			<span className="lb-sidebar__count">{count}</span>
		</button>
	)
}

/** A folding group of board rows, under an uppercase header with a turning chevron. */
function Section({
	title,
	listLabel = title,
	className,
	expanded,
	onToggle,
	sectionRef,
	children,
}: {
	title: string
	/** The list's accessible name, when it should differ from the header. */
	listLabel?: string
	className?: string
	expanded: boolean
	onToggle: () => void
	sectionRef?: React.Ref<HTMLElement>
	children: ReactNode
}) {
	return (
		<section ref={sectionRef} className={className ? `lb-sidebar__section ${className}` : 'lb-sidebar__section'}>
			<button
				type="button"
				className="lb-sidebar__section-title"
				onClick={onToggle}
				aria-expanded={expanded}
				aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
			>
				<ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
				{title}
			</button>
			{expanded && (
				<nav className="lb-sidebar__board-list" aria-label={listLabel}>
					{children}
				</nav>
			)}
		</section>
	)
}

function BoardLink({
	board,
	active,
	deviceOnly = false,
	onOpen,
}: {
	board: BoardMeta
	active: boolean
	/** A local board shown next to server ones: it exists in this browser and nowhere else. */
	deviceOnly?: boolean
	onOpen: (board: BoardMeta) => void
}) {
	// The badge is its own button, laid over the row's first column rather than inside the row: buttons
	// cannot nest, and the rest of the row still opens the board.
	return (
		<div className="lb-sidebar__board">
			<button
				type="button"
				className={active ? 'lb-sidebar__item lb-sidebar__item--board lb-sidebar__item--active' : 'lb-sidebar__item lb-sidebar__item--board'}
				onClick={() => onOpen(board)}
				aria-current={active ? 'page' : undefined}
				aria-label={board.name}
				title={deviceOnly ? `${board.name} — only on this device` : undefined}
			>
				<span aria-hidden="true" />
				<span className="lb-sidebar__label">{board.name}</span>
				{board.favorite ? (
					<Star className="lb-sidebar__star" size={14} fill="currentColor" aria-hidden="true" />
				) : deviceOnly ? (
					<HardDrive className="lb-sidebar__device" size={14} strokeWidth={1.75} aria-hidden="true" />
				) : null}
			</button>
			<BoardBadgeButton board={board} className="lb-sidebar__thumb" />
		</div>
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

import { Check, CloudUpload, Ellipsis, HardDriveDownload, LogOut, PencilLine, Star, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isSharedWithMe, type BoardMeta } from '../boards/boardIndex'
import type { MoveJob } from '../boards/moveQueue'
import { loadBoardThumbnailUrl, onThumbnailSaved, peekBoardThumbnailUrl } from '../persistence/thumbnails'
import { usePlatform } from '../platform/PlatformContext'
import { serverPreviewVersion, serverThumbnailUrl } from '../server/serverVault'
import { useResolvedTheme, type ResolvedTheme } from './useTheme'
import { BoardBadgeButton } from './boardLook/BoardBadge'

/**
 * One board on the home screen: a preview above, a name-and-date footer below — the Freeform card
 * shape. The preview is the board's own thumbnail, drawn after the board was last closed
 * (persistence/thumbnails.ts); boards never opened fall back to the dotted-paper placeholder so the
 * grid still reads as a grid.
 */
export function BoardCard({
	board,
	deviceOnly = false,
	selection,
	onOpen,
	onRename,
	onToggleFavorite,
	onDelete,
	onShare,
	onMove,
	moveLabel,
	moveJob,
	onRetryMove,
	onDismissMove,
	renaming,
	onRenameSubmit,
	onRenameCancel,
}: {
	board: BoardMeta
	/** Kept only in this browser, with a server to put it on: the card says so. */
	deviceOnly?: boolean
	/** Picking boards for one action on them all: a click ticks the card rather than opening it. */
	selection?: { selected: boolean; onToggle: () => void }
	onOpen: () => void
	onRename: () => void
	onToggleFavorite: () => void
	onDelete: () => void
	/** Offered for a server board in this account's vault. */
	onShare?: () => void
	/** Offered only when there is somewhere to move it: a server is connected. */
	onMove?: () => void
	moveLabel?: string
	/** The move this board is in, shown over its preview until it arrives. */
	moveJob?: MoveJob
	onRetryMove?: () => void
	onDismissMove?: () => void
	renaming: boolean
	onRenameSubmit: (name: string) => void
	onRenameCancel: () => void
}) {
	const [confirmDelete, setConfirmDelete] = useState(false)
	// The actions held open from the ⋯, where there is no hover to show them.
	const [actionsOpen, setActionsOpen] = useState(false)
	const card = useRef<HTMLLIElement>(null)
	// A press anywhere off the card, or Escape, puts the confirmation and the held-open actions away.
	useEffect(() => {
		if (!confirmDelete && !actionsOpen) return
		const close = () => {
			setConfirmDelete(false)
			setActionsOpen(false)
		}
		const onPointerDown = (e: PointerEvent) => {
			if (!card.current?.contains(e.target as Node)) close()
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close()
		}
		window.addEventListener('pointerdown', onPointerDown, { capture: true })
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('pointerdown', onPointerDown, { capture: true })
			window.removeEventListener('keydown', onKey)
		}
	}, [confirmDelete, actionsOpen])
	// Shared with this account from another vault: it can leave the list, not be renamed or deleted.
	const shared = isSharedWithMe(board)
	const moving = !!moveJob && !moveJob.error
	const click = selection ? selection.onToggle : onOpen

	return (
		<li
			ref={card}
			className={[
				'lb-card lb-list__board',
				selection?.selected && 'lb-card--selected',
				(actionsOpen || confirmDelete) && 'lb-card--actions-open',
			]
				.filter(Boolean)
				.join(' ')}
		>
			<div className="lb-card__media">
				<button
					className="lb-card__preview lb-list__open"
					onClick={click}
					aria-label={selection ? `Select ${board.name}` : `Open ${board.name}`}
					{...(selection ? { 'aria-pressed': selection.selected } : {})}
					// Not while it moves: its content is between two homes until the move finishes.
					disabled={moving}
				>
					<BoardThumbnail board={board} />
				</button>
				{moveJob && (
					<MoveOverlay job={moveJob} onRetry={onRetryMove} onDismiss={onDismissMove} />
				)}
				{selection && !moving && (
					<span className="lb-card__tick" aria-hidden="true">
						{selection.selected && <Check size={14} strokeWidth={3} />}
					</span>
				)}

				{/*
				 * Overlaid on the thumbnail rather than sitting in the footer, so the name keeps the
				 * footer's whole width. Icons, each named in a tooltip. A touch screen, with no hover to
				 * bring them up, keeps a ⋯ here that opens them; picking one puts them away again.
				 */}
				<div
					className="lb-card__actions lb-list__actions"
					hidden={!!selection}
					onClick={(e) => {
						if (!(e.target as Element).closest('.lb-card__more')) setActionsOpen(false)
					}}
				>
					<CardAction
						tip={board.favorite ? 'Remove from favourites' : 'Add to favourites'}
						label={board.favorite ? `Unfavourite ${board.name}` : `Favourite ${board.name}`}
						className={board.favorite ? 'lb-card__fav lb-card__fav--on' : 'lb-card__fav'}
						pressed={board.favorite === true}
						onClick={onToggleFavorite}
					>
						<Star size={ICON} aria-hidden="true" {...(board.favorite ? { fill: 'currentColor' } : {})} />
					</CardAction>
					{!shared && (
						<CardAction tip="Rename" onClick={onRename}>
							<PencilLine size={ICON} aria-hidden="true" />
						</CardAction>
					)}
					{onShare && (
						<CardAction tip="Share" onClick={onShare}>
							<UserPlus size={ICON} aria-hidden="true" />
						</CardAction>
					)}
					{onMove && moveLabel && (
						<CardAction tip={moveLabel} onClick={onMove}>
							{board.vault === 'server' ? (
								<HardDriveDownload size={ICON} aria-hidden="true" />
							) : (
								<CloudUpload size={ICON} aria-hidden="true" />
							)}
						</CardAction>
					)}
					<CardAction
						tip={shared ? 'Remove' : 'Delete'}
						className="lb-card__delete"
						pressed={confirmDelete}
						onClick={() => setConfirmDelete((was) => !was)}
					>
						{shared ? <LogOut size={ICON} aria-hidden="true" /> : <Trash2 size={ICON} aria-hidden="true" />}
					</CardAction>
					<button
						className="lb-card__action lb-card__more"
						onClick={() => setActionsOpen(true)}
						aria-label={`Actions for ${board.name}`}
						aria-expanded={actionsOpen}
					>
						<Ellipsis size={ICON} aria-hidden="true" />
					</button>
				</div>
				{confirmDelete && !selection && (
					<div className="lb-card__confirm" role="dialog" aria-label={shared ? 'Remove board' : 'Delete board'}>
						<p>{shared ? 'Take it off your list?' : 'Delete this board and all on it?'}</p>
						<div className="lb-card__confirm-actions">
							<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => setConfirmDelete(false)}>
								Cancel
							</button>
							<button
								className="lb-btn lb-btn--danger lb-btn--tiny"
								onClick={() => {
									onDelete()
									setConfirmDelete(false)
								}}
							>
								{shared ? 'Remove from my boards' : 'Delete for good'}
							</button>
						</div>
					</div>
				)}
			</div>

			<div className="lb-card__footer">
				{renaming ? (
					<form
						className="lb-list__rename"
						onSubmit={(e) => {
							e.preventDefault()
							const value = new FormData(e.currentTarget).get('name')
							onRenameSubmit(typeof value === 'string' ? value : board.name)
						}}
					>
						{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
						<input
							autoFocus
							name="name"
							defaultValue={board.name}
							aria-label="Board name"
							onBlur={onRenameCancel}
						/>
					</form>
				) : (
					<>
						<BoardBadgeButton board={board} className="lb-card__badge" />
						<button className="lb-card__title" onClick={click} disabled={!!selection && moving}>
							<span className="lb-list__title">{board.name}</span>
							<span className="lb-card__date lb-list__meta">
								{shared
									? `${board.sharedBy ?? 'Shared'} · ${board.role === 'view' ? 'view only' : 'can edit'}`
									: deviceOnly
										? `${formatEdited(board.updatedAt)} · this device only`
										: formatEdited(board.updatedAt)}
							</span>
						</button>
					</>
				)}
			</div>
		</li>
	)
}

const ICON = 16

/** One of a card's actions: an icon, named in a tooltip and to a screen reader alike. */
function CardAction({
	tip,
	label = tip,
	className,
	pressed,
	onClick,
	children,
}: {
	tip: string
	label?: string
	className?: string
	pressed?: boolean
	onClick: () => void
	children: ReactNode
}) {
	return (
		<button
			className={className ? `lb-card__action lb-tip ${className}` : 'lb-card__action lb-tip'}
			data-tip={tip}
			aria-label={label}
			{...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
			onClick={onClick}
		>
			{children}
		</button>
	)
}

/** How far along each stage of a move is, as a share of the bar. Files fill the stretch in between. */
const STAGE_SHARE = { waiting: 0, starting: 0.05, board: 0.85, finishing: 0.95 } as const

/** Where a moving board has got to, over its preview: a line of words and a bar. */
function MoveOverlay({
	job,
	onRetry,
	onDismiss,
}: {
	job: MoveJob
	onRetry?: () => void
	onDismiss?: () => void
}) {
	const where = job.to === 'server' ? 'to the server' : 'to this device'
	if (job.error) {
		return (
			<div className="lb-card__moving lb-card__moving--failed" role="alert">
				<p>Couldn’t move {where}. {job.error}</p>
				<div className="lb-card__moving-actions">
					<button className="lb-btn lb-btn--tiny" onClick={onRetry}>
						Retry
					</button>
					<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={onDismiss}>
						Dismiss
					</button>
				</div>
			</div>
		)
	}
	const label =
		job.stage === 'waiting'
			? `Waiting to move ${where}`
			: job.stage === 'files' && job.filesTotal > 0
				? `Moving ${where} · files ${job.filesDone} of ${job.filesTotal}`
				: `Moving ${where}…`
	// Files are most of the work; the board and the tidy-up are the last stretch.
	const share =
		job.stage === 'files'
			? job.filesTotal
				? 0.05 + (job.filesDone / job.filesTotal) * 0.75
				: 0.1
			: STAGE_SHARE[job.stage]
	return (
		<div className="lb-card__moving" role="status" aria-live="polite">
			<p>{label}</p>
			<div className="lb-progress" aria-hidden="true">
				<div className="lb-progress__bar" style={{ width: `${Math.round(share * 100)}%` }} />
			</div>
		</div>
	)
}

function BoardThumbnail({ board }: { board: BoardMeta }) {
	const platform = usePlatform()
	const theme = useResolvedTheme()
	// A server board's preview comes from the server, drawn by whichever device last had it open, at the
	// version the board list names. This browser's own copy stands in when there is none, or when it
	// can't be reached and isn't in the browser's cache.
	const version = board.vault === 'server' ? serverPreviewVersion(board, theme) : undefined
	const [unreachable, setUnreachable] = useState<number | null>(null)
	const [local, setLocal] = useState(() => peekBoardThumbnailUrl(board.id, theme))
	// Bumped when this board's thumbnail is rewritten, which forces the load effect to re-run.
	const [revision, setRevision] = useState(0)

	// The capture happens after the board is closed, i.e. *after* this card is already on screen. Without
	// listening, the card would keep showing the previous preview until the next full page load.
	useEffect(() => {
		return onThumbnailSaved((changedId) => {
			if (changedId === board.id) setRevision((r) => r + 1)
		})
	}, [board.id])

	useEffect(() => {
		let cancelled = false
		setLocal(peekBoardThumbnailUrl(board.id, theme))
		void loadBoardThumbnailUrl(platform.kv, board.id, theme, board.updatedAt).then((url) => {
			if (!cancelled) setLocal(url)
		})
		// The other theme's too, so switching theme shows it on the first frame.
		void loadBoardThumbnailUrl(platform.kv, board.id, otherTheme(theme), board.updatedAt)
		return () => {
			cancelled = true
		}
		// `updatedAt` covers edits made in another tab; `revision` covers this tab's own captures.
	}, [platform, board.id, board.updatedAt, revision, theme])

	// A server board's picture in the other theme, fetched into the browser's cache once this one is up,
	// so switching theme doesn't wait for the network.
	const otherVersion = board.vault === 'server' ? serverPreviewVersion(board, otherTheme(theme)) : undefined
	useEffect(() => {
		if (otherVersion === undefined) return
		const timer = setTimeout(() => {
			const image = new Image()
			image.fetchPriority = 'low'
			image.src = serverThumbnailUrl(board.id, otherTheme(theme), otherVersion)
		}, 1_000)
		return () => clearTimeout(timer)
	}, [board.id, theme, otherVersion])

	const url = version !== undefined && unreachable !== version ? serverThumbnailUrl(board.id, theme, version) : local
	if (!url) {
		return (
			<div className="lb-card__placeholder" aria-hidden="true">
				<span>{initials(board.name)}</span>
			</div>
		)
	}
	return (
		<img
			className="lb-card__image"
			src={url}
			alt=""
			draggable={false}
			onError={() => {
				if (version !== undefined) setUnreachable(version)
			}}
		/>
	)
}

const otherTheme = (theme: ResolvedTheme): ResolvedTheme => (theme === 'dark' ? 'light' : 'dark')

function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean)
	if (words.length === 0) return '·'
	return words
		.slice(0, 2)
		.map((w) => w[0]!.toUpperCase())
		.join('')
}

function formatEdited(ts: number): string {
	const now = new Date()
	const then = new Date(ts)
	const sameDay = now.toDateString() === then.toDateString()
	const time = then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

	if (sameDay) return `Today, ${time}`

	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	if (yesterday.toDateString() === then.toDateString()) return `Yesterday, ${time}`

	// Within the last week, the weekday is more readable than a date.
	if (now.getTime() - ts < 6 * 86_400_000) {
		return `${then.toLocaleDateString('en-GB', { weekday: 'long' })} ${time}`
	}

	return then.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isSharedWithMe, type BoardMeta } from '../boards/boardIndex'
import type { MoveJob } from '../boards/moveQueue'
import { loadBoardThumbnail, onThumbnailSaved } from '../persistence/thumbnails'
import { usePlatform } from '../platform/PlatformContext'
import { fetchServerThumbnail } from '../server/serverVault'
import { useResolvedTheme } from './useTheme'

/**
 * One board on the home screen: a preview above, a name-and-date footer below — the Freeform card
 * shape. The preview is the board's own thumbnail, captured when the board was last closed
 * (persistence/thumbnails.ts); boards never opened fall back to the dotted-paper placeholder so the
 * grid still reads as a grid.
 */
export function BoardCard({
	board,
	deviceOnly = false,
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
	// Shared with this account from another vault: it can leave the list, not be renamed or deleted.
	const shared = isSharedWithMe(board)

	return (
		<li className="lb-card lb-list__board">
			<div className="lb-card__media">
				<button
					className="lb-card__preview lb-list__open"
					onClick={onOpen}
					aria-label={`Open ${board.name}`}
					// Not while it moves: its content is between two homes until the move finishes.
					disabled={!!moveJob && !moveJob.error}
				>
					<BoardThumbnail
						boardId={board.id}
						updatedAt={board.updatedAt}
						name={board.name}
						fromServer={board.vault === 'server'}
					/>
				</button>
				{moveJob && (
					<MoveOverlay job={moveJob} onRetry={onRetryMove} onDismiss={onDismissMove} />
				)}

				{/*
				 * Overlaid on the thumbnail rather than sitting in the footer. In the footer these
				 * buttons reserved layout width even while hidden, which truncated the board name to
				 * "Home office s…" on a card with plenty of room.
				 */}
				<div className="lb-card__actions lb-list__actions">
					<button
						className={board.favorite ? 'lb-card__fav lb-card__fav--on' : 'lb-card__fav'}
						onClick={onToggleFavorite}
						title={board.favorite ? 'Remove from favourites' : 'Add to favourites'}
						aria-label={board.favorite ? `Unfavourite ${board.name}` : `Favourite ${board.name}`}
						aria-pressed={board.favorite === true}
					>
						<Star
							size={14}
							aria-hidden="true"
							{...(board.favorite ? { fill: 'currentColor' } : {})}
						/>
					</button>

					{confirmDelete ? (
						<>
							<button
								className="lb-btn lb-btn--danger lb-btn--tiny"
								onClick={() => {
									onDelete()
									setConfirmDelete(false)
								}}
							>
								{shared ? 'Remove from my boards' : 'Delete for good'}
							</button>
							<button
								className="lb-btn lb-btn--ghost lb-btn--tiny"
								onClick={() => setConfirmDelete(false)}
							>
								Cancel
							</button>
						</>
					) : (
						<>
							{!shared && (
								<button className="lb-btn lb-btn--tiny" onClick={onRename}>
									Rename
								</button>
							)}
							{onShare && (
								<button className="lb-btn lb-btn--tiny" onClick={onShare}>
									Share
								</button>
							)}
							{onMove && (
								<button className="lb-btn lb-btn--tiny" onClick={onMove}>
									{moveLabel}
								</button>
							)}
							<button className="lb-btn lb-btn--tiny" onClick={() => setConfirmDelete(true)}>
								{shared ? 'Remove' : 'Delete'}
							</button>
						</>
					)}
				</div>
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
					<button className="lb-card__title" onClick={onOpen}>
						<span className="lb-list__title">{board.name}</span>
						<span className="lb-card__date lb-list__meta">
							{shared
								? `${board.sharedBy ?? 'Shared'} · ${board.role === 'view' ? 'view only' : 'can edit'}`
								: deviceOnly
									? `${formatEdited(board.updatedAt)} · this device only`
									: formatEdited(board.updatedAt)}
						</span>
					</button>
				)}
			</div>
		</li>
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

function BoardThumbnail({
	boardId,
	updatedAt,
	name,
	fromServer,
}: {
	boardId: string
	updatedAt: number
	name: string
	/** A server board: its preview comes from the server, drawn by whichever device last had it open. */
	fromServer: boolean
}) {
	const platform = usePlatform()
	const theme = useResolvedTheme()
	const [url, setUrl] = useState<string | null>(null)
	// Bumped when this board's thumbnail is rewritten, which forces the load effect to re-run.
	const [revision, setRevision] = useState(0)

	// The capture happens as a board unmounts, i.e. *after* this card is already on screen. Without
	// listening, the card would keep showing the previous preview until the next full page load.
	useEffect(() => {
		return onThumbnailSaved((changedId) => {
			if (changedId === boardId) setRevision((r) => r + 1)
		})
	}, [boardId])

	useEffect(() => {
		let objectUrl: string | null = null
		let cancelled = false

		const load = async () =>
			(fromServer ? (await fetchServerThumbnail(boardId, theme))?.blob : undefined) ??
			(await loadBoardThumbnail(platform.kv, boardId, theme))
		void load().then((blob) => {
			if (cancelled) return
			if (!blob) {
				setUrl(null)
				return
			}
			objectUrl = URL.createObjectURL(blob)
			setUrl(objectUrl)
		})

		return () => {
			cancelled = true
			// Revoked on unmount: the grid can hold dozens of these, and leaking one object URL per
			// card per visit would hold every thumbnail's bytes in memory for the session.
			if (objectUrl) URL.revokeObjectURL(objectUrl)
		}
		// `updatedAt` covers edits made in another tab; `revision` covers this tab's own captures.
	}, [platform, boardId, updatedAt, revision, fromServer, theme])

	if (!url) {
		return (
			<div className="lb-card__placeholder" aria-hidden="true">
				<span>{initials(name)}</span>
			</div>
		)
	}
	return <img className="lb-card__image" src={url} alt="" draggable={false} />
}

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

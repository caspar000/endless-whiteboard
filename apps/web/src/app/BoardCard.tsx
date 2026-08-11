import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import { loadBoardThumbnail, onThumbnailSaved } from '../persistence/thumbnails'
import { usePlatform } from '../platform/PlatformContext'

/**
 * One board on the home screen: a preview above, a name-and-date footer below — the Freeform card
 * shape. The preview is the board's own thumbnail, captured when the board was last closed
 * (persistence/thumbnails.ts); boards never opened fall back to the dotted-paper placeholder so the
 * grid still reads as a grid.
 */
export function BoardCard({
	board,
	onOpen,
	onRename,
	onToggleFavorite,
	onDelete,
	renaming,
	onRenameSubmit,
	onRenameCancel,
}: {
	board: BoardMeta
	onOpen: () => void
	onRename: () => void
	onToggleFavorite: () => void
	onDelete: () => void
	renaming: boolean
	onRenameSubmit: (name: string) => void
	onRenameCancel: () => void
}) {
	const [confirmDelete, setConfirmDelete] = useState(false)

	return (
		<li className="lb-card lb-list__board">
			<div className="lb-card__media">
				<button
					className="lb-card__preview lb-list__open"
					onClick={onOpen}
					aria-label={`Open ${board.name}`}
				>
					<BoardThumbnail boardId={board.id} updatedAt={board.updatedAt} name={board.name} />
				</button>

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
								Delete for good
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
							<button className="lb-btn lb-btn--tiny" onClick={onRename}>
								Rename
							</button>
							<button className="lb-btn lb-btn--tiny" onClick={() => setConfirmDelete(true)}>
								Delete
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
						<span className="lb-card__date lb-list__meta">{formatEdited(board.updatedAt)}</span>
					</button>
				)}
			</div>
		</li>
	)
}

function BoardThumbnail({
	boardId,
	updatedAt,
	name,
}: {
	boardId: string
	updatedAt: number
	name: string
}) {
	const platform = usePlatform()
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

		void loadBoardThumbnail(platform.kv, boardId).then((blob) => {
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
	}, [platform, boardId, updatedAt, revision])

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

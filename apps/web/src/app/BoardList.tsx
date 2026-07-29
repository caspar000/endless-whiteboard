import { useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import type { BoardsApi } from './useBoards'
import { SettingsPanel } from './SettingsPanel'

function relativeDate(ts: number): string {
	const days = Math.floor((Date.now() - ts) / 86_400_000)
	if (days <= 0) return 'today'
	if (days === 1) return 'yesterday'
	if (days < 30) return `${days} days ago`
	const months = Math.floor(days / 30)
	return months === 1 ? 'last month' : `${months} months ago`
}

export function BoardList({
	api,
	onOpen,
}: {
	api: BoardsApi
	onOpen: (board: BoardMeta) => void
}) {
	const [renaming, setRenaming] = useState<string | null>(null)
	const [draftName, setDraftName] = useState('')
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

	return (
		<div className="lb-list">
			<header className="lb-list__header">
				<h1>Lifeboard</h1>
				<button
					className="lb-btn lb-btn--primary"
					onClick={async () => {
						const board = await api.create()
						onOpen(board)
					}}
				>
					New board
				</button>
			</header>

			{api.loading ? (
				<p className="lb-list__empty">Loading…</p>
			) : api.boards.length === 0 ? (
				<div className="lb-list__empty">
					<p>No boards yet.</p>
					<p className="lb-list__hint">
						Create one and drop in item nodes with prices, then add a rollup to total them up.
					</p>
				</div>
			) : (
				<ul className="lb-list__boards">
					{api.boards.map((board) => (
						<li key={board.id} className="lb-list__board">
							{renaming === board.id ? (
								<form
									className="lb-list__rename"
									onSubmit={async (e) => {
										e.preventDefault()
										const name = draftName.trim()
										if (name) await api.rename(board.id, name)
										setRenaming(null)
									}}
								>
									{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
									<input
										autoFocus
										value={draftName}
										aria-label="Board name"
										onChange={(e) => setDraftName(e.currentTarget.value)}
										onBlur={() => setRenaming(null)}
									/>
								</form>
							) : (
								<button className="lb-list__open" onClick={() => onOpen(board)}>
									<span className="lb-list__title">{board.name}</span>
									<span className="lb-list__meta">edited {relativeDate(board.updatedAt)}</span>
								</button>
							)}

							<div className="lb-list__actions">
								<button
									className="lb-btn lb-btn--ghost"
									onClick={() => {
										setRenaming(board.id)
										setDraftName(board.name)
									}}
								>
									Rename
								</button>
								{confirmDelete === board.id ? (
									<>
										<button
											className="lb-btn lb-btn--danger"
											onClick={async () => {
												await api.remove(board.id)
												setConfirmDelete(null)
											}}
										>
											Delete for good
										</button>
										<button className="lb-btn lb-btn--ghost" onClick={() => setConfirmDelete(null)}>
											Cancel
										</button>
									</>
								) : (
									<button className="lb-btn lb-btn--ghost" onClick={() => setConfirmDelete(board.id)}>
										Delete
									</button>
								)}
							</div>
						</li>
					))}
				</ul>
			)}

			<SettingsPanel api={api} />
		</div>
	)
}

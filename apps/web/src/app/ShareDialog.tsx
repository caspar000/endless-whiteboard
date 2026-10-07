import { Check, Copy, Eye, Pencil, X } from 'lucide-react'
import { atom, useValue } from '@lifeboard/canvas'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import {
	createShare,
	getShares,
	removeBoardAccess,
	revokeShare,
	shareUrl,
	type ShareLink,
	type ShareRole,
	type SharedPerson,
} from '../server/accounts'

const ROLE_LABEL: Record<ShareRole, string> = { view: 'Can view', edit: 'Can edit' }

/** The board whose sharing is open, from its card or from ⌘K. One dialog for the whole app. */
const sharing = atom<BoardMeta | null>('lifeboard:sharing', null)

export const openShareDialog = (board: BoardMeta) => sharing.set(board)

/** Mounted once by App: shows the dialog while a board's sharing is open. */
export function ShareDialogHost() {
	const board = useValue('lifeboard:sharing', () => sharing.get(), [])
	return board ? <ShareDialog key={board.id} board={board} onClose={() => sharing.set(null)} /> : null
}

/**
 * Sharing one server board outside its vault (phase 4): links that give a board to whoever opens them
 * while logged in on this server, to view or to edit, and the people who have it through them.
 * Everyone in the board's own vault always has it; this is for everyone else.
 */
export function ShareDialog({ board, onClose }: { board: BoardMeta; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null)
	const [links, setLinks] = useState<ShareLink[] | null>(null)
	const [people, setPeople] = useState<SharedPerson[]>([])
	const [error, setError] = useState<string | null>(null)
	const [copied, setCopied] = useState<string | null>(null)

	const load = useCallback(async () => {
		try {
			const shares = await getShares(board.id)
			setLinks(shares.links)
			setPeople(shares.people)
			setError(null)
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}, [board.id])

	useEffect(() => {
		dialog.current?.showModal()
		void load()
	}, [load])

	const act = (run: () => Promise<unknown>) => async () => {
		try {
			await run()
			await load()
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure))
		}
	}

	const copy = async (link: ShareLink) => {
		await navigator.clipboard.writeText(shareUrl(link.token))
		setCopied(link.id)
		setTimeout(() => setCopied((current) => (current === link.id ? null : current)), 1500)
	}

	const newLink = (role: ShareRole) =>
		act(async () => {
			const link = await createShare(board.id, role)
			await copy(link)
		})

	return (
		<dialog ref={dialog} className="lb-dialog" onClose={onClose} aria-labelledby="lb-share-title" data-testid="lb.share-dialog">
			<header className="lb-dialog__header">
				<h2 id="lb-share-title">Share “{board.name}”</h2>
				<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => dialog.current?.close()} aria-label="Close">
					<X size={14} />
				</button>
			</header>
			<p className="lb-dialog__hint">
				Everyone in your vault already has this board. A link gives it to someone else with an account on
				this server: they open it while logged in, and it joins their boards. Withdraw the link and it
				leaves them again.
			</p>

			<div className="lb-dialog__actions">
				<button className="lb-btn" onClick={newLink('view')}>
					<Eye size={14} /> New view-only link
				</button>
				<button className="lb-btn" onClick={newLink('edit')}>
					<Pencil size={14} /> New edit link
				</button>
			</div>

			{error && <p className="lb-settings__warn">{error}</p>}

			<h3>Links</h3>
			{links === null ? (
				<p className="lb-dialog__hint">Loading…</p>
			) : links.length === 0 ? (
				<p className="lb-dialog__hint">No links yet.</p>
			) : (
				<ul className="lb-dialog__list">
					{links.map((link) => (
						<li key={link.id}>
							<span>{ROLE_LABEL[link.role]}</span>
							<span className="lb-dialog__meta">made {new Date(link.createdAt).toLocaleDateString()}</span>
							<button className="lb-btn lb-btn--tiny" onClick={() => void copy(link)}>
								{copied === link.id ? <Check size={13} /> : <Copy size={13} />} {copied === link.id ? 'Copied' : 'Copy link'}
							</button>
							<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={act(() => revokeShare(link.id))}>
								Withdraw
							</button>
						</li>
					))}
				</ul>
			)}

			<h3>People</h3>
			{people.length === 0 ? (
				<p className="lb-dialog__hint">Nobody outside your vault has opened a link yet.</p>
			) : (
				<ul className="lb-dialog__list">
					{people.map((person) => (
						<li key={person.id}>
							<span>
								{person.displayName} <span className="lb-dialog__meta">@{person.username}</span>
							</span>
							<span className="lb-dialog__meta">{ROLE_LABEL[person.role]}</span>
							<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={act(() => removeBoardAccess(board.id, person.id))}>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
		</dialog>
	)
}

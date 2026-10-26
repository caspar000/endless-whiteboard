import { ChevronDown, LayoutGrid, Pencil, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isSharedWithMe, type BoardMeta } from '../boards/boardIndex'
import { BoardBadge, BoardBadgeButton } from './boardLook/BoardBadge'
import { useStaggerIn } from './useStaggerIn'

/**
 * The open boards on a phone, where a row of tabs does not fit (docs/mobile-plan.md): one pill between
 * the menu and the AI button, showing the board you are on. Tapping it lists the open boards, each to
 * switch to, rename or close, then a new board and the way to all of them — the jobs of the tab strip
 * and its "+" (and the tab's double-click rename), in a list where every name has the width to be read.
 * Shown on every screen, like the tab strip; off a board it reads "All boards" on the home screen and
 * "Boards" elsewhere.
 */
export function BoardPill({
	boards,
	tabs,
	home,
	activeBoardId,
	onSelect,
	onClose,
	onNew,
	onAllBoards,
	onRename,
}: {
	boards: readonly BoardMeta[]
	tabs: readonly string[]
	/** On the home screen, where All boards is the page you are on. */
	home: boolean
	activeBoardId: string | null
	onSelect: (board: BoardMeta) => void
	onClose: (id: string) => void
	onNew: () => void
	onAllBoards: () => void
	onRename: (id: string, name: string) => void
}) {
	const [open, setOpen] = useState(false)
	const [renaming, setRenaming] = useState<string | null>(null)
	const root = useRef<HTMLDivElement>(null)
	const stagger = useStaggerIn(open)
	const byId = new Map(boards.map((board) => [board.id, board]))
	const openBoards = tabs.flatMap((id) => byId.get(id) ?? [])
	const active = activeBoardId ? byId.get(activeBoardId) : undefined

	// A press anywhere else puts the list away, like a menu, and so does Escape. On the document, not the
	// list: closing a board removes the row that had focus, and with it the list's own key events.
	useEffect(() => {
		if (!open) return
		const onPointerDown = (e: PointerEvent) => {
			if (!root.current?.contains(e.target as Node)) setOpen(false)
		}
		const onKeyDown = (e: KeyboardEvent) => {
			// Escape in the name box gives the name up, not the whole list.
			if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setOpen(false)
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [open])

	const pick = (run: () => void) => () => {
		setOpen(false)
		run()
	}

	return (
		<div ref={root} className="lb-pill">
			<button
				type="button"
				className="lb-pill__current lb-float"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={active ? `${active.name}, switch board` : 'Switch board'}
				onClick={() => setOpen((was) => !was)}
			>
				{active && <BoardBadge board={active} className="lb-pill__badge" />}
				<span className="lb-pill__name">{active?.name ?? (home ? 'All boards' : 'Boards')}</span>
				<ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
			</button>

			{open && (
				<div className="lb-pill__menu lb-float" role="menu" aria-label="Open boards">
					<div className={`lb-pill__list ${stagger}`}>
						{openBoards.map((board) => (
							<div
								key={board.id}
								className={board.id === activeBoardId ? 'lb-pill__row lb-pill__row--active' : 'lb-pill__row'}
							>
								<BoardBadgeButton board={board} className="lb-pill__badge" />
								{renaming === board.id ? (
									<form
										className="lb-pill__rename"
										onSubmit={(e) => {
											e.preventDefault()
											const value = new FormData(e.currentTarget).get('name')
											if (typeof value === 'string' && value.trim() && value.trim() !== board.name) {
												onRename(board.id, value.trim())
											}
											setRenaming(null)
										}}
									>
										{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
										<input
											autoFocus
											name="name"
											defaultValue={board.name}
											aria-label="Board name"
											enterKeyHint="done"
											onBlur={(e) => e.currentTarget.form?.requestSubmit()}
											onKeyDown={(e) => {
												if (e.key === 'Escape') setRenaming(null)
												// Otherwise the canvas would read these as tool shortcuts.
												e.stopPropagation()
											}}
										/>
									</form>
								) : (
									<button
										type="button"
										role="menuitem"
										className="lb-pill__open"
										aria-current={board.id === activeBoardId ? 'page' : undefined}
										onClick={pick(() => onSelect(board))}
									>
										{board.name}
									</button>
								)}
								{!isSharedWithMe(board) && renaming !== board.id && (
									<button
										type="button"
										className="lb-icon-btn lb-pill__close"
										aria-label={`Rename ${board.name}`}
										onClick={() => setRenaming(board.id)}
									>
										<Pencil size={15} strokeWidth={1.75} aria-hidden="true" />
									</button>
								)}
								<button
									type="button"
									className="lb-icon-btn lb-pill__close"
									aria-label={`Close ${board.name}`}
									onClick={() => onClose(board.id)}
								>
									<X size={16} strokeWidth={1.75} aria-hidden="true" />
								</button>
							</div>
						))}
					</div>
					<div className="lb-pill__actions">
						<button type="button" role="menuitem" className="lb-pill__action" onClick={pick(onNew)}>
							<Plus size={18} strokeWidth={1.75} aria-hidden="true" />
							New board
						</button>
						<button type="button" role="menuitem" className="lb-pill__action" onClick={pick(onAllBoards)}>
							<LayoutGrid size={18} strokeWidth={1.75} aria-hidden="true" />
							All boards
						</button>
					</div>
				</div>
			)}
		</div>
	)
}

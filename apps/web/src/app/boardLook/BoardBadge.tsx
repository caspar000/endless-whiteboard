import type { KeyboardEvent, MouseEvent } from 'react'
import { isSharedWithMe, type BoardMeta } from '../../boards/boardIndex'
import { boardTint } from '../boardTint'
import { boardIcon } from './boardIcons'
import { openBoardLook } from './BoardLookPicker'

/** The ink for an icon on the gradient picked from the id, which is always pale. */
const PALE_INK = 'rgb(20 22 40 / 72%)'

/** Dark ink on a light colour, white on a dark one, by perceived brightness. */
export function inkOn(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16)
	const brightness = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
	return brightness > 0.62 ? PALE_INK : '#fff'
}

/**
 * A board's colour and icon: the small square on its tab, its sidebar row and its card. A board with
 * no colour of its own wears the gradient picked from its id, as before there was a choice.
 */
export function BoardBadge({
	board,
	className,
}: {
	board: Pick<BoardMeta, 'id' | 'color' | 'icon'>
	className: string
}) {
	const icon = boardIcon(board.icon)
	return (
		<span
			className={`lb-badge ${className}`}
			style={{
				background: board.color ?? boardTint(board.id),
				color: board.color ? inkOn(board.color) : PALE_INK,
			}}
			aria-hidden="true"
		>
			{icon && <icon.Icon strokeWidth={2.25} />}
		</span>
	)
}

/**
 * The badge as the way to change it. Clicks and keys stop here, so the tab, row or card around it does
 * not also open the board. A board shared from another vault is that vault's to dress, like its name.
 */
export function BoardBadgeButton({ board, className }: { board: BoardMeta; className: string }) {
	if (isSharedWithMe(board)) return <BoardBadge board={board} className={className} />
	const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()
	return (
		<button
			type="button"
			className="lb-badge-button"
			aria-label={`Colour and icon of ${board.name}`}
			title="Colour and icon"
			aria-haspopup="dialog"
			onClick={(e) => {
				e.stopPropagation()
				openBoardLook(board.id, e.currentTarget)
			}}
			onDoubleClick={stop}
			onAuxClick={stop}
			onKeyDown={stop}
		>
			<BoardBadge board={board} className={className} />
		</button>
	)
}

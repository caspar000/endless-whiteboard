import type { KeyboardEvent, MouseEvent } from 'react'
import { isSharedWithMe, type BoardMeta } from '../../boards/boardIndex'
import { boardGradient, boardTint } from '../boardTint'
import { iconName, useBoardIcons, type BoardIcon } from './boardIcons'
import { openBoardLook } from './BoardLookPicker'

/** The ink for an icon on a pale colour, which every default and every swatch is. */
const PALE_INK = 'rgb(20 22 40 / 72%)'

/** Dark ink on a light colour, white on a dark one, by perceived brightness. */
export function inkOn(hex: string): string {
	const n = Number.parseInt(hex.slice(1), 16)
	const brightness = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
	return brightness > 0.62 ? PALE_INK : '#fff'
}

/** One catalogue icon, drawn the way Tabler draws it: 24 units, a 2-unit round stroke. */
export function BoardIconSvg({ icon, size, strokeWidth = 2 }: { icon: BoardIcon; size?: number; strokeWidth?: number }) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{icon.paths.map((path, i) =>
				typeof path === 'string' ? <path key={i} d={path} /> : <path key={i} d={path[0]} {...path[1]} />
			)}
		</svg>
	)
}

/**
 * A board's colour and icon: the small square on its tab, its sidebar row and its card. A board with
 * no colour of its own wears the gradient picked from its id, as before there was a choice. The icons
 * load on first use, so for a moment the square can show only its colour.
 */
export function BoardBadge({
	board,
	className,
}: {
	board: Pick<BoardMeta, 'id' | 'color' | 'icon'>
	className: string
}) {
	const icons = useBoardIcons(!!board.icon)
	const icon = icons?.byName.get(iconName(board.icon) ?? '')
	return (
		<span
			className={`lb-badge ${className}`}
			style={{
				background: board.color ? boardGradient(board.color) : boardTint(board.id),
				color: board.color ? inkOn(board.color) : PALE_INK,
			}}
			aria-hidden="true"
		>
			{icon && <BoardIconSvg icon={icon} strokeWidth={2.25} />}
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

import { atom, useValue } from '@lifeboard/canvas'
import { Ban, Pipette } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BoardLookPatch, BoardMeta } from '../../boards/boardIndex'
import { boardTint } from '../boardTint'
import { BoardBadge, inkOn } from './BoardBadge'
import { BOARD_ICON_GROUPS, searchBoardIcons, type BoardIcon } from './boardIcons'

/** The common colours, one per hue family plus a neutral. Radix's step 9s, which hold up in both themes. */
export const BOARD_SWATCHES: readonly { name: string; color: string }[] = [
	{ name: 'Red', color: '#e5484d' },
	{ name: 'Orange', color: '#f76b15' },
	{ name: 'Amber', color: '#ffc53d' },
	{ name: 'Green', color: '#30a46c' },
	{ name: 'Teal', color: '#12a594' },
	{ name: 'Cyan', color: '#00a2c7' },
	{ name: 'Blue', color: '#0090ff' },
	{ name: 'Indigo', color: '#3e63dd' },
	{ name: 'Violet', color: '#8e4ec6' },
	{ name: 'Pink', color: '#d6409f' },
	{ name: 'Brown', color: '#a18072' },
	{ name: 'Grey', color: '#8b8d98' },
]

/** How long a dragged custom colour has to rest before it is saved, so a drag is one write, not fifty. */
const CUSTOM_COLOR_SETTLE_MS = 300

/** Whose look is being changed, and the badge it was opened from. One picker for the whole app. */
const picking = atom<{ boardId: string; anchor: HTMLElement } | null>('lifeboard:board-look', null)

/** Opens the picker by `anchor`, or closes it if it is already open there: the badge is a toggle. */
export const openBoardLook = (boardId: string, anchor: HTMLElement) =>
	picking.set(picking.get()?.anchor === anchor ? null : { boardId, anchor })

/**
 * Mounted once by App. Reads the board from the live list, so what the picker shows is what was last
 * saved, wherever it was saved from.
 */
export function BoardLookHost({
	boards,
	onChange,
}: {
	boards: readonly BoardMeta[]
	onChange: (id: string, patch: BoardLookPatch) => Promise<void>
}) {
	const open = useValue('lifeboard:board-look', () => picking.get(), [])
	const close = useCallback(() => {
		const anchor = picking.get()?.anchor
		picking.set(null)
		if (anchor?.isConnected) anchor.focus()
	}, [])
	const board = open && boards.find((b) => b.id === open.boardId)
	if (!open || !board) return null
	return (
		<BoardLookPicker
			key={board.id}
			board={board}
			anchor={open.anchor}
			onChange={(patch) => onChange(board.id, patch)}
			onClose={close}
		/>
	)
}

/** A board's colour and icon: search, a grid of icons, then the colours. Every pick is saved at once. */
function BoardLookPicker({
	board,
	anchor,
	onChange,
	onClose,
}: {
	board: BoardMeta
	anchor: HTMLElement
	onChange: (patch: BoardLookPatch) => Promise<void>
	onClose: () => void
}) {
	const panel = useRef<HTMLDivElement>(null)
	const [query, setQuery] = useState('')
	const [customColor, setCustomColor] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const icons = useMemo(() => searchBoardIcons(query), [query])
	const shownColor = customColor ?? board.color
	const custom = !!shownColor && !BOARD_SWATCHES.some((s) => s.color === shownColor)

	const save = (patch: BoardLookPatch) => {
		setError(null)
		onChange(patch).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
	}

	// Next to the badge it came from, below it if it fits and above it if not, and never off screen.
	useLayoutEffect(() => {
		const el = panel.current
		if (!el) return
		const place = () => {
			const at = anchor.getBoundingClientRect()
			const { width, height } = el.getBoundingClientRect()
			const margin = 8
			const below = at.bottom + margin
			const top = below + height <= innerHeight - margin ? below : Math.max(margin, at.top - margin - height)
			const left = Math.min(Math.max(margin, at.left), innerWidth - width - margin)
			el.style.top = `${top}px`
			el.style.left = `${left}px`
		}
		place()
		addEventListener('resize', place)
		return () => removeEventListener('resize', place)
	}, [anchor])

	// A press anywhere else puts it away, like a menu. Not one on the badge it came from: that click
	// arrives next and closes it (`openBoardLook`), where closing here first would have it reopen.
	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node
			if (!panel.current?.contains(target) && !anchor.contains(target)) onClose()
		}
		document.addEventListener('pointerdown', onPointerDown, true)
		return () => document.removeEventListener('pointerdown', onPointerDown, true)
	}, [anchor, onClose])

	useEffect(() => {
		if (customColor === null || customColor === board.color) return
		const timer = setTimeout(() => save({ color: customColor }), CUSTOM_COLOR_SETTLE_MS)
		return () => clearTimeout(timer)
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `save` is new each render; the colour is what matters
	}, [customColor, board.color])

	const iconButton = (icon: BoardIcon) => (
		<button
			key={icon.name}
			type="button"
			className="lb-look__icon"
			aria-label={icon.name.replace(/-/g, ' ')}
			title={icon.name.replace(/-/g, ' ')}
			aria-pressed={board.icon === icon.name}
			onClick={() => save({ icon: icon.name })}
		>
			<icon.Icon size={20} strokeWidth={1.75} aria-hidden="true" />
		</button>
	)

	return (
		<div
			ref={panel}
			className="lb-look lb-float"
			role="dialog"
			aria-label={`Colour and icon of ${board.name}`}
			// Keys typed here are the picker's: the board underneath would read them as tool shortcuts.
			onKeyDown={(e) => {
				e.stopPropagation()
				if (e.key === 'Escape') onClose()
			}}
		>
			<div className="lb-look__head">
				<BoardBadge board={{ ...board, color: shownColor }} className="lb-look__preview" />
				{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
				<input
					autoFocus
					className="lb-look__search"
					type="search"
					placeholder="Search icons"
					aria-label="Search icons"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			</div>

			<div className="lb-look__icons" role="group" aria-label="Icons">
				{query ? (
					icons.length ? (
						<div className="lb-look__grid">{icons.map(iconButton)}</div>
					) : (
						<p className="lb-look__empty">No icons match “{query}”.</p>
					)
				) : (
					<>
						<div className="lb-look__grid">
							<button
								type="button"
								className="lb-look__icon"
								aria-label="No icon"
								title="No icon"
								aria-pressed={!board.icon}
								onClick={() => save({ icon: null })}
							>
								<Ban size={20} strokeWidth={1.75} aria-hidden="true" />
							</button>
						</div>
						{BOARD_ICON_GROUPS.map((group) => (
							<section key={group} className="lb-look__group">
								<h3 className="lb-look__group-title">{group}</h3>
								<div className="lb-look__grid">{icons.filter((icon) => icon.group === group).map(iconButton)}</div>
							</section>
						))}
					</>
				)}
			</div>

			<div className="lb-look__swatches" role="group" aria-label="Colour">
				<button
					type="button"
					className="lb-look__swatch"
					style={{ background: boardTint(board.id) }}
					aria-label="Default colour"
					title="Default"
					aria-pressed={!shownColor}
					onClick={() => {
						setCustomColor(null)
						save({ color: null })
					}}
				/>
				{BOARD_SWATCHES.map(({ name, color }) => (
					<button
						key={color}
						type="button"
						className="lb-look__swatch"
						style={{ background: color }}
						aria-label={name}
						title={name}
						aria-pressed={shownColor === color}
						onClick={() => {
							setCustomColor(null)
							save({ color })
						}}
					/>
				))}
				<label
					className="lb-look__swatch lb-look__swatch--custom"
					title="Custom colour"
					data-selected={custom || undefined}
					style={custom && shownColor ? { background: shownColor, color: inkOn(shownColor) } : undefined}
				>
					<Pipette size={14} strokeWidth={2} aria-hidden="true" />
					<input
						type="color"
						aria-label="Custom colour"
						value={shownColor ?? '#8b8d98'}
						onChange={(e) => setCustomColor(e.target.value)}
					/>
				</label>
			</div>

			{error && (
				<p className="lb-look__error" role="alert">
					{error}
				</p>
			)}
		</div>
	)
}

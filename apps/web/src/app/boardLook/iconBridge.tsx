import { setIconBridge } from '@lifeboard/node-kit'
import { Ban } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BoardIconSvg } from './BoardBadge'
import { SUGGESTED, iconName, searchBoardIcons, useBoardIcons, type BoardIcon } from './boardIcons'

/**
 * The board icons, lent to extensions through node-kit's `IconBridge` (a skill node wears one). Same
 * catalogue, same search and same suggestions as the board picker, so an icon means the same thing
 * wherever it appears.
 */

function CatalogueIcon({ name, size = 18, strokeWidth = 1.75 }: { name: string; size?: number; strokeWidth?: number }) {
	const catalogue = useBoardIcons(!!name)
	const icon = name && catalogue?.byName.get(iconName(name) ?? '')
	return icon ? <BoardIconSvg icon={icon} size={size} strokeWidth={strokeWidth} /> : null
}

/** How many icons the inline chooser draws: it lives in a node's editor, not a full picker. */
const INLINE_LIMIT = 60

function InlineIconPicker({ value, onPick }: { value: string; onPick: (name: string | null) => void }) {
	const catalogue = useBoardIcons()
	const [query, setQuery] = useState('')
	const shown = useMemo<readonly BoardIcon[]>(() => {
		if (!catalogue) return []
		if (query.trim()) return searchBoardIcons(catalogue, query).icons.slice(0, INLINE_LIMIT)
		return SUGGESTED.flatMap(([, entries]) => entries.flatMap(([name]) => catalogue.byName.get(name) ?? [])).slice(0, INLINE_LIMIT)
	}, [catalogue, query])
	const current = iconName(value)

	return (
		<div className="lb-iconpick">
			<div className="lb-iconpick__head">
				<input
					type="search"
					className="lb-look__search"
					placeholder={catalogue ? `Search ${catalogue.icons.length.toLocaleString()} icons` : 'Search icons'}
					aria-label="Search icons"
					value={query}
					// Keys typed here are the field's, not the board's shortcuts.
					onKeyDown={(e) => e.stopPropagation()}
					onChange={(e) => setQuery(e.target.value)}
				/>
				{value && (
					<button type="button" className="lb-look__icon lb-look__none" aria-label="No icon" title="No icon" onClick={() => onPick(null)}>
						<Ban size={16} strokeWidth={1.75} aria-hidden="true" />
					</button>
				)}
			</div>
			{!catalogue ? (
				<p className="lb-look__empty">Loading icons…</p>
			) : shown.length === 0 ? (
				<p className="lb-look__empty">No icons match "{query}".</p>
			) : (
				<div className="lb-iconpick__grid">
					{shown.map((icon) => (
						<button
							key={icon.name}
							type="button"
							className="lb-look__icon"
							aria-label={icon.name.replace(/-/g, ' ')}
							title={icon.name.replace(/-/g, ' ')}
							aria-pressed={current === icon.name}
							onClick={() => onPick(icon.name)}
						>
							<BoardIconSvg icon={icon} size={18} strokeWidth={1.75} />
						</button>
					))}
				</div>
			)}
		</div>
	)
}

/** Called once from the composition root. */
export function installIconBridge(): void {
	setIconBridge({ Icon: CatalogueIcon, IconPicker: InlineIconPicker })
}

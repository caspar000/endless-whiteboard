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

export function CatalogueIcon({ name, size = 18, strokeWidth = 1.75 }: { name: string; size?: number; strokeWidth?: number }) {
	const catalogue = useBoardIcons(!!name)
	const icon = name && catalogue?.byName.get(iconName(name) ?? '')
	return icon ? <BoardIconSvg icon={icon} size={size} strokeWidth={strokeWidth} /> : null
}

/** How many icons the inline chooser draws: it lives in a node's editor, not a full picker. */
const INLINE_LIMIT = 60

const SUGGESTED_TAB = 'Suggested'

/** A search box, then the suggestions or one of the packs (Activities, Everyday), each a tab. */
export function InlineIconPicker({ value, onPick }: { value: string; onPick: (name: string | null) => void }) {
	const catalogue = useBoardIcons()
	const [query, setQuery] = useState('')
	const [tab, setTab] = useState(SUGGESTED_TAB)
	const shown = useMemo<readonly BoardIcon[]>(() => {
		if (!catalogue) return []
		if (query.trim()) return searchBoardIcons(catalogue, query).icons.slice(0, INLINE_LIMIT)
		const pack = catalogue.packs.find((p) => p.name === tab)
		// A pack is shown whole: it is a few dozen icons, picked to be looked through.
		if (pack) return pack.groups.flatMap(([, icons]) => icons)
		return SUGGESTED.flatMap(([, entries]) => entries.flatMap(([name]) => catalogue.byName.get(name) ?? [])).slice(0, INLINE_LIMIT)
	}, [catalogue, query, tab])
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
			{catalogue && !query.trim() && (
				<div className="lb-look__tabs lb-iconpick__tabs" role="tablist" aria-label="Icon sets">
					{[SUGGESTED_TAB, ...catalogue.packs.map((p) => p.name)].map((name) => (
						<button key={name} type="button" role="tab" className="lb-look__tab" aria-selected={tab === name} onClick={() => setTab(name)}>
							{name}
						</button>
					))}
				</div>
			)}
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
							aria-label={icon.label}
							title={icon.label}
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

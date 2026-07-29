import type { BoardMeta } from '../boards/boardIndex'

/**
 * The home screen's left rail. Freeform's structure — sections with live counts — in Affine's darker,
 * quieter register.
 *
 * Every section is backed by real data: no placeholder entries for features that don't exist. That is
 * why there is no "Shared" here.
 */
export type HomeSection = 'all' | 'recents' | 'favorites' | 'storage'

const SECTIONS: { id: HomeSection; label: string; icon: string }[] = [
	{ id: 'all', label: 'All boards', icon: '▦' },
	{ id: 'recents', label: 'Recents', icon: '◷' },
	{ id: 'favorites', label: 'Favourites', icon: '★' },
]

export function Sidebar({
	section,
	onSelect,
	boards,
	onNewBoard,
}: {
	section: HomeSection
	onSelect: (section: HomeSection) => void
	boards: BoardMeta[]
	onNewBoard: () => void
}) {
	const counts: Record<HomeSection, number | null> = {
		all: boards.length,
		recents: Math.min(boards.length, RECENTS_LIMIT),
		favorites: boards.filter((b) => b.favorite).length,
		storage: null,
	}

	return (
		<aside className="lb-sidebar">
			<div className="lb-sidebar__brand">
				<span className="lb-sidebar__mark" aria-hidden="true">
					◲
				</span>
				<span className="lb-sidebar__name">Lifeboard</span>
			</div>

			<button className="lb-sidebar__new" onClick={onNewBoard}>
				<span aria-hidden="true">＋</span> New board
			</button>

			<nav className="lb-sidebar__nav" aria-label="Boards">
				{SECTIONS.map((item) => (
					<button
						key={item.id}
						className={
							section === item.id ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'
						}
						onClick={() => onSelect(item.id)}
						aria-current={section === item.id ? 'page' : undefined}
					>
						<span className="lb-sidebar__icon" aria-hidden="true">
							{item.icon}
						</span>
						<span className="lb-sidebar__label">{item.label}</span>
						<span className="lb-sidebar__count">{counts[item.id]}</span>
					</button>
				))}
			</nav>

			<div className="lb-sidebar__footer">
				<button
					className={
						section === 'storage' ? 'lb-sidebar__item lb-sidebar__item--active' : 'lb-sidebar__item'
					}
					onClick={() => onSelect('storage')}
					aria-current={section === 'storage' ? 'page' : undefined}
				>
					<span className="lb-sidebar__icon" aria-hidden="true">
						⛁
					</span>
					<span className="lb-sidebar__label">Storage &amp; backup</span>
				</button>
			</div>
		</aside>
	)
}

export const RECENTS_LIMIT = 6

export function sectionTitle(section: HomeSection): string {
	switch (section) {
		case 'all':
			return 'All boards'
		case 'recents':
			return 'Recents'
		case 'favorites':
			return 'Favourites'
		case 'storage':
			return 'Storage & backup'
	}
}

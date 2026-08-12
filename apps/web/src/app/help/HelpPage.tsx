import { useEffect, useRef } from 'react'
import { HELP_GROUPS, HELP_SECTIONS, sectionFor } from './sections'

/**
 * The help page: a rail of sections on the left, one section at a time on the right.
 *
 * It used to be a single scroll, which was right when there were five things to say. It stopped being
 * right as the board grew: the page became long enough that finding "how do filters work" meant
 * scrolling past three animations, and — worse — everything looked equally important, so the property
 * system read as one paragraph of seven rather than as the thing the rest of the app is built on.
 *
 * Splitting it also lets the sections say what kind of thing they are. Properties and arrows are the
 * app; a note and a table are node *types*, which is a genuinely different claim — one you can ignore
 * and still use the board.
 *
 * The selected section lives in the route (see `useHashRoute`), not in state here, so a section is a
 * link and the back button works between them.
 */
export function HelpPage({
	section,
	onSection,
}: {
	section: string | undefined
	onSection: (section: string) => void
}) {
	const active = sectionFor(section)
	const Body = active.Component

	/**
	 * A new section starts at its top.
	 *
	 * Only this pane scrolls, so without it clicking "Tables" from halfway down Properties would open
	 * Tables halfway down — which reads as a page that failed to load its heading.
	 */
	const main = useRef<HTMLElement>(null)
	useEffect(() => {
		main.current?.scrollTo({ top: 0 })
	}, [active.id])

	return (
		<div className="lb-help">
			<nav className="lb-help__nav" aria-label="Help sections">
				{HELP_GROUPS.map((group) => {
					const inGroup = HELP_SECTIONS.filter((s) => s.group === group)
					if (!inGroup.length) return null
					return (
						<div className="lb-help__navgroup" key={group}>
							<div className="lb-help__navtitle">{group}</div>
							{inGroup.map((s) => (
								<button
									key={s.id}
									className={
										s.id === active.id
											? 'lb-help__navitem lb-help__navitem--active'
											: 'lb-help__navitem'
									}
									aria-current={s.id === active.id ? 'page' : undefined}
									onClick={() => onSection(s.id)}
								>
									<span className="lb-help__navicon" aria-hidden="true">
										{s.icon}
									</span>
									<span className="lb-help__navlabel">{s.label}</span>
								</button>
							))}
						</div>
					)
				})}
			</nav>

			<main className="lb-help__main" ref={main}>
				{/* Keyed so a section change remounts the body: the demos hold step and selection state,
				    and a table builder inheriting the flat-hunt selection from another page would be
				    showing a configuration nobody chose. */}
				<div className="lb-help__page" key={active.id}>
					<header className="lb-home__header">
						<h1>{active.title}</h1>
					</header>
					<p className="lb-help__lede">{active.lede}</p>
					<Body go={onSection} />
				</div>
			</main>
		</div>
	)
}

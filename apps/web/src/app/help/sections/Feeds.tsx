import { Rss } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Section, useDemo, type SectionProps } from '../kit'

/* ------------------------------------------------------------ a chip narrows the feed */

const FILTER_STEPS = [1800, 1800, 1400, 2400] as const

/*
 * Retyped rather than read from @lifeboard/feeds: these are sample posts, and the package's modules
 * would come into the eagerly-loaded help chunk with them.
 */
const POSTS = [
	{ title: 'Setting the time on my breadboard clock', source: 'Ben Eater', ago: '1h ago', ee: true, hue: 220 },
	{ title: 'What makes this chord progression so sad?', source: '12tone', ago: '4h ago', ee: false, hue: 300 },
	{ title: 'Oscilloscope probing mistakes everyone makes', source: 'EEVblog', ago: '6h ago', ee: true, hue: 25 },
	{ title: 'The surprising physics of spinning tops', source: 'Veritasium', ago: '1d ago', ee: false, hue: 160 },
	{ title: 'Building a bidirectional DC/DC converter', source: 'GreatScott!', ago: '2d ago', ee: true, hue: 45 },
]

/**
 * The card as it is, built from its own classes: the chips, the newest-first list, a chip narrowing it
 * to one category, and a post opened, losing its dot.
 */
function FilterDemo() {
	const { step, ref } = useDemo(FILTER_STEPS)
	const filtered = step >= 1
	const opened = step >= 2
	const posts = POSTS.filter((p) => !filtered || p.ee)
	return (
		<div className="lb-demo lb-demo--feed" ref={ref} role="img" aria-label="A feed card showing every channel's newest videos, then only the Electrical Engineering ones, then one opened and marked watched">
			<div className="lb-demo__scene">
				<div className="lb-feed lb-demo__feed" aria-hidden="true">
					<header className="lb-feed__head">
						<span className="lb-feed__badge">
							<Rss size={15} />
						</span>
						<span className="lb-feed__name">My feeds</span>
						<span className="lb-feed__refresh">updated 4m ago</span>
					</header>
					<div className="lb-feed__chips">
						<span className="lb-feed__chip" aria-pressed={!filtered}>
							All<span className="lb-feed__count">5</span>
						</span>
						<span className="lb-feed__chip lb-feed__chip--cat" style={{ '--lb-opt-h': 220 } as CSSProperties} aria-pressed={filtered}>
							Electrical Engineering<span className="lb-feed__count">{opened ? 2 : 3}</span>
						</span>
						<span className="lb-feed__chip lb-feed__chip--cat" style={{ '--lb-opt-h': 330 } as CSSProperties} aria-pressed={false}>
							Music<span className="lb-feed__count">1</span>
						</span>
					</div>
					<ul className="lb-feed__list">
						{posts.map((p, i) => {
							const watched = opened && filtered && i === 0
							return (
								<li key={p.title} className={`lb-feed__row${watched ? '' : ' lb-feed__row--unwatched'}${watched && step === 2 ? ' lb-demo__feedopen' : ''}`}>
									<span className="lb-feed__thumb" style={{ background: `linear-gradient(135deg, hsl(${p.hue} 40% 30%), hsl(${p.hue + 40} 40% 12%))` }} />
									<span className="lb-feed__body">
										<span className="lb-feed__title">{p.title}</span>
										<span className="lb-feed__meta">
											<span className="lb-feed__source">{p.source}</span>· {p.ago}
										</span>
									</span>
									<span className="lb-feed__actions">
										<span className="lb-feed__dot" aria-pressed={watched} />
									</span>
								</li>
							)
						})}
					</ul>
				</div>
			</div>
			<div className="lb-demo__hint">
				{!filtered
					? 'every channel, newest first'
					: !opened
						? 'a chip narrows it to one category'
						: 'click a video: it opens on YouTube and loses its dot'}
			</div>
		</div>
	)
}

export function Feeds(_: SectionProps) {
	return (
		<>
			<FilterDemo />

			<Section title="Sources and categories">
				<p>
					Put a <strong>Feed</strong> card on any board from the node types in the dock. Double-click it, or
					choose <strong>Manage sources</strong> from its <code>⋯</code> menu, and the sources panel opens
					beside it. Paste a YouTube channel there (a link, an <code>@handle</code> or a channel id) or the
					address of an RSS or Atom feed, or of a site that has one, and pick a category to file it under.
				</p>
				<p>
					Categories are yours to make: <strong>New category</strong>, or the <code>+</code> after the chips.
					Click a category's name in the panel to rename it, and use its arrows to move its chip. Deleting one
					leaves its sources where they are. A source can be filed under several categories, or none: click
					the category chips under its name to file it or take it out.
				</p>
				<p className="lb-help__aside">
					Each board has its own sources, categories and what you've watched, kept in your vault, so every
					feed card on that board, on any device, shows the same. A board that had a feed card before boards
					had feeds of their own keeps a copy of what you had then.
				</p>
			</Section>

			<Section title="Reading the feed">
				<p>
					The card lists the newest posts of every source. Click a category's chip to see only its
					sources, and <strong>All</strong> to see everything again. The numbers on the chips count
					what you haven't watched.
				</p>
				<p>
					Click a video to watch it on YouTube, in a new tab. The play button on a row plays it in the
					card instead. Either one marks it watched. The dot beside a post marks it watched or
					unwatched by hand, and <strong>Mark all as watched</strong> in the <code>⋯</code> menu does so for
					everything in view. The card shows unwatched posts, or all of them: switch at the bottom of
					the card.
				</p>
				<p className="lb-help__aside">
					Open cards read their sources every quarter of an hour, and <strong>Refresh now</strong> reads
					them at once. YouTube's feed lists a channel's latest 15 videos, so a channel you add starts
					from those. The Lifeboard server does the reading, since a browser may not read YouTube's
					feeds itself; without a server, the card says so. Reddit and X are coming.
				</p>
			</Section>
		</>
	)
}

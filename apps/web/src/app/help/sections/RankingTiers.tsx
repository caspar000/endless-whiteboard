import { DEFAULT_TIERS, formatOdds } from '@lifeboard/ranking-tiers'
import { Jump, Keys, Section, type SectionProps } from '../kit'

/** How many each default tier holds in the demo. Made up; the odds beside them are worked out from them. */
const DEMO_COUNTS = [4, 8, 4, 3]

/**
 * The card's bands, with the real default tiers and the odds the card would print for them, so the page
 * can't drift from what the card says.
 */
function TiersDemo() {
	const sizes = DEFAULT_TIERS.map((t, i) => t.weight * (DEMO_COUNTS[i] ?? 0))
	const total = sizes.reduce((a, b) => a + b, 0)
	return (
		<div className="lb-demo lb-demo--tiers" role="img" aria-label="A ranking's tiers, each with its weight and its odds">
			{DEFAULT_TIERS.map((tier, i) => (
				<div key={tier.name} className="lb-demo__tier">
					<span className="lb-demo__tier-name">{tier.name}</span>
					<span className="lb-demo__tier-weight">×{tier.weight}</span>
					<span className="lb-demo__tier-covers">
						{Array.from({ length: DEMO_COUNTS[i] ?? 0 }, (_, k) => (
							<i key={k} />
						))}
					</span>
					<span className="lb-demo__tier-odds">{formatOdds((sizes[i] ?? 0) / total, false)}</span>
				</div>
			))}
		</div>
	)
}

export function RankingTiers({ go }: SectionProps) {
	return (
		<>
			<TiersDemo />
			<Section title="Making one">
				<p>
					Add a Ranking Tiers card from the dock's node picker, or with <strong>Add ranking tiers</strong> in{' '}
					<Jump to="shortcuts" go={go}>
						⌘K
					</Jump>
					. <strong>Double-click it</strong>, or click <strong>Choose what to rank</strong> at its top, and
					pick a source: anything your other extensions offer on this board. With Feeds or the Syllabus on,
					a feed or a syllabus track, such as /mu/core's albums; with{' '}
					<Jump to="backlog" go={go}>
						Backlog
					</Jump>{' '}
					on, each of the board's backlogs; with the{' '}
					<Jump to="randomizer" go={go}>
						Randomizer
					</Jump>{' '}
					on, what you stamped on this board, a list for each source and stamp, such as{' '}
					<strong>Liked on /mu/core</strong>. Albums, books and films sit side by side, each as its cover.
				</p>
				<p>
					Each source keeps its own tiers: point the card at another and back, and the first is as you left
					it.
				</p>
			</Section>
			<Section title="The rank queue">
				<p>
					Stamp an album Liked, Unsure or Disliked on a randomizer and it lands in the card's{' '}
					<strong>rank queue</strong>, newest first, above the tiers (in a record crate, on the shelf). Drag
					it from there into any tier. Covers you never stamped wait in the rail on the left: click it open,
					and <strong>search</strong> it by title or artist to find one among hundreds.
				</p>
				<p>
					The card's settings have a switch each for Liked, Unsure and Disliked under{' '}
					<strong>Rank queue shows</strong>. Switch Unsure and Disliked off and the queue holds only what you
					liked; switch them back on and the rest are there again. The switches never move what you already
					put in a tier.
				</p>
			</Section>
			<Section title="Sorting">
				<p>
					<strong>Drag covers into tiers</strong>, between tiers, and along a tier to order it. Or click a
					cover and use <Keys keys={['↑']} /> <Keys keys={['↓']} /> to move it a tier, and{' '}
					<Keys keys={['←']} /> <Keys keys={['→']} /> to move it along. Above the first tier, it waits in
					the queue again; below the last, in the rail.
				</p>
				<p>
					A cover keeps the stamp it was given: moving it into a tier, or between tiers, never stamps it
					again. A cover nobody stamped is stamped Liked when you first rank it, as if you had stamped it on
					a randomizer, which takes it out of this board's randomizers' shuffles. And if a{' '}
					<Jump to="syllabus" go={go}>
						syllabus
					</Jump>{' '}
					has the same work (the same album by the same artist), ranking it ticks it there.
				</p>
				<p>
					<strong>+</strong> at the top adds a tier at the bottom. Click a tier's name to rename it. Its{' '}
					<strong>⋯</strong> menu gives it a background colour, a border and an icon, so tiers are told apart
					at a glance, and moves it up or down, takes everything off it (stamped covers go back to the
					queue), or removes it. New cards start with the tiers in Settings → Extensions → Ranking Tiers,
					where you can change them.
				</p>
			</Section>
			<Section title="Tiers or a shelf">
				<p>
					<strong>Tiers</strong> and <strong>Shelf</strong> at the top of the card (and Display in its
					settings) switch how it is drawn. Tiers are banded rows that wrap, so every cover shows. The shelf
					is a wooden bookcase, one shelf a tier, its brass nameplate in the tier's colour with its icon and
					how many it holds, and the queue in a record crate on top. A shelf too full for its plank folds its
					last covers into a leaning “+N” stack: click it to open the shelf and scroll along it, and Fold to
					close it again.
				</p>
			</Section>
			<Section title="Randomizing from it">
				<p>
					A randomizer on the same board can draw from any one tier: pick{' '}
					<strong>Albums, ranked: Heavy rotation</strong> from its menu to shuffle only what you put there.
				</p>
				<p>
					<strong>Weighted shuffle</strong>, off until you turn it on in the card's settings, offers the whole
					ranking too, drawn by weight. Each tier gets a die whose pips are its weight, from 1 to 5 (click it
					to change), the odds of the tier winning a draw, and a bar of its share. The odds count both the
					weight and how many the tier holds, so a crowded tier at 3 can win more draws than a small one at
					4, though each of its albums wins fewer. Unranked items stay out of the draw.
				</p>
			</Section>
			<Section title="Stamps and shapes">
				<p>
					<strong>Stamp badges</strong> in the card's settings puts each stamped cover's latest stamp on its
					corner. <strong>Cover shape</strong> makes every cover square, wide (16:9, for videos), tall (2:3,
					for posters) or another shape.
				</p>
			</Section>
			<Section title="Where it is kept">
				<p>
					A ranking belongs to the board it was made on. It is kept in your vault, so every device shows the
					same, and a copy of the card shows the same ranking; only randomizers on its board are offered it.
					Settings → Extensions → Ranking Tiers lists them all, to delete the ones you no longer need, and
					switches odds between “1 in 5” and “20%”.
				</p>
				<p>
					Drag a cover onto a{' '}
					<Jump to="backlog" go={go}>
						Backlog
					</Jump>{' '}
					to add it there too.
				</p>
			</Section>
		</>
	)
}

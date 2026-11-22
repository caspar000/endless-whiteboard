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
					pick a source: anything your other extensions offer. With the{' '}
					<Jump to="randomizer" go={go}>
						Randomizer
					</Jump>{' '}
					on, that includes <strong>Everything I liked</strong>, every item you stamped Liked on any
					randomizer; with{' '}
					<Jump to="backlog" go={go}>
						Backlog
					</Jump>{' '}
					on, each backlog; with Feeds or the Syllabus on, a feed or a syllabus track. Albums, books and
					films sit side by side, each as its cover.
				</p>
				<p>
					Each source keeps its own tiers: point the card at another and back, and the first is as you left
					it.
				</p>
			</Section>
			<Section title="Sorting">
				<p>
					What isn't ranked yet waits in the rail on the left. Click it open and{' '}
					<strong>drag covers into tiers</strong>, between tiers, and along a tier to order it. Or click a
					cover and use <Keys keys={['↑']} /> <Keys keys={['↓']} /> to move it a tier, and{' '}
					<Keys keys={['←']} /> <Keys keys={['→']} /> to move it along. Below the last tier, it is unranked
					again. Every cover is the same size and a tier grows a row at a time as it fills, so nothing is
					ever hidden.
				</p>
				<p>
					The open rail has a <strong>search</strong> field: type part of a title or an artist to find one
					cover among hundreds, then drag it into a tier.
				</p>
				<p>
					Ranking something counts as liking it. A cover moved from the rail into a tier is stamped{' '}
					<strong>Liked</strong> as if you had stamped it on a{' '}
					<Jump to="randomizer" go={go}>
						randomizer
					</Jump>
					, so it joins Everything I liked, and if a{' '}
					<Jump to="syllabus" go={go}>
						syllabus
					</Jump>{' '}
					has the same work (the same album by the same artist), it is ticked there, its write-up note filed
					beside the ranking. Every randomizer counts the Liked stamp too, so a ranked album is out of their
					shuffles. Moving it between tiers, or back to the rail, changes none of this.
				</p>
				<p>
					<strong>+</strong> at the top adds a tier at the bottom. Click a tier's name to rename it, and use
					its <strong>⋯</strong> menu to move it up or down or remove it; a removed tier's items go back to
					the rail. New cards start with the tiers in Settings → Extensions → Ranking Tiers, where you can
					change them.
				</p>
			</Section>
			<Section title="Weighted shuffle">
				<p>
					Off until you turn it on in the card's settings (the sliders at its top): then each tier has a die
					whose pips are its weight, from 1 to 5 (click it to change), the odds of the tier winning a draw,
					and a bar of its share. The odds count both the weight and how many the tier holds, so a crowded
					tier at 3 can win more draws than a small one at 4, though each of its albums wins fewer.
				</p>
				<p>
					With it on, the ranking is in every randomizer's menu, and a randomizer pointed at it draws by
					those weights: what you put in heavy rotation comes up most. Unranked items stay out of the draw.
					With it off, a ranking is a ranking, for books or films you only want in order.
				</p>
			</Section>
			<Section title="Stamps and shapes">
				<p>
					The card's settings choose what it shows. With the Randomizer on, <strong>Show stamped</strong>{' '}
					has a switch each for Liked, Unsure and Disliked: switch one off and the covers whose latest stamp
					is that kind leave the ranking, keeping their tier for when you switch it back. A ranking of
					Everything I liked starts with only Liked on; switch Unsure on too, and it ranks both lists at once.
					A cover you rank from Everything I'm unsure of is stamped Liked like any other, and stays in the
					tier you put it in.{' '}
					<strong>Stamp badges</strong> puts each stamped cover's latest stamp on its corner.
				</p>
				<p>
					<strong>Cover shape</strong> makes every cover square, wide (16:9, for videos), tall (2:3, for
					posters) or another shape.
				</p>
			</Section>
			<Section title="Where it is kept">
				<p>
					Rankings are kept in your vault, so a randomizer on another board or device draws from the same
					one, and a copy of the card shows the same ranking. Settings → Extensions → Ranking Tiers lists
					them all, to delete the ones you no longer need, and switches odds between “1 in 5” and “20%”.
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

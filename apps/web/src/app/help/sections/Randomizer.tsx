import { Postmark, STAMPS, STAMP_KINDS, flipCount } from '@lifeboard/randomizer'
import { Jump, Keys, Section, type SectionProps } from '../kit'

/**
 * The three stamps, drawn with the card's own postmark so this page cannot drift from it, each with
 * what it does to the shuffle.
 */
function StampsDemo() {
	return (
		<div className="lb-demo lb-demo--rand-stamps" role="img" aria-label="The three stamps: Liked, Disliked and Unsure">
			{STAMP_KINDS.map((kind) => (
				<figure key={kind} className="lb-demo__rand-stamp">
					<Postmark kind={kind} date="2026-11-19" className="lb-demo__rand-pm" />
					<figcaption>
						<strong>{STAMPS[kind].label}</strong>
						<span>{STAMPS[kind].out ? 'out of the shuffle' : 'stays in the shuffle'}</span>
					</figcaption>
				</figure>
			))}
		</div>
	)
}

export function Randomizer({ go }: SectionProps) {
	return (
		<>
			<StampsDemo />
			<Section title="Making one">
				<p>
					Add a randomizer from the dock's node picker, or with <strong>Add randomizer</strong> in{' '}
					<Jump to="shortcuts" go={go}>
						⌘K
					</Jump>
					. A new one is empty: it waits for something to shuffle.
				</p>
				<p>
					<strong>Double-click the card</strong>, or click <strong>Choose a source</strong> at its top,
					and pick what it shuffles. <strong>A list I type</strong> holds anything you like (albums,
					films, books, places to eat), one per line, as <em>Title — Creator — Year</em>. The second
					and third parts can be left out, and a hyphen with spaces round it, a tab or a <code>|</code>{' '}
					separate as well as a dash, so a list pasted from somewhere else usually just works. Editing the
					list keeps each item's cover and stamps, as long as its title and creator stay the same.
				</p>
				<p>
					With{' '}
					<Jump to="feeds" go={go}>
						Feeds
					</Jump>{' '}
					on, the same menu lists <strong>All feeds</strong>, each of your categories and each channel:
					pick one and the card shuffles its videos, each with its thumbnail as the cover. The button
					beside the count opens the video on show and marks it watched in your feeds. The card keeps the
					feed up to date while it is open, as a feed card does.
				</p>
				<p>
					With the{' '}
					<Jump to="syllabus" go={go}>
						Syllabus
					</Jump>{' '}
					on, it also lists each track of every syllabus in your vault, under the syllabus's name: pick one
					and the card shuffles the track's works, ticked or not. Pick <strong>/mu/core</strong> (after
					dropping <code>syllabi/mucore.yaml</code> on a board) and it shuffles all 1111 albums, each as
					album, artist and year on its own cover. Most covers come from the web; the few it has no
					picture for show their square from the /mu/core chart, which is softer. If your /mu/core came
					in before the covers did, drop the file on a board again: your ticks stay as they are.
				</p>
				<p>
					The name at the top of the card is the source; click it to change to another. Changing it is an
					ordinary edit, so <Keys keys={['⌘Z']} /> puts the last one back, and the stamps you put on a
					source's items stay with the card for when you come back to it.
				</p>
				<p>
					<strong>Drop an image on the card</strong> and it becomes the cover of the item on show. An
					item without one gets a cover drawn from its title, the same one every time.
				</p>
			</Section>
			<Section title="Shuffling">
				<p>
					<strong>Shuffle</strong> flips the cover through what it shuffles like a departure board, a clack per
					flap, and slows to a stop; then the title and the creator rattle through the letter tiles and
					settle. With the card selected, <Keys keys={['⌘↵']} /> does the same.
				</p>
				<p>
					The longer the list, the longer the run: a dozen items flip about {flipCount(12)} times, a
					backlog of hundreds up to {flipCount(100_000)}, and it never takes more than about five
					seconds. The pick itself is fair: every item still in the shuffle is equally likely, and it
					never lands on the one already showing.
				</p>
				<p>
					Pointed at a{' '}
					<Jump to="ranking-tiers" go={go}>
						ranking
					</Jump>{' '}
					whose weighted shuffle is on, the card draws by the ranking's tiers instead: an album in a tier
					weighted 4 comes up four times as often as one in a tier weighted 1, and what isn't ranked stays
					out of the draw. Every draw is from the whole ranking, the album on show included, so a heavy
					one can come up twice running: that is what its odds mean. A{' '}
					<Jump to="backlog" go={go}>
						backlog
					</Jump>{' '}
					is in the menu too, everything in it at once.
				</p>
				<p>
					A cover that hasn't loaded by the time the flap reaches it shows its title on a blank card rather
					than the last picture, and the covers a shuffle will flip through start loading as soon as you
					press it. The card's editor sets the <strong>window</strong>'s shape: square, or 16:9 for videos,
					2:3 for posters and others, the flap still splitting it in two equal halves.
				</p>
				<p>
					An album you rank on a{' '}
					<Jump to="ranking-tiers" go={go}>
						Ranking Tiers
					</Jump>{' '}
					card is Liked on every randomizer: out of the shuffle, with the stamp on its cover, marked as the
					ranking's in the stamp history. It is the ranking's stamp, so the card's Undo leaves it.
				</p>
				<p>
					The speaker button mutes the sound, and the card remembers. With reduced motion switched on in
					your system, the cover fades to the pick instead of flipping.
				</p>
				<p>
					Where a shuffle lands is not an edit, so <Keys keys={['⌘Z']} /> skips it. The last few picks
					sit under the button.
				</p>
			</Section>
			<Section title="Stamps">
				<p>
					The stamp button beside the speaker stamps the item on show. <strong>Liked</strong> and{' '}
					<strong>Disliked</strong> take it out of the shuffle; <strong>Unsure</strong> leaves it in, so
					you can stamp it again later once you have made up your mind. Shuffling never stamps anything:
					shuffle as often as you like, and stamp when you have actually listened, watched or read it.
				</p>
				<p>
					Each stamp is a dated postmark on the cover, newest on top. Click them for the whole history.
					The count at the top says how many are still in the shuffle, out of how many there are.
				</p>
				<p>
					A stamp is an ordinary edit: <Keys keys={['⌘Z']} />, or the <strong>Undo</strong> beside it,
					takes it back.
				</p>
				<p>
					Everything you stamp, on any card on any board, is also kept in your vault as{' '}
					<strong>Everything I liked</strong>, <strong>Everything I disliked</strong> and{' '}
					<strong>Everything I'm unsure of</strong>. Other cards can use them: rank what you liked with{' '}
					<Jump to="ranking-tiers" go={go}>
						Ranking Tiers
					</Jump>
					, or collect it in a{' '}
					<Jump to="backlog" go={go}>
						Backlog
					</Jump>
					. An album stamped on two cards is listed once, under its newest stamp.
				</p>
			</Section>
		</>
	)
}

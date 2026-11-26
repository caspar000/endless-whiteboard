import { Jump, Section, type SectionProps } from '../kit'

/** A backlog: items, and a collection as one square stack, the size of an album. */
function BacklogDemo() {
	const tiles = [
		{ title: 'Mirror', via: 'from Feeds' },
		{ title: '/mu/core', via: '1111 albums · from Syllabi', stack: true },
		{ title: 'The Waves', via: 'typed' },
	]
	return (
		<div className="lb-demo lb-demo--backlog" role="img" aria-label="A backlog of an item from a feed, a syllabus track kept as one collection, and a typed item">
			{tiles.map((t) => (
				<figure key={t.title} className="lb-demo__bl-tile">
					<span className={t.stack ? 'lb-demo__bl-thumb lb-demo__bl-thumb--stack' : 'lb-demo__bl-thumb'}>
						{t.stack && (
							<>
								<i />
								<i />
								<i />
							</>
						)}
					</span>
					<figcaption>
						<strong>{t.title}</strong>
						<span>{t.via}</span>
					</figcaption>
				</figure>
			))}
		</div>
	)
}

export function Backlog({ go }: SectionProps) {
	return (
		<>
			<BacklogDemo />
			<Section title="Filling it">
				<p>
					Add a Backlog card from the dock's node picker, or with <strong>Add backlog</strong> in{' '}
					<Jump to="shortcuts" go={go}>
						⌘K
					</Jump>
					. Click its name to rename it.
				</p>
				<p>
					<strong>+</strong> adds an item you type, as <em>Title — creator</em>; it gets a cover drawn from
					its title. Below it, <strong>Or a whole collection</strong> adds anything your other extensions
					offer as one tile: a syllabus track, a feed, everything you liked.
				</p>
				<p>
					<strong>What it holds.</strong> At the top of <strong>+</strong>, choose <strong>Music</strong> or{' '}
					<strong>Film</strong> and the field searches online instead: albums in iTunes, MusicBrainz and
					Deezer, films in Wikidata with their posters from Wikipedia. A film is found by its title in any
					language (<em>Ностальгия</em>, <em>შერეკილები</em>), and a year or “by Tarkovsky” in the query only
					helps. Click a result, or use ↑ ↓ and Enter, and it goes in with its cover, artist or director and
					year. What can't be found still goes in with <strong>Add as typed</strong>. A film backlog's tiles are
					posters.
				</p>
				<p>
					<strong>Drag a cover onto it</strong> from a{' '}
					<Jump to="ranking-tiers" go={go}>
						Ranking Tiers
					</Jump>{' '}
					card, a randomizer's last picks or another backlog. <strong>Drop a syllabus track's card on it</strong> and the whole track
					goes in as one collection, a square stack the size of an album, while the track's card goes back
					where it was. A collection lists what its source holds now, so what is added to the track later is
					in the backlog too. Click it to see inside.
				</p>
				<p>
					<strong>Nothing goes in twice.</strong> An album is the same album however it is spelled: case,
					accents, punctuation, a leading “The” and anything in brackets (“Remastered”) set aside. Add one
					the backlog already holds and the card says where: one already there as its own tile moves to
					the top, and one a collection holds stays in the collection. The count at the top counts each
					thing once, however many collections hold it.
				</p>
				<p>
					Hover a tile for <strong>×</strong> to take it out. Four rows show at first; <strong>Show all</strong>{' '}
					shows the rest.
				</p>
			</Section>
			<Section title="Using it">
				<p>
					Each backlog is a source for other cards, everything in it at once, collections opened out, each
					thing once. Point a{' '}
					<Jump to="randomizer" go={go}>
						randomizer
					</Jump>{' '}
					at it to pick what is next, or a Ranking Tiers card to sort it.
				</p>
				<p>
					A backlog belongs to the board it was made on: only cards there are offered it. It is kept in your
					vault, so every device shows the same, and a copy of the card shows the same backlog. Settings → Extensions → Backlog lists them all, to delete the ones you no
					longer need.
				</p>
			</Section>
		</>
	)
}

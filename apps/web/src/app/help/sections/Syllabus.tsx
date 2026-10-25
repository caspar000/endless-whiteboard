import { Jump, Section, type SectionProps } from '../kit'

/**
 * A collapsed parent with its checklist, and a track with its next row lit.
 *
 * Built from the board's own `lb-skill` and `lb-track` markup, as a still: the two things worth
 * showing are that a parent's children tick from the card, and that a track says what comes next.
 * Hardcoded titles, so the help chunk doesn't pull the package in.
 */
function SyllabusDemo() {
	return (
		<div className="lb-demo" role="img" aria-label="A track listing Adler's first entries, next to Plato's dialogues collapsed into a checklist">
			<div className="lb-demo__scene" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', padding: 20 }}>
				<div className="lb-track lb-track--active" style={{ width: 280 }}>
					<header className="lb-track__head">
						<span className="lb-track__name">Adler's reading list</span>
						<span className="lb-track__state">Active</span>
					</header>
					<div className="lb-track__sub">
						<span>2/15 done</span>
					</div>
					<ol className="lb-track__list">
						<li className="lb-track__row lb-track__row--done">
							<span className="lb-track__num">1</span>
							<input type="checkbox" className="lb-skill__check" checked readOnly tabIndex={-1} />
							<span className="lb-track__title">Homer</span>
						</li>
						<li className="lb-track__row lb-track__row--done">
							<span className="lb-track__num">2</span>
							<input type="checkbox" className="lb-skill__check" checked readOnly tabIndex={-1} />
							<span className="lb-track__title">The Old Testament</span>
						</li>
						<li className="lb-track__row lb-track__row--next">
							<span className="lb-track__num">3</span>
							<input type="checkbox" className="lb-skill__check" readOnly tabIndex={-1} />
							<span className="lb-track__title">
								Aeschylus, Tragedies
								<span className="lb-track__step">next: Oresteia</span>
							</span>
						</li>
					</ol>
				</div>
				<div className="lb-skill" style={{ width: 240 }}>
					<div className="lb-skill__row">
						<input type="checkbox" className="lb-skill__check" disabled readOnly tabIndex={-1} />
						<span className="lb-skill__title">Plato</span>
						<span className="lb-skill__fold">▸</span>
					</div>
					<div className="lb-skill__meta">
						<span className="lb-skill__kind">Study</span>
						<span>book</span>
						<span className="lb-skill__progress">1/4 · core 1/2</span>
					</div>
					<div className="lb-skill__bar" aria-hidden>
						<span style={{ width: '25%' }} />
					</div>
					<ul className="lb-skill__list">
						<li className="lb-skill__li--done">
							<input type="checkbox" className="lb-skill__check" checked readOnly tabIndex={-1} />
							<span>The Republic</span>
							<span className="lb-skill__core">core</span>
						</li>
						<li>
							<input type="checkbox" className="lb-skill__check" readOnly tabIndex={-1} />
							<span>Symposium</span>
							<span className="lb-skill__core">core</span>
						</li>
						<li>
							<input type="checkbox" className="lb-skill__check" readOnly tabIndex={-1} />
							<span>Phaedo</span>
						</li>
						<li>
							<input type="checkbox" className="lb-skill__check" readOnly tabIndex={-1} />
							<span>Meno</span>
						</li>
					</ul>
				</div>
			</div>
		</div>
	)
}

export function Syllabus({ go }: SectionProps) {
	return (
		<>
			<Section title="One syllabus, many views">
				<p>
					A syllabus lives in your vault, not on a board: its <strong>entries</strong> (read Homer), their{' '}
					<strong>works</strong> (the Iliad, the Odyssey), and the <strong>tracks</strong> that put them in
					order. A board shows it in whichever views you put there: the skill tree, a list, Up next, or a
					card for one entry. Every view reads and writes the same syllabus, so a tick in the list is a tick
					in the tree, and on every other board.
				</p>
				<p>
					Tick a work and it records the day, and a <strong>write-up note</strong> appears beside whatever
					you ticked from, started from a template for its medium: Adler's four questions for a book, the
					study sheet for a film, the five passes for a game. Write in the note and the tick counts as
					evidence. A tick whose note is still only the template shows hollow: done, but not written up.
				</p>
			</Section>

			<Section title="Entries and their works">
				<SyllabusDemo />
				<p>
					An entry holds its works: Plato and his dialogues, or a unit and its steps. An entry is done when
					its <strong>core</strong> works are, or all of them, or some number of them, and you don't tick it
					by hand. Add works from the entry's editor (double-click its card).
				</p>
			</Section>

			<Section title="The list">
				<p>
					<code>Show a track as a list</code> puts a track on the board as a full outline in reading order.
					Every entry folds and unfolds to its works and shows its progress, and the next undone entry is
					lit. On an entry's row the tick finishes its next work, so an entry can be worked through without
					unfolding it. Drag the card's edge to make it taller; double-click it to scroll inside.
				</p>
				<p className="lb-help__aside">
					Order is a guide, not a gate: anything can be ticked at any time. Click a track's state to make it
					active, paused or not started. The arrow at the end of a row puts a card for that entry on the
					board, its works as a checklist; deleting a card deletes nothing.
				</p>
			</Section>

			<Section title="Up next">
				<p>
					<strong>Up next</strong> is the card to work from, one per track. It shows the track's current
					step, lit, to tick right there, the next five greyed so you can see what is coming, and twelve
					weeks of the days you did something.
					It follows the first active track; double-click it to pick another, and put one card per track you
					are working on.
				</p>
			</Section>

			<Section title="In a skill tree">
				<p>
					With{' '}
					<Jump to="skill-trees" go={go}>
						Skill trees
					</Jump>{' '}
					on (Settings › Extensions), a syllabus's tree comes in with it,
					and a tree view showing everything draws the syllabus's entries and works around the skill nodes
					they are tagged to. Tag an item with a node's id and its write-ups count there. A node can ask
					for a particular item done (<code>- item: adler/homer</code>), or a number of written-up items
					tagged to it (<code>- count: {'{'} min: 3 {'}'}</code>, which can also filter by kind, medium or
					method). Right-click an entry or work in a tree › Mark as done, or › Put a card on the board.
				</p>
				<p className="lb-help__aside">
					Every item in your vault is in one index, so a tree on one board lights up from items on another,
					and a track can list items from anywhere. With Skill trees off, a syllabus still has its lists,
					Up next and cards, and an import leaves its tree out.
				</p>
			</Section>

			<Section title="Syllabi as YAML">
				<p>
					A whole syllabus, its tracks, entries and tree, can be written as one YAML document and
					brought in with <code>Import syllabus YAML from the clipboard</code>, or by dropping a{' '}
					<code>.yaml</code> file on the board. The agent can write one for you from a pasted list or a
					chart. The entries go into your vault and the board gets the skill tree (with Skill trees on); add a list or Up next
					when you want them. An import arrives as a <strong>draft</strong>: dashed, and counting toward
					nothing until you run <code>Confirm draft</code>. <code>Discard draft</code> removes it.
					No syllabus is built in. Adler's reading list, /mu/core, and the film, theatre and games trees
					are files in the repo's <code>syllabi/</code> folder: drop one on a board to bring it in.
				</p>
				<p>
					Write ids short (<code>homer</code>); they get the document's <code>goal</code> as a prefix (
					<code>adler/homer</code>). Importing an id that is already in your vault updates it in place and
					keeps its ticks and notes, so you can edit a file and import it again. If something in the file is
					wrong, nothing is imported and a note lists every problem with its place.
				</p>
				<p className="lb-help__aside">
					<code>Copy a syllabus as YAML</code> writes one goal (the selected list's, or the first)
					with ids in full, which is the easiest way to see the format.
				</p>
			</Section>
		</>
	)
}

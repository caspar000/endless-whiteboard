import { Jump, Section, type SectionProps } from '../kit'

/**
 * A collapsed parent with its checklist, and a track with its next row lit.
 *
 * Built from the board's own `lb-skill` and `lb-track` markup, as a still: the two things worth
 * showing are that a parent's children tick from the card, and that a track says what comes next.
 * Hardcoded titles rather than `ADLER_SAMPLE`, so the help chunk doesn't pull the package in.
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
						<span className="lb-skill__title">Plato, Dialogues</span>
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
			<Section title="Items you tick off">
				<p>
					A <strong>syllabus item</strong> is one thing to do: read a book, watch a film, build an
					exercise. Tick it and it records the day, and a note appears beside it, started from a template
					for its medium. A book gets Adler's four questions, a film the study sheet, a game the five
					passes. Write in the note and the tick counts as evidence. A tick whose note is still only the
					template shows hollow: done, but not written up.
				</p>
				<p>
					Kind, Medium, Done and Done at are ordinary <Jump to="properties" go={go}>properties</Jump>, so a{' '}
					<Jump to="tables" go={go}>calendar</Jump> over Done at is your log, and a table can count what you
					have finished by kind.
				</p>
			</Section>

			<Section title="Items inside items">
				<SyllabusDemo />
				<p>
					An item can hold children: Plato and his dialogues, or a unit and its steps. Add them from the
					item's editor (double-click it). A parent is done when its <strong>core</strong> children are, or
					all of them, or some number of them, and you can't tick it by hand. Collapse a parent with its
					arrow to hide the children and tick them from the card's checklist instead.
				</p>
			</Section>

			<Section title="Tracks: the order to go in">
				<p>
					A <strong>track</strong> is an ordered list of items. Select some items, then{' '}
					<code>Make a track from selected items</code> in the command palette, or select a track and
					more items and use <code>Add selection to track</code>. The next undone item is lit. On a
					parent's row the tick finishes its next step, so a unit can be worked through from the track
					without opening it. Click a title to go to the item.
				</p>
				<p className="lb-help__aside">
					Order is a guide, not a gate: anything can be ticked at any time. Double-click a track to rename
					it, give it a goal and reorder it. <code>Insert Adler's reading list (sample)</code> puts the
					first fifteen entries of Adler's list on the board to try it with.
				</p>
			</Section>

			<Section title="Up next">
				<p>
					<strong>Up next</strong> is the card to work from. Put one on any board: it lists the next step
					of every active track (inside a unit, the next undone step), then the habits not yet met this
					period, then twelve weeks of the days you did something. Tick a step right there if it is on this
					board; click any row to go to it, opening its board if it lives on another. Double-click the card
					to show only one goal.
				</p>
				<p className="lb-help__aside">
					For the whole history, add a table, switch it to a calendar and let it group by Done at.
				</p>
			</Section>

			<Section title="Habits">
				<p>
					A <strong>habit</strong> is a target per day, week or month. Tick it with + and −, or give it a
					filter (double-click it: kind, medium, method or tag) and it counts the written-up items that
					match by itself, such as one film sheet a week. It can wait until a syllabus item is done before
					it starts. The card shows the last eight periods as dots and your current streak; a missed
					period is a hollow dot and costs nothing.
				</p>
			</Section>

			<Section title="Skill trees that light up">
				<p>
					A <strong>skill tree</strong> is a constellation of <strong>skill nodes</strong>. Each node says
					what it requires, in a few lines of YAML in its editor: other nodes unlocked first (
					<code>- node: [adler/root]</code>), a particular item done (<code>- item: …</code>), or some
					number of written-up items tagged to it (<code>- count: {'{'} min: 3 {'}'}</code>, which can also
					filter by kind, medium or method), or a habit kept long enough (
					<code>- habit: {'{'} id: …, rule: streak, min: 4 {'}'}</code>; the rules are total, streak,
					best_week and periods). Tag an item with a node's id and its evidence counts there.
				</p>
				<p>
					A node is dim while its prerequisites are locked, outlined once they are open, and lit when its
					requirement is met. After that, more evidence fills its ring toward Bronze, Silver and Gold, at
					3, 10 and 25 pieces, each tier also needing one more Ship item than the last. Method nodes count
					evidence from the whole tree by how it was made, so "three books read analytically" is met by any
					three.
				</p>
				<p className="lb-help__aside">
					Every item in your vault is in one index, so a tree on one board lights up from items on another,
					and a track can list items from anywhere. <code>Insert Adler's skill tree (sample)</code> puts a
					small tree beside the reading-list sample; <code>Redraw prerequisite lines</code> redraws its
					arrows after you edit requirements. Deleting a parent hides its children, so undo brings them
					back together.
				</p>
			</Section>

			<Section title="Syllabi as YAML">
				<p>
					A whole syllabus, its tracks, items, tree and habits, can be written as one YAML document and
					brought in with <code>Import syllabus YAML from the clipboard</code>, or by dropping a{' '}
					<code>.yaml</code> file on the board. The agent can write one for you from a pasted list or a
					chart. An import arrives as a <strong>draft</strong>: dashed, selected, and counting toward
					nothing until you run <code>Confirm draft</code>. <code>Discard draft</code> removes it.
				</p>
				<p>
					Write ids short (<code>homer</code>); they get the document's <code>goal</code> as a prefix (
					<code>adler/homer</code>). Importing an id that is already on the board updates it in place and
					keeps its ticks and notes, so you can edit a file and import it again. If something in the file is
					wrong, nothing is imported and a note lists every problem with its place.
				</p>
				<p className="lb-help__aside">
					<code>Copy a syllabus as YAML</code> writes one goal (the selected track's, or the board's first)
					with ids in full, which is the easiest way to see the format.
				</p>
			</Section>
		</>
	)
}

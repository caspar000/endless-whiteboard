import { Section, type SectionProps } from '../kit'

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

export function Syllabus(_props: SectionProps) {
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
					<strong>Up next</strong> is the card to work from. Put one on any board: it lists the next step
					of every active track (inside an entry, the next undone work), then the habits not yet met this
					period, then twelve weeks of the days you did something. Tick a step right there. Double-click the
					card to show only one goal.
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

			<Section title="Focus, everything, and back">
				<p>
					A tree opens on its skill nodes. <strong>Double-click a node to focus on it</strong>: it moves to
					the middle with its entries and their works around it, and its neighbouring skill nodes stay,
					folded, so you know where you are. Double-click Homer and his works unfold around him. Right-click
					› Focus here does the same; Enter, or right-click › Edit, opens a skill node's editor.
				</p>
				<p>
					The tree's header card shows which arrangement you are in, with <strong>Show all</strong> (every
					entry and work, however many), <strong>Back</strong> to the skill nodes, and{' '}
					<strong>Re-calculate</strong> to lay the arrangement out again. Each arrangement remembers where
					you put its nodes: come back to it and they are where you left them. Tick a work's dot right there
					in the tree; right-click an entry › Put a card on the board for its checklist.
				</p>
				<p>
					Drag a node and its branch follows on springs, and whatever it runs into makes room; let go and
					the board eases to rest, nothing covering anything. One ⌘Z puts it all back. With{' '}
					<strong>live physics</strong> on, the whole view takes part, like Obsidian's graph: every node
					pushes the others away and every line pulls its two ends together.
				</p>
				<p className="lb-help__aside">
					Settings › Extensions › Syllabus & skill trees sets what an import opens on, how far a focus
					reaches and whether physics is live; a tree's header editor overrides each for that tree.
				</p>
			</Section>

			<Section title="Laying a tree out">
				<p>
					<code>Lay out tree</code> (or Re-calculate) arranges the tree: the root stays where it is, its
					dependents fan out around it, families stay together, and nothing overlaps, not even the cards
					already on the board. Pick a different root in the header's editor (double-click it) to grow the
					tree from there. <code>Lay out from this node</code> arranges one node and everything that depends
					on it and leaves the rest alone.
				</p>
				<p>
					<code>Gather every tree around a Mastery node</code> puts one Mastery node in the middle of the
					board with every tree as a branch of it. Its ring shows how much of all of them you have
					unlocked. Each layout is one undo step, and nothing moves on its own afterwards.
				</p>
			</Section>

			<Section title="One tree, many boards">
				<p>
					A skill tree lives in your vault, not on a board. A tree's header card is a <strong>view</strong>{' '}
					of it: double-click the header and pick <strong>Show from</strong> to see the tree from any of its
					nodes, that node and everything that grows from it. <code>Show a skill tree on this board</code>{' '}
					puts a view of any tree on another board, so the whole tree can sit on one board and one branch of
					it on another.
				</p>
				<p>
					Edit a node anywhere and every board showing it follows. Deleting a node deletes it from the tree,
					on every board; undo brings it back. To show less on one board, change its view instead.
				</p>
				<p className="lb-help__aside">
					<code>Hang a skill tree from a node</code> mounts one tree on another tree's node: a pillar, or
					Mastery. A view of that node then shows the mounted tree as its branch, and the node's ring shows
					how much of everything below it is unlocked. <code>Insert the Mastery demo (five pillars)</code>{' '}
					builds one: Mastery, Physical, Mental, Spiritual, Practical and Social, with a starter tree on
					each, and your Adler tree under Mental if you have it.
				</p>
			</Section>

			<Section title="Syllabi as YAML">
				<p>
					A whole syllabus, its tracks, entries, tree and habits, can be written as one YAML document and
					brought in with <code>Import syllabus YAML from the clipboard</code>, or by dropping a{' '}
					<code>.yaml</code> file on the board. The agent can write one for you from a pasted list or a
					chart. The entries go into your vault and the board gets the skill tree; add a list or Up next
					when you want them. An import arrives as a <strong>draft</strong>: dashed, and counting toward
					nothing until you run <code>Confirm draft</code>. <code>Discard draft</code> removes it.
					<code>Import Adler's full reading list (137 entries)</code> and{' '}
					<code>Import /mu/core (1111 recordings)</code> bring in the two built-in syllabi.
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

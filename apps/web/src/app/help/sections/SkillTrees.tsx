import { Jump, Section, type SectionProps } from '../kit'

export function SkillTrees({ go }: SectionProps) {
	return (
		<>
			<Section title="Skill trees that light up">
				<p>
					A <strong>skill tree</strong> is a constellation of <strong>skill nodes</strong>. Each node says
					what it requires, in a few lines of YAML in its editor: other nodes unlocked first (
					<code>- node: [adler/root]</code>), or a tick by hand (<code>- manual: Read it</code>; right-click
					the node › Mark as done). Other extensions teach a node more: the{' '}
					<Jump to="syllabus" go={go}>
						syllabus
					</Jump> adds items done and write-ups counted.
				</p>
				<p>
					A node is dim while its prerequisites are locked, outlined once they are open, and lit when its
					requirement is met. After that, more evidence fills its ring toward Bronze, Silver and Gold, at
					3, 10 and 25 pieces, each tier also needing one more Ship item than the last. Method nodes count
					evidence from the whole tree by how it was made, so "three books read analytically" is met by any
					three.
				</p>
				<p className="lb-help__aside">
					<code>Redraw prerequisite lines</code> redraws a tree's arrows after you edit requirements. Deleting a parent hides its children, so undo brings them
					back together.
				</p>
			</Section>

			<Section title="Making and deleting a tree">
				<p>
					A tree comes into your vault only when you make one. Settings › Extensions › Skill trees lists
					every tree, and <strong>Make a skill tree</strong> there makes one from what you tick: a{' '}
					<Jump to="syllabus" go={go}>
						syllabus
					</Jump>
					, several, or nothing for an empty tree with only a root. Several each make a tree; tick{' '}
					<strong>Hang them from one shared root</strong> and name it to have them grow from one root
					instead. <code>Make a skill tree</code> does the same from ⌘K, one syllabus at a time.
				</p>
				<p>
					A tree you make is on no board and under no pillar. <code>Show a skill tree on this board</code>{' '}
					puts it on a board, to the right of what is there; Mastery's builder hangs it under a pillar.
				</p>
				<p className="lb-help__aside">
					<code>Delete a skill tree</code>, or × beside it in Settings, deletes it from your vault and from
					every board that shows it, Mastery included, with the trees a shared root was made with. A tree
					hung from it by hand stays, unhung. Ticks in syllabi stay. Deleting the last syllabus a tree was
					made from deletes the tree too. Make it again and it comes back.
				</p>
			</Section>

			<Section title="Everything, or the skill nodes">
				<p>
					A tree opens on <strong>everything</strong>: its skill nodes with their entries and works round
					them. <code>Show all nodes or only skill nodes</code> (<kbd>Shift</kbd>+<kbd>E</kbd>) switches every
					tree on the board to its skill nodes only and back. Each view remembers where you put its nodes:
					come back to it and they are where you left them. A work is a small disc with the icon of what it
					is (a book, a film, an album) and its title below; right-click it, or an entry without works, ›
					Mark as done. Done fills it in; done but not written up yet leaves only its outline. Right-click
					an entry › Put a card on the board for its checklist. Double-click a skill node, or press Enter,
					to edit it. You, at the middle of Mastery, is drawn large, and its editor's <strong>Picture</strong>
					fills it with a picture of you; any skill node can have one.
				</p>
				<p>
					The tree is a locked structure: dragging a skill node, an entry or a work leaves it where the
					maze put it. Re-calculate lays the whole view out again.
				</p>
				<p>
					Nothing moves on its own. A new entry or work goes into its skill node's cluster, and only that
					cluster is laid out again. A change to the tree's shape (a new node or tree, a node shared with
					another tree, a tree hung somewhere else) puts a note over the board, <em>The tree's layout is
					out of date</em>; its Re-calculate button, or <code>Re-calculate the tree layout</code>, lays it
					out again. Deleting every node a tree shows takes the tree off the board, with no note left
					behind; one undo puts it back. An entry tagged to more than one skill node is drawn once, under the first, with a
					faint dotted line to each of the others. Every connection is a line, thickest between skill
					nodes and thinner the further a card is from its skill node. A line between skill nodes is
					grey until the node it leads to is unlocked, then in the accent colour. An unlocked node glows blue. Once a
					node and everything below it is unlocked, the whole branch turns gold: its nodes glow gold and
					the lines between them turn gold. A skill with nothing below it stays blue until
					the rest of its parent's branch is unlocked too.
				</p>
				<p className="lb-help__aside">
					A tree's header card, which holds its view, isn't drawn. Settings › Extensions › Skill trees can
					draw it again (to change where its view starts, or lay it out again with Re-calculate),
					and sets what a tree shown on a board opens on. The whole-life board grows from You
					through a maze of hexagons, branch by branch, each arrow running along its corridor, the maze only
					as big as the tree needs; under Advanced are its settings (the hexagons' size, cells to an only
					child, the grid it grows in and more). With everything shown, every entry and work is a node of the
					maze too, in a cell of its own. Re-calculate a board to see a change.
				</p>
			</Section>

			<Section title="Mastery">
				<p>
					<strong>Mastery</strong> is the tree at the middle of everything: you, the pillars of your life
					around you, and your other trees hung under them. Build it in Settings › Extensions › Skill trees:
					<strong>Set up Mastery</strong> starts you with Physical, Mental, Spiritual, Practical and Social.
					Rename, reorder, add and remove pillars there; pick one to hang trees under it. The trees under
					each pillar show beneath it there, with how many nodes each has. A tree can hang under several
					pillars, and is drawn once, between them, with a line from each.
				</p>
				<p>
					<code>Add Mastery to this board</code> puts a view of it on the open board. A pillar lights up once
					anything in a tree under it is unlocked, and its ring fills with the share of those trees you have
					unlocked; You does the same across every pillar.
				</p>
			</Section>

			<Section title="Laying a tree out">
				<p>
					<code>Lay out tree</code> (or Re-calculate) arranges the tree: the root stays where it is, its
					dependents fan out around it, families stay together, and nothing overlaps, not even the cards
					already on the board. Pick a different root in the header's editor (with headers drawn, double-click
					it) to grow the tree from there. <code>Lay out from this node</code> arranges one node and everything that depends
					on it and leaves the rest alone.
				</p>
				<p>Each layout is one undo step, and nothing moves on its own afterwards.</p>
			</Section>

			<Section title="One tree, many boards">
				<p>
					A skill tree lives in your vault, not on a board. A tree's header card is a <strong>view</strong>{' '}
					of it: with headers drawn, double-click one and pick <strong>Show from</strong> to see the tree from any of its
					nodes, that node and everything that grows from it. <code>Show a skill tree on this board</code>{' '}
					puts a view of any tree on another board, so the whole tree can sit on one board and one branch of
					it on another.
				</p>
				<p>
					Edit a node anywhere and every board showing it follows. Deleting a node deletes it from the tree,
					on every board; undo brings it back. To show less on one board, change its view instead.
				</p>
				<p className="lb-help__aside">
					<code>Hang a skill tree from a node</code> mounts one tree on other trees' nodes, usually
					pillars. A view of any of them then shows the mounted tree as its branch. Mastery's builder does
					the same for pillars.
				</p>
			</Section>
		</>
	)
}

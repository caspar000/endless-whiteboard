import { compareZids, placeBehind } from '@lifeboard/zettelkasten'
import type { CSSProperties } from 'react'
import { Jump, Keys, Section, useDemo, type SectionProps } from '../kit'

/** A small box, already in order, with what each card says. */
const DEMO_BOX: [string, string, string][] = [
	['25', 'Society', 'What a society is, before what it does to the people in it.'],
	['25a', 'We live in a society', 'Said as a joke, meant as a complaint.'],
	['25a1', 'The joke as a shield', 'Saying it first means nobody can say it to you.'],
	['25b', 'Death of social relationship', 'Fewer ties, each one thinner.'],
	['26', 'Post-nut clarity', 'A different train of thought, so a new number.'],
]

const FLIP_STEPS = [1400, 1100, 1100, 1100, 1800] as const

/**
 * The stack, flipping through a small box, drawn with the stack's own classes (`lb-zstack__card`,
 * `lb-zcard`) so the demo moves the way the real one does.
 */
function StackDemo() {
	const { step, ref } = useDemo(FLIP_STEPS)
	const order = [...DEMO_BOX].sort((a, b) => compareZids(a[0], b[0]))
	return (
		<div className="lb-demo lb-demo--zstack" ref={ref} role="img" aria-label="Flipping through a box of index cards, one card at a time">
			<div className="lb-demo__zpile">
				{order
					.map((card, index) => ({ card, slot: index - step }))
					.filter(({ slot }) => slot >= -1 && slot <= 3)
					.reverse()
					.map(({ card: [zid, title, text], slot }) => (
						<div key={zid} className="lb-zstack__card" data-slot={slot} style={{ '--slot': slot } as CSSProperties}>
							<div className="lb-zcard-frame">
								<div className="lb-zcard">
									<div className="lb-zcard__id">{zid}</div>
									<div className="lb-zcard__body">
										<div className="lb-zcard__text tl-rich-text">
											<h1>{title}</h1>
											<p>{text}</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					))}
			</div>
			<div className="lb-demo__hint">scroll, swipe or ↓ for the next card; ↑ for the one before</div>
		</div>
	)
}

export function Zettelkasten({ go }: SectionProps) {
	// Worked out by the extension's own rule rather than written in, so this page can't drift from it.
	const taken = new Set(DEMO_BOX.map(([zid]) => zid))
	const continued = placeBehind('25b', taken)
	const branched = placeBehind('25a', taken)
	return (
		<>
			<Section title="A box of cards">
				<p>
					A box is a board of its own. Make one with <strong>New box</strong> on the home screen or
					in ⌘K. It holds index cards and nothing else: no drawing, no stickies, no dragging cards
					about. What it has instead is an order. You read a box by flipping through it, front to
					back, the way you would a drawer of cards.
				</p>
				<StackDemo />
				<p>
					It opens on the <strong>stack</strong>: the card in front, and the tops of the next ones
					behind it. Scroll, swipe up or down, or use the arrow keys to flip. Type a card’s number to
					go straight to it. Every key the stack answers to is in the{' '}
					<Jump to="shortcuts" go={go}>shortcuts</Jump>.
				</p>
			</Section>

			<Section title="Where a note goes is its number">
				<p>
					You don’t give a note a title or a folder. You write it <em>behind the card in front</em>,
					and it takes its number from there, as in Luhmann’s own box. <Keys keys={['N']} /> continues
					the front card’s line: behind 25b comes <strong>{continued}</strong>. If that line already
					goes on, the new note branches off instead: behind 25a, with 25b already there, comes{' '}
					<strong>{branched}</strong> (25a1 is taken), which sorts after 25a’s other branches and
					before 25b.{' '}
					<Keys keys={['⇧N']} /> always branches, and <strong>New train of thought</strong> starts the
					next number.
				</p>
				<p>
					So the order of the box is the order of your thinking. A note never moves: its number is
					its place. Deleting one asks first, and its number is never given to another note. Its
					branches stay where they were, behind a gap.
				</p>
			</Section>

			<Section title="Writing on a card">
				<p>
					Click a card’s text, or press <Keys keys={['Enter']} />, to write on it, and{' '}
					<Keys keys={['Esc']} /> to put it down. The text is a sticky note’s, so bold, italics and
					lists work, and a heading as the first line (type <code># </code>) is the note’s title. Most
					notes don’t need one.
				</p>
			</Section>

			<Section title="On the table">
				<p>
					<strong>Table</strong> lays every card out at once: a column for each top-level note, its
					line running down the column, each branch stepped a little to the right. You can zoom, pan,
					find a card with ⌘K’s <code>@</code>, and double-click one to write on it. The cards stay
					where the box puts them.
				</p>
				<p>
					Two devices writing a note in the same spot while apart both give it the same number. When
					they meet, one of the two moves straight behind the other, and the box says so.
				</p>
			</Section>
		</>
	)
}

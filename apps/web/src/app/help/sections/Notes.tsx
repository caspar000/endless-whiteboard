import { useState, type ReactNode } from 'react'
import { Cursor, Keys, Section, useDemo } from '../kit'

/* ------------------------------------------------------------ live preview */

/**
 * The five lines the live-preview demo holds. `raw` is the markdown; `rendered` is what the app draws
 * once the caret leaves the line.
 *
 * Written out by hand rather than run through the real renderer: pulling `MarkdownView` in here would
 * mean pulling `react-markdown` into the help chunk to render five lines that never change.
 */
const LINES: { raw: string; rendered: ReactNode }[] = [
	{ raw: '## Kitchen', rendered: <span className="lb-lp__h">Kitchen</span> },
	{
		raw: 'Tiles are **ordered** — grout is `still open`.',
		rendered: (
			<>
				Tiles are <strong>ordered</strong> — grout is{' '}
				<code className="lb-lp__code">still open</code>.
			</>
		),
	},
	{
		raw: '- [x] Measure the alcove',
		rendered: (
			<span className="lb-lp__task lb-lp__task--done">
				<span className="lb-demo__box" aria-hidden="true">
					✓
				</span>
				Measure the alcove
			</span>
		),
	},
	{
		raw: '- [ ] Choose a tap',
		rendered: (
			<span className="lb-lp__task">
				<span className="lb-demo__box" aria-hidden="true" />
				Choose a tap
			</span>
		),
	},
	{
		raw: '> The plumber comes on the 3rd.',
		rendered: <span className="lb-lp__quote">The plumber comes on the 3rd.</span>,
	},
]

/**
 * Obsidian-style live preview, as a thing to click.
 *
 * The rule it demonstrates is the only one worth learning about the editor: **the line the caret is on
 * shows its raw markdown, every other line renders**. Hiding the markers on the line you are editing
 * would mean typing into characters you cannot see, so they come back exactly where you are working —
 * and nowhere else.
 */
function LivePreviewDemo() {
	const [caret, setCaret] = useState(1)

	return (
		<div className="lb-lp">
			<div className="lb-lp__note">
				{LINES.map((line, i) => (
					<button
						key={line.raw}
						className={i === caret ? 'lb-lp__line lb-lp__line--on' : 'lb-lp__line'}
						onClick={() => setCaret(i)}
						aria-label={`Put the caret on line ${i + 1}`}
					>
						{i === caret ? (
							<span className="lb-lp__raw">
								{line.raw}
								<span className="lb-demo__caret" />
							</span>
						) : (
							line.rendered
						)}
					</button>
				))}
			</div>
			<div className="lb-demo__hint">
				click a line to put the caret on it — the source never changed, only what is drawn
			</div>
		</div>
	)
}

/* ----------------------------------------------------------- tasks from the card */

const NOTE_STEPS = [1600, 1400, 1600, 900, 2600] as const

function NoteDemo() {
	const { step, ref } = useDemo(NOTE_STEPS)
	const editing = step < 2
	const ticked = step >= 4

	return (
		<div
			className="lb-demo"
			ref={ref}
			role="img"
			aria-label="Writing a checklist in a note, then ticking a task from the rendered card"
		>
			<div className="lb-demo__scene">
				<div className={editing ? 'lb-demo__note lb-demo__note--editing' : 'lb-demo__note'}>
					{editing ? (
						<div className="lb-demo__source">
							<div>
								- [ ] Order the desk
								{step === 0 && <span className="lb-demo__caret" />}
							</div>
							{step >= 1 && (
								<div>
									- [ ] Pick a chair
									<span className="lb-demo__caret" />
								</div>
							)}
						</div>
					) : (
						<div className="lb-demo__tasks">
							<div className={ticked ? 'lb-demo__task lb-demo__task--done' : 'lb-demo__task'}>
								<span className="lb-demo__box" aria-hidden="true">
									{ticked ? '✓' : ''}
								</span>
								Order the desk
							</div>
							<div className="lb-demo__task">
								<span className="lb-demo__box" aria-hidden="true" />
								Pick a chair
							</div>
						</div>
					)}
				</div>
				<Cursor x={step >= 3 ? 54 : 320} y={step >= 3 ? 50 : 185} shown={step >= 2} />
			</div>
			<div className="lb-demo__hint">
				{editing ? (
					<>
						markdown source — <kbd className="lb-kbd">⇧⌘9</kbd> makes a checklist
					</>
				) : (
					'the rendered card — tasks tick without entering the editor'
				)}
			</div>
		</div>
	)
}

/* -------------------------------------------------------------------- syntax */

const SYNTAX: [string, string][] = [
	['# / ## / ###', 'Headings, three sizes deep and beyond'],
	['**bold**  *italic*', 'Emphasis'],
	['~~struck~~  `code`', 'Strikethrough and inline code'],
	['- item', 'A bullet list, which continues itself on Enter'],
	['1. item', 'A numbered list'],
	['- [ ] task', 'A checklist, tickable from the card'],
	['> quoted', 'A block quote'],
	['```', 'A fenced code block — expressions inside are left alone'],
	['| a | b |', 'A GFM table'],
	['![](…)', 'An image, including one dragged onto the board'],
	['[text](url)', 'A link — shown, but inert inside a shape'],
]

const NOTE_KEYS: [string[], string][] = [
	[['⌘Enter'], 'Tick the task under the caret — or, off a task line, finish editing'],
	[['Enter'], 'Continue the list; on an empty item, leave it'],
	[['Tab', '⇧Tab'], 'Nest and un-nest'],
	[['⌫'], 'Just after a list marker, removes the marker rather than joining lines'],
	[['⌘B', '⌘I'], 'Bold, italic'],
	[['⌘E'], 'Inline code'],
	[['⇧⌘X'], 'Strikethrough'],
	[['⇧⌘7'], 'Numbered list'],
	[['⇧⌘8'], 'Bullet list'],
	[['⇧⌘9'], 'Checklist'],
	[['⇧⌘.'], 'Quote'],
	[['Esc'], 'Stop editing and keep the shape selected'],
]

/* ---------------------------------------------------------------------- the page */

export function Notes() {
	return (
		<>
			<Section title="The source text is the truth">
				<p>
					A note is a markdown string, and the card is its rendering. That is not an implementation
					detail — it is the reason a note is portable, diffable, pasteable into anything, and readable
					by a script that has never heard of this app. Nothing is stored as styled boxes.
				</p>
				<p>
					Double-click to write; press <kbd className="lb-kbd">Esc</kbd> to step back out. While you
					write, the markdown renders in place and the raw syntax appears only on the line you are on.
				</p>
				<LivePreviewDemo />
			</Section>

			<Section title="Lists, and tasks that tick from the card">
				<p>
					Enter continues a list and knows when you have finished one. <kbd className="lb-kbd">⇧⌘9</kbd>{' '}
					turns every selected line into a checklist in one press. And a finished task can be ticked
					straight from the rendered card — no double-click, no editor, because ticking something off is
					not editing prose.
				</p>
				<NoteDemo />
			</Section>

			<Section title="What the syntax gets you">
				<div className="lb-help__syntax">
					{SYNTAX.map(([code, what]) => (
						<div className="lb-help__syntaxrow" key={code}>
							<code>{code}</code>
							<span>{what}</span>
						</div>
					))}
				</div>
				<p className="lb-help__aside">
					Raw HTML is deliberately not enabled, so there is nothing to sanitise and nothing a pasted
					note can do to the app. A single newline is a line break, as it is in Obsidian — pressing
					Enter always visibly does something.
				</p>
			</Section>

			<Section title="Keys while writing">
				<div className="lb-help__keygroup">
					{NOTE_KEYS.map(([keys, what]) => (
						<div className="lb-help__keyrow" key={what}>
							<Keys keys={keys} />
							<span>{what}</span>
						</div>
					))}
				</div>
			</Section>

			<Section title="How big a note is">
				<p>
					A new note grows with what you write. Drag its <strong>top or bottom</strong> handle and you
					have said you want that height: it keeps it and scrolls its own content instead. Dragging a
					side or corner changes the width, and the height re-derives from the reflow.
				</p>
				<p className="lb-help__aside">
					A note carries properties and expressions like any other shape — the markdown is what it{' '}
					<em>says</em>, the properties are what it <em>is</em>, and the two never fight because
					double-click edits the first and <kbd className="lb-kbd">⌥P</kbd> opens the second.
				</p>
			</Section>

			<Section title="Drop a link and you get a note, not a card">
				<p>
					Drag a URL onto the board, or paste one, and it lands as a note carrying a{' '}
					<strong>Link</strong> property — titled with the site it came from. The link is in the
					prose too, so it is still one click away.
				</p>
				<p>
					A card would have been easier and is the wrong thing here: a card cannot hold a price, be
					counted by a table, stand on a calendar or answer an expression. A note with a property
					can, so a page you saved is something you can <em>file</em> rather than only look at.
				</p>
				<p className="lb-help__aside">
					The title is the site rather than the page&rsquo;s own, because reading a page&rsquo;s title
					means asking a server for it, and nothing here talks to one. Rename it in the properties
					panel — the note is ordinary once it exists.
				</p>
			</Section>
		</>
	)
}

import { BOOK_FILE_SUFFIXES, HIGHLIGHT_TAGS, VIEW_MODE_LABELS } from '@lifeboard/book-reader'
import { useState } from 'react'
import { Jump, Keys, Section, Tabs, useDemo, type SectionProps } from '../kit'

/* ------------------------------------------------------- a file becomes a card */

const IMPORT_STEPS = [1500, 900, 1200, 2600] as const

/**
 * A dropped file turning into a cover card with properties under it.
 *
 * The property strip is the part worth animating. A cover appearing is what anyone would expect from
 * "drop a book on a canvas"; Author and Pages arriving *as properties* is the claim this extension
 * actually makes, and it happens a beat later than the picture does.
 */
function ImportDemo() {
	const { step, ref } = useDemo(IMPORT_STEPS)
	const landed = step >= 1
	const read = step >= 2

	return (
		<div
			className="lb-demo"
			ref={ref}
			role="img"
			aria-label="An EPUB file dropped on the board becoming a cover card, with author and page count arriving as properties"
		>
			<div className="lb-demo__scene">
				<div className={landed ? 'lb-demo__file lb-demo__file--gone' : 'lb-demo__file'}>
					dune.epub
				</div>
				<div className="lb-demo__bookwrap">
					<div className={landed ? 'lb-demo__book lb-demo__pop lb-demo__pop--in' : 'lb-demo__book lb-demo__pop'}>
						<span className="lb-demo__booktitle">{read ? 'Dune' : 'dune'}</span>
						<span className="lb-demo__bookauthor">{read ? 'Frank Herbert' : ''}</span>
					</div>
					<div className={read ? 'lb-demo__strip lb-demo__pop--in' : 'lb-demo__strip'}>
						<span className="lb-demo__stripname">Author</span>
						<span className="lb-demo__stripvalue">Frank Herbert</span>
					</div>
					<div className={read ? 'lb-demo__strip lb-demo__pop--in' : 'lb-demo__strip'}>
						<span className="lb-demo__stripname">Pages</span>
						<span className="lb-demo__stripvalue">412</span>
					</div>
				</div>
			</div>
			<div className="lb-demo__hint">
				{read
					? 'title, author and page count came out of the file — as properties, like any other shape'
					: 'drop the file anywhere on the board'}
			</div>
		</div>
	)
}

/* --------------------------------------------------------- a passage becomes a card */

const QUOTE_STEPS = [1400, 900, 1300, 2600] as const

const PASSAGE = 'A beginning is the time for taking the most delicate care that the balances are correct.'

/**
 * Selecting in the reader, and the quote landing on the board related to the book.
 *
 * The link is drawn here — as "All relations" draws it on a real board — because it is the difference
 * between this and a screenshot pasted into a note: a bound arrow is a relation the board can follow,
 * so "everything I took out of this book" is a question a table can answer. On the board itself the
 * relation is made hidden, which changes nothing about that.
 */
function QuoteDemo() {
	const { step, ref } = useDemo(QUOTE_STEPS)
	const selected = step >= 1
	const taken = step >= 2

	return (
		<div
			className="lb-demo"
			ref={ref}
			role="img"
			aria-label="Selecting a passage while reading, which lands on the board as a quote card related to the book"
		>
			<div className="lb-demo__scene">
				<div className="lb-demo__page">
					<span className="lb-demo__pageline" />
					<span className="lb-demo__pageline" />
					<span className={selected ? 'lb-demo__passage lb-demo__passage--on' : 'lb-demo__passage'}>
						{PASSAGE}
					</span>
					<span className="lb-demo__pageline" />
				</div>
				<svg className="lb-demo__wire" viewBox="0 0 640 240" preserveAspectRatio="none" aria-hidden="true">
					<path
						className={taken ? 'lb-demo__wirepath lb-demo__wirepath--bound' : 'lb-demo__wirepath'}
						d="M 300 118 C 344 118, 366 118, 400 118"
						pathLength={1}
					/>
					<path
						className={taken ? 'lb-demo__wirehead lb-demo__wirehead--on' : 'lb-demo__wirehead'}
						d="M 400 118 l -13 -6 m 13 6 l -13 6"
					/>
				</svg>
				<div className={taken ? 'lb-demo__quote lb-demo__pop lb-demo__pop--in' : 'lb-demo__quote lb-demo__pop'}>
					<span className="lb-demo__quotemark" aria-hidden="true">
						❞
					</span>
					<span className="lb-demo__quotetext">{PASSAGE}</span>
					<span className="lb-demo__quotefoot">
						<span className="lb-demo__tag">Key</span>
						<span>Page 12</span>
					</span>
				</div>
			</div>
			<div className="lb-demo__hint">
				{taken
					? 'the card knows which page it came from — double-click it to land back there'
					: 'select while reading; the highlight buttons appear at the selection'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ the reader's chrome */

type ReaderBit = { id: string; label: string; blurb: string }

const READER_BITS: ReaderBit[] = [
	{
		id: 'contents',
		label: 'Contents',
		blurb:
			"The book's own table of contents, as far down as it nests. Jumping from it moves your position, which means it also moves the progress property.",
	},
	{
		id: 'view',
		label: 'Layout',
		blurb: `${VIEW_MODE_LABELS.page}, ${VIEW_MODE_LABELS.spread.toLowerCase()} side by side, or ${VIEW_MODE_LABELS.scroll.toLowerCase()} — the same three choices whether the book has fixed pages or reflows. A choice about how you are reading rather than about the book, so it is not written to the shape.`,
	},
	{
		id: 'clip',
		label: 'Clip',
		blurb:
			'For everything a text selection cannot take: a diagram, a table, a page of a comic. Drag a region — or clip the whole page — and the picture lands on the board as a quote card, linked back the same way.',
	},
	{
		id: 'settings',
		label: 'Reading settings',
		blurb:
			'Typography, page shape and the page-turn animation. App-wide, not per book: they describe how you like to read, and having to re-choose a font for every file would be absurd.',
	},
]

/** The reader's chrome, as a thing to click rather than a screenshot of a thing to click. */
function ReaderTour() {
	const [activeId, setActiveId] = useState(READER_BITS[0]!.id)
	const active = READER_BITS.find((bit) => bit.id === activeId) ?? READER_BITS[0]!

	return (
		<div className="lb-help-dockdemo">
			<Tabs
				label="Reader controls"
				value={activeId}
				options={READER_BITS}
				onChange={setActiveId}
			/>
			<div className="lb-help-dockdemo__info">
				<div className="lb-help-dockdemo__name">{active.label}</div>
				<p>{active.blurb}</p>
			</div>
		</div>
	)
}

/* --------------------------------------------------------------------------- keys */

const READER_KEYS: [string[], string][] = [
	[['→', 'PageDown', 'Space'], 'Next page'],
	[['←', 'PageUp'], 'Previous page'],
	[['Esc'], 'Close whatever is open — the contents, the settings, then the reader itself'],
	[['double-click'], 'On a cover, read it; on a quote, open its book at that passage'],
]

/* ----------------------------------------------------------------------- the page */

// Mirrors the bundled faces in book-reader's `reader/fonts.ts`. Named by hand, unlike the formats
// and tags above, because reaching them means importing the module that carries the font-file URLs
// — and the help page has no business pulling four typefaces' worth of assets into its chunk.
const FONT_LABELS = ['Literata', 'Source Serif', 'EB Garamond', 'Open Sans']

export function Books({ go }: SectionProps) {
	return (
		<>
			<Section title="Drop a file, get a card">
				<p>
					Drag a book onto the board — {BOOK_FILE_SUFFIXES.map((s) => `.${s}`).join(', ')} — and it
					becomes a cover card. The title, author, page count and cover art are read out of the file
					itself, and the metadata does not stop at the picture:{' '}
					<strong>Author and Pages land in the property system</strong>, so a shelf of books can be
					filtered, grouped and counted by a <Jump to="tables" go={go}>table</Jump> exactly like
					anything else on the canvas.
				</p>
				<ImportDemo />
				<p className="lb-help__aside">
					The file is stored in the board, not linked from your disk — moving the original later
					changes nothing. <code>Import a book…</code> in the command palette does the same thing for
					anyone who would rather not drag, and a book placed from the dock is an empty card that asks
					for a file when you open it. A comic — <code>.cbz</code> or <code>.cbr</code> — is a stack of
					images rather than a book with a title page, so what comes out of it is a page count and a
					cover; the title stays the one its file name gave it.
				</p>
			</Section>

			<Section title="Double-click to read">
				<p>
					A cover opens full-screen, in the app rather than in a viewer somewhere else, and{' '}
					<strong>remembers where you stopped</strong> — per book, on the shape, so the position
					survives a reload and travels in an export. Turning a page never touches the undo history:{' '}
					<kbd className="lb-kbd">⌘Z</kbd> is for things you did to the board, and reading is not one
					of them.
				</p>
				<ReaderTour />
				<p>
					How far through you are is written back as a <strong>Reading progress</strong> property, and
					only once you have actually opened the book — a book you have never read carries no progress
					rather than a proud 0%. It is an ordinary <Jump to="properties" go={go}>property</Jump> from
					there on: it draws the same bar, and a table can average it.
				</p>
			</Section>

			<Section title="A passage becomes a card">
				<p>
					Select text while reading and the highlight buttons appear at the selection — one per tag (
					{HIGHLIGHT_TAGS.join(', ')}). Pick one and the excerpt lands on the board as a quote card,
					related to the book, with the tag as a coloured property and the mark left behind in the
					book in the same colour.
				</p>
				<QuoteDemo />
				<p>
					That link is doing real work. A bound arrow is a{' '}
					<Jump to="relations" go={go}>relation</Jump>, so "everything I took out of this book" is a
					question the board can answer rather than a spatial arrangement you have to maintain by hand.
					The quote's own record of <em>where</em> — a page number, or an EPUB position — is what an
					arrow cannot carry, and is what makes the card a handle: double-click it and the book opens
					at that passage.
				</p>
				<p className="lb-help__aside">
					The relation is <strong>hidden</strong>: a reading session makes a column of quotes, and a
					line from every one of them back to the book would say what each card already says. Tables
					and rollups count it exactly the same, and "All relations" — or the eye button on one you
					select — draws it when you want to see it.
				</p>
				<p className="lb-help__aside">
					Quotes are prose, so they survive their source. Delete the book and the excerpt keeps
					rendering; it simply has nowhere left to jump to. Tagging is optional, the link can be
					switched off in the reading settings, and the tags themselves — names and colours — are
					yours to change.
				</p>
			</Section>

			<Section title="Set up how you read">
				<p>
					The reading settings are one panel, opened from the reader and applied everywhere: font (
					{FONT_LABELS.join(', ')}, or whatever the publisher chose), size, line spacing, page width
					and margins, text and page colour, and the page-turn animation — none, slide, peel or curl,
					with its speed. Fixed-layout books get their own: zoom, render quality, and how many pages to
					prepare ahead.
				</p>
				<p className="lb-help__aside">
					Nothing here is stored per book, and nothing here is stored on the board. These are
					preferences about your eyes, so they live with the app — the same reasoning as the grid and
					the theme in Settings.
				</p>
			</Section>

			<Section title="Filling in what the file could not say">
				<p>
					Plenty of files carry no metadata worth the name: a scan called{' '}
					<code>book_final_v2.pdf</code>, an EPUB whose author field is a typesetter's initials.{' '}
					<code>Find book details…</code> — on a cover's right-click menu, or in the palette — looks the
					book up in Open Library and offers the matches. Take one and the title, author, cover, page
					count, publication year, ISBN and a link to the catalogue entry are written in.
				</p>
				<p className="lb-help__aside">
					This is the only time this extension talks to the network, and it happens because you asked.
					Dropping a file on the canvas does not tell a catalogue what you are reading.
				</p>
			</Section>

			<Section title="Keys while reading">
				<div className="lb-help__keygroup">
					{READER_KEYS.map(([keys, what]) => (
						<div className="lb-help__keyrow" key={what}>
							<Keys keys={keys} />
							<span>{what}</span>
						</div>
					))}
				</div>
				<p className="lb-help__aside">
					Books can be switched off like any extension, in Settings → Extensions. Dropped files stop
					being claimed and the reader goes away — but the books and quotes already on your boards keep
					rendering, because turning an extension off hides it from the places that make things, never
					from the things you already made.
				</p>
			</Section>
		</>
	)
}

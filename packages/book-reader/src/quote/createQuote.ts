import {
	connectShapes,
	createProperty,
	getAssetBridge,
	updateShapeProperties,
} from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { highlightProperty, QUOTE_MIN_HEIGHT, QUOTE_NODE_TYPE, type HighlightTag } from './definition'

/** Gap between the book and the column of quotes taken from it. */
const COLUMN_GAP = 80
/** Vertical gap between stacked quotes. */
const STACK_GAP = 16
const QUOTE_WIDTH = 280

export interface NewQuote {
	/** The excerpt. Empty when `image` is given. */
	text?: string
	/** A clipped page, stored as its own blob. */
	image?: Blob
	/** Page number (PDF) or CFI (everything else) — the deep link's target. */
	location: string
	/** How that location reads on the card: "Page 12". */
	locationLabel: string
	/** Encoded page-fraction rectangles, so the passage can be marked in the book. */
	rects?: string
	/** What the passage is for — one of `HIGHLIGHT_TAGS`. Absent means an untagged quote. */
	tag?: string
}

/**
 * Puts an excerpt on the board beside its book, related to it.
 *
 * The relation is the point. Lifeboard already treats a fully bound arrow as one (`edges.ts`), so a
 * quote arrives as a *queryable* edge — a table can ask a book for everything taken out of it —
 * rather than as a card that merely happens to sit nearby. The quote's own `location` prop then
 * carries what an arrow cannot: where in the book the passage is. It is created **hidden**, which
 * changes nothing about any of that; see the call below.
 *
 * One undo entry for the whole thing: pressing ⌘Z after collecting a quote removes the card and its
 * relation together, because half a quote is not a state anyone wants to land in.
 */
export async function addQuoteToBoard(
	editor: Editor,
	bookId: TLShapeId,
	quote: NewQuote,
	/** Whether to relate the quote to its book. Off leaves the card standing on its own. */
	withArrow = true,
	/** The tags as configured, so the property carries their names *and* their colours. */
	tags: readonly HighlightTag[] = []
): Promise<TLShapeId | null> {
	const book = editor.getShape(bookId)
	if (!book) return null

	// Awaited before the shape exists, so no snapshot ever references a hash that isn't stored yet.
	const imageSrc = quote.image ? await getAssetBridge().store(quote.image) : ''
	// The book may have been deleted while the blob was being written.
	if (!editor.getShape(bookId)) return null

	const quoteId = createShapeId()
	editor.run(() => {
		editor.createShape({
			id: quoteId,
			type: QUOTE_NODE_TYPE,
			...nextQuotePosition(editor, bookId),
			props: {
				text: quote.text ?? '',
				imageSrc,
				sourceId: bookId,
				location: quote.location,
				locationLabel: quote.locationLabel,
				rects: quote.rects ?? '',
			},
		})

		/*
		 * The tag is a *property*, not a prop: it is what this passage means to you, which is data
		 * about the quote in exactly the sense the property system exists for — so it groups in
		 * tables and filters in collections like any other value. It also carries the colour, since
		 * a choice's hue comes from its label, which is what keeps the chip and the mark in the book
		 * the same colour without either knowing about the other.
		 */
		if (quote.tag) {
			const def = createProperty(editor, highlightProperty(tags))
			const created = editor.getShape(quoteId)
			if (def && created) updateShapeProperties(editor, created, { [def.id]: quote.tag })
		}

		/*
		 * **Hidden**, so the link is a fact rather than a line.
		 *
		 * A reading session produces a column of quotes, and a visible arrow from each one back to the
		 * book turns that column into a fan of lines over the board — every one of them saying the same
		 * thing the card already says, since a quote card names its source. What the arrow is *for* is
		 * the query: `edges.ts` counts a hidden relation exactly as it counts a drawn one, so a table
		 * can still ask a book for everything taken out of it. Hiding costs nothing there and buys back
		 * the board.
		 *
		 * Reversible either way: "All relations" draws every hidden one dashed, and the eye button on a
		 * selected relation (or ⌘K) unhides this one for good.
		 *
		 * No `markHistory`: we are already inside the `editor.run` that owns this quote's single undo
		 * entry, and the relation has to be part of it.
		 */
		if (withArrow) connectShapes(editor, bookId, quoteId, { hidden: true })
	})

	return quoteId
}

/**
 * Where the next quote goes: a column to the right of the book, below the quotes already taken from
 * it. Deliberately dumb — it stacks rather than searching for free space, because a reading session
 * produces a *sequence* of quotes and a tidy column is what you want to skim afterwards. Anything
 * cleverer would scatter them.
 */
function nextQuotePosition(editor: Editor, bookId: TLShapeId): { x: number; y: number } {
	const bounds = editor.getShapePageBounds(bookId)
	if (!bounds) return { x: 0, y: 0 }

	const x = bounds.maxX + COLUMN_GAP
	let y = bounds.y
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== QUOTE_NODE_TYPE) continue
		if ((shape.props as { sourceId?: string }).sourceId !== bookId) continue
		const existing = editor.getShapePageBounds(shape.id)
		if (existing) y = Math.max(y, existing.maxY + STACK_GAP)
	}
	return { x, y }
}

/** Width the reader should render page clips at — matches the card, at 2× for sharpness. */
export const CLIP_RENDER_WIDTH = QUOTE_WIDTH * 2
export { QUOTE_WIDTH, QUOTE_MIN_HEIGHT }

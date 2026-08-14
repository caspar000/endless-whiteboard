import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { Quote } from 'lucide-react'
import { T } from 'tldraw'
import { QuoteNodeComponent } from './QuoteNodeComponent'

export const QUOTE_NODE_TYPE = 'node.quote'

/**
 * What a quote is *for*, chosen as you take it — and the reason highlights have colours.
 *
 * Meanings rather than colour names, because the property system derives an option's colour by
 * hashing its label (see `optionHue`): an option called "Yellow" would be whatever hue the hash
 * lands on, which is worse than useless. Naming the reason instead makes the colour a consequence,
 * keeps the chip on the card and the mark in the book identical, and is what people actually use
 * highlight colours for.
 */
export const HIGHLIGHT_TAGS = ['Key', 'Question', 'Disagree', 'Follow up'] as const

/** A tag as the reader keeps it: what it is called, and what colour it means. */
export interface HighlightTag {
	label: string
	/** 0–359. Stored rather than hashed, because here the colour is the point. */
	hue: number
}

/**
 * The property a tag is written to, built from whatever tags are configured.
 *
 * The colours travel with it. `optionHues` is what keeps the chip on the card and the mark in the
 * book the same colour once the colour is chosen rather than hashed — both read it from here.
 */
export function highlightProperty(tags: readonly HighlightTag[]): {
	name: string
	type: 'select'
	options: string[]
	optionHues: Record<string, number>
} {
	return {
		name: 'Highlight',
		type: 'select',
		options: tags.map((tag) => tag.label),
		optionHues: Object.fromEntries(tags.map((tag) => [tag.label, tag.hue])),
	}
}

export interface QuoteNodeProps {
	/** The excerpt, verbatim. Empty for a page clip, which carries an image instead. */
	text: string
	/** `asset:<sha256>` of a clipped page image, or '' for a text quote. */
	imageSrc: string
	/**
	 * The book shape this came out of, as a plain id string.
	 *
	 * A *soft* reference on purpose: the quote outlives the book being deleted, still readable as
	 * prose, and the arrow between them is the relation the board reasons about (see `edges.ts`).
	 * This is what makes the deep link possible — the arrow says "these are related", this says
	 * "and here is exactly where in the book".
	 */
	sourceId: string
	/** Where in the book: a page number (PDF) or an EPUB CFI. The other half of the deep link. */
	location: string
	/** Human-readable form of `location` — "Page 12". Shown on the card; never parsed. */
	locationLabel: string
	/**
	 * Where the passage sits *on* its page, so the book can show what you took: rectangles in page
	 * fractions, encoded `x,y,w,h;x,y,w,h`.
	 *
	 * A string because props are bounded to JSON scalars (§7) — the same reason a `link` property
	 * encodes its title and URL into one. Fixed-layout formats only: a reflowable book has no
	 * geometry to remember, and does not need it, because its CFI *is* the range.
	 */
	rects: string
	/** See registry.tsx: `h` tracks the rendered quote until a vertical handle pins it. */
	autoHeight: boolean
}

export const QUOTE_MIN_HEIGHT = 64

const versions = createShapePropsMigrationIds('node.quote', { AddRects: 1 })

export const quoteNodeDefinition: NodeDefinition<QuoteNodeProps> = {
	type: QUOTE_NODE_TYPE,
	label: 'Quote',
	icon: '❞',
	toolbarIcon: Quote,
	// No `kbd`, and no useful empty state: a quote is made *from* a book, in the reader. It appears
	// in the dock for discoverability and because every node type does, but drawing a blank one is
	// not a workflow anyone wants.
	props: {
		text: T.string,
		imageSrc: T.string,
		sourceId: T.string,
		location: T.string,
		locationLabel: T.string,
		rects: T.string,
		autoHeight: T.boolean,
	},
	/**
	 * Quotes taken before highlights existed have no geometry, and cannot get any — the selection
	 * they came from is long gone. They keep working as cards and as deep links; they simply leave
	 * no mark in the book.
	 */
	migrations: createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddRects,
				up(props) {
					props.rects = ''
				},
			},
		],
	}),
	defaultProps: () => ({
		text: '',
		imageSrc: '',
		sourceId: '',
		location: '',
		locationLabel: '',
		rects: '',
		autoHeight: true,
	}),
	defaultSize: { w: 280, h: QUOTE_MIN_HEIGHT },
	autoHeight: { minHeight: QUOTE_MIN_HEIGHT },
	component: QuoteNodeComponent,
	/**
	 * Double-click opens the source book *at this quote* rather than an editor. That is the whole
	 * point of a quote card: the excerpt on the board is a handle on the passage it came from.
	 */
	canEdit: true,
	// Prose, like the note — its properties belong inside the card, not under it.
	getLabel: (shape) => quoteTitle(shape.props.text),
}

/** First words of the excerpt, for tables, rollup groups and pickers. */
export function quoteTitle(text: string): string {
	const trimmed = text.trim().replace(/\s+/g, ' ')
	if (!trimmed) return ''
	return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed
}

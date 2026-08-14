/**
 * How the pages are laid out. The same three choices in both engines, even though they mean
 * slightly different things: a PDF has fixed pages to place side by side, while a reflowable book
 * has columns. Naming them for the *reading experience* rather than the mechanism is what lets one
 * control drive both.
 */
export const VIEW_MODES = ['page', 'spread', 'scroll'] as const
export type ViewMode = (typeof VIEW_MODES)[number]

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
	page: 'Single page',
	spread: 'Two pages',
	scroll: 'Scrolling',
}

/** One entry in a book's table of contents, flattened with its nesting depth. */
export interface TocItem {
	label: string
	/** Opaque to the panel — a page number for a PDF, an href for an EPUB. */
	target: string
	depth: number
}

/**
 * What a reader hands back once it has a book open, so the chrome around it can drive navigation
 * without knowing which engine is underneath.
 */
export interface ReaderApi {
	toc: readonly TocItem[]
	goTo(target: string): void
	/**
	 * Clips the whole of the page you are on. Fixed-page formats only — "the current page" is a fact
	 * the reader owns (the left one in a spread, whatever you have scrolled to), so the chrome asks
	 * rather than tries to know.
	 */
	clipPage?(): void
}

/**
 * A quote of this book, as the reader needs to draw it back into the page.
 *
 * The reader knows nothing about quote cards beyond this: where the passage is, what colour it
 * should be, and which shape to select if you click it.
 */
export interface Highlight {
	quoteId: string
	/** Page number (fixed-layout) or CFI (reflowable) — the same string the quote stores. */
	location: string
	/** Encoded page-fraction rectangles. Empty for reflowable books, which redraw from the CFI. */
	rects: string
	/**
	 * The hue of the quote's tag, or null when it has none. Comes from the property system's own
	 * hash, so a mark and its chip on the card are always the same colour.
	 */
	hue: number | null
}

/** A live text selection inside the book, in the shape the quote button needs. */
export interface ReaderSelection {
	text: string
	location: string
	locationLabel: string
	/** Encoded page-fraction rectangles of the selection, so the quote can leave a mark. */
	rects: string
	/** Client coordinates of the selected range, for placing the button beside it. */
	rect: { left: number; top: number; width: number }
}

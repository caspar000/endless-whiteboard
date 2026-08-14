/**
 * Hand-written types for foliate-js, which ships none. Only the surface this package uses is
 * declared — verified against the pinned commit's `view.js` (see package.json for the pin).
 */
declare module 'foliate-js/view.js' {
	export interface FoliateMetadata {
		/** A string or a language map (`{ en: '…' }`) — see `formatLanguageMap`. */
		title?: unknown
		/** A contributor, `{ name }`, or an array of either — see `formatContributors`. */
		author?: unknown
		language?: unknown
	}

	/** A node of the book's navigation document. Nested through `subitems`. */
	export interface FoliateTocItem {
		label?: string
		href?: string
		subitems?: FoliateTocItem[]
	}

	export interface FoliateBook {
		metadata?: FoliateMetadata
		toc?: FoliateTocItem[]
		getCover?(): Promise<Blob | null>
	}

	/** Parses any supported format (EPUB, MOBI/KF8, FB2, CBZ; zip and zlib are vendored). */
	export function makeBook(file: File): Promise<FoliateBook>

	export interface FoliateRenderer extends HTMLElement {
		/** Injects user stylesheet into reflowable book content. Absent on the fixed-layout renderer. */
		setStyles?(css: string): void
		/** The section documents currently mounted — how to reach the page's own DOM. */
		getContents?(): { doc: Document; index: number }[]
	}

	/**
	 * The `<foliate-view>` custom element. Importing this module registers it; create instances with
	 * `document.createElement('foliate-view')`.
	 *
	 * Fires `relocate` (`CustomEvent` with `{ cfi, fraction }` among others) on every position change.
	 */
	export interface FoliateLocation {
		/** The TOC entry the current page falls under — the book's own name for where you are. */
		tocItem?: { label?: string } | null
		/**
		 * The book's *own* page number, when it declares a page-list mapping back to a print
		 * edition. Absent for the many EPUBs that do not, which is why `location` exists.
		 */
		pageItem?: { label?: string } | null
		/**
		 * Synthetic positions of a fixed character count — Kindle's "locations". A reflowable book
		 * has no pages until it is laid out, so this is the only stable count it can offer.
		 */
		location?: { current?: number; next?: number; total?: number } | null
		/** How far through the whole book, 0–1. */
		fraction?: number
	}

	/** Where the reader has been, so a cross-reference can be walked back from. */
	export interface FoliateHistory extends EventTarget {
		canGoBack: boolean
		canGoForward: boolean
		back(): void
		forward(): void
		clear(): void
	}

	export class View extends HTMLElement {
		book: FoliateBook
		renderer: FoliateRenderer
		history: FoliateHistory
		/** Updated on every `relocate`; null before the first one. */
		lastLocation: FoliateLocation | null
		/** A durable pointer to a range within a section — the location half of a quote. */
		getCFI(index: number, range: Range): string
		open(book: File | FoliateBook): Promise<void>
		close(): void
		/**
		 * Registers a mark at a CFI. foliate resolves it against the current layout and emits
		 * `draw-annotation` whenever that section is on screen; clicking one emits `show-annotation`.
		 * Removes any existing mark with the same value first, so calling it again is safe.
		 */
		addAnnotation(annotation: { value: string }): Promise<unknown>
		deleteAnnotation(annotation: { value: string }): Promise<unknown>
		/** Goes to `lastLocation` (a CFI from a previous session) or the book's start. */
		init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
		goTo(target: string | number): Promise<unknown>
		/** Jumps to a fraction of the whole book — what the progress bar seeks with. */
		goToFraction(fraction: number): Promise<unknown>
		/** `prev`/`next` respecting the book's reading direction. */
		goLeft(): Promise<void>
		goRight(): Promise<void>
		prev(distance?: number): Promise<void>
		next(distance?: number): Promise<void>
	}
}

declare module 'foliate-js/footnotes.js' {
	import type { FoliateBook, View } from 'foliate-js/view.js'

	/**
	 * Recognises a footnote reference (`epub:type="noteref"`, `role="doc-noteref"`, or a superscript
	 * link) and, instead of navigating to it, renders *just that note* into a throwaway `<foliate-view>`
	 * for the caller to show in place. `render` carries that view; the caller owns mounting it.
	 */
	export class FootnoteHandler extends EventTarget {
		/** Whether to use the superscript heuristic as well as the declared types. */
		detectFootnotes: boolean
		/** Call from a `link` listener. Cancels the event for a footnote, and resolves once rendered. */
		handle(book: FoliateBook, event: Event): Promise<void> | undefined
	}

	export interface FootnoteRenderDetail {
		view: View
		href: string
		/** 'footnote' | 'endnote' | 'note' | 'biblioentry' | 'definition', or null if undeclared. */
		type: string | null
		hidden: boolean
	}
}

declare module 'foliate-js/overlayer.js' {
	/** Draw functions for annotations. `highlight` is the translucent block a highlighter leaves. */
	export class Overlayer {
		static highlight(rects: unknown, options?: { color?: string }): unknown
		static underline(rects: unknown, options?: { color?: string }): unknown
	}
}

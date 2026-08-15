/**
 * `@lifeboard/book-reader` — books as first-class whiteboard nodes.
 *
 * Reaches the host only through `@lifeboard/node-kit`'s public barrel, like every extension. The
 * heavy renderers (pdf.js, foliate-js) are dynamic imports behind the drop and the reader, so the
 * extension costs nothing until a book actually arrives.
 */

// Registers `node.book` with tldraw's type system. Side-effect import, kept above the exports.
import './shape-types'

export { bookReaderExtension } from './extension'
export { BOOK_NODE_TYPE, bookNodeDefinition, type BookNodeProps } from './definition'
export {
	BOOK_FILE_SUFFIXES,
	detectBookFormat,
	formatContributors,
	formatLanguageMap,
	titleFromFileName,
	type BookFormat,
} from './formats'
export { bookFileImport, loadBookIntoShape } from './importBook'
export {
	HIGHLIGHT_TAGS,
	QUOTE_NODE_TYPE,
	quoteNodeDefinition,
	quoteTitle,
	type QuoteNodeProps,
} from './quote/definition'
/*
 * For the app's Help page, which describes what the reader offers and should not have to keep its
 * own copy of the tag names or the view modes. Both are plain string tables; nothing that draws a
 * page is reachable from here.
 */
export { VIEW_MODE_LABELS, VIEW_MODES, type ViewMode } from './reader/types'
export { addQuoteToBoard, type NewQuote } from './quote/createQuote'
export {
	parseSearchResponse,
	searchOpenLibrary,
	workUrl,
	type BookMatch,
} from './enrich/openLibrary'
export { applyMatch } from './enrich/applyMatch'

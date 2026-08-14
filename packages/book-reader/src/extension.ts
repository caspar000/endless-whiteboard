import { defineNode, type Extension, type ShapeAction } from '@lifeboard/node-kit'
import { BookOpen, Sparkles } from 'lucide-react'
import { bookCommands } from './commands'
import { BOOK_NODE_TYPE, bookNodeDefinition } from './definition'
import { openEnrich } from './enrich/enrichTarget'
import { bookFileImport } from './importBook'
import { quoteNodeDefinition } from './quote/definition'

/**
 * Look a book up in Open Library and fill in what the file could not say.
 *
 * A context-menu action, and emphatically not something that happens on import: this is the app's
 * only outbound call on a book's behalf, and a local-first tool does not phone a catalogue about
 * your library because you dropped a file on the canvas. You ask; then it asks.
 */
const findDetailsAction: ShapeAction = {
	id: 'lifeboard.book-reader.find-details',
	label: 'Find book details…',
	icon: Sparkles,
	appliesTo: (shape) => shape.type === BOOK_NODE_TYPE,
	run: ({ shape }) => openEnrich(shape.id),
}

/**
 * Books on the whiteboard: drop a PDF/EPUB/MOBI/FB2/CBZ and it becomes a cover card whose author
 * and page count land in the property system; double-click reads it full-screen and remembers the
 * position; select a passage and it lands on the board as a quote, arrow-linked back to the book
 * and still pointing at the exact page it came from.
 *
 * The first extension to contribute a `fileImport` alongside its nodes.
 */
export const bookReaderExtension: Extension = {
	id: 'lifeboard.book-reader',
	name: 'Books',
	description:
		'Drop PDF, EPUB, MOBI, FB2 or CBZ files onto the board. Covers become cards, double-click opens a full-screen reader, and passages you select become quote cards linked back to the page they came from.',
	details: [
		'Drop a book file onto a board and it becomes a cover card. The title, author and page count are read out of the file and land in the property system, so books can be filtered, grouped and counted by a table like anything else on the canvas.',
		'Double-click a cover to read it full-screen. The reader remembers where you stopped, per book, and has its own typography settings. Select a passage while reading and it lands on the board as a quote card, arrow-linked back to the book and still pointing at the page it came from.',
		'“Find book details…” on a cover’s context menu looks the book up in Open Library and fills in what the file could not say. It is the only time this extension talks to the network, and only when you ask.',
		'Turning this off stops books from being imported on drop and hides the reader. Books and quotes already on your boards keep rendering.',
	],
	icon: BookOpen,
	version: '0.3.0',
	author: 'Lifeboard',
	nodes: [defineNode(bookNodeDefinition), defineNode(quoteNodeDefinition)],
	commands: bookCommands,
	fileImports: [bookFileImport],
	actions: [findDetailsAction],
}

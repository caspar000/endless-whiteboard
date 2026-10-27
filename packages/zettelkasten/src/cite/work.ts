import type { Editor, TLShape, TLShapeId } from '@lifeboard/canvas'
import { readPropertyRegistry, readShapeProperties } from '@lifeboard/node-kit'
import type { SourceProps } from '../box'

/**
 * What a box needs to cite a work kept somewhere else on the board: a book from the Books extension, or
 * a quote taken from one (docs/zettelkasten-plan.md, phase 7). Read by type name and props, not by
 * importing Books: one extension never reaches into another, and a board where Books is off still has
 * its books to cite.
 */

const BOOK_TYPE = 'node.book'
const QUOTE_TYPE = 'node.quote'

export function isCitable(shape: { type: string } | null | undefined): boolean {
	return shape?.type === BOOK_TYPE || shape?.type === QUOTE_TYPE
}

/** The year a book came out, when looking it up filled in its "Published" property. */
function publishedYear(editor: Editor, book: TLShape): string {
	const published = readPropertyRegistry(editor).find((def) => def.name.trim().toLowerCase() === 'published')
	if (!published) return ''
	const value = readShapeProperties(book as never)[published.id]
	return value === null || value === undefined ? '' : String(value).trim()
}

export type Work = Pick<SourceProps, 'author' | 'title' | 'year' | 'note'>

/**
 * The work a book or quote card stands for: the book's author, title and year. A quote cites its book;
 * a quote with no book card on the board has nothing to cite.
 */
export function workOf(editor: Editor, shape: TLShape): Work | null {
	// Books' types aren't this package's to know (they are declared by Books), so compared as names.
	const type: string = shape.type
	if (type === BOOK_TYPE) {
		const props = shape.props as unknown as { title?: string; author?: string; fileName?: string }
		const title = props.title?.trim() || props.fileName?.replace(/\.[a-z0-9]+$/i, '').trim() || ''
		return { author: props.author?.trim() ?? '', title, year: publishedYear(editor, shape), note: '' }
	}
	if (type === QUOTE_TYPE) {
		const props = shape.props as unknown as { sourceId?: string }
		const book = props.sourceId ? editor.getShape(props.sourceId as TLShapeId) : undefined
		if (book && (book.type as string) === BOOK_TYPE) return workOf(editor, book)
		return null
	}
	return null
}

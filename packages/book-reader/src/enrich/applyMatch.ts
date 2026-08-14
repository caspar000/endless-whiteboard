import { createProperty, getAssetBridge, updateShapeProperties } from '@lifeboard/node-kit'
import type { Editor, TLShapeId, TLShapePartial } from 'tldraw'
import { BOOK_NODE_TYPE } from '../definition'
import { fetchCover, workUrl, type BookMatch } from './openLibrary'

/**
 * The catalogue facts a match carries, as properties.
 *
 * Properties rather than props, for the same reason reading progress is one: this is *data about
 * the book*, so it belongs where tables, rollups and `{…}` expressions can already see it. A board
 * of enriched books can then answer "everything published before 1980" with no new machinery.
 */
const AUTHOR_PROPERTY = { name: 'Author', type: 'text' } as const
const PAGES_PROPERTY = { name: 'Pages', type: 'number' } as const
/**
 * Text, not number: a year is a label, and the number type formats with thousands separators —
 * "1,969" for a book published in 1969, which reads as a mistake because it is one.
 */
const PUBLISHED_PROPERTY = { name: 'Published', type: 'text' } as const
const ISBN_PROPERTY = { name: 'ISBN', type: 'text' } as const
const CATALOGUE_PROPERTY = { name: 'Open Library', type: 'link' } as const

/**
 * Applies a chosen match to a book: its title and author, a real cover, and the catalogue facts.
 *
 * Everything the user can see change happens in **one undo entry**, because from where they sit
 * this was one decision. The cover is downloaded first, outside the transaction — a network round
 * trip inside an undo batch would be a batch held open on a stranger's server.
 *
 * Existing values are overwritten deliberately. The user picked this edition from a list; leaving
 * the filename-derived title in place because it happened to be there first would be second-
 * guessing them. Undo is right there if the match was wrong.
 */
export async function applyMatch(
	editor: Editor,
	bookId: TLShapeId,
	match: BookMatch
): Promise<boolean> {
	const shape = editor.getShape(bookId)
	if (!shape || shape.type !== BOOK_NODE_TYPE) return false

	const cover = await fetchCover(match)
	const coverSrc = cover ? await getAssetBridge().store(cover) : ''
	// The book may have been deleted while the cover was downloading.
	if (!editor.getShape(bookId)) return false

	editor.run(() => {
		editor.markHistoryStoppingPoint('book details')
		const props: Record<string, string | number> = { title: match.title }
		if (match.author) props.author = match.author
		if (match.pages) props.pageCount = match.pages
		if (coverSrc) props.coverSrc = coverSrc
		editor.updateShape({ id: bookId, type: BOOK_NODE_TYPE, props } as unknown as TLShapePartial)

		const values: Record<string, string | number> = {}
		const define = (spec: Parameters<typeof createProperty>[1], value: string | number) => {
			const def = createProperty(editor, spec)
			if (def) values[def.id] = value
		}
		if (match.author) define(AUTHOR_PROPERTY, match.author)
		if (match.pages) define(PAGES_PROPERTY, match.pages)
		if (match.year) define(PUBLISHED_PROPERTY, String(match.year))
		if (match.isbn) define(ISBN_PROPERTY, match.isbn)
		// Where this came from, so the claim is checkable rather than just asserted by the app.
		define(CATALOGUE_PROPERTY, `[${match.title}](${workUrl(match)})`)

		const current = editor.getShape(bookId)
		if (current && Object.keys(values).length) updateShapeProperties(editor, current, values)
	})

	return true
}

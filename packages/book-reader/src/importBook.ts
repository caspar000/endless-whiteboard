import {
	createProperty,
	getAssetBridge,
	updateShapeProperties,
	type FileImport,
} from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { BOOK_NODE_TYPE, bookNodeDefinition, type BookNodeProps } from './definition'
import { extractBookInfo, type BookInfo } from './extract'
import { BOOK_FILE_SUFFIXES, detectBookFormat, titleFromFileName, type BookFormat } from './formats'

/**
 * The drop path: a book file lands on the canvas and becomes a book node.
 *
 * Two-phase on purpose. The shape is created the moment the bytes are stored — filename as title,
 * jacket placeholder as cover — so a drop answers instantly and is exactly one undo entry. Parsing
 * the book (metadata, cover render) then runs behind it and fills the shape in with
 * `history: 'ignore'`, so the enrichment never becomes a second undo step and never races the
 * user's own edits on the undo stack.
 */
export const bookFileImport: FileImport = {
	extensions: BOOK_FILE_SUFFIXES,
	async onFile({ editor, file, point }) {
		const format = detectBookFormat(file.name)
		if (!format) return

		// Awaited before the shape exists, so no snapshot can reference a hash that isn't stored yet.
		const fileSrc = await getAssetBridge().store(file)

		const id = createShapeId()
		const { w, h } = bookNodeDefinition.defaultSize
		const seedTitle = titleFromFileName(file.name)
		editor.run(() => {
			editor.createShape({
				id,
				type: BOOK_NODE_TYPE,
				x: point.x - w / 2,
				y: point.y - h / 2,
				props: { fileSrc, fileName: file.name, format, title: seedTitle },
			})
			editor.select(id)
		})

		await enrichBookShape(editor, id, file, format, seedTitle)
	},
}

/**
 * The picker path: an empty book node (drawn from the dock) gets its file after the fact.
 * Unlike the drop path's enrichment, this write *is* the user's action, so it records normally.
 */
export async function loadBookIntoShape(editor: Editor, id: TLShapeId, file: File): Promise<void> {
	const format = detectBookFormat(file.name)
	if (!format) return

	const fileSrc = await getAssetBridge().store(file)
	if (!editor.getShape(id)) return
	const seedTitle = titleFromFileName(file.name)
	editor.run(() => {
		editor.updateShape({
			id,
			type: BOOK_NODE_TYPE,
			props: {
				fileSrc,
				fileName: file.name,
				format,
				title: seedTitle,
				author: '',
				coverSrc: '',
				pageCount: 0,
				location: '',
			},
		})
	})

	await enrichBookShape(editor, id, file, format, seedTitle)
}

/**
 * Fills in what the file itself can say, behind the card that is already on the board.
 *
 * Everything here is written as **fill, not overwrite**. Parsing a book takes long enough that the
 * user can act first — and one of the things they can do is look the book up in a catalogue, which
 * writes better values than the file has. Overwriting blindly meant a real cover being replaced by
 * a rendered first page seconds after it arrived. So a field is only set if it is still untouched:
 * empty, or in the title's case still the one derived from the filename.
 */
async function enrichBookShape(
	editor: Editor,
	id: TLShapeId,
	file: File,
	format: BookFormat,
	seedTitle: string
): Promise<void> {
	let info: BookInfo
	try {
		info = await extractBookInfo(file, format)
	} catch (error) {
		// A book that fails to parse still opened as a card; the reader will surface its own error.
		console.error(`Could not read book metadata from ${file.name}`, error)
		return
	}
	const coverSrc = info.cover ? await getAssetBridge().store(info.cover) : ''

	// The shape may be gone by now — deleted, or the drop undone — and must not resurrect.
	const current = editor.getShape(id)
	if (!current || current.type !== BOOK_NODE_TYPE) return
	const now = current.props as BookNodeProps

	editor.run(
		() => {
			const props: Record<string, string | number> = {}
			// Only if nobody has renamed it — including a catalogue lookup that already has.
			if (info.title && now.title === seedTitle) props.title = info.title
			if (info.author && !now.author) props.author = info.author
			if (info.pageCount && !now.pageCount) props.pageCount = info.pageCount
			if (coverSrc && !now.coverSrc) props.coverSrc = coverSrc
			if (Object.keys(props).length) editor.updateShape({ id, type: BOOK_NODE_TYPE, props })

			// Metadata doubles as board data: Author and Pages land in the property system, so tables,
			// rollups and `{…}` expressions can query books like any other node. Values live in
			// shape.meta and stay user-editable; the defs merge idempotently into the board registry.
			if (info.author && !now.author) {
				const def = createProperty(editor, { name: 'Author', type: 'text' })
				const shape = editor.getShape(id)
				if (def && shape) updateShapeProperties(editor, shape, { [def.id]: info.author })
			}
			if (info.pageCount && !now.pageCount) {
				const def = createProperty(editor, { name: 'Pages', type: 'number' })
				const shape = editor.getShape(id)
				if (def && shape) updateShapeProperties(editor, shape, { [def.id]: info.pageCount })
			}
		},
		// Inherited by the nested `run`s inside the property helpers (HistoryManager keeps the batch
		// state for the outermost batch), so the whole enrichment is invisible to undo.
		{ history: 'ignore' }
	)
}

import type { Command, CommandContext } from '@lifeboard/node-kit'
import type { Editor, TLShape } from 'tldraw'
import { BOOK_NODE_TYPE } from './definition'
import { openEnrich } from './enrich/enrichTarget'
import { BOOK_FILE_SUFFIXES } from './formats'
import { bookFileImport } from './importBook'

/**
 * What the extension offers the command palette — and, through the same table, the Help page's
 * shortcut list and any keymap that comes later.
 *
 * "Add book" is not here: the app generates one insert command per registered node type, so the
 * bare card is already offered. These are the three things that generation cannot know about — how
 * a book gets its *file*, and the two verbs that only mean anything with one selected.
 */

/**
 * The palette's Insert section, by value rather than by import: the group names are the app's
 * (`paletteItems.ts`), and an extension package must not depend on the app. Being wrong costs a
 * section — an unrecognised group renders as a trailing one of its own, which is exactly what the
 * palette does with any plugin's group.
 */
const INSERT_GROUP = 'Insert'
/** This extension's own section, for the verbs that act on a book already on the board. */
const BOOKS_GROUP = 'Books'

/** The one selected book, or null — these commands act on a book, not on a selection of them. */
function selectedBook(editor: Editor | null): TLShape | null {
	if (!editor) return null
	const ids = editor.getSelectedShapeIds()
	if (ids.length !== 1) return null
	const shape = ids[0] ? editor.getShape(ids[0]) : undefined
	return shape && shape.type === BOOK_NODE_TYPE ? shape : null
}

/**
 * Asks for book files the way the platform does.
 *
 * A picker rather than a drop, because the palette is where someone looks for "how do I add one of
 * these" and dropping a file — the primary path, and still the better one — is invisible until you
 * already know about it. The input is never in the document: `showOpenFilePicker` is Chromium-only,
 * and a detached `<input>` is the one method every browser answers.
 */
function pickBooks(): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input')
		input.type = 'file'
		input.multiple = true
		input.accept = BOOK_FILE_SUFFIXES.map((suffix) => `.${suffix}`).join(',')
		// Cancel resolves empty rather than never: `cancel` is not universal, so a dialog dismissed on
		// a browser without it simply leaves this promise pending — and it is awaited by nothing that
		// blocks.
		input.addEventListener('change', () => resolve([...(input.files ?? [])]))
		input.addEventListener('cancel', () => resolve([]))
		input.click()
	})
}

const onBoard = (ctx: CommandContext) => ctx.editor !== null

export const bookCommands: readonly Command[] = [
	{
		id: 'node.book.import',
		title: 'Import a book…',
		group: INSERT_GROUP,
		when: onBoard,
		run: async (ctx) => {
			const editor = ctx.editor
			if (!editor) return
			const files = await pickBooks()
			// Spread along the middle of the view, as a multi-file drop is: two books arriving on top
			// of each other look like one.
			const { center } = editor.getViewportPageBounds()
			for (const [index, file] of files.entries()) {
				await bookFileImport.onFile({
					editor,
					file,
					point: { x: center.x + index * 40, y: center.y + index * 40 },
				})
			}
		},
	},
	{
		id: 'node.book.read',
		title: 'Read book',
		group: BOOKS_GROUP,
		when: (ctx) => selectedBook(ctx.editor) !== null,
		run: (ctx) => {
			const shape = selectedBook(ctx.editor)
			// Editing a book *is* reading it — the same state double-clicking the card puts it in, so
			// the reader opens where it left off and closing it lands you back on the board.
			if (shape) ctx.editor?.setEditingShape(shape.id)
		},
	},
	{
		id: 'node.book.details',
		title: 'Find book details…',
		group: BOOKS_GROUP,
		when: (ctx) => selectedBook(ctx.editor) !== null,
		run: (ctx) => {
			const shape = selectedBook(ctx.editor)
			if (shape) openEnrich(shape.id)
		},
	},
]

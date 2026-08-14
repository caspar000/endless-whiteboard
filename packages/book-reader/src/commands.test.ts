import type { CommandContext } from '@lifeboard/node-kit'
import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { bookCommands } from './commands'
import { BOOK_NODE_TYPE } from './definition'
import { QUOTE_NODE_TYPE } from './quote/definition'

/** Just enough editor for the availability predicates: what is selected, and what those shapes are. */
function editorWith(...shapes: { id: string; type: string }[]): Editor {
	return {
		getSelectedShapeIds: () => shapes.map((shape) => shape.id as TLShapeId),
		getShape: (id: TLShapeId) => shapes.find((shape) => shape.id === id) as TLShape | undefined,
	} as unknown as Editor
}

function ctx(editor: Editor | null): CommandContext {
	return { editor, view: editor ? 'board' : 'list' }
}

const command = (id: string) => bookCommands.find((entry) => entry.id === id)

describe('book commands', () => {
	it('offers the import everywhere there is a board', () => {
		const importer = command('node.book.import')
		expect(importer?.when?.(ctx(null))).toBe(false)
		expect(importer?.when?.(ctx(editorWith()))).toBe(true)
	})

	for (const id of ['node.book.read', 'node.book.details']) {
		describe(id, () => {
			it('needs one book selected', () => {
				const book = { id: 'shape:a', type: BOOK_NODE_TYPE }
				expect(command(id)?.when?.(ctx(editorWith(book)))).toBe(true)
			})

			it('is not offered with nothing, or something else, selected', () => {
				expect(command(id)?.when?.(ctx(editorWith()))).toBe(false)
				expect(
					command(id)?.when?.(ctx(editorWith({ id: 'shape:q', type: QUOTE_NODE_TYPE })))
				).toBe(false)
			})

			/*
			 * Both act on one shape, and picking the first of several would be a coin toss the user
			 * cannot see — the same rule the context-menu actions follow.
			 */
			it('is not offered for a multiple selection', () => {
				const two = editorWith(
					{ id: 'shape:a', type: BOOK_NODE_TYPE },
					{ id: 'shape:b', type: BOOK_NODE_TYPE }
				)
				expect(command(id)?.when?.(ctx(two))).toBe(false)
			})
		})
	}
})

import { NodeEditorPopover, type NodeShape } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import type { BookNodeProps } from './definition'
import { BOOK_FILE_SUFFIXES } from './formats'
import { loadBookIntoShape } from './importBook'

const ACCEPT = BOOK_FILE_SUFFIXES.map((suffix) => `.${suffix}`).join(',')

/**
 * What editing a *placeholder* book shows — a node drawn from the dock has no file yet, so the one
 * meaningful edit is giving it one. Dropping a file onto the canvas is still the primary path; this
 * exists so the dock tool doesn't create a dead end.
 */
export function BookFilePicker({
	shape,
	editor,
}: {
	shape: NodeShape<BookNodeProps>
	editor: Editor
}) {
	return (
		<NodeEditorPopover shape={shape} editor={editor} width={260}>
			<label className="lb-book__picker">
				<span className="lb-book__picker-title">Choose a book file</span>
				<small>PDF · EPUB · MOBI · AZW3 · FB2 · CBZ</small>
				<input
					type="file"
					accept={ACCEPT}
					onChange={(event) => {
						const file = event.currentTarget.files?.[0]
						// Exit editing either way: picking nothing is a cancel, picking a file moves the
						// action to the import — whose first visible result is the filled-in card.
						editor.setEditingShape(null)
						editor.setSelectedShapes([shape.id])
						if (file) void loadBookIntoShape(editor, shape.id, file)
					}}
				/>
			</label>
		</NodeEditorPopover>
	)
}

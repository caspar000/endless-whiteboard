import type { Editor } from '@lifeboard/canvas'

/**
 * Which board an editor shows (DARK-14). Stamps, rankings, backlogs and feeds belong to the board they
 * were made on, so a card asks this before it lists or reads them: a randomizer offers its own board's
 * rankings, a feed card shows its own board's channels.
 *
 * Told by the app as a board opens (`fireBoardOpen`), and by anything else that draws a board in an
 * editor of its own (a preview drawn off screen). `''` for an editor nobody has said, as in tests.
 */

const boards = new WeakMap<Editor, string>()

export function setBoardOf(editor: Editor, boardId: string): void {
	boards.set(editor, boardId)
}

export function boardIdOf(editor: Editor): string {
	return boards.get(editor) ?? ''
}

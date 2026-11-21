import type { Editor } from '@lifeboard/canvas'

/**
 * Boards made a moment ago with "New board" that nothing has happened to yet (DARK-12). Leaving one
 * deletes it (app/App.tsx), so trying "New board" and walking away doesn't leave an empty board behind.
 *
 * A board is untouched from its making until the first thing done to it: a rename, a new colour or
 * icon (app/useBoards.ts), or any change to its content (`watchUntouchedBoard`). Untouched is never
 * earned back, so a board edited and then undone back to empty stays. Only the plain untitled board is
 * ever marked: a board made as a kind, the demo board, an import or an agent's board arrives with
 * something in it or a name someone chose.
 *
 * In memory only, like `pendingKind.ts`: a board made and not edited before a reload is an ordinary
 * empty board from then on. Deleting on the way out of the page isn't reliable, and a board kept is the
 * harmless way for that to fail.
 */
const untouched = new Set<string>()

export function markUntouched(boardId: string): void {
	untouched.add(boardId)
}

export function isUntouched(boardId: string): boolean {
	return untouched.has(boardId)
}

/** Something was done to the board, or it is gone: leaving it no longer deletes it. */
export function forgetUntouched(boardId: string): void {
	untouched.delete(boardId)
}

/**
 * Forgets the board as untouched on the first change to its content: made by the user or by an agent
 * working in the page, never by sync from elsewhere or by the camera and selection, which are no edit.
 */
export function watchUntouchedBoard(editor: Pick<Editor, 'store'>, boardId: string): () => void {
	if (!untouched.has(boardId)) return () => {}
	const unlisten = editor.store.listen(
		() => {
			forgetUntouched(boardId)
			unlisten()
		},
		{ scope: 'document', source: 'user' }
	)
	return unlisten
}

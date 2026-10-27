/**
 * Boards made a moment ago as a kind of board (a Zettelkasten box) that haven't opened yet.
 *
 * A board's kind is written into its own content (node-kit's `BoardKind`), and content can only be
 * written through the board's editor, which exists once the board opens. So making one is two steps:
 * the app makes an ordinary board and notes its kind here, and the board's first open hands its editor
 * to the kind. In memory only: a board made and never opened before a reload is an ordinary empty
 * board, which is the harmless way for that to fail.
 */
const pending = new Map<string, string>()

export function markPendingBoardKind(boardId: string, kindId: string): void {
	pending.set(boardId, kindId)
}

/** The kind a board was made as, once: the second open finds nothing. */
export function takePendingBoardKind(boardId: string): string | undefined {
	const kindId = pending.get(boardId)
	pending.delete(boardId)
	return kindId
}

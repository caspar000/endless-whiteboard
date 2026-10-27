import { atom, type Editor } from '@lifeboard/canvas'
import { getBoardBridge } from '@lifeboard/node-kit'
import { isBox } from '../box'

/**
 * The boxes mounted in this session, by board id, so a note shown on another board (RefCard) can
 * follow its box live, reading the card through the box's own store. A signal, so a card on another
 * board redraws the moment its box mounts, and as the card changes in it.
 */
const mounted = atom<ReadonlyMap<string, Editor>>('lifeboard:zettel-live-boxes', new Map())
const boardIds = new WeakMap<Editor, string>()

/** Called as every board opens (extension.ts): a box is listed, any board's id remembered. */
export function noteBoardOpen(boardId: string, editor: Editor): void {
	boardIds.set(editor, boardId)
	if (!isBox(editor)) return
	const next = new Map(mounted.get())
	next.set(boardId, editor)
	mounted.set(next)
}

/** The board an editor belongs to, once it has opened. */
export function boardIdOf(editor: Editor): string | null {
	return boardIds.get(editor) ?? null
}

/** The box's live editor, if it is mounted. Reactive: read inside a signal to follow its mounting. */
export function liveBox(boxId: string): Editor | null {
	const editor = mounted.get().get(boxId) ?? (getBoardBridge()?.editorFor(boxId) ?? null)
	// A closed tab's editor is gone from the page, though it may still be in the map.
	if (!editor || !editor.getContainer().isConnected || !isBox(editor)) return null
	return editor
}

/**
 * The box's editor, mounting it in a tab behind the one on screen if it isn't mounted yet (the
 * bridge's `mount`; a host without it opens the box instead).
 */
export async function reachBox(boxId: string): Promise<Editor | null> {
	const live = liveBox(boxId)
	if (live) return live
	const bridge = getBoardBridge()
	if (!bridge) return null
	const editor = bridge.mount ? await bridge.mount(boxId) : await bridge.open(boxId)
	return editor && isBox(editor) ? editor : null
}

const names = new Map<string, string>()

/** A board's name, from the board list; cached. `null` until known. */
export async function boardName(boardId: string): Promise<string | null> {
	const known = names.get(boardId)
	if (known) return known
	const boards = (await getBoardBridge()?.list()) ?? []
	for (const board of boards) names.set(board.id, board.name)
	return names.get(boardId) ?? null
}

import type { Editor } from 'tldraw'

/**
 * A board as anything outside the app sees it. Declared structurally rather than imported from the
 * app's `BoardMeta` for the same reason `CommandView` is (`commands.ts`): node-kit is the SDK, and an
 * operation — including a future plugin's — must be able to name a board without importing app code.
 */
export interface BoardSummary {
	id: string
	name: string
	createdAt: number
	updatedAt: number
	favorite?: boolean
}

/**
 * Board-level capability, which the SDK has none of on its own.
 *
 * Operations differ from commands in exactly one way that matters here: a command always acts on the
 * board you are looking at, while an operation can be told *which* board to act on — that is the
 * whole point of driving the app from outside it. Board CRUD, the editor map and the open transition
 * all live in the app (`App.tsx`, `boards/boardIndex.ts`), so they arrive through a seam, the same
 * shape as `NetworkBridge` and `AssetBridge`: the app installs it, the SDK calls it.
 *
 * This is deliberately *not* the app's whole API. It is the capability an operation is allowed to
 * have, which is why a plugin-supplied operation can never reach further than this interface.
 */
export interface BoardBridge {
	list(): Promise<BoardSummary[]>
	create(name: string): Promise<BoardSummary>
	rename(id: string, name: string): Promise<void>
	remove(id: string): Promise<void>
	/**
	 * Opens the board and resolves once its editor is mounted, or `null` if there is no such board.
	 *
	 * Awaiting the mount is the load-bearing part: writes need a live editor, and tldraw mounts one
	 * asynchronously. An operation that targets a board and does not wait would write into nothing.
	 */
	open(id: string): Promise<Editor | null>
	/**
	 * The already-mounted editor for a board, without opening it — `null` if it is not mounted.
	 *
	 * Note that "mounted" is broader than "visible": hidden tabs keep their editors alive. That is a
	 * feature here (an operation can touch a background board without stealing the view) and exactly
	 * why the host must implement this from its own editor map rather than from `window.editor`,
	 * which is a debug seam pointing at whichever board mounted last.
	 */
	editorFor(id: string): Editor | null
}

let bridge: BoardBridge | null = null

/** Installed once by the app's composition root, before any operation can run. */
export function setBoardBridge(next: BoardBridge): void {
	bridge = next
}

/**
 * The installed bridge, or `null` when the host has not provided one.
 *
 * Nullable like `getNetworkBridge`, and for a stricter version of the same reason: a host that
 * embeds the SDK without a board store is a legitimate build (a test, the Help page's mock cards),
 * and the failure has to be a *result* an agent can read rather than a crash. `runOperation` turns
 * the absence into `{ ok: false }` with a sentence saying so.
 */
export function getBoardBridge(): BoardBridge | null {
	return bridge
}

/** Used by tests to get a clean slate. */
export function clearBoardBridge(): void {
	bridge = null
}

import { setBoardBridge, type BoardBridge, type BoardSummary } from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import type { BoardMeta } from '../boards/boardIndex'

/**
 * The app's half of `BoardBridge` — what the SDK is allowed to do to this app's boards.
 *
 * Capability arrives through a module-level holder that App re-points on every render, exactly as
 * `appCommands.ts` does and for the same reasons: the operations register once, at module scope
 * (StrictMode would double-fire an effect), while the callbacks they close over are recreated each
 * render and a captured set would run dead closures.
 *
 * It is a *narrow* view of the app on purpose. An operation — including a plugin's, one day — can
 * reach exactly these six things and nothing else.
 */
export interface AgentBoardApi {
	/**
	 * Reads the board index **from the store**, not from React state.
	 *
	 * This is load-bearing. `useBoards.create` writes the index and then calls `refresh()`, which is
	 * a `setState` — so the `boards` array this holder was last given is one render out of date for
	 * the whole of the operation that just created a board. A `board.create` that then opens what it
	 * created looked the board up in that stale array, failed to find it, and left the agent with
	 * "no board is open" immediately after successfully making one.
	 */
	list(): Promise<BoardMeta[]>
	create(name?: string): Promise<BoardMeta>
	rename(id: string, name: string): Promise<void>
	remove(id: string): Promise<void>
	/**
	 * Navigates to a board by id. Resolves `false` if there is no such board, and otherwise once the
	 * route has changed — *not* once the editor is mounted, which is what `open` below waits for.
	 */
	open(id: string): Promise<boolean>
	/** The mounted editor for a board — including one behind a hidden tab. `null` if not mounted. */
	editorFor(id: string): Editor | null
}

let api: AgentBoardApi | null = null

/** Called by App on every render. Cheap, idempotent, StrictMode-safe. */
export function setAgentBoardApi(next: AgentBoardApi): void {
	api = next
}

/**
 * How long to wait for a board's editor to mount before giving up.
 *
 * Mounting is asynchronous — a board waits on its own restore from IndexedDB — and a large board on a
 * cold cache is the slow case. Generous, because the failure mode of being too impatient is an
 * operation that reports failure while the board opens perfectly well a moment later.
 */
const MOUNT_TIMEOUT_MS = 15_000
const MOUNT_POLL_MS = 40

function missing(): never {
	// Reaching this means an operation ran before App mounted, which is a wiring bug rather than a
	// user-facing condition — `runOperation` will turn it into a readable failure either way.
	throw new Error('Lifeboard is still starting up.')
}

function summarise(board: BoardMeta): BoardSummary {
	return {
		id: board.id,
		name: board.name,
		createdAt: board.createdAt,
		updatedAt: board.updatedAt,
		...(board.favorite === undefined ? {} : { favorite: board.favorite }),
	}
}

const bridge: BoardBridge = {
	list: async () => (await (api ?? missing()).list()).map(summarise),

	create: async (name: string) => summarise(await (api ?? missing()).create(name)),

	rename: async (id: string, name: string) => (api ?? missing()).rename(id, name),

	remove: async (id: string) => (api ?? missing()).remove(id),

	editorFor: (id: string) => api?.editorFor(id) ?? null,

	/**
	 * Opens a board and waits for its editor.
	 *
	 * The wait is the whole point of this method: `open` navigates, and tldraw mounts afterwards. An
	 * operation that wrote as soon as navigation resolved would write into nothing — which is exactly
	 * the bug the fake bridge's `editorFor` returning `null` until opened is written to catch.
	 *
	 * Polling rather than a mount event: the editors map is a ref App writes from tldraw's `onMount`
	 * callback, and threading a subscription through that for one caller would be more moving parts
	 * than a bounded poll deserves.
	 */
	open: async (id: string) => {
		const current = api ?? missing()
		const mounted = current.editorFor(id)

		// Navigating is also how "does this board exist?" is answered — the app checks against the
		// store, so a board created moments ago counts and a deleted one does not.
		if (!(await current.open(id))) return null

		// Already live behind a tab: we still navigated above, so the person watching ends up looking
		// at the board the agent is about to change.
		if (mounted) return mounted

		const deadline = Date.now() + MOUNT_TIMEOUT_MS
		while (Date.now() < deadline) {
			const editor = (api ?? current).editorFor(id)
			if (editor) return editor
			await new Promise((resolve) => setTimeout(resolve, MOUNT_POLL_MS))
		}
		return null
	},
}

// Installed at module scope: the composition root imports this module for the side effect, then
// registers the operations that depend on it. Order matters — see `apps/web/src/extensions.ts`.
setBoardBridge(bridge)

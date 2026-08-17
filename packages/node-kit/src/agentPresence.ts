import type { Editor, TLShapeId } from 'tldraw'

/**
 * Where the agent is working, so the board can show it.
 *
 * An agent driving the live editor is the *point* of the operation layer — writes land in the real
 * store, in front of whoever is watching. But until now the only trace of it was shapes appearing out
 * of nowhere: no way to tell a note the agent wrote from one you wrote, no way to see it reading
 * before it acts, and no way to tell "thinking" from "stuck". A cursor with a name on it is the whole
 * fix, and it is the same answer multiplayer boards reached for the same reason.
 *
 * This is the **channel**, not the drawing. An operation reports what it just touched; the app's
 * presence layer decides what that looks like. Two consequences worth keeping:
 *
 *  - node-kit stays free of the DOM, so the SDK boundary holds.
 *  - a host that draws nothing pays nothing: with no subscriber, reporting is a store write and a
 *    loop over an empty set.
 *
 * Reactivity is a listener set rather than a tldraw atom, for the reason spelled out on the node
 * registry: under Vite's dev prebundling this package's `atom` and the app's `useValue` can come from
 * two copies of tldraw's signal library, and a subscription never crosses that boundary.
 */

/**
 * What the agent is doing, at the coarseness a cursor can show.
 *
 * Deliberately few. These decide a colour and an icon, so a kind nobody can tell apart from another
 * at a glance is a kind that should not exist.
 */
export type AgentActivityKind = 'read' | 'create' | 'update' | 'delete' | 'connect' | 'look'

export interface AgentActivity {
	/**
	 * Rises with every report, so a renderer can restart an animation for a repeat of the same thing.
	 * Two consecutive `node.get`s on one shape are two events, and the second should still pulse.
	 */
	seq: number
	kind: AgentActivityKind
	/** The operation that caused it — `node.insert`. Shown small, under the verb. */
	operation: string
	/** What to say on the cursor: "Adding sticky note", "Reading", "Looking at 4 shapes". */
	verb: string
	/**
	 * The board this happened on, as the editor itself rather than an id.
	 *
	 * The renderer compares it against its own editor by identity, which is what keeps a background
	 * board's activity off the board you are looking at. An id would need every operation to know
	 * which board it resolved to, which several of them genuinely do not.
	 */
	editor: Editor
	/** What was touched, in page coordinates, so the layer can draw without reading the store again. */
	shapes: { id: TLShapeId; x: number; y: number; w: number; h: number }[]
	/** Where the cursor points, in page coordinates. */
	point: { x: number; y: number } | null
	/** Epoch ms, so the layer can fade an activity out on its own clock. */
	at: number
}

let latest: AgentActivity | null = null
let seq = 0
const listeners = new Set<() => void>()

/** The most recent thing an agent did, or `null` if it has done nothing this session. */
export function getAgentActivity(): AgentActivity | null {
	return latest
}

export function subscribeToAgentActivity(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/**
 * Reports what an agent is touching. Called by operations; see `reportAgentWork` in `ops/shared.ts`,
 * which is the form with the geometry already read off the board.
 */
export function reportAgentActivity(activity: Omit<AgentActivity, 'seq' | 'at'>): void {
	seq += 1
	latest = { ...activity, seq, at: Date.now() }
	for (const listener of listeners) listener()
}

/**
 * Forgets the current activity — the cursor goes away.
 *
 * The layer fades on a timer of its own, so this is for the cases a timer cannot know about: the
 * board being closed, or the agent disconnecting mid-turn and leaving a cursor pointing at nothing.
 */
export function clearAgentActivity(): void {
	if (!latest) return
	latest = null
	for (const listener of listeners) listener()
}

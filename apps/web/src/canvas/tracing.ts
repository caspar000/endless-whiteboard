import { edgesTouching, getPageEdges, otherEnd, type EdgeIndex } from '@lifeboard/node-kit'
import { atom, computed, react, type Computed, type Editor, type TLShapeId } from 'tldraw'

/**
 * The tracing lens: point at a shape and see what it is wired to.
 *
 * Hiding relations (`relations.ts`) makes a board readable by taking arrows away; this is the other
 * half of the bargain — a way to ask for them back, one node at a time. While the lens is on,
 * clicking a shape reveals every relation touching it, hidden ones included, and lights up that
 * shape, those relations and the shapes at their far ends. Everything else on the board dims.
 *
 * A **mode** rather than something that happens on every selection: selecting a shape is the most
 * common gesture on a canvas, and a board that dimmed itself every time you clicked something would
 * be exhausting. You switch the lens on when the question you have is "what is this tangled up
 * with?", and off when it isn't.
 *
 * State lives in module-scope signals for the same reason `propertiesTarget.ts` does: the things that
 * change it — a dock button, a keystroke, the selection — sit in components tldraw constructs from
 * module-scope overrides, which cannot be handed props by the board. And for the same reason it
 * carries the same obligation: **clear it when a board unmounts**, or the next board opens tracing a
 * shape that is not on it.
 */

const tracingOn = atom<boolean>('lifeboard:tracing', false)
const traceRootId = atom<TLShapeId | null>('lifeboard:traceRoot', null)

export function isTracing(): boolean {
	return tracingOn.get()
}

/** Switching the lens off drops the root too: a stale root would light up on the way back in. */
export function setTracing(on: boolean): void {
	tracingOn.set(on)
	if (!on) traceRootId.set(null)
}

export function toggleTracing(): boolean {
	const next = !tracingOn.get()
	setTracing(next)
	return next
}

/** What the lens is pointed at. `null` while the mode is on but nothing has been clicked yet. */
export function setTraceRoot(id: TLShapeId | null): void {
	if (tracingOn.get()) traceRootId.set(id)
}

/** Called when a board unmounts — see the note about module-scope state above. */
export function stopTracing(): void {
	setTracing(false)
}

/**
 * Points the lens at whatever is selected, while it is on.
 *
 * Following the selection rather than intercepting clicks is what keeps every gesture working
 * unchanged — dragging, multi-select, the context menu, the keyboard. Tracing adds a way of *looking*
 * at the board; it does not take the mouse away from you.
 *
 * A multi-selection clears the root rather than picking one of them: "these three things" is not a
 * question this lens answers, and lighting up whichever happened to be first would be a guess.
 */
export function followSelectionWhileTracing(editor: Editor): () => void {
	return react('lifeboard:trace-follows-selection', () => {
		if (!tracingOn.get()) return
		const selected = editor.getSelectedShapeIds()
		traceRootId.set(selected.length === 1 ? selected[0]! : null)
	})
}

/** One hop from a shape: the relations touching it, and the shapes at their far ends. */
export interface TraceNeighbourhood {
	/** The root included — it is the thing being traced, and it glows too. */
	nodes: ReadonlySet<string>
	arrows: ReadonlySet<string>
}

export interface Trace extends TraceNeighbourhood {
	root: string
}

/**
 * The pure rule, so the graph walk can be tested without an editor.
 *
 * One hop, both directions. `edgesTouching` and `otherEnd` already exist in node-kit's `edges.ts` and
 * are what the tables use to answer the same question — a second traversal written here would be a
 * second definition of what "connected" means.
 *
 * Direction is deliberately ignored: "what is this tangled up with" is not a question about which way
 * the arrows point, and a lens that showed only outgoing relations would hide half the answer.
 */
export function traceNeighbourhood(index: EdgeIndex, rootId: string): TraceNeighbourhood {
	const touching = edgesTouching(index, rootId, 'either')
	const nodes = new Set<string>([rootId])
	const arrows = new Set<string>()
	for (const edge of touching) {
		arrows.add(edge.id)
		nodes.add(otherEnd(edge, rootId))
	}
	return { nodes, arrows }
}

function areTracesEqual(a: Trace | null, b: Trace | null): boolean {
	if (a === b) return true
	if (!a || !b) return false
	if (a.root !== b.root) return false
	if (a.nodes.size !== b.nodes.size || a.arrows.size !== b.arrows.size) return false
	for (const id of a.nodes) if (!b.nodes.has(id)) return false
	for (const id of a.arrows) if (!b.arrows.has(id)) return false
	return true
}

const traceByEditor = new WeakMap<Editor, Computed<Trace | null>>()

/**
 * The live trace, `null` unless the lens is on and pointed at something.
 *
 * Derived rather than stored, so a relation drawn *while* tracing lights up on its own and one that
 * is deleted stops glowing. The dependency on `getPageEdges` is affordable precisely because that
 * signal is guarded by `areEdgeIndexesEqual`: dragging shapes around does not change the edge index's
 * value, so it does not recompute this either.
 *
 * `isEqual` matters more than it looks. Every shape wrapper on the board subscribes to this to decide
 * whether it is dimmed, so a new-but-identical result would repaint the whole board.
 */
export function getTrace(editor: Editor): Computed<Trace | null> {
	const existing = traceByEditor.get(editor)
	if (existing) return existing

	const trace = computed<Trace | null>(
		'lifeboard:trace',
		() => {
			if (!tracingOn.get()) return null
			const root = traceRootId.get()
			if (!root) return null
			// A root that has been deleted under the lens traces nothing, rather than glowing a hole.
			if (!editor.getShape(root)) return null
			return { root, ...traceNeighbourhood(getPageEdges(editor).get(), root) }
		},
		{ isEqual: areTracesEqual }
	)

	traceByEditor.set(editor, trace)
	return trace
}

/** How a shape takes part in the current trace, or `null` if it does not. */
export type TraceRole = 'root' | 'near' | 'arrow'

export function traceRoleFor(editor: Editor, id: TLShapeId): TraceRole | null {
	const trace = getTrace(editor).get()
	if (!trace) return null
	if (trace.root === id) return 'root'
	if (trace.arrows.has(id)) return 'arrow'
	if (trace.nodes.has(id)) return 'near'
	return null
}

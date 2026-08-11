/**
 * The board's arrows, read as a graph.
 *
 * An arrow drawn between two shapes already means something — "blocks", "pays for", "is made of" —
 * and until now the app saw only a decorative line. This is the index that lets a table ask "what is
 * connected to me?", which is the one question a canvas can answer that a database view cannot.
 *
 * **Only fully bound arrows count.** tldraw creates a binding when an arrow's end is attached to a
 * shape, so an arrow with a loose end has one binding or none. That gives the distinction between a
 * relation and a doodle for free: sketch an arrow across empty space and it stays a drawing; snap both
 * ends to shapes and it becomes an edge. No mode, no toggle, nothing to explain.
 *
 * Like `ShapeFacts`, an edge holds **nothing positional**. Dragging either endpoint moves the arrow
 * and rewrites its geometry, but `{id, from, to}` is unchanged — so `areEdgeIndexesEqual` reports no
 * change and nothing downstream recomputes. That is the same discipline that keeps the facts pipeline
 * quiet during a drag, and it has to hold here for the same reason.
 */

/** One arrow, as a relation. `id` is the arrow's own shape id — so an edge can carry properties. */
export interface Edge {
	id: string
	from: string
	to: string
}

/** Which way an arrow must point, relative to the shape asking. */
export const EDGE_DIRECTIONS = ['in', 'out', 'either'] as const
export type EdgeDirection = (typeof EDGE_DIRECTIONS)[number]

export const EDGE_DIRECTION_LABELS: Record<EdgeDirection, string> = {
	in: 'Pointing at this',
	out: 'Pointed at by this',
	either: 'Either way',
}

export interface EdgeIndex {
	/** Every bound arrow on the page, ordered by arrow id so the list is comparable. */
	all: readonly Edge[]
	/** Edges by the id of the shape they point *at*. */
	incoming: ReadonlyMap<string, readonly Edge[]>
	/** Edges by the id of the shape they point *from*. */
	outgoing: ReadonlyMap<string, readonly Edge[]>
}

export const EMPTY_EDGE_INDEX: EdgeIndex = {
	all: [],
	incoming: new Map(),
	outgoing: new Map(),
}

/** Groups a flat edge list both ways. The list is sorted here so equality is a plain walk. */
export function buildEdgeIndex(edges: readonly Edge[]): EdgeIndex {
	if (edges.length === 0) return EMPTY_EDGE_INDEX
	const all = [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	const incoming = new Map<string, Edge[]>()
	const outgoing = new Map<string, Edge[]>()
	for (const edge of all) {
		let into = incoming.get(edge.to)
		if (!into) incoming.set(edge.to, (into = []))
		into.push(edge)
		let outOf = outgoing.get(edge.from)
		if (!outOf) outgoing.set(edge.from, (outOf = []))
		outOf.push(edge)
	}
	return { all, incoming, outgoing }
}

/**
 * Topology only, which is the whole point.
 *
 * The index is rebuilt whenever any shape on the page changes — including every frame of a drag,
 * because dragging a shape moves the arrows bound to it. Comparing the rebuilt list against the old
 * one is what stops that reaching the query: same edges, no downstream work.
 */
export function areEdgeIndexesEqual(a: EdgeIndex, b: EdgeIndex): boolean {
	if (a === b) return true
	if (a.all.length !== b.all.length) return false
	for (let i = 0; i < a.all.length; i++) {
		const ea = a.all[i]!
		const eb = b.all[i]!
		if (ea.id !== eb.id || ea.from !== eb.from || ea.to !== eb.to) return false
	}
	return true
}

/** The edges touching a shape in the given direction. */
export function edgesTouching(
	index: EdgeIndex,
	id: string,
	direction: EdgeDirection
): readonly Edge[] {
	if (direction === 'in') return index.incoming.get(id) ?? []
	if (direction === 'out') return index.outgoing.get(id) ?? []
	const into = index.incoming.get(id) ?? []
	const outOf = index.outgoing.get(id) ?? []
	if (!into.length) return outOf
	if (!outOf.length) return into
	return [...into, ...outOf]
}

/** The shape at the far end of an edge from `id`. */
export function otherEnd(edge: Edge, id: string): string {
	return edge.from === id ? edge.to : edge.from
}

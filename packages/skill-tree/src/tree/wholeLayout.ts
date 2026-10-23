import type { GraphEdge, GraphNode } from './layout'
import { DEFAULT_LAYOUT, type LayoutConfig } from './layoutDefaults'
import { mazeLayout } from './maze'

/**
 * The whole-life layout (docs/skill-tree-layout-plan.md): the tree grown from its start in the
 * middle through a maze of cells (tree/maze.ts), the way Path of Exile's passive tree goes out from
 * its centre. Every node is a node of the maze, whatever it is: skill nodes, and with everything
 * shown their entries and works too, each in a cell of its own and joined by corridors along the
 * lines drawn between them (a spoke from a skill node to each entry, a chain through each entry's
 * works). The two views follow exactly the same rules; one only has more nodes.
 *
 * Pure and deterministic. Positions are centres, with the start at the origin.
 */

type Point = { x: number; y: number }

export interface WholeLayoutOptions {
	isSkill: (id: string) => boolean
	/** The node at the middle. */
	start: string
	/** Arrows between skill nodes, either way round, including those from another tree. */
	arrows?: readonly GraphEdge[]
	/** The settings (layoutConfig.ts); the defaults when not given. */
	config?: LayoutConfig
}

export function wholeLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: WholeLayoutOptions): Map<string, Point> {
	const C = options.config ?? DEFAULT_LAYOUT
	const size = new Map(nodes.map((n) => [n.id, n]))
	const start = size.has(options.start) ? options.start : (nodes[0]?.id ?? '')
	const out = new Map<string, Point>()
	if (!start) return out
	// The tree: each node hangs from the first edge into it.
	const children = new Map<string, string[]>()
	const parentOf = new Map<string, string>()
	for (const e of edges) {
		if (!size.has(e.from) || !size.has(e.to) || e.to === start || parentOf.has(e.to)) continue
		parentOf.set(e.to, e.from)
		children.set(e.from, [...(children.get(e.from) ?? []), e.to])
	}
	const kids = (id: string) => children.get(id) ?? []
	const order = [start]
	for (let i = 0; i < order.length; i++) order.push(...kids(order[i]!))
	for (const [id, p] of mazeLayout({ start, order, kids, radius: (id) => reach(size.get(id)!), isSkill: options.isSkill, config: C })) out.set(id, p)
	// Anything the edges don't reach, above the start.
	let top = Math.min(0, ...[...out.values()].map((p) => p.y)) - C.mazeCell * 2
	for (const n of nodes) {
		if (out.has(n.id)) continue
		out.set(n.id, { x: 0, y: top })
		top -= Math.max(n.w, n.h) + C.mazeCell / 4
	}
	return out
}

/** Skill nodes and entries are discs; works and the header are boxes. Canvas sizes come back a hair off square. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)

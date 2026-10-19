import type { GraphEdge, GraphNode } from './layout'
import { DEFAULT_LAYOUT, type LayoutConfig } from './layoutDefaults'
import { mazeLayout } from './maze'
import { orbitCluster } from './orbits'
import { MAZE_PULL, pullIn } from './pullIn'

/**
 * The whole-life layout (docs/skill-tree-layout-plan.md): the tree grown from its start in the
 * middle through a maze of cells (tree/maze.ts), the way Path of Exile's passive tree goes out from
 * its centre.
 *
 * - **Clusters.** A skill node's entries go on orbits round it and their works along arcs beyond
 *   them (`orbitCluster`), and the cluster is a disc as big as they need. In the skill-node view a
 *   cluster is the node alone.
 * - **The maze.** The skill nodes are grown from the start through a region of cells, as many as
 *   they need, corridor by corridor.
 * - **Facing.** Last, each cluster turns about its own skill node so its gaps face its arrows (`pullIn`).
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
	const children = new Map<string, string[]>()
	const parentOf = new Map<string, string>()
	for (const e of edges) {
		if (!size.has(e.from) || !size.has(e.to) || e.to === start || parentOf.has(e.to)) continue
		parentOf.set(e.to, e.from)
		children.set(e.from, [...(children.get(e.from) ?? []), e.to])
	}
	const isSkill = (id: string) => options.isSkill(id)
	const skillKids = (id: string) => (children.get(id) ?? []).filter(isSkill)

	// Breadth first from the start.
	const order = [start]
	for (let i = 0; i < order.length; i++) order.push(...skillKids(order[i]!))

	// 1. Each cluster on its own, for its size: its entries on orbits round it, with a gap for each
	// arrow. Where the arrows go isn't known until the maze is grown, so the clusters are packed with
	// their gaps spread evenly, the maze grown, the clusters packed again with the gaps where the
	// arrows go, and the maze grown again for those sizes.
	const families = new Map(
		order.map((id) => [
			id,
			(children.get(id) ?? [])
				.filter((c) => !isSkill(c))
				.map((entry) => ({ entry: size.get(entry)!, works: members(entry, children, isSkill).map((m) => size.get(m)!) })),
		])
	)
	const neighbours = new Map<string, Set<string>>(order.map((id) => [id, new Set<string>()]))
	for (const id of order) {
		const parent = parentSkill(id, parentOf, isSkill)
		if (parent) {
			neighbours.get(id)!.add(parent)
			neighbours.get(parent)!.add(id)
		}
	}
	for (const e of options.arrows ?? []) {
		if (!neighbours.has(e.from) || !neighbours.has(e.to) || e.from === e.to) continue
		neighbours.get(e.from)!.add(e.to)
		neighbours.get(e.to)!.add(e.from)
	}
	const pack = (gatesOf: (id: string) => number[]) => new Map(order.map((id) => [id, orbitCluster(size.get(id)!, families.get(id)!, gatesOf(id), C)]))
	const evenly = (id: string) => [...neighbours.get(id)!].map((_, i, all) => -Math.PI / 2 + (2 * Math.PI * i) / all.length)
	const towards = (at: ReadonlyMap<string, Point>) => (id: string) =>
		[...neighbours.get(id)!].filter((n) => at.has(n)).map((n) => Math.atan2(at.get(n)!.y - at.get(id)!.y, at.get(n)!.x - at.get(id)!.x))
	const grow = (radius: (id: string) => number) => mazeLayout({ start, order, kids: skillKids, radius, config: C })
	const first = pack(evenly)
	const second = pack(towards(grow((id) => first.get(id)!.radius)))
	// A cluster packed again may come out bigger than the room it was grown for: keep the first packing then.
	const clusters = new Map(order.map((id) => [id, second.get(id)!.radius <= first.get(id)!.radius + 0.5 ? second.get(id)! : first.get(id)!]))
	for (const [id, p] of grow((id) => clusters.get(id)!.radius)) out.set(id, p)

	// 2. Members where their cluster put them.
	for (const id of order) for (const [m, p] of clusters.get(id)!.at) out.set(m, { x: out.get(id)!.x + p.x, y: out.get(id)!.y + p.y })
	// 3. Each cluster turned about its skill node to face its arrows; nothing else moves.
	const units = new Map(order.map((id) => [id, [id, ...clusters.get(id)!.at.keys()]]))
	const lines: [string, string][] = []
	for (const id of order)
		for (const f of families.get(id)!) {
			lines.push([id, f.entry.id])
			let last = f.entry.id
			for (const w of f.works) {
				lines.push([last, w.id])
				last = w.id
			}
		}
	const arrows = (options.arrows ?? []).map((e) => [e.from, e.to] as const)
	const repack = (skill: string, gates: number[]) => orbitCluster(size.get(skill)!, families.get(skill)!, gates, C).at
	pullIn(out, size, children, parentOf, isSkill, start, [], units, reach(size.get(start)!) + C.mazeHub, { ...MAZE_PULL, memberPad: C.memberPad }, { arrows, lines }, repack)
	// Anything the edges don't reach, above the start.
	let top = Math.min(0, ...[...out.values()].map((p) => p.y)) - C.clusterGap * 4
	for (const n of nodes) {
		if (out.has(n.id)) continue
		out.set(n.id, { x: 0, y: top })
		top -= Math.max(n.w, n.h) + C.clusterGap
	}
	return out
}

/** A skill node's members: what hangs below it that isn't a skill node, each entry followed by its works. */
function members(id: string, children: ReadonlyMap<string, string[]>, isSkill: (id: string) => boolean): string[] {
	const out: string[] = []
	const walk = (at: string) => {
		for (const kid of children.get(at) ?? []) {
			if (isSkill(kid)) continue
			out.push(kid)
			walk(kid)
		}
	}
	walk(id)
	return out
}

function parentSkill(id: string, parentOf: ReadonlyMap<string, string>, isSkill: (id: string) => boolean): string | undefined {
	let at = parentOf.get(id)
	while (at && !isSkill(at)) at = parentOf.get(at)
	return at
}

/** Skill nodes and entries are discs; works and the header are boxes. Canvas sizes come back a hair off square. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)

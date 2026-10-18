import type { GraphEdge, GraphNode } from './layout'
import { DEFAULT_LAYOUT, type LayoutConfig } from './layoutConfig'
import { orbitCluster } from './orbits'
import { pullIn } from './pullIn'

/**
 * The whole-life layout (docs/skill-tree-layout-plan.md): the tree laid out from its start in the
 * middle, the way Path of Exile's passive tree goes out from its centre.
 *
 * - **Slices.** The start's children (the pillars, on the whole-life board) share the circle in
 *   proportion to how much grows from each, none narrower than the narrowest slice, the first centred at the
 *   top and the rest clockwise in order. Every node shares its own slice among its children the same
 *   way, so each tree has a slice of its pillar's and each branch a slice of its tree's.
 * - **Rings.** Each node sits in the middle of its slice. The first levels (pillars, then tree roots)
 *   are one ring each across the whole board; past them, each tree spaces its own rings. A ring is
 *   far enough out that every cluster on it fits inside its own slice and clear of the ring inside
 *   it, so nothing overlaps by construction.
 * - **Clusters.** A skill node's entries go on orbits round it and their works along arcs beyond
 *   them (`orbitCluster`), and the cluster is a disc as big as they need. In the skill-node view a cluster is the node alone, so the same
 *   skeleton comes out tighter.
 * - **Shared nodes.** A node required from two trees moves to the border between its two parents.
 * - **Closing in.** Last, each branch slides toward its parent as far as it fits (`pullIn`).
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

/** The settings of the call in progress (`wholeLayout` sets them), read by the helpers below. */
let C: LayoutConfig = DEFAULT_LAYOUT
/** The narrowest a slice of the start's children may be, in radians. */
const minSlice = () => (C.minSlice / 180) * Math.PI

export function wholeLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: WholeLayoutOptions): Map<string, Point> {
	const outer = C
	C = options.config ?? DEFAULT_LAYOUT
	try {
		return wholeLayoutNow(nodes, edges, options)
	} finally {
		C = outer
	}
}

function wholeLayoutNow(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: WholeLayoutOptions): Map<string, Point> {
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

	// Breadth first from the start: each skill node's depth and the tree (level-C.sharedLevels ancestor) it spaces its rings with.
	const depth = new Map<string, number>([[start, 0]])
	const group = new Map<string, string>([[start, start]])
	const order = [start]
	for (let i = 0; i < order.length; i++) {
		const id = order[i]!
		for (const kid of skillKids(id)) {
			depth.set(kid, depth.get(id)! + 1)
			group.set(kid, depth.get(kid)! <= C.sharedLevels ? kid : group.get(id)!)
			order.push(kid)
		}
	}

	// 1. Each cluster on its own, for its size: its entries on orbits round it, with a gap for each
	// arrow. Where the arrows go isn't known until the skeleton is placed, so the clusters are packed
	// with their gaps spread evenly, the skeleton placed, the clusters packed again with the gaps where
	// the arrows go, and the skeleton placed again. Sliding a branch in along its arrow (step 6) keeps
	// the arrows' directions, so the gaps stay where they are needed.
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
	const first = pack(evenly)
	const firstSkeleton = skeleton((id) => first.get(id)!.radius)
	const second = pack(towards(firstSkeleton))
	const placed = skeleton((id) => second.get(id)!.radius)
	const third = pack(towards(placed))
	// The last packing where it is no bigger than the one the skeleton was placed for, else that one.
	const clusters = new Map(order.map((id) => [id, third.get(id)!.radius <= second.get(id)!.radius + 0.5 ? third.get(id)! : second.get(id)!]))
	for (const [id, p] of placed) out.set(id, p)

	// 5. Members where their cluster put them; anything the edges don't reach, above the start.
	for (const id of order) for (const [m, p] of clusters.get(id)!.at) out.set(m, { x: out.get(id)!.x + p.x, y: out.get(id)!.y + p.y })
	// 6. Each branch slides in toward its parent while it fits, filling the space the arcs left.
	// 7. Then each branch from a tree's root, whole, is drawn in toward the start until it rests
	// against the others, closing the empty regions between branches.
	const clumps = order.filter((id) => depth.get(id)! > C.sharedLevels)
	const units = new Map(order.map((id) => [id, [id, ...clusters.get(id)!.at.keys()]]))
	// What every move is judged by: the arrows, and the light lines (a spoke to each entry, a chain through its works).
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
	pullIn(out, size, children, parentOf, isSkill, start, clumps, units, reach(size.get(start)!) + C.hubRoom, C, { arrows, lines }, repack)
	let top = Math.min(0, ...[...out.values()].map((p) => p.y)) - C.clusterGap * 4
	for (const n of nodes) {
		if (out.has(n.id)) continue
		out.set(n.id, { x: 0, y: top })
		top -= Math.max(n.w, n.h) + C.clusterGap
	}
	return out

	/** Steps 2 to 4: where the skill nodes go, for clusters of these sizes. */
	function skeleton(radius: (id: string) => number): Map<string, Point> {
		const out = new Map<string, Point>()
		// 2. Rings, first only far enough out to clear the ring inside. The first levels share one ring each
		// across the board; past them, a node's children share an arc of their own. A cluster that fits its
		// slice can't touch another slice, and clearing its parent keeps it off everything inside it, so a
		// big cluster doesn't push the rest of its tree out with it.
		const ringKey = (id: string) => (depth.get(id)! <= C.sharedLevels ? `shared:${depth.get(id)}` : `children:${parentSkill(id, parentOf, isSkill)}`)
		const widest = new Map<string, number>()
		for (const id of order) widest.set(ringKey(id), Math.max(widest.get(ringKey(id)) ?? 0, radius(id)))
		const rings = new Map<string, number>([[ringKey(start), 0]])
		const ring = (id: string) => rings.get(ringKey(id)) ?? 0
		const deepest = Math.max(0, ...depth.values())
		/** Every ring at least clear of the ring its parents are on, depth by depth. */
		const clearRings = () => {
			for (let d = 1; d <= deepest; d++) {
				for (const id of order) {
					if (depth.get(id) !== d) continue
					const parent = parentSkill(id, parentOf, isSkill)!
					// Clear of the parent's whole ring while it is a shared one, else of the parent alone.
					const inner = depth.get(parent)! <= C.sharedLevels && depth.get(id)! <= C.sharedLevels ? widest.get(ringKey(parent))! : radius(parent)
					// The first ring keeps open ground round the middle for its arrows (C.hubRoom).
					const clear = ring(parent) + inner + widest.get(ringKey(id))! + (d === 1 ? C.hubRoom : C.clusterGap)
					rings.set(ringKey(id), Math.max(ring(id), clear))
				}
			}
		}
		clearRings()

		// 3. Slices by the angle each branch needs on its rings: a node its own width at its ring, a
		// branch the larger of that and what its children need side by side. Where a slice is still too
		// narrow for a node, that node's ring moves out, and the slices are shared again, until all fit.
		const slice = new Map<string, { from: number; to: number }>()
		const own = (id: string) => (id === start ? 0 : (2 * radius(id) + C.clusterGap) / Math.max(1, ring(id)))
		const pillarMin = skillKids(start).length * minSlice() <= 2 * Math.PI ? minSlice() : 0
		for (let round = 0; round < 40; round++) {
			const need = new Map<string, number>()
			for (const id of [...order].reverse()) need.set(id, Math.max(own(id), skillKids(id).reduce((n, k) => n + need.get(k)!, 0)))
			const share = (id: string, from: number, to: number) => {
				slice.set(id, { from, to })
				const kids = skillKids(id)
				const spans = spread(kids.map((k) => need.get(k)!), to - from, id === start ? pillarMin : 0)
				let cursor = from
				kids.forEach((kid, i) => {
					share(kid, cursor, cursor + spans[i]!)
					cursor += spans[i]!
				})
			}
			// The first child's slice is centred at the top.
			const first = spread(skillKids(start).map((k) => need.get(k)!), 2 * Math.PI, pillarMin)[0] ?? 0
			share(start, -Math.PI / 2 - first / 2, (3 * Math.PI) / 2 - first / 2)
			let moved = false
			for (const id of order) {
				if (id === start) continue
				const s = slice.get(id)!
				const half = Math.min(Math.PI / 2, (s.to - s.from) / 2)
				// Half the slice's chord at the ring at least the cluster's radius and half a gap.
				const fits = (radius(id) + C.clusterGap / 2) / Math.sin(half)
				if (fits > ring(id) + 1) {
					rings.set(ringKey(id), fits)
					moved = true
				}
			}
			if (!moved) break
			clearRings()
		}
		const angle = (id: string) => (slice.get(id)!.from + slice.get(id)!.to) / 2
		for (const id of order) {
			const r = ring(id)
			out.set(id, id === start ? { x: 0, y: 0 } : { x: r * Math.cos(angle(id)), y: r * Math.sin(angle(id)) })
		}

		// 4. A node required from two trees sits between its parents, clear of every other cluster.
		const discs = () => order.filter((id) => out.has(id)).map((id) => ({ id, ...out.get(id)!, r: radius(id) }))
		for (const id of shared(order, options.arrows ?? [], group, parentOf, isSkill)) {
			const parents = (options.arrows ?? []).filter((e) => e.to === id && out.has(e.from)).map((e) => out.get(e.from)!)
			if (parents.length < 2) continue
			const mid = Math.atan2(parents.reduce((n, p) => n + Math.sin(Math.atan2(p.y, p.x)), 0), parents.reduce((n, p) => n + Math.cos(Math.atan2(p.y, p.x)), 0))
			let r = Math.max(...parents.map((p) => Math.hypot(p.x, p.y))) + radius(id) + C.clusterGap
			const others = discs().filter((d) => d.id !== id && !inBranch(d.id, id, parentOf))
			const clear = (x: number, y: number) => others.every((d) => Math.hypot(d.x - x, d.y - y) >= d.r + radius(id) + C.clusterGap)
			for (let step = 0; step < 400 && !clear(r * Math.cos(mid), r * Math.sin(mid)); step++) r += C.clusterGap
			const from = out.get(id)!
			const to = { x: r * Math.cos(mid), y: r * Math.sin(mid) }
			// Its own branch moves with it.
			for (const d of order) if (inBranch(d, id, parentOf)) out.set(d, { x: out.get(d)!.x + to.x - from.x, y: out.get(d)!.y + to.y - from.y })
		}

		return out
	}
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

/**
 * Splits `total` in proportion to `weights`, none below `min` (when the minimums fit): the ones that
 * would fall short get the minimum and the rest share what is left.
 */
function spread(weights: readonly number[], total: number, min: number): number[] {
	const out = weights.map(() => 0)
	let fixed = new Set<number>()
	for (let round = 0; round <= weights.length; round++) {
		const free = weights.map((_, i) => i).filter((i) => !fixed.has(i))
		const left = total - fixed.size * min
		const sum = free.reduce((n, i) => n + weights[i]!, 0) || 1
		for (const i of free) out[i] = (left * weights[i]!) / sum
		for (const i of fixed) out[i] = min
		const short = free.filter((i) => out[i]! < min)
		if (!short.length) break
		fixed = new Set([...fixed, ...short])
	}
	return out
}

function parentSkill(id: string, parentOf: ReadonlyMap<string, string>, isSkill: (id: string) => boolean): string | undefined {
	let at = parentOf.get(id)
	while (at && !isSkill(at)) at = parentOf.get(at)
	return at
}

/** Whether `id` is `root` or hangs below it. */
function inBranch(id: string, root: string, parentOf: ReadonlyMap<string, string>): boolean {
	for (let at: string | undefined = id; at; at = parentOf.get(at)) if (at === root) return true
	return false
}

/** Skill nodes required from more than one tree. */
function shared(order: readonly string[], arrows: readonly GraphEdge[], group: ReadonlyMap<string, string>, parentOf: ReadonlyMap<string, string>, isSkill: (id: string) => boolean): string[] {
	const groups = new Map<string, Set<string>>()
	for (const e of arrows) {
		const g = group.get(e.from)
		if (!g || !group.has(e.to)) continue
		groups.set(e.to, (groups.get(e.to) ?? new Set()).add(g))
	}
	return order.filter((id) => (groups.get(id)?.size ?? 0) > 1 && parentSkill(id, parentOf, isSkill) !== undefined)
}

function overlaps(a: GraphNode & Point, b: GraphNode & Point): boolean {
	if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.y - b.y) < a.w / 2 + b.w / 2 + C.memberPad
	if (isRound(a) || isRound(b)) {
		const [disc, box] = isRound(a) ? [a, b] : [b, a]
		return Math.hypot(Math.max(0, Math.abs(disc.x - box.x) - box.w / 2), Math.max(0, Math.abs(disc.y - box.y) - box.h / 2)) < disc.w / 2 + C.memberPad
	}
	return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + C.memberPad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + C.memberPad
}

/** Skill nodes and entries are discs; works and the header are boxes. Canvas sizes come back a hair off square. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)
/** How far a shape reaches from its centre in direction `a`. */
const support = (b: { w: number; h: number }, a: number) => (isRound(b) ? b.w / 2 : (Math.abs(Math.cos(a)) * b.w) / 2 + (Math.abs(Math.sin(a)) * b.h) / 2)

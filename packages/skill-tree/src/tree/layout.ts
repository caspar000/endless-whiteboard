/**
 * A radial tidy tree: every node at its depth's ring, each subtree given an arc in proportion to its
 * leaves, so families stay together and no two nodes share a spot (docs/skill-tree-plan.md,
 * "Layout"). Pure; the caller turns angle and depth into positions. `layoutGraph` below builds on it.
 */
export interface LayoutNode {
	id: string
	/** The node it hangs from: its first prerequisite on this tree, or '' for a root. */
	parent: string
}

export interface Placement {
	depth: number
	/** Radians, 0 pointing right, growing clockwise on screen. */
	angle: number
}

export function radialTree(nodes: readonly LayoutNode[], startAngle = -Math.PI / 2): Map<string, Placement> {
	const ids = new Set(nodes.map((n) => n.id))
	const children = new Map<string, string[]>()
	const roots: string[] = []
	for (const node of nodes) {
		// A parent the tree doesn't have, or itself, makes the node a root.
		const parent = node.parent && ids.has(node.parent) && node.parent !== node.id ? node.parent : ''
		if (!parent) roots.push(node.id)
		else children.set(parent, [...(children.get(parent) ?? []), node.id])
	}
	const leaves = new Map<string, number>()
	const seen = new Set<string>()
	const countLeaves = (id: string): number => {
		if (seen.has(id)) return 0
		seen.add(id)
		const kids = children.get(id) ?? []
		const n = kids.length ? kids.reduce((sum, kid) => sum + countLeaves(kid), 0) : 1
		leaves.set(id, Math.max(1, n))
		return Math.max(1, n)
	}
	for (const root of roots) countLeaves(root)

	const out = new Map<string, Placement>()
	const place = (id: string, depth: number, from: number, to: number) => {
		if (out.has(id)) return
		out.set(id, { depth, angle: (from + to) / 2 })
		let cursor = from
		const kids = children.get(id) ?? []
		const total = kids.reduce((sum, kid) => sum + (leaves.get(kid) ?? 1), 0)
		for (const kid of kids) {
			const span = ((to - from) * (leaves.get(kid) ?? 1)) / Math.max(1, total)
			place(kid, depth + 1, cursor, cursor + span)
			cursor += span
		}
	}

	if (roots.length === 1) {
		place(roots[0]!, 0, startAngle, startAngle + 2 * Math.PI)
	} else {
		// Several roots share the first ring around an empty centre, each with its own arc.
		const total = roots.reduce((sum, root) => sum + (leaves.get(root) ?? 1), 0)
		let cursor = startAngle
		for (const root of roots) {
			const span = (2 * Math.PI * (leaves.get(root) ?? 1)) / Math.max(1, total)
			place(root, 1, cursor, cursor + span)
			cursor += span
		}
	}
	// Anything left (a cycle with no way in) goes on the outer ring rather than vanishing.
	let extra = 0
	for (const node of nodes) {
		if (out.has(node.id)) continue
		out.set(node.id, { depth: 1 + Math.max(0, ...[...out.values()].map((p) => p.depth)), angle: startAngle + extra++ * 0.4 })
	}
	return out
}

/** A box to place: its id and size. Positions in and out are centres. */
export interface GraphNode {
	id: string
	w: number
	h: number
}

/** `from` is the prerequisite, `to` the node that depends on it. */
export interface GraphEdge {
	from: string
	to: string
}

export interface GraphLayoutOptions {
	/** Lay out this node and everything that depends on it, with it at the origin. Otherwise every node, from the nodes nothing points to. */
	root?: string
	/** Free space between neighbouring boxes. */
	gap?: number
	/** Ties of an edge that must not carry an arrow through a node (a header hung on its root does). */
	clearEdges?: (edge: GraphEdge) => boolean
	/** Boxes already on the board that must not be covered, as centres relative to the root. They never move. */
	obstacles?: readonly { x: number; y: number; w: number; h: number }[]
	/**
	 * Round boxes of very different sizes (a skill node with its entries around it): each node sits
	 * just beyond its parent instead of on its depth's ring, so a small node isn't pushed out as far
	 * as the biggest one beside it.
	 */
	balloon?: boolean
}

interface Body {
	id: string
	x: number
	y: number
	w: number
	h: number
	ax: number
	ay: number
	pinned: boolean
}

/**
 * The tree layout of docs/skill-tree-plan.md, "Graph layout and roots": a radial tidy tree from the
 * root, relaxed by a short force pass (repulsion, edge springs, a pull back toward the tidy spot so
 * the tree keeps its shape), then hard passes until no two boxes overlap and no edge runs through a
 * node. Deterministic, so laying out twice gives the same picture.
 *
 * The parent a node hangs from is its prerequisite nearest the root; its other prerequisites stay
 * edges that pull gently. Returns centres for the nodes it placed, relative to the root (or, with
 * several roots, to their common centre) at the origin.
 */
export function layoutGraph(
	nodes: readonly GraphNode[],
	edges: readonly GraphEdge[],
	options: GraphLayoutOptions = {}
): Map<string, { x: number; y: number }> {
	const gap = options.gap ?? 80
	const byId = new Map(nodes.map((n) => [n.id, n]))
	const valid = edges.filter((e) => e.from !== e.to && byId.has(e.from) && byId.has(e.to))
	const dependents = new Map<string, string[]>()
	const prerequisites = new Map<string, string[]>()
	for (const e of valid) {
		dependents.set(e.from, [...(dependents.get(e.from) ?? []), e.to])
		prerequisites.set(e.to, [...(prerequisites.get(e.to) ?? []), e.from])
	}

	// Depth from the roots, breadth first; a node nothing reaches (a cycle) becomes a root of its own.
	const depth = new Map<string, number>()
	const visit = (starts: string[]) => {
		const queue = starts.filter((id) => !depth.has(id))
		for (const id of queue) depth.set(id, 0)
		for (let i = 0; i < queue.length; i++) {
			const id = queue[i]!
			for (const next of dependents.get(id) ?? []) {
				if (depth.has(next)) continue
				depth.set(next, depth.get(id)! + 1)
				queue.push(next)
			}
		}
	}
	const single = options.root && byId.has(options.root) ? options.root : ''
	if (single) visit([single])
	else {
		visit(nodes.filter((n) => !prerequisites.get(n.id)?.length).map((n) => n.id))
		for (const n of nodes) if (!depth.has(n.id)) visit([n.id])
	}
	const ids = nodes.map((n) => n.id).filter((id) => depth.has(id))
	const parentOf = (id: string) => {
		const options = (prerequisites.get(id) ?? []).filter((p) => depth.has(p) && depth.get(p)! < depth.get(id)!)
		return options.sort((a, b) => depth.get(a)! - depth.get(b)!)[0] ?? ''
	}
	const placed = radialTree(ids.map((id) => ({ id, parent: depth.get(id) === 0 ? '' : parentOf(id) })))

	// Ring radii: at least a box and a gap further out than the ring inside, and wide enough that
	// the ring's nodes fit around it side by side.
	// Each node's own reach, so a ring of small work dots sits close and a ring of skill discs wide.
	const reachOf = (id: string) => reachOfBox(byId.get(id)!, options.balloon)
	const widest = new Map<number, number>()
	const around = new Map<number, number>()
	for (const [id, p] of placed) {
		widest.set(p.depth, Math.max(widest.get(p.depth) ?? 0, reachOf(id)))
		around.set(p.depth, (around.get(p.depth) ?? 0) + 2 * reachOf(id) + gap)
	}
	const radius: number[] = [0]
	const deepest = Math.max(0, ...widest.keys())
	for (let d = 1; d <= deepest; d++) {
		const step = (widest.get(d - 1) ?? 0) + (widest.get(d) ?? 0) + gap
		radius[d] = Math.max(radius[d - 1]! + step, (around.get(d) ?? 0) / (2 * Math.PI))
	}
	const unit = Math.max(...ids.map(reachOf)) * 2 + gap

	const at = new Map<string, { x: number; y: number }>()
	for (const [id, p] of placed) {
		const r = radius[p.depth] ?? 0
		at.set(id, { x: r * Math.cos(p.angle), y: r * Math.sin(p.angle) })
	}
	if (options.balloon) balloon(ids, placed, parentOf, reachOf, gap, at)
	const bodies: Body[] = ids.map((id) => {
		const { x, y } = at.get(id)!
		const n = byId.get(id)!
		return { id, x, y, w: n.w, h: n.h, ax: x, ay: y, pinned: id === single }
	})
	const index = new Map(bodies.map((b, i) => [b.id, i]))
	const placedCount = bodies.length
	for (const [i, o] of (options.obstacles ?? []).entries()) bodies.push({ id: `\0obstacle${i}`, ...o, ax: o.x, ay: o.y, pinned: true })
	const springs = valid
		.filter((e) => index.has(e.from) && index.has(e.to))
		.map((e) => ({ a: index.get(e.from)!, b: index.get(e.to)!, tree: parentOf(e.to) === e.from, clear: options.clearEdges?.(e) ?? true }))

	relax(bodies, springs, unit, gap, options.balloon)
	separate(bodies, springs, gap)

	const out = new Map<string, { x: number; y: number }>()
	for (const b of bodies.slice(0, placedCount)) out.set(b.id, { x: b.x, y: b.y })
	return out
}

/** How far a box reaches from its centre: its half-diagonal, a little short of it, or its radius when round. */
const reachOfBox = (b: { w: number; h: number }, round = false) => (round ? Math.max(b.w, b.h) / 2 : Math.hypot(b.w, b.h) * 0.45)

/**
 * Moves each node to just beyond its parent, along the angle the tidy tree gave it: far enough for
 * the two to clear, and for it and its siblings to fit side by side in its arc.
 */
function balloon(
	ids: readonly string[],
	placed: ReadonlyMap<string, Placement>,
	parentOf: (id: string) => string,
	reachOf: (id: string) => number,
	gap: number,
	at: Map<string, { x: number; y: number }>
): void {
	const kids = new Map<string, string[]>()
	for (const id of ids) {
		const parent = parentOf(id)
		if (parent) kids.set(parent, [...(kids.get(parent) ?? []), id])
	}
	const queue = ids.filter((id) => !parentOf(id))
	for (let i = 0; i < queue.length; i++) {
		const parent = queue[i]!
		const from = at.get(parent)!
		const siblings = kids.get(parent) ?? []
		// The arc the siblings share, at the distance that fits the widest of them.
		const span = Math.max(0.3, (2 * Math.PI) / Math.max(1, siblings.length))
		for (const id of siblings) {
			const angle = placed.get(id)!.angle
			const d = Math.max(reachOf(parent) + reachOf(id) + gap, (2 * reachOf(id) + gap) / span)
			at.set(id, { x: from.x + d * Math.cos(angle), y: from.y + d * Math.sin(angle) })
			queue.push(id)
		}
	}
}

/** The soft pass: a few hundred cooling steps of repulsion, springs and the pull home. */
function relax(bodies: Body[], springs: { a: number; b: number; tree: boolean }[], unit: number, gap: number, round = false): void {
	// How far apart two bodies want to be: their reaches and a gap.
	const reach = bodies.map((b) => reachOfBox(b, round))
	const want = (i: number, j: number) => reach[i]! + reach[j]! + gap
	const steps = 240
	for (let step = 0; step < steps; step++) {
		const heat = 1 - step / steps
		const fx = new Float64Array(bodies.length)
		const fy = new Float64Array(bodies.length)
		for (let i = 0; i < bodies.length; i++) {
			for (let j = i + 1; j < bodies.length; j++) {
				if (bodies[i]!.pinned && bodies[j]!.pinned) continue
				const dx = bodies[j]!.x - bodies[i]!.x || 0.01 * (j - i)
				const dy = bodies[j]!.y - bodies[i]!.y
				const d2 = Math.max(1, dx * dx + dy * dy)
				const d = Math.sqrt(d2)
				const w = want(i, j)
				if (d > w * 3) continue
				const f = (w * w) / d2
				fx[i]! -= (f * dx) / d
				fy[i]! -= (f * dy) / d
				fx[j]! += (f * dx) / d
				fy[j]! += (f * dy) / d
			}
		}
		for (const s of springs) {
			const a = bodies[s.a]!
			const b = bodies[s.b]!
			const dx = b.x - a.x
			const dy = b.y - a.y
			const d = Math.max(1, Math.hypot(dx, dy))
			const f = (d - want(s.a, s.b)) * (s.tree ? 0.05 : 0.01)
			fx[s.a]! += (f * dx) / d
			fy[s.a]! += (f * dy) / d
			fx[s.b]! -= (f * dx) / d
			fy[s.b]! -= (f * dy) / d
		}
		const limit = unit * 0.25 * heat + 1
		bodies.forEach((b, i) => {
			if (b.pinned) return
			let mx = fx[i]! + (b.ax - b.x) * 0.04
			let my = fy[i]! + (b.ay - b.y) * 0.04
			const m = Math.hypot(mx, my)
			if (m > limit) {
				mx = (mx / m) * limit
				my = (my / m) * limit
			}
			b.x += mx
			b.y += my
		})
	}
}

/**
 * The hard pass: pushes overlapping boxes apart along the shorter axis, and nodes off any edge that
 * runs through them, until nothing is wrong or it has tried long enough.
 */
function separate(bodies: Body[], springs: { a: number; b: number; clear: boolean }[], gap: number): void {
	const pad = gap / 2
	const push = (b: Body, dx: number, dy: number) => {
		if (b.pinned) return
		b.x += dx
		b.y += dy
	}
	for (let round = 0; round < 200; round++) {
		let moved = false
		for (let i = 0; i < bodies.length; i++) {
			for (let j = i + 1; j < bodies.length; j++) {
				const a = bodies[i]!
				const b = bodies[j]!
				const dx = b.x - a.x
				const dy = b.y - a.y
				const ox = (a.w + b.w) / 2 + pad - Math.abs(dx)
				const oy = (a.h + b.h) / 2 + pad - Math.abs(dy)
				if (ox <= 0 || oy <= 0 || (a.pinned && b.pinned)) continue
				moved = true
				const share = a.pinned || b.pinned ? 1 : 0.5
				if (ox < oy) {
					const s = (dx >= 0 ? 1 : -1) * ox * share
					push(a, -s, 0)
					push(b, s, 0)
				} else {
					const s = (dy >= 0 ? 1 : -1) * oy * share
					push(a, 0, -s)
					push(b, 0, s)
				}
			}
		}
		for (const s of springs) {
			if (!s.clear) continue
			const a = bodies[s.a]!
			const b = bodies[s.b]!
			const lx = b.x - a.x
			const ly = b.y - a.y
			const len2 = lx * lx + ly * ly
			if (len2 < 1) continue
			for (const c of bodies) {
				if (c === a || c === b) continue
				const t = Math.max(0, Math.min(1, ((c.x - a.x) * lx + (c.y - a.y) * ly) / len2))
				const px = a.x + t * lx
				const py = a.y + t * ly
				let nx = c.x - px
				let ny = c.y - py
				const d = Math.hypot(nx, ny)
				const clearance = Math.min(c.w, c.h) / 2 + pad / 2
				if (d >= clearance || t === 0 || t === 1) continue
				moved = true
				if (d < 0.01) {
					// Exactly on the line: step off to its left.
					nx = -ly
					ny = lx
				}
				const n = Math.hypot(nx, ny)
				const sx = (nx / n) * (clearance - d)
				const sy = (ny / n) * (clearance - d)
				// An obstacle can't move, so the edge's far end steps the other way.
				if (!c.pinned) push(c, sx, sy)
				else if (!b.pinned) push(b, -sx * 2, -sy * 2)
				else push(a, -sx * 2, -sy * 2)
			}
		}
		if (!moved) return
	}
}

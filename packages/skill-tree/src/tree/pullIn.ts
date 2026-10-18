import type { GraphNode } from './layout'

/**
 * Closes the gaps a layout leaves: each branch, nearest the start first, slides whole toward the
 * node it hangs from, along its arrow, as far as it can with nothing covered and no arrow between
 * skill nodes crossing more nodes than it did. The structure stays; the empty space between a node
 * and the arc its children were put on is used.
 *
 * Then the clumps (each branch from a tree's root, whole) are drawn in toward the start like
 * gravity, nearest first, under the same rules, until they rest against each other: the regions
 * the skeleton left empty between branches are closed up without changing any branch's shape.
 */

type Point = { x: number; y: number }
type Box = Point & { w: number; h: number }

interface Line {
	ax: number
	ay: number
	bx: number
	by: number
}

/** Free space kept between two nodes. */
const PAD = 12
/** How far an arrow keeps from a node it passes. */
const ARROW_MARGIN = 7
/** The smallest slide worth trying. */
const STEP = 10
/** At most this many rounds of drawing the clumps in. */
const GRAVITY_ROUNDS = 4
/** At most this many rounds of ShrinkTree. */
const SHRINK_ROUNDS = 4

export function pullIn(
	at: Map<string, Point>,
	size: ReadonlyMap<string, GraphNode>,
	children: ReadonlyMap<string, readonly string[]>,
	parentOf: ReadonlyMap<string, string>,
	isSkill: (id: string) => boolean,
	start: string,
	/** The roots of the clumps that are then drawn in toward the start, each whole. */
	clumps: readonly string[] = [],
	/** Each skill node's cluster (it and its entries and works), moved whole by the last pass. */
	units: ReadonlyMap<string, readonly string[]> = new Map()
): void {
	const ids = [...at.keys()].filter((id) => size.has(id))
	const index = new Map(ids.map((id, i) => [id, i]))
	const boxes: Box[] = ids.map((id) => ({ ...at.get(id)!, w: size.get(id)!.w, h: size.get(id)!.h }))
	const grid = new Grid()
	const bounds = (b: Box) => [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2] as const
	boxes.forEach((b, i) => grid.add(i, ...bounds(b)))
	// The arrows between skill nodes, by the index of each end.
	const skillParent = (id: string) => {
		let p = parentOf.get(id)
		while (p && !isSkill(p)) p = parentOf.get(p)
		return p
	}
	const arrows = ids.filter((id) => isSkill(id) && skillParent(id) && index.has(skillParent(id)!)).map((id) => [index.get(skillParent(id)!)!, index.get(id)!] as const)

	const branch = (root: string) => {
		const out = new Set<number>()
		const queue = [root]
		for (let i = 0; i < queue.length; i++) {
			if (index.has(queue[i]!)) out.add(index.get(queue[i]!)!)
			queue.push(...(children.get(queue[i]!) ?? []))
		}
		return out
	}
	const moved = (i: number, moving: ReadonlySet<number>, dx: number, dy: number): Box => (moving.has(i) ? { ...boxes[i]!, x: boxes[i]!.x + dx, y: boxes[i]!.y + dy } : boxes[i]!)
	/** How many nodes the arrows a move affects pass through, with the branch shifted by (dx, dy). */
	const crossings = (moving: ReadonlySet<number>, dx: number, dy: number, onlySkills = false) => {
		const counts = (j: number) => !onlySkills || isSkill(ids[j]!)
		let n = 0
		for (const [a, c] of arrows) {
			const ma = moving.has(a)
			const mc = moving.has(c)
			const pa = moved(a, moving, dx, dy)
			const pc = moved(c, moving, dx, dy)
			const l = { ax: pa.x, ay: pa.y, bx: pc.x, by: pc.y }
			if (ma || mc) {
				for (const j of grid.alongLine(l, PAD + ARROW_MARGIN)) if (j !== a && j !== c && counts(j) && !(ma && mc && moving.has(j)) && crosses(l, moved(j, moving, dx, dy), ARROW_MARGIN)) n++
			} else {
				for (const i of moving) if (counts(i) && crosses(l, moved(i, moving, dx, dy), ARROW_MARGIN)) n++
			}
		}
		return n
	}
	const covers = (moving: ReadonlySet<number>, dx: number, dy: number) => {
		for (const i of moving) {
			const b = moved(i, moving, dx, dy)
			const [x0, y0, x1, y1] = bounds(b)
			for (const j of grid.near(x0 - PAD, y0 - PAD, x1 + PAD, y1 + PAD)) if (!moving.has(j) && overlaps(b, boxes[j]!, PAD)) return true
		}
		return false
	}
	const move = (moving: ReadonlySet<number>, dx: number, dy: number) => {
		for (const i of moving) {
			grid.remove(i, ...bounds(boxes[i]!))
			boxes[i] = { ...boxes[i]!, x: boxes[i]!.x + dx, y: boxes[i]!.y + dy }
			grid.add(i, ...bounds(boxes[i]!))
		}
	}

	const order = [start]
	for (let i = 0; i < order.length; i++) order.push(...(children.get(order[i]!) ?? []))
	for (const id of order) {
		const parent = isSkill(id) ? skillParent(id) : undefined
		if (!parent || !index.has(parent) || !index.has(id)) continue
		const moving = branch(id)
		const p = boxes[index.get(parent)!]!
		const self = () => boxes[index.get(id)!]!
		let gap = Math.hypot(self().x - p.x, self().y - p.y) - reach(self()) - reach(p) - PAD
		let step = gap / 2
		const before = () => crossings(moving, 0, 0)
		let now = before()
		while (step > STEP && gap > 0) {
			const d = Math.hypot(p.x - self().x, p.y - self().y)
			const [ux, uy] = [(p.x - self().x) / d, (p.y - self().y) / d]
			const s = Math.min(step, gap)
			if (!covers(moving, ux * s, uy * s) && crossings(moving, ux * s, uy * s) <= now) {
				move(moving, ux * s, uy * s)
				gap -= s
				now = before()
			} else step /= 2
		}
	}
	// Then gravity: each clump, nearest first, moves whole toward the start as far as it fits, along
	// the straight way in and, when that is blocked, along ways a little to either side. Rounds repeat
	// so an outer clump can follow into room an inner one left.
	const origin = boxes[index.get(start)!] ?? { x: 0, y: 0 }
	const groups = clumps.filter((id) => index.has(id)).map((id) => ({ id, members: branch(id) }))
	const centroid = (members: ReadonlySet<number>) => {
		let [x, y] = [0, 0]
		for (const i of members) [x, y] = [x + boxes[i]!.x, y + boxes[i]!.y]
		return { x: x / members.size, y: y / members.size }
	}
	for (let round = 0; round < GRAVITY_ROUNDS; round++) {
		let moved = 0
		// Farthest first: an outer branch settles against what is inside it, then the branch it hangs
		// from moves in with it.
		const byDistance = [...groups].sort((a, b) => {
			const ca = centroid(a.members)
			const cb = centroid(b.members)
			return Math.hypot(cb.x - origin.x, cb.y - origin.y) - Math.hypot(ca.x - origin.x, ca.y - origin.y)
		})
		for (const { id, members } of byDistance) {
			// Never nearer the start than the node it hangs from: the tree still grows outward.
			const parent = skillParent(id)
			const floor = parent && index.has(parent) ? Math.hypot(boxes[index.get(parent)!]!.x - origin.x, boxes[index.get(parent)!]!.y - origin.y) : 0
			const root = index.get(id)!
			const outward = (dx: number, dy: number) => Math.hypot(boxes[root]!.x + dx - origin.x, boxes[root]!.y + dy - origin.y) >= floor + reach(boxes[root]!)
			for (const turn of [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3]) {
				const c = centroid(members)
				const d = Math.hypot(origin.x - c.x, origin.y - c.y)
				if (d < STEP) break
				const a = Math.atan2(origin.y - c.y, origin.x - c.x) + turn
				const [ux, uy] = [Math.cos(a), Math.sin(a)]
				// No further along this way than brings the clump nearest the start.
				let left = d * Math.cos(turn)
				let step = left / 2
				let now = crossings(members, 0, 0, true)
				let went = 0
				while (step > STEP && left > STEP) {
					step = Math.min(step, left)
					if (outward(ux * step, uy * step) && !covers(members, ux * step, uy * step) && crossings(members, ux * step, uy * step, true) <= now) {
						left -= step
						move(members, ux * step, uy * step)
						went += step
						now = crossings(members, 0, 0, true)
					} else step /= 2
				}
				moved += went
			}
		}
		if (moved < STEP) break
	}
	shrinkTree()
	ids.forEach((id, i) => at.set(id, { x: boxes[i]!.x, y: boxes[i]!.y }))

	/**
	 * Last, ShrinkTree (ELK's SPOrE compaction, after Nachmanson et al.'s GTree run backwards): the
	 * clusters, each whole, are joined by a minimum spanning tree of the gaps between them, rooted at
	 * the start; then, from the root outward, each cluster slides along its tree edge toward its
	 * neighbour, everything beyond it in the spanning tree with it, as far as it fits. Gravity draws
	 * things toward the middle; this draws each toward whatever is nearest, so a cluster at the end of
	 * a long branch, with nothing between it and the middle to rest on, still closes up. Unlike
	 * gravity it may bring a branch nearer the middle than the node it hangs from: at a branch's end,
	 * the only room left is inward. Rounds repeat with a fresh spanning tree.
	 */
	function shrinkTree(): void {
		const unitIds = [...units.keys()].filter((u) => index.has(u))
		if (unitIds.length < 2 || !index.has(start)) return
		const membersOf = new Map(unitIds.map((u) => [u, (units.get(u) ?? []).filter((id) => index.has(id)).map((id) => index.get(id)!)]))
		const rootUnit = unitIds.includes(start) ? start : unitIds[0]!
		for (let round = 0; round < SHRINK_ROUNDS; round++) {
			const circle = new Map(
				unitIds.map((u) => {
					const members = membersOf.get(u)!
					const c = centroid(new Set(members))
					return [u, { ...c, r: Math.max(...members.map((i) => Math.hypot(boxes[i]!.x - c.x, boxes[i]!.y - c.y) + reach(boxes[i]!))) }]
				})
			)
			// Prim's minimum spanning tree over every pair, by the gap between their nearest nodes; the
			// circles round them only rule out pairs too far apart to be nearest neighbours.
			const gaps = new Map<string, number>()
			const gap = (a: string, b: string) => {
				const key = a < b ? `${a}|${b}` : `${b}|${a}`
				const known = gaps.get(key)
				if (known !== undefined) return known
				const p = circle.get(a)!
				const q = circle.get(b)!
				let g = Math.hypot(p.x - q.x, p.y - q.y) - p.r - q.r
				if (g < 2000) {
					g = Infinity
					for (const i of membersOf.get(a)!) for (const j of membersOf.get(b)!) g = Math.min(g, boxGap(boxes[i]!, boxes[j]!))
				}
				gaps.set(key, g)
				return g
			}
			const parentUnit = new Map<string, string>()
			const best = new Map(unitIds.filter((u) => u !== rootUnit).map((u) => [u, { cost: gap(rootUnit, u), from: rootUnit }]))
			const childrenOf = new Map<string, string[]>()
			while (best.size) {
				let pick = ''
				for (const [u, b] of best) if (!pick || b.cost < best.get(pick)!.cost) pick = u
				const { from } = best.get(pick)!
				best.delete(pick)
				parentUnit.set(pick, from)
				childrenOf.set(from, [...(childrenOf.get(from) ?? []), pick])
				for (const [u, b] of best) {
					const c = gap(pick, u)
					if (c < b.cost) best.set(u, { cost: c, from: pick })
				}
			}
			const subtree = (u: string): Set<number> => {
				const out = new Set<number>()
				const queue = [u]
				for (let i = 0; i < queue.length; i++) {
					for (const m of membersOf.get(queue[i]!)!) out.add(m)
					queue.push(...(childrenOf.get(queue[i]!) ?? []))
				}
				return out
			}
			let moved = 0
			const queue = [...(childrenOf.get(rootUnit) ?? [])]
			for (let i = 0; i < queue.length; i++) {
				const u = queue[i]!
				queue.push(...(childrenOf.get(u) ?? []))
				const from = circle.get(u)!
				const to = circle.get(parentUnit.get(u)!)!
				// Where the circles were before this round; the move is measured by what actually fits.
				const d = Math.hypot(to.x - from.x, to.y - from.y)
				if (d < STEP) continue
				const [ux, uy] = [(to.x - from.x) / d, (to.y - from.y) / d]
				const moving = subtree(u)
				let left = Math.max(0, d - from.r * 0.25)
				let step = left / 2
				let now = crossings(moving, 0, 0, true)
				while (step > STEP && left > STEP) {
					step = Math.min(step, left)
					if (!covers(moving, ux * step, uy * step) && crossings(moving, ux * step, uy * step, true) <= now) {
						move(moving, ux * step, uy * step)
						left -= step
						moved += step
						now = crossings(moving, 0, 0, true)
					} else step /= 2
				}
			}
			if (moved < STEP) break
		}
	}
}

/** The free space between two shapes, 0 when they touch or overlap. */
function boxGap(a: Box, b: Box): number {
	if (isRound(a) && isRound(b)) return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.w / 2 - b.w / 2)
	const dx = Math.max(0, Math.abs(a.x - b.x) - a.w / 2 - b.w / 2)
	const dy = Math.max(0, Math.abs(a.y - b.y) - a.h / 2 - b.h / 2)
	return Math.hypot(dx, dy)
}

/** Skill nodes and entries are discs; works and the header are boxes. Canvas sizes come back a hair off square. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)

/** Buckets of what is where, so a spot is only checked against what is near it. */
class Grid {
	private cells = new Map<number, number[]>()
	private seen: number[] = []
	private stamp = 0
	private static SIZE = 64
	private key = (i: number, j: number) => i * 65536 + j

	add(index: number, x0: number, y0: number, x1: number, y1: number): void {
		const s = Grid.SIZE
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				const k = this.key(i, j)
				const cell = this.cells.get(k)
				if (cell) cell.push(index)
				else this.cells.set(k, [index])
			}
		}
	}

	remove(index: number, x0: number, y0: number, x1: number, y1: number): void {
		const s = Grid.SIZE
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				const cell = this.cells.get(this.key(i, j))
				const at = cell?.indexOf(index) ?? -1
				if (at >= 0) cell!.splice(at, 1)
			}
		}
	}

	/** Each index whose bounds share a cell with these, once. */
	near(x0: number, y0: number, x1: number, y1: number): number[] {
		const out: number[] = []
		this.stamp++
		this.collect(x0, y0, x1, y1, out)
		return out
	}

	/** Each index near a line, within `pad` of it, once: the cells along it rather than its whole bounding box. */
	alongLine(l: Line, pad: number): number[] {
		const out: number[] = []
		this.stamp++
		const steps = Math.max(1, Math.ceil(Math.hypot(l.bx - l.ax, l.by - l.ay) / (Grid.SIZE / 2)))
		for (let i = 0; i <= steps; i++) {
			const x = l.ax + ((l.bx - l.ax) * i) / steps
			const y = l.ay + ((l.by - l.ay) * i) / steps
			this.collect(x - pad - Grid.SIZE / 2, y - pad - Grid.SIZE / 2, x + pad + Grid.SIZE / 2, y + pad + Grid.SIZE / 2, out)
		}
		return out
	}

	private collect(x0: number, y0: number, x1: number, y1: number, out: number[]): void {
		const s = Grid.SIZE
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				const cell = this.cells.get(this.key(i, j))
				if (!cell) continue
				for (const index of cell) {
					if (this.seen[index] === this.stamp) continue
					this.seen[index] = this.stamp
					out.push(index)
				}
			}
		}
	}
}

function boxDistance(b: Box, x: number, y: number): number {
	return Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(y - b.y) - b.h / 2))
}

function overlaps(a: Box, b: Box, pad: number): boolean {
	if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.y - b.y) < a.w / 2 + b.w / 2 + pad
	if (isRound(a)) return boxDistance(b, a.x, a.y) < a.w / 2 + pad
	if (isRound(b)) return boxDistance(a, b.x, b.y) < b.w / 2 + pad
	return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad
}

/** Does the line pass within `margin` of the shape? */
function crosses(l: Line, s: Box, margin: number): boolean {
	const dx = l.bx - l.ax
	const dy = l.by - l.ay
	if (isRound(s)) {
		const len2 = dx * dx + dy * dy || 1
		const t = Math.max(0, Math.min(1, ((s.x - l.ax) * dx + (s.y - l.ay) * dy) / len2))
		return Math.hypot(l.ax + t * dx - s.x, l.ay + t * dy - s.y) < s.w / 2 + margin
	}
	// Clip the line to the box grown by the margin (Liang–Barsky); anything left inside crosses it.
	let t0 = 0
	let t1 = 1
	const edges: [number, number][] = [
		[-dx, l.ax - (s.x - s.w / 2 - margin)],
		[dx, s.x + s.w / 2 + margin - l.ax],
		[-dy, l.ay - (s.y - s.h / 2 - margin)],
		[dy, s.y + s.h / 2 + margin - l.ay],
	]
	for (const [p, q] of edges) {
		if (p === 0) {
			if (q < 0) return false
			continue
		}
		const r = q / p
		if (p < 0) t0 = Math.max(t0, r)
		else t1 = Math.min(t1, r)
		if (t0 > t1) return false
	}
	return true
}

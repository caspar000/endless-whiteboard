/**
 * The maze layout (prototype; the user's idea, docs/skill-tree-layout-plan.md): instead of placing
 * nodes and fighting over the space between them, take a region of cells first, as many as the tree
 * needs, and grow the tree through it from the start, corridor by corridor.
 *
 * - **Region.** A grid of node-sized cells (hexagons or squares) round the start, as many as the
 *   tree's nodes times `fill`.
 * - **Forks.** A node's cells are split among its children by how many nodes each subtree holds: each
 *   child gets a connected piece of them, reached from the node by a corridor (the shortest way
 *   through what is left). Corridors may run along each other, so a family's paths share a trunk.
 * - **Chains.** A node with one child walks to it cell by cell through its piece: hugging the walls
 *   (`snake`, Warnsdorff's rule: the cell with fewest free neighbours) or heading outward
 *   (`straight`), always keeping the rest of the piece in reach, so it never walls itself in.
 */

import type { LayoutConfig } from './layoutDefaults'

type Point = { x: number; y: number }

/**
 * The maze as a placement (wholeLayout.ts): hexagon cells as wide as the biggest skill node past
 * the pillars and a gap, nodes side by side or `mazeSpacing` apart along a chain.
 */
export interface MazeInput {
	start: string
	/** Skill nodes breadth first from the start. */
	order: readonly string[]
	/** A skill node's skill-node children, in order. */
	kids: (id: string) => readonly string[]
	/** How far a skill node's cluster reaches from its centre. */
	radius: (id: string) => number
	config: LayoutConfig
}

export function mazeLayout({ start, order, kids, radius, config: C }: MazeInput): Map<string, Point> {
	// The cells as set; with clusters round the nodes (the view with everything), as big as the biggest needs.
	const pillars = new Set(kids(start))
	const widest = Math.max(0, ...order.filter((id) => id !== start && !pillars.has(id)).map(radius))
	const cell = Math.max(C.mazeCell, 2 * widest > C.skillSize + 1 ? 2 * widest + C.clusterGap : 0)
	const m = maze(start, order, kids, radius, { grid: C.mazeGrid, walk: C.mazeWalk, fill: C.mazeRoom, spacing: C.mazeSpacing, cell, hub: C.mazeHub })
	// Each node's whole way from its parent: through any shared corridor cells (`~n`) on the way.
	const into = new Map(m.corridors.map((c) => [c.to, c]))
	routes = new Map()
	for (const id of order) {
		let c = into.get(id)
		if (!c) continue
		let path = c.path
		while (c.from.startsWith('~') && into.has(c.from)) {
			c = into.get(c.from)!
			path = [...c.path, ...path.slice(1)]
		}
		routes.set(`${c.from} ${id}`, path)
	}
	return new Map(order.map((id) => [id, m.at.get(id)!]))
}

let routes: Map<string, Point[]> | null = null

/**
 * The corridors of the last maze laid out here, `parent child` → the way from the parent's centre to
 * the child's (the start at the origin); `null` when the last layout wasn't a maze (`forgetMazeRoutes`
 * before laying out).
 */
export const takeMazeRoutes = (): ReadonlyMap<string, Point[]> | null => routes
export const forgetMazeRoutes = (): void => {
	routes = null
}

export interface MazeOptions {
	grid: 'hex' | 'square'
	walk: 'snake' | 'straight'
	/** Cells per cell the tree takes to start from; the region grows from it until everything fits. */
	fill: number
	/** Open ground between the start and the first cells. */
	hub: number
	/** Cells from a node to its child: 1 next door, 2 with a corridor cell between. */
	spacing: number
	/** Distance between neighbouring cells' centres. */
	cell: number
}

export interface MazeResult {
	at: Map<string, Point>
	/** Every cell's centre, and which ones the tree took (nodes and corridors). */
	cells: Point[]
	used: Set<number>
	/** Each arrow's way: from the parent's centre through the corridor to the child's. */
	corridors: { from: string; to: string; path: Point[] }[]
	/** Nodes that found no room (placed beside their parent). */
	overflow: string[]
}

/**
 * The tightest region that holds the whole tree: `fill` first, then a little roomier each time until
 * no node is left without a cell (the outcome jumps about with the region's exact shape, so the
 * tightest that works is found by trying). `fill` in the result is the one used.
 */
export function maze(start: string, order: readonly string[], kids: (id: string) => readonly string[], radius: (id: string) => number, o: MazeOptions): MazeResult & { fill: number } {
	let best: (MazeResult & { fill: number }) | null = null
	const tries = (fill: number, ring: number, turn: number) => {
		// Two ways to start each family's pieces, as their shapes suit different trees: seeds growing at
		// once, or each seed first taking its own free sides.
		for (const claim of [false, true]) {
			const m = { ...mazeOnce(start, order, kids, radius, { ...o, fill, hub: o.hub + ring * o.cell }, claim, turn), fill }
			if (!best || m.overflow.length < best.overflow.length || (m.overflow.length === best.overflow.length && m.fill < best.fill)) best = m
			if (!m.overflow.length) return m
		}
		return null
	}
	// Roomier and roomier in big steps until everything fits, then back in small ones to the tightest
	// that still does. Failing at every size: the first cells a cell further out from the start (every
	// branch leaves through the ring round it, and a wider ring has more ways out), and the pillars
	// started a little further round either way.
	for (const ring of [0, 1, 2])
		for (const turn of [0, 0.25, -0.25])
			for (let fill = o.fill; fill <= o.fill + 3; fill += 0.25) {
				if (!tries(fill, ring, turn)) continue
				for (let back = fill - 0.05; back > fill - 0.249 && back >= o.fill; back -= 0.05) if (!tries(back, ring, turn)) break
				return best!
			}
	return best!
}

function mazeOnce(start: string, order: readonly string[], kids: (id: string) => readonly string[], radius: (id: string) => number, o: MazeOptions, claim: boolean, turn = 0): MazeResult {
	const size = new Map<string, number>()
	for (const id of [...order].reverse()) size.set(id, 1 + kids(id).reduce((n, k) => n + size.get(k)!, 0))
	const nodes = size.get(start)! - 1

	// The grid: cells clear of the start, out to as far as holds the tree's nodes times `fill`.
	const clear = radius(start) + o.cell * 0.5 + o.hub
	const hex = o.grid === 'hex'
	const s = o.cell / Math.sqrt(3)
	const centre = (q: number, r: number): Point => (hex ? { x: s * 1.5 * q, y: o.cell * (r + q / 2) } : { x: q * o.cell, y: r * o.cell })
	let reach = clear + o.cell
	let keys: [number, number][] = []
	for (;;) {
		keys = []
		const span = Math.ceil(reach / (hex ? s * 1.5 : o.cell)) + 2
		for (let q = -span; q <= span; q++)
			for (let r = -2 * span; r <= 2 * span; r++) {
				const c = centre(q, r)
				const d = Math.hypot(c.x, c.y)
				if (d >= clear && d <= reach) keys.push([q, r])
			}
		if (keys.length >= Math.ceil(nodes * o.fill)) break
		reach += o.cell * 0.25
	}
	const cells = keys.map(([q, r]) => centre(q, r))
	const index = new Map(keys.map(([q, r], i) => [`${q},${r}`, i]))
	const steps = hex
		? [
				[1, 0],
				[1, -1],
				[0, -1],
				[-1, 0],
				[-1, 1],
				[0, 1],
			]
		: [
				[1, 0],
				[0, -1],
				[-1, 0],
				[0, 1],
			]
	const nbr = keys.map(([q, r]) => steps.flatMap(([dq, dr]) => index.get(`${q + dq!},${r + dr!}`) ?? []))
	// The start isn't a cell: its neighbours are the cells round it.
	const ring = cells.map((c, i) => [i, Math.hypot(c.x, c.y)] as const).filter(([, d]) => d < clear + o.cell * 0.9).map(([i]) => i)
	const ORIGIN = -1
	const pt = (c: number): Point => (c === ORIGIN ? { x: 0, y: 0 } : cells[c]!)
	// Free cells next to `c` in `set` (a cell another branch has taken is never free).
	const nbrsIn = (c: number, set: ReadonlySet<number>) => (c === ORIGIN ? ring : nbr[c]!).filter((x) => set.has(x) && !used.has(x))
	/**
	 * A node whose own piece has no room left next to it borrows: the free cells beyond it, whoever's
	 * piece they were, join its region. Taken cells stay taken, so corridors still can't cross.
	 */
	const borrow = (c: number, region: Set<number>) => {
		const queue = (c === ORIGIN ? ring : nbr[c]!).filter((x) => !used.has(x))
		const seen = new Set(queue)
		while (queue.length) {
			const x = queue.shift()!
			region.add(x)
			for (const n of nbr[x]!) if (!used.has(n) && !seen.has(n)) seen.add(n), queue.push(n)
		}
		return nbrsIn(c, region)
	}

	const at = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	const used = new Set<number>()
	const corridors: MazeResult['corridors'] = []
	const overflow: string[] = []

	/** The cells of `set` reached from `from` without leaving it. */
	const component = (from: number, set: ReadonlySet<number>) => {
		const seen = new Set<number>([from])
		const queue = [from]
		while (queue.length) for (const n of nbr[queue.shift()!]!) if (set.has(n) && !seen.has(n)) seen.add(n), queue.push(n)
		return seen
	}
	// Where each node is, and each node's trunk: the shared corridor cells (`~n`) its family runs through.
	const cellOf = new Map<string, number>([[start, ORIGIN]])
	const ownerOf = new Map<string, string>()
	const trunks = new Map<string, { id: string; cell: number }[]>()
	const owner = (v: string) => ownerOf.get(v) ?? v
	/** A child that found no cell where it was meant to: tried again once the tree is grown (`repair`). */
	const pending: { k: string; v: string }[] = []
	const lost = (k: string, v: string) => {
		pending.push({ k, v: owner(v) })
	}

	const grow = (v: string, cv: number, region: Set<number>, from?: Point) => {
		const children = kids(v)
		if (!children.length) return
		if (children.length === 1 && cv !== ORIGIN) chain(v, children[0]!, cv, region)
		else fork(v, children, cv, region, from)
	}

	// A node with one child: a walk of `spacing` cells to it, then the rest of the piece to it.
	const chain = (v: string, k: string, cv: number, region: Set<number>) => {
		let cur = cv
		let heading: Point | null = null
		const path = [pt(cv)]
		for (let step = 0; step < o.spacing; step++) {
			let cands = nbrsIn(cur, region)
			if (!cands.length) cands = borrow(cur, region)
			if (!cands.length) {
				if (cur === cv) return lost(k, v)
				break
			}
			// Keep the most of the piece in reach, then walk as asked.
			const room = (c: number) => {
				const rest = new Set(region)
				rest.delete(c)
				let best = 0
				for (const n of nbrsIn(c, rest)) best = Math.max(best, component(n, rest).size)
				return best
			}
			const scored = cands.map((c) => ({ c, room: room(c) }))
			const most = Math.max(...scored.map((x) => x.room))
			const pick = scored
				.filter((x) => x.room >= most - 0.5)
				.map(({ c }) => {
					const p = pt(c)
					const q = pt(cur)
					const turn = heading ? 1 - ((p.x - q.x) * heading.x + (p.y - q.y) * heading.y) / o.cell : 0
					const free = nbrsIn(c, region).length
					return { c, score: o.walk === 'snake' ? free * 10 + turn : -Math.hypot(p.x, p.y) + turn * 50 }
				})
				.sort((a, b) => a.score - b.score)[0]!.c
			heading = { x: (pt(pick).x - pt(cur).x) / o.cell, y: (pt(pick).y - pt(cur).y) / o.cell }
			region.delete(pick)
			used.add(pick)
			path.push(pt(pick))
			cur = pick
		}
		at.set(k, pt(cur))
		cellOf.set(k, cur)
		corridors.push({ from: v, to: k, path })
		const next = nbrsIn(cur, region)
		const piece = next.length ? next.map((n) => component(n, region)).sort((a, b) => b.size - a.size)[0]! : new Set<number>()
		grow(k, cur, new Set([...piece]), path.at(-2))
	}

	// A node with several children: each child a seed cell next to it, in order, on the side away
	// from where the node was reached from; all the seeds grow at once, each as fast as its subtree
	// is big, until the room runs out, so the pieces come out connected and in proportion. Children
	// beyond the free cells round the node go through a shared corridor cell that forks again.
	let virtuals = 0
	const fork = (v: string, children: readonly string[], cv: number, region: Set<number>, from?: Point) => {
		const here = pt(cv)
		let free = nbrsIn(cv, region)
		if (!free.length) free = borrow(cv, region)
		if (!free.length) {
			for (const k of children) lost(k, v)
			return
		}
		const out = from ? Math.atan2(here.y - from.y, here.x - from.x) : -Math.PI / 2
		const off = (c: number) => Math.atan2(Math.sin(Math.atan2(pt(c).y - here.y, pt(c).x - here.x) - out), Math.cos(Math.atan2(pt(c).y - here.y, pt(c).x - here.x) - out))
		let groups: { ids: readonly string[]; size: number }[] = children.map((k) => ({ ids: [k], size: size.get(k)! }))
		if (groups.length > free.length) {
			// The last ones share a corridor.
			const keep = groups.slice(0, free.length - 1)
			const rest = groups.slice(free.length - 1)
			groups = [...keep, { ids: rest.flatMap((g) => g.ids), size: rest.reduce((n, g) => n + g.size, 0) }]
		}
		let seeds: number[]
		if (cv === ORIGIN) {
			// Round the start: each child's seed at the middle of its share of the circle, the first at the top.
			const sum = groups.reduce((n, g) => n + g.size, 0)
			let at = -Math.PI / 2 + turn - (Math.PI * groups[0]!.size) / sum
			const taken = new Set<number>()
			seeds = groups.map((g) => {
				const mid = at + (Math.PI * g.size) / sum
				at += (2 * Math.PI * g.size) / sum
				const c = free.filter((x) => !taken.has(x)).sort((a, b) => Math.abs(Math.atan2(Math.sin(Math.atan2(pt(a).y, pt(a).x) - mid), Math.cos(Math.atan2(pt(a).y, pt(a).x) - mid))) - Math.abs(Math.atan2(Math.sin(Math.atan2(pt(b).y, pt(b).x) - mid), Math.cos(Math.atan2(pt(b).y, pt(b).x) - mid))))[0]!
				taken.add(c)
				return c
			})
		} else {
			// The free cells most nearly straight on, then swept round in order.
			seeds = [...free].sort((a, b) => Math.abs(off(a)) - Math.abs(off(b))).slice(0, groups.length).sort((a, b) => off(a) - off(b))
		}
		// Every seed taken at once: an earlier sibling's branch, borrowing room, mustn't land on a later one's.
		for (const c of seeds) {
			region.delete(c)
			used.add(c)
		}
		const pieces = seeds.map((c) => new Set<number>([c]))
		if (claim) {
			// Each seed first takes its own free sides, one per child it forks to (at least one), biggest
			// branch first, so it isn't walled in by its siblings' pieces before it gets to grow.
			const sides = o.grid === 'hex' ? 5 : 3
			for (const i of groups.map((_, i) => i).sort((a, b) => groups[b]!.size - groups[a]!.size)) {
				const g = groups[i]!
				const forks = Math.max(1, Math.min(sides, g.ids.length > 1 ? g.ids.length : kids(g.ids[0]!).length))
				for (const n of nbrsIn(seeds[i]!, region).slice(0, forks)) {
					region.delete(n)
					pieces[i]!.add(n)
				}
			}
		}
		const queues = pieces.map((piece) => [...piece].flatMap((c) => nbrsIn(c, region)))
		const total = region.size
		const want = groups.map((g) => (total * g.size) / groups.reduce((n, x) => n + x.size, 0))
		// Grow the piece furthest behind its share, a cell at a time, nearest first.
		for (;;) {
			let best = -1
			for (let i = 0; i < groups.length; i++) {
				while (queues[i]!.length && !region.has(queues[i]![0]!)) queues[i]!.shift()
				if (!queues[i]!.length) continue
				if (best < 0 || pieces[i]!.size / want[i]! < pieces[best]!.size / want[best]!) best = i
			}
			if (best < 0) break
			// Round the start, each piece takes the cell nearest its own direction, so it grows outward as
			// a wedge instead of wrapping round a smaller neighbour; elsewhere, the nearest cell.
			let c: number
			if (cv === ORIGIN) {
				const dir = Math.atan2(pt(seeds[best]!).y, pt(seeds[best]!).x)
				const off = (x: number) => Math.abs(Math.atan2(Math.sin(Math.atan2(pt(x).y, pt(x).x) - dir), Math.cos(Math.atan2(pt(x).y, pt(x).x) - dir)))
				const q = queues[best]!.filter((x) => region.has(x))
				let at = 0
				for (let k = 1; k < q.length; k++) if (off(q[k]!) < off(q[at]!)) at = k
				c = q[at]!
				queues[best] = q.filter((_, k) => k !== at)
			} else c = queues[best]!.shift()!
			region.delete(c)
			pieces[best]!.add(c)
			for (const n of nbrsIn(c, region)) queues[best]!.push(n)
		}
		groups.forEach((g, i) => {
			const u = seeds[i]!
			used.add(u)
			const piece = pieces[i]!
			piece.delete(u)
			if (g.ids.length === 1) {
				const k = g.ids[0]!
				at.set(k, pt(u))
				cellOf.set(k, u)
				corridors.push({ from: v, to: k, path: [here, pt(u)] })
				grow(k, u, piece, here)
			} else {
				// A corridor cell, no node: its children fork from it.
				const corridor = `~${++virtuals}`
				ownerOf.set(corridor, owner(v))
				trunks.set(owner(v), [...(trunks.get(owner(v)) ?? []), { id: corridor, cell: u }])
				corridors.push({ from: v, to: corridor, path: [here, pt(u)] })
				fork(corridor, g.ids, u, piece, here)
			}
		})
	}

	const all = new Set(cells.map((_, i) => i))
	grow(start, ORIGIN, all)

	// Repair: a child left without a cell branches off its parent, or off anywhere along its parent's
	// trunk, into the roomiest free cell beside it, and its branch grows into whatever is free from
	// there. Taken cells stay taken, so nothing crosses.
	const freeFrom = (c: number) => {
		const seen = new Set<number>([c])
		const queue = [c]
		while (queue.length) for (const n of nbr[queue.shift()!]!) if (!used.has(n) && !seen.has(n)) seen.add(n), queue.push(n)
		return seen
	}
	for (let i = 0; i < pending.length; i++) {
		const { k, v } = pending[i]!
		if (at.has(k) || !cellOf.has(v)) continue
		const doors = [{ id: v, cell: cellOf.get(v)! }, ...(trunks.get(v) ?? [])]
		let best: { id: string; from: number; c: number; room: Set<number> } | null = null
		for (const d of doors)
			for (const c of (d.cell === ORIGIN ? ring : nbr[d.cell]!).filter((x) => !used.has(x))) {
				const room = freeFrom(c)
				if (!best || room.size > best.room.size) best = { id: d.id, from: d.cell, c, room }
			}
		if (!best) continue
		used.add(best.c)
		best.room.delete(best.c)
		at.set(k, pt(best.c))
		cellOf.set(k, best.c)
		corridors.push({ from: best.id, to: k, path: [pt(best.from), pt(best.c)] })
		grow(k, best.c, best.room, pt(best.from))
	}
	// Whatever is still without a cell sits beside its parent.
	const parentOf = new Map<string, string>()
	for (const id of order) for (const k of kids(id)) parentOf.set(k, id)
	for (const id of order) {
		if (at.has(id)) continue
		const p = at.get(parentOf.get(id) ?? start) ?? { x: 0, y: 0 }
		overflow.push(id)
		at.set(id, { x: p.x + 40, y: p.y + 40 })
	}
	return { at, cells, used, corridors, overflow }
}

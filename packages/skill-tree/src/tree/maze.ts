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
 * - With `wedges`, the start's children get slices of the circle by size instead of grown pieces.
 */

import type { BalloonInput } from './balloon'

type Point = { x: number; y: number }

/**
 * The maze as a placement (wholeLayout.ts): hexagon cells as wide as the biggest skill node past
 * the pillars and a gap, nodes side by side or `mazeSpacing` apart along a chain.
 */
export function mazeLayout({ start, order, kids, radius, config: C }: BalloonInput): Map<string, Point> {
	const pillars = new Set(kids(start))
	const widest = Math.max(0, ...order.filter((id) => id !== start && !pillars.has(id)).map(radius))
	const m = maze(start, order, kids, radius, { grid: 'hex', region: 'disc', walk: 'snake', fill: 1.5, spacing: C.mazeSpacing, cell: 2 * widest + C.clusterGap })
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
	region: 'disc' | 'wedges'
	walk: 'snake' | 'straight'
	/** Cells per node. */
	fill: number
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
	for (let fill = o.fill; fill <= o.fill + 4; fill += 0.05) {
		const m = { ...mazeOnce(start, order, kids, radius, { ...o, fill }), fill }
		if (!best || m.overflow.length < best.overflow.length) best = m
		if (!m.overflow.length) break
	}
	return best!
}

function mazeOnce(start: string, order: readonly string[], kids: (id: string) => readonly string[], radius: (id: string) => number, o: MazeOptions): MazeResult {
	const size = new Map<string, number>()
	for (const id of [...order].reverse()) size.set(id, 1 + kids(id).reduce((n, k) => n + size.get(k)!, 0))
	const nodes = size.get(start)! - 1

	// The grid: cells clear of the start, out to as far as holds the tree's nodes times `fill`.
	const clear = radius(start) + o.cell * 0.5 + 20
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
	const lost = (id: string, beside: Point) => {
		const walk = (k: string, p: Point) => {
			overflow.push(k)
			at.set(k, { x: p.x + 40, y: p.y + 40 })
			for (const g of kids(k)) walk(g, at.get(k)!)
		}
		walk(id, beside)
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
				if (cur === cv) return lost(k, pt(cv))
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
			for (const k of children) lost(k, here)
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
			let at = -Math.PI / 2 - (Math.PI * groups[0]!.size) / sum
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
		for (const c of seeds) region.delete(c)
		const pieces = seeds.map((c) => new Set<number>([c]))
		const queues = seeds.map((c) => [...nbrsIn(c, region)])
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
			const c = queues[best]!.shift()!
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
				corridors.push({ from: v, to: k, path: [here, pt(u)] })
				grow(k, u, piece, here)
			} else {
				// A corridor cell, no node: its children fork from it.
				const corridor = `~${++virtuals}`
				corridors.push({ from: v, to: corridor, path: [here, pt(u)] })
				fork(corridor, g.ids, u, piece, here)
			}
		})
	}

	const all = new Set(cells.map((_, i) => i))
	if (o.region === 'wedges') {
		// The start's children: slices of the circle by size, the first centred at the top.
		const pillars = kids(start)
		const sum = pillars.reduce((n, k) => n + size.get(k)!, 0)
		let from = -Math.PI / 2 - (Math.PI * size.get(pillars[0]!)!) / sum
		const angleOf = (c: number) => Math.atan2(cells[c]!.y, cells[c]!.x)
		for (const p of pillars) {
			const width = (2 * Math.PI * size.get(p)!) / sum
			const mid = from + width / 2
			const inside = (c: number) => {
				const a = ((((angleOf(c) - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
				return a < width
			}
			const slice = new Set([...all].filter(inside))
			const entry = ring.filter((c) => slice.has(c)).sort((a, b) => Math.abs(Math.atan2(Math.sin(angleOf(a) - mid), Math.cos(angleOf(a) - mid))) - Math.abs(Math.atan2(Math.sin(angleOf(b) - mid), Math.cos(angleOf(b) - mid))))[0]
			from += width
			if (entry === undefined) {
				lost(p, { x: 0, y: 0 })
				continue
			}
			const piece = component(entry, slice)
			piece.delete(entry)
			used.add(entry)
			at.set(p, pt(entry))
			corridors.push({ from: start, to: p, path: [{ x: 0, y: 0 }, pt(entry)] })
			grow(p, entry, piece, { x: 0, y: 0 })
		}
	} else grow(start, ORIGIN, all)

	for (const id of order) if (!at.has(id)) lost(id, { x: 0, y: 0 })
	return { at, cells, used, corridors, overflow }
}

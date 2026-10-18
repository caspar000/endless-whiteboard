import type { GraphEdge, GraphNode } from './layout'

/**
 * The compact layout for a view with entries (docs/skill-tree-plan.md, "Compact layout"): the tree
 * grown outward from its start, every node placed in turn at the free spot nearest what it hangs
 * from, so the tree packs as tight as it fits, like Path of Exile's passive tree.
 *
 * A skill node's entries go close around it, each entry's works close around that entry, a little
 * to the outer side of it. A skill node's child nodes then go just outside its cluster, each toward
 * its own share of the branch's way outward, and grow their clusters there. Arrows between skill
 * nodes cross nothing: the way out to a child is kept clear while the parent's cluster is placed,
 * and nothing is placed over an arrow once it is drawn. The light lines to entries and works avoid
 * nodes where they can; a dense list can't always, and those lines are drawn under the nodes.
 *
 * Pure and deterministic. Positions are centres, with the start at the origin.
 */

type Point = { x: number; y: number }
type Box = Point & { w: number; h: number }

export interface CompactOptions {
	isSkill: (id: string) => boolean
	/** The node at the middle; it stays at the origin. */
	start: string
	/** Nodes tied to what holds them without a line (the header). */
	unlined?: ReadonlySet<string>
	/** Boxes already on the board, as centres relative to the start. They never move. */
	obstacles?: readonly Box[]
}

/** Free space between two nodes. */
const PAD = 10
/** How far an arrow keeps from a node it passes. */
const ARROW_MARGIN = 14
/** What a light line through a node costs, in pixels further away. */
const CROSSING = 70
/** Spots tried: rings this far apart around the parent, spots this far apart along each ring. */
const STEP = 10
const ARC = 14
const MAX_RINGS = 200
/** No spot is looked for further than this from the parent. */
const MAX_REACH = 5000
const LOOK_ON = 6
/** How strongly a member keeps close to its skill node, beyond keeping close to its parent. */
const PULL = 0.3
/** How much a member prefers the outer side of what it hangs from. */
const OUTWARD = 0.6
/** How much of a cluster's room its nodes are expected to cover, for reserving it. */
const FILL = 0.6
/** Free room a child skill node needs around it where it lands, beyond its own size. */
const LANDING = 120
/** The arc a skill node's children fan out over, around the way its branch runs. */
const FAN = 1.2 * Math.PI

export function compactLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: CompactOptions): Map<string, Point> {
	const size = new Map(nodes.map((n) => [n.id, n]))
	const start = size.has(options.start) ? options.start : (nodes[0]?.id ?? '')
	const children = new Map<string, string[]>()
	const parentOf = new Map<string, string>()
	for (const e of edges) {
		if (!size.has(e.from) || !size.has(e.to) || e.to === start || parentOf.has(e.to)) continue
		parentOf.set(e.to, e.from)
		children.set(e.from, [...(children.get(e.from) ?? []), e.to])
	}
	const isSkill = (id: string) => options.isSkill(id) && id !== '' && size.has(id)
	// How much each subtree holds, for sharing a skill node's way outward among its children.
	const weight = new Map<string, number>()
	const order = [start]
	for (let i = 0; i < order.length; i++) order.push(...(children.get(order[i]!) ?? []))
	for (const id of [...order].reverse()) {
		const n = size.get(id)!
		weight.set(id, n.w * n.h + (children.get(id) ?? []).reduce((sum, c) => sum + weight.get(c)!, 0))
	}

	const board = new Board(options.obstacles ?? [])
	// Where something goes when no spot within reach is free at all, which a real tree doesn't get to.
	let far = 0
	const beyond = (p: Point) => ({ x: p.x, y: p.y - 10000 - 400 * far++ })
	const at = new Map<string, Point>()
	const put = (id: string, p: Point) => {
		at.set(id, p)
		board.addShape({ ...p, w: size.get(id)!.w, h: size.get(id)!.h }, id)
	}
	if (!start) return at
	put(start, { x: 0, y: 0 })

	// Room a cluster will need, kept free from the moment its skill node is placed until it grows.
	const roomFor = (skill: string) => {
		let area = 0
		const queue = (children.get(skill) ?? []).filter((id) => !isSkill(id))
		for (let i = 0; i < queue.length; i++) {
			const n = size.get(queue[i]!)!
			area += (n.w + PAD) * (n.h + PAD)
			queue.push(...(children.get(queue[i]!) ?? []).filter((c) => !isSkill(c)))
		}
		const r = reach(size.get(skill)!)
		return Math.sqrt(r * r + area / (Math.PI * FILL))
	}

	/**
	 * Where each child of a skill node will go: its share of the arc around the way the branch runs.
	 * Known as soon as the node is placed, so from then on its room and a clear way out to each child
	 * are kept, and no cluster grown first can close it in.
	 */
	const ways = new Map<string, { kid: string; angle: number; ray: number }[]>()
	const plan = (skill: string, outward: number | null) => {
		const p = at.get(skill)!
		const kids = (children.get(skill) ?? []).filter(isSkill)
		const shares = kids.map((k) => Math.sqrt(weight.get(k)!))
		const total = shares.reduce((a, b) => a + b, 0)
		const arc = outward === null ? 2 * Math.PI : Math.min(FAN, (kids.length * Math.PI) / 3)
		let cursor = (outward ?? -Math.PI / 2) - (outward === null ? 0 : arc / 2)
		const r = roomFor(skill)
		if (outward !== null) board.reserve({ ...p, w: 2 * r, h: 2 * r }, skill)
		const length = r + 2 * (reach(size.get(skill)!) + LANDING)
		ways.set(
			skill,
			kids.map((kid, i) => {
				const angle = cursor + (arc * shares[i]!) / total / 2
				cursor += (arc * shares[i]!) / total
				return { kid, angle, ray: board.addRay(p, angle, '', length) }
			})
		)
	}

	/** A skill node's cluster, then its children, each just outside it along its way out. */
	const grow = (skill: string): string[] => {
		const p = at.get(skill)!
		board.release(skill)
		const own = ways.get(skill) ?? []
		// While its own cluster is placed, the ways out run without end.
		const open = own.map((w) => board.addRay(p, w.angle, ''))
		const parent = parentOf.get(skill)
		placeCluster(skill, parent ? Math.atan2(p.y - at.get(parent)!.y, p.x - at.get(parent)!.x) : null)
		for (const ray of open) board.drop(ray)
		for (const way of own) {
			board.drop(way.ray)
			// It lands where a little room is free around it; the rest of its room is kept from then on.
			const landing = 2 * Math.min(roomFor(way.kid), reach(size.get(way.kid)!) + LANDING)
			const room = { id: way.kid, w: landing, h: landing }
			const options = { centre: p, pull: 0, dir: way.angle, out: 4, limit: 1.1, line: 'hard' } as const
			// Boxed in after all, it lands as near as it can with its arrow crossing as little as it can.
			const c = board.search(room, p, size.get(skill)!, skill, options) ?? board.search(room, p, size.get(skill)!, skill, { ...options, limit: Math.PI, line: 'soft' }) ?? beyond(p)
			put(way.kid, c)
			board.addLine({ ax: p.x, ay: p.y, bx: c.x, by: c.y }, true)
			plan(way.kid, Math.atan2(c.y - p.y, c.x - p.x))
		}
		return own.map((w) => w.kid)
	}

	/**
	 * A skill node's entries, each followed by its works, so a family stays together instead of an
	 * entry's works landing past the entries placed after it. Returns how far the cluster reaches.
	 */
	const placeCluster = (skill: string, outward: number | null): number => {
		const centre = at.get(skill)!
		let radius = reach(size.get(skill)!)
		const queue: string[] = []
		for (const entry of (children.get(skill) ?? []).filter((id) => !isSkill(id))) {
			const family = [entry]
			for (let i = 0; i < family.length; i++) family.push(...(children.get(family[i]!) ?? []).filter((c) => !isSkill(c)))
			queue.push(...family)
		}
		for (let i = 0; i < queue.length; i++) {
			const id = queue[i]!
			const parent = parentOf.get(id)!
			const from = at.get(parent)!
			const lined = !options.unlined?.has(id)
			// An entry leans away from where the branch came in; a work away from its skill node, beyond its entry.
			const dir = !lined ? -Math.PI / 2 : parent === skill ? outward : Math.atan2(from.y - centre.y, from.x - centre.x)
			const p =
				board.search(size.get(id)!, from, size.get(parent)!, parent, {
					centre,
					pull: PULL,
					dir,
					out: lined ? OUTWARD : 3,
					limit: Math.PI,
					line: lined ? 'soft' : 'none',
				}) ?? beyond(from)
			put(id, p)
			if (lined) board.addLine({ ax: from.x, ay: from.y, bx: p.x, by: p.y }, false)
			radius = Math.max(radius, Math.hypot(p.x - centre.x, p.y - centre.y) + reach(size.get(id)!))
		}
		return radius
	}

	plan(start, null)
	const queue = [start]
	for (let i = 0; i < queue.length; i++) queue.push(...grow(queue[i]!))
	pullIn(at, size, children, parentOf, isSkill, start, options.obstacles ?? [])
	// Anything the edges don't reach sits above the start.
	for (const n of nodes) if (!at.has(n.id)) put(n.id, board.search(n, { x: 0, y: 0 }, size.get(start)!, start, { centre: { x: 0, y: 0 }, pull: 0, dir: -Math.PI / 2, out: 3, limit: Math.PI, line: 'none' }) ?? beyond({ x: 0, y: 0 }))
	return at
}

/**
 * Closes the gaps growing left: each branch, nearest the start first, slides whole toward the node it
 * hangs from, along its arrow, as far as it can with nothing covered and every arrow between skill
 * nodes still clear. A branch that had to land far out comes back in once there is room.
 */
function pullIn(
	at: Map<string, Point>,
	size: ReadonlyMap<string, GraphNode>,
	children: ReadonlyMap<string, string[]>,
	parentOf: ReadonlyMap<string, string>,
	isSkill: (id: string) => boolean,
	start: string,
	obstacles: readonly Box[]
): void {
	const ids = [...at.keys()]
	const index = new Map(ids.map((id, i) => [id, i]))
	const boxes: Box[] = ids.map((id) => ({ ...at.get(id)!, w: size.get(id)!.w, h: size.get(id)!.h }))
	const grid = new Grid()
	const bounds = (b: Box) => [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2] as const
	boxes.forEach((b, i) => grid.add(i, ...bounds(b)))
	const fixed = obstacles.map((o) => ({ ...o }))
	obstacles.forEach((o, i) => grid.add(ids.length + i, ...bounds(o)))
	const boxOf = (i: number) => (i < ids.length ? boxes[i]! : fixed[i - ids.length]!)
	// The arrows between skill nodes, by the index of each end.
	const arrows = ids.filter((id) => isSkill(id) && parentOf.has(id)).map((id) => [index.get(parentOf.get(id)!)!, index.get(id)!] as const)

	const branch = (root: string) => {
		const out = new Set<number>()
		const queue = [root]
		for (let i = 0; i < queue.length; i++) {
			out.add(index.get(queue[i]!)!)
			queue.push(...(children.get(queue[i]!) ?? []))
		}
		return out
	}
	const fits = (moving: ReadonlySet<number>, dx: number, dy: number) => {
		for (const i of moving) {
			const b = { ...boxes[i]!, x: boxes[i]!.x + dx, y: boxes[i]!.y + dy }
			const [x0, y0, x1, y1] = bounds(b)
			for (const j of grid.near(x0 - PAD - ARROW_MARGIN, y0 - PAD - ARROW_MARGIN, x1 + PAD + ARROW_MARGIN, y1 + PAD + ARROW_MARGIN)) if (!moving.has(j) && overlaps(b, boxOf(j), PAD)) return false
		}
		for (const [a, c] of arrows) {
			const ma = moving.has(a)
			const mc = moving.has(c)
			const l = { ax: boxes[a]!.x + (ma ? dx : 0), ay: boxes[a]!.y + (ma ? dy : 0), bx: boxes[c]!.x + (mc ? dx : 0), by: boxes[c]!.y + (mc ? dy : 0) }
			if (ma && mc) {
				// Moving together, it can only run into what stays put.
				for (const j of grid.alongLine(l, PAD + ARROW_MARGIN)) if (!moving.has(j) && crosses(l, boxOf(j), ARROW_MARGIN / 2)) return false
				continue
			}
			// One end moves (the branch's own arrow) or neither (it may now run under what moves).
			for (const j of grid.alongLine(l, PAD + ARROW_MARGIN)) if (j !== a && j !== c && !moving.has(j) && crosses(l, boxOf(j), ARROW_MARGIN / 2)) return false
			if (!ma && !mc) {
				for (const i of moving) {
					const b = { ...boxes[i]!, x: boxes[i]!.x + dx, y: boxes[i]!.y + dy }
					if (crosses(l, b, ARROW_MARGIN / 2)) return false
				}
			} else {
				for (const i of moving) {
					if (i === a || i === c) continue
					const b = { ...boxes[i]!, x: boxes[i]!.x + dx, y: boxes[i]!.y + dy }
					if (crosses(l, b, ARROW_MARGIN / 2)) return false
				}
			}
		}
		return true
	}
	const move = (moving: ReadonlySet<number>, dx: number, dy: number) => {
		for (const i of moving) {
			grid.remove(i, ...bounds(boxes[i]!))
			boxes[i] = { ...boxes[i]!, x: boxes[i]!.x + dx, y: boxes[i]!.y + dy }
			grid.add(i, ...bounds(boxes[i]!))
		}
	}

	const order = [start]
	for (let i = 0; i < order.length; i++) order.push(...(children.get(order[i]!) ?? []).filter(isSkill))
	for (const id of order.slice(1)) {
		const self = boxes[index.get(id)!]!
		const parent = boxes[index.get(parentOf.get(id)!)!]!
		const moving = branch(id)
		let gap = Math.hypot(self.x - parent.x, self.y - parent.y) - reach(self) - reach(parent) - PAD
		let step = gap / 2
		while (step > STEP && gap > 0) {
			const d = Math.hypot(parent.x - boxes[index.get(id)!]!.x, parent.y - boxes[index.get(id)!]!.y)
			const ux = (parent.x - boxes[index.get(id)!]!.x) / d
			const uy = (parent.y - boxes[index.get(id)!]!.y) / d
			const s = Math.min(step, gap)
			if (fits(moving, ux * s, uy * s)) {
				move(moving, ux * s, uy * s)
				gap -= s
			} else step /= 2
		}
	}
	ids.forEach((id, i) => at.set(id, { x: boxes[i]!.x, y: boxes[i]!.y }))
}

interface Line {
	ax: number
	ay: number
	bx: number
	by: number
}

interface SearchOptions {
	/** The skill node whose cluster this is, to keep close to. */
	centre: Point
	pull: number
	/** The way it prefers to lie from its parent, or null for any. */
	dir: number | null
	/** How strongly it prefers that way. */
	out: number
	/** How far from that way it may lie, in radians. */
	limit: number
	/** A line from its parent: none, one that should avoid nodes, or an arrow that must. */
	line: 'none' | 'soft' | 'hard'
}

/** The owner of a reserved room once its cluster has grown into it. */
const RELEASED = '\0released'

/** What is placed so far, with buckets so a spot is only checked against what is near it. */
class Board {
	private shapes: (Box & { id: string; owner: string })[] = []
	private lines: (Line & { hard: boolean; dead: boolean })[] = []
	private rays: { line: number; owner: string }[] = []
	private shapeGrid = new Grid()
	private lineGrid = new Grid()
	/** For a parent and a size, the first ring around it that still had a free spot. */
	private full = new Map<string, number>()

	constructor(obstacles: readonly Box[]) {
		for (const o of obstacles) this.addShape(o, '')
	}

	addShape(b: Box, id: string, owner = ''): void {
		this.shapeGrid.add(this.shapes.push({ ...b, id, owner }) - 1, b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2)
	}

	/** Room kept free for `owner`'s cluster until it is released. */
	reserve(b: Box, owner: string): void {
		this.addShape(b, '', owner)
	}

	release(owner: string): void {
		this.shapes.forEach((s, i) => {
			if (s.owner !== owner) return
			s.owner = RELEASED
			this.shapeGrid.remove(i, s.x - s.w / 2, s.y - s.h / 2, s.x + s.w / 2, s.y + s.h / 2)
		})
		this.rays = this.rays.filter((r) => r.owner !== owner)
	}

	addLine(l: Line, hard: boolean): number {
		const index = this.lines.push({ ...l, hard, dead: false }) - 1
		this.lineGrid.add(index, Math.min(l.ax, l.bx), Math.min(l.ay, l.by), Math.max(l.ax, l.bx), Math.max(l.ay, l.by))
		return index
	}

	/** A line from `p`, without end unless given a length, kept clear until dropped or its owner released. */
	addRay(p: Point, angle: number, owner: string, far = 1e5): number {
		const line = this.lines.push({ ax: p.x, ay: p.y, bx: p.x + far * Math.cos(angle), by: p.y + far * Math.sin(angle), hard: true, dead: false }) - 1
		this.rays.push({ line, owner })
		return line
	}

	drop(line: number): void {
		this.lines[line]!.dead = true
		this.rays = this.rays.filter((r) => r.line !== line)
	}

	/** The cheapest free spot for `node` around its parent at `from`. */
	search(node: GraphNode, from: Point, parent: GraphNode, parentId: string, o: SearchOptions): Point | null {
		const base = minSupport(parent) + minSupport(node) + PAD
		const far = Math.hypot(from.x - o.centre.x, from.y - o.centre.y)
		// Something big is tried at coarser steps: a few pixels matter less to it.
		const scale = Math.max(1, minSupport(node) / 40)
		const step = STEP * scale
		let best: (Point & { cost: number }) | null = null
		let found = -1
		// Rings found full for this parent and this size stay full: nothing placed is ever taken away.
		const key = o.line === 'soft' ? `${parentId}|${node.w}x${node.h}` : ''
		for (let k = key ? (this.full.get(key) ?? 0) : 0; k < MAX_RINGS; k++) {
			// Rings close together near the parent, further apart further out.
			const near = base + step * (k + (k * k) / 60)
			// Nothing on this ring or beyond can cost less than this; and a few rings past the first
			// free spot is far enough to look for one whose line crosses less.
			if (best && (near + o.pull * Math.max(0, far - near) >= best.cost || k > found + LOOK_ON)) break
			if (near > MAX_REACH) break
			const da = Math.max((ARC * scale) / near, 0.01)
			const ring: (Point & { cost: number })[] = []
			const middle = o.dir ?? 0
			const limit = o.dir === null ? Math.PI : o.limit
			for (let j = 0; j * da <= limit; j++) {
				for (const sign of j ? [1, -1] : [1]) {
					const a = middle + sign * j * da
					const d = support(parent, a) + support(node, a) + PAD + step * (k + (k * k) / 60)
					const x = from.x + d * Math.cos(a)
					const y = from.y + d * Math.sin(a)
					const lean = o.dir === null ? 0 : (o.out * (1 - Math.cos(a - o.dir))) / 2
					ring.push({ x, y, cost: d * (1 + lean) + o.pull * Math.hypot(x - o.centre.x, y - o.centre.y) })
				}
			}
			ring.sort((a, b) => a.cost - b.cost)
			for (const c of ring) {
				if (best && c.cost >= best.cost) break
				if (this.covered(c.x, c.y)) continue
				const extra = this.price(node, c, from, parentId, o.line)
				if (extra === null) continue
				if (!best) {
					found = k
					if (key) this.full.set(key, k)
				}
				if (!best || c.cost + extra < best.cost) best = { ...c, cost: c.cost + extra }
			}
		}
		if (!best && o.limit < Math.PI) return this.search(node, from, parent, parentId, { ...o, limit: Math.PI })
		return best
	}

	/** Is the point inside something placed? The quick test that rules out most spots. */
	private covered(x: number, y: number): boolean {
		for (const i of this.shapeGrid.near(x, y, x, y)) {
			const s = this.shapes[i]!
			if (s.owner === RELEASED) continue
			if (isRound(s) ? Math.hypot(x - s.x, y - s.y) < s.w / 2 : Math.abs(x - s.x) < s.w / 2 && Math.abs(y - s.y) < s.h / 2) return true
		}
		return false
	}

	/** What a spot adds to the cost: null when it isn't free, else what its light line crosses. */
	private price(node: GraphNode, p: Point, from: Point, parentId: string, line: SearchOptions['line']): number | null {
		const box = { x: p.x, y: p.y, w: node.w, h: node.h }
		const room = PAD + ARROW_MARGIN
		const [x0, y0, x1, y1] = [p.x - node.w / 2 - room, p.y - node.h / 2 - room, p.x + node.w / 2 + room, p.y + node.h / 2 + room]
		for (const i of this.shapeGrid.near(x0, y0, x1, y1)) {
			const s = this.shapes[i]!
			if (s.owner !== RELEASED && overlaps(box, s, PAD)) return null
		}
		let crossed = 0
		for (const i of this.lineGrid.near(x0, y0, x1, y1)) {
			const l = this.lines[i]!
			if (l.dead || !crosses(l, box, l.hard ? ARROW_MARGIN : 0)) continue
			if (l.hard) return null
			crossed++
		}
		for (const r of this.rays) if (crosses(this.lines[r.line]!, box, ARROW_MARGIN)) return null
		if (line !== 'none') {
			const l = { ax: from.x, ay: from.y, bx: p.x, by: p.y }
			const margin = line === 'hard' ? ARROW_MARGIN / 2 : 0
			const near = this.shapeGrid.alongLine(l, room)
			for (const i of near) {
				const s = this.shapes[i]!
				if (s.id === parentId || s.owner || !crosses(l, s, margin)) continue
				if (line === 'hard') return null
				crossed++
			}
		}
		return crossed * CROSSING
	}
}

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

/** Skill nodes and entries are discs; works and the header are boxes. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)
const minSupport = (b: { w: number; h: number }) => Math.min(b.w, b.h) / 2
/** How far a shape reaches from its centre in direction `a`. */
const support = (b: { w: number; h: number }, a: number) => (isRound(b) ? b.w / 2 : (Math.abs(Math.cos(a)) * b.w) / 2 + (Math.abs(Math.sin(a)) * b.h) / 2)

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

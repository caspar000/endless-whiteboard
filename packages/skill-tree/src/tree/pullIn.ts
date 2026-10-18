import type { GraphNode } from './layout'

/**
 * Closes the gaps a layout leaves: each branch, nearest the start first, slides whole toward the
 * node it hangs from, along its arrow, as far as it can with nothing covered and no arrow between
 * skill nodes crossing more nodes than it did. The structure stays; the empty space between a node
 * and the arc its children were put on is used.
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

export function pullIn(
	at: Map<string, Point>,
	size: ReadonlyMap<string, GraphNode>,
	children: ReadonlyMap<string, readonly string[]>,
	parentOf: ReadonlyMap<string, string>,
	isSkill: (id: string) => boolean,
	start: string
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
	const crossings = (moving: ReadonlySet<number>, dx: number, dy: number) => {
		let n = 0
		for (const [a, c] of arrows) {
			const ma = moving.has(a)
			const mc = moving.has(c)
			const pa = moved(a, moving, dx, dy)
			const pc = moved(c, moving, dx, dy)
			const l = { ax: pa.x, ay: pa.y, bx: pc.x, by: pc.y }
			if (ma || mc) {
				for (const j of grid.alongLine(l, PAD + ARROW_MARGIN)) if (j !== a && j !== c && !(ma && mc && moving.has(j)) && crosses(l, moved(j, moving, dx, dy), ARROW_MARGIN)) n++
			} else {
				for (const i of moving) if (crosses(l, moved(i, moving, dx, dy), ARROW_MARGIN)) n++
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
	ids.forEach((id, i) => at.set(id, { x: boxes[i]!.x, y: boxes[i]!.y }))
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

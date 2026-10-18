import { layoutGraph, type GraphEdge, type GraphNode } from './layout'

/**
 * The compact layout for a view with entries (docs/skill-tree-plan.md, "Compact clusters"). Each
 * skill node is the middle of a cluster, like a group on Path of Exile's passive tree, with its
 * entries close around it. An entry and its works are one unit: the disc, then its works stacked in
 * a column beside it (two columns, one each side, when there are many). Each work's line runs from
 * the entry to the end of the work nearer it (`workAnchor`), so the lines fan out in the gap between
 * disc and column and cross nothing.
 *
 * Units are placed one at a time, each at the free spot nearest the middle within its own wedge of
 * the circle. A spot is free when the unit covers nothing, covers no line, and its line to the skill
 * node crosses nothing. Every arrow to another skill node leaves through a gap kept open for it.
 * The skill nodes are then laid out as discs as big as their clusters. Pure and deterministic.
 */

type Point = { x: number; y: number }
type Box = Point & { w: number; h: number }

export interface ClusterOptions {
	isSkill: (id: string) => boolean
	/** The node at the middle; it stays at the origin. */
	start: string
	/** Arrows between skill nodes, either way round, cross-links too: each leaves its cluster through a gap. */
	arrows?: readonly GraphEdge[]
	/** Entries tied to their skill node without a line (the header), so nothing keeps clear of one. */
	unlined?: ReadonlySet<string>
	/** Boxes already on the board, as centres relative to the start. They never move. */
	obstacles?: readonly Box[]
}

/** Free space between two members. */
const PAD = 12
/** How far a line keeps from a node it passes. */
const LINE_MARGIN = 6
/** Half the width of the gap an arrow leaves its cluster through. */
const GATE_MARGIN = 24
/** Free space between two clusters. */
const CLUSTER_GAP = 50
/** Spots tried: rings this far apart around the skill node, spots this far apart along each ring. */
const STEP = 14
const ARC = 16
const MAX_RINGS = 400

interface Unit {
	/** An entry, or the header. */
	head: GraphNode
	works: GraphNode[]
	/** Tied to the skill node by a line. */
	lined: boolean
}

interface Cluster {
	at: Map<string, Point>
	radius: number
}

export function clusterLayout(nodes: readonly GraphNode[], edges: readonly GraphEdge[], options: ClusterOptions): Map<string, Point> {
	const size = new Map(nodes.map((n) => [n.id, n]))
	const children = new Map<string, string[]>()
	for (const e of edges) if (size.has(e.from) && size.has(e.to)) children.set(e.from, [...(children.get(e.from) ?? []), e.to])
	const skills = nodes.filter((n) => options.isSkill(n.id)).map((n) => n.id)
	const inView = new Set(skills)

	// A skill node's units: each entry (or the header) with the works below it, in order.
	const unitsOf = new Map<string, Unit[]>()
	for (const skill of skills) {
		const units: Unit[] = []
		for (const id of children.get(skill) ?? []) {
			if (inView.has(id)) continue
			const works: GraphNode[] = []
			const queue = [...(children.get(id) ?? [])]
			for (let i = 0; i < queue.length; i++) {
				if (inView.has(queue[i]!)) continue
				works.push(size.get(queue[i]!)!)
				queue.push(...(children.get(queue[i]!) ?? []))
			}
			units.push({ head: size.get(id)!, works, lined: !options.unlined?.has(id) })
		}
		unitsOf.set(skill, units)
	}
	const neighbours = new Map<string, Set<string>>()
	for (const e of options.arrows ?? []) {
		if (!inView.has(e.from) || !inView.has(e.to) || e.from === e.to) continue
		neighbours.set(e.from, (neighbours.get(e.from) ?? new Set()).add(e.to))
		neighbours.set(e.to, (neighbours.get(e.to) ?? new Set()).add(e.from))
	}

	// 1. Each cluster with its gaps spread evenly, for its size; 2. the clusters as discs that size.
	const evenly = (n: number) => Array.from({ length: n }, (_, i) => -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n)
	const first = new Map(skills.map((s) => [s, arrange(size.get(s)!, unitsOf.get(s)!, evenly(neighbours.get(s)?.size ?? 0))]))
	const start = inView.has(options.start) ? options.start : skills[0]!
	const placed = layoutGraph(
		skills.map((id) => ({ id, w: first.get(id)!.radius * 2, h: first.get(id)!.radius * 2 })),
		edges.filter((e) => inView.has(e.from) && inView.has(e.to)),
		{ root: start, gap: CLUSTER_GAP, obstacles: options.obstacles, balloon: true }
	)
	// 3. Each cluster again, its gaps now facing the clusters its arrows go to; then clear of each other.
	const clusters = new Map<string, Cluster>()
	for (const s of skills) {
		const c = placed.get(s)
		if (!c) continue
		const gates = [...(neighbours.get(s) ?? [])].flatMap((n) => {
			const o = placed.get(n)
			return o ? [Math.atan2(o.y - c.y, o.x - c.x)] : []
		})
		clusters.set(s, arrange(size.get(s)!, unitsOf.get(s)!, gates))
	}
	const discs = [...clusters].map(([id, c]) => ({ id, ...placed.get(id)!, r: c.radius }))
	settle(discs, start, options.obstacles ?? [])

	const out = new Map<string, Point>()
	for (const d of discs) for (const [id, p] of clusters.get(d.id)!.at) out.set(id, { x: d.x + p.x, y: d.y + p.y })
	// Anything not in a cluster (nothing, usually) sits above what holds it.
	for (const n of nodes) {
		if (out.has(n.id)) continue
		const holder = edges.find((e) => e.to === n.id && out.has(e.from))
		const at = holder ? out.get(holder.from)! : { x: 0, y: 0 }
		const r = holder ? (clusters.get(holder.from)?.radius ?? 0) : 0
		out.set(n.id, { x: at.x, y: at.y - r - n.h / 2 - 40 })
	}
	return out
}

/** One cluster around its skill node at the origin, with an open gap toward each of `gates` (angles). */
function arrange(centre: GraphNode, units: readonly Unit[], gates: readonly number[]): Cluster {
	const at = new Map<string, Point>([[centre.id, { x: 0, y: 0 }]])
	const shapes: Box[] = []
	const lines: Line[] = []
	const shapeGrid = new Grid()
	const lineGrid = new Grid()
	const addShape = (s: Box) => shapeGrid.add(shapes.push(s) - 1, s.x - s.w / 2, s.y - s.h / 2, s.x + s.w / 2, s.y + s.h / 2)
	const addLine = (l: Line) => lineGrid.add(lines.push(l) - 1, Math.min(l.ax, l.bx), Math.min(l.ay, l.by), Math.max(l.ax, l.bx), Math.max(l.ay, l.by))
	addShape({ x: 0, y: 0, w: centre.w, h: centre.h })
	// Gaps for arrows run out from the middle without end, so they are checked apart from the grid.
	const far = 1e5
	const gateLines: Line[] = gates.map((g) => ({ ax: 0, ay: 0, bx: Math.cos(g) * far, by: Math.sin(g) * far, margin: GATE_MARGIN }))
	const wedge = wedges(units.map((u) => stack(u, 1, 0).span), gates)
	const room = PAD + GATE_MARGIN
	let radius = Math.max(centre.w, centre.h) / 2
	units.forEach((unit, index) => {
		const w = wedge[index]!
		const ways = stacks(unit)
		const free = (x: number, y: number, shape: Stack) => {
			const boxes = shape.footprint.map((b) => ({ ...b, x: b.x + x, y: b.y + y }))
			if (!boxes.every((b) => withinWedge(b, w))) return false
			for (const box of boxes) {
				const [x0, y0, x1, y1] = [box.x - box.w / 2 - room, box.y - box.h / 2 - room, box.x + box.w / 2 + room, box.y + box.h / 2 + room]
				for (const i of shapeGrid.near(x0, y0, x1, y1)) if (overlaps(box, shapes[i]!, PAD)) return false
				for (const i of lineGrid.near(x0, y0, x1, y1)) if (crosses(lines[i]!, box, lines[i]!.margin)) return false
				for (const g of gateLines) if (crosses(g, box, g.margin)) return false
			}
			if (!unit.lined) return true
			// The line in from the skill node crosses nothing, its own unit's columns included.
			const line = { ax: 0, ay: 0, bx: x, by: y, margin: LINE_MARGIN }
			const near = shapeGrid.near(Math.min(0, x) - room, Math.min(0, y) - room, Math.max(0, x) + room, Math.max(0, y) + room)
			for (const i of near) if (i > 0 && crosses(line, shapes[i]!, LINE_MARGIN)) return false
			return boxes.slice(1).every((b) => !crosses(line, b, LINE_MARGIN))
		}
		// Ring by ring outward, keeping the cheapest free spot. A spot costs at least its distance from
		// the middle, so once a ring starts beyond the best cost, nothing further can win.
		// Nowhere nearer than where the wedge first grows wide enough for the unit's head and half its span.
		const span = ways(1, 0)[0]!.span
		const fits = w.half < Math.PI / 2 ? (span / 2) / Math.sin(w.half) - span / 2 : 0
		const nearest = Math.max(minSupport(centre) + minSupport(unit.head) + PAD, fits)
		let best: { x: number; y: number; cost: number; shape: Stack } | null = null
		for (let k = 0; k < MAX_RINGS; k++) {
			const d = nearest + k * STEP
			if (best && d >= best.cost) break
			const ring: { x: number; y: number; cost: number }[] = []
			const da = Math.max(ARC / d, 0.02)
			// Inside its wedge only: a unit's line from the middle shadows what lies behind it, and kept
			// to wedges the shadows can't close off the circle before every unit is placed.
			for (let j = 0; j * da <= w.half; j++) {
				for (const sign of j ? [1, -1] : [1]) {
					const a = w.mid + sign * j * da
					ring.push({ x: d * Math.cos(a), y: d * Math.sin(a), cost: d * (1 + 0.5 * angleBetween(a, w.mid)) })
				}
			}
			ring.sort((a, b) => a.cost - b.cost)
			for (const c of ring) {
				if (best && c.cost >= best.cost) break
				const shape = ways(c.x / d, c.y / d).find((way) => free(c.x, c.y, way))
				if (shape) {
					best = { ...c, shape }
					break
				}
			}
		}
		const spot = best ?? { x: 0, y: -nearest - MAX_RINGS * STEP, shape: ways(0, -1)[0]! }
		at.set(unit.head.id, { x: spot.x, y: spot.y })
		for (const [id, p] of spot.shape.works) at.set(id, { x: spot.x + p.x, y: spot.y + p.y })
		for (const b of spot.shape.footprint) {
			const box = { ...b, x: b.x + spot.x, y: b.y + spot.y }
			addShape(box)
			radius = Math.max(radius, Math.hypot(box.x, box.y) + reach(box))
		}
		if (unit.lined) addLine({ ax: 0, ay: 0, bx: spot.x, by: spot.y, margin: LINE_MARGIN })
	})
	return { at, radius }
}

/** A unit laid out around its head at the origin. */
interface Stack {
	works: Map<string, Point>
	/** What it covers: the head first, then a box over each column and the gap its lines fan out in. */
	footprint: Box[]
	/** Its longer side: how much of a ring it takes, whichever way it faces. */
	span: number
}

/** Rows in one column before a unit's works split into two, one each side of the head. */
const ONE_COLUMN = 8
/** The gap between a head and its column, where the lines fan out. */
const FAN = 36
const ROW_GAP = 6

/**
 * A unit's works in a column on `side` of its head (1 right, -1 left, 0 split between both), the
 * column centred on the head (`hang` 0), hanging below it (1) or standing above it (-1).
 */
function stack(unit: Unit, side: -1 | 0 | 1, hang: -1 | 0 | 1): Stack {
	const head = unit.head
	const footprint: Box[] = [{ x: 0, y: 0, w: head.w, h: head.h }]
	const works = new Map<string, Point>()
	const half = Math.ceil(unit.works.length / 2)
	const columns: { side: 1 | -1; rows: GraphNode[] }[] = !unit.works.length
		? []
		: side === 0
			? [
					{ side: 1, rows: unit.works.slice(0, half) },
					{ side: -1, rows: unit.works.slice(half) },
				]
			: [{ side, rows: unit.works }]
	for (const column of columns) {
		if (!column.rows.length) continue
		const width = Math.max(...column.rows.map((r) => r.w))
		const pitch = Math.max(...column.rows.map((r) => r.h)) + ROW_GAP
		const near = head.w / 2 + FAN
		const n = column.rows.length
		// Hanging, the first row sits just below the head's middle, so a line can come in above it.
		const first = hang === 0 ? (-(n - 1) / 2) * pitch : hang * (pitch / 2 + LINE_MARGIN)
		const y = (i: number) => first + (hang === -1 ? -i : i) * pitch
		column.rows.forEach((row, i) => works.set(row.id, { x: column.side * (near + row.w / 2), y: y(i) }))
		// From inside the head's edge to the column's far side, so nothing settles where the lines run.
		const inner = head.h / 2 - 8
		const top = Math.min(y(0), y(n - 1)) - pitch / 2
		const bottom = Math.max(y(0), y(n - 1)) + pitch / 2
		const [y0, y1] = hang === 0 ? [Math.min(top, -inner), Math.max(bottom, inner)] : [top, bottom]
		const [x0, x1] = [head.w / 2 - 8, near + width]
		footprint.push({ x: (column.side * (x0 + x1)) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 })
	}
	const [x0, x1] = [Math.min(...footprint.map((b) => b.x - b.w / 2)), Math.max(...footprint.map((b) => b.x + b.w / 2))]
	const [y0, y1] = [Math.min(...footprint.map((b) => b.y - b.h / 2)), Math.max(...footprint.map((b) => b.y + b.h / 2))]
	return { works, footprint, span: Math.max(x1 - x0, y1 - y0) + PAD }
}

/**
 * The ways a unit can be laid out, best first for a unit in direction (ux, uy) from its skill node:
 * its column on the outer side, and reaching away from the node when the unit is above or below it.
 */
function stacks(unit: Unit): (ux: number, uy: number) => Stack[] {
	const cache = new Map<string, Stack>()
	const get = (side: -1 | 0 | 1, hang: -1 | 0 | 1) => {
		const key = `${side}${hang}`
		if (!cache.has(key)) cache.set(key, stack(unit, side, hang))
		return cache.get(key)!
	}
	if (!unit.works.length) return () => [get(1, 0)]
	return (ux, uy) => {
		const away = uy < 0 ? -1 : 1
		if (unit.works.length > ONE_COLUMN) return [get(0, away), get(0, -away as -1 | 1)]
		const side = ux < 0 ? -1 : 1
		const vertical = Math.abs(uy) > Math.abs(ux)
		return vertical ? [get(side, away), get(side, 0), get(-side as -1 | 1, away)] : [get(side, 0), get(side, away), get(side, -away as -1 | 1)]
	}
}

/** Where a line to a work ends: the middle of the work's end nearer what it hangs from, as a fraction of its width. */
export function workAnchor(work: Box, parent: Point): { x: number; y: number } {
	return { x: parent.x < work.x ? 0 : 1, y: 0.5 }
}

interface Wedge {
	mid: number
	/** Half its angle; π or more is the whole circle. */
	half: number
}

/**
 * The angle each unit keeps to, in proportion to how much of a ring it takes. Gates split the circle into
 * arcs and a unit's wedge stays inside one, so no wedge is cut in two by an arrow.
 */
function wedges(weights: readonly number[], gates: readonly number[]): Wedge[] {
	const total = weights.reduce((a, b) => a + b, 0)
	const sorted = [...gates].map(normalise).sort((a, b) => a - b)
	const arcs = sorted.length
		? sorted.map((g, i) => ({ from: g, to: i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 2 * Math.PI }))
		: [{ from: -Math.PI / 2, to: (3 * Math.PI) / 2 }]
	const out: Wedge[] = []
	let placed = 0
	let swept = 0
	for (const [i, arc] of arcs.entries()) {
		swept += arc.to - arc.from
		const group: number[] = []
		// A unit goes in this arc while the middle of its share of the circle falls inside it.
		while (out.length + group.length < weights.length) {
			const weight = weights[out.length + group.length]!
			if (i < arcs.length - 1 && ((placed + weight / 2) / total) * 2 * Math.PI > swept) break
			group.push(weight)
			placed += weight
		}
		const sum = group.reduce((n, g) => n + g, 0)
		let cursor = arc.from
		for (const weight of group) {
			const span = ((arc.to - arc.from) * weight) / sum
			out.push({ mid: cursor + span / 2, half: span / 2 })
			cursor += span
		}
	}
	return out
}

/**
 * Pushes clusters apart until none overlaps another or a box on the board. The start's stays put.
 * A cluster that came out a little bigger the second time needs it; the rest don't move.
 */
function settle(discs: (Point & { id: string; r: number })[], pinned: string, obstacles: readonly Box[]): void {
	for (let round = 0; round < 200; round++) {
		let moved = false
		for (let i = 0; i < discs.length; i++) {
			for (let j = i + 1; j < discs.length; j++) {
				const a = discs[i]!
				const b = discs[j]!
				const dx = b.x - a.x
				const dy = b.y - a.y
				const d = Math.hypot(dx, dy)
				const over = a.r + b.r + CLUSTER_GAP - d
				if (over <= 0) continue
				moved = true
				const [ux, uy] = d > 0.01 ? [dx / d, dy / d] : [1, 0]
				const [sa, sb] = a.id === pinned ? [0, 1] : b.id === pinned ? [1, 0] : [0.5, 0.5]
				a.x -= ux * over * sa
				a.y -= uy * over * sa
				b.x += ux * over * sb
				b.y += uy * over * sb
			}
		}
		for (const d of discs) {
			if (d.id === pinned) continue
			for (const o of obstacles) {
				const over = d.r + CLUSTER_GAP - boxDistance(o, d.x, d.y)
				if (over <= 0) continue
				moved = true
				const dx = d.x - o.x
				const dy = d.y - o.y
				const len = Math.hypot(dx, dy) || 1
				d.x += (dx / len) * over
				d.y += (dy / len) * over
			}
		}
		if (!moved) return
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

	/** Each index whose bounds share a cell with these, once. */
	near(x0: number, y0: number, x1: number, y1: number): number[] {
		const s = Grid.SIZE
		const out: number[] = []
		this.stamp++
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				for (const index of this.cells.get(this.key(i, j)) ?? []) {
					if (this.seen[index] === this.stamp) continue
					this.seen[index] = this.stamp
					out.push(index)
				}
			}
		}
		return out
	}
}

interface Line {
	ax: number
	ay: number
	bx: number
	by: number
	margin: number
}

/** Skill nodes and entries are discs; works and the header are boxes. */
const isRound = (b: { w: number; h: number }) => b.w === b.h
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)
/** How far a shape reaches from its centre in direction `a`. */
const minSupport = (b: { w: number; h: number }) => Math.min(b.w, b.h) / 2
const support = (b: { w: number; h: number }, a: number) => (isRound(b) ? b.w / 2 : (Math.abs(Math.cos(a)) * b.w) / 2 + (Math.abs(Math.sin(a)) * b.h) / 2)

/** Is the whole box inside the wedge, seen from the middle? */
function withinWedge(b: Box, w: Wedge): boolean {
	if (w.half >= Math.PI) return true
	for (const [x, y] of [
		[b.x - b.w / 2, b.y - b.h / 2],
		[b.x + b.w / 2, b.y - b.h / 2],
		[b.x - b.w / 2, b.y + b.h / 2],
		[b.x + b.w / 2, b.y + b.h / 2],
	] as const)
		if (angleBetween(Math.atan2(y, x), w.mid) > w.half) return false
	return true
}

const normalise = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))
const angleBetween = (a: number, b: number) => Math.abs(normalise(a - b))

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

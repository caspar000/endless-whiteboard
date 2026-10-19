import type { GraphNode } from './layout'
import { DEFAULT_LAYOUT, type LayoutConfig } from './layoutDefaults'

/**
 * A skill node's cluster, like a group on Path of Exile's passive tree (docs/skill-tree-layout-plan.md,
 * "Structure"): its entries on orbits round it, each joined to it by a spoke, and each entry's works
 * chained along arcs on the far side of it, in track order.
 *
 * - **Orbits.** Entries go round the first orbit as close as they fit. When they don't all fit, the
 *   rest go on a second orbit further out, each in a gap between two on the first, so its spoke
 *   passes between them. With more than that, the first orbit widens until half of them fit on it.
 * - **Gaps for arrows.** Every arrow from the skill node leaves through a gap kept open in both
 *   orbits (`gates`, angles from the node).
 * - **Works.** An entry's works go along an arc on its outer side, each next to the one before; a
 *   long list turns back along a second arc further out, so the chain never crosses itself.
 *
 * Pure. Positions are centres relative to the skill node.
 */

type Point = { x: number; y: number }
type Box = Point & { w: number; h: number }

export interface Family {
	entry: GraphNode
	/** In track order. */
	works: GraphNode[]
}

export interface Orbits {
	at: Map<string, Point>
	radius: number
}

/** Steps along an arc and round an orbit while looking for room. */
const TURN = (2 / 180) * Math.PI

/** The settings of the call in progress: helpers below read them (orbitCluster sets them for its call). */
let C: LayoutConfig = DEFAULT_LAYOUT
// Any setting goes (the layout tuner), so a negative arc is none.
const worksArc = () => (Math.max(0, C.worksArc) / 180) * Math.PI

export function orbitCluster(centre: GraphNode, families: readonly Family[], gates: readonly number[], config: LayoutConfig = DEFAULT_LAYOUT): Orbits {
	const outer = C
	C = config
	try {
		return orbitClusterNow(centre, families, gates)
	} finally {
		C = outer
	}
}

function orbitClusterNow(centre: GraphNode, families: readonly Family[], gates: readonly number[]): Orbits {
	const at = new Map<string, Point>()
	const core = reach(centre)
	if (!families.length) return { at, radius: core }
	const entryReach = Math.max(...families.map((f) => reach(f.entry)))
	let first = core + C.memberPad + entryReach

	const middle: Box = { x: 0, y: 0, w: centre.w, h: centre.h }
	// How many fit on the first orbit; the rest wait for the second, one per gap between them. The
	// families with the fewest works go on the first, so its edge stays close and the long lists
	// have the room further out; each orbit keeps track order.
	const smallFirst = [...families].sort((a, b) => a.works.length - b.works.length)
	let inner = fill(families, first, gates, 0, middle)
	let open: number[] = []
	for (let tries = 0; tries < 60 && inner.placed.length < families.length; tries++) {
		const count = fill(smallFirst, first, gates, C.spokeRoom, middle).placed.length
		const chosen = new Set(smallFirst.slice(0, count))
		inner = fill(families.filter((f) => chosen.has(f)), first, gates, C.spokeRoom, middle)
		open = gapsOf(inner.placed, gates)
		if (families.length - inner.placed.length <= open.length) break
		first *= Math.max(1.01, C.orbitGrowth)
	}
	const onFirst = new Set(inner.placed.map((u) => u.family))
	const rest = families.filter((f) => !onFirst.has(f))
	const shapes: Box[] = [middle]
	for (const unit of inner.placed) put(unit, at, shapes)

	if (rest.length) {
		// Second orbit: each family in a gap of its own between two on the first, as close in as it
		// fits there: clear of everything placed, of the arrows' gaps, and with its spoke passing between
		// the first orbit's families. Each finds its own distance, so one long list on the first orbit
		// doesn't push all of them out.
		const nearest = first + 2 * entryReach + C.memberPad
		const farthest = Math.max(...shapes.map((b) => Math.hypot(b.x, b.y) + reach(b))) + 2 * entryReach + C.memberPad
		const used = new Set<number>()
		for (const family of rest) {
			let best: { i: number; unit: Unit; r: number } | null = null
			for (const [i, angle] of open.entries()) {
				if (used.has(i)) continue
				for (let r = nearest; r <= farthest + 4 * Math.max(0, C.memberPad) && (!best || r < best.r); r += Math.max(1, 2 * C.memberPad)) {
					const unit = unitAt(family, r, angle)
					const span = spanOf(unit)
					const spoke = { ax: 0, ay: 0, bx: unit.boxes[0]!.x, by: unit.boxes[0]!.y }
					const clear =
						unit.boxes.every((x) => !shapes.some((y) => overlaps(x, y))) &&
						!gates.some((g) => withinSpan(g, angle + span.from, angle + span.to, r)) &&
						!shapes.slice(1).some((y) => crossesBox(spoke, y))
					if (clear) {
						best = { i, unit, r }
						break
					}
				}
			}
			// Nothing free inside the outer edge: the next free gap, past everything.
			if (!best) {
				const i = open.findIndex((_, k) => !used.has(k))
				const r = Math.max(...shapes.map((b) => Math.hypot(b.x, b.y) + reach(b))) + 2 * entryReach + C.memberPad
				best = { i: Math.max(0, i), unit: unitAt(family, r, open[Math.max(0, i)] ?? -Math.PI / 2), r }
			}
			used.add(best.i)
			put(best.unit, at, shapes)
		}
	}
	let radius = core
	for (const s of shapes) radius = Math.max(radius, Math.hypot(s.x, s.y) + reach(s))
	return { at, radius }
}

interface Unit {
	family: Family
	angle: number
	/** The entry first, then its works, relative to the skill node. */
	boxes: (Box & { id: string })[]
}

/** The angles between neighbouring families on an orbit, away from the arrows' gates: where a spoke to the next orbit can pass. */
function gapsOf(placed: readonly Unit[], gates: readonly number[]): number[] {
	if (!placed.length) return []
	const edges = placed.map((u) => ({ from: u.angle + spanOf(u).from, to: u.angle + spanOf(u).to })).sort((a, b) => a.from - b.from)
	const radius = Math.hypot(placed[0]!.boxes[0]!.x, placed[0]!.boxes[0]!.y)
	return edges
		.map((e, i) => {
			const next = i + 1 < edges.length ? edges[i + 1]!.from : edges[0]!.from + 2 * Math.PI
			return (e.to + next) / 2
		})
		.filter((g) => !gates.some((gate) => angleBetween(g, gate) < (C.gateRoom * 2) / radius))
}

/** As many families as fit round one orbit, in order, each as close after the last as it fits, clear of the gates. */
function fill(families: readonly Family[], radius: number, gates: readonly number[], spacing: number, centre: Box): { placed: Unit[] } {
	const placed: Unit[] = []
	const start = gates.length ? Math.min(...gates.map(normalise)) + C.gateRoom / radius : -Math.PI / 2
	let cursor = start
	const end = start + 2 * Math.PI - (gates.length ? (2 * C.gateRoom) / radius : 0)
	const room = (spacing + C.memberPad) / radius
	for (const family of families) {
		let unit: Unit | null = null
		let a = cursor
		for (let tries = 0; tries < 400 && a < end; tries++) {
			const u = unitAt(family, radius, a)
			const span = spanOf(u)
			// Its near edge onto the cursor, then past any gate it would cover.
			if (a + span.from < cursor - 1e-6) {
				a = cursor - span.from
				continue
			}
			const gate = gates.find((g) => withinSpan(g, a + span.from, a + span.to, radius))
			if (gate !== undefined) {
				a = a + span.from + normalisePositive(gate - (a + span.from)) + C.gateRoom / radius - span.from + 1e-3
				continue
			}
			if (a + span.to > end) break
			const prev = placed[placed.length - 1]
			if ((prev && touches(u, prev, spacing)) || u.boxes.slice(1).some((x) => overlaps(x, centre))) {
				a += TURN
				continue
			}
			unit = u
			cursor = a + span.to + room
			break
		}
		if (!unit) break
		placed.push(unit)
	}
	// The last may not run round into the first.
	while (placed.length > 1 && touches(placed[placed.length - 1]!, placed[0]!, spacing)) placed.pop()
	return { placed }
}

/** A family with its entry on the orbit at `angle`, its works along arcs beyond it. */
function unitAt(family: Family, radius: number, angle: number): Unit {
	const e = { id: family.entry.id, x: radius * Math.cos(angle), y: radius * Math.sin(angle), w: family.entry.w, h: family.entry.h }
	const boxes: (Box & { id: string })[] = [e]
	let row = 0
	let edge = reach(family.entry) + C.memberPad
	let a = -worksArc()
	let rowOuter = edge
	for (const work of family.works) {
		for (;;) {
			const dir = angle + (row % 2 ? -a : a)
			const d = edge + support(work, dir)
			const b = { id: work.id, x: e.x + d * Math.cos(dir), y: e.y + d * Math.sin(dir), w: work.w, h: work.h }
			const last = boxes[boxes.length - 1]!
			if (boxes.length === 1 || !overlaps(b, last)) {
				boxes.push(b)
				rowOuter = Math.max(rowOuter, d + support(work, dir))
				break
			}
			a += TURN
			if (a > worksArc()) {
				// The arc is full: back along the next one out.
				row++
				// Always further out, whatever the space between members is set to.
				edge = Math.max(edge + 1, rowOuter + C.memberPad)
				a = -worksArc()
			}
		}
	}
	return { family, angle, boxes }
}

/** The angles a unit covers either side of its own, seen from the skill node. */
function spanOf(u: Unit): { from: number; to: number } {
	let from = 0
	let to = 0
	for (const b of u.boxes) {
		for (const [x, y] of corners(b)) {
			const d = angleDiff(Math.atan2(y, x), u.angle)
			from = Math.min(from, d)
			to = Math.max(to, d)
		}
	}
	return { from, to }
}

/** Is an arrow's gate (an angle) inside these angles, with its room on each side at this radius? */
function withinSpan(gate: number, from: number, to: number, radius: number): boolean {
	const room = C.gateRoom / radius
	const g = from + normalisePositive(gate - from)
	return g >= from - room && g <= to + room
}

/** Does the segment pass through the box (or disc)? Its ends are where the segment starts and stops, not inside anything. */
function crossesBox(l: { ax: number; ay: number; bx: number; by: number }, b: Box): boolean {
	const steps = Math.max(2, Math.ceil(Math.hypot(l.bx - l.ax, l.by - l.ay) / 8))
	for (let k = 1; k < steps; k++) {
		const x = l.ax + ((l.bx - l.ax) * k) / steps
		const y = l.ay + ((l.by - l.ay) * k) / steps
		if (isRound(b) ? Math.hypot(x - b.x, y - b.y) < b.w / 2 : Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2) return true
	}
	return false
}

function touches(a: Unit, b: Unit, extra = 0): boolean {
	return a.boxes.some((x) => b.boxes.some((y) => overlaps(x, y, extra)))
}

function put(unit: Unit, at: Map<string, Point>, shapes: Box[]): void {
	for (const b of unit.boxes) {
		at.set(b.id, { x: b.x, y: b.y })
		shapes.push(b)
	}
}

const corners = (b: Box): [number, number][] => [
	[b.x - b.w / 2, b.y - b.h / 2],
	[b.x + b.w / 2, b.y - b.h / 2],
	[b.x - b.w / 2, b.y + b.h / 2],
	[b.x + b.w / 2, b.y + b.h / 2],
]
const normalise = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))
const normalisePositive = (a: number) => a - 2 * Math.PI * Math.floor(a / (2 * Math.PI))
const angleDiff = (a: number, b: number) => normalise(a - b)
const angleBetween = (a: number, b: number) => Math.abs(normalise(a - b))

/** Skill nodes and entries are discs; works and the header are boxes. Canvas sizes come back a hair off square. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)
/** How far a shape reaches from its centre in direction `a`. */
const support = (b: { w: number; h: number }, a: number) => (isRound(b) ? b.w / 2 : (Math.abs(Math.cos(a)) * b.w) / 2 + (Math.abs(Math.sin(a)) * b.h) / 2)

function overlaps(a: Box, b: Box, extra = 0): boolean {
	const pad = C.memberPad + extra
	if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.y - b.y) < a.w / 2 + b.w / 2 + pad
	if (isRound(a) || isRound(b)) {
		const [disc, box] = isRound(a) ? [a, b] : [b, a]
		return Math.hypot(Math.max(0, Math.abs(disc.x - box.x) - box.w / 2), Math.max(0, Math.abs(disc.y - box.y) - box.h / 2)) < disc.w / 2 + pad
	}
	return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad
}

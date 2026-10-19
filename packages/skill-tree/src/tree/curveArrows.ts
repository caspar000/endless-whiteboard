/**
 * Curving arrows round what they cross (docs/skill-tree-layout-plan.md, "Curved arrows"), the user's
 * idea: once the layout is done, an arrow between skill nodes that crosses another arrow, a light
 * line or a node it doesn't end at is tried bent, a little and then more, either way, and keeps the
 * gentlest bend that leaves it crossing least. Nothing moves; only the arrows' `bend` changes.
 *
 * The canvas draws a bent arrow as an arc through its two ends and a middle pushed off the chord by
 * `bend` (lines.ts, `arcBend`); here an arc is followed as a short polyline.
 */

type Point = { x: number; y: number }

export interface Curvable {
	id: string
	from: Point
	to: Point
	bend: number
	/** What it joins, by id: it may run into those. */
	ends: readonly string[]
}

export interface Disc {
	id: string
	x: number
	y: number
	r: number
}

/** Fractions of an arrow's length tried as its bend, either way. */
const TRIES = [0.08, 0.15, 0.25, 0.35, 0.5]
/** Pieces an arc is followed in. */
const PIECES = 16
/** Rounds over every arrow: bending one can clear, or block, another. */
const ROUNDS = 2

/**
 * The bend for each arrow in `arrows` that crosses least: other arrows (as they end up), `lines`
 * (light lines, as they are) and `discs` it doesn't end at. Arrows that cross nothing straight stay
 * straight.
 */
export function curveArrows(arrows: readonly Curvable[], lines: readonly Curvable[], discs: readonly Disc[]): Map<string, number> {
	const bend = new Map(arrows.map((a) => [a.id, 0]))
	const path = new Map<string, Point[]>()
	const boxOf = (p: readonly Point[]) => {
		let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
		for (const q of p) [x0, y0, x1, y1] = [Math.min(x0, q.x), Math.min(y0, q.y), Math.max(x1, q.x), Math.max(y1, q.y)]
		return { x0, y0, x1, y1 }
	}
	const lineShapes = lines.map((l) => {
		const p = arc(l.from, l.to, l.bend)
		return { ends: l.ends, p, box: boxOf(p) }
	})
	for (const a of arrows) path.set(a.id, arc(a.from, a.to, 0))

	/** How many things the arrow `a`, drawn along `p`, crosses. */
	const crossings = (a: Curvable, p: readonly Point[]) => {
		const box = boxOf(p)
		const near = (b: { x0: number; y0: number; x1: number; y1: number }, pad = 0) => b.x0 <= box.x1 + pad && b.x1 >= box.x0 - pad && b.y0 <= box.y1 + pad && b.y1 >= box.y0 - pad
		let n = 0
		for (const o of arrows) {
			if (o.id === a.id || o.ends.some((e) => a.ends.includes(e))) continue
			const q = path.get(o.id)!
			if (near(boxOf(q)) && polylinesCross(p, q)) n++
		}
		for (const l of lineShapes) {
			if (l.ends.some((e) => a.ends.includes(e)) || !near(l.box)) continue
			if (polylinesCross(p, l.p)) n++
		}
		for (const d of discs) {
			if (a.ends.includes(d.id) || !near({ x0: d.x - d.r, y0: d.y - d.r, x1: d.x + d.r, y1: d.y + d.r })) continue
			if (polylineNear(p, d) < d.r) n++
		}
		return n
	}

	for (let round = 0; round < ROUNDS; round++) {
		for (const a of arrows) {
			const straight = arc(a.from, a.to, 0)
			let best = { bend: 0, n: crossings(a, straight), p: straight }
			if (best.n) {
				const length = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y)
				for (const f of TRIES) {
					for (const sign of [1, -1]) {
						const b = sign * f * length
						const p = arc(a.from, a.to, b)
						const n = crossings(a, p)
						if (n < best.n) best = { bend: b, n, p }
					}
					if (!best.n) break
				}
			}
			bend.set(a.id, best.bend)
			path.set(a.id, best.p)
		}
	}
	return bend
}

/** The arc the canvas draws for `bend`, as a polyline: through both ends and the chord's middle pushed off by it. */
export function arc(from: Point, to: Point, bend: number): Point[] {
	const chord = Math.hypot(to.x - from.x, to.y - from.y)
	if (Math.abs(bend) < 0.5 || chord < 1) return [from, to]
	const u = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord }
	// The canvas puts the middle at the chord's middle plus per(u) × −bend, with per(u) = (u.y, −u.x).
	const mid = { x: (from.x + to.x) / 2 - u.y * bend, y: (from.y + to.y) / 2 + u.x * bend }
	// The circle through the three points.
	const [ax, ay, bx, by, cx, cy] = [from.x, from.y, mid.x, mid.y, to.x, to.y]
	const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
	if (Math.abs(d) < 1e-9) return [from, to]
	const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
	const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
	const r = Math.hypot(ax - ux, ay - uy)
	const a0 = Math.atan2(ay - uy, ax - ux)
	const am = Math.atan2(by - uy, bx - ux)
	const a1 = Math.atan2(cy - uy, cx - ux)
	// The way round from start to end that passes the middle.
	const sweep = (f: number, t: number) => ((((t - f) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
	const ccw = sweep(a0, am) < sweep(a0, a1)
	const total = ccw ? sweep(a0, a1) : -sweep(a1, a0)
	return Array.from({ length: PIECES + 1 }, (_, i) => {
		const t = a0 + (total * i) / PIECES
		return { x: ux + r * Math.cos(t), y: uy + r * Math.sin(t) }
	})
}

function polylinesCross(p: readonly Point[], q: readonly Point[]): boolean {
	for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) if (cross(p[i - 1]!, p[i]!, q[j - 1]!, q[j]!)) return true
	return false
}

function polylineNear(p: readonly Point[], d: Point): number {
	let best = Infinity
	for (let i = 1; i < p.length; i++) best = Math.min(best, nearSegment(d, p[i - 1]!, p[i]!))
	return best
}

/** Do the segments a→b and c→d cross (not merely touch at an end)? */
function cross(a: Point, b: Point, c: Point, d: Point): boolean {
	const o = (p: Point, q: Point, s: Point) => (q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x)
	return o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0
}

function nearSegment(p: Point, a: Point, b: Point): number {
	const [dx, dy] = [b.x - a.x, b.y - a.y]
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
	return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}

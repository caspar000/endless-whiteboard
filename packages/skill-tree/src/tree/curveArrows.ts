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
/** The grid's cells, about a cluster across. */
const CELL = 400
/** Pieces an arc is followed in. */
const PIECES = 16
/** Rounds over every arrow: bending one can clear, or block, another. */
const ROUNDS = 2
/** With `even`: the bends tried (fractions of the length, either way), and the rounds, as each arrow's best depends on its neighbours'. */
const EVEN_TRIES = [0.04, 0.08, 0.12, 0.17, 0.23, 0.3, 0.4, 0.5]
const EVEN_ROUNDS = 4
/** The deepest bend evenness alone may ask for, as a fraction of the length; deeper only clears crossings. */
const EVEN_DEEPEST = 0.3
/** What one crossing costs against evenness and bending: always more than any amount of either. */
const CROSSING = 1000
/** How much bending counts against evenness when `even` is low. */
const BENDING = 4

/**
 * The bend for each arrow in `arrows` that crosses least: other arrows (as they end up), `lines`
 * (light lines, as they are) and `discs` it doesn't end at. With `even` 0, arrows that cross nothing
 * straight stay straight. With `even` above 0 (up to 1), arrows also bend so that at each node they
 * leave at angles as evenly spaced round it as they can (Lombardi drawings, after Duncan, Eppstein,
 * Goodrich, Kobourov and Nöllenburg), traded against bending: crossings always count first.
 * `only`: the arrows to bend; the rest keep the bends they have (after a drag, only those it moved).
 */
export function curveArrows(arrows: readonly Curvable[], lines: readonly Curvable[], discs: readonly Disc[], even = 0, only?: ReadonlySet<string>): Map<string, number> {
	// Arrows left alone (not in `only`) keep their bend and count as they are.
	const bend = new Map(arrows.map((a) => [a.id, only && !only.has(a.id) ? a.bend : 0]))
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
	for (const a of arrows) path.set(a.id, arc(a.from, a.to, bend.get(a.id)!))

	// The light lines' pieces and the discs in a grid, so each piece of an arrow is checked only against
	// what is near it: a board has thousands of light lines, each an arc in sixteen pieces.
	const grid = new Map<string, { lines: number[]; discs: number[] }>()
	const cellsOf = (x0: number, y0: number, x1: number, y1: number) => {
		const out: string[] = []
		for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) out.push(`${i},${j}`)
		return out
	}
	const cell = (key: string) => {
		let c = grid.get(key)
		if (!c) grid.set(key, (c = { lines: [], discs: [] }))
		return c
	}
	const pieces: { line: number; a: Point; b: Point }[] = []
	lineShapes.forEach((l, li) => {
		for (let k = 1; k < l.p.length; k++) {
			const [a, b] = [l.p[k - 1]!, l.p[k]!]
			const index = pieces.push({ line: li, a, b }) - 1
			for (const key of cellsOf(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y))) cell(key).lines.push(index)
		}
	})
	discs.forEach((d, di) => {
		for (const key of cellsOf(d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r)) cell(key).discs.push(di)
	})

	/** How many things the arrow `a`, drawn along `p`, crosses. */
	const crossings = (a: Curvable, p: readonly Point[]) => {
		const box = boxOf(p)
		const near = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x0 <= box.x1 && b.x1 >= box.x0 && b.y0 <= box.y1 && b.y1 >= box.y0
		let n = 0
		for (const o of arrows) {
			if (o.id === a.id || o.ends.some((e) => a.ends.includes(e))) continue
			const q = path.get(o.id)!
			if (near(boxOf(q)) && polylinesCross(p, q)) n++
		}
		const crossedLines = new Set<number>()
		const crossedDiscs = new Set<number>()
		for (let k = 1; k < p.length; k++) {
			const [s, t] = [p[k - 1]!, p[k]!]
			for (const key of cellsOf(Math.min(s.x, t.x), Math.min(s.y, t.y), Math.max(s.x, t.x), Math.max(s.y, t.y))) {
				const c = grid.get(key)
				if (!c) continue
				for (const pi of c.lines) {
					const piece = pieces[pi]!
					if (crossedLines.has(piece.line) || lineShapes[piece.line]!.ends.some((e) => a.ends.includes(e))) continue
					if (cross(s, t, piece.a, piece.b)) crossedLines.add(piece.line)
				}
				for (const di of c.discs) {
					const d = discs[di]!
					if (crossedDiscs.has(di) || a.ends.includes(d.id)) continue
					if (nearSegment(d, s, t) < d.r) crossedDiscs.add(di)
				}
			}
		}
		return n + crossedLines.size + crossedDiscs.size
	}

	// Where each arrow leaves each of its ends: the direction of its first piece from that end.
	const leaving = (p: readonly Point[], atStart: boolean) => {
		const [a, b] = atStart ? [p[0]!, p[1]!] : [p[p.length - 1]!, p[p.length - 2]!]
		return Math.atan2(b.y - a.y, b.x - a.x)
	}
	const at = new Map<string, Curvable[]>()
	for (const a of arrows) for (const e of a.ends) at.set(e, [...(at.get(e) ?? []), a])
	/**
	 * How unevenly the arrows leave node `node`, with arrow `a` along `p`: the squared differences of
	 * the gaps between neighbouring arrows from an even share of the turn.
	 */
	const uneven = (node: string, a: Curvable, p: readonly Point[]) => {
		const all = at.get(node) ?? []
		if (all.length < 2) return 0
		const angles = all
			.map((o) => {
				const q = o.id === a.id ? p : path.get(o.id)!
				return leaving(q, o.ends[0] === node)
			})
			.sort((x, y) => x - y)
		const share = (2 * Math.PI) / angles.length
		let cost = 0
		angles.forEach((x, i) => {
			const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI
			cost += (next - x - share) ** 2
		})
		return cost
	}
	/** What a bend costs: crossings first by far, then, as much as `even` asks, unevenness and the bend itself. */
	const cost = (a: Curvable, b: number, p: readonly Point[], length: number) => {
		const n = crossings(a, p)
		if (!even) return { n, score: n * CROSSING + Math.abs(b) / length }
		const spread = a.ends.reduce((s, e) => s + uneven(e, a, p), 0)
		return { n, score: n * CROSSING + even * spread + (1 - even) * (b / length) ** 2 * BENDING + (b / length) ** 2 }
	}

	for (let round = 0; round < (even ? EVEN_ROUNDS : ROUNDS); round++) {
		for (const a of arrows) {
			if (only && !only.has(a.id)) continue
			const length = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) || 1
			const straight = arc(a.from, a.to, 0)
			let best = { bend: 0, p: straight, ...cost(a, 0, straight, length) }
			// Only dodging: an arrow that crosses nothing straight stays straight.
			if (best.n || even) {
				for (const f of even ? EVEN_TRIES : TRIES) {
					for (const sign of [1, -1]) {
						const b = sign * f * length
						const p = arc(a.from, a.to, b)
						const c = cost(a, b, p, length)
						// A deep bend only to clear a crossing, never for evenness alone.
						if (f > EVEN_DEEPEST && c.n >= crossings(a, straight)) continue
						if (c.score < best.score) best = { bend: b, p, ...c }
					}
					if (!even && !best.n) break
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

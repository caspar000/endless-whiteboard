import { siblingOrder, type BalloonInput } from './balloon'

/**
 * Placing skill nodes in bands (docs/skill-tree-layout-plan.md, "Bands"): a radial tidy tree. You
 * are in the middle and the pillars on one ring round you; every family below sits on an arc of its
 * own one step further out than its parent, so further out always means deeper, and each family
 * fans out from directly beyond the node it hangs from. A family fanning wider than `bandFan`
 * splits into staggered rows, each child's arrow passing between the ones in front of it.
 *
 * Along the arcs every branch keeps one unbroken wedge, in the YAML's order, the pillars clockwise
 * from the top. Bottom-up (Reingold and Tilford's tidy tree, in angles round You), each branch's
 * outline is the angle it covers in each ring-shaped strip round You, its nodes and its arrows; a
 * node's children are set side by side, each turned along only as far as its outline needs to clear
 * the ones before it in every strip, and the node is centred over them. So a branch takes only the
 * room it needs at each distance: a narrow branch next to a wide one tucks in beside it, and nothing
 * reserves a slice it doesn't fill.
 *
 * Where there isn't room round at some distance, the families on the innermost arcs there move out a
 * step, and the branches beyond them with them; the pillars stay close round You.
 */

type Point = { x: number; y: number }
/** A branch's outline: for each strip round You (by index), the angles it covers, relative to its node. */
type Outline = Map<number, { lo: number; hi: number }>

const TURN = 2 * Math.PI
/** How wide each strip round You is. */
const STRIP = 100
/** The most times families move out to make room round. */
const MOVES = 80
/** How far an arrow keeps other nodes off it, either side. */
const ARROW_ROOM = 12

export function bands({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)
	const pillars = kids(start)
	const fan = (C.bandFan / 180) * Math.PI

	/** How much further out than it need be each family's arc is, by the node it hangs from. */
	const lift = new Map<string, number>()
	const depth = new Map<string, number>([[start, 0]])
	for (const id of order) for (const kid of kids(id)) depth.set(kid, depth.get(id)! + 1)
	/** Each node's distance from You, for the pillars' ring at `ring`. */
	const distances = (ring: number) => {
		const out = new Map<string, number>([[start, 0]])
		for (const p of pillars) out.set(p, ring)
		for (const id of order) {
			const children = kids(id)
			if (id === start || !children.length) continue
			const outer = Math.max(...children.map(radius))
			const first = out.get(id)! + radius(id) + gap + outer + (lift.get(id) ?? 0)
			// Rows, when the family would fan wider than `bandFan` on one arc.
			const wide = children.reduce((n, k) => n + 2 * Math.asin(Math.min(1, (radius(k) + gap / 2) / first)), 0)
			const rows = Math.max(1, Math.min(C.bandRows, children.length, Math.ceil(wide / fan)))
			children.forEach((k, i) => out.set(k, first + (i % rows) * (2 * outer + gap)))
		}
		return out
	}

	let ring = radius(start) + C.hubRoom + Math.max(0, ...pillars.map(radius))
	let at = new Map<string, number>()
	let dist = distances(ring)
	for (let round = 0; round <= MOVES; round++) {
		dist = distances(ring)
		/** A node's outline: its disc, grown by half a gap, in each strip it reaches. */
		const disc = (id: string): Outline => {
			const out: Outline = new Map()
			const r = radius(id) + gap / 2
			const d = dist.get(id)!
			for (let s = Math.floor(Math.max(0, d - r) / STRIP); s * STRIP <= d + r; s++) {
				const w = discAngle(d, r, s * STRIP, (s + 1) * STRIP)
				if (w > 0) out.set(s, { lo: -w, hi: w })
			}
			return out
		}
		// Bottom-up: each branch's outline, and each child's angle relative to its parent.
		const outline = new Map<string, Outline>()
		const offset = new Map<string, number>()
		for (const id of [...order].reverse()) {
			if (id === start) continue
			const own = disc(id)
			const children = kids(id)
			if (children.length) {
				const { places, merged } = sideBySide(children.map((k) => withArrowIn(outline.get(k)!, dist.get(id)! + radius(id), dist.get(k)! - radius(k))))
				const mid = (places[0]! + places.at(-1)!) / 2
				children.forEach((k, i) => offset.set(k, places[i]! - mid))
				for (const [s, span] of merged) add(own, s, span.lo - mid, span.hi - mid)
				// The arrows out, as they run: from the node, straight to each child.
				for (const k of children) arrowInto(own, dist.get(id)!, 0, dist.get(k)!, offset.get(k)!, radius(id), radius(k))
			}
			outline.set(id, own)
		}

		// The pillars round the ring, each clear of every one before it in every strip, the spare
		// angle shared between them evenly, the first at the top.
		const { places, merged } = sideBySide(pillars.map((p) => outline.get(p)!))
		const widestSpan = Math.max(0, ...[...merged.values()].map((m) => m.hi - m.lo))
		if (widestSpan > TURN - 1e-6 && round < MOVES) {
			// Too little room round at some distance: the families on the innermost arcs there move out a
			// step, the pillars staying where they are; only if a pillar is in it does the whole ring move.
			const crowded = new Set([...merged].filter(([, m]) => m.hi - m.lo > TURN - 1e-6).map(([strip]) => strip))
			const there = order.filter((id) => id !== start && [...disc(id).keys()].some((k) => crowded.has(k)))
			const shallowest = Math.min(...there.map((id) => depth.get(id)!))
			if (shallowest <= 1) ring *= 1.1
			else for (const id of there) if (depth.get(id) === shallowest) lift.set(parentOf.get(id)!, (lift.get(parentOf.get(id)!) ?? 0) + Math.max(STRIP, 0.15 * dist.get(id)!))
			continue
		}
		const spare = pillars.length > 1 ? Math.max(0, TURN - widestSpan) / pillars.length : 0
		at = new Map([[start, 0]])
		pillars.forEach((p, i) => at.set(p, -Math.PI / 2 + places[i]! - places[0]! + i * spare))
		for (const id of order) for (const kid of kids(id)) if (id !== start) at.set(kid, at.get(id)! + offset.get(kid)!)
		break
	}

	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	for (const [id, a] of at) if (id !== start) out.set(id, { x: dist.get(id)! * Math.cos(a), y: dist.get(id)! * Math.sin(a) })
	return out
}

/** Widens `o`'s span in strip `s` to take in `lo`..`hi`. */
function add(o: Outline, s: number, lo: number, hi: number): void {
	const was = o.get(s)
	o.set(s, { lo: Math.min(was?.lo ?? Infinity, lo), hi: Math.max(was?.hi ?? -Infinity, hi) })
}

/**
 * A child's outline with its arrow in drawn straight in toward You, from its edge to the parent's: so
 * a child on an outer row is set where its arrow passes between the ones in front of it. (The arrow
 * as it really runs, to the centred parent, joins the parent's outline once the family is placed.)
 */
function withArrowIn(o: Outline, from: number, to: number): Outline {
	const out: Outline = new Map(o)
	for (let s = Math.floor(from / STRIP); s * STRIP < to; s++) {
		const w = ARROW_ROOM / Math.max((s + 0.5) * STRIP, 1)
		add(out, s, -w, w)
	}
	return out
}

/** The arrow from a node at (`d1`, `a1`) to one at (`d2`, `a2`), edge to edge, into `o`, strip by strip. */
function arrowInto(o: Outline, d1: number, a1: number, d2: number, a2: number, r1: number, r2: number): void {
	const [x1, y1, x2, y2] = [d1 * Math.cos(a1), d1 * Math.sin(a1), d2 * Math.cos(a2), d2 * Math.sin(a2)]
	const len = Math.hypot(x2 - x1, y2 - y1)
	if (len <= r1 + r2) return
	const steps = Math.ceil(len / (STRIP / 2))
	for (let i = 0; i <= steps; i++) {
		const t = r1 / len + ((1 - (r1 + r2) / len) * i) / steps
		const [x, y] = [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
		const d = Math.hypot(x, y)
		const a = Math.atan2(y, x)
		const w = ARROW_ROOM / Math.max(d, 1)
		add(o, Math.floor(d / STRIP), a - w, a + w)
	}
}

/**
 * The widest a disc of radius `r` whose centre is `d` from You reaches round, either side of its
 * centre, anywhere between `s0` and `s1` from You; 0 where it doesn't reach that far.
 */
function discAngle(d: number, r: number, s0: number, s1: number): number {
	if (d <= r) return Math.PI
	const at = (s: number) => {
		if (s <= 0 || s < d - r || s > d + r) return 0
		return Math.acos(Math.max(-1, Math.min(1, (d * d + s * s - r * r) / (2 * d * s))))
	}
	// Widest where the strip passes the disc's tangent, else at the strip's nearer edge.
	const tangent = Math.sqrt(d * d - r * r)
	const lo = Math.max(s0, d - r)
	const hi = Math.min(s1, d + r)
	if (lo > hi) return 0
	return Math.max(at(lo), at(hi), tangent >= lo && tangent <= hi ? Math.asin(r / d) : 0)
}

/**
 * Outlines set side by side, round from left to right: each turned along as little as clears all
 * the ones before it in every strip they share. Where each goes, and the outline of them all.
 */
function sideBySide(outlines: readonly Outline[]): { places: number[]; merged: Outline } {
	const merged: Outline = new Map()
	const places: number[] = []
	for (const o of outlines) {
		let place = places.length ? places.at(-1)! : 0
		for (const [s, span] of o) {
			const left = merged.get(s)
			if (left) place = Math.max(place, left.hi - span.lo)
		}
		places.push(place)
		for (const [s, span] of o) add(merged, s, place + span.lo, place + span.hi)
	}
	return { places, merged }
}

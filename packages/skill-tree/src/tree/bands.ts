import { atom } from '@lifeboard/canvas'
import { siblingOrder, type BalloonInput } from './balloon'

/**
 * Placing skill nodes in bands (docs/skill-tree-layout-plan.md, "Bands"), as the user sketched them:
 * a border round You for every level of the tree, the whole board sharing them. The pillars sit
 * inside the first border, tree roots between the first and the second, and so on: a node never
 * leaves its level's band, so further out always means deeper.
 *
 * Along the bands every branch keeps one unbroken wedge, in the YAML's order, the pillars clockwise
 * from the top, each node centred over its children (Reingold and Tilford's tidy tree, in angles
 * round You). A branch's outline is the angle it covers in each ring-shaped strip round You, its
 * nodes and its arrows; children are set side by side, each turned along only as far as it needs to
 * clear the ones before it in every strip, so a branch takes only the room it needs at each distance.
 * A band thick enough for more than one row lets a family fanning wider than `bandFan` stagger its
 * children across the rows, each arrow passing between the ones in front.
 *
 * A border can be set by hand (`bandBorders`, from the band guides on the board): it then stays
 * where it is set, however crowded its band gets, and what doesn't fit overlaps. A border left to
 * itself sits one row of its band's biggest cluster out from the one inside it; while the wedges
 * don't fit round, the innermost band they overrun, of those left to it, moves its border out a row.
 */

type Point = { x: number; y: number }
/** A branch's outline: for each strip round You (by index), the angles it covers, relative to its node. */
type Outline = Map<number, { lo: number; hi: number }>

/** How a band layout came out, for the band guides (tree/BandGuides.tsx). */
export interface BandReport {
	/** Each level's outer border, from You, the first the pillars'. */
	borders: number[]
	/** Whether each border was set by hand. */
	set: boolean[]
	/** How much of the way round each band's clusters take, at its fullest row: over 1, they can't all fit. */
	full: number[]
	/** Bands thinner than their biggest cluster. */
	thin: boolean[]
	/** Skill nodes whose clusters overlap another's. */
	overlapping: string[]
}

export const lastBands = atom<BandReport | null>('lifeboard:skill-tree-bands', null)

const TURN = 2 * Math.PI
/** How wide each strip round You is. */
const STRIP = 100
/** The most times a crowded band moves its border out. */
const MOVES = 60
/** How far an arrow keeps other nodes off it, either side. */
const ARROW_ROOM = 12

export function bands({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)
	const pillars = kids(start)
	const fan = (C.bandFan / 180) * Math.PI
	const depth = new Map<string, number>([[start, 0]])
	for (const id of order) for (const kid of kids(id)) depth.set(kid, depth.get(id)! + 1)
	const deepest = Math.max(0, ...depth.values())
	const widest = new Map<number, number>()
	for (const id of order) if (id !== start) widest.set(depth.get(id)!, Math.max(widest.get(depth.get(id)!) ?? 0, radius(id)))
	const rowStep = (d: number) => 2 * (widest.get(d) ?? 0) + gap
	const setBy = (d: number) => C.bandBorders[d - 1] ?? 0

	// The borders: border 0 is round You; each level's border one row of its biggest cluster out from
	// the one inside it, or where it was set.
	const grown = new Map<number, number>()
	const borders = () => {
		const out = [radius(start) + gap / 2]
		for (let d = 1; d <= deepest; d++) {
			const auto = out[d - 1]! + (d === 1 ? C.hubRoom : 0) + rowStep(d) * (1 + (grown.get(d) ?? 0))
			out.push(setBy(d) > 0 ? Math.max(out[d - 1]! + 1, setBy(d)) : auto)
		}
		return out
	}

	/** Each node's distance from You: the middle of its band, or its row. */
	const distances = (border: readonly number[]) => {
		const out = new Map<string, number>([[start, 0]])
		const room = (d: number) => Math.max(1, Math.min(C.bandRows, Math.floor((border[d]! - border[d - 1]!) / rowStep(d))))
		const rowAt = (d: number, row: number, rows: number) =>
			rows <= 1 ? (border[d - 1]! + border[d]!) / 2 : border[d - 1]! + (widest.get(d) ?? 0) + gap / 2 + row * rowStep(d)
		for (const p of pillars) out.set(p, rowAt(1, 0, 1))
		for (const id of order) {
			const children = kids(id)
			if (id === start || !children.length) continue
			const d = depth.get(id)! + 1
			const first = rowAt(d, 0, 1)
			const wide = children.reduce((n, k) => n + 2 * Math.asin(Math.min(1, (radius(k) + gap / 2) / first)), 0)
			const rows = Math.max(1, Math.min(room(d), children.length, Math.ceil(wide / fan)))
			children.forEach((k, i) => out.set(k, rowAt(d, i % rows, rows)))
		}
		return out
	}

	let border = borders()
	let dist = distances(border)
	let at = new Map<string, number>()
	let fullness: number[] = []
	for (let round = 0; round <= MOVES; round++) {
		border = borders()
		dist = distances(border)
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
				for (const k of children) arrowInto(own, dist.get(id)!, 0, dist.get(k)!, offset.get(k)!, radius(id), radius(k))
			}
			outline.set(id, own)
		}

		// The pillars round the first band, each clear of every one before it in every strip, the
		// spare angle shared between them evenly, the first at the top.
		const { places, merged } = sideBySide(pillars.map((p) => outline.get(p)!))
		// How full each band is: how far round its clusters take, each with its gap, row by row.
		const taken = new Map<string, number>()
		for (const id of order) {
			if (id === start) continue
			const key = `${depth.get(id)}:${Math.round(dist.get(id)!)}`
			taken.set(key, (taken.get(key) ?? 0) + 2 * Math.asin(Math.min(1, (radius(id) + gap / 2) / dist.get(id)!)))
		}
		fullness = border.slice(1).map((_, i) => Math.max(0, ...[...taken].filter(([k]) => k.startsWith(`${i + 1}:`)).map(([, a]) => a / TURN)))
		const widestSpan = Math.max(0, ...[...merged.values()].map((m) => m.hi - m.lo))
		if (widestSpan > TURN + 1e-6 && round < MOVES) {
			// The wedges don't go round: the innermost band they overrun, of those left to the layout,
			// moves its border out a row.
			const overrun = border.slice(1).findIndex((outer, i) => {
				if (setBy(i + 1) > 0) return false
				for (const [s, span] of merged) if ((s + 0.5) * STRIP > border[i]! && (s + 0.5) * STRIP <= outer && span.hi - span.lo > TURN + 1e-6) return true
				return false
			})
			if (overrun >= 0) {
				grown.set(overrun + 1, (grown.get(overrun + 1) ?? 0) + 1)
				continue
			}
		}
		const spare = pillars.length > 1 ? Math.max(0, TURN - widestSpan) / pillars.length : 0
		at = new Map([[start, 0]])
		pillars.forEach((p, i) => at.set(p, -Math.PI / 2 + places[i]! - places[0]! + i * spare))
		for (const id of order) for (const kid of kids(id)) if (id !== start) at.set(kid, at.get(id)! + offset.get(kid)!)
		break
	}

	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	for (const [id, a] of at) if (id !== start) out.set(id, { x: dist.get(id)! * Math.cos(a), y: dist.get(id)! * Math.sin(a) })
	const placed = [...out.keys()].filter((id) => id !== start)
	const overlapping = new Set<string>()
	for (let i = 0; i < placed.length; i++)
		for (let j = i + 1; j < placed.length; j++) {
			const [a, b] = [out.get(placed[i]!)!, out.get(placed[j]!)!]
			if (Math.hypot(a.x - b.x, a.y - b.y) < radius(placed[i]!) + radius(placed[j]!)) overlapping.add(placed[i]!).add(placed[j]!)
		}
	lastBands.set({
		borders: border.slice(1),
		set: border.slice(1).map((_, i) => setBy(i + 1) > 0),
		full: fullness,
		thin: border.slice(1).map((outer, i) => outer - border[i]! < 2 * (widest.get(i + 1) ?? 0)),
		overlapping: [...overlapping],
	})
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

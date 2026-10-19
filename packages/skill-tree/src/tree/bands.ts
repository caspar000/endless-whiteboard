import { siblingOrder, type BalloonInput } from './balloon'
import type { LayoutConfig } from './layoutDefaults'

/**
 * Placing skill nodes in bands (docs/skill-tree-layout-plan.md, "Bands"), as the user sketched them:
 * a border round You for every band, the whole board sharing them, and a region round You for every
 * pillar. Further out always means deeper.
 *
 * - **Regions.** Each pillar gets a share of the way round in proportion to how much grows from it
 *   (none less than `minSlice`), the first centred at the top and the rest clockwise; the pillar sits
 *   in its middle, in the first band.
 * - **Expand circles.** Each node's children go in a circle that starts at the node and reaches
 *   outward, straight away from You (`expandRadius`): on the arc of the next band the circle takes
 *   in, side by side and centred on their parent. A family too wide for that arc alternates between
 *   it and the arcs of the bands beyond (up to `bandRows`), never a band further in; only if that
 *   still doesn't fit does the circle grow, to twice its radius at most.
 * - **Packing.** Band by band from the middle out, each node where its parent's circle puts it,
 *   turned with its parent; then families meeting in a band clear each other, every node keeping the
 *   tree's order and moving as little as it can (least squares, by pool-adjacent-violators), inside
 *   its pillar's region and never past its edges. Where a region's arc of a band can't hold its
 *   nodes, its widest family staggers, every other child moving out a band with its arrow between
 *   the siblings that stay, until the arc can: each region fills out as a widening cone.
 *
 * The borders never move to make room: what doesn't fit overlaps, and the band guides
 * (tree/BandGuides.tsx) show it, with the regions and, if asked, the expand circles.
 */

type Point = { x: number; y: number }

/** How a band layout came out, for the band guides (tree/BandGuides.tsx). */
export interface BandReport {
	/** Each level's outer border, from You, the first the pillars'. */
	borders: number[]
	/** Whether each border was set by hand. */
	set: boolean[]
	/** How much of the way round each band's clusters take, in its fullest row: over 1, they can't all fit. */
	full: number[]
	/** Bands thinner than their biggest cluster. */
	thin: boolean[]
	/** Skill nodes whose clusters overlap another's. */
	overlapping: string[]
	/** Where each pillar's region starts, going clockwise: the lines between regions. */
	regions: number[]
	/** Each node's expand circle, relative to You. */
	circles: { x: number; y: number; r: number }[]
}

let report: BandReport | null = null

/** How the last band layout run here came out; the board shows it (bandReport.ts publishes it). */
export const takeBandReport = (): BandReport | null => report

const TURN = 2 * Math.PI
/** The most bands a layout uses, however much moves out. */
const MOST_BANDS = 40
/** The most an expand circle grows, as a multiple of `expandRadius`. */
const GROW = 2

/** Each level's border, from the first (the pillars'): set by hand, or the defaults, then `bandStep` more each. */
export function bandBorders(C: LayoutConfig, levels: number): { borders: number[]; set: boolean[] } {
	const borders: number[] = []
	const set: boolean[] = []
	for (let d = 1; d <= levels; d++) {
		const own = C.bandBorders[d - 1] ?? 0
		const auto = d === 1 ? C.bandFirst : d === 2 ? C.bandSecond : C.bandThird + (d - 3) * C.bandStep
		const inner = borders[d - 2] ?? 0
		borders.push(Math.max(inner + 1, own > 0 ? own : auto))
		set.push(own > 0)
	}
	return { borders, set }
}

export function bands({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)
	const pillars = kids(start)
	// Borders far enough out for every band a family can split into.
	let { borders, set } = bandBorders(C, 1)
	const border = (k: number) => {
		if (k > borders.length) ({ borders, set } = bandBorders(C, k))
		return borders[k - 1]!
	}
	const inner = (k: number) => (k === 1 ? radius(start) + gap : border(k - 1))
	const middle = (k: number) => (inner(k) + border(k)) / 2
	const halfAt = (id: string, r: number) => Math.asin(Math.min(1, (radius(id) + gap / 2) / Math.max(r, 1)))

	// The regions: each pillar's share of the way round, in proportion to how much grows from it, at
	// least `minSlice`, the first centred at the top and the rest clockwise.
	const weight = new Map<string, number>()
	for (const id of [...order].reverse()) weight.set(id, (id === start ? 0 : radius(id)) + kids(id).reduce((n, k) => n + weight.get(k)!, 0))
	const minSlice = pillars.length * ((C.minSlice / 180) * Math.PI) <= TURN ? (C.minSlice / 180) * Math.PI : 0
	const shares = spread(pillars.map((p) => weight.get(p)!), TURN, minSlice)
	const regions: { id: string; from: number; to: number }[] = []
	let around = -Math.PI / 2 - (shares[0] ?? 0) / 2
	pillars.forEach((p, i) => {
		regions.push({ id: p, from: around, to: around + shares[i]! })
		around += shares[i]!
	})

	// Top-down, each family: which band each child is in, and where round from its parent it would
	// like to be. The children go on the arcs of the bands beyond the parent's that its expand circle
	// takes in, side by side and centred on the parent, the first arc first; a family too wide for one
	// arc alternates between as many as it needs (up to `bandRows`), and only if that still doesn't
	// fit does the circle grow.
	const band = new Map<string, number>([[start, 0]])
	for (const p of pillars) band.set(p, 1)
	const offset = new Map<string, number>()
	const circles: { id: string; reach: number; r: number }[] = []
	for (const id of order) {
		const children = kids(id)
		if (id === start || !children.length) continue
		const own = band.get(id)!
		const from = middle(own)
		/** Half the angle round You that an expand circle of radius `r` takes in at distance `s`. */
		const span = (r: number, s: number) => {
			const c = from + r
			if (s < from || s > from + 2 * r) return 0
			return Math.acos(Math.max(-1, Math.min(1, (s * s + c * c - r * r) / (2 * s * c))))
		}
		const fits = (r: number, rows: number) =>
			Array.from({ length: rows }, (_, j) => j).every((j) => {
				const s = middle(own + 1 + j)
				const row = children.filter((_, i) => i % rows === j)
				return row.reduce((n, k) => n + 2 * halfAt(k, s), 0) <= 2 * span(r, s)
			})
		// The circle grows a little at most, to twice its radius; a family still too wide is spread over
		// all its bands and pushed apart by the packing below.
		let r = C.expandRadius
		let rows = 1
		search: for (; r <= GROW * C.expandRadius; r *= 1.1) {
			for (rows = 1; rows <= Math.max(1, C.bandRows); rows++) if (fits(r, rows)) break search
		}
		r = Math.min(r, GROW * C.expandRadius)
		rows = Math.min(rows, Math.max(1, C.bandRows))
		circles.push({ id, reach: from, r })
		for (let j = 0; j < rows; j++) {
			const row = children.filter((_, i) => i % rows === j)
			const s = middle(own + 1 + j)
			const widths = row.map((k) => 2 * halfAt(k, s))
			let at = -widths.reduce((n, w) => n + w, 0) / 2
			row.forEach((k, i) => {
				band.set(k, own + 1 + j)
				offset.set(k, at + widths[i]! / 2)
				at += widths[i]!
			})
		}
	}

	// Band by band from the middle out: each node where its parent's circle puts it, turned with its
	// parent, then the band packed round so that families meeting in it clear each other, in the
	// tree's order.
	const treeOrder = new Map<string, number>()
	const visit = (id: string) => {
		treeOrder.set(id, treeOrder.size)
		for (const k of kids(id)) visit(k)
	}
	visit(start)
	const regionMid = new Map(regions.map((g) => [g.id, (g.from + g.to) / 2]))
	const angle = new Map<string, number>([[start, 0]])
	const dist = new Map<string, number>([[start, 0]])
	const full: number[] = []
	const thin: boolean[] = []
	// Which pillar's region each node is in, and how much hangs below it.
	const regionOf = new Map<string, number>()
	const below = new Map<string, number>()
	for (const id of [...order].reverse()) below.set(id, kids(id).reduce((n, k) => n + 1 + below.get(k)!, 0))
	pillars.forEach((p, i) => {
		const mark = (id: string) => {
			regionOf.set(id, i)
			for (const k of kids(id)) mark(k)
		}
		mark(p)
	})
	/** Moves a node out to band `to`, and what hangs below it out with it as far as it has to go. */
	const moveOut = (id: string, to: number) => {
		band.set(id, to)
		for (const k of kids(id)) if (band.get(k)! <= to) moveOut(k, to + 1)
	}
	let deepest = Math.max(0, ...band.values())
	for (let k = 1; k <= deepest && k <= MOST_BANDS; k++) {
		const s = middle(k)
		const level = order.filter((id) => band.get(id) === k)
		const wantOf = (id: string) => (k === 1 ? regionMid.get(id)! : angle.get(parentOf.get(id)!)! + offset.get(id)!)
		if (k === 1) {
			const placed = packRound(level.map(wantOf), level.map((id) => halfAt(id, s)))
			level.forEach((id, i) => {
				angle.set(id, placed[i]!)
				dist.set(id, s)
			})
		} else {
			// Each region's nodes packed inside its arc of this band; those that don't fit move out a
			// band, the ones with least below them first, so the region grows outward as a cone.
			regions.forEach((g, r) => {
				let mine = level.filter((id) => regionOf.get(id) === r).sort((a, b) => treeOrder.get(a)! - treeOrder.get(b)!)
				const room = (ids: readonly string[]) => ids.reduce((n, id) => n + 2 * halfAt(id, s), 0) <= g.to - g.from
				while (mine.length > 1 && !room(mine)) {
					// The widest family here staggers: every other child moves out a band, its arrow
					// passing between the siblings either side, which stay.
					const families = new Map<string, string[]>()
					for (const id of mine) families.set(parentOf.get(id)!, [...(families.get(parentOf.get(id)!) ?? []), id])
					const widest = [...families.values()]
						.filter((f) => f.length > 1)
						.sort((a, b) => b.reduce((n, id) => n + halfAt(id, s), 0) - a.reduce((n, id) => n + halfAt(id, s), 0))[0]
					const out = widest ? widest.filter((_, i) => i % 2 === 1) : [[...mine].sort((a, b) => below.get(a)! - below.get(b)!)[0]!]
					for (const id of out) moveOut(id, k + 1)
					mine = mine.filter((id) => !out.includes(id))
				}
				const placed = packWithin(
					mine.map((id) => nearest(wantOf(id), (g.from + g.to) / 2)),
					mine.map((id) => halfAt(id, s)),
					g.from,
					g.to
				)
				mine.forEach((id, i) => {
					angle.set(id, placed[i]!)
					dist.set(id, s)
				})
			})
		}
		const here = order.filter((id) => band.get(id) === k)
		full.push(here.reduce((n, id) => n + 2 * halfAt(id, s), 0) / TURN)
		thin.push(border(k) - inner(k) < 2 * Math.max(0, ...here.map(radius)))
		deepest = Math.max(0, ...band.values())
	}
	border(deepest)

	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	for (const id of order) if (id !== start && angle.has(id)) out.set(id, { x: dist.get(id)! * Math.cos(angle.get(id)!), y: dist.get(id)! * Math.sin(angle.get(id)!) })
	const placed = [...out.keys()].filter((id) => id !== start)
	const overlapping = new Set<string>()
	for (let i = 0; i < placed.length; i++)
		for (let j = i + 1; j < placed.length; j++) {
			const [a, b] = [out.get(placed[i]!)!, out.get(placed[j]!)!]
			if (Math.hypot(a.x - b.x, a.y - b.y) < radius(placed[i]!) + radius(placed[j]!)) overlapping.add(placed[i]!).add(placed[j]!)
		}
	report = {
		borders: borders.slice(0, deepest),
		set: set.slice(0, deepest),
		full,
		thin,
		overlapping: [...overlapping],
		regions: regions.map((g) => g.from),
		circles: circles.map(({ id, reach, r }) => {
			const a = angle.get(id)!
			return { x: (reach + r) * Math.cos(a), y: (reach + r) * Math.sin(a), r }
		}),
	}
	return out
}

const mid = (s: { from: number; to: number }) => (s.from + s.to) / 2

/**
 * Angles round a circle, in order, each as near the one wanted as it can be with neighbours `half`
 * each side apart: least squares under order and spacing, by pool-adjacent-violators, cut where the
 * wanted angles leave the biggest gap. Where they can't all fit round, every spacing shrinks alike
 * until they do, and they overlap their neighbours a little.
 */
function packRound(want: readonly number[], half: readonly number[], weight: readonly number[] = want.map(() => 1)): number[] {
	const n = want.length
	if (n <= 1) return [...want]
	// The cut: after the widest gap between wanted angles, less what the two either side need (a gap
	// running backwards, of one a little behind its neighbour, is no gap).
	let cut = 0
	let widest = -Infinity
	for (let i = 0; i < n; i++) {
		const next = (i + 1) % n
		const turn = (((want[next]! - want[i]!) % TURN) + TURN) % TURN
		const g = (turn > (3 * Math.PI) / 2 ? turn - TURN : turn) - half[i]! - half[next]!
		if (g > widest) [widest, cut] = [g, next]
	}
	const idx = Array.from({ length: n }, (_, i) => (cut + i) % n)
	// Unrolled from the cut, each wanted angle the turn of it nearest the one before (in the order
	// given, which may put one a little behind its neighbour: the packing then moves it on).
	const w: number[] = []
	for (const [k, i] of idx.entries()) {
		let a = want[i]!
		if (k) {
			while (a < w[k - 1]! - Math.PI) a += TURN
			while (a > w[k - 1]! + Math.PI) a -= TURN
		}
		w.push(a)
	}
	// Offsets so spacing becomes order: x_k = y_k + c_k with y non-decreasing.
	const c = [0]
	for (let k = 1; k < n; k++) c.push(c[k - 1]! + half[idx[k - 1]!]! + half[idx[k]!]!)
	let total = c[n - 1]! + half[idx[n - 1]!]! + half[idx[0]!]!
	if (total >= TURN) {
		// Too little room round: every spacing shrunk alike to fit, so they overlap their neighbours a
		// little where they are, rather than being spread round the circle away from their parents.
		const scale = (TURN * 0.999) / total
		for (let k = 0; k < n; k++) c[k] = c[k]! * scale
		total *= scale
	}
	let x = isotonic(
		w.map((a, k) => a - c[k]!),
		idx.map((i) => weight[i]!)
	).map((v, k) => v + c[k]!)
	// Round the back, the last clear of the first: squeezed in from both ends.
	const over = x[n - 1]! - x[0]! - (TURN - (total - c[n - 1]!))
	if (over > 0) {
		// The spare between neighbours, shared out so every gap closes by what it has to spare.
		const spare = x.slice(1).map((v, k) => v - x[k]! - (c[k + 1]! - c[k]!))
		const totalSpare = spare.reduce((a, b) => a + b, 0) || 1
		let shift = 0
		const shifted = [x[0]!]
		for (let k = 1; k < n; k++) {
			shift += (spare[k - 1]! / totalSpare) * over
			shifted.push(x[k]! - shift)
		}
		x = shifted.map((v) => v + over / 2)
	}
	const out = new Array<number>(n)
	idx.forEach((i, k) => (out[i] = x[k]!))
	return out
}

/** The turn of angle `a` nearest `to`. */
const nearest = (a: number, to: number) => a + TURN * Math.round((to - a) / TURN)

/**
 * Angles inside the arc `from`..`to`, in order, each as near the one wanted as it can be with
 * neighbours `half` each side apart and none past either end: least squares under order and
 * spacing, by pool-adjacent-violators, clipped to the arc. Where they can't all fit, spaced evenly
 * across it, overlapping.
 */
function packWithin(want: readonly number[], half: readonly number[], from: number, to: number): number[] {
	const n = want.length
	if (!n) return []
	const c = [0]
	for (let k = 1; k < n; k++) c.push(c[k - 1]! + half[k - 1]! + half[k]!)
	const lo = from + half[0]!
	const hi = to - half[n - 1]! - c[n - 1]!
	if (hi < lo) return c.map((v) => (from + to) / 2 + (v - c[n - 1]! / 2) * ((to - from) / Math.max(c[n - 1]! + half[0]! + half[n - 1]!, 1e-9)))
	const y = isotonic(
		want.map((a, k) => a - c[k]!),
		want.map(() => 1)
	)
	return y.map((v, k) => Math.min(hi, Math.max(lo, v)) + c[k]!)
}

/** The non-decreasing sequence nearest `v` in weighted least squares (pool-adjacent-violators). */
function isotonic(v: readonly number[], weight: readonly number[]): number[] {
	const blocks: { sum: number; weight: number; count: number }[] = []
	v.forEach((value, i) => {
		blocks.push({ sum: value * weight[i]!, weight: weight[i]!, count: 1 })
		while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.weight > blocks.at(-1)!.sum / blocks.at(-1)!.weight) {
			const last = blocks.pop()!
			blocks.at(-1)!.sum += last.sum
			blocks.at(-1)!.weight += last.weight
			blocks.at(-1)!.count += last.count
		}
	})
	return blocks.flatMap((b) => new Array<number>(b.count).fill(b.sum / b.weight))
}

/**
 * Splits `total` in proportion to `weights`, none below `min` (when the minimums fit): the ones that
 * would fall short get the minimum and the rest share what is left.
 */
function spread(weights: readonly number[], total: number, min: number): number[] {
	const out = weights.map(() => 0)
	let fixed = new Set<number>()
	for (let round = 0; round <= weights.length; round++) {
		const free = weights.map((_, i) => i).filter((i) => !fixed.has(i))
		const left = total - fixed.size * min
		const sum = free.reduce((n, i) => n + weights[i]!, 0) || 1
		for (const i of free) out[i] = (left * weights[i]!) / sum
		for (const i of fixed) out[i] = min
		const short = free.filter((i) => out[i]! < min)
		if (!short.length) break
		fixed = new Set([...fixed, ...short])
	}
	return out
}

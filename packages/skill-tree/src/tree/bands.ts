import { atom } from '@lifeboard/canvas'
import { siblingOrder, type BalloonInput } from './balloon'
import type { LayoutConfig } from './layoutConfig'

/**
 * Placing skill nodes in bands (docs/skill-tree-layout-plan.md, "Bands"), as the user sketched them:
 * a border round You for every level of the tree, the whole board sharing them. The pillars sit
 * inside the first border, tree roots between the first and the second, and so on: a node never
 * leaves its level's band, so further out always means deeper. The borders don't move to make room;
 * they are the constraint, and the nodes move round inside them.
 *
 * - **Where each node would like to be.** The pillars share the circle in proportion to how much
 *   grows from each (none narrower than `minSlice`), the first at the top and the rest clockwise in
 *   the YAML's order; every node shares its slice among its children the same way, and a node would
 *   like to sit in the middle of its slice.
 * - **Where it goes.** Band by band from the middle out, the band's nodes keep their order round the
 *   circle and move as little as they can from where they would like to be until none touches the
 *   next (least squares, by pool-adjacent-violators). A child would like to be where its parent's
 *   slice says, turned with its parent wherever its parent had to move.
 * - **Rows.** A band too full to go round in one row, and thick enough for more, staggers its nodes
 *   across rows, every other one on the next. What still doesn't fit overlaps: the band guides
 *   (tree/BandGuides.tsx) show it, and moving a border is how to fix it.
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
}

export const lastBands = atom<BandReport | null>('lifeboard:skill-tree-bands', null)

const TURN = 2 * Math.PI

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
	const depth = new Map<string, number>([[start, 0]])
	for (const id of order) for (const kid of kids(id)) depth.set(kid, depth.get(id)! + 1)
	const deepest = Math.max(0, ...depth.values())
	const { borders, set } = bandBorders(C, deepest)
	const inside = (d: number) => (d === 1 ? radius(start) + gap : borders[d - 2]!)

	// How much grows from each node: its own cluster's width and everything below it.
	const weight = new Map<string, number>()
	for (const id of [...order].reverse()) weight.set(id, (id === start ? 0 : radius(id)) + kids(id).reduce((n, k) => n + weight.get(k)!, 0))

	// Each node's slice, top-down: the pillars' all the way round, at least `minSlice` each, the
	// first centred at the top.
	const slice = new Map<string, { from: number; to: number }>()
	const minSlice = kids(start).length * ((C.minSlice / 180) * Math.PI) <= TURN ? (C.minSlice / 180) * Math.PI : 0
	for (const id of order) {
		const children = kids(id)
		if (!children.length) continue
		const own = id === start ? { from: -Math.PI / 2, to: (3 * Math.PI) / 2 } : slice.get(id)!
		const shares = spread(children.map((k) => weight.get(k)!), own.to - own.from, id === start ? minSlice : 0)
		let at = own.from - (id === start ? shares[0]! / 2 : 0)
		children.forEach((k, i) => {
			slice.set(k, { from: at, to: at + shares[i]! })
			at += shares[i]!
		})
	}

	// Band by band from the middle out: where each node would like to be, then packed.
	const angle = new Map<string, number>([[start, 0]])
	const dist = new Map<string, number>([[start, 0]])
	const full: number[] = []
	const thin: boolean[] = []
	for (let d = 1; d <= deepest; d++) {
		const level = order.filter((id) => depth.get(id) === d)
		const [lo, hi] = [inside(d), borders[d - 1]!]
		const widest = Math.max(0, ...level.map(radius))
		thin.push(hi - lo < 2 * widest)
		// Where each would like to be: its slice's middle, turned as far as its parent was moved.
		const want = new Map(
			level.map((id) => {
				const p = parentOf.get(id)!
				const moved = p === start ? 0 : angle.get(p)! - mid(slice.get(p)!)
				return [id, mid(slice.get(id)!) + moved]
			})
		)
		const sorted = [...level].sort((a, b) => want.get(a)! - want.get(b)!)
		// As many rows as the band needs to go round, and has room for; every other node on the next.
		const rowStep = 2 * widest + gap
		const room = Math.max(1, Math.min(C.bandRows, Math.floor((hi - lo) / rowStep)))
		const halfAt = (id: string, r: number) => Math.asin(Math.min(1, (radius(id) + gap / 2) / Math.max(r, 1)))
		const middle = (lo + hi) / 2
		const need = (r: number, ids: readonly string[]) => ids.reduce((n, id) => n + 2 * halfAt(id, r), 0) / TURN
		let rows = 1
		while (rows < room && rows < sorted.length && need(middle, sorted) / rows > 1) rows++
		const rowRadius = (j: number) => (rows === 1 ? middle : lo + widest + gap / 2 + j * rowStep)
		let fullest = 0
		for (let j = 0; j < rows; j++) {
			const ids = sorted.filter((_, i) => i % rows === j)
			const r = rowRadius(j)
			fullest = Math.max(fullest, need(r, ids))
			const placed = packRound(
				ids.map((id) => want.get(id)!),
				ids.map((id) => halfAt(id, r))
			)
			ids.forEach((id, i) => {
				angle.set(id, placed[i]!)
				dist.set(id, r)
			})
		}
		full.push(fullest)
	}

	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	for (const id of order) if (id !== start && angle.has(id)) out.set(id, { x: dist.get(id)! * Math.cos(angle.get(id)!), y: dist.get(id)! * Math.sin(angle.get(id)!) })
	const placed = [...out.keys()].filter((id) => id !== start)
	const overlapping = new Set<string>()
	for (let i = 0; i < placed.length; i++)
		for (let j = i + 1; j < placed.length; j++) {
			const [a, b] = [out.get(placed[i]!)!, out.get(placed[j]!)!]
			if (Math.hypot(a.x - b.x, a.y - b.y) < radius(placed[i]!) + radius(placed[j]!)) overlapping.add(placed[i]!).add(placed[j]!)
		}
	lastBands.set({ borders, set, full, thin, overlapping: [...overlapping] })
	return out
}

const mid = (s: { from: number; to: number }) => (s.from + s.to) / 2

/**
 * Angles round a circle, in order, each as near the one wanted as it can be with neighbours `half`
 * each side apart: least squares under order and spacing, by pool-adjacent-violators, cut where the
 * wanted angles leave the biggest gap. Where they can't all fit round, they are spaced evenly as
 * close as they go, overlapping.
 */
function packRound(want: readonly number[], half: readonly number[]): number[] {
	const n = want.length
	if (n <= 1) return [...want]
	// The cut: after the widest gap between wanted angles, less what the two either side need.
	let cut = 0
	let widest = -Infinity
	for (let i = 0; i < n; i++) {
		const next = (i + 1) % n
		const g = ((((want[next]! - want[i]!) % TURN) + TURN) % TURN) - half[i]! - half[next]!
		if (g > widest) [widest, cut] = [g, next]
	}
	const idx = Array.from({ length: n }, (_, i) => (cut + i) % n)
	// Unrolled from the cut, each wanted angle at or past the one before.
	const w: number[] = []
	for (const [k, i] of idx.entries()) {
		let a = want[i]!
		if (k) while (a < w[k - 1]!) a += TURN
		w.push(a)
	}
	// Offsets so spacing becomes order: x_k = y_k + c_k with y non-decreasing.
	const c = [0]
	for (let k = 1; k < n; k++) c.push(c[k - 1]! + half[idx[k - 1]!]! + half[idx[k]!]!)
	const total = c[n - 1]! + half[idx[n - 1]!]! + half[idx[0]!]!
	let x: number[]
	if (total >= TURN) {
		// Too little room round: spaced evenly round the whole circle, as close as they go, overlapping.
		const scale = TURN / total
		const centre = (w[0]! + w[n - 1]!) / 2
		x = c.map((v) => centre - (c[n - 1]! * scale) / 2 + v * scale)
	} else {
		x = isotonic(w.map((a, k) => a - c[k]!)).map((v, k) => v + c[k]!)
		// Round the back, the last clear of the first: squeezed in from both ends.
		const over = x[n - 1]! - x[0]! - (TURN - half[idx[0]!]! - half[idx[n - 1]!]!)
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
			const back = over / 2
			x = shifted.map((v) => v + back)
		}
	}
	const out = new Array<number>(n)
	idx.forEach((i, k) => (out[i] = x[k]!))
	return out
}

/** The non-decreasing sequence nearest `v` in least squares (pool-adjacent-violators). */
function isotonic(v: readonly number[]): number[] {
	const blocks: { sum: number; count: number }[] = []
	for (const value of v) {
		blocks.push({ sum: value, count: 1 })
		while (blocks.length > 1 && blocks.at(-2)!.sum / blocks.at(-2)!.count > blocks.at(-1)!.sum / blocks.at(-1)!.count) {
			const last = blocks.pop()!
			blocks.at(-1)!.sum += last.sum
			blocks.at(-1)!.count += last.count
		}
	}
	return blocks.flatMap((b) => new Array<number>(b.count).fill(b.sum / b.count))
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

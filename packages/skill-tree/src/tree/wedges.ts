import { siblingOrder, type BalloonInput } from './balloon'

/**
 * Radial wedges, compacted wedge by wedge (docs/skill-tree-layout-plan.md, "Layout algorithms"), in
 * the manner of Eades' radial drawings and of ELK Radial as its documentation describes it (node
 * placement, overlap removal, then wedge compaction; written from that description, not from its
 * code):
 *
 * - **Wedges.** Every subtree gets a wedge of its parent's, round You, in proportion to the size of
 *   what is in it (its clusters' widths); the pillars share the whole circle the same way, none less
 *   than `minSlice`, the first centred at the top. Each node sits in the middle of its wedge.
 * - **Rings.** One ring per level for the whole board, each clear of the one inside it by its
 *   biggest clusters.
 * - **Overlap removal.** While anything overlaps, the rings from the innermost level where it does
 *   move out.
 * - **Wedge compaction.** Then each tree's wedge (every subtree of a pillar) pulls its own rings in,
 *   level by level from the inside out, as far as each can come without overlapping anything: the
 *   rings no longer line up across the board, which is what makes it compact.
 */

type Point = { x: number; y: number }

const TURN = 2 * Math.PI
/** The most rounds of moving rings out to remove overlaps. */
const SPREADS = 200

export function wedges({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)
	const pillars = kids(start)
	const depth = new Map<string, number>([[start, 0]])
	for (const id of order) for (const k of kids(id)) depth.set(k, depth.get(id)! + 1)
	const deepest = Math.max(0, ...depth.values())

	// Wedges by the size of what is in them.
	const size = new Map<string, number>()
	for (const id of [...order].reverse()) size.set(id, (id === start ? 0 : 2 * radius(id) + gap) + kids(id).reduce((n, k) => n + size.get(k)!, 0))
	const angle = new Map<string, number>([[start, 0]])
	const wedge = new Map<string, { from: number; to: number }>()
	const minSlice = pillars.length * ((C.minSlice / 180) * Math.PI) <= TURN ? (C.minSlice / 180) * Math.PI : 0
	for (const id of order) {
		const children = kids(id)
		if (!children.length) continue
		const own = id === start ? { from: 0, to: TURN } : wedge.get(id)!
		const shares = spread(children.map((k) => size.get(k)!), own.to - own.from, id === start ? minSlice : 0)
		let at = id === start ? -Math.PI / 2 - shares[0]! / 2 : own.from
		children.forEach((k, i) => {
			wedge.set(k, { from: at, to: at + shares[i]! })
			angle.set(k, at + shares[i]! / 2)
			at += shares[i]!
		})
	}

	// Rings: each clear of the one inside it.
	const widest = (d: number) => Math.max(0, ...order.filter((id) => depth.get(id) === d).map(radius))
	const ring = [0]
	for (let d = 1; d <= deepest; d++) ring.push(d === 1 ? radius(start) + C.hubRoom + widest(1) : ring[d - 1]! + widest(d - 1) + gap + widest(d))
	/** Each node's distance from You: its level's ring, or, after compaction, its tree's own. */
	const dist = new Map<string, number>([[start, 0]])
	for (const id of order) if (id !== start) dist.set(id, ring[depth.get(id)!]!)
	const where = (id: string, d = dist.get(id)!) => ({ x: d * Math.cos(angle.get(id)!), y: d * Math.sin(angle.get(id)!) })
	const nodes = order.filter((id) => id !== start)
	const hits = (a: string, pa: Point, b: string, pb: Point) => Math.hypot(pa.x - pb.x, pa.y - pb.y) < radius(a) + radius(b) + gap
	const hub = radius(start) + C.hubRoom

	// Overlap removal: the rings from the innermost level with an overlap move out.
	for (let round = 0; round < SPREADS; round++) {
		let worst = 0
		for (let i = 0; i < nodes.length && !worst; i++)
			for (let j = i + 1; j < nodes.length; j++) {
				const [a, b] = [nodes[i]!, nodes[j]!]
				if (hits(a, where(a), b, where(b))) {
					worst = Math.min(depth.get(a)!, depth.get(b)!)
					break
				}
			}
		if (!worst) break
		const by = Math.max(gap, 0.05 * ring[worst]!)
		for (let d = worst; d <= deepest; d++) ring[d] = ring[d]! + by
		for (const id of nodes) dist.set(id, ring[depth.get(id)!]!)
	}

	// Wedge compaction: each tree (a pillar's subtree) pulls its own rings in, level by level from
	// the inside out, each as far as it comes without overlapping anything or its own inner level.
	for (const pillar of pillars) {
		for (const tree of kids(pillar)) {
			const inTree = new Set<string>()
			const mark = (id: string) => {
				inTree.add(id)
				for (const k of kids(id)) mark(k)
			}
			mark(tree)
			for (let d = depth.get(tree)!; d <= deepest; d++) {
				const level = [...inTree].filter((id) => depth.get(id) === d)
				if (!level.length) continue
				const others = nodes.filter((id) => !level.includes(id))
				const floor = (id: string) => {
					const p = parentOf.get(id)!
					return p === start ? hub + radius(id) : dist.get(p)! + radius(p) + gap + radius(id)
				}
				const fits = (t: number) => {
					const moved = level.map((id) => ({ id, p: where(id, Math.max(floor(id), t)) }))
					// Clear of everything else, and of each other: coming in, a level's nodes close up.
					return moved.every(({ id, p }, i) => others.every((o) => !hits(id, p, o, where(o))) && moved.slice(i + 1).every((m) => !hits(id, p, m.id, m.p)))
				}
				let lo = Math.max(...level.map(floor))
				let hi = Math.max(...level.map((id) => dist.get(id)!))
				if (lo >= hi) continue
				if (!fits(lo)) {
					for (let k = 0; k < 24; k++) {
						const mid = (lo + hi) / 2
						if (fits(mid)) hi = mid
						else lo = mid
					}
					lo = hi
				}
				for (const id of level) dist.set(id, Math.max(floor(id), lo))
			}
		}
	}

	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	for (const id of nodes) out.set(id, where(id))
	return out
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

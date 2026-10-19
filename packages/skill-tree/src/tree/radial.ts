import { siblingOrder, type BalloonInput } from './balloon'

/**
 * Eades' radial tree drawing ("Drawing free trees", 1992), the "tree radial" the Bubble Tree paper
 * compares itself with, as the Würzburg graph-visualisation lectures give it (RadialTreeLayout):
 *
 * - **Rings.** Every level on its own circle round the start, the start in the middle, the rings
 *   evenly spaced: ring t at t·d.
 * - **Wedges by size.** Each node's wedge is shared among its children in proportion to how many
 *   nodes each one's subtree holds, every child in the middle of its share.
 * - **No crossings.** Past the start, a node's wedge is first cut to the angle its children can be
 *   seen at without an arrow passing inside its own ring: `arccos(ρ_t / ρ_t+1)` either side of it,
 *   ρ being the rings' radii. So no two arrows of the tree cross.
 *
 * With evenly spaced rings the cut depends only on t, so the wedges come out the same whatever d is,
 * and d is the least that keeps every ring clear of the next and no two clusters on a ring touching.
 * The tightest spot on any ring sets it for the whole drawing, which is why radial drawings are big
 * (the area grows with the most children a node has times the height). Rings placed each as close in
 * as it could go were tried and are worse: moving a ring out narrows the cut, which squeezes the
 * wedges, which moves rings further out.
 */

type Point = { x: number; y: number }

const TURN = 2 * Math.PI

export function radial({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)

	// ℓ: how many nodes each subtree holds, itself included.
	const size = new Map<string, number>()
	for (const id of [...order].reverse()) size.set(id, 1 + kids(id).reduce((n, k) => n + size.get(k)!, 0))
	const depth = new Map<string, number>([[start, 0]])
	for (const id of order) for (const k of kids(id)) depth.set(k, depth.get(id)! + 1)
	const deepest = Math.max(0, ...depth.values())
	const levels = Array.from({ length: deepest + 1 }, (_, t) => order.filter((id) => depth.get(id) === t))
	const widest = (t: number) => Math.max(0, ...levels[t]!.map(radius))

	// The wedges, with the rings at t (the cut only needs their ratios).
	const angle = new Map<string, number>()
	const place = (id: string, t: number, lo: number, hi: number) => {
		const a = (lo + hi) / 2
		angle.set(id, a)
		const children = kids(id)
		if (!children.length) return
		if (t > 0) {
			// The arccos cut: children no further round than an arrow reaches without dipping inside ring t.
			const cut = Math.acos(t / (t + 1))
			lo = Math.max(lo, a - cut)
			hi = Math.min(hi, a + cut)
		}
		const below = size.get(id)! - 1
		let from = lo
		for (const k of children) {
			const to = from + ((hi - lo) * size.get(k)!) / below
			place(k, t + 1, from, to)
			from = to
		}
	}
	// The first pillar centred at the top, as in the other placements.
	const first = kids(start)[0]
	const lo = -Math.PI / 2 - (first ? (Math.PI * size.get(first)!) / (size.get(start)! - 1) : 0)
	place(start, 0, lo, lo + TURN)

	// The spacing: each ring clear of the next by both levels' biggest clusters, the first clear of
	// the start, and no two neighbours on a ring touching (at angles `apart` on ring t, 2·t·d·sin(apart/2) apart).
	let d = radius(start) + C.hubRoom + widest(1)
	for (let t = 2; t <= deepest; t++) d = Math.max(d, widest(t - 1) + gap + widest(t))
	for (let t = 1; t <= deepest; t++) {
		const on = levels[t]!.map((id) => ({ id, a: angle.get(id)! })).sort((p, q) => p.a - q.a)
		if (on.length < 2) continue
		on.forEach((p, i) => {
			const q = on[(i + 1) % on.length]!
			const apart = i + 1 < on.length ? q.a - p.a : q.a + TURN - p.a
			if (apart >= Math.PI) return
			d = Math.max(d, (radius(p.id) + radius(q.id) + gap) / (2 * t * Math.sin(Math.max(1e-6, apart) / 2)))
		})
	}

	return new Map(order.map((id) => [id, { x: depth.get(id)! * d * Math.cos(angle.get(id)!), y: depth.get(id)! * d * Math.sin(angle.get(id)!) }]))
}

import { atom } from '@lifeboard/canvas'
import { siblingOrder, type BalloonInput } from './balloon'

/**
 * Placing skill nodes in cones (docs/skill-tree-layout-plan.md, "Cones"), the user's idea: every
 * node looks outward through a cone of its own, and its children's cones are slices of it, so the
 * whole tree is wedges inside wedges (after Eades' radial drawings).
 *
 * - **The pillars' regions are the first cones.** Each pillar gets a share of the way round You in
 *   proportion to how much grows from it (none less than `minSlice`), the first centred at the top.
 * - **A node's cone is shared among its children**, in order: each gets at least the angle its own
 *   cluster needs at the family's distance, and what is left goes by how much grows below each.
 * - **The family sits as close as it can**: at the least distance from its parent at which every
 *   child's cluster fits inside its slice and clears the parent's.
 * - **A child's cone** starts at the child and looks the way its slice does, as wide: moved out
 *   along its middle, it lies inside the slice, so nothing below one child can reach another's.
 *
 * So no two arrows of the tree cross and no two branches overlap, by construction; each family's
 * distance is only what it needs, so a narrow chain stays tight and a wide family takes more room.
 */

type Point = { x: number; y: number }

/** A cone, for the guides: where it starts, which way it looks, how wide, and where its children sit. */
export interface Cone {
	x: number
	y: number
	/** The way it looks, as an angle round You. */
	axis: number
	/** How wide, in radians. */
	width: number
	/** How far from its start its children are. */
	family: number
	/** How far from its start its furthest descendant is. */
	reach: number
}

export interface ConeReport {
	/** Where each pillar's region starts, going clockwise. */
	regions: number[]
	cones: Cone[]
	/** How far from You the furthest node is. */
	extent: number
}

export const lastCones = atom<ConeReport | null>('lifeboard:skill-tree-cones', null)

const TURN = 2 * Math.PI
/** The narrowest a cone may be, so a cluster's angle never comes out of an impossible slice. */
const NARROWEST = (2 / 180) * Math.PI
/** The widest a cone may widen to, past its slice. */
const WIDEST = (150 / 180) * Math.PI
/** The most rounds of moving colliding families out. */
const MOVES = 60

/**
 * `strict`: every cone exactly its slice and no family moved out, so nothing can cross or overlap:
 * the start that `compactCones` (tree/compact.ts) pulls in.
 */
export function cones({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput, strict = false): Map<string, Point> {
	const gap = C.clusterGap
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)
	const pillars = kids(start)

	const weight = new Map<string, number>()
	for (const id of [...order].reverse()) weight.set(id, (id === start ? 0 : radius(id)) + kids(id).reduce((n, k) => n + weight.get(k)!, 0))

	const at = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	const cone = new Map<string, { axis: number; width: number }>()
	const family = new Map<string, number>()
	const regions: number[] = []

	// The pillars: each in the middle of its region, as close to You as fits it in its region.
	const minSlice = pillars.length * ((C.minSlice / 180) * Math.PI) <= TURN ? (C.minSlice / 180) * Math.PI : 0
	const shares = spread(pillars.map((p) => weight.get(p)!), TURN, minSlice)
	let around = -Math.PI / 2 - (shares[0] ?? 0) / 2
	const hub = radius(start) + C.hubRoom
	pillars.forEach((p, i) => {
		regions.push(around)
		const axis = around + shares[i]! / 2
		const d = Math.max(hub + radius(p), (radius(p) + gap / 2) / Math.sin(Math.min(Math.PI / 2, shares[i]! / 2)))
		at.set(p, { x: d * Math.cos(axis), y: d * Math.sin(axis) })
		// The region, seen from the pillar: as wide as the region, but never wider than a half turn.
		cone.set(p, { axis, width: Math.min(shares[i]!, Math.PI) })
		around += shares[i]!
	})

	// Top-down, each family in its parent's cone, `extra` further out than the least it needs.
	const place = (extra: ReadonlyMap<string, number>) => {
		for (const id of order) {
			const children = kids(id)
			if (id === start || !children.length) continue
			const { axis, width } = cone.get(id)!
			const p = at.get(id)!
			const need = (k: string, d: number) => 2 * Math.asin(Math.min(1, (radius(k) + gap / 2) / d))
			// The least distance at which every child's own angle fits in the cone, by halving.
			const clear = radius(id) + gap + Math.max(...children.map(radius))
			const fits = (d: number) => children.reduce((n, k) => n + need(k, d), 0) <= width
			let lo = Math.max(clear, ...children.map((k) => radius(k) + gap / 2))
			let hi = lo
			while (!fits(hi)) hi *= 1.5
			if (!fits(lo)) {
				for (let i = 0; i < 40; i++) {
					const mid = (lo + hi) / 2
					if (fits(mid)) hi = mid
					else lo = mid
				}
				lo = hi
			}
			const d = lo + (extra.get(id) ?? 0)
			// Each child its own angle, and the rest by how much grows below it.
			const own = children.map((k) => need(k, d))
			const spare = Math.max(0, width - own.reduce((n, a) => n + a, 0))
			const below = children.map((k) => weight.get(k)! - radius(k))
			const total = below.reduce((n, w) => n + w, 0)
			const slices = children.map((_, i) => Math.max(NARROWEST, own[i]! + (total > 0 ? (spare * below[i]!) / total : spare / children.length)))
			const sum = slices.reduce((n, a) => n + a, 0)
			let from = axis - Math.min(width, sum) / 2
			family.set(id, d)
			children.forEach((k, i) => {
				const slice = (slices[i]! * Math.min(width, sum)) / sum
				const a = from + slice / 2
				at.set(k, { x: p.x + d * Math.cos(a), y: p.y + d * Math.sin(a) })
				// A cone may widen past its slice to what its own family needs at `expandRadius`, so a wide
				// family deep in a narrow cone isn't flung far out; it may then reach into its neighbours'.
				const grand = kids(k)
				const wants = grand.reduce((n, g) => n + 2 * Math.asin(Math.min(1, (radius(g) + gap / 2) / Math.max(C.expandRadius, radius(k) + gap + radius(g)))), 0)
				cone.set(k, { axis: a, width: strict ? slice : Math.min(WIDEST, Math.max(slice, wants)) })
				from += slice
			})
	}
	}

	// Each family as close as it can be, then moved out where it collides: for every two skill nodes
	// whose clusters touch, the family of the deeper one moves out by as much as they overlap, until
	// none do (or `MOVES` rounds). Only what collides grows.
	const depth = new Map<string, number>([[start, 0]])
	for (const id of order) for (const k of kids(id)) depth.set(k, depth.get(id)! + 1)
	const extra = new Map<string, number>()
	const placed = order.filter((id) => id !== start)
	const grow = C.coneGrow && !strict
	for (let round = 0; round <= (grow ? MOVES : 0); round++) {
		place(extra)
		if (!grow) break
		let moved = false
		const grew = new Set<string>()
		for (let i = 0; i < placed.length; i++)
			for (let j = i + 1; j < placed.length; j++) {
				const [a, b] = [placed[i]!, placed[j]!]
				const [p, q] = [at.get(a)!, at.get(b)!]
				const over = radius(a) + radius(b) + gap / 2 - Math.hypot(p.x - q.x, p.y - q.y)
				if (over <= 0 || parentOf.get(a) === b || parentOf.get(b) === a) continue
				// The deeper one's family moves; of two as deep, the later one's.
				const deeper = depth.get(a)! > depth.get(b)! ? a : depth.get(b)! > depth.get(a)! ? b : b
				const family = parentOf.get(deeper)!
				if (family === start || grew.has(family)) continue
				grew.add(family)
				extra.set(family, (extra.get(family) ?? 0) + over)
				moved = true
			}
		if (!moved || round === MOVES) break
	}

	// For the guides: how far each cone's descendants reach.
	const reach = new Map<string, number>()
	for (const id of [...order].reverse()) {
		const p = at.get(id)!
		let far = 0
		const walk = (k: string) => {
			const q = at.get(k)!
			far = Math.max(far, Math.hypot(q.x - p.x, q.y - p.y) + radius(k))
			for (const g of kids(k)) walk(g)
		}
		for (const k of kids(id)) walk(k)
		reach.set(id, far)
	}
	lastCones.set({
		regions,
		cones: order
			.filter((id) => id !== start && kids(id).length)
			.map((id) => ({ ...at.get(id)!, ...cone.get(id)!, family: family.get(id)!, reach: reach.get(id)! })),
		extent: Math.max(0, ...[...at].map(([id, q]) => Math.hypot(q.x, q.y) + (id === start ? 0 : radius(id)))),
	})
	return at
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

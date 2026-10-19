import type { BalloonInput } from './balloon'
import { bubbles } from './bubbles'
import { cones } from './cones'

/**
 * Cones, compacted (docs/skill-tree-layout-plan.md, "Layout algorithms"), after Gray, Li, Ahmed,
 * Rahman, Azad, Kobourov and Börner, "A Scalable Method for Readable Tree Layouts" (IEEE VIS 2023):
 * start from a layout that can't cross or overlap, then compact it with every move checked, so it
 * never starts to.
 *
 * The start is the strictly nested cones (tree/cones.ts): every node's children in slices of its
 * cone, nothing reaching into a neighbour's. Then, round after round, deepest families first, each
 * branch is pulled in along its arrow toward its parent as far as it will go, and tried turned a
 * little about its parent where that lets it come in further; and each family is tried fanned wider
 * round its parent and brought in together, so a family too wide for its slice spreads instead of
 * stopping at its siblings. Last, node by node, forces in the manner of Gray et al.'s refinement:
 * arrows pull, near nodes push apart, and every move is checked the same way. A move is kept only if it puts no
 * cluster on another, no arrow of the tree across another, and no arrow through a cluster it
 * doesn't end at, and keeps the open ground round You.
 */

type Point = { x: number; y: number }

/** Turns tried about the parent, either way, in degrees. */
const TURNS = [5, 15, 30, 60, 90]
/** How much wider a family is tried fanned round its parent. */
const FANS = [1, 1.4, 2, 3]
/** Rounds of the node-by-node forces, how far a node may move in one to start with and to stop at, and how fast that shrinks. */
const FORCE_ROUNDS = 200
const STEP_FROM = 2000
const STEP_TO = 5
const COOLING = 0.97
/** A node jumps when its arrow is this many times its resting length or more. */
const JUMP_PAST = 2
/** Where a jump looks: every this many degrees round the parent, on this many rings out from resting. */
const JUMP_EVERY = 10
const JUMP_RINGS = 40
/** The settling force pass after jumps: rounds, and the step it starts from. */
const SETTLE_ROUNDS = 80
const SETTLE_FROM = 400
/** Ways tried when the straight way is blocked: turned off it, either side. */
const SLIDES = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3]
/** How much longer than touching an arrow may be before it pulls. */
const SLACK = 40
/** How hard an arrow pulls its parent, against its child. */
const PARENT_PULL = 0.25
/** How close two nodes may come before they push apart, past touching, and how hard. */
const SPREAD = 120
const PUSH = 0.5
/** Rounds of pulling everything in. */
const ROUNDS = 14

/** `from`: the layout it starts from, which must not cross or overlap: strict cones, or bubbles. */
export function compactCones(input: BalloonInput, from: 'cones' | 'bubbles' = 'cones'): Map<string, Point> {
	const { start, order, kids, radius, config: C } = input
	const at = from === 'bubbles' ? bubbles(input) : cones(input, true)
	const parentOf = new Map<string, string>()
	for (const id of order) for (const k of kids(id)) parentOf.set(k, id)
	const ids = order.filter((id) => at.has(id))
	const index = new Map(ids.map((id, i) => [id, i]))
	const x = ids.map((id) => at.get(id)!.x)
	const y = ids.map((id) => at.get(id)!.y)
	const r = ids.map((id) => (id === start ? radius(start) + C.hubRoom : radius(id)))
	const gap = C.compactGap
	// The tree's arrows, as pairs of indices: every node to its parent.
	const edges = ids.filter((id) => id !== start).map((id) => [index.get(parentOf.get(id)!)!, index.get(id)!] as const)
	const below = new Map<string, number[]>()
	for (const id of [...ids].reverse()) below.set(id, [index.get(id)!, ...kids(id).flatMap((k) => below.get(k) ?? [])])

	/**
	 * How many rules the moving nodes break where `nx`, `ny` puts them (indexed like `x`, `y`; the rest
	 * where they are): clusters on each other, tree arrows across each other, arrows through clusters
	 * they don't end at. Moved nodes are counted against everything, each other included: a family
	 * fanned out moves several branches at once, each its own way.
	 */
	const brokenBy = (moving: ReadonlySet<number>, nx: readonly number[], ny: readonly number[]) => {
		let over = 0
		let crossing = 0
		let through = 0
		for (const i of moving) {
			for (let j = 0; j < ids.length; j++) {
				if (j === i || (moving.has(j) && j < i)) continue
				if (Math.hypot(nx[i]! - nx[j]!, ny[i]! - ny[j]!) < r[i]! + r[j]! + gap) over++
			}
		}
		for (const [a, b] of edges) {
			if (!moving.has(a) && !moving.has(b)) continue
			const [ax, ay, bx, by] = [nx[a]!, ny[a]!, nx[b]!, ny[b]!]
			for (const [c, d] of edges) {
				if (c === a || c === b || d === a || d === b) continue
				if (cross(ax, ay, bx, by, nx[c]!, ny[c]!, nx[d]!, ny[d]!)) crossing++
			}
			for (let j = 0; j < ids.length; j++) {
				if (j === a || j === b) continue
				if (nearSegment(nx[j]!, ny[j]!, ax, ay, bx, by) < r[j]!) through++
			}
		}
		for (const [c, d] of edges) {
			if (moving.has(c) || moving.has(d)) continue
			for (const i of moving) if (nearSegment(nx[i]!, ny[i]!, nx[c]!, ny[c]!, nx[d]!, ny[d]!) < r[i]!) through++
		}
		return { over, crossing, through }
	}
	const broken = (moving: ReadonlySet<number>, nx: readonly number[], ny: readonly number[]) => {
		const b = brokenBy(moving, nx, ny)
		return b.over + b.crossing + b.through
	}

	/**
	 * Whether a move keeps the rules: it breaks none it didn't already, so a layout that starts clean
	 * stays clean, and a node already caught on something can still move to get free.
	 */
	const allowed = (moving: ReadonlySet<number>, nx: readonly number[], ny: readonly number[]) => broken(moving, nx, ny) <= broken(moving, x, y)

	/** `moving` turned by `turn` about point (`px`, `py`), then moved `dx`, `dy`. */
	const moved = (moving: readonly number[], px: number, py: number, turn: number, dx: number, dy: number) => {
		const [nx, ny] = [[...x], [...y]]
		const [c, s] = [Math.cos(turn), Math.sin(turn)]
		for (const i of moving) {
			const [ox, oy] = [x[i]! - px, y[i]! - py]
			nx[i] = px + ox * c - oy * s + dx
			ny[i] = py + ox * s + oy * c + dy
		}
		return [nx, ny] as const
	}

	const deepestFirst = [...ids].filter((id) => id !== start).reverse()
	for (let round = 0; round < ROUNDS; round++) {
		let gained = 0
		for (const id of deepestFirst) {
			const i = index.get(id)!
			const p = index.get(parentOf.get(id)!)!
			const moving = below.get(id)!
			const set = new Set(moving)
			const pillar = parentOf.get(id) === start
			/** The furthest in along its arrow the branch can come, turned by `turn` first: how far it came, and where. */
			const pull = (turn: number) => {
				const [tx, ty] = moved(moving, x[p]!, y[p]!, turn, 0, 0)
				if (turn && !allowed(set, tx, ty)) return null
				const [dx, dy] = [x[p]! - tx[i]!, y[p]! - ty[i]!]
				const length = Math.hypot(dx, dy)
				const room = length - (r[p]! + r[i]! + gap)
				if (room <= 1) return { came: 0, nx: tx, ny: ty }
				const [ux, uy] = [dx / length, dy / length]
				// The largest step in that fits, halving from the whole of it.
				let lo = 0
				let hi = room
				const fits = (d: number) => {
					const [mx, my] = moved(moving, x[p]!, y[p]!, turn, ux * d, uy * d)
					return allowed(set, mx, my) ? ([mx, my] as const) : null
				}
				let best = fits(hi) ? hi : 0
				if (!best) {
					for (let k = 0; k < 10; k++) {
						const mid = (lo + hi) / 2
						if (fits(mid)) lo = mid
						else hi = mid
					}
					best = lo
				}
				const [mx, my] = moved(moving, x[p]!, y[p]!, turn, ux * best, uy * best)
				return { came: best, nx: mx, ny: my }
			}
			let pick = pull(0)
			if (!pillar) {
				for (const deg of TURNS) {
					for (const sign of [1, -1]) {
						const tried = pull((sign * deg * Math.PI) / 180)
						if (tried && pick && tried.came > pick.came + 20) pick = tried
						else if (tried && !pick) pick = tried
					}
				}
			}
			if (pick && pick.came > 0.5) {
				for (const k of moving) {
					x[k] = pick.nx[k]!
					y[k] = pick.ny[k]!
				}
				gained += pick.came
			}
		}
		// Each family, deepest first: fanned out wider round its parent, then pulled in together, so a
		// family too wide for its slice can come in by spreading instead of stopping at its siblings.
		for (const id of [...ids].reverse()) {
			const children = kids(id)
			if (children.length < 2 || id === start) continue
			const p = index.get(id)!
			const heads = children.map((k) => index.get(k)!)
			const moving = children.flatMap((k) => below.get(k)!)
			const set = new Set(moving)
			const angles = heads.map((h) => Math.atan2(y[h]! - y[p]!, x[h]! - x[p]!))
			const mid = Math.atan2(
				angles.reduce((n, a) => n + Math.sin(a), 0),
				angles.reduce((n, a) => n + Math.cos(a), 0)
			)
			const lengths = () => heads.reduce((n, h) => n + Math.hypot(x[h]! - x[p]!, y[h]! - y[p]!), 0)
			const before = lengths()
			let best: { nx: number[]; ny: number[]; total: number } | null = null
			for (const fan of FANS) {
				// Each child's branch turned about the parent so its angle off the family's middle grows by
				// `fan`, then every branch brought in by the same share of the way to touching its parent.
				const place = (share: number) => {
					const [nx, ny] = [[...x], [...y]]
					children.forEach((k, ci) => {
						const off = Math.atan2(Math.sin(angles[ci]! - mid), Math.cos(angles[ci]! - mid))
						const turn = off * (fan - 1)
						const h = heads[ci]!
						const [c, sn] = [Math.cos(turn), Math.sin(turn)]
						const len = Math.hypot(x[h]! - x[p]!, y[h]! - y[p]!)
						const least = r[p]! + r[h]! + gap
						const inward = share * Math.max(0, len - least)
						const dir = angles[ci]! + turn
						for (const m of below.get(k)!) {
							const [ox, oy] = [x[m]! - x[p]!, y[m]! - y[p]!]
							nx[m] = x[p]! + ox * c - oy * sn - inward * Math.cos(dir)
							ny[m] = y[p]! + ox * sn + oy * c - inward * Math.sin(dir)
						}
					})
					return [nx, ny] as const
				}
				let lo = 0
				let hi = 1
				if (!allowed(set, ...place(0))) continue
				for (let k = 0; k < 10; k++) {
					const m = (lo + hi) / 2
					if (allowed(set, ...place(m))) lo = m
					else hi = m
				}
				const [nx, ny] = place(lo)
				const total = heads.reduce((n, h) => n + Math.hypot(nx[h]! - x[p]!, ny[h]! - y[p]!), 0)
				if (!best || total < best.total) best = { nx, ny, total }
			}
			if (best && best.total < before - 20) {
				for (const m of moving) {
					x[m] = best.nx[m]!
					y[m] = best.ny[m]!
				}
				gained += before - best.total
			}
		}
		if (gained < 10) break
	}

	// Then node by node, as in Gray et al.'s refinement: every arrow pulls its ends toward a short
	// length (the child harder than the parent), nodes near each other push apart so a wide family
	// spreads round its parent, and each node moves alone, a step at a time, as far as the forces say
	// but never into a crossing or an overlap. You and the pillars stay where they are.
	const fixed = new Set([index.get(start)!, ...kids(start).map((p) => index.get(p)!)])
	const free = ids.map((_, i) => i).filter((i) => !fixed.has(i))
	const forces = (rounds: number, from: number) => {
	let step = from
	for (let round = 0; round < rounds && step > STEP_TO; round++, step *= COOLING) {
		const fx = new Array<number>(ids.length).fill(0)
		const fy = new Array<number>(ids.length).fill(0)
		for (const [a, b] of edges) {
			const [dx, dy] = [x[a]! - x[b]!, y[a]! - y[b]!]
			const d = Math.hypot(dx, dy) || 1
			const stretch = d - (r[a]! + r[b]! + gap + SLACK)
			if (stretch <= 0) continue
			// b is the child: pulled toward its parent a, which is pulled a little toward it.
			fx[b]! += (dx / d) * stretch
			fy[b]! += (dy / d) * stretch
			fx[a]! -= (dx / d) * stretch * PARENT_PULL
			fy[a]! -= (dy / d) * stretch * PARENT_PULL
		}
		for (let i = 0; i < ids.length; i++)
			for (let j = i + 1; j < ids.length; j++) {
				const [dx, dy] = [x[i]! - x[j]!, y[i]! - y[j]!]
				const d = Math.hypot(dx, dy) || 1
				const near = r[i]! + r[j]! + gap + SPREAD
				if (d >= near) continue
				const push = (near - d) * PUSH
				fx[i]! += (dx / d) * push
				fy[i]! += (dy / d) * push
				fx[j]! -= (dx / d) * push
				fy[j]! -= (dy / d) * push
			}
		let movedAny = false
		for (const i of free) {
			const f = Math.hypot(fx[i]!, fy[i]!)
			if (f < 1) continue
			const len = Math.min(step, f)
			const set = new Set([i])
			const before = broken(set, x, y)
			const toward = Math.atan2(fy[i]!, fx[i]!)
			// Straight where the forces say; blocked, sliding round what is in the way.
			tries: for (const turn of SLIDES) {
				for (const share of [1, 0.5]) {
					const [nx, ny] = [[...x], [...y]]
					nx[i] = x[i]! + Math.cos(toward + turn) * len * share
					ny[i] = y[i]! + Math.sin(toward + turn) * len * share
					if (broken(set, nx, ny) <= before) {
						x[i] = nx[i]!
						y[i] = ny[i]!
						movedAny = true
						break tries
					}
				}
			}
		}
		if (!movedAny) break
	}
	}
	forces(FORCE_ROUNDS, STEP_FROM)

	// Then the stragglers: a node whose arrow is still far longer than it needs to be, stuck behind
	// something, jumps with its whole branch to the spot round its parent nearest to it (every 10°, at
	// its resting distance or ring by ring further) that puts nothing on anything and crosses nothing
	// more than where it is; it may run one more arrow over a cluster if that at least halves it. Deepest first; then a short, gentle force pass lets the rest settle round them.
	let jumped = 0
	for (const id of [...ids].reverse()) {
		if (id === start || parentOf.get(id) === start) continue
		const i = index.get(id)!
		const p = index.get(parentOf.get(id)!)!
		const rest = r[p]! + r[i]! + gap + SLACK
		const now = Math.hypot(x[i]! - x[p]!, y[i]! - y[p]!)
		if (now < JUMP_PAST * rest) continue
		const moving = below.get(id)!
		const set = new Set(moving)
		const before = brokenBy(set, x, y)
		let best: { d: number; dx: number; dy: number } | null = null
		for (let k = 0; k < JUMP_RINGS && !best; k++) {
			const d = rest + k * (r[i]! + gap)
			if (d >= now) break
			for (let a = 0; a < 360; a += JUMP_EVERY) {
				const t = (a * Math.PI) / 180
				const [dx, dy] = [x[p]! + d * Math.cos(t) - x[i]!, y[p]! + d * Math.sin(t) - y[i]!]
				const [nx, ny] = moved(moving, 0, 0, 0, dx, dy)
				// Nothing more on top of anything, no more crossings; one more arrow over a cluster is the
				// price a jump may pay if it at least halves the arrow.
				const after = brokenBy(set, nx, ny)
				const fair = after.over <= before.over && after.crossing <= before.crossing && after.through <= before.through + (d <= now / 2 ? 1 : 0)
				if (fair && (!best || d < best.d)) best = { d, dx, dy }
			}
		}
		if (best) {
			for (const m of moving) {
				x[m] = x[m]! + best.dx
				y[m] = y[m]! + best.dy
			}
			jumped++
		}
	}
	if (jumped) forces(SETTLE_ROUNDS, SETTLE_FROM)
	return new Map(ids.map((id, i) => [id, { x: x[i]!, y: y[i]! }]))
}

/** Do the segments a→b and c→d cross (not merely touch at an end)? */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
	const o = (px: number, py: number, qx: number, qy: number, sx: number, sy: number) => (qx - px) * (sy - py) - (qy - py) * (sx - px)
	const d1 = o(cx, cy, dx, dy, ax, ay)
	const d2 = o(cx, cy, dx, dy, bx, by)
	const d3 = o(ax, ay, bx, by, cx, cy)
	const d4 = o(ax, ay, bx, by, dx, dy)
	return d1 * d2 < 0 && d3 * d4 < 0
}

/** How far point (px, py) is from the segment a→b. */
function nearSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const [dx, dy] = [bx - ax, by - ay]
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
	return Math.hypot(ax + t * dx - px, ay + t * dy - py)
}


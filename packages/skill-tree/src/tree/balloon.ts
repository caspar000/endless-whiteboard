import type { LayoutConfig } from './layoutDefaults'

/**
 * Placing each skill node from its parent (docs/skill-tree-layout-plan.md, phase B): a balloon
 * layout. Bottom-up, each branch is laid out on its own, its node at the origin and the branch
 * growing outward along +x. A node's children are swept round it in order, each at the least angle
 * past the one before at which its whole branch clears everything placed so far. Every child of
 * one node is the same distance from it, as short as the fan allows: the distance grows only while
 * the children don't fit in `fanSpread`, and past `maxArrow` only if they don't fit at all. Top-down,
 * each branch is then turned to point away from its parent.
 *
 * The middle's children (the pillars) go round it on one ring, all the way round, the first at the
 * top and the rest clockwise. They are no closer together than `minSlice`, and the spare angle is
 * shared between them evenly.
 *
 * Every branch is placed clear of its siblings' whole branches, so nothing overlaps by construction.
 */

type Point = { x: number; y: number }
type Disc = { x: number; y: number; r: number }
/** An arrow inside a branch, centre to centre. */
type Seg = { ax: number; ay: number; bx: number; by: number }

export interface BalloonInput {
	start: string
	/** Skill nodes breadth first from the start. */
	order: readonly string[]
	/** A skill node's skill-node children, in order. */
	kids: (id: string) => readonly string[]
	/** How far a skill node's cluster reaches from its centre. */
	radius: (id: string) => number
	/** Arrows between skill nodes: cross-links among them decide which siblings sit together. */
	arrows?: readonly { from: string; to: string }[]
	config: LayoutConfig
}

/** A branch laid out on its own: discs relative to its node, and each child's place relative to it. */
interface Branch {
	discs: Disc[]
	/** The arrows inside it. */
	segs: Seg[]
	/** The smallest circle round the origin holding every disc. */
	reach: number
	/** Each child's distance from the node and angle from +x. */
	at: Map<string, { d: number; angle: number }>
}

const TURN = 2 * Math.PI

export function balloon({ start, order, kids: given, radius, arrows = [], config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const branches = new Map<string, Branch>()
	const parentOf = new Map<string, string>()
	for (const id of order) for (const kid of given(id)) parentOf.set(kid, id)
	const kids = siblingOrder(start, order, given, parentOf, arrows)

	/** Discs of `branch` turned by `angle` and moved out `d` along it. */
	const placedAt = (branch: Branch, d: number, angle: number): Disc[] => {
		const [c, s] = [Math.cos(angle), Math.sin(angle)]
		return branch.discs.map((b) => ({ x: d * c + b.x * c - b.y * s, y: d * s + b.x * s + b.y * c, r: b.r }))
	}
	const segsAt = (branch: Branch, d: number, angle: number): Seg[] => {
		const [c, s] = [Math.cos(angle), Math.sin(angle)]
		const at = (x: number, y: number) => [d * c + x * c - y * s, d * s + x * s + y * c] as const
		return branch.segs.map((g) => {
			const [ax, ay] = at(g.ax, g.ay)
			const [bx, by] = at(g.bx, g.by)
			return { ax, ay, bx, by }
		})
	}
	const clear = (mine: readonly Disc[], others: readonly Disc[]) => {
		for (const a of mine) for (const b of others) if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap) return false
		return true
	}

	/** Whether no disc comes within half a gap of the way back to the parent: along -x, from `from` to `to`. */
	const offTheWayBack = (discs: readonly Disc[], from: number, to: number) => {
		for (const b of discs) {
			const x = Math.min(-from, Math.max(-to, b.x))
			if (Math.hypot(b.x - x, b.y) < b.r + gap / 2) return false
		}
		return true
	}

	/**
	 * Sweeps `children` round a node whose own disc is `core`, at `extra` beyond touching: each at the
	 * least angle past the last where its branch clears the rest and the arrows out to the others, and
	 * its own arrow clears what is placed. The angles, or null where the fan would pass `spread`.
	 */
	const sweep = (core: Disc, children: readonly string[], extra: (id: string) => number, spread: number, minStep = 0, from = 0, back = 0) => {
		const wayBack = { ax: -core.r, ay: 0, bx: -back, by: 0 }
		const placed: Disc[] = [core]
		const placedSegs: Seg[] = []
		const out: { id: string; d: number; angle: number }[] = []
		/** The arrows out to the children placed so far, from the node's edge to each child's. */
		const arrows: { a: number; from: number; to: number }[] = []
		/** Whether no disc comes within half a gap of an arrow out at angle `a`. */
		const offArrow = (discs: readonly Disc[], a: number, from: number, to: number) => {
			const [c, s] = [Math.cos(a), Math.sin(a)]
			for (const b of discs) {
				const along = Math.min(to, Math.max(from, b.x * c + b.y * s))
				if (Math.hypot(b.x - along * c, b.y - along * s) < b.r + gap / 2) return false
			}
			return true
		}
		let angle = from
		for (const [i, id] of children.entries()) {
			const branch = branches.get(id)!
			const d = core.r + gap + radius(id) + extra(id)
			const fits = (a: number) => {
				// Far enough from everything placed that no disc can touch: skip the disc by disc test.
				const cx = d * Math.cos(a)
				const cy = d * Math.sin(a)
				const near = placed.filter((p) => Math.hypot(p.x - cx, p.y - cy) < branch.reach + p.r + gap)
				const discs = placedAt(branch, d, a)
				if (!clear(discs, near)) return false
				// Off the arrow in from the parent, and not across it.
				if (back && (!offTheWayBack(discs, core.r, back) || segsAt(branch, d, a).some((g) => segsCross(g, wayBack)))) return false
				// Off its siblings' arrows and not across them, and its own arrow off and not across what is placed.
				if (!arrows.every((w) => offArrow(discs, w.a, w.from, w.to))) return false
				const own = { ax: core.r * Math.cos(a), ay: core.r * Math.sin(a), bx: (d - radius(id)) * Math.cos(a), by: (d - radius(id)) * Math.sin(a) }
				const inside = segsAt(branch, d, a)
				for (const w of arrows) {
					const sib = { ax: w.from * Math.cos(w.a), ay: w.from * Math.sin(w.a), bx: w.to * Math.cos(w.a), by: w.to * Math.sin(w.a) }
					if (inside.some((g) => segsCross(g, sib))) return false
				}
				if (placedSegs.some((g) => segsCross(g, own))) return false
				return offArrow(placed.slice(1), a, core.r, d - radius(id))
			}
			if (i > 0) {
				// Steps of about a node's width at this distance, then halved down to a few pixels.
				const step = Math.max((Math.PI / 180) * 0.5, Math.min(Math.PI / 18, (radius(id) + gap) / d / 2))
				let lo = angle + minStep
				if (!fits(lo)) {
					let hi = lo
					while (!fits(hi)) {
						lo = hi
						hi += step
						if (hi > from + spread + 1e-9) return null
					}
					for (let k = 0; k < 8; k++) {
						const mid = (lo + hi) / 2
						if (fits(mid)) hi = mid
						else lo = mid
					}
					lo = hi
				}
				angle = lo
			} else if (!fits(from)) return null
			if (angle > from + spread + 1e-9) return null
			placed.push(...placedAt(branch, d, angle))
			placedSegs.push(...segsAt(branch, d, angle))
			arrows.push({ a: angle, from: core.r, to: d - radius(id) })
			out.push({ id, d, angle })
		}
		return out
	}

	const fan = (C.fanSpread / 180) * Math.PI
	const stepOut = Math.max(gap, 20)
	for (const id of [...order].reverse()) {
		if (id === start) continue
		const children = kids(id)
		const core: Disc = { x: 0, y: 0, r: radius(id) }
		// The arrow in from the parent, as long as an arrow gets: no branch curls back over it.
		const parent = parentOf.get(id)
		const back = parent === undefined ? 0 : core.r + gap + C.maxArrow + (parent === start ? radius(start) + C.hubRoom - gap : radius(parent))
		const at = new Map<string, { d: number; angle: number }>()
		const discs: Disc[] = [core]
		const segs: Seg[] = []
		/** A child's branch and its arrow in, as part of this one. */
		const take = (k: string, d: number, angle: number) => {
			discs.push(...placedAt(branches.get(k)!, d, angle))
			segs.push({ ax: 0, ay: 0, bx: d * Math.cos(angle), by: d * Math.sin(angle) }, ...segsAt(branches.get(k)!, d, angle))
		}
		const wayBack = { ax: -core.r, ay: 0, bx: -back, by: 0 }
		// The shortest arrows the fan allows; past the longest arrow, any spread that fits; past twice
		// it, the way back no longer kept clear.
		for (let extra = 0; children.length; extra += stepOut) {
			const within = extra + gap <= C.maxArrow
			const spread = within ? fan : TURN - Math.PI / 6
			// How wide the fan is with nothing in the way, then swept again from half that to one side,
			// the arrow in from the parent in the way, and centred if that keeps it clear.
			const dry = sweep(core, children, () => extra, spread)
			const guard = C.keepWayBack && back > 0 && extra <= 2 * C.maxArrow
			const swept = dry && guard ? sweep(core, children, () => extra, spread, 0, -dry.at(-1)!.angle / 2, back) : dry
			if (swept?.length) {
				const mid = (swept[0]!.angle + swept.at(-1)!.angle) / 2
				const centred = swept.map((s) => ({ ...s, angle: s.angle - mid }))
				const all = centred.flatMap((s) => placedAt(branches.get(s.id)!, s.d, s.angle))
				const across = () => centred.some((s) => segsAt(branches.get(s.id)!, s.d, s.angle).some((g) => segsCross(g, wayBack)))
				const keep = !guard || (offTheWayBack(all, core.r, back) && !across()) ? centred : swept
				for (const s of keep) {
					at.set(s.id, { d: s.d, angle: s.angle })
					take(s.id, s.d, s.angle)
				}
				break
			}
			if (extra > 20 * C.maxArrow) {
				// Never reached in practice: evenly round, far enough out that nothing can touch.
				const d = core.r + gap + 2 * children.reduce((n, k) => n + branches.get(k)!.reach, 0)
				children.forEach((k, i) => {
					const angle = (TURN * i) / children.length
					at.set(k, { d, angle })
					take(k, d, angle)
				})
				break
			}
		}
		const reach = Math.max(...discs.map((b) => Math.hypot(b.x, b.y) + b.r))
		branches.set(id, { discs, segs, reach, at })
	}

	// The middle: the pillars on one ring round it, all the way round.
	const out = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	const pillars = kids(start)
	const hub: Disc = { x: 0, y: 0, r: radius(start) + C.hubRoom - gap }
	const widest = Math.max(0, ...pillars.map(radius))
	const minStep = pillars.length * ((C.minSlice / 180) * Math.PI) <= TURN ? (C.minSlice / 180) * Math.PI : 0
	let ring: { id: string; d: number; angle: number }[] = []
	for (let extra = 0; pillars.length; extra += stepOut) {
		const swept = sweep(hub, pillars, (id) => widest - radius(id) + extra, TURN, minStep)
		if (swept) {
			// Room between the last and the first: the first again past the last, clear of it.
			const last = swept.at(-1)!
			const first = branches.get(swept[0]!.id)!
			const lastDiscs = placedAt(branches.get(last.id)!, last.d, last.angle)
			let close = last.angle + minStep
			while (close < TURN && !clear(placedAt(first, swept[0]!.d, close), lastDiscs)) close += Math.PI / 360
			if (close <= TURN + 1e-9) {
				const spare = (TURN - close) / swept.length
				ring = swept.map((s, i) => ({ ...s, angle: s.angle + i * spare }))
				break
			}
		}
		if (extra > 20 * C.maxArrow) {
			// Never reached in practice: evenly round, far enough out that nothing can touch.
			const d = hub.r + gap + 2 * pillars.reduce((n, k) => n + branches.get(k)!.reach, 0)
			ring = pillars.map((id, i) => ({ id, d, angle: (TURN * i) / pillars.length }))
			break
		}
	}

	// Top-down: each branch turned to point away from its parent. The first pillar at the top.
	const facing = new Map<string, number>()
	for (const p of ring) {
		const angle = p.angle - Math.PI / 2
		facing.set(p.id, angle)
		out.set(p.id, { x: p.d * Math.cos(angle), y: p.d * Math.sin(angle) })
	}
	for (const id of order) {
		const branch = branches.get(id)
		const from = out.get(id)
		if (!branch || !from) continue
		for (const [kid, { d, angle }] of branch.at) {
			const a = facing.get(id)! + angle
			facing.set(kid, a)
			out.set(kid, { x: from.x + d * Math.cos(a), y: from.y + d * Math.sin(a) })
		}
	}
	return out
}

/**
 * Each node's children in the order they are swept round it: the YAML's, except that two children
 * whose branches a cross-link joins are brought next to each other, so the link doesn't cross the
 * branches between them. Every order is tried for a family of up to seven, the nearest to the YAML's
 * winning a tie; a larger family moves a linked child next to its partner, one at a time.
 */
export function siblingOrder(
	start: string,
	order: readonly string[],
	kids: (id: string) => readonly string[],
	parentOf: ReadonlyMap<string, string>,
	arrows: readonly { from: string; to: string }[]
): (id: string) => readonly string[] {
	const chain = (id: string) => {
		const out: string[] = []
		for (let at: string | undefined = id; at !== undefined; at = parentOf.get(at)) out.push(at)
		return out
	}
	// For each cross-link, the node where its two ends' branches meet, and the child of it on each side.
	const pairs = new Map<string, [string, string][]>()
	for (const { from, to } of arrows) {
		if (parentOf.get(to) === from || parentOf.get(from) === to || !parentOf.has(from) || !parentOf.has(to)) continue
		const up = chain(from)
		const down = chain(to)
		const meet = up.find((id) => down.includes(id))
		if (meet === undefined || meet === start) continue
		const a = up[up.indexOf(meet) - 1]
		const b = down[down.indexOf(meet) - 1]
		if (a !== undefined && b !== undefined && a !== b) pairs.set(meet, [...(pairs.get(meet) ?? []), [a, b]])
	}
	const cost = (list: readonly string[], original: readonly string[], links: readonly [string, string][]) => {
		const at = new Map(list.map((id, i) => [id, i]))
		let n = 0
		for (const [a, b] of links) n += 1000 * (Math.abs(at.get(a)! - at.get(b)!) - 1)
		original.forEach((id, i) => (n += Math.abs(at.get(id)! - i)))
		return n
	}
	const ordered = new Map<string, readonly string[]>()
	for (const id of order) {
		const original = kids(id)
		const links = pairs.get(id)
		if (!links || original.length < 3) continue
		let best = [...original]
		if (original.length <= 7) {
			for (const p of permutations(original)) if (cost(p, original, links) < cost(best, original, links)) best = p
		} else {
			for (const [a, b] of links) {
				const without = best.filter((x) => x !== b)
				const tries = [without.indexOf(a), without.indexOf(a) + 1].map((i) => [...without.slice(0, i), b, ...without.slice(i)])
				const pick = tries.reduce((p, q) => (cost(q, original, links) < cost(p, original, links) ? q : p))
				if (cost(pick, original, links) < cost(best, original, links)) best = pick
			}
		}
		ordered.set(id, best)
	}
	return (id) => ordered.get(id) ?? kids(id)
}

function permutations<T>(list: readonly T[]): T[][] {
	if (list.length <= 1) return [[...list]]
	return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest]))
}

/** Do the segments cross (not merely touch at an end)? */
function segsCross(p: Seg, q: Seg): boolean {
	const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
	const d1 = d(q.ax, q.ay, q.bx, q.by, p.ax, p.ay)
	const d2 = d(q.ax, q.ay, q.bx, q.by, p.bx, p.by)
	const d3 = d(p.ax, p.ay, p.bx, p.by, q.ax, q.ay)
	const d4 = d(p.ax, p.ay, p.bx, p.by, q.bx, q.by)
	return d1 * d2 < 0 && d3 * d4 < 0
}

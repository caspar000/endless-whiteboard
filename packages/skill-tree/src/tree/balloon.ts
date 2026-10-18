import type { LayoutConfig } from './layoutConfig'

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

export interface BalloonInput {
	start: string
	/** Skill nodes breadth first from the start. */
	order: readonly string[]
	/** A skill node's skill-node children, in order. */
	kids: (id: string) => readonly string[]
	/** How far a skill node's cluster reaches from its centre. */
	radius: (id: string) => number
	config: LayoutConfig
}

/** A branch laid out on its own: discs relative to its node, and each child's place relative to it. */
interface Branch {
	discs: Disc[]
	/** The smallest circle round the origin holding every disc. */
	reach: number
	/** Each child's distance from the node and angle from +x. */
	at: Map<string, { d: number; angle: number }>
}

const TURN = 2 * Math.PI

export function balloon({ start, order, kids, radius, config: C }: BalloonInput): Map<string, Point> {
	const gap = C.clusterGap
	const branches = new Map<string, Branch>()

	/** Discs of `branch` turned by `angle` and moved out `d` along it. */
	const placedAt = (branch: Branch, d: number, angle: number): Disc[] => {
		const [c, s] = [Math.cos(angle), Math.sin(angle)]
		return branch.discs.map((b) => ({ x: d * c + b.x * c - b.y * s, y: d * s + b.x * s + b.y * c, r: b.r }))
	}
	const clear = (mine: readonly Disc[], others: readonly Disc[]) => {
		for (const a of mine) for (const b of others) if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap) return false
		return true
	}

	/**
	 * Sweeps `children` round a node whose own disc is `core`, at `extra` beyond touching: each at the
	 * least angle past the last where its branch clears the rest. The angles, or null where the fan
	 * would pass `spread`.
	 */
	const sweep = (core: Disc, children: readonly string[], extra: (id: string) => number, spread: number, minStep = 0) => {
		const placed: Disc[] = [core]
		const out: { id: string; d: number; angle: number }[] = []
		let angle = 0
		for (const [i, id] of children.entries()) {
			const branch = branches.get(id)!
			const d = core.r + gap + radius(id) + extra(id)
			const fits = (a: number) => {
				// Far enough from everything placed that no disc can touch: skip the disc by disc test.
				const cx = d * Math.cos(a)
				const cy = d * Math.sin(a)
				const near = placed.filter((p) => Math.hypot(p.x - cx, p.y - cy) < branch.reach + p.r + gap)
				return clear(placedAt(branch, d, a), near)
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
						if (hi > spread + 1e-9) return null
					}
					for (let k = 0; k < 8; k++) {
						const mid = (lo + hi) / 2
						if (fits(mid)) hi = mid
						else lo = mid
					}
					lo = hi
				}
				angle = lo
			} else if (!fits(0)) return null
			if (angle > spread + 1e-9) return null
			placed.push(...placedAt(branch, d, angle))
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
		let swept: ReturnType<typeof sweep> = null
		// The shortest arrows the fan allows; past the longest arrow, any spread that fits.
		for (let extra = 0; !swept && children.length; extra += stepOut) {
			const within = extra + gap <= C.maxArrow
			swept = sweep(core, children, () => extra, within ? fan : TURN - Math.PI / 6)
			if (extra > 20 * C.maxArrow) break
		}
		const at = new Map<string, { d: number; angle: number }>()
		const discs: Disc[] = [core]
		if (swept?.length) {
			// The fan centred on straight out.
			const mid = (swept[0]!.angle + swept.at(-1)!.angle) / 2
			for (const s of swept) {
				at.set(s.id, { d: s.d, angle: s.angle - mid })
				discs.push(...placedAt(branches.get(s.id)!, s.d, s.angle - mid))
			}
		}
		const reach = Math.max(...discs.map((b) => Math.hypot(b.x, b.y) + b.r))
		branches.set(id, { discs, reach, at })
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
		if (extra > 20 * C.maxArrow) break
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

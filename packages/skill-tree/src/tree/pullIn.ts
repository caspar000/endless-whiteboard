import type { GraphNode } from './layout'

/**
 * Closes the gaps a layout leaves: each branch, nearest the start first, slides whole toward the
 * node it hangs from, along its arrow, as far as it can with nothing covered and no arrow between
 * skill nodes crossing more nodes than it did. The structure stays; the empty space between a node
 * and the arc its children were put on is used.
 *
 * Then the clumps (each branch from a tree's root, whole) are drawn in toward the start like
 * gravity, nearest first, under the same rules, until they rest against each other: the regions
 * the skeleton left empty between branches are closed up without changing any branch's shape.
 */

type Point = { x: number; y: number }
type Box = Point & { w: number; h: number }

export interface Segments {
	arrows: readonly (readonly [string, string])[]
	lines: readonly (readonly [string, string])[]
}

interface Line {
	ax: number
	ay: number
	bx: number
	by: number
}

/** How far an arrow keeps from a node it passes. */
const ARROW_MARGIN = 7
/** The smallest slide worth trying. */
const STEP = 10
/** Turns tried for a cluster when facing its gaps toward its arrows, in degrees. */
const REORIENT_STEP = 15
/** What `pullIn` runs on: which passes, their rounds and room, and what a move may not make worse. */
export interface PullSettings {
	/** Slide each branch toward the node it hangs from. */
	slideToParent: boolean
	/** Draw each branch, whole, toward the middle. */
	gravity: boolean
	/** Draw each cluster toward its nearest neighbour (ShrinkTree). */
	shrinkTree: boolean
	/** The least free space between two nodes while compacting. */
	compactGap: number
	gravityRounds: number
	shrinkRounds: number
	/** How far from straight in gravity may move a branch, in degrees. */
	gravityFan: number
	/** The longest an arrow between skill nodes may get, edge to edge: compaction never stretches one past it. */
	maxArrow: number
	/** What a move may not make worse: every crossing (of nodes, light lines and arrows), of skill nodes and arrows, or nothing. */
	arrowRule: 'skills' | 'all' | 'none'
	/** Last, turn each cluster so its gaps face where its arrows come in. */
	reorientClusters: boolean
	/** Then push every node an arrow runs through off it, sideways, as if the arrow were solid. */
	pushOffArrows: boolean
	/** Last, turn branches and clusters a little where that leaves fewer crossings. */
	repairCrossings: boolean
	/** Free space between two members of a cluster. */
	memberPad: number
}

/**
 * For the maze (wholeLayout.ts): nothing slides, draws in, pushes or turns a branch, which would
 * undo the maze; each cluster only turns about its own skill node to face its arrows.
 */
export const MAZE_PULL: PullSettings = {
	slideToParent: false,
	gravity: false,
	shrinkTree: false,
	compactGap: 12,
	gravityRounds: 4,
	shrinkRounds: 4,
	gravityFan: 60,
	maxArrow: 600,
	arrowRule: 'all',
	reorientClusters: true,
	pushOffArrows: false,
	repairCrossings: false,
	memberPad: 12,
}

/** The settings of the call in progress (`pullIn` sets them). */
let C: PullSettings = MAZE_PULL

export function pullIn(
	at: Map<string, Point>,
	size: ReadonlyMap<string, GraphNode>,
	children: ReadonlyMap<string, readonly string[]>,
	parentOf: ReadonlyMap<string, string>,
	isSkill: (id: string) => boolean,
	start: string,
	/** The roots of the clumps that are then drawn in toward the start, each whole. */
	clumps: readonly string[] = [],
	/** Each skill node's cluster (it and its entries and works), moved whole by the last pass. */
	units: ReadonlyMap<string, readonly string[]> = new Map(),
	/** No node but the start comes nearer the start than this, centre to edge: the open ring its arrows cross. */
	hub = 0,
	config: PullSettings = MAZE_PULL,
	/** What a move is judged by: the arrows between skill nodes (cross-links too) and the light lines, as pairs of ids. */
	segments: Segments = { arrows: [], lines: [] },
	/** A skill node's cluster laid out again with its gaps toward these angles: members' centres relative to it. */
	repack?: (skill: string, gates: number[]) => ReadonlyMap<string, Point>
): void {
	const outer = C
	C = config
	try {
		pullInNow(at, size, children, parentOf, isSkill, start, clumps, units, hub, segments, repack)
	} finally {
		C = outer
	}
}

function pullInNow(
	at: Map<string, Point>,
	size: ReadonlyMap<string, GraphNode>,
	children: ReadonlyMap<string, readonly string[]>,
	parentOf: ReadonlyMap<string, string>,
	isSkill: (id: string) => boolean,
	start: string,
	clumps: readonly string[],
	units: ReadonlyMap<string, readonly string[]>,
	hub: number,
	segments: Segments,
	repack: ((skill: string, gates: number[]) => ReadonlyMap<string, Point>) | undefined
): void {
	const ids = [...at.keys()].filter((id) => size.has(id))
	const index = new Map(ids.map((id, i) => [id, i]))
	const boxes: Box[] = ids.map((id) => ({ ...at.get(id)!, w: size.get(id)!.w, h: size.get(id)!.h }))
	const grid = new Grid()
	const bounds = (b: Box) => [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2] as const
	boxes.forEach((b, i) => grid.add(i, ...bounds(b)))
	const skillParent = (id: string) => {
		let p = parentOf.get(id)
		while (p && !isSkill(p)) p = parentOf.get(p)
		return p
	}
	const pairs = (list: readonly (readonly [string, string])[]) =>
		list.filter(([x, y]) => x !== y && index.has(x) && index.has(y)).map(([x, y]) => [index.get(x)!, index.get(y)!] as const)
	const arrows = pairs(segments.arrows)
	const lines = pairs(segments.lines)
	const arrowsAt = new Map<number, number[]>()
	arrows.forEach(([x, y], k) => {
		for (const e of [x, y]) arrowsAt.set(e, [...(arrowsAt.get(e) ?? []), k])
	})
	const linesAt = new Map<number, number[]>()
	lines.forEach(([x, y], k) => {
		for (const e of [x, y]) linesAt.set(e, [...(linesAt.get(e) ?? []), k])
	})
	const lineBox = (k: number) => {
		const [x, y] = lines[k]!
		return [Math.min(boxes[x]!.x, boxes[y]!.x), Math.min(boxes[x]!.y, boxes[y]!.y), Math.max(boxes[x]!.x, boxes[y]!.x), Math.max(boxes[x]!.y, boxes[y]!.y)] as const
	}
	const lineGrid = new Grid()
	lines.forEach((_, k) => lineGrid.add(k, ...lineBox(k)))

	const branch = (root: string) => {
		const out = new Set<number>()
		const queue = [root]
		for (let i = 0; i < queue.length; i++) {
			if (index.has(queue[i]!)) out.add(index.get(queue[i]!)!)
			queue.push(...(children.get(queue[i]!) ?? []))
		}
		return out
	}

	/** Where a node is under a trial: `pos` says where the moving ones go. */
	type Trial = { moving: ReadonlySet<number>; pos: (i: number) => Point; shift?: Point }
	const shiftBy = (moving: ReadonlySet<number>, dx: number, dy: number): Trial => ({
		moving,
		pos: (i) => (moving.has(i) ? { x: boxes[i]!.x + dx, y: boxes[i]!.y + dy } : boxes[i]!),
		shift: { x: dx, y: dy },
	})
	const still = (moving: ReadonlySet<number>): Trial => ({ moving, pos: (i) => boxes[i]!, shift: { x: 0, y: 0 } })
	const boxAt = (t: Trial, i: number): Box => ({ ...boxes[i]!, ...t.pos(i) })
	/** The light lines touching the moving nodes, worked out once per set. */
	const movingLines = new WeakMap<ReadonlySet<number>, Set<number>>()
	const linesOf = (moving: ReadonlySet<number>) => {
		let out = movingLines.get(moving)
		if (!out) {
			out = new Set<number>()
			for (const i of moving) for (const k of linesAt.get(i) ?? []) out.add(k)
			movingLines.set(moving, out)
		}
		return out
	}
	const regionOf = (t: Trial) => {
		let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
		for (const i of t.moving) {
			for (const p of [boxes[i]!, t.pos(i)]) {
				const r = reach(boxes[i]!)
				;[x0, y0, x1, y1] = [Math.min(x0, p.x - r), Math.min(y0, p.y - r), Math.max(x1, p.x + r), Math.max(y1, p.y + r)]
			}
		}
		return [x0, y0, x1, y1] as const
	}
	/** The arrows a trial can change: those with an end moving, and those passing the region it moves through. */
	const affected = (t: Trial) => {
		const [x0, y0, x1, y1] = regionOf(t)
		const out: number[] = []
		arrows.forEach(([x, y], k) => {
			if (t.moving.has(x) || t.moving.has(y)) return out.push(k)
			const [p, q] = [boxes[x]!, boxes[y]!]
			if (Math.max(p.x, q.x) >= x0 && Math.min(p.x, q.x) <= x1 && Math.max(p.y, q.y) >= y0 && Math.min(p.y, q.y) <= y1) out.push(k)
		})
		return out
	}
	/**
	 * What a trial costs on these arrows: crossings, by the arrow rule (of nodes, light lines and other
	 * arrows; of skill nodes and arrows; or none), and how far arrows run past the longest allowed.
	 */
	const judge = (R: readonly number[], t: Trial) => {
		const rule = C.arrowRule
		const inR = new Set(R)
		let crossings = 0
		let excess = 0
		const mLines = linesOf(t.moving)
		for (const k of R) {
			const [x, y] = arrows[k]!
			const p = t.pos(x)
			const q = t.pos(y)
			if (t.moving.has(x) || t.moving.has(y)) excess += Math.max(0, Math.hypot(q.x - p.x, q.y - p.y) - reach(boxes[x]!) - reach(boxes[y]!) - C.maxArrow)
			if (rule === 'none') continue
			const l = { ax: p.x, ay: p.y, bx: q.x, by: q.y }
			// Nodes: the still ones from the grid, the moving ones where the trial puts them.
			for (const j of grid.alongLine(l, C.compactGap + ARROW_MARGIN)) {
				if (j === x || j === y || t.moving.has(j) || (rule === 'skills' && !isSkill(ids[j]!))) continue
				if (crosses(l, boxes[j]!, ARROW_MARGIN)) crossings++
			}
			// Moved by a shift, the moving nodes near the arrow are those the grid has near it shifted back.
			const back = t.shift && { ax: l.ax - t.shift.x, ay: l.ay - t.shift.y, bx: l.bx - t.shift.x, by: l.by - t.shift.y }
			const nearMoving = back ? grid.alongLine(back, C.compactGap + ARROW_MARGIN).filter((j) => t.moving.has(j)) : t.moving
			for (const j of nearMoving) {
				if (j === x || j === y || (rule === 'skills' && !isSkill(ids[j]!))) continue
				if (crosses(l, boxAt(t, j), ARROW_MARGIN)) crossings++
			}
			// Other arrows, each pair once.
			arrows.forEach(([u, v], m) => {
				if (m === k || (inR.has(m) && m < k) || u === x || u === y || v === x || v === y) return
				if (segmentsCross(p, q, t.pos(u), t.pos(v))) crossings++
			})
			if (rule !== 'all') continue
			// Light lines: the still ones from their grid, the moving ones where the trial puts them.
			for (const m of lineGrid.alongLine(l, C.compactGap)) {
				if (mLines.has(m)) continue
				const [u, v] = lines[m]!
				if (u === x || u === y || v === x || v === y) continue
				if (segmentsCross(p, q, boxes[u]!, boxes[v]!)) crossings++
			}
			for (const m of back ? lineGrid.alongLine(back, C.compactGap).filter((m) => mLines.has(m)) : mLines) {
				const [u, v] = lines[m]!
				if (u === x || u === y || v === x || v === y) continue
				if (segmentsCross(p, q, t.pos(u), t.pos(v))) crossings++
			}
		}
		return { crossings, excess }
	}
	const hubAt = at.get(start) ?? { x: 0, y: 0 }
	const startIndex = index.get(start)
	/** Whether a trial puts a moving node on another, or inside the open ring round the middle. */
	const covers = (t: Trial) => {
		for (const i of t.moving) {
			const b = boxAt(t, i)
			if (hub && i !== startIndex && Math.hypot(b.x - hubAt.x, b.y - hubAt.y) - reach(b) < hub) return true
			const [x0, y0, x1, y1] = bounds(b)
			for (const j of grid.near(x0 - C.compactGap, y0 - C.compactGap, x1 + C.compactGap, y1 + C.compactGap)) if (!t.moving.has(j) && overlaps(b, boxes[j]!, C.compactGap)) return true
		}
		return false
	}
	/**
	 * Whether a trial puts two of its moving nodes on each other: a shift can't, but a turn can, as the
	 * works are boxes that don't turn with their cluster.
	 */
	const crowds = (t: Trial) => {
		const list = [...t.moving].map((i) => boxAt(t, i))
		for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) if (overlaps(list[a]!, list[b]!, C.memberPad)) return true
		return false
	}
	/** A trial is allowed when it covers nothing, crosses no more than before and stretches no arrow further past the longest allowed. */
	const allowed = (t: Trial) => {
		if (covers(t)) return false
		const R = affected(t)
		const before = judge(R, still(t.moving))
		const after = judge(R, t)
		return after.crossings <= before.crossings && after.excess <= before.excess + 0.5
	}
	const fits = (moving: ReadonlySet<number>, dx: number, dy: number) => allowed(shiftBy(moving, dx, dy))
	const apply = (t: Trial) => {
		const next = [...t.moving].map((i) => [i, t.pos(i)] as const)
		const touched = linesOf(t.moving)
		for (const k of touched) lineGrid.remove(k, ...lineBox(k))
		for (const [i, p] of next) {
			grid.remove(i, ...bounds(boxes[i]!))
			boxes[i] = { ...boxes[i]!, x: p.x, y: p.y }
			grid.add(i, ...bounds(boxes[i]!))
		}
		for (const k of touched) lineGrid.add(k, ...lineBox(k))
	}
	const move = (moving: ReadonlySet<number>, dx: number, dy: number) => apply(shiftBy(moving, dx, dy))

	// What the skeleton crosses is repaired first, while there is room to turn things; compaction
	// never adds a crossing, and the repair runs again at the end for what it left.
	if (C.repairCrossings) repair()
	const order = [start]
	for (let i = 0; i < order.length; i++) order.push(...(children.get(order[i]!) ?? []))
	for (const id of C.slideToParent ? order : []) {
		const parent = isSkill(id) ? skillParent(id) : undefined
		if (!parent || !index.has(parent) || !index.has(id)) continue
		const moving = branch(id)
		const p = boxes[index.get(parent)!]!
		const self = () => boxes[index.get(id)!]!
		let gap = Math.hypot(self().x - p.x, self().y - p.y) - reach(self()) - reach(p) - C.compactGap
		let step = gap / 2
		while (step > STEP && gap > 0) {
			const d = Math.hypot(p.x - self().x, p.y - self().y)
			const [ux, uy] = [(p.x - self().x) / d, (p.y - self().y) / d]
			const s = Math.min(step, gap)
			if (fits(moving, ux * s, uy * s)) {
				move(moving, ux * s, uy * s)
				gap -= s
			} else step /= 2
		}
	}
	// Then gravity: each clump, nearest first, moves whole toward the start as far as it fits, along
	// the straight way in and, when that is blocked, along ways a little to either side. Rounds repeat
	// so an outer clump can follow into room an inner one left.
	const origin = boxes[index.get(start)!] ?? { x: 0, y: 0 }
	const groups = clumps.filter((id) => index.has(id)).map((id) => ({ id, members: branch(id) }))
	const centroid = (members: ReadonlySet<number>) => {
		let [x, y] = [0, 0]
		for (const i of members) [x, y] = [x + boxes[i]!.x, y + boxes[i]!.y]
		return { x: x / members.size, y: y / members.size }
	}
	for (let round = 0; round < (C.gravity ? C.gravityRounds : 0); round++) {
		let moved = 0
		// Farthest first: an outer branch settles against what is inside it, then the branch it hangs
		// from moves in with it.
		const byDistance = [...groups].sort((a, b) => {
			const ca = centroid(a.members)
			const cb = centroid(b.members)
			return Math.hypot(cb.x - origin.x, cb.y - origin.y) - Math.hypot(ca.x - origin.x, ca.y - origin.y)
		})
		for (const { id, members } of byDistance) {
			// Never nearer the start than the node it hangs from: the tree still grows outward.
			const parent = skillParent(id)
			const floor = parent && index.has(parent) ? Math.hypot(boxes[index.get(parent)!]!.x - origin.x, boxes[index.get(parent)!]!.y - origin.y) : 0
			const root = index.get(id)!
			const outward = (dx: number, dy: number) => Math.hypot(boxes[root]!.x + dx - origin.x, boxes[root]!.y + dy - origin.y) >= floor + reach(boxes[root]!)
			const fan = (C.gravityFan / 180) * Math.PI
			for (const turn of [0, fan / 2, -fan / 2, fan, -fan]) {
				const c = centroid(members)
				const d = Math.hypot(origin.x - c.x, origin.y - c.y)
				if (d < STEP) break
				const a = Math.atan2(origin.y - c.y, origin.x - c.x) + turn
				const [ux, uy] = [Math.cos(a), Math.sin(a)]
				// No further along this way than brings the clump nearest the start.
				let left = d * Math.cos(turn)
				let step = left / 2
				let went = 0
				while (step > STEP && left > STEP) {
					step = Math.min(step, left)
					if (outward(ux * step, uy * step) && fits(members, ux * step, uy * step)) {
						left -= step
						move(members, ux * step, uy * step)
						went += step
					} else step /= 2
				}
				moved += went
			}
		}
		if (moved < STEP) break
	}
	if (C.shrinkTree) shrinkTree()
	if (C.reorientClusters) reorient()
	if (C.pushOffArrows) pushOffArrows()
	if (C.repairCrossings) repair()
	ids.forEach((id, i) => at.set(id, { x: boxes[i]!.x, y: boxes[i]!.y }))

	/**
	 * Phase B, step 3: what still crosses, repaired by bounded local moves. For each arrow between
	 * skill nodes that runs over a node, a light line or another arrow, the branches that could clear
	 * it are tried turned a little (up to 40°) about the node they hang from: the branch at either end
	 * of the arrow, and the branch of each node it runs over; a cluster the arrow runs through is also
	 * tried turned about its own skill node. The turn that leaves fewest crossings is kept, if that is
	 * fewer than now and it covers nothing, crowds nothing and stretches no arrow past the longest.
	 */
	function repair(): void {
		const TURNS = [4, -4, 8, -8, 15, -15, 25, -25, 40, -40].map((d) => (d / 180) * Math.PI)
		/** A family is small and loose: it may swing further, as far as round to the other side. */
		const WIDE = [...TURNS, ...[60, -60, 90, -90, 135, -135, 180].map((d) => (d / 180) * Math.PI)]
		/** The largest branch worth turning: past it a turn is a big move, and slow to judge. */
		const LARGEST = 400
		const skillOf = (id: string) => (isSkill(id) ? id : skillParent(id))
		const turnAbout = (moving: ReadonlySet<number>, pivot: Point, a: number): Trial => {
			const [cos, sin] = [Math.cos(a), Math.sin(a)]
			return {
				moving,
				pos: (i) => {
					if (!moving.has(i)) return boxes[i]!
					const [dx, dy] = [boxes[i]!.x - pivot.x, boxes[i]!.y - pivot.y]
					return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
				},
			}
		}
		/** Pairs of moving nodes on each other (works are boxes, which don't turn), by a grid of its own. */
		const crowding = (t: Trial) => {
			const cells = new Map<string, Box[]>()
			const SIZE = 200
			let n = 0
			for (const i of t.moving) {
				const b = boxAt(t, i)
				const [cx, cy] = [Math.floor(b.x / SIZE), Math.floor(b.y / SIZE)]
				for (let u = cx - 1; u <= cx + 1; u++) for (let v = cy - 1; v <= cy + 1; v++) for (const o of cells.get(`${u},${v}`) ?? []) if (overlaps(b, o, 0)) n++
				const key = `${cx},${cy}`
				cells.set(key, [...(cells.get(key) ?? []), b])
			}
			return n
		}
		/** Whether a turn puts moving nodes on each other more than they already are. */
		const crowded = (t: Trial) => crowding(t) > crowding(still(t.moving))
		const none = new Set<number>()
		for (let round = 0; round < 3; round++) {
			let repaired = 0
			for (const [k, [x, y]] of arrows.entries()) {
				if (!judge([k], still(none)).crossings) continue
				// What could clear it: the branches at its ends, and the branch and cluster of what it runs over.
				const tries: Trial[] = []
				const turns = (moving: Set<number>, pivot: Point, angles: readonly number[]) => {
					for (const a of angles) tries.push(turnAbout(moving, pivot, a))
				}
				const seen = new Set<string>()
				const branchOf = (skill: string | undefined) => {
					if (!skill || seen.has(`b:${skill}`)) return
					seen.add(`b:${skill}`)
					const parent = skillParent(skill)
					if (!parent || !index.has(parent)) return
					const moving = branch(skill)
					if (moving.size <= LARGEST) turns(moving, boxes[index.get(parent)!]!, TURNS)
				}
				const clusterOf = (skill: string | undefined) => {
					if (!skill || seen.has(`c:${skill}`) || !index.has(skill)) return
					seen.add(`c:${skill}`)
					const moving = new Set((units.get(skill) ?? []).filter((m) => m !== skill && index.has(m)).map((m) => index.get(m)!))
					if (moving.size) turns(moving, boxes[index.get(skill)!]!, TURNS)
				}
				branchOf(ids[y]!)
				branchOf(ids[x]!)
				/**
				 * An entry and its works turned round their skill node, or swapped round it with another
				 * entry's family, or its works alone swung round the entry.
				 */
				const familyOf = (member: string) => {
					let entry = member
					for (let p = parentOf.get(entry); p && !isSkill(p); p = parentOf.get(entry)) entry = p
					const skill = parentOf.get(entry)
					if (seen.has(`f:${entry}`) || !index.has(entry) || !skill || !index.has(skill)) return
					seen.add(`f:${entry}`)
					const family = branch(entry)
					const hub = boxes[index.get(skill)!]!
					turns(family, hub, WIDE)
					const works = new Set([...family].filter((i) => i !== index.get(entry)))
					if (works.size) turns(works, boxes[index.get(entry)!]!, WIDE)
					const angleOf = (i: number) => Math.atan2(boxes[i]!.y - hub.y, boxes[i]!.x - hub.x)
					for (const other of children.get(skill) ?? []) {
						if (other === entry || isSkill(other) || !index.has(other)) continue
						const theirs = branch(other)
						const turn = angleOf(index.get(other)!) - angleOf(index.get(entry)!)
						const mine = turnAbout(family, hub, turn)
						const back = turnAbout(theirs, hub, -turn)
						tries.push({ moving: new Set([...family, ...theirs]), pos: (i) => (family.has(i) ? mine.pos(i) : back.pos(i)) })
					}
				}
				const l = { ax: boxes[x]!.x, ay: boxes[x]!.y, bx: boxes[y]!.x, by: boxes[y]!.y }
				// An arrow it crosses: the branches at that arrow's ends.
				for (const [u, v] of arrows) {
					if (u === x || u === y || v === x || v === y || !segmentsCross(boxes[x]!, boxes[y]!, boxes[u]!, boxes[v]!)) continue
					branchOf(ids[v]!)
					branchOf(ids[u]!)
				}
				for (const j of grid.alongLine(l, C.compactGap + ARROW_MARGIN)) {
					if (j === x || j === y || !crosses(l, boxes[j]!, ARROW_MARGIN)) continue
					const owner = skillOf(ids[j]!)
					if (owner !== ids[x] && owner !== ids[y]) branchOf(owner)
					clusterOf(owner)
					if (!isSkill(ids[j]!)) familyOf(ids[j]!)
				}
				let best: Trial | null = null
				let gain = 0
				for (const t of tries) {
					if (covers(t) || crowded(t)) continue
					const R = affected(t)
					const before = judge(R, still(t.moving))
					const after = judge(R, t)
					if (after.excess > before.excess + 0.5) continue
					if (before.crossings - after.crossings > gain) {
						gain = before.crossings - after.crossings
						best = t
					}
				}
				if (best) {
					apply(best)
					repaired++
				}
			}
			if (!repaired) break
		}
	}

	/**
	 * Arrows as rigid bodies: any node an arrow between skill nodes runs through is pushed off it,
	 * sideways, with what belongs to it (a work its entry and siblings, an entry its works, a skill node
	 * its cluster), to whichever side clears it with least movement. Kept only when it covers nothing
	 * and leaves fewer crossings than before. Arrows may still cross each other.
	 */
	function pushOffArrows(): void {
		/** What moves with a node: its family, or for a skill node its cluster. */
		const groupOf = (j: number): Set<number> => {
			const id = ids[j]!
			if (isSkill(id)) return new Set((units.get(id) ?? [id]).filter((m) => index.has(m)).map((m) => index.get(m)!))
			let entry = id
			for (let p = parentOf.get(entry); p && !isSkill(p); p = parentOf.get(entry)) entry = p
			return branch(entry)
		}
		for (let round = 0; round < 3; round++) {
			let pushed = 0
			for (const [x, y] of arrows) {
				const l = { ax: boxes[x]!.x, ay: boxes[x]!.y, bx: boxes[y]!.x, by: boxes[y]!.y }
				const len = Math.hypot(l.bx - l.ax, l.by - l.ay)
				if (len < 1) continue
				const [ux, uy] = [(l.bx - l.ax) / len, (l.by - l.ay) / len]
				for (const j of grid.alongLine(l, C.compactGap + ARROW_MARGIN)) {
					if (j === x || j === y || !crosses({ ax: boxes[x]!.x, ay: boxes[x]!.y, bx: boxes[y]!.x, by: boxes[y]!.y }, boxes[j]!, ARROW_MARGIN)) continue
					const group = groupOf(j)
					if (group.has(x) || group.has(y)) continue
					// Which side of the arrow the node is on, and how far its edge reaches over it.
					const b = boxes[j]!
					const side = (b.x - l.ax) * -uy + (b.y - l.ay) * ux
					const [nx, ny] = [-uy, ux]
					const half = support(b, Math.atan2(ny, nx)) + ARROW_MARGIN + 2
					const options = [
						{ d: Math.sign(side || 1) * (half - Math.abs(side)) },
						{ d: -Math.sign(side || 1) * (half + Math.abs(side)) },
					].sort((p, q) => Math.abs(p.d) - Math.abs(q.d))
					for (const { d } of options) {
						let done = false
						for (const extra of [0, 24, 60]) {
							const shift = d + Math.sign(d) * extra
							const t = shiftBy(group, nx * shift, ny * shift)
							if (covers(t)) continue
							const R = affected(t)
							if (judge(R, t).crossings < judge(R, still(group)).crossings) {
								apply(t)
								pushed++
								done = true
								break
							}
						}
						if (done) break
					}
				}
			}
			if (!pushed) break
		}
	}

	/**
	 * Last, each cluster's gaps are turned to face where its arrows come in now that the clusters have
	 * moved: the cluster laid out again with its gaps toward its arrows (`repack`), or turned whole
	 * about its skill node, whichever crosses least and covers nothing; kept only if it crosses less
	 * than the cluster does as it is.
	 */
	function reorient(): void {
		for (const [u, list] of units) {
			const centre = index.get(u)
			if (centre === undefined) continue
			const members = new Set(list.filter((id) => id !== u && index.has(id)).map((id) => index.get(id)!))
			if (!members.size) continue
			const c = boxes[centre]!
			const candidates: Trial[] = []
			const gates = (arrowsAt.get(centre) ?? []).map((k) => {
				const [x, y] = arrows[k]!
				const o = boxes[x === centre ? y : x]!
				return Math.atan2(o.y - c.y, o.x - c.x)
			})
			const fresh = repack?.(u, gates)
			if (fresh) candidates.push({ moving: members, pos: (i) => (members.has(i) && fresh.has(ids[i]!) ? { x: c.x + fresh.get(ids[i]!)!.x, y: c.y + fresh.get(ids[i]!)!.y } : boxes[i]!) })
			for (let deg = REORIENT_STEP; deg < 360; deg += REORIENT_STEP) {
				const [cos, sin] = [Math.cos((deg / 180) * Math.PI), Math.sin((deg / 180) * Math.PI)]
				candidates.push({
					moving: members,
					pos: (i) => {
						if (!members.has(i)) return boxes[i]!
						const [dx, dy] = [boxes[i]!.x - c.x, boxes[i]!.y - c.y]
						return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
					},
				})
			}
			// The change each candidate makes, over every arrow either it or the cluster as it is touches.
			let best = 0
			let pick: Trial | null = null
			for (const t of candidates) {
				if (covers(t) || crowds(t)) continue
				const R = affected(t)
				const change = judge(R, t).crossings - judge(R, still(members)).crossings
				if (change < best) {
					best = change
					pick = t
				}
			}
			if (pick) apply(pick)
		}
	}

	/**
	 * Last, ShrinkTree (ELK's SPOrE compaction, after Nachmanson et al.'s GTree run backwards): the
	 * clusters, each whole, are joined by a minimum spanning tree of the gaps between them, rooted at
	 * the start; then, from the root outward, each cluster slides along its tree edge toward its
	 * neighbour, everything beyond it in the spanning tree with it, as far as it fits. Gravity draws
	 * things toward the middle; this draws each toward whatever is nearest, so a cluster at the end of
	 * a long branch, with nothing between it and the middle to rest on, still closes up. Unlike
	 * gravity it may bring a branch nearer the middle than the node it hangs from: at a branch's end,
	 * the only room left is inward. Rounds repeat with a fresh spanning tree.
	 */
	function shrinkTree(): void {
		const unitIds = [...units.keys()].filter((u) => index.has(u))
		if (unitIds.length < 2 || !index.has(start)) return
		const membersOf = new Map(unitIds.map((u) => [u, (units.get(u) ?? []).filter((id) => index.has(id)).map((id) => index.get(id)!)]))
		const rootUnit = unitIds.includes(start) ? start : unitIds[0]!
		for (let round = 0; round < C.shrinkRounds; round++) {
			const circle = new Map(
				unitIds.map((u) => {
					const members = membersOf.get(u)!
					const c = centroid(new Set(members))
					return [u, { ...c, r: Math.max(...members.map((i) => Math.hypot(boxes[i]!.x - c.x, boxes[i]!.y - c.y) + reach(boxes[i]!))) }]
				})
			)
			// Prim's minimum spanning tree over every pair, by the gap between their nearest nodes; the
			// circles round them only rule out pairs too far apart to be nearest neighbours.
			const gaps = new Map<string, number>()
			const gap = (a: string, b: string) => {
				const key = a < b ? `${a}|${b}` : `${b}|${a}`
				const known = gaps.get(key)
				if (known !== undefined) return known
				const p = circle.get(a)!
				const q = circle.get(b)!
				let g = Math.hypot(p.x - q.x, p.y - q.y) - p.r - q.r
				if (g < 2000) {
					g = Infinity
					for (const i of membersOf.get(a)!) for (const j of membersOf.get(b)!) g = Math.min(g, boxGap(boxes[i]!, boxes[j]!))
				}
				gaps.set(key, g)
				return g
			}
			const parentUnit = new Map<string, string>()
			const best = new Map(unitIds.filter((u) => u !== rootUnit).map((u) => [u, { cost: gap(rootUnit, u), from: rootUnit }]))
			const childrenOf = new Map<string, string[]>()
			while (best.size) {
				let pick = ''
				for (const [u, b] of best) if (!pick || b.cost < best.get(pick)!.cost) pick = u
				const { from } = best.get(pick)!
				best.delete(pick)
				parentUnit.set(pick, from)
				childrenOf.set(from, [...(childrenOf.get(from) ?? []), pick])
				for (const [u, b] of best) {
					const c = gap(pick, u)
					if (c < b.cost) best.set(u, { cost: c, from: pick })
				}
			}
			const subtree = (u: string): Set<number> => {
				const out = new Set<number>()
				const queue = [u]
				for (let i = 0; i < queue.length; i++) {
					for (const m of membersOf.get(queue[i]!)!) out.add(m)
					queue.push(...(childrenOf.get(queue[i]!) ?? []))
				}
				return out
			}
			let moved = 0
			const queue = [...(childrenOf.get(rootUnit) ?? [])]
			for (let i = 0; i < queue.length; i++) {
				const u = queue[i]!
				queue.push(...(childrenOf.get(u) ?? []))
				const from = circle.get(u)!
				const to = circle.get(parentUnit.get(u)!)!
				// Where the circles were before this round; the move is measured by what actually fits.
				const d = Math.hypot(to.x - from.x, to.y - from.y)
				if (d < STEP) continue
				const [ux, uy] = [(to.x - from.x) / d, (to.y - from.y) / d]
				const moving = subtree(u)
				let left = Math.max(0, d - from.r * 0.25)
				let step = left / 2
				while (step > STEP && left > STEP) {
					step = Math.min(step, left)
					if (fits(moving, ux * step, uy * step)) {
						move(moving, ux * step, uy * step)
						left -= step
						moved += step
					} else step /= 2
				}
			}
			if (moved < STEP) break
		}
	}
}

/** Do the segments p→q and r→s cross (not merely touch at an end)? */
function segmentsCross(p: Point, q: Point, r: Point, s: Point): boolean {
	const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
	const d1 = d(r, s, p)
	const d2 = d(r, s, q)
	const d3 = d(p, q, r)
	const d4 = d(p, q, s)
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** The free space between two shapes, 0 when they touch or overlap. */
function boxGap(a: Box, b: Box): number {
	if (isRound(a) && isRound(b)) return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.w / 2 - b.w / 2)
	const dx = Math.max(0, Math.abs(a.x - b.x) - a.w / 2 - b.w / 2)
	const dy = Math.max(0, Math.abs(a.y - b.y) - a.h / 2 - b.h / 2)
	return Math.hypot(dx, dy)
}

/** Skill nodes and entries are discs; works and the header are boxes. Canvas sizes come back a hair off square. */
const isRound = (b: { w: number; h: number }) => Math.abs(b.w - b.h) < 0.5
const reach = (b: { w: number; h: number }) => (isRound(b) ? b.w / 2 : Math.hypot(b.w, b.h) / 2)
/** How far a shape reaches from its centre in direction `a`. */
const support = (b: { w: number; h: number }, a: number) => (isRound(b) ? b.w / 2 : (Math.abs(Math.cos(a)) * b.w) / 2 + (Math.abs(Math.sin(a)) * b.h) / 2)

/** Buckets of what is where, so a spot is only checked against what is near it. */
class Grid {
	private cells = new Map<number, number[]>()
	private seen: number[] = []
	private stamp = 0
	/** About a node's size: a long arrow then walks few cells, and a cell holds few nodes. */
	private static SIZE = 160
	/** The cells a query has looked in already, so a line's overlapping steps don't look twice. */
	private visited = new Set<number>()
	private key = (i: number, j: number) => i * 65536 + j

	add(index: number, x0: number, y0: number, x1: number, y1: number): void {
		const s = Grid.SIZE
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				const k = this.key(i, j)
				const cell = this.cells.get(k)
				if (cell) cell.push(index)
				else this.cells.set(k, [index])
			}
		}
	}

	remove(index: number, x0: number, y0: number, x1: number, y1: number): void {
		const s = Grid.SIZE
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				const cell = this.cells.get(this.key(i, j))
				const at = cell?.indexOf(index) ?? -1
				if (at >= 0) cell!.splice(at, 1)
			}
		}
	}

	/** Each index whose bounds share a cell with these, once. */
	near(x0: number, y0: number, x1: number, y1: number): number[] {
		const out: number[] = []
		this.stamp++
		this.visited.clear()
		this.collect(x0, y0, x1, y1, out)
		return out
	}

	/** Each index near a line, within `pad` of it, once: the cells along it rather than its whole bounding box. */
	alongLine(l: Line, pad: number): number[] {
		const out: number[] = []
		this.stamp++
		this.visited.clear()
		const steps = Math.max(1, Math.ceil(Math.hypot(l.bx - l.ax, l.by - l.ay) / (Grid.SIZE / 2)))
		for (let i = 0; i <= steps; i++) {
			const x = l.ax + ((l.bx - l.ax) * i) / steps
			const y = l.ay + ((l.by - l.ay) * i) / steps
			this.collect(x - pad - Grid.SIZE / 2, y - pad - Grid.SIZE / 2, x + pad + Grid.SIZE / 2, y + pad + Grid.SIZE / 2, out)
		}
		return out
	}

	private collect(x0: number, y0: number, x1: number, y1: number, out: number[]): void {
		const s = Grid.SIZE
		for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
			for (let j = Math.floor(y0 / s); j <= Math.floor(y1 / s); j++) {
				const k = this.key(i, j)
				if (this.visited.has(k)) continue
				this.visited.add(k)
				const cell = this.cells.get(k)
				if (!cell) continue
				for (const index of cell) {
					if (this.seen[index] === this.stamp) continue
					this.seen[index] = this.stamp
					out.push(index)
				}
			}
		}
	}
}

function boxDistance(b: Box, x: number, y: number): number {
	return Math.hypot(Math.max(0, Math.abs(x - b.x) - b.w / 2), Math.max(0, Math.abs(y - b.y) - b.h / 2))
}

function overlaps(a: Box, b: Box, pad: number): boolean {
	if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.y - b.y) < a.w / 2 + b.w / 2 + pad
	if (isRound(a)) return boxDistance(b, a.x, a.y) < a.w / 2 + pad
	if (isRound(b)) return boxDistance(a, b.x, b.y) < b.w / 2 + pad
	return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad
}

/** Does the line pass within `margin` of the shape? */
function crosses(l: Line, s: Box, margin: number): boolean {
	const dx = l.bx - l.ax
	const dy = l.by - l.ay
	if (isRound(s)) {
		const len2 = dx * dx + dy * dy || 1
		const t = Math.max(0, Math.min(1, ((s.x - l.ax) * dx + (s.y - l.ay) * dy) / len2))
		return Math.hypot(l.ax + t * dx - s.x, l.ay + t * dy - s.y) < s.w / 2 + margin
	}
	// Clip the line to the box grown by the margin (Liang–Barsky); anything left inside crosses it.
	let t0 = 0
	let t1 = 1
	const edges: [number, number][] = [
		[-dx, l.ax - (s.x - s.w / 2 - margin)],
		[dx, s.x + s.w / 2 + margin - l.ax],
		[-dy, l.ay - (s.y - s.h / 2 - margin)],
		[dy, s.y + s.h / 2 + margin - l.ay],
	]
	for (const [p, q] of edges) {
		if (p === 0) {
			if (q < 0) return false
			continue
		}
		const r = q / p
		if (p < 0) t0 = Math.max(t0, r)
		else t1 = Math.min(t1, r)
		if (t0 > t1) return false
	}
	return true
}

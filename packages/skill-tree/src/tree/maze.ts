/**
 * The maze layout (the user's idea, docs/skill-tree-layout-plan.md): the tree grown from the start
 * through a grid of cells (hexagons or squares), every node in a cell of its own, each joined to its
 * parent by a corridor of cells, branch by branch, depth first.
 *
 * - **Doors.** When a node is placed, a free cell beside it is set aside for each child (its door);
 *   children past the free cells round it share a corridor cell (`~n`) that forks again.
 * - **Nothing is ever cut off.** Every door keeps a way of its own out to the edge of the grid, its
 *   cells shared with no other door's (vertex-disjoint paths, kept as a flow and repaired when a move
 *   disturbs one), and a cell is only taken if every door still has one after. So when a door's node
 *   is placed, the first cell of its own way out is free beside it: there is always room for its
 *   first child, and its other children go through it. Only reaching the grid's edge can stop a
 *   branch, and then the whole maze is grown again in a bigger grid.
 * - **Compact.** A chain hugs what is already built (`snake`, Warnsdorff's rule: the free cell with
 *   fewest free neighbours) or heads outward (`straight`); a family fans out round its node, spread
 *   about the way it was reached, nearer the start first.
 * - No two corridors share a cell, so nothing crosses or overlaps.
 */

import type { LayoutConfig } from './layoutDefaults'

type Point = { x: number; y: number }

export interface MazeInput {
	start: string
	/** Nodes breadth first from the start. */
	order: readonly string[]
	/** A node's children, in order. */
	kids: (id: string) => readonly string[]
	/** How far a node reaches from its centre. */
	radius: (id: string) => number
	/** Skill nodes; the rest (cards) settle round theirs. */
	isSkill?: (id: string) => boolean
	config: LayoutConfig
	/** See `MazeOptions.toward`. */
	toward?: (id: string) => string | undefined
}

/** The maze as the whole-life layout's placement (wholeLayout.ts): every node a cell, `mazeCell` across. */
export function mazeLayout({ start, order, kids, radius, isSkill, config: C, toward }: MazeInput): Map<string, Point> {
	const cell = C.mazeCell
	// Any setting goes (the layout tuner): a cell has some size, a chain at least one step.
	const m = maze(start, order, kids, radius, { grid: C.mazeGrid, walk: C.mazeWalk, fill: C.mazeRoom, spacing: Math.max(1, Math.round(C.mazeSpacing)), cell: Math.max(1, cell), hub: C.mazeHub, local: isSkill && ((id) => !isSkill(id)), wrap: C.mazeFamilies === 'wrap', toward })
	grid = { cell: Math.max(1, cell), shape: C.mazeGrid, cells: m.cells, used: [...m.used] }
	// Each node's whole way from its parent: through any shared corridor cells (`~n`) on the way.
	const into = new Map(m.corridors.map((c) => [c.to, c]))
	routes = new Map()
	for (const id of order) {
		let c = into.get(id)
		if (!c) continue
		let path = c.path
		while (c.from.startsWith('~') && into.has(c.from)) {
			c = into.get(c.from)!
			path = [...c.path, ...path.slice(1)]
		}
		routes.set(`${c.from} ${id}`, path)
	}
	return new Map(order.map((id) => [id, m.at.get(id)!]))
}

let routes: Map<string, Point[]> | null = null

/** The cells of a maze, for the hexagon view (tree/MazeGuides.tsx): centres round the start, and which ones the tree took. */
export interface MazeGrid {
	cell: number
	shape: 'hex' | 'square'
	cells: readonly Point[]
	used: readonly number[]
}
let grid: MazeGrid | null = null
/** The grid of the last maze laid out here (`forgetMazeRoutes` before laying out clears it too). */
export const takeMazeGrid = (): MazeGrid | null => grid

/**
 * The corridors of the last maze laid out here, `parent child` → the way from the parent's centre to
 * the child's (the start at the origin); `null` when the last layout wasn't a maze (`forgetMazeRoutes`
 * before laying out).
 */
export const takeMazeRoutes = (): ReadonlyMap<string, Point[]> | null => routes
export const forgetMazeRoutes = (): void => {
	routes = null
	grid = null
}

export interface MazeOptions {
	grid: 'hex' | 'square'
	walk: 'snake' | 'straight'
	/** How big a grid to grow in, in cells per node (it only needs to leave room to spare; a bigger one is slower). */
	fill: number
	/** Open ground between the start and the first cells. */
	hub: number
	/** Cells from a node to its child: 1 next door, 2 with a corridor cell between. */
	spacing: number
	/** Distance between neighbouring cells' centres. */
	cell: number
	/** Nodes grown depth first as soon as their parent is placed (cards round their skill node), the rest breadth first. */
	local?: (id: string) => boolean
	/**
	 * Big families (more children than free sides) wrap round their node: their shared corridor forks
	 * on first and keeps close to it. Otherwise it forks in turn with everything else and spreads out.
	 */
	wrap?: boolean
	/** Another node a node would like its cell to face (a tree's second pillar), or none. */
	toward?: (id: string) => string | undefined
}

export interface MazeResult {
	at: Map<string, Point>
	/** Every cell's centre, and which ones the tree took (nodes and corridors). */
	cells: Point[]
	used: Set<number>
	/** Each arrow's way: from the parent's centre through the corridor to the child's. */
	corridors: { from: string; to: string; path: Point[] }[]
	/** Nodes that found no room (placed beside their parent): none, unless the grid ran out at its edge every time. */
	overflow: string[]
}

/** The tree grown in a grid big enough for it; grown again in a bigger one if a branch reached the edge. */
export function maze(start: string, order: readonly string[], kids: (id: string) => readonly string[], radius: (id: string) => number, o: MazeOptions): MazeResult & { fill: number } {
	let m: MazeResult | null = null
	let fill = Math.max(1.5, o.fill)
	for (let tries = 0; tries < 5; tries++, fill *= 1.6) {
		m = grow(start, order, kids, radius, { ...o, fill })
		if (!m.overflow.length) break
	}
	return { ...m!, fill }
}

type Group = { ids: readonly string[]; steps: number }
interface Door {
	cell: number
	group: Group
	/** What it hangs from: a node, or a shared corridor cell (`~n`), and where that is. */
	parent: string
	parentCell: number
}

function grow(start: string, order: readonly string[], kids: (id: string) => readonly string[], radius: (id: string) => number, o: MazeOptions): MazeResult {
	const hex = o.grid === 'hex'
	const spacing = Math.max(1, Math.round(o.spacing))
	const nodes = order.length - 1 + order.reduce((n, id) => n + (kids(id).length === 1 ? spacing - 1 : 0), 0)

	// The grid: a disc of cells clear of the start, `fill` cells per node.
	const clear = radius(start) + o.cell * 0.5 + o.hub
	const s = o.cell / Math.sqrt(3)
	const centre = (q: number, r: number): Point => (hex ? { x: s * 1.5 * q, y: o.cell * (r + q / 2) } : { x: q * o.cell, y: r * o.cell })
	let reach = clear + o.cell * 2
	let keys: [number, number][] = []
	for (;;) {
		keys = []
		const span = Math.ceil(reach / (hex ? s * 1.5 : o.cell)) + 2
		for (let q = -span; q <= span; q++)
			for (let r = -2 * span; r <= 2 * span; r++) {
				const c = centre(q, r)
				const d = Math.hypot(c.x, c.y)
				if (d >= clear && d <= reach) keys.push([q, r])
			}
		if (keys.length >= Math.ceil(nodes * o.fill) + 12) break
		reach += o.cell * 0.5
	}
	const N = keys.length
	const cells = keys.map(([q, r]) => centre(q, r))
	const index = new Map(keys.map(([q, r], i) => [`${q},${r}`, i]))
	const steps: readonly (readonly [number, number])[] = hex
		? [
				[1, 0],
				[1, -1],
				[0, -1],
				[-1, 0],
				[-1, 1],
				[0, 1],
			]
		: [
				[1, 0],
				[0, -1],
				[-1, 0],
				[0, 1],
			]
	const nbr = keys.map(([q, r]) => steps.flatMap(([dq, dr]) => index.get(`${q + dq},${r + dr}`) ?? []))
	// Each cell's sides open to the outside of the grid (past its rim; the hole round the start is no
	// way out). The edge, where every door's way out ends, is the cells with one.
	const outside = keys.map(([q, r]) => steps.filter(([dq, dr]) => !index.has(`${q + dq},${r + dr}`) && Math.hypot(centre(q + dq, r + dr).x, centre(q + dq, r + dr).y) > reach).length)
	const edge = outside.map((n) => n > 0)
	const ORIGIN = -1
	const ring = cells.map((c, i) => [i, Math.hypot(c.x, c.y)] as const).filter(([, d]) => d < clear + o.cell * 0.9).map(([i]) => i)
	const pt = (c: number): Point => (c === ORIGIN ? { x: 0, y: 0 } : cells[c]!)
	const angleFrom = (from: number, c: number) => Math.atan2(pt(c).y - pt(from).y, pt(c).x - pt(from).x)
	const off = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

	// What is taken (nodes and corridors), the doors set aside, and every door's way out: `next` is a
	// way's next cell (SINK past the edge), `owner` which door's way a cell is on (-1 none).
	const used = new Uint8Array(N)
	const doorAt = new Map<number, Door>()
	const SINK = -2
	let next = new Int32Array(N).fill(-1)
	let owner = new Int32Array(N).fill(-1)
	let prev = new Int32Array(N).fill(-1)
	/** Every way out walked again from its door: who owns which cell, and each cell's predecessor. */
	const retrace = () => {
		owner.fill(-1)
		prev.fill(-1)
		const keep = new Int32Array(N).fill(-1)
		for (const d of doorAt.keys()) {
			for (let c = d, guard = 0; c >= 0 && guard <= N; guard++) {
				owner[c] = d
				keep[c] = next[c]!
				const n = next[c]!
				if (n >= 0) prev[n] = c
				c = n
			}
		}
		next = keep
	}
	/**
	 * A way out for the door at `src` (free, on no way yet), by the shortest augmenting path through
	 * the others' ways (they may be rerouted, never dropped): each cell taken by at most one way, a
	 * door's own cell by none but its own. False if there is none.
	 */
	const parentState = new Int32Array(2 * N)
	const augment = (src: number): boolean => {
		parentState.fill(-1)
		const seen = new Uint8Array(2 * N)
		const IN = 0
		const OUT = 1
		const queue: number[] = [src * 2 + IN]
		seen[src * 2 + IN] = 1
		let end = -1
		const visit = (state: number, from: number) => {
			if (seen[state]) return
			seen[state] = 1
			parentState[state] = from
			queue.push(state)
		}
		for (let i = 0; i < queue.length && end < 0; i++) {
			const state = queue[i]!
			const c = state >> 1
			if ((state & 1) === IN) {
				if (owner[c]! < 0 || c === src) visit(c * 2 + OUT, state)
				else if (prev[c]! >= 0) visit(prev[c]! * 2 + OUT, state)
			} else {
				if (edge[c]) {
					end = state
					break
				}
				for (const n of nbr[c]!) if (!used[n] && (!doorAt.has(n) || n === src) && n !== src) visit(n * 2 + IN, state)
				if (owner[c]! >= 0 && c !== src) visit(c * 2 + IN, state)
			}
		}
		if (end < 0) return false
		const states: number[] = []
		for (let st = end; st >= 0; st = parentState[st]!) states.push(st)
		states.reverse()
		for (let i = 0; i + 1 < states.length; i++) {
			const [a, b] = [states[i]!, states[i + 1]!]
			const [ca, cb] = [a >> 1, b >> 1]
			if ((a & 1) === OUT && (b & 1) === IN && ca !== cb) next[ca] = cb
			else if ((a & 1) === IN && (b & 1) === OUT && ca !== cb) {
				if (next[cb] === ca) next[cb] = -1
			}
		}
		next[end >> 1] = SINK
		retrace()
		return true
	}
	/** Its way out forgotten (the door is being taken or given up). */
	const forget = (d: number) => {
		for (let c = d, guard = 0; c >= 0 && guard <= N; guard++) {
			const n = next[c]!
			next[c] = -1
			c = n
		}
	}
	/**
	 * A new door at `c` for `group`, if every door can still get out after: `c` taken off whatever
	 * way ran through it, and that way and `c`'s own found again; all as it was otherwise.
	 */
	const open = (c: number, group: Group, parent: string, parentCell: number): boolean => {
		if (used[c] || doorAt.has(c)) return false
		const saved = { next: next.slice(), owner: owner.slice(), prev: prev.slice() }
		const displaced = owner[c]!
		if (displaced >= 0) {
			forget(displaced)
			retrace()
		}
		doorAt.set(c, { cell: c, group, parent, parentCell })
		if (augment(c) && (displaced < 0 || augment(displaced))) {
			// A node with both skill nodes and cards below it keeps a second cell beside it, with a way out
			// of its own, so the two kinds leave it by separate doors and an arrow never runs along a line.
			if (mixed(group)) {
				const spare = nbr[c]!.find((x) => x !== parentCell && open(x, NONE, '', -1))
				if (spare !== undefined) spareOf.set(c, spare)
			}
			return true
		}
		doorAt.delete(c)
		;({ next, owner, prev } = saved)
		return false
	}
	const mixed = (g: Group) => {
		const k = g.ids.length === 1 && g.steps === 0 ? kids(g.ids[0]!) : []
		return !!o.local && k.some(o.local) && !k.every(o.local)
	}
	/** `open`, only where a node with both kinds below it also gets its second cell. */
	const openWithSpare = (c: number, group: Group, parent: string, parentCell: number): boolean => {
		const saved = { next: next.slice(), owner: owner.slice(), prev: prev.slice() }
		if (!open(c, group, parent, parentCell)) return false
		if (spareOf.has(c)) return true
		doorAt.delete(c)
		;({ next, owner, prev } = saved)
		return false
	}
	const NONE: Group = { ids: [], steps: 0 }
	/** The second cell kept beside a door (see `open`), given up when the door is taken. */
	const spareOf = new Map<number, number>()

	const at = new Map<string, Point>([[start, { x: 0, y: 0 }]])
	const corridors: MazeResult['corridors'] = []
	/** Doors waiting: skill nodes' in a queue (breadth first), cards' on a stack (depth first, before any skill node's). */
	const skills: Door[] = []
	const cards: Door[] = []
	const trunks: Door[] = []
	const isLocal = (g: Group) => !!o.local && g.ids.every((id) => o.local!(id))
	let virtuals = 0
	/** For a shared corridor cell, the cell of the node whose family runs through it. */
	const homeOf = new Map<string, number>()
	// Free sides: the outside of the grid counts as free (it isn't a wall to hug), the start's hole doesn't.
	const freeSides = (c: number) => nbr[c]!.filter((x) => !used[x] && !doorAt.has(x)).length + outside[c]!
	const groupsOf = (id: string): Group[] => {
		const k = kids(id)
		return k.map((c) => ({ ids: [c], steps: k.length === 1 ? spacing - 1 : 0 }))
	}

	const join = (d: Door, more: readonly Group[]) => {
		d.group = { ids: [...d.group.ids, ...more.flatMap((h) => h.ids)], steps: 0 }
	}
	/**
	 * `rest` (all of one kind) onto the last door of their kind. With none, the last door of the other
	 * kind is handed over when that kind has another to move onto; only when it hasn't does a bundle
	 * carry both kinds (and they part at its next fork).
	 */
	const bundle = (placed: Door[], rest: readonly Group[], local: boolean) => {
		const same = placed.filter((d) => isLocal(d.group) === local)
		if (same.length) return join(same[same.length - 1]!, rest)
		const other = placed.filter((d) => isLocal(d.group) !== local)
		if (other.length < 2) return join(placed[placed.length - 1]!, rest)
		const [taken, onto] = [other[other.length - 1]!, other[other.length - 2]!]
		join(onto, [taken.group])
		taken.group = { ids: rest.flatMap((h) => h.ids), steps: 0 }
	}
	/**
	 * Which way a group of one wants its door from `cv`, when the node in it leans toward another
	 * (`toward`): at that node if it is placed, else at the door kept for it.
	 */
	const aimOf = (g: Group, cv: number): number | undefined => {
		const target = g.ids.length === 1 ? o.toward?.(g.ids[0]!) : undefined
		if (!target) return undefined
		const door = [...doorAt.values()].find((d) => d.group.ids.includes(target))
		const p = at.get(target) ?? (door ? pt(door.cell) : undefined)
		const from = pt(cv)
		return p ? Math.atan2(p.y - from.y, p.x - from.x) : undefined
	}
	/**
	 * Doors for `groups` round the node `v` at `cv` (reached from `from`): each where it suits best of
	 * the cells that still leave everyone a way out; when a group finds none, it and the rest share
	 * the last door found, as one bundle. Always at least one: the node's own way out began beside it.
	 */
	const fork = (v: string, cv: number, groups: Group[], from: number | null) => {
		if (!groups.length) return
		const around = cv === ORIGIN ? ring : nbr[cv]!
		const out = from === null || cv === ORIGIN ? -Math.PI / 2 : angleFrom(from, cv)
		// Where each group would like its door: round the start, the middle of its share of the circle by
		// how much hangs below it (the first at the top); elsewhere spread round straight on.
		const weight = (g: Group) => g.ids.reduce((n, id) => n + (below.get(id) ?? 1), 0)
		const total = groups.reduce((n, g) => n + weight(g), 0)
		let a = -Math.PI / 2 - (Math.PI * weight(groups[0]!)) / total
		const wants = groups.map((g, i) => {
			if (cv !== ORIGIN) return out + (i - (groups.length - 1) / 2) * (hex ? Math.PI / 3 : Math.PI / 2)
			const mid = a + (Math.PI * weight(g)) / total
			a += (2 * Math.PI * weight(g)) / total
			return mid
		})
		const placed: Door[] = []
		// The second cell kept for a node with both kinds below it (see `open`): held while the doors
		// are found, for the kind that would otherwise find none, and given up when it isn't needed.
		let spare = spareOf.get(cv)
		const release = () => {
			forget(spare!)
			doorAt.delete(spare!)
			retrace()
			spare = undefined
		}
		for (let i = 0; i < groups.length; i++) {
			const g = groups[i]!
			const chain = groups.length === 1 && cv !== ORIGIN
			// Wrapping (`wrap`): a shared corridor cell's doors keep close to the node the family belongs
			// to, so a big family wraps round its parent instead of trailing off along its trunk.
			const home = o.wrap ? homeOf.get(v) : undefined
			const aim = aimOf(g, cv)
			const score = (c: number) => {
				const direction = cv === ORIGIN ? Math.atan2(pt(c).y, pt(c).x) : angleFrom(cv, c)
				if (aim !== undefined) return off(direction, aim) * 4 + (chain ? freeSides(c) : 0)
				if (home !== undefined) return (Math.hypot(pt(c).x - pt(home).x, pt(c).y - pt(home).y) / o.cell) * 4 + off(direction, wants[i]!)
				if (chain) return o.walk === 'snake' ? freeSides(c) * 10 + off(direction, out) : -Math.hypot(pt(c).x, pt(c).y) / o.cell + off(direction, out)
				return off(direction, wants[i]!) * 4 + Math.hypot(pt(c).x, pt(c).y) / o.cell / 4
			}
			const candidates = around.filter((c) => !used[c] && !doorAt.has(c)).sort((x, y) => score(x) - score(y))
			const door = (mixed(g) ? candidates.find((c) => openWithSpare(c, g, v, cv)) : undefined) ?? candidates.find((c) => open(c, g, v, cv))
			if (door !== undefined) {
				placed.push(doorAt.get(door)!)
				continue
			}
			let rest = groups.slice(i)
			if (spare !== undefined) {
				const missing = [false, true].filter((l) => rest.some((h) => isLocal(h) === l) && !placed.some((d) => isLocal(d.group) === l))
				if (missing.length !== 1) {
					release()
					i--
					continue
				}
				const s = doorAt.get(spare)!
				Object.assign(s, { group: { ids: rest.filter((h) => isLocal(h) === missing[0]).flatMap((h) => h.ids), steps: 0 }, parent: v, parentCell: cv })
				placed.push(s)
				spare = undefined
				rest = rest.filter((h) => isLocal(h) !== missing[0])
			}
			// No room for this one: it and the rest share a door found, as bundles of their own kind
			// (skill nodes with skill nodes, cards with cards), so an arrow never runs along a card's line.
			if (!placed.length) {
				for (const h of rest) for (const id of h.ids) lost.push(id)
				break
			}
			for (const local of [false, true]) {
				const kind = rest.filter((h) => isLocal(h) === local)
				if (kind.length) bundle(placed, kind, local)
			}
			break
		}
		if (spare !== undefined) release()
		// Skill nodes breadth first, in order, so every node's family gets its doors before anything
		// deeper takes the room round it; cards (`local`) depth first, at once, so a skill node's cards
		// settle round it before the next skill nodes take the space.
		// Wrapping (`wrap`): a family's shared corridor forks on before anything else grows, so the
		// whole family gets its doors round its parent before cards fill the room there.
		const isTrunk = (d: Door) => !!o.wrap && d.group.ids.length > 1
		for (const d of placed.filter(isTrunk).reverse()) trunks.push(d)
		for (const d of placed.filter((d) => !isTrunk(d) && !isLocal(d.group))) skills.push(d)
		for (const d of placed.filter((d) => !isTrunk(d) && isLocal(d.group)).reverse()) cards.push(d)
	}

	// How much hangs below each node, for the shares round the start.
	const below = new Map<string, number>()
	for (const id of [...order].reverse()) below.set(id, 1 + kids(id).reduce((n, k) => n + below.get(k)!, 0))
	const lost: string[] = []

	fork(start, ORIGIN, groupsOf(start), null)
	while (trunks.length || cards.length || skills.length) {
		const d = trunks.length ? trunks.pop()! : cards.length ? cards.pop()! : skills.shift()!
		if (!doorAt.has(d.cell)) continue
		// A node with both kinds below it that found no second cell when its door opened tries again now.
		if (mixed(d.group) && !spareOf.has(d.cell)) {
			const spare = nbr[d.cell]!.find((x) => x !== d.parentCell && open(x, NONE, '', -1))
			if (spare !== undefined) spareOf.set(d.cell, spare)
		}
		// The door taken: its way out given up (its first cell is free beside it for what comes next).
		forget(d.cell)
		doorAt.delete(d.cell)
		used[d.cell] = 1
		retrace()
		const { group } = d
		if (group.ids.length === 1 && group.steps === 0) {
			const k = group.ids[0]!
			at.set(k, pt(d.cell))
			corridors.push({ from: d.parent, to: k, path: [pt(d.parentCell), pt(d.cell)] })
			fork(k, d.cell, groupsOf(k), d.parentCell)
		} else {
			// A corridor cell: a step along an only child's way, or where a bundle forks again.
			const corridor = `~${++virtuals}`
			if (group.ids.length > 1) homeOf.set(corridor, homeOf.get(d.parent) ?? d.parentCell)
			corridors.push({ from: d.parent, to: corridor, path: [pt(d.parentCell), pt(d.cell)] })
			const groups = group.ids.length === 1 ? [{ ids: group.ids, steps: group.steps - 1 }] : group.ids.map((id) => ({ ids: [id], steps: 0 }))
			fork(corridor, d.cell, groups, d.parentCell)
		}
	}

	// Anything left without a cell (only when a branch ran out at the grid's edge) sits beside its parent.
	const overflow: string[] = []
	const parentOf = new Map<string, string>()
	for (const id of order) for (const k of kids(id)) parentOf.set(k, id)
	for (const id of order) {
		if (at.has(id)) continue
		const p = at.get(parentOf.get(id) ?? start) ?? { x: 0, y: 0 }
		overflow.push(id)
		at.set(id, { x: p.x + 40, y: p.y + 40 })
	}
	const taken = new Set<number>()
	used.forEach((u, i) => u && taken.add(i))
	return { at, cells, used: taken, corridors, overflow }
}

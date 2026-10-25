import { describe, expect, it } from 'vitest'
import { measure, SHOW_ALL, WHOLE_LIFE, WHOLE_LIFE_SKILLS, type ShowAll } from './showAll.fixture'
import { wholeLayout } from './wholeLayout'
import { maze } from './maze'
import { DEFAULT_LAYOUT } from './layoutConfig'
import type { GraphEdge, GraphNode } from './layout'

const lay = (view: ShowAll) => wholeLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, arrows: view.arrows, config: DEFAULT_LAYOUT })

describe('wholeLayout', () => {
	// The four-tree board both ways, and single trees with everything.
	for (const view of [WHOLE_LIFE_SKILLS, WHOLE_LIFE, ...SHOW_ALL]) {
		it(`places all of ${view.name} with nothing covering anything`, () => {
			const at = lay(view)
			expect(at.size).toBe(view.nodes.length)
			expect(measure({ ...view, nodes: view.nodes.filter((n) => n.id !== 'header') }, at).overlaps).toEqual([])
		}, 30000)
	}

	// Big families wrapped round their node: the same, nothing left out or covered.
	for (const view of [WHOLE_LIFE_SKILLS, WHOLE_LIFE]) {
		it(`places all of ${view.name}, big families wrapped, with nothing covering anything`, () => {
			const at = wholeLayout(view.nodes, view.edges, { isSkill: (id) => view.skills.has(id), start: view.start, arrows: view.arrows, config: { ...DEFAULT_LAYOUT, mazeFamilies: 'wrap' } })
			expect(at.size).toBe(view.nodes.length)
			expect(measure({ ...view, nodes: view.nodes.filter((n) => n.id !== 'header') }, at).overlaps).toEqual([])
		}, 30000)
	}

	it('puts the pillars round you clockwise in their order, Physical at the top', () => {
		const at = lay(WHOLE_LIFE_SKILLS)
		const pillars = ['physical', 'mental', 'spiritual', 'practical', 'social'].map((p) => at.get(`mastery/${p}`)!)
		const angles = pillars.map((p) => Math.atan2(p.y, p.x))
		expect(Math.abs(angles[0]! + Math.PI / 2)).toBeLessThan(0.6)
		// Clockwise on screen is the angle growing, once unwrapped from the first.
		const unwrapped = angles.map((a) => (a < angles[0]! ? a + 2 * Math.PI : a))
		expect([...unwrapped].sort((a, b) => a - b)).toEqual(unwrapped)
	}, 30000)

	it('is deterministic', () => {
		expect([...lay(WHOLE_LIFE).values()]).toEqual([...lay(WHOLE_LIFE).values()])
	}, 30000)
})

describe('maze', () => {
	const tree = (view: ShowAll) => {
		const children = new Map<string, string[]>()
		const seen = new Set([view.start])
		for (const e of view.edges)
			if (view.skills.has(e.from) && view.skills.has(e.to) && !seen.has(e.to)) {
				seen.add(e.to)
				children.set(e.from, [...(children.get(e.from) ?? []), e.to])
			}
		const kids = (id: string) => children.get(id) ?? []
		const order = [view.start]
		for (let i = 0; i < order.length; i++) order.push(...kids(order[i]!))
		const w = new Map(view.nodes.map((n) => [n.id, n.w]))
		return { order, kids, radius: (id: string) => w.get(id)! / 2 }
	}

	for (const spacing of [1, 2]) {
		it(`gives every node of the four-tree board a cell, ${spacing} apart along a chain`, () => {
			const { order, kids, radius } = tree(WHOLE_LIFE_SKILLS)
			const m = maze(WHOLE_LIFE_SKILLS.start, order, kids, radius, { grid: 'hex', walk: 'snake', fill: 1.5, spacing, cell: 210, hub: 20 })
			expect(m.overflow).toEqual([])
			expect(m.at.size).toBe(order.length)
		})
	}

	it('never runs two corridors through one cell', () => {
		const { order, kids, radius } = tree(WHOLE_LIFE_SKILLS)
		const m = maze(WHOLE_LIFE_SKILLS.start, order, kids, radius, { grid: 'hex', walk: 'snake', fill: 1.5, spacing: 2, cell: 210, hub: 20 })
		const key = (p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`
		// A corridor's inner cells (not its ends, the nodes) belong to it alone, apart from a family's
		// shared corridor cells (`~n`), which every way through them runs along.
		const owner = new Map<string, string>()
		for (const c of m.corridors)
			for (const p of c.path.slice(1, -1)) {
				const k = key(p)
				expect(owner.get(k) ?? c.from, k).toBe(c.from)
				owner.set(k, c.from)
			}
	})
})

describe('a tree under two pillars', () => {
	/** You, five pillars, `each` small trees on each: the shape of Mastery. */
	function mastery(each: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
		const nodes: GraphNode[] = [{ id: 'you', w: 300, h: 300 }]
		const edges: GraphEdge[] = []
		for (let p = 0; p < 5; p++) {
			nodes.push({ id: `p${p}`, w: 220, h: 220 })
			edges.push({ from: 'you', to: `p${p}` })
			for (let t = 0; t < each; t++) {
				const root = `p${p}t${t}`
				nodes.push({ id: root, w: 150, h: 150 })
				edges.push({ from: `p${p}`, to: root })
				for (let k = 0; k < 3; k++) {
					nodes.push({ id: `${root}k${k}`, w: 150, h: 150 })
					edges.push({ from: root, to: `${root}k${k}` })
				}
			}
		}
		return { nodes, edges }
	}
	const angle = (p: { x: number; y: number }) => Math.atan2(p.y, p.x)
	/** Whether `c` lies on the shorter arc from `a` to `b`. */
	const between = (a: number, b: number, c: number) => {
		const span = (x: number) => ((x % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI
		const ab = span(b - a)
		const ac = span(c - a)
		return Math.sign(ab) === Math.sign(ac) && Math.abs(ac) < Math.abs(ab)
	}

	// With nothing else on the pillars, two that aren't neighbours can come out opposite each other (a
	// pillar's share of the circle is what hangs below it, and the shared tree counts under its first),
	// where neither way round is between; so only neighbours are asked of that board.
	const pairs = (each: number) => [['p1', 'p2'], ['p2', 'p1'], ['p0', 'p4'], ...(each ? [['p1', 'p3']] : [])] as const
	for (const each of [2, 0])
	for (const [a, b] of pairs(each)) {
		it(`is drawn between ${a} and ${b}, whichever it names first (${each} other trees on each pillar)`, () => {
			const { nodes, edges } = mastery(each)
			nodes.push({ id: 'shared', w: 150, h: 150 }, { id: 'sharedk', w: 150, h: 150 })
			edges.push({ from: a, to: 'shared' }, { from: b, to: 'shared' }, { from: 'shared', to: 'sharedk' })
			const at = wholeLayout(nodes, edges, { isSkill: () => true, start: 'you' })
			expect(between(angle(at.get(a)!), angle(at.get(b)!), angle(at.get('shared')!))).toBe(true)
		})
	}
})

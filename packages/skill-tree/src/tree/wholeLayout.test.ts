import { describe, expect, it } from 'vitest'
import { measure, SHOW_ALL, WHOLE_LIFE, WHOLE_LIFE_SKILLS, type ShowAll } from './showAll.fixture'
import { wholeLayout } from './wholeLayout'
import { maze } from './maze'
import { DEFAULT_LAYOUT } from './layoutConfig'

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

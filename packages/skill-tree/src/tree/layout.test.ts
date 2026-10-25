import { describe, expect, it } from 'vitest'
import { layoutGraph, radialTree, type GraphEdge, type GraphNode } from './layout'

const box = (id: string, w = 150, h = 150): GraphNode => ({ id, w, h })

/** A tree shaped like a real one: a root, five branches of uneven size, a few cross-links. */
function sample(): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const nodes = [box('root')]
	const edges: GraphEdge[] = []
	const sizes = [1, 6, 3, 9, 2]
	sizes.forEach((size, b) => {
		nodes.push(box(`b${b}`))
		edges.push({ from: 'root', to: `b${b}` })
		for (let i = 0; i < size; i++) {
			nodes.push(box(`b${b}-${i}`))
			edges.push({ from: i > 2 ? `b${b}-${i - 3}` : `b${b}`, to: `b${b}-${i}` })
		}
	})
	edges.push({ from: 'b1-0', to: 'b3-4' }, { from: 'b2-1', to: 'b3-0' })
	nodes.push(box('header', 280, 72))
	edges.push({ from: 'root', to: 'header' })
	return { nodes, edges }
}

function check(nodes: GraphNode[], edges: GraphEdge[], at: Map<string, { x: number; y: number }>) {
	const placed = nodes.filter((n) => at.has(n.id))
	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			const a = placed[i]!
			const b = placed[j]!
			const pa = at.get(a.id)!
			const pb = at.get(b.id)!
			const overlap = Math.abs(pa.x - pb.x) < (a.w + b.w) / 2 && Math.abs(pa.y - pb.y) < (a.h + b.h) / 2
			expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
		}
	}
	for (const e of edges) {
		const a = at.get(e.from)
		const b = at.get(e.to)
		if (!a || !b || e.to === 'header') continue
		for (const c of placed) {
			if (c.id === e.from || c.id === e.to) continue
			const p = at.get(c.id)!
			const lx = b.x - a.x
			const ly = b.y - a.y
			const t = Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / (lx * lx + ly * ly)))
			const d = Math.hypot(p.x - (a.x + t * lx), p.y - (a.y + t * ly))
			expect(d, `${e.from}→${e.to} runs through ${c.id}`).toBeGreaterThanOrEqual(Math.min(c.w, c.h) / 2)
		}
	}
}

describe('layoutGraph', () => {
	it('leaves no overlaps and no edge through a node', () => {
		const { nodes, edges } = sample()
		const at = layoutGraph(nodes, edges, { clearEdges: (e) => e.to !== 'header' })
		expect(at.size).toBe(nodes.length)
		check(nodes, edges, at)
	})

	it('keeps the root at the origin and children further out than their parent', () => {
		const { nodes, edges } = sample()
		const at = layoutGraph(nodes, edges, { root: 'root' })
		expect(at.get('root')).toEqual({ x: 0, y: 0 })
		const r = (id: string) => Math.hypot(at.get(id)!.x, at.get(id)!.y)
		expect(r('b3-5')).toBeGreaterThan(r('b3-2'))
		expect(r('b3-2')).toBeGreaterThan(r('b3'))
	})

	it('lays out only what depends on the chosen root', () => {
		const { nodes, edges } = sample()
		const at = layoutGraph(nodes, edges, { root: 'b3' })
		expect([...at.keys()].sort()).toEqual(['b3', ...Array.from({ length: 9 }, (_, i) => `b3-${i}`)].sort())
		expect(at.get('b3')).toEqual({ x: 0, y: 0 })
		check(nodes, edges, at)
	})

	it('gives the same picture twice', () => {
		const { nodes, edges } = sample()
		expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes, edges))
	})
})

describe('layoutGraph with obstacles', () => {
	it('keeps clear of boxes already on the board', () => {
		const { nodes, edges } = sample()
		const obstacles = [
			{ x: 400, y: -200, w: 260, h: 90 },
			{ x: -350, y: 300, w: 300, h: 300 },
		]
		const at = layoutGraph(nodes, edges, { root: 'root', obstacles })
		for (const n of nodes) {
			const p = at.get(n.id)!
			for (const o of obstacles) {
				const overlap = Math.abs(p.x - o.x) < (n.w + o.w) / 2 && Math.abs(p.y - o.y) < (n.h + o.h) / 2
				expect(overlap, `${n.id} covers an obstacle`).toBe(false)
			}
		}
	})
})

describe('radialTree', () => {
	it('puts one root in the centre and its children on the first ring', () => {
		const out = radialTree([
			{ id: 'r', parent: '' },
			{ id: 'a', parent: 'r' },
			{ id: 'b', parent: 'r' },
			{ id: 'a1', parent: 'a' },
		])
		expect(out.get('r')!.depth).toBe(0)
		expect(out.get('a')!.depth).toBe(1)
		expect(out.get('a1')!.depth).toBe(2)
		expect(out.get('a')!.angle).not.toBe(out.get('b')!.angle)
	})

	it('gives subtrees arcs in proportion to their leaves', () => {
		const out = radialTree([
			{ id: 'r', parent: '' },
			{ id: 'big', parent: 'r' },
			{ id: 'small', parent: 'r' },
			...['x', 'y', 'z'].map((id) => ({ id, parent: 'big' })),
		])
		// big has three of the four leaves, so its children span three quarters of the circle.
		const angles = ['x', 'y', 'z'].map((id) => out.get(id)!.angle)
		expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo((2 * Math.PI * 3) / 4 - (2 * Math.PI) / 4, 5)
	})

	it('places several roots on the first ring and still places nodes caught in a cycle', () => {
		const out = radialTree([
			{ id: 'a', parent: '' },
			{ id: 'b', parent: '' },
			{ id: 'c', parent: 'd' },
			{ id: 'd', parent: 'c' },
		])
		expect(out.get('a')!.depth).toBe(1)
		expect(out.get('b')!.depth).toBe(1)
		expect(out.size).toBe(4)
	})
})

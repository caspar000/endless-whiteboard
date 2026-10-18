import { atom } from '@lifeboard/canvas'
import type { GraphEdge, GraphNode } from './layout'

/** How a layout came out, for the tuner (tree/LayoutTuner.tsx): what the last layout on this device measured. */
export interface LayoutStats {
	nodes: number
	ms: number
	width: number
	height: number
	/** How much of the bounding box the nodes cover, in percent. */
	fill: number
	/** Pairs of nodes that overlap. */
	overlaps: number
	/** Pairs of arrows between skill nodes that cross each other. */
	arrowCrossings: number
	/** Arrows between skill nodes that pass through a skill node other than their ends. */
	arrowsThroughSkills: number
	/** Arrow lengths between skill nodes, edge to edge. */
	shortestArrow: number
	longestArrow: number
	meanArrow: number
}

export const lastLayoutStats = atom<LayoutStats | null>('lifeboard:skill-tree-layout-stats', null)

type Point = { x: number; y: number }

const isRound = (n: { w: number; h: number }) => Math.abs(n.w - n.h) < 0.5

/** Measures a layout. `arrows` are the arrows between skill nodes; `isSkill` tells skill nodes from entries and works. */
export function measureLayout(
	nodes: readonly GraphNode[],
	at: ReadonlyMap<string, Point>,
	arrows: readonly GraphEdge[],
	isSkill: (id: string) => boolean,
	ms: number
): LayoutStats {
	const placed = nodes.filter((n) => at.has(n.id))
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
	let area = 0
	for (const n of placed) {
		const p = at.get(n.id)!
		minX = Math.min(minX, p.x - n.w / 2)
		maxX = Math.max(maxX, p.x + n.w / 2)
		minY = Math.min(minY, p.y - n.h / 2)
		maxY = Math.max(maxY, p.y + n.h / 2)
		area += isRound(n) ? (Math.PI * n.w * n.w) / 4 : n.w * n.h
	}
	const [width, height] = [Math.max(0, maxX - minX), Math.max(0, maxY - minY)]

	// Overlaps, through a grid so a big board stays quick.
	const cell = 200
	const grid = new Map<string, number[]>()
	placed.forEach((n, i) => {
		const p = at.get(n.id)!
		for (let x = Math.floor((p.x - n.w / 2) / cell); x <= Math.floor((p.x + n.w / 2) / cell); x++)
			for (let y = Math.floor((p.y - n.h / 2) / cell); y <= Math.floor((p.y + n.h / 2) / cell); y++) {
				const k = `${x},${y}`
				grid.set(k, [...(grid.get(k) ?? []), i])
			}
	})
	const pairs = new Set<string>()
	let overlaps = 0
	for (const list of grid.values()) {
		for (let a = 0; a < list.length; a++)
			for (let b = a + 1; b < list.length; b++) {
				const [i, j] = [list[a]!, list[b]!]
				const key = i < j ? `${i}|${j}` : `${j}|${i}`
				if (pairs.has(key)) continue
				pairs.add(key)
				if (overlap(placed[i]!, at.get(placed[i]!.id)!, placed[j]!, at.get(placed[j]!.id)!)) overlaps++
			}
	}

	const size = new Map(nodes.map((n) => [n.id, n]))
	const segments = arrows.filter((e) => at.has(e.from) && at.has(e.to)).map((e) => ({ e, a: at.get(e.from)!, b: at.get(e.to)! }))
	let arrowCrossings = 0
	for (let i = 0; i < segments.length; i++)
		for (let j = i + 1; j < segments.length; j++) {
			const [s, t] = [segments[i]!, segments[j]!]
			// Arrows meeting at a node don't cross.
			if (s.e.from === t.e.from || s.e.from === t.e.to || s.e.to === t.e.from || s.e.to === t.e.to) continue
			if (intersect(s.a, s.b, t.a, t.b)) arrowCrossings++
		}
	const skills = placed.filter((n) => isSkill(n.id))
	let arrowsThroughSkills = 0
	for (const { e, a, b } of segments) {
		const through = skills.some((n) => {
			if (n.id === e.from || n.id === e.to) return false
			const c = at.get(n.id)!
			return distanceToSegment(c, a, b) < n.w / 2
		})
		if (through) arrowsThroughSkills++
	}
	const lengths = segments.map(({ e, a, b }) => Math.max(0, Math.hypot(b.x - a.x, b.y - a.y) - size.get(e.from)!.w / 2 - size.get(e.to)!.w / 2))
	return {
		nodes: placed.length,
		ms: Math.round(ms),
		width: Math.round(width),
		height: Math.round(height),
		fill: width && height ? Math.round((1000 * area) / (width * height)) / 10 : 0,
		overlaps,
		arrowCrossings,
		arrowsThroughSkills,
		shortestArrow: Math.round(lengths.length ? Math.min(...lengths) : 0),
		longestArrow: Math.round(lengths.length ? Math.max(...lengths) : 0),
		meanArrow: Math.round(lengths.length ? lengths.reduce((n, l) => n + l, 0) / lengths.length : 0),
	}
}

function overlap(a: GraphNode, pa: Point, b: GraphNode, pb: Point): boolean {
	if (isRound(a) && isRound(b)) return Math.hypot(pa.x - pb.x, pa.y - pb.y) < a.w / 2 + b.w / 2 - 0.5
	if (isRound(a) || isRound(b)) {
		const [disc, pd, box, px] = isRound(a) ? [a, pa, b, pb] : [b, pb, a, pa]
		return Math.hypot(Math.max(0, Math.abs(pd.x - px.x) - box.w / 2), Math.max(0, Math.abs(pd.y - px.y) - box.h / 2)) < disc.w / 2 - 0.5
	}
	return Math.abs(pa.x - pb.x) < (a.w + b.w) / 2 - 0.5 && Math.abs(pa.y - pb.y) < (a.h + b.h) / 2 - 0.5
}

function distanceToSegment(c: Point, a: Point, b: Point): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
	return Math.hypot(a.x + t * dx - c.x, a.y + t * dy - c.y)
}

function intersect(p: Point, q: Point, r: Point, s: Point): boolean {
	const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
	const d1 = d(r, s, p)
	const d2 = d(r, s, q)
	const d3 = d(p, q, r)
	const d4 = d(p, q, s)
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

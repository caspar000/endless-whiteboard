import adlerYaml from '../../content/adler.yaml?raw'
import directorYaml from '../../content/director.yaml?raw'
import mucoreYaml from '../../content/mucore.yaml?raw'
import { parseSyllabus, type DocItem } from '../syllabusYaml'
import type { TreeDefs } from '../treeDefs'
import { treeGraph, viewContents } from '../views'
import { workAnchor } from './clusters'
import { orientFrom, type GraphEdge, type GraphNode } from './layout'

/**
 * A content file's Show all, as the graph `layoutView` hands to the layout: skill nodes, entries,
 * works and the header, with the same sizes and edges. For measuring layouts in tests.
 */
export interface ShowAll {
	name: string
	nodes: GraphNode[]
	/** Oriented from the start, as `layoutView` builds them. */
	edges: GraphEdge[]
	start: string
	skills: Set<string>
	/** Drawn arrows between skill nodes. */
	arrows: GraphEdge[]
	/** Drawn light lines from a node to an entry or work. */
	lines: GraphEdge[]
}

export const HEADER = 'header'

export function showAll(name: string, source: string): ShowAll {
	const parsed = parseSyllabus(source)
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
	const doc = parsed.doc
	const trees: TreeDefs = Object.fromEntries(
		doc.trees.map((t) => [t.treeId, { ...t, sectors: t.sectors.join(','), rings: t.rings.join(','), removed: [], draft: '' }])
	)
	const items: Record<string, { itemId: string; parent: string; children: string[]; tags: string[] }> = {}
	const add = (item: DocItem, parent: string) => {
		items[item.itemId] = { itemId: item.itemId, parent, children: item.children.map((c) => c.itemId), tags: item.tags }
		for (const c of item.children) add(c, item.itemId)
	}
	for (const track of doc.tracks) for (const item of track.items) add(item, '')
	const graph = treeGraph(trees)
	const view = viewContents(graph, items, { treeId: doc.trees[0]!.treeId, root: '', mode: 'all', focus: '' }, 1)
	const key = (id: string) => `item:${id}`
	const inView = (id: string) => view.skills.has(id)
	const arrows = [...graph.prerequisites, ...graph.mounts].filter((e) => inView(e.from) && inView(e.to))
	const loose = graph.loose.filter((e) => inView(e.from) && inView(e.to))
	const lines = [...view.items].map(([id, at]) => ({ from: at.variant === 'entry' ? at.parent : key(at.parent), to: key(id) }))
	const edges = orientFrom(view.start, [...arrows, ...loose, ...lines])
	edges.push({ from: view.start, to: HEADER })
	const nodes: GraphNode[] = [
		...[...view.skills].map((id) => ({ id, w: 150, h: 150 })),
		...[...view.items].map(([id, at]) => (at.variant === 'work' ? { id: key(id), w: 180, h: 26 } : { id: key(id), w: 110, h: 110 })),
		{ id: HEADER, w: 280, h: 72 },
	]
	return { name, nodes, edges, start: view.start, skills: view.skills, arrows, lines }
}

export const SHOW_ALL = [showAll('adler', adlerYaml), showAll('director', directorYaml), showAll('mucore', mucoreYaml)]

type Point = { x: number; y: number }

const round = (n: GraphNode) => n.w === n.h

function gapBetween(a: GraphNode, pa: Point, b: GraphNode, pb: Point): number {
	if (round(a) && round(b)) return Math.hypot(pa.x - pb.x, pa.y - pb.y) - a.w / 2 - b.w / 2
	if (round(a) || round(b)) {
		const [disc, pd, box, pbox] = round(a) ? [a, pa, b, pb] : [b, pb, a, pa]
		const ox = Math.max(0, Math.abs(pd.x - pbox.x) - box.w / 2)
		const oy = Math.max(0, Math.abs(pd.y - pbox.y) - box.h / 2)
		return Math.hypot(ox, oy) - disc.w / 2
	}
	const dx = Math.abs(pa.x - pb.x) - (a.w + b.w) / 2
	const dy = Math.abs(pa.y - pb.y) - (a.h + b.h) / 2
	return Math.max(dx, dy)
}

/** Does the segment p→q pass through node n at c? Circles exactly; boxes by sampling. */
function through(p: Point, q: Point, n: GraphNode, c: Point): boolean {
	for (let i = 1; i < 64; i++) {
		const t = i / 64
		const x = p.x + (q.x - p.x) * t
		const y = p.y + (q.y - p.y) * t
		if (round(n) ? Math.hypot(x - c.x, y - c.y) < n.w / 2 : Math.abs(x - c.x) < n.w / 2 && Math.abs(y - c.y) < n.h / 2) return true
	}
	return false
}

export interface Measure {
	overlaps: string[]
	/** A light line passing through a node that isn't one of its ends. */
	linesThrough: number
	/** An arrow between skill nodes passing through a node that isn't one of its ends. */
	arrowsThrough: number
	width: number
	height: number
	/** How much of the bounding box the nodes cover, in percent. */
	fill: number
}

export function measure(view: ShowAll, at: ReadonlyMap<string, Point>): Measure {
	const nodes = view.nodes.filter((n) => at.has(n.id))
	const overlaps: string[] = []
	for (let i = 0; i < nodes.length; i++)
		for (let j = i + 1; j < nodes.length; j++)
			if (gapBetween(nodes[i]!, at.get(nodes[i]!.id)!, nodes[j]!, at.get(nodes[j]!.id)!) < 0) overlaps.push(`${nodes[i]!.id} × ${nodes[j]!.id}`)
	const count = (edges: GraphEdge[]) => {
		let n = 0
		for (const e of edges) {
			const p = at.get(e.from)
			const c = at.get(e.to)
			if (!p || !c) continue
			// A line to a work ends where the app anchors it, at the work's nearer end.
			const to = view.nodes.find((n) => n.id === e.to)!
			const q = round(to) ? c : { x: c.x + (workAnchor({ ...c, w: to.w, h: to.h }, p).x - 0.5) * to.w, y: c.y }
			for (const node of nodes) if (node.id !== e.from && node.id !== e.to && through(p, q, node, at.get(node.id)!)) n++
		}
		return n
	}
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
	let area = 0
	for (const n of nodes) {
		const p = at.get(n.id)!
		minX = Math.min(minX, p.x - n.w / 2)
		maxX = Math.max(maxX, p.x + n.w / 2)
		minY = Math.min(minY, p.y - n.h / 2)
		maxY = Math.max(maxY, p.y + n.h / 2)
		area += round(n) ? (Math.PI * n.w * n.w) / 4 : n.w * n.h
	}
	const [width, height] = [maxX - minX, maxY - minY]
	return { overlaps, linesThrough: count(view.lines), arrowsThrough: count(view.arrows), width: Math.round(width), height: Math.round(height), fill: Math.round((1000 * area) / (width * height)) / 10 }
}

import adlerYaml from '../../content/adler.yaml?raw'
import directorYaml from '../../content/director.yaml?raw'
import mucoreYaml from '../../content/mucore.yaml?raw'
import lifeYaml from '../../content/whole-life-test.yaml?raw'
import filmYaml from '../../content/film.yaml?raw'
import theatreYaml from '../../content/theatre.yaml?raw'
import { parseSyllabus, type DocItem } from '../syllabusYaml'
import type { TreeDefs } from '../treeDefs'
import { treeGraph, viewContents } from '../views'
import { orientFrom, type GraphEdge, type GraphNode } from './layout'
import { lineEnds } from './lines'
import { sizeOfKind } from '../skill/definition'

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
	/** Drawn light lines: a spoke from a skill node to each entry, and a chain through each entry's works. */
	lines: GraphEdge[]
}

export const HEADER = 'header'

export function showAll(name: string, source: string): ShowAll {
	return showView(name, [source], '', 'all')
}

/**
 * Several documents in one vault, viewed from one tree: `mounts` hang trees on nodes the way the
 * whole-life test board does. `mode` is `all` or `overview`.
 */
export function showView(
	name: string,
	sources: readonly string[],
	treeId: string,
	mode: 'all' | 'overview',
	mounts: Record<string, string> = {},
	keep: (treeId: string) => boolean = () => true
): ShowAll {
	const docs = sources.map((source) => {
		const parsed = parseSyllabus(source)
		if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
		return parsed.doc
	})
	const trees: TreeDefs = Object.fromEntries(
		docs.flatMap((doc) => doc.trees).filter((t) => keep(t.treeId)).map((t) => [t.treeId, { ...t, mount: mounts[t.treeId] ?? t.mount, sectors: t.sectors.join(','), rings: t.rings.join(','), removed: [], draft: '' }])
	)
	const items: Record<string, { itemId: string; parent: string; children: string[]; tags: string[] }> = {}
	const add = (item: DocItem, parent: string) => {
		items[item.itemId] = { itemId: item.itemId, parent, children: item.children.map((c) => c.itemId), tags: item.tags }
		for (const c of item.children) add(c, item.itemId)
	}
	for (const doc of docs) for (const track of doc.tracks) for (const item of track.items) add(item, '')
	const graph = treeGraph(trees)
	const view = viewContents(graph, items, { treeId: treeId || docs[0]!.trees[0]!.treeId, root: '', mode })
	const key = (id: string) => `item:${id}`
	const inView = (id: string) => view.skills.has(id)
	const arrows = [...graph.prerequisites, ...graph.mounts].filter((e) => inView(e.from) && inView(e.to))
	const loose = graph.loose.filter((e) => inView(e.from) && inView(e.to))
	// What hangs from what, for the layout; and the lines drawn, a chain through each entry's works.
	const hangs = [...view.items].map(([id, at]) => ({ from: at.variant === 'entry' ? at.parent : key(at.parent), to: key(id) }))
	const lines = lineEnds(view.items)
	const edges = orientFrom(view.start, [...arrows, ...loose, ...hangs])
	edges.push({ from: view.start, to: HEADER })
	const nodes: GraphNode[] = [
		...[...view.skills].map((id) => ({ id, w: sizeOfKind(graph.nodes.get(id)!.def.kind), h: sizeOfKind(graph.nodes.get(id)!.def.kind) })),
		...[...view.items].map(([id, at]) => (at.variant === 'work' ? { id: key(id), w: 120, h: 100 } : { id: key(id), w: 110, h: 110 })),
		{ id: HEADER, w: 280, h: 72 },
	]
	return { name, nodes, edges, start: view.start, skills: view.skills, arrows, lines }
}

const LIFE_MOUNTS = { adler: 'mastery/mental', director: 'mastery/practical' }
/** The whole-life test board: you, the pillars, the test trees, Adler on Mental and Director on Practical. */
export const WHOLE_LIFE = showView('whole-life', [lifeYaml, adlerYaml, directorYaml], 'mastery', 'all', LIFE_MOUNTS)
/** The test board as the dev command now makes it: you, the pillars, Adler, Film and Theatre. */
export const ADLER_LIFE = showView('adler-life', [lifeYaml, adlerYaml, filmYaml, theatreYaml], 'mastery', 'all', { ...LIFE_MOUNTS, film: 'mastery/practical', theatre: 'mastery/practical' }, (t) =>
	['mastery', 'adler', 'film', 'theatre'].includes(t)
)
/** The same in the skill-node view. */
export const WHOLE_LIFE_SKILLS = showView('whole-life-skills', [lifeYaml, adlerYaml, directorYaml], 'mastery', 'overview', LIFE_MOUNTS)

export const SHOW_ALL = [showAll('adler', adlerYaml), showAll('director', directorYaml), showAll('mucore', mucoreYaml)]

type Point = { x: number; y: number }

const round = (n: GraphNode) => Math.abs(n.w - n.h) < 0.5

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
			const q = at.get(e.to)
			if (!p || !q) continue
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

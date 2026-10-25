import adlerYaml from '../../../../syllabi/adler.yaml?raw'
import mucoreYaml from '../../../../syllabi/mucore.yaml?raw'
import filmYaml from '../../../../syllabi/film.yaml?raw'
import theatreYaml from '../../../../syllabi/theatre.yaml?raw'
import gamesYaml from '../../../../syllabi/games.yaml?raw'
import lifeYaml from '../../../syllabus/fixtures/whole-life-test.yaml?raw'
import { parse as parseYaml } from 'yaml'
import { registerTreeSource } from '../sources'
import { firstTreeId, isMap, list, parseTrees, qualify, slug, text, type DocTree } from '../treeYaml'
import type { TreeDefs } from '../treeDefs'
import { treeGraph, viewContents } from '../views'
import { orientFrom, type GraphEdge, type GraphNode } from './layout'
import { lineEnds } from './lines'
import { sizeOfKind } from '../skill/definition'

/*
 * The syllabi's trees name `item:` and `count:`, which the syllabus teaches trees (it is a source,
 * sources.ts). The layout only follows prerequisites, so a stand-in that accepts both is enough here.
 */
const anything = (key: string) => ({ key, parse: (value: unknown) => ({ ok: true as const, value }), evaluate: () => ({ label: key, have: 0, need: 1, met: false }) })
registerTreeSource({ id: 'test:syllabus-kinds', requirements: [anything('item'), anything('count')] })

type Item = { itemId: string; parent: string; children: string[]; tags: string[] }

/**
 * A syllabus document's trees, and its entries and works as a tree view sees them. Ids are qualified
 * the way the syllabus's parser does it (an entry gets the goal, a work its entry, a tag the first
 * tree); only what the layout needs is read.
 */
function readDoc(source: string): { trees: DocTree[]; items: Item[] } {
	const raw = parseYaml(source) as Record<string, unknown>
	const goal = slug(text(raw.goal))
	const errors: string[] = []
	const trees = parseTrees(raw, goal, errors)
	if (errors.length) throw new Error(errors.join('\n'))
	const treeId = firstTreeId(raw, goal)
	const items: Item[] = []
	const walk = (value: unknown, prefix: string, parent: string): string | null => {
		if (!isMap(value)) return null
		const itemId = qualify(prefix, slug(text(value.id) || text(value.title)))
		const item: Item = { itemId, parent, children: [], tags: list(value.tags).map((t) => qualify(treeId, slug(t))) }
		items.push(item)
		for (const child of Array.isArray(value.children) ? value.children : []) {
			const id = walk(child, itemId, itemId)
			if (id) item.children.push(id)
		}
		return itemId
	}
	for (const track of Array.isArray(raw.tracks) ? raw.tracks : []) {
		for (const entry of isMap(track) && Array.isArray(track.items) ? track.items : []) walk(entry, goal, '')
	}
	return { trees, items }
}

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
	const docs = sources.map(readDoc)
	const trees: TreeDefs = Object.fromEntries(
		docs.flatMap((doc) => doc.trees).filter((t) => keep(t.treeId)).map((t) => [t.treeId, { ...t, mounts: mounts[t.treeId] ? [mounts[t.treeId]!] : t.mounts, sectors: t.sectors.join(','), rings: t.rings.join(','), removed: [], draft: '', ticked: {} }])
	)
	const items = Object.fromEntries(docs.flatMap((doc) => doc.items).map((item) => [item.itemId, item]))
	const graph = treeGraph(trees)
	const view = viewContents(graph, items, { treeId: treeId || docs[0]!.trees[0]!.treeId, root: '', mode })
	const key = (id: string) => `item:${id}`
	const inView = (id: string) => view.skills.has(id)
	const arrows = [...graph.prerequisites, ...graph.mounts].filter((e) => inView(e.from) && inView(e.to))
	const loose = graph.loose.filter((e) => inView(e.from) && inView(e.to))
	// The lines drawn: a spoke to each entry, a chain through each entry's works.
	const lines = lineEnds(view.items)
	// The layout grows along what is drawn, as the board's does (viewSync.ts).
	const edges = orientFrom(view.start, [...arrows, ...loose, ...lines])
	edges.push({ from: view.start, to: HEADER })
	const nodes: GraphNode[] = [
		...[...view.skills].map((id) => ({ id, w: sizeOfKind(graph.nodes.get(id)!.def.kind), h: sizeOfKind(graph.nodes.get(id)!.def.kind) })),
		...[...view.items].map(([id, at]) => (at.variant === 'work' ? { id: key(id), w: 120, h: 100 } : { id: key(id), w: 110, h: 110 })),
		{ id: HEADER, w: 280, h: 72 },
	]
	return { name, nodes, edges, start: view.start, skills: view.skills, arrows, lines }
}

const LIFE_MOUNTS = { adler: 'mastery/mental', film: 'mastery/practical', theatre: 'mastery/practical', games: 'mastery/practical' }
const LIFE_TREES = ['mastery', ...Object.keys(LIFE_MOUNTS)]
/** The whole-life test board (tree/wholeLifeTest.ts): you, the pillars, Adler on Mental, and Film, Theatre and Games on Practical. */
export const WHOLE_LIFE = showView('whole-life', [lifeYaml, adlerYaml, filmYaml, theatreYaml, gamesYaml], 'mastery', 'all', LIFE_MOUNTS, (t) => LIFE_TREES.includes(t))
/** The same in the skill-node view. */
export const WHOLE_LIFE_SKILLS = showView('whole-life-skills', [lifeYaml, adlerYaml, filmYaml, theatreYaml, gamesYaml], 'mastery', 'overview', LIFE_MOUNTS, (t) => LIFE_TREES.includes(t))

export const SHOW_ALL = [showAll('adler', adlerYaml), showAll('mucore', mucoreYaml)]

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

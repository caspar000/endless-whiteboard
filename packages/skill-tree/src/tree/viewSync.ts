import { connectShapes } from '@lifeboard/node-kit'
import { ARROW_STAYS_BEHIND_META, atom, Box, createShapeId, getArrowWaypoints, WAYPOINTS_META, type Atom, type Editor, type TLArrowBinding, type TLArrowShape, type TLShape, type TLShapeId } from '@lifeboard/canvas'
import { ENTRY_TYPE, isEntry, isSkill, isTree, SKILL_TYPE, TREE_TYPE, type EntryShape, type SkillShape, type TreeShape } from '../board'
import { ENTRY_SIZE, WORK_ANCHOR, WORK_DISC, WORK_SIZE } from '../entry/definition'
import { getItem } from '../syllabus'
import { arcBend, itemKey, lineEnds } from './lines'
import { orbitCluster } from './orbits'
import { getLayoutConfig } from './layoutConfig'
import { SKILL_SIZE, sizeOfKind } from '../skill/definition'
import type { NodeDef } from '../treeDefs'
import { boardTrees, reachFrom, treeGraph, viewStart, type TreeGraph, type ViewContents } from '../views'
import { getTreePrefs } from '../treePrefs'
import { contentsOf } from './view'
import { wholeLayout } from './wholeLayout'
import { layoutGraph, orientFrom, type GraphEdge, type GraphNode } from './layout'
import { nodeShapes, SKILL_EDGE_META } from './ops'
import { curveArrows } from './curveArrows'
import { forgetMazeRoutes, takeMazeGrid, takeMazeRoutes } from './maze'
import { lastMazeGrid } from './MazeGuides'

/**
 * Turning each tree view's contents (views.ts) into the board (docs/skill-tree-plan.md, "Rebuild").
 * Runs inside the sync's `editor.run` with history ignored: following a view is not something the
 * user did, and their ⌘Z must not undo it.
 *
 * Each arrangement of a view (the overview, everything) remembers where its
 * nodes were, on the header (`places`). Switching arrangement saves the one you leave and puts the
 * one you enter back; what has never been placed is laid out, the whole view the first time, beside
 * its nearest neighbour after that.
 */

/** Meta on a header: the arrangement the board last showed for it. */
const CONTEXT_META = 'lifeboard:viewContext'
/** Meta on the light lines from a skill node to an entry and from an entry to its works. */
export const LINE = 'line'

type Places = Record<string, Record<string, [number, number]>>

function readPlaces(header: TreeShape): Places {
	try {
		const raw = JSON.parse(header.props.places || '{}') as unknown
		return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Places) : {}
	} catch {
		return {}
	}
}

/** Graph ids for layout: skill nodes by node id, items prefixed, since /mu/core gives a family and its node the same id. */

/** The entry and work shapes on this board, by item id. */
export function entryShapes(editor: Editor): Map<string, EntryShape> {
	const out = new Map<string, EntryShape>()
	for (const s of editor.getCurrentPageShapes()) if (isEntry(s)) out.set(s.props.itemId, s)
	return out
}

interface HeaderView {
	header: TreeShape
	view: ViewContents
	/** The arrangement the board showed last, when it was a different one. */
	from: string | null
	/** The board has not recorded an arrangement for this header yet; it records the current one. */
	unmarked: boolean
}

export interface ViewPlan {
	views: HeaderView[]
	createSkills: { treeId: string; def: NodeDef }[]
	createItems: { itemId: string; treeId: string; variant: 'entry' | 'work' }[]
	remove: TLShape[]
	trees: Set<string>
	mountsStale: boolean
	linesStale: boolean
}

export const planIsEmpty = (p: ViewPlan) =>
	!p.createSkills.length &&
	!p.createItems.length &&
	!p.remove.length &&
	!p.mountsStale &&
	!p.linesStale &&
	!p.views.some((v) => v.from !== null || v.unmarked)

/** What the board's views want changed. A board without headers has no views and is left alone. */
export function planViews(editor: Editor, headers: readonly TreeShape[], going: ReadonlySet<string>): ViewPlan {
	const plan: ViewPlan = { views: [], createSkills: [], createItems: [], remove: [], trees: new Set(), mountsStale: false, linesStale: false }
	// Entries only exist inside a view: with no header left (a discarded draft, a deleted header), they go.
	if (!headers.length) {
		plan.remove = [...entryShapes(editor).values()]
		plan.linesStale = linesDrawn(editor).length > 0
		return plan
	}
	const graph = treeGraph(boardTrees(editor))
	const skills = new Map([...nodeShapes(editor)].filter(([, s]) => !going.has(s.id)))
	const entries = entryShapes(editor)
	const wantSkills = new Set<string>()
	const wantItems = new Map<string, { treeId: string; variant: 'entry' | 'work'; parent: string }>()
	const covered = new Set<string>()
	for (const header of headers) {
		const view = contentsOf(editor, header)
		const last = header.meta[CONTEXT_META]
		// Recorded as soon as there is a view, so that leaving it, even the first time, saves where things were.
		plan.views.push({ header, view, from: typeof last === 'string' && last !== view.context ? last : null, unmarked: typeof last !== 'string' })
		for (const id of view.skills) wantSkills.add(id)
		for (const [id, at] of view.items) wantItems.set(id, { treeId: header.props.treeId, ...at })
		covered.add(header.props.treeId)
		for (const id of reachFrom(graph, viewStart(graph, header.props))) covered.add(graph.nodes.get(id)!.treeId)
	}
	for (const id of wantSkills) {
		if (skills.has(id)) continue
		const node = graph.nodes.get(id)!
		plan.createSkills.push({ treeId: node.treeId, def: node.def })
		plan.trees.add(node.treeId)
	}
	for (const [id, want] of wantItems) if (!entries.has(id)) plan.createItems.push({ itemId: id, treeId: want.treeId, variant: want.variant })
	for (const shape of skills.values()) {
		if (shape.meta['lifeboard:skillDraft'] || wantSkills.has(shape.props.nodeId) || !covered.has(shape.props.treeId)) continue
		plan.remove.push(shape)
		plan.trees.add(shape.props.treeId)
	}
	for (const shape of entries.values()) if (!wantItems.has(shape.props.itemId)) plan.remove.push(shape)

	const leaving = new Set(plan.remove.map((s) => s.id))
	const staying = (id: string) => (skills.has(id) && !leaving.has(skills.get(id)!.id)) || wantSkills.has(id)
	const want = graph.mounts.filter((m) => staying(m.from) && staying(m.to)).map((m) => `${m.from}>${m.to}`).sort()
	plan.mountsStale = want.join() !== mountArrows(editor).join()
	plan.linesStale = linesWanted(wantItems, wantSkills).join() !== linesDrawn(editor).join()
	return plan
}

/**
 * Puts the plan on the board. Call inside an `editor.run` with history ignored. Returns the views it
 * laid out whole because they were new to the board, for the camera to go to.
 */
export function applyViews(editor: Editor, plan: ViewPlan): ViewContents[] {
	const laidOutNew: ViewContents[] = []
	const graph = treeGraph(boardTrees(editor))
	const headerUpdates = new Map<TLShapeId, Places>()
	// 1. Leaving an arrangement: remember where everything in it was.
	for (const { header, from } of plan.views) {
		if (from === null) continue
		const places = readPlaces(header)
		places[from] = snapshot(editor, header, graph)
		headerUpdates.set(header.id, places)
	}
	if (plan.remove.length) editor.deleteShapes(plan.remove.map((s) => s.id))

	// 2. New shapes, at their header for now.
	const created = new Set<string>()
	const near = (treeId: string) => {
		const header = plan.views.find((v) => v.header.props.treeId === treeId)?.header ?? plan.views[0]?.header
		const b = header && editor.getShapePageBounds(header.id)
		return { x: b?.center.x ?? 0, y: (b?.maxY ?? 0) + 200 }
	}
	editor.createShapes([
		...plan.createSkills.map(({ treeId, def }) => {
			created.add(def.nodeId)
			const { nodeId, draft, ...rest } = def
			void draft
			const at = near(treeId)
			const size = sizeOfKind(rest.kind)
			return { id: createShapeId(), type: SKILL_TYPE, parentId: editor.getCurrentPageId(), x: at.x - size / 2, y: at.y - size / 2, props: { ...rest, nodeId, treeId, w: size, h: size } }
		}),
		...plan.createItems.map(({ itemId, treeId, variant }) => {
			created.add(itemKey(itemId))
			const size = variant === 'work' ? WORK_SIZE : ENTRY_SIZE
			const at = near(treeId)
			return { id: createShapeId(), type: ENTRY_TYPE, parentId: editor.getCurrentPageId(), x: at.x - size.w / 2, y: at.y - size.h / 2, props: { itemId, treeId, variant, w: size.w, h: size.h } }
		}),
	] as never)

	// 3. Each view's arrangement: remembered places first, then whatever is still unplaced.
	for (const { header, view, from } of plan.views) {
		const places = headerUpdates.get(header.id) ?? readPlaces(header)
		const remembered = places[view.context] ?? {}
		const shapes = viewShapes(editor, view)
		const moves: { id: TLShapeId; type: string; x: number; y: number }[] = []
		const unplaced: string[] = []
		for (const [key, shape] of shapes) {
			const at = remembered[key]
			if (at && (from !== null || created.has(key))) moves.push({ id: shape.id, type: shape.type, x: at[0], y: at[1] })
			else if (!at && created.has(key)) unplaced.push(key)
		}
		if (moves.length) editor.updateShapes(moves as never)
		// An arrangement never seen before, or one that is mostly new, is laid out whole.
		const fresh = from !== null && !Object.keys(remembered).length
		if (fresh || (unplaced.length && unplaced.length > shapes.size / 2)) {
			layoutView(editor, header, view, null)
			if (unplaced.length === shapes.size) laidOutNew.push(view)
		}
		else if (unplaced.length) {
			// New entries and works: only their own cluster is laid out again. New skill nodes go beside
			// their neighbour for now, and the view's skeleton is out of date until Re-calculate.
			const items = unplaced.filter((k) => k.startsWith('item:'))
			const skills = new Set(unplaced.filter((k) => !k.startsWith('item:')))
			if (skills.size) placeNew(editor, view, skills)
			const grew = repackClusters(editor, view, new Set(items.map((k) => skillOf(view, k.slice('item:'.length))).filter((s) => !!s)))
			if (grew) editor.updateShape({ id: header.id, type: TREE_TYPE, meta: { [LAYOUT_STALE]: true } } as never)
		}
		const context = view.context
		if (header.meta[CONTEXT_META] !== context || headerUpdates.has(header.id)) {
			editor.updateShape({ id: header.id, type: TREE_TYPE, meta: { [CONTEXT_META]: context }, props: { places: JSON.stringify(places) } } as never)
		}
	}
	if (plan.linesStale) {
		drawLines(editor, plan)
		tidyLines(editor)
	}
	return laidOutNew
}

/** Where every shape of this header's tree is now, by layout key. */
function snapshot(editor: Editor, header: TreeShape, graph: TreeGraph): Record<string, [number, number]> {
	const trees = new Set([header.props.treeId, ...[...reachFrom(graph, viewStart(graph, header.props))].map((id) => graph.nodes.get(id)!.treeId)])
	const out: Record<string, [number, number]> = {}
	for (const s of editor.getCurrentPageShapes()) {
		if (isSkill(s) && trees.has(s.props.treeId)) out[s.props.nodeId] = [Math.round(s.x), Math.round(s.y)]
		else if (isEntry(s) && s.props.treeId === header.props.treeId) out[itemKey(s.props.itemId)] = [Math.round(s.x), Math.round(s.y)]
	}
	return out
}

/** The shapes a view shows, by layout key. */
export function viewShapes(editor: Editor, view: ViewContents): Map<string, SkillShape | EntryShape> {
	const out = new Map<string, SkillShape | EntryShape>()
	const skills = nodeShapes(editor)
	for (const id of view.skills) {
		const s = skills.get(id)
		if (s) out.set(id, s)
	}
	const entries = entryShapes(editor)
	for (const id of view.items.keys()) {
		const s = entries.get(id)
		if (s) out.set(itemKey(id), s)
	}
	return out
}

/** A view as a graph: skill edges among its nodes, and the line from each item to what it hangs from. */
function viewGraph(editor: Editor, view: ViewContents) {
	const graph = treeGraph(boardTrees(editor))
	const inView = (id: string) => view.skills.has(id)
	const drawn: GraphEdge[] = [...graph.prerequisites, ...graph.mounts].filter((e) => inView(e.from) && inView(e.to))
	const loose = graph.loose.filter((e) => inView(e.from) && inView(e.to))
	const lines: GraphEdge[] = [...view.items].map(([id, at]) => ({ from: at.variant === 'entry' ? at.parent : itemKey(at.parent), to: itemKey(id) }))
	return { drawn, loose, lines }
}

/** A view's edges, each pointing away from its start: what a branch is. */
export function viewEdges(editor: Editor, view: ViewContents): GraphEdge[] {
	const startKey = view.items.has(view.start) ? itemKey(view.start) : view.start
	const { drawn, loose, lines } = viewGraph(editor, view)
	return orientFrom(startKey, [...drawn, ...loose, ...lines])
}

/**
 * Lays a whole view out around its start (the view's root), which stays where it is. Other shapes
 * on the board are not worked around: the tree is one disc (docs/skill-tree-layout-plan.md).
 * `label` names the undo step; `null` inside a sync.
 */
export function layoutView(editor: Editor, header: TreeShape, view: ViewContents, label: string | null): number {
	const shapes = viewShapes(editor, view)
	const startKey = view.items.has(view.start) ? itemKey(view.start) : view.start
	const startShape = shapes.get(startKey)
	if (!startShape) return 0
	const { drawn, loose } = viewGraph(editor, view)
	// The maze grows along what is drawn: the arrows, and the light lines (a spoke to each entry, a
	// chain through its works).
	const edges = orientFrom(startKey, [...drawn, ...loose, ...lineEnds(view.items)])
	const nodes: GraphNode[] = [...shapes].map(([key, s]) => {
		const b = editor.getShapePageBounds(s.id)
		return { id: key, w: b?.w ?? SKILL_SIZE, h: b?.h ?? SKILL_SIZE }
	})
	const anchor = editor.getShapePageBounds(startShape.id)?.center ?? { x: 0, y: 0 }
	// A drawn header is laid out with the view, hung from its start like a leaf, so it lands clear of
	// it. A hidden one (the default) takes no room.
	const HEADER = 'header'
	const hb = getTreePrefs().showHeaders ? editor.getShapePageBounds(header.id) : undefined
	if (hb) {
		nodes.push({ id: HEADER, w: hb.w, h: hb.h })
		edges.push({ from: startKey, to: HEADER })
	}
	// Both views, everything and the skill nodes alone, are the whole-life layout (the maze) from the
	// view's start.
	const isSkill = (id: string) => view.skills.has(id)
	forgetMazeRoutes()
	const at = wholeLayout(nodes, edges, { isSkill, start: startKey, arrows: drawn, config: getLayoutConfig() })
	const routes = takeMazeRoutes()
	const grid = takeMazeGrid()
	lastMazeGrid.set(grid ? { ...grid, start: startShape.id } : null)
	const keys = [...shapes, ...(hb ? ([[HEADER, header]] as const) : [])]
	const movesTo = (at: ReadonlyMap<string, { x: number; y: number }>, from: { x: number; y: number }) =>
		keys.flatMap(([key, s]) => {
			const p = at.get(key)
			const b = editor.getShape(s.id) && editor.getShapePageBounds(s.id)
			return p && b ? [{ id: s.id, type: s.type, x: from.x + p.x - b.w / 2, y: from.y + p.y - b.h / 2 }] : []
		})
	const moves = movesTo(at, anchor)
	editor.run(() => {
		if (label) editor.markHistoryStoppingPoint(label)
		editor.updateShapes(moves as never)
		laidOut.set(header.id, { routes, start: startShape.id })
		routeArrows(editor, shapes, routes, anchor)
		tidyLines(editor)
		editor.updateShape({ id: header.id, type: TREE_TYPE, meta: { [LAYOUT_OF]: structureOf(editor, view), [LAYOUT_STALE]: false } } as never)
	})
	return moves.length
}

/** Each view's corridors from its last layout (by header), and the shape it grew from. */
const laidOut = new Map<TLShapeId, { routes: ReadonlyMap<string, readonly { x: number; y: number }[]> | null; start: TLShapeId }>()

/**
 * Every view's corridors onto its arrows and light lines again: a sync lays a view out before it
 * draws the arrows, so the ones drawn after get their corridors here.
 */
export function routeLaidOut(editor: Editor): void {
	for (const [id, { routes, start }] of laidOut) {
		const header = editor.getShape(id) as TreeShape | undefined
		const centre = editor.getShape(start) && editor.getShapePageBounds(start)?.center
		if (!header || !centre) {
			laidOut.delete(id)
			continue
		}
		routeArrows(editor, viewShapes(editor, contentsOf(editor, header)), routes, centre)
	}
}

/**
 * The maze's corridors onto the view's arrows and light lines (canvas: arrows with waypoints): each
 * one between a parent and its child runs along the corridor between them. Without a maze (`routes`
 * null), or for an arrow the maze has no corridor for, the waypoints are cleared.
 */
function routeArrows(editor: Editor, shapes: ReadonlyMap<string, TLShape>, routes: ReadonlyMap<string, readonly { x: number; y: number }[]> | null, anchor: { x: number; y: number }): void {
	const keyOf = new Map([...shapes].map(([key, s]) => [s.id as string, key]))
	const changes: { id: TLShapeId; type: 'arrow'; meta: Record<string, unknown> }[] = []
	for (const arrow of editor.getCurrentPageShapes()) {
		if (arrow.type !== 'arrow' || !arrow.meta[SKILL_EDGE_META]) continue
		const ends = editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow')
		const from = keyOf.get(ends.find((b) => b.props.terminal === 'start')?.toId as string)
		const to = keyOf.get(ends.find((b) => b.props.terminal === 'end')?.toId as string)
		if (from === undefined || to === undefined) continue
		const forward = routes?.get(`${from} ${to}`)
		const back = routes?.get(`${to} ${from}`)
		const path = forward ?? (back ? [...back].reverse() : undefined)
		const waypoints =
			path && path.length > 2 ? path.slice(1, -1).map((p) => editor.getPointInShapeSpace(arrow, { x: anchor.x + p.x, y: anchor.y + p.y })).map(({ x, y }) => ({ x, y })) : null
		const now = getArrowWaypoints(arrow as TLArrowShape)
		if (!waypoints && !now.length) continue
		if (waypoints && now.length === waypoints.length && now.every((p, i) => Math.abs(p.x - waypoints[i]!.x) < 0.5 && Math.abs(p.y - waypoints[i]!.y) < 0.5)) continue
		changes.push({ id: arrow.id, type: 'arrow', meta: { [WAYPOINTS_META]: waypoints } })
	}
	if (changes.length) editor.updateShapes(changes as never)
}


/**
 * Places nodes new to an arrangement beside their nearest placed neighbour: laid out as their own
 * little tree around it, then slid outward until they cover nothing.
 */
function placeNew(editor: Editor, view: ViewContents, created: ReadonlySet<string>): void {
	const shapes = viewShapes(editor, view)
	const { drawn, loose, lines } = viewGraph(editor, view)
	const all = [...drawn, ...loose, ...lines]
	const parents = new Map<string, string[]>()
	for (const e of all) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from])
	const anchorOf = (id: string): string => {
		const seen = new Set([id])
		const queue = [id]
		for (let i = 0; i < queue.length; i++) {
			for (const p of parents.get(queue[i]!) ?? []) {
				if (seen.has(p) || !shapes.has(p)) continue
				if (!created.has(p)) return p
				seen.add(p)
				queue.push(p)
			}
		}
		return ''
	}
	const groups = new Map<string, string[]>()
	for (const id of created) {
		const a = anchorOf(id)
		if (a) groups.set(a, [...(groups.get(a) ?? []), id])
	}
	const middle = (() => {
		const settled = [...shapes].filter(([k]) => !created.has(k)).map(([, s]) => editor.getShapePageBounds(s.id)!.center)
		if (!settled.length) return { x: 0, y: 0 }
		return { x: settled.reduce((n, p) => n + p.x, 0) / settled.length, y: settled.reduce((n, p) => n + p.y, 0) / settled.length }
	})()
	const pad = 20
	for (const [ancestor, group] of groups) {
		const ids = new Set([ancestor, ...group])
		const edges = all.filter((e) => ids.has(e.from) && ids.has(e.to))
		const nodes = [...ids].map((id) => {
			const b = editor.getShapePageBounds(shapes.get(id)!.id)!
			return { id, w: b.w, h: b.h }
		})
		const anchor = editor.getShapePageBounds(shapes.get(ancestor)!.id)!.center
		const at = layoutGraph(nodes, edges, { root: ancestor, gap: 40 })
		const groupIds = new Set(group.map((id) => shapes.get(id)!.id))
		const obstacles = editor.getCurrentPageShapes().flatMap((s) => {
			if (groupIds.has(s.id) || s.type === 'arrow' || s.parentId !== editor.getCurrentPageId()) return []
			const b = editor.getShapePageBounds(s.id)
			return b ? [{ x: b.center.x - anchor.x, y: b.center.y - anchor.y, w: b.w, h: b.h }] : []
		})
		const away = { x: anchor.x - middle.x, y: anchor.y - middle.y }
		const len = Math.hypot(away.x, away.y)
		const dir = len > 1 ? { x: away.x / len, y: away.y / len } : { x: 1, y: 0 }
		const sizeOf = (id: string) => nodes.find((n) => n.id === id)!
		const clear = (dx: number, dy: number) =>
			group.every((id) => {
				const p = at.get(id)!
				const n = sizeOf(id)
				return obstacles.every((o) => Math.abs(p.x + dx - o.x) >= (n.w + o.w) / 2 + pad || Math.abs(p.y + dy - o.y) >= (n.h + o.h) / 2 + pad)
			})
		let step = 0
		while (step < 60 && !clear(dir.x * step * 60, dir.y * step * 60)) step++
		const moves = group.flatMap((id) => {
			const p = at.get(id)
			const s = shapes.get(id)!
			const b = editor.getShapePageBounds(s.id)!
			return p ? [{ id: s.id, type: s.type, x: anchor.x + p.x + dir.x * step * 60 - b.w / 2, y: anchor.y + p.y + dir.y * step * 60 - b.h / 2 }] : []
		})
		editor.updateShapes(moves as never)
	}
}

/** Meta on a header: the structure (`structureOf`) its view was last laid out whole for. */
const LAYOUT_OF = 'lifeboard:layoutOf'
/** Meta on a header: a cluster outgrew its room since; the layout wants laying out again. */
const LAYOUT_STALE = 'lifeboard:layoutStale'

/**
 * What a view's skeleton is made of: its skill nodes and the arrows between them. A new tree, node,
 * shared node or mount changes it; a new entry or work doesn't (docs/skill-tree-layout-plan.md,
 * "Stability").
 */
export function structureOf(editor: Editor, view: ViewContents): string {
	const { drawn, loose } = viewGraph(editor, view)
	return [[...view.skills].sort().join(','), [...drawn, ...loose].map((e) => `${e.from}>${e.to}`).sort().join(',')].join('|')
}

/**
 * Whether a header's layout is out of date: something structural changed since it was laid out
 * whole, or a cluster outgrew its room. A header laid out before this was recorded never is.
 */
export function layoutIsStale(editor: Editor, header: TreeShape): boolean {
	const was = header.meta[LAYOUT_OF]
	if (typeof was !== 'string') return false
	return header.meta[LAYOUT_STALE] === true || was !== structureOf(editor, contentsOf(editor, header))
}

const staleByBoard = new WeakMap<Editor, Atom<TLShapeId[]>>()

/**
 * The headers on this board whose layout is out of date, as of the last sync or Re-calculate. Kept
 * apart from the store so the note over the board doesn't work it out again on every change, a drag's
 * frames included.
 */
export function staleViews(editor: Editor): Atom<TLShapeId[]> {
	let stale = staleByBoard.get(editor)
	if (!stale) staleByBoard.set(editor, (stale = atom<TLShapeId[]>('lifeboard:skill-tree-stale', [])))
	return stale
}

export function refreshStale(editor: Editor): void {
	const ids = editor
		.getCurrentPageShapes()
		.filter(isTree)
		.filter((h) => layoutIsStale(editor, h))
		.map((h) => h.id)
	const stale = staleViews(editor)
	if (ids.join() !== stale.get().join()) stale.set(ids)
}

/** The skill node an item's family hangs from in a view: its entry's parent. */
function skillOf(view: ViewContents, itemId: string): string {
	let at = view.items.get(itemId)
	for (let guard = 0; at && at.variant === 'work' && guard < 16; guard++) at = view.items.get(at.parent)
	return at?.parent ?? ''
}

/**
 * Lays out the clusters of these skill nodes again where they are (orbits.ts), the rest of the board
 * left alone. True when one came out bigger than it was, so it may now reach a neighbour.
 */
function repackClusters(editor: Editor, view: ViewContents, skills: ReadonlySet<string>): boolean {
	if (!skills.size) return false
	const shapes = viewShapes(editor, view)
	const { drawn, loose, lines } = viewGraph(editor, view)
	const children = new Map<string, string[]>()
	for (const e of lines) children.set(e.from, [...(children.get(e.from) ?? []), e.to])
	const size = (key: string) => {
		const b = editor.getShapePageBounds(shapes.get(key)!.id)!
		return { id: key, w: b.w, h: b.h }
	}
	const centre = (key: string) => editor.getShapePageBounds(shapes.get(key)!.id)!.center
	const descendants = (key: string): string[] => (children.get(key) ?? []).flatMap((k) => (shapes.has(k) ? [k, ...descendants(k)] : []))
	let grew = false
	const moves: { id: TLShapeId; type: string; x: number; y: number }[] = []
	for (const skill of skills) {
		if (!shapes.has(skill)) continue
		const c = centre(skill)
		const entries = (children.get(skill) ?? []).filter((k) => shapes.has(k) && k.startsWith('item:'))
		const members = entries.flatMap((e) => [e, ...descendants(e)])
		const before = Math.max(size(skill).w / 2, ...members.map((m) => Math.hypot(centre(m).x - c.x, centre(m).y - c.y) + Math.hypot(size(m).w, size(m).h) / 2))
		const gates = [...drawn, ...loose]
			.flatMap((e) => (e.from === skill ? [e.to] : e.to === skill ? [e.from] : []))
			.filter((n) => shapes.has(n))
			.map((n) => Math.atan2(centre(n).y - c.y, centre(n).x - c.x))
		const cluster = orbitCluster(size(skill), entries.map((e) => ({ entry: size(e), works: descendants(e).map(size) })), gates, getLayoutConfig())
		for (const [key, p] of cluster.at) {
			const s = shapes.get(key)
			const b = s && editor.getShapePageBounds(s.id)
			if (s && b) moves.push({ id: s.id, type: s.type, x: c.x + p.x - b.w / 2, y: c.y + p.y - b.h / 2 })
		}
		if (cluster.radius > before + 1) grew = true
	}
	if (moves.length) editor.updateShapes(moves as never)
	return grew
}

/** Faint lines from an entry to the other skill nodes it is tagged to in view; it is drawn under its first. */
function secondTags(items: ReadonlyMap<string, { variant: 'entry' | 'work'; parent: string }>, skills: ReadonlySet<string>): { from: string; to: string }[] {
	const out: { from: string; to: string }[] = []
	for (const [id, at] of items) {
		if (at.variant !== 'entry') continue
		for (const tag of getItem(id)?.tags ?? []) if (tag !== at.parent && skills.has(tag)) out.push({ from: tag, to: itemKey(id) })
	}
	return out
}

/** The lines a set of shown items wants, as `parent>child` keys of shape ids' owners. */
function linesWanted(items: ReadonlyMap<string, { variant: 'entry' | 'work'; parent: string }>, skills: ReadonlySet<string>): string[] {
	return [...lineEnds(items), ...secondTags(items, skills)]
		.map((e) => `${e.from}>${e.to}`)
		.sort()
}

const keyOfShape = (s: TLShape | undefined) => (isSkill(s) ? s.props.nodeId : isEntry(s) ? itemKey(s.props.itemId) : '?')

function lineArrows(editor: Editor) {
	return editor.getCurrentPageShapes().filter((s) => s.type === 'arrow' && s.meta[SKILL_EDGE_META] === LINE)
}

function endsOf(editor: Editor, arrow: TLShape): string {
	const ends = editor.getBindingsFromShape(arrow, 'arrow')
	const end = (t: string) => keyOfShape(editor.getShape(ends.find((b) => b.props.terminal === t)?.toId as never))
	return `${end('start')}>${end('end')}`
}

function linesDrawn(editor: Editor): string[] {
	return lineArrows(editor)
		.map((a) => endsOf(editor, a))
		.sort()
}

function mountArrows(editor: Editor): string[] {
	return editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow' && String(s.meta[SKILL_EDGE_META] ?? '').startsWith('mount:'))
		.map((a) => endsOf(editor, a))
		.sort()
}

/** Brings the light lines in line with what the views show: stale ones go, missing ones are drawn. */
function drawLines(editor: Editor, plan: ViewPlan): void {
	const items = new Map<string, { variant: 'entry' | 'work'; parent: string }>()
	const skills = new Set<string>()
	for (const { view } of plan.views) {
		for (const [id, at] of view.items) items.set(id, at)
		for (const id of view.skills) skills.add(id)
	}
	const want = new Set(linesWanted(items, skills))
	const second = new Set(secondTags(items, skills).map((e) => `${e.from}>${e.to}`))
	const stale: TLShapeId[] = []
	const have = new Set<string>()
	for (const arrow of lineArrows(editor)) {
		const key = endsOf(editor, arrow)
		if (want.has(key) && !have.has(key)) have.add(key)
		else stale.push(arrow.id)
	}
	if (stale.length) editor.deleteShapes(stale)
	const shapes = new Map<string, TLShapeId>()
	for (const [id, s] of nodeShapes(editor)) shapes.set(id, s.id)
	for (const [id, s] of entryShapes(editor)) shapes.set(itemKey(id), s.id)
	for (const key of want) {
		if (have.has(key)) continue
		const [from, to] = key.split('>') as [string, string]
		const a = shapes.get(from)
		const b = shapes.get(to)
		const arrow = a && b && connectShapes(editor, a, b)
		if (arrow) {
			editor.updateShape({
				id: arrow,
				type: 'arrow',
				meta: { [SKILL_EDGE_META]: LINE },
				// An entry's other tags: faint and dotted, as it is drawn once, under its first.
				props: { arrowheadEnd: 'none', arrowheadStart: 'none', size: 's', color: 'grey', ...(second.has(key) ? { dash: 'dotted', color: 'light-violet' } : {}) },
			} as never)
		}
	}
}

/**
 * Sets the light lines to how a cluster is drawn: each to a work meeting its disc's middle, each
 * between two neighbouring works bent along the arc round their entry (lines.ts, `arcBend`), and all
 * of them under the nodes, so where one can't miss a node it passes under it; then bends the arrows
 * between skill nodes round what they would cross straight, and so they leave each node evenly
 * spaced (`arrowCurve`). After a layout, a sync that drew lines, and a drag coming to rest (`moved`:
 * then only the arrows touching what the drag moved bend again).
 */
export function tidyLines(editor: Editor, moved?: ReadonlySet<TLShapeId>): void {
	const lines = lineArrows(editor)
	// With no light lines (the skill-node view) the skill arrows still need curving to where things are now.
	if (!lines.length) return curveSkillArrows(editor, moved)
	const entries = entryShapes(editor)
	const discCentre = (s: EntryShape) => {
		const b = editor.getShapePageBounds(s.id)!
		return s.props.variant === 'work' ? { x: b.center.x, y: b.minY + WORK_DISC / 2 } : b.center
	}
	const bends: { id: TLShapeId; type: 'arrow'; props: { bend: number } }[] = []
	for (const line of lines) {
		const ends = editor.getBindingsFromShape<TLArrowBinding>(line, 'arrow')
		const a = editor.getShape(ends.find((b) => b.props.terminal === 'start')?.toId as never)
		const b = editor.getShape(ends.find((b) => b.props.terminal === 'end')?.toId as never)
		let bend = 0
		if (isEntry(a) && isEntry(b) && a.props.variant === 'work' && b.props.variant === 'work') {
			const parent = getItem(b.props.itemId)?.parent
			const entry = parent ? entries.get(parent) : undefined
			if (entry) bend = arcBend(discCentre(a), discCentre(b), discCentre(entry))
		}
		if (Math.abs(((line.props as { bend?: number }).bend ?? 0) - bend) > 0.5) bends.push({ id: line.id, type: 'arrow', props: { bend } })
	}
	if (bends.length) editor.updateShapes(bends as never)
	curveSkillArrows(editor, moved)
	// Each end runs right to the middle of its disc, a work's disc above its title: under the node,
	// where the disc covers it, rather than stopping at the edge of the node's box.
	const anchored: TLArrowBinding[] = []
	for (const line of lines) {
		for (const b of editor.getBindingsFromShape<TLArrowBinding>(line, 'arrow')) {
			const end = editor.getShape(b.toId)
			const anchor = isEntry(end) && end.props.variant === 'work' ? WORK_ANCHOR : { x: 0.5, y: 0.5 }
			const now = b.props.normalizedAnchor
			if (b.props.isPrecise && b.props.isExact && now.x === anchor.x && now.y === anchor.y) continue
			anchored.push({ ...b, props: { ...b.props, normalizedAnchor: anchor, isPrecise: true, isExact: true } })
		}
	}
	if (anchored.length) editor.updateBindings(anchored)
	// The arrows between skill nodes go under the nodes too: the layout lets one pass under a cluster's
	// entries and works, never through a skill node (pullIn.ts), and under them nothing is hidden.
	const all = editor.getCurrentPageShapes().filter((a) => a.type === 'arrow' && !!a.meta[SKILL_EDGE_META])
	// Marked first: otherwise the canvas lifts each back above the two shapes it joins.
	const unmarked = all.filter((a) => !a.meta[ARROW_STAYS_BEHIND_META])
	if (unmarked.length) editor.updateShapes(unmarked.map((a) => ({ id: a.id, type: 'arrow', meta: { ...a.meta, [ARROW_STAYS_BEHIND_META]: true } })) as never)
	editor.sendToBack(all.map((a) => a.id))
}

/**
 * Bends each arrow between skill nodes that crosses something straight (another arrow, a light line,
 * a node it doesn't join) as little as clears it (curveArrows.ts). Nothing moves; only bends change.
 * After the light lines are tidied, and again once the tree's arrows are drawn (treeSync.ts).
 */
export function curveSkillArrows(editor: Editor, moved?: ReadonlySet<TLShapeId>): void {
	const discCentre = (s: EntryShape) => {
		const b = editor.getShapePageBounds(s.id)!
		return s.props.variant === 'work' ? { x: b.center.x, y: b.minY + WORK_DISC / 2 } : b.center
	}
	const centre = (s: TLShape) => (isEntry(s) ? discCentre(s) : editor.getShapePageBounds(s.id)!.center)
	const ends = (a: TLShape) => {
		const bound = editor.getBindingsFromShape<TLArrowBinding>(a, 'arrow')
		const from = editor.getShape(bound.find((b) => b.props.terminal === 'start')?.toId as never)
		const to = editor.getShape(bound.find((b) => b.props.terminal === 'end')?.toId as never)
		return from && to ? { from, to } : null
	}
	const shapes = editor.getCurrentPageShapes()
	const toCurvable = (a: TLShape) => {
		const e = ends(a)
		return e ? { id: a.id as string, from: centre(e.from), to: centre(e.to), bend: (a.props as { bend?: number }).bend ?? 0, ends: [e.from.id as string, e.to.id as string] } : null
	}
	// An arrow running along its maze corridor (waypoints) isn't curved.
	const arrows = shapes
		.filter((s) => s.type === 'arrow' && !!s.meta[SKILL_EDGE_META] && s.meta[SKILL_EDGE_META] !== LINE && !getArrowWaypoints(s as TLArrowShape).length)
		.flatMap((a) => toCurvable(a) ?? [])
	if (!arrows.length) return
	const lines = shapes.filter((s) => s.type === 'arrow' && s.meta[SKILL_EDGE_META] === LINE).flatMap((a) => toCurvable(a) ?? [])
	const discs = shapes.flatMap((s) => {
		if (isSkill(s)) return [{ id: s.id as string, ...centre(s), r: s.props.w / 2 }]
		if (isEntry(s)) return [{ id: s.id as string, ...centre(s), r: s.props.variant === 'work' ? WORK_DISC / 2 : s.props.w / 2 }]
		return []
	})
	// After a drag, only the arrows touching what moved.
	const only = moved && new Set(arrows.filter((a) => a.ends.some((e) => moved.has(e as TLShapeId))).map((a) => a.id))
	const bends = curveArrows(arrows, lines, discs, getLayoutConfig().arrowCurve, only)
	const changes = arrows.flatMap((a) => (Math.abs(a.bend - bends.get(a.id)!) > 0.5 ? [{ id: a.id as TLShapeId, type: 'arrow' as const, props: { bend: bends.get(a.id)! } }] : []))
	if (changes.length) editor.updateShapes(changes as never)
}

/** Brings the camera to what a view shows. */
export function frameView(editor: Editor, view: ViewContents): void {
	const shapes = [...viewShapes(editor, view).values()]
	const boxes = shapes.flatMap((s) => editor.getShapePageBounds(s.id) ?? [])
	if (!boxes.length) return
	editor.zoomToBounds(Box.Common(boxes), { animation: { duration: 300 }, inset: 80 })
}

/** Re-calculate: lays the view out again from scratch, as it is arranged now. One undo step. */
export function recalculate(editor: Editor, header: TreeShape): number {
	const moved = layoutView(editor, header, contentsOf(editor, header), 're-calculate tree')
	refreshStale(editor)
	return moved
}

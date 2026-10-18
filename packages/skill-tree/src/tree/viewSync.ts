import { connectShapes } from '@lifeboard/node-kit'
import { Box, createShapeId, type Editor, type TLArrowBinding, type TLShape, type TLShapeId } from '@lifeboard/canvas'
import { ENTRY_TYPE, isEntry, isSkill, SKILL_TYPE, TREE_TYPE, type EntryShape, type SkillShape, type TreeShape } from '../board'
import { ENTRY_SIZE, WORK_SIZE } from '../entry/definition'
import { SKILL_SIZE } from '../skill/definition'
import type { NodeDef } from '../treeDefs'
import { boardTrees, reachFrom, treeGraph, viewStart, type TreeGraph, type ViewContents } from '../views'
import { contentsOf } from './focus'
import { clusterLayout, workAnchor } from './clusters'
import { layoutGraph, orientFrom, type GraphEdge, type GraphNode } from './layout'
import { nodeShapes, SKILL_EDGE_META } from './ops'

/**
 * Turning each tree view's contents (views.ts) into the board (docs/skill-tree-plan.md, "Rebuild").
 * Runs inside the sync's `editor.run` with history ignored: following a view is not something the
 * user did, and their ⌘Z must not undo it.
 *
 * Each arrangement of a view (the overview, everything, a focus on one node) remembers where its
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
const itemKey = (itemId: string) => `item:${itemId}`

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
	plan.linesStale = linesWanted(wantItems).join() !== linesDrawn(editor).join()
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
			return { id: createShapeId(), type: SKILL_TYPE, parentId: editor.getCurrentPageId(), x: at.x - SKILL_SIZE / 2, y: at.y - SKILL_SIZE / 2, props: { ...rest, nodeId, treeId } }
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
		else if (unplaced.length) placeNew(editor, view, new Set(unplaced))
		const context = view.context
		if (header.meta[CONTEXT_META] !== context || headerUpdates.has(header.id)) {
			editor.updateShape({ id: header.id, type: TREE_TYPE, meta: { [CONTEXT_META]: context }, props: { places: JSON.stringify(places) } } as never)
		}
	}
	if (plan.linesStale) {
		drawLines(editor, plan)
		anchorWorkLines(editor)
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

/** A view's edges, each pointing away from its start: what a branch is, for dragging (physics.ts). */
export function viewEdges(editor: Editor, view: ViewContents): GraphEdge[] {
	const startKey = view.items.has(view.start) ? itemKey(view.start) : view.start
	const { drawn, loose, lines } = viewGraph(editor, view)
	return orientFrom(startKey, [...drawn, ...loose, ...lines])
}

/**
 * Lays a whole view out around its start (the focus, or the view's root), which stays where it is,
 * everything else on the board an obstacle. `label` names the undo step; `null` inside a sync.
 */
export function layoutView(editor: Editor, header: TreeShape, view: ViewContents, label: string | null): number {
	const shapes = viewShapes(editor, view)
	const startKey = view.items.has(view.start) ? itemKey(view.start) : view.start
	const startShape = shapes.get(startKey)
	if (!startShape) return 0
	const { drawn, loose, lines } = viewGraph(editor, view)
	const edges = orientFrom(startKey, [...drawn, ...loose, ...lines])
	const nodes: GraphNode[] = [...shapes].map(([key, s]) => {
		const b = editor.getShapePageBounds(s.id)
		return { id: key, w: b?.w ?? SKILL_SIZE, h: b?.h ?? SKILL_SIZE }
	})
	const anchor = editor.getShapePageBounds(startShape.id)?.center ?? { x: 0, y: 0 }
	const moving = new Set<string>([...shapes.values()].map((s) => s.id))
	const obstacles = editor.getCurrentPageShapes().flatMap((s) => {
		if (moving.has(s.id) || s.id === header.id || s.type === 'arrow' || s.parentId !== editor.getCurrentPageId()) return []
		const b = editor.getShapePageBounds(s.id)
		return b ? [{ x: b.center.x - anchor.x, y: b.center.y - anchor.y, w: b.w, h: b.h }] : []
	})
	// The header is laid out with the view, hung from its start like a leaf, so it lands clear of it.
	const HEADER = 'header'
	const hb = editor.getShapePageBounds(header.id)
	if (hb) {
		nodes.push({ id: HEADER, w: hb.w, h: hb.h })
		edges.push({ from: startKey, to: HEADER })
	}
	// A view with entries around a skill node at its middle is laid out in clusters (compact); a focus
	// on an entry is laid out whole around that entry, so it is the middle.
	const clustered = view.items.size > 0 && !view.items.has(view.start)
	const at = clustered
		? clusterLayout(nodes, edges, { isSkill: (id) => view.skills.has(id), start: startKey, arrows: drawn, unlined: new Set([HEADER]), obstacles })
		: layoutGraph(nodes, edges, { root: startKey, obstacles, clearEdges: (e) => e.to !== HEADER })
	const moves = [...shapes, ...(hb ? ([[HEADER, header]] as const) : [])].flatMap(([key, s]) => {
		const p = at.get(key)
		const b = editor.getShapePageBounds(s.id)
		return p && b ? [{ id: s.id, type: s.type, x: anchor.x + p.x - b.w / 2, y: anchor.y + p.y - b.h / 2 }] : []
	})
	editor.run(() => {
		if (label) editor.markHistoryStoppingPoint(label)
		editor.updateShapes(moves as never)
		anchorWorkLines(editor)
	})
	return moves.length
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

/** The lines a set of shown items wants, as `parent>child` keys of shape ids' owners. */
function linesWanted(items: ReadonlyMap<string, { variant: 'entry' | 'work'; parent: string }>): string[] {
	return [...items].map(([id, at]) => `${at.variant === 'entry' ? at.parent : itemKey(at.parent)}>${itemKey(id)}`).sort()
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
	for (const { view } of plan.views) for (const [id, at] of view.items) items.set(id, at)
	const want = new Set(linesWanted(items))
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
				props: { arrowheadEnd: 'none', arrowheadStart: 'none', size: 's', color: 'grey' },
			} as never)
		}
	}
}

/**
 * Ends each line to a work at the work's end nearer what it hangs from (clusters.ts, `workAnchor`),
 * so the lines to a column of works fan out beside it instead of running through the works above.
 */
export function anchorWorkLines(editor: Editor): void {
	const updates: TLArrowBinding[] = []
	for (const arrow of lineArrows(editor)) {
		const ends = editor.getBindingsFromShape<TLArrowBinding>(arrow, 'arrow')
		const start = ends.find((b) => b.props.terminal === 'start')
		const end = ends.find((b) => b.props.terminal === 'end')
		const work = end && editor.getShape(end.toId)
		if (!start || !end || !isEntry(work) || work.props.variant !== 'work') continue
		const from = editor.getShapePageBounds(start.toId)
		const to = editor.getShapePageBounds(work.id)
		if (!from || !to) continue
		const anchor = workAnchor({ x: to.center.x, y: to.center.y, w: to.w, h: to.h }, from.center)
		const now = end.props.normalizedAnchor
		if (end.props.isPrecise && now.x === anchor.x && now.y === anchor.y) continue
		updates.push({ ...end, props: { ...end.props, normalizedAnchor: anchor, isPrecise: true } })
	}
	if (updates.length) editor.updateBindings(updates)
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
	return layoutView(editor, header, contentsOf(editor, header), 're-calculate tree')
}

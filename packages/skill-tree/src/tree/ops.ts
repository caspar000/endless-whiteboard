import { connectShapes } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { isDraft, isSkill, isTree, MASTERY, MASTERY_NODE, SKILL_TYPE, TREE_TYPE, treeNodes, type SkillShape, type TreeShape } from '../board'
import { getTreeDef, getTreeDefs, updateTreeMeta, upsertNodeDef } from '../treeDefs'
import { boardTrees, reachFrom, treeGraph, viewStart, type TreeGraph } from '../views'
import { parseRequirements } from '../requirements'
import { SKILL_SIZE } from '../skill/definition'
import { layoutGraph, type GraphEdge, type GraphNode } from './layout'
import { prerequisitesOf } from './prerequisites'

/** Meta on the arrows this extension draws between prerequisites, so redrawing can find its own. */
export const SKILL_EDGE_META = 'lifeboard:skillEdge'

export { MASTERY, MASTERY_NODE } from '../board'

export { prerequisitesOf } from './prerequisites'

export interface NewSkill {
	nodeId: string
	name: string
	kind?: string
	sector?: string
	ring?: string
	requires?: string
	icon?: string
}

/**
 * Nodes in the order the layout should fan them: by sector, then ring, so a sectored tree keeps its
 * wedges side by side. Nodes without a sector keep their order, after the sectored ones.
 */
function bySector<T extends { sector?: string; ring?: string }>(nodes: readonly T[], sectors: readonly string[], rings: readonly string[]): T[] {
	const rank = (list: readonly string[], value = '') => (list.includes(value) ? list.indexOf(value) : list.length)
	return nodes
		.map((node, i) => ({ node, i }))
		.sort((a, b) => rank(sectors, a.node.sector) - rank(sectors, b.node.sector) || rank(rings, a.node.ring) - rank(rings, b.node.ring) || a.i - b.i)
		.map(({ node }) => node)
}

/**
 * One tree as a graph to lay out: its nodes, its prerequisite edges, and the root it grows from (the
 * chosen one, else the node of kind root, else the first without prerequisites). The other nodes
 * without prerequisites, method nodes say, hang from that root by an edge nobody draws.
 */
function specGraph(
	nodes: readonly { nodeId: string; kind?: string; requires?: string; w: number; h: number }[],
	chosenRoot = ''
): { nodes: GraphNode[]; edges: GraphEdge[]; hidden: GraphEdge[]; root: string } {
	const ids = new Set(nodes.map((n) => n.nodeId))
	const edges = nodes.flatMap((n) => prerequisitesOf(n.requires ?? '').filter((p) => ids.has(p)).map((from) => ({ from, to: n.nodeId })))
	const loose = nodes.filter((n) => !edges.some((e) => e.to === n.nodeId)).map((n) => n.nodeId)
	const root = (ids.has(chosenRoot) && chosenRoot) || nodes.find((n) => n.kind === 'root')?.nodeId || loose[0] || nodes[0]?.nodeId || ''
	const hidden = loose.filter((id) => id !== root).map((to) => ({ from: root, to }))
	return { nodes: nodes.map((n) => ({ id: n.nodeId, w: n.w, h: n.h })), edges, hidden, root }
}

/** Where every node of a new tree goes, as top-left corners around `center`, the root at it. */
export function treePositions(
	spec: { sectors: string[]; rings: string[]; nodes: readonly NewSkill[]; root?: string },
	center: { x: number; y: number }
): Map<string, { x: number; y: number }> {
	const nodes = bySector(spec.nodes, spec.sectors, spec.rings).map((n) => ({ ...n, w: SKILL_SIZE, h: SKILL_SIZE }))
	const graph = specGraph(nodes, spec.root)
	const at = layoutGraph(graph.nodes, [...graph.edges, ...graph.hidden], { root: graph.root })
	const out = new Map<string, { x: number; y: number }>()
	for (const [id, p] of at) out.set(id, { x: center.x + p.x - SKILL_SIZE / 2, y: center.y + p.y - SKILL_SIZE / 2 })
	return out
}

export function insertTree(
	editor: Editor,
	spec: { treeId: string; name: string; goal: string; sectors: string[]; rings: string[]; nodes: NewSkill[]; layout?: string },
	center: { x: number; y: number },
	/** Off when an outer `editor.run` already owns the undo entry. */
	mark = true
): TLShapeId {
	const headerId = createShapeId()
	editor.run(() => {
		if (mark) editor.markHistoryStoppingPoint('insert skill tree')
		const positions = treePositions(spec, center)
		const top = Math.min(center.y - SKILL_SIZE, ...[...positions.values()].map((p) => p.y))
		editor.createShape({
			id: headerId,
			type: TREE_TYPE,
			x: center.x - 140,
			y: top - 140,
			props: {
				treeId: spec.treeId,
				name: spec.name,
				goal: spec.goal,
				layout: spec.layout ?? 'sectors',
				sectors: spec.sectors.join(', '),
				rings: spec.rings.join(', '),
			},
		} as never)
		for (const node of spec.nodes) {
			const at = positions.get(node.nodeId) ?? center
			editor.createShape({
				id: createShapeId(),
				type: SKILL_TYPE,
				x: at.x,
				y: at.y,
				props: {
					nodeId: node.nodeId,
					treeId: spec.treeId,
					name: node.name,
					kind: node.kind ?? 'skill',
					sector: node.sector ?? '',
					ring: node.ring ?? '',
					requires: node.requires ?? '',
					icon: node.icon ?? '',
				},
			} as never)
		}
		drawPrerequisites(editor, spec.treeId)
	})
	return headerId
}

/**
 * Draws one arrow per prerequisite of every node in a tree, replacing the ones drawn before. The
 * arrows are a picture of the requirements, never read back: what a node requires lives in its
 * `requires` alone, so tidying or deleting a line changes nothing about the tree.
 */
export function drawPrerequisites(editor: Editor, treeId: string): void {
	const nodes = treeNodes(editor, treeId)
	const byNodeId = new Map(nodes.map((n) => [n.props.nodeId, n]))
	const ours = new Set(nodes.map((n) => n.id as string))
	const stale = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow' && s.meta[SKILL_EDGE_META] === treeId)
		.map((s) => s.id)
	editor.run(() => {
		if (stale.length) editor.deleteShapes(stale)
		for (const node of nodes) {
			const parsed = parseRequirements(node.props.requires)
			if (!parsed.ok) continue
			for (const condition of parsed.conditions) {
				if (!('node' in condition)) continue
				for (const id of condition.node) {
					const from = byNodeId.get(id)
					if (!from || !ours.has(from.id)) continue
					const arrow = connectShapes(editor, from.id, node.id)
					if (arrow) editor.updateShape({ id: arrow, type: 'arrow', meta: { [SKILL_EDGE_META]: treeId } })
				}
			}
		}
	})
}

/** The tree a selection is about: a selected node's or header's. */
export function selectedTreeId(editor: Editor): string | null {
	for (const shape of editor.getSelectedShapes()) {
		if (isSkill(shape)) return (shape as SkillShape).props.treeId
		if (shape.type === TREE_TYPE) return (shape.props as { treeId: string }).treeId
	}
	return null
}

/** The header card of a tree on this board, if it has one. */
export function treeHeader(editor: Editor, treeId: string): TreeShape | undefined {
	return editor.getCurrentPageShapes().find((s): s is TreeShape => isTree(s) && s.props.treeId === treeId)
}

const HEADER = 'header:'

interface Placed {
	graphId: string
	shape: SkillShape | TreeShape
}

/** The one shape standing for each node on this board (a confirmed one over a draft). */
export function nodeShapes(editor: Editor): Map<string, SkillShape> {
	const out = new Map<string, SkillShape>()
	for (const s of editor.getCurrentPageShapes()) {
		if (!isSkill(s) || !s.props.nodeId) continue
		const had = out.get(s.props.nodeId)
		if (!had || (isDraft(had) && !isDraft(s))) out.set(s.props.nodeId, s)
	}
	return out
}

/**
 * Everything else on the board, as boxes relative to `anchor`, for the layout to keep clear of:
 * every shape but arrows, the shapes being placed, and what sits inside a frame or group.
 */
function obstaclesFor(editor: Editor, placed: readonly Placed[], anchor: { x: number; y: number }) {
	const moving = new Set<string>(placed.map((p) => p.shape.id))
	return editor.getCurrentPageShapes().flatMap((s) => {
		if (moving.has(s.id) || s.type === 'arrow' || s.parentId !== editor.getCurrentPageId()) return []
		const b = editor.getShapePageBounds(s.id)
		return b ? [{ x: b.center.x - anchor.x, y: b.center.y - anchor.y, w: b.w, h: b.h }] : []
	})
}

/** Moves shapes so that the graph centres land around `anchor`. `label` names the undo step; `null` when an outer `editor.run` already owns it. */
function place(editor: Editor, placed: readonly Placed[], at: Map<string, { x: number; y: number }>, anchor: { x: number; y: number }, label: string | null): number {
	const moves = placed.flatMap(({ graphId, shape }) => {
		const p = at.get(graphId)
		const b = editor.getShapePageBounds(shape.id)
		if (!p || !b) return []
		return [{ id: shape.id, type: shape.type, x: anchor.x + p.x - b.w / 2, y: anchor.y + p.y - b.h / 2 }]
	})
	editor.run(() => {
		if (label) editor.markHistoryStoppingPoint(label)
		editor.updateShapes(moves as never)
	})
	return moves.length
}

const centreOf = (editor: Editor, id: TLShapeId) => editor.getShapePageBounds(id)?.center ?? { x: 0, y: 0 }

/** Nodes in fan order: each tree's sectors side by side (see `bySector`). */
function fanOrder(graph: TreeGraph, ids: readonly string[]): string[] {
	const list = (value = '') => value.split(',').map((s) => s.trim()).filter(Boolean)
	const trees = getTreeDefs()
	const withSector = ids.map((id) => ({ id, ...graph.nodes.get(id)!.def, treeId: graph.nodes.get(id)!.treeId }))
	const byTree = new Map<string, typeof withSector>()
	for (const n of withSector) byTree.set(n.treeId, [...(byTree.get(n.treeId) ?? []), n])
	return [...byTree].flatMap(([treeId, nodes]) => bySector(nodes, list(trees[treeId]?.sectors), list(trees[treeId]?.rings)).map((n) => n.id))
}

/**
 * Lays out what a view reaches from `start` on this board, `start` staying where it is (or put at
 * `anchor`): every tree mounted on the way is a branch, and each tree's header hangs beside its root.
 * Returns how many shapes moved.
 */
export function layoutReach(editor: Editor, start: string, label: string | null, anchor?: { x: number; y: number }): number {
	const graph = treeGraph(boardTrees(editor))
	const shapes = nodeShapes(editor)
	const startShape = shapes.get(start)
	if (!startShape) return 0
	const reach = [...reachFrom(graph, start)].filter((id) => shapes.has(id))
	const ids = fanOrder(graph, reach)
	const inSet = new Set(ids)
	const drawn = [...graph.prerequisites, ...graph.mounts].filter((e) => inSet.has(e.from) && inSet.has(e.to))
	const loose = graph.loose.filter((e) => inSet.has(e.from) && inSet.has(e.to))
	const nodes: GraphNode[] = ids.map((id) => {
		const b = editor.getShapePageBounds(shapes.get(id)!.id)
		return { id, w: b?.w ?? SKILL_SIZE, h: b?.h ?? SKILL_SIZE }
	})
	const placed: Placed[] = ids.map((id) => ({ graphId: id, shape: shapes.get(id)! }))
	const headerEdges: GraphEdge[] = []
	for (const header of editor.getCurrentPageShapes().filter(isTree)) {
		const root = graph.rootOf.get(header.props.treeId)
		if (!root || !inSet.has(root)) continue
		const b = editor.getShapePageBounds(header.id)
		nodes.push({ id: HEADER + header.id, w: b?.w ?? 280, h: b?.h ?? 72 })
		headerEdges.push({ from: root, to: HEADER + header.id })
		placed.push({ graphId: HEADER + header.id, shape: header })
	}
	const at0 = anchor ?? centreOf(editor, startShape.id)
	const at = layoutGraph(nodes, [...drawn, ...loose, ...headerEdges], {
		root: start,
		clearEdges: (e) => drawn.includes(e as never),
		obstacles: obstaclesFor(editor, placed, at0),
	})
	return place(editor, placed, at, at0, label)
}

/** Lays a tree out as its header views it (its chosen root, else its root), the root staying put. One undo step. */
export function layoutTree(editor: Editor, treeId: string): number {
	const header = treeHeader(editor, treeId)
	const start = viewStart(treeGraph(boardTrees(editor)), header?.props ?? { treeId, root: '' })
	return layoutReach(editor, start, 'lay out tree')
}

/** Lays out one node and everything that grows from it, mounted trees included, around where it stands. */
export function layoutFrom(editor: Editor, node: SkillShape): number {
	return layoutReach(editor, node.props.nodeId, 'lay out from node')
}

/**
 * Places nodes a view has just put on the board: each beside its nearest ancestor that was already
 * there, laid out with that ancestor as the root and everything else as obstacles. Runs inside the
 * caller's `editor.run`.
 */
export function placeNewNodes(editor: Editor, created: ReadonlySet<string>): void {
	const graph = treeGraph(boardTrees(editor))
	const shapes = nodeShapes(editor)
	const parents = new Map<string, string[]>()
	for (const e of [...graph.prerequisites, ...graph.mounts, ...graph.loose]) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from])
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
	for (const [ancestor, group] of groups) {
		const ids = new Set([ancestor, ...group])
		const edges = [...graph.prerequisites, ...graph.mounts, ...graph.loose].filter((e) => ids.has(e.from) && ids.has(e.to))
		const nodes = [...ids].map((id) => ({ id, w: SKILL_SIZE, h: SKILL_SIZE }))
		const placed = group.map((id) => ({ graphId: id, shape: shapes.get(id)! }))
		const anchor = centreOf(editor, shapes.get(ancestor)!.id)
		const at = layoutGraph(nodes, edges, { root: ancestor, obstacles: obstaclesFor(editor, placed, anchor) })
		place(editor, placed, at, anchor, null)
	}
}

/** One arrow from each mount node to the root of the tree mounted on it, where both are on the board. */
export function drawMounts(editor: Editor): void {
	const graph = treeGraph(boardTrees(editor))
	const shapes = nodeShapes(editor)
	const stale = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow' && String(s.meta[SKILL_EDGE_META] ?? '').startsWith('mount:'))
		.map((s) => s.id)
	editor.run(() => {
		if (stale.length) editor.deleteShapes(stale)
		for (const m of graph.mounts) {
			const from = shapes.get(m.from)
			const to = shapes.get(m.to)
			const arrow = from && to && connectShapes(editor, from.id, to.id)
			if (arrow) editor.updateShape({ id: arrow, type: 'arrow', meta: { [SKILL_EDGE_META]: `mount:${m.treeId}` } })
		}
	})
}

/** The board's Mastery node, if it has one. */
export function masteryNode(editor: Editor): SkillShape | undefined {
	return nodeShapes(editor).get(MASTERY_NODE)
}

/**
 * Puts the Mastery tree on this board and every tree on the board under it: the vault gets a
 * Mastery node if it has none, each tree here that hangs from nothing is mounted on it, and a
 * Mastery header views it all, laid out around the Mastery node. Trees already mounted elsewhere
 * (on a pillar, say) keep their mount and come along through it. One undo step for the board; the
 * mounts are vault data and stay.
 */
export function gatherAroundMastery(editor: Editor): number {
	const treeIds = [...new Set([...nodeShapes(editor).values()].filter((s) => !isDraft(s) && s.props.treeId !== MASTERY).map((s) => s.props.treeId))]
	if (!treeIds.length && !getTreeDef(MASTERY)) return 0
	if (!getTreeDef(MASTERY)?.nodes.some((n) => n.nodeId === MASTERY_NODE)) {
		upsertNodeDef(MASTERY, { nodeId: MASTERY_NODE, name: 'Mastery', kind: MASTERY, icon: 'trophy', sector: '', ring: '', requires: '' })
		updateTreeMeta(MASTERY, { name: 'Mastery' })
	}
	for (const treeId of treeIds) if (!getTreeDef(treeId)?.mount) updateTreeMeta(treeId, { mount: MASTERY_NODE })

	let moved = 0
	editor.run(() => {
		editor.markHistoryStoppingPoint('gather trees around Mastery')
		const c = editor.getCurrentPageBounds()?.center ?? { x: 0, y: 0 }
		if (!masteryNode(editor)) {
			editor.createShape({
				id: createShapeId(),
				type: SKILL_TYPE,
				x: c.x - SKILL_SIZE / 2,
				y: c.y - SKILL_SIZE / 2,
				props: { nodeId: MASTERY_NODE, treeId: MASTERY, name: 'Mastery', kind: MASTERY, icon: 'trophy' },
			} as never)
		}
		if (!treeHeader(editor, MASTERY)) {
			editor.createShape({ id: createShapeId(), type: TREE_TYPE, x: c.x - 140, y: c.y - 300, props: { treeId: MASTERY, name: 'Mastery' } } as never)
		}
		drawMounts(editor)
		moved = layoutReach(editor, MASTERY_NODE, null)
	})
	return moved
}

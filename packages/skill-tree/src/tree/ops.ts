import { connectShapes } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { isSkill, isTree, MASTERY, SKILL_TYPE, TREE_TYPE, treeNodes, type SkillShape, type TreeShape } from '../board'
import { parseRequirements } from '../requirements'
import { SKILL_SIZE } from '../skill/definition'
import { layoutGraph, type GraphEdge, type GraphNode } from './layout'

/** Meta on the arrows this extension draws between prerequisites, so redrawing can find its own. */
export const SKILL_EDGE_META = 'lifeboard:skillEdge'

export { MASTERY } from '../board'

/** The node ids a node's requirements name as prerequisites, in order. */
export function prerequisitesOf(requires: string): string[] {
	const parsed = parseRequirements(requires)
	return parsed.ok ? parsed.conditions.flatMap((c) => ('node' in c ? c.node : [])) : []
}

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
function treeGraph(
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
	const graph = treeGraph(nodes, spec.root)
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

/** One tree's nodes, sized as they are drawn, in the order the layout should fan them. */
function boardTree(editor: Editor, treeId: string) {
	const header = treeHeader(editor, treeId)
	const list = (value = '') => value.split(',').map((s) => s.trim()).filter(Boolean)
	const shapes = bySector(
		treeNodes(editor, treeId).map((shape) => ({ shape, sector: shape.props.sector, ring: shape.props.ring })),
		list(header?.props.sectors),
		list(header?.props.rings)
	).map(({ shape }) => shape)
	const sized = shapes.map((shape) => {
		const b = editor.getShapePageBounds(shape.id)
		return { nodeId: shape.props.nodeId, kind: shape.props.kind, requires: shape.props.requires, w: b?.w ?? SKILL_SIZE, h: b?.h ?? SKILL_SIZE }
	})
	return { header, shapes, sized }
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

/** Moves shapes so that the graph centres land around `anchor`, in one undo step. */
/** `label` names the undo step; `null` when an outer `editor.run` already owns it. */
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

/**
 * Lays a tree out from its root (the header's chosen root, else its node of kind root), its header
 * hung beside the root. The root stays where it is. One undo step; returns how many shapes moved.
 */
export function layoutTree(editor: Editor, treeId: string): number {
	const { header, shapes, sized } = boardTree(editor, treeId)
	const graph = treeGraph(sized, header?.props.root)
	const rootShape = shapes.find((s) => s.props.nodeId === graph.root)
	if (!rootShape) return 0
	const headerEdge = header ? [{ from: graph.root, to: HEADER + treeId }] : []
	const headerBox = header ? editor.getShapePageBounds(header.id) : undefined
	const placed: Placed[] = [...shapes.map((shape) => ({ graphId: shape.props.nodeId, shape })), ...(header ? [{ graphId: HEADER + treeId, shape: header }] : [])]
	const anchor = centreOf(editor, rootShape.id)
	const at = layoutGraph(
		[...graph.nodes, ...(header ? [{ id: HEADER + treeId, w: headerBox?.w ?? 280, h: headerBox?.h ?? 72 }] : [])],
		[...graph.edges, ...graph.hidden, ...headerEdge],
		{ root: graph.root, clearEdges: (e) => graph.edges.includes(e), obstacles: obstaclesFor(editor, placed, anchor) }
	)
	return place(editor, placed, at, anchor, 'lay out tree')
}

/**
 * Lays out one node and everything that depends on it, around that node where it stands. The rest
 * of the board is left alone.
 */
export function layoutFrom(editor: Editor, node: SkillShape): number {
	const { shapes, sized } = boardTree(editor, node.props.treeId)
	const graph = treeGraph(sized, node.props.nodeId)
	// The branch: the node and everything that depends on it. The rest of the tree is in the way like anything else.
	const branch = new Set([node.props.nodeId])
	for (let grew = true; grew; ) {
		grew = false
		for (const e of graph.edges) {
			if (!branch.has(e.from) || branch.has(e.to)) continue
			branch.add(e.to)
			grew = true
		}
	}
	const placed = shapes.filter((s) => branch.has(s.props.nodeId)).map((shape) => ({ graphId: shape.props.nodeId, shape }))
	const anchor = centreOf(editor, node.id)
	const at = layoutGraph(graph.nodes, graph.edges, { root: node.props.nodeId, obstacles: obstaclesFor(editor, placed, anchor) })
	return place(editor, placed, at, anchor, 'lay out from node')
}

/** The board's Mastery node, if it has one. */
export function masteryNode(editor: Editor): SkillShape | undefined {
	return editor.getCurrentPageShapes().find((s): s is SkillShape => isSkill(s) && s.props.kind === MASTERY)
}

/**
 * Puts a Mastery node above every tree on the board (making one at their common centre if there is
 * none), joins it to each tree's root, and lays the whole board out around it: each tree a branch,
 * each header beside its root. One undo step; returns how many shapes moved.
 */
export function gatherAroundMastery(editor: Editor): number {
	const treeIds = [...new Set(editor.getCurrentPageShapes().flatMap((s) => (isSkill(s) && s.props.kind !== MASTERY ? [s.props.treeId] : [])))]
	if (!treeIds.length) return 0
	let moved = 0
	editor.run(() => {
		editor.markHistoryStoppingPoint('gather trees around Mastery')
		const mastery = masteryNode(editor) ?? createMastery(editor)
		moved = gather(editor, mastery, treeIds)
	})
	return moved
}

function createMastery(editor: Editor): SkillShape {
	const c = editor.getCurrentPageBounds()?.center ?? { x: 0, y: 0 }
	const id = createShapeId()
	editor.createShape({
		id,
		type: SKILL_TYPE,
		x: c.x - SKILL_SIZE / 2,
		y: c.y - SKILL_SIZE / 2,
		props: { nodeId: MASTERY, treeId: MASTERY, name: 'Mastery', kind: MASTERY, icon: 'trophy' },
	} as never)
	return editor.getShape(id) as SkillShape
}

function gather(editor: Editor, mastery: SkillShape, treeIds: readonly string[]): number {

	const nodes: GraphNode[] = [{ id: MASTERY, w: SKILL_SIZE, h: SKILL_SIZE }]
	const drawn: GraphEdge[] = []
	const undrawn: GraphEdge[] = []
	const placed: Placed[] = [{ graphId: MASTERY, shape: mastery }]
	const roots: string[] = []
	for (const treeId of treeIds) {
		const { header, shapes, sized } = boardTree(editor, treeId)
		const graph = treeGraph(sized, header?.props.root)
		nodes.push(...graph.nodes)
		drawn.push(...graph.edges, { from: MASTERY, to: graph.root })
		undrawn.push(...graph.hidden)
		placed.push(...shapes.map((shape) => ({ graphId: shape.props.nodeId, shape })))
		roots.push(graph.root)
		if (header) {
			const b = editor.getShapePageBounds(header.id)
			nodes.push({ id: HEADER + treeId, w: b?.w ?? 280, h: b?.h ?? 72 })
			undrawn.push({ from: graph.root, to: HEADER + treeId })
			placed.push({ graphId: HEADER + treeId, shape: header })
		}
	}
	const anchor = centreOf(editor, mastery.id)
	const at = layoutGraph(nodes, [...drawn, ...undrawn], { root: MASTERY, clearEdges: (e) => drawn.includes(e), obstacles: obstaclesFor(editor, placed, anchor) })
	const moved = place(editor, placed, at, anchor, null)
	drawMasteryEdges(editor, mastery, roots)
	return moved
}

/** One arrow from the Mastery node to each tree's root, replacing the ones drawn before. */
function drawMasteryEdges(editor: Editor, mastery: SkillShape, roots: readonly string[]): void {
	const stale = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow' && s.meta[SKILL_EDGE_META] === MASTERY)
		.map((s) => s.id)
	const byNodeId = new Map(editor.getCurrentPageShapes().flatMap((s) => (isSkill(s) ? [[s.props.nodeId, s] as const] : [])))
	editor.run(() => {
		if (stale.length) editor.deleteShapes(stale)
		for (const root of roots) {
			const to = byNodeId.get(root)
			const arrow = to && connectShapes(editor, mastery.id, to.id)
			if (arrow) editor.updateShape({ id: arrow, type: 'arrow', meta: { [SKILL_EDGE_META]: MASTERY } })
		}
	})
}

import { createShapeId, react, type Editor, type TLShape } from '@lifeboard/canvas'
import { isDraft, isSkill, isTree, SKILL_TYPE, TREE_TYPE, type SkillShape, type TreeShape } from './board'
import { SKILL_SIZE } from './skill/definition'
import { drawMounts, drawPrerequisites, layoutReach, nodeShapes, placeNewNodes, SKILL_EDGE_META } from './tree/ops'
import { boardTrees, reachFrom, treeGraph, viewStart } from './views'
import {
	getTreeDef,
	getTreeDefs,
	NODE_FIELDS,
	reconcile,
	removeNodeDef,
	updateTreeMeta,
	upsertNodeDef,
	type NodeDef,
	type TreeMeta,
} from './treeDefs'

/**
 * Keeps a board's node shapes and the vault's tree definitions (treeDefs.ts) the same, both ways:
 * an edit to a node shape is written to its definition, and a definition that changed (on another
 * board, or through YAML) is drawn on every open board that shows the node.
 *
 * The board-to-vault direction runs in store side effects, which only write the vault. The other
 * direction writes shapes, so it runs after the change, outside any side effect, with
 * `history: 'ignore'`: following the vault is not something the user did here, and must not be
 * undone by their ⌘Z. While it writes, `syncing` tells the side effects not to echo it back.
 */
let syncing = false

/** A node shape that stands for a node in the vault: confirmed, and in a tree. */
const live = (shape: TLShape | undefined): shape is SkillShape =>
	isSkill(shape) && !isDraft(shape) && !!shape.props.treeId && !!shape.props.nodeId

const liveHeader = (shape: TLShape | undefined): shape is TreeShape => isTree(shape) && !isDraft(shape) && !!shape.props.treeId

export const nodeDefOf = (shape: SkillShape): NodeDef => ({
	nodeId: shape.props.nodeId,
	name: shape.props.name,
	kind: shape.props.kind,
	icon: shape.props.icon,
	sector: shape.props.sector,
	ring: shape.props.ring,
	requires: shape.props.requires,
})

const metaOf = (header: TreeShape): TreeMeta => ({
	name: header.props.name,
	goal: header.props.goal,
	sectors: header.props.sectors,
	rings: header.props.rings,
	mount: getTreeDef(header.props.treeId)?.mount ?? '',
})

/** What a header shows of its tree; the mount lives only in the vault. */
const HEADER_FIELDS = ['name', 'goal', 'sectors', 'rings'] as const

const watched = new WeakSet<Editor>()

/** Wires one board to the vault's trees. Idempotent; `watchBoard` calls it when a board opens. */
export function watchTrees(editor: Editor): void {
	if (watched.has(editor)) {
		syncBoard(editor)
		return
	}
	watched.add(editor)

	editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
		if (syncing) return
		if (live(shape)) upsertNodeDef(shape.props.treeId, nodeDefOf(shape))
		// A header for a tree the vault has named takes the vault's name; otherwise it names the tree.
		else if (liveHeader(shape) && !getTreeDef(shape.props.treeId)?.name) updateTreeMeta(shape.props.treeId, metaOf(shape))
		else if (liveHeader(shape)) schedule(editor)
	})
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (syncing) return
		if (live(next)) {
			// Moved to another tree, or renamed its id: the old node goes, the new one is written.
			if (live(prev) && (prev.props.treeId !== next.props.treeId || prev.props.nodeId !== next.props.nodeId)) {
				removeNodeDef(prev.props.treeId, prev.props.nodeId)
			}
			const changed = !live(prev) || NODE_FIELDS.some((f) => prev.props[f] !== next.props[f]) || prev.props.treeId !== next.props.treeId
			if (changed) upsertNodeDef(next.props.treeId, nodeDefOf(next))
		} else if (liveHeader(next) && !liveHeader(prev)) {
			// A confirmed draft header names its tree.
			updateTreeMeta(next.props.treeId, metaOf(next))
		} else if (liveHeader(next) && liveHeader(prev)) {
			if (HEADER_FIELDS.some((f) => prev.props[f] !== next.props[f])) updateTreeMeta(next.props.treeId, metaOf(next))
			// A view looking from somewhere else shows different nodes.
			if (prev.props.root !== next.props.root || prev.props.treeId !== next.props.treeId) schedule(editor)
		}
	})
	editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		// Deleting a node on a board deletes it from its tree; undo writes it back.
		if (!syncing && live(shape)) removeNodeDef(shape.props.treeId, shape.props.nodeId)
		if (!syncing && liveHeader(shape)) schedule(editor)
	})

	const stop = react('lifeboard:skill-tree-sync', () => {
		getTreeDefs()
		schedule(editor)
	})
	editor.disposables.add(() => {
		stop()
		disposed.add(editor)
	})
}

const disposed = new WeakSet<Editor>()

const pending = new WeakSet<Editor>()

/** Runs `syncBoard` once, after the current change has finished. */
function schedule(editor: Editor): void {
	if (pending.has(editor)) return
	pending.add(editor)
	queueMicrotask(() => {
		pending.delete(editor)
		if (!disposed.has(editor)) syncBoard(editor)
	})
}

/**
 * Brings one board in line with the vault: nodes the vault doesn't know are added to it (a board
 * from before tree definitions, or a shape made offline); nodes it deleted leave the board; every
 * other node, and every header, takes the vault's fields. Arrows are redrawn for a tree whose
 * requirements changed.
 */
export function syncBoard(editor: Editor): void {
	const shapes = editor.getCurrentPageShapes()
	const byTree = new Map<string, SkillShape[]>()
	for (const shape of shapes) if (live(shape)) byTree.set(shape.props.treeId, [...(byTree.get(shape.props.treeId) ?? []), shape])
	const headers = shapes.filter(liveHeader)

	const removals: SkillShape[] = []
	const updates: { shape: SkillShape; def: NodeDef }[] = []
	const redraw = new Set<string>()
	for (const header of headers) {
		if (!getTreeDef(header.props.treeId)) updateTreeMeta(header.props.treeId, metaOf(header))
	}
	for (const [treeId, nodes] of byTree) {
		const board = new Map(nodes.map((n) => [n.props.nodeId, nodeDefOf(n)]))
		const plan = reconcile(getTreeDef(treeId), board)
		for (const node of plan.adopt) upsertNodeDef(treeId, node)
		for (const id of plan.remove) removals.push(...nodes.filter((n) => n.props.nodeId === id))
		for (const def of plan.update) {
			const shape = nodes.find((n) => n.props.nodeId === def.nodeId)!
			updates.push({ shape, def })
			if (shape.props.requires !== def.requires) redraw.add(treeId)
		}
		if (plan.remove.length) redraw.add(treeId)
	}
	const headerUpdates = headers.flatMap((header) => {
		const def = getTreeDef(header.props.treeId)
		if (!def || HEADER_FIELDS.every((f) => header.props[f] === def[f])) return []
		return [{ id: header.id, type: TREE_TYPE, props: { name: def.name, goal: def.goal, sectors: def.sectors, rings: def.rings } }]
	})
	const view = planViews(editor, headers, new Set(removals.map((s) => s.id)))
	for (const treeId of view.trees) redraw.add(treeId)
	if (!removals.length && !updates.length && !headerUpdates.length && !view.create.length && !view.hide.length && !view.mountsStale) return

	syncing = true
	try {
		editor.run(
			() => {
				const gone = [...removals, ...view.hide].map((s) => s.id)
				if (gone.length) editor.deleteShapes(gone)
				editor.updateShapes([
					...updates.map(({ shape, def }) => {
						const { nodeId, ...props } = def
						void nodeId
						return { id: shape.id, type: SKILL_TYPE, props }
					}),
					...headerUpdates,
				] as never)
				if (view.create.length) {
					editor.createShapes(
						view.create.map(({ treeId, def, at }) => {
							const { nodeId, ...rest } = def
							return { id: createShapeId(), type: SKILL_TYPE, x: at.x - SKILL_SIZE / 2, y: at.y - SKILL_SIZE / 2, props: { ...rest, nodeId, treeId } }
						}) as never
					)
					// An empty view is laid out whole beside its header; anything else joins its nearest ancestor.
					const laidOut = new Set<string>()
					for (const fresh of view.fresh) {
						layoutReach(editor, fresh.start, null, fresh.anchor)
						for (const id of fresh.reach) laidOut.add(id)
					}
					placeNewNodes(editor, new Set(view.create.map((c) => c.def.nodeId).filter((id) => !laidOut.has(id))))
				}
				for (const treeId of redraw) drawPrerequisites(editor, treeId)
				if (view.create.length || view.hide.length || view.mountsStale) drawMounts(editor)
			},
			{ history: 'ignore' }
		)
	} finally {
		syncing = false
	}
}

/**
 * What the board's views want changed: nodes they reach that have no shape here yet, and node shapes
 * of the trees they cover that they no longer reach (hidden from this board; the vault keeps them).
 * A board without headers has no views and is left as it is.
 */
function planViews(editor: Editor, headers: readonly TreeShape[], going: ReadonlySet<string>) {
	const plan = { create: [] as { treeId: string; def: NodeDef; at: { x: number; y: number } }[], hide: [] as SkillShape[], fresh: [] as { start: string; anchor: { x: number; y: number }; reach: Set<string> }[], trees: new Set<string>(), mountsStale: false }
	if (!headers.length) return plan
	const graph = treeGraph(boardTrees(editor))
	const shapes = new Map([...nodeShapes(editor)].filter(([, s]) => !going.has(s.id)))
	const reached = new Set<string>()
	for (const header of headers) {
		const start = viewStart(graph, header.props)
		if (!start) continue
		const reach = reachFrom(graph, start)
		for (const id of reach) reached.add(id)
		// Nothing of this view on the board yet: it is laid out whole, the root below its header.
		if (![...reach].some((id) => shapes.has(id))) {
			const b = editor.getShapePageBounds(header.id)
			plan.fresh.push({ start, reach, anchor: { x: b?.center.x ?? 0, y: (b?.maxY ?? 0) + 260 } })
		}
	}
	const covered = new Set([...headers.map((h) => h.props.treeId), ...[...reached].map((id) => graph.nodes.get(id)!.treeId)])
	for (const id of reached) {
		if (shapes.has(id)) continue
		const node = graph.nodes.get(id)!
		const fresh = plan.fresh.find((f) => f.reach.has(id))
		plan.create.push({ treeId: node.treeId, def: node.def, at: fresh?.anchor ?? editor.getViewportPageBounds().center })
		plan.trees.add(node.treeId)
	}
	for (const shape of shapes.values()) {
		if (!live(shape) || reached.has(shape.props.nodeId) || !covered.has(shape.props.treeId)) continue
		plan.hide.push(shape)
		plan.trees.add(shape.props.treeId)
	}
	// Mount arrows: redrawn when the arrows on the board don't match the mounts that can be drawn.
	const want = graph.mounts.filter((m) => shapes.has(m.from) && shapes.has(m.to)).map((m) => `${m.from}>${m.to}`).sort()
	const have = editor
		.getCurrentPageShapes()
		.filter((s) => s.type === 'arrow' && String(s.meta[SKILL_EDGE_META] ?? '').startsWith('mount:'))
		.map((a) => {
			const ends = editor.getBindingsFromShape(a, 'arrow')
			const end = (t: string) => {
				const target = editor.getShape(ends.find((b) => b.props.terminal === t)?.toId as never)
				return isSkill(target) ? target.props.nodeId : '?'
			}
			return `${end('start')}>${end('end')}`
		})
		.sort()
	plan.mountsStale = want.join() !== have.join()
	return plan
}

import { createShapeId, react, type Editor, type TLShape, type TLShapeId } from '@lifeboard/canvas'
import { isImporting, onImportEnd } from './importing'
import { getItems, getSkillIndex } from './syllabus'
import { getHabitIndex } from './skillIndex'
import { styleArrows } from './tree/arrowStyle'
import { isDraft, isSkill, isTree, SKILL_TYPE, TREE_TYPE, type SkillShape, type TreeShape } from './board'
import { drawMounts, drawPrerequisites } from './tree/ops'
import { applyViews, frameView, planIsEmpty, planViews, refreshStale, curveSkillArrows } from './tree/viewSync'
import { boardTrees, treeGraph, type ViewContents } from './views'
import { watchPhysics } from './tree/physics'
import { sizeOfKind } from './skill/definition'
import {
	getTreeDef,
	getTreeDefs,
	NODE_FIELDS,
	reconcile,
	removeNodeDef,
	updateTreeMeta,
	upsertNodeDef,
	upsertNodeDefs,
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

/** What decides which nodes a header's view shows. */
const VIEW_FIELDS = ['root', 'treeId', 'mode'] as const

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
		if (isImporting()) return void touchedBy(editor).add(shape.id)
		if (live(shape)) upsertNodeDef(shape.props.treeId, nodeDefOf(shape))
		// A header for a tree the vault has named takes the vault's name; otherwise it names the tree.
		else if (liveHeader(shape) && !getTreeDef(shape.props.treeId)?.name) updateTreeMeta(shape.props.treeId, metaOf(shape))
		else if (liveHeader(shape)) schedule(editor)
	})
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (syncing) return
		if (isImporting()) return void touchedBy(editor).add(next.id)
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
		}
		// A view switched (everything, skill nodes, another root) shows different nodes: a draft's as well.
		if (isTree(next) && isTree(prev) && VIEW_FIELDS.some((f) => prev.props[f] !== next.props[f])) schedule(editor)
	})
	editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		// Deleting a node on a board deletes it from its tree; undo writes it back. A bulk change only
		// ever deletes drafts, which the vault never had.
		if (isImporting()) return
		if (!syncing && live(shape)) removeNodeDef(shape.props.treeId, shape.props.nodeId)
		if (!syncing && liveHeader(shape)) schedule(editor)
	})

	// Trees decide which skill nodes a view shows; items (their tags, their works) which entries.
	const stop = react('lifeboard:skill-tree-sync', () => {
		getTreeDefs()
		getItems()
		schedule(editor)
	})
	// What is unlocked decides which arrows are dotted (tree/arrowStyle.ts): restyled after the change.
	const stopStyle = react('lifeboard:skill-arrow-style', () => {
		getSkillIndex()
		getHabitIndex()
		getTreeDefs()
		queueMicrotask(() => {
			if (!disposed.has(editor)) styleArrows(editor)
		})
	})
	// Dragging a tree node pulls its branch and eases the board to rest (tree/physics.ts).
	const stopPhysics = watchPhysics(editor)
	editor.disposables.add(() => {
		stop()
		stopStyle()
		stopPhysics()
		disposed.add(editor)
	})
}

const disposed = new WeakSet<Editor>()

/** Shapes a bulk change created or changed, written to the vault once it ends (importing.ts). */
const touched = new WeakMap<Editor, Set<TLShapeId>>()
const touchedBy = (editor: Editor) => {
	let set = touched.get(editor)
	if (!set) touched.set(editor, (set = new Set()))
	return set
}

onImportEnd((editor) => {
	const ids = touched.get(editor)
	touched.delete(editor)
	const byTree = new Map<string, NodeDef[]>()
	for (const id of ids ?? []) {
		const shape = editor.getShape(id)
		// Still a draft (an import) stays out of the vault; confirmed or merged in place goes in.
		if (live(shape)) byTree.set(shape.props.treeId, [...(byTree.get(shape.props.treeId) ?? []), nodeDefOf(shape)])
		else if (liveHeader(shape)) updateTreeMeta(shape.props.treeId, metaOf(shape))
	}
	for (const [treeId, nodes] of byTree) upsertNodeDefs(treeId, nodes)
	if (watched.has(editor)) schedule(editor)
})

const pending = new WeakSet<Editor>()

/** Runs `syncBoard` once, after the current change has finished. */
function schedule(editor: Editor): void {
	if (pending.has(editor)) return
	pending.add(editor)
	queueMicrotask(() => {
		pending.delete(editor)
		// A bulk change held across awaits (importing.ts) schedules again when it ends.
		if (!disposed.has(editor) && !isImporting()) syncBoard(editor)
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
		upsertNodeDefs(treeId, plan.adopt)
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
	// Every header is a view, a draft's too: reviewing a draft is when you most want to look inside it.
	const views = shapes.filter((s): s is TreeShape => isTree(s) && !!s.props.treeId)
	const view = planViews(editor, views, new Set(removals.map((s) => s.id)))
	for (const treeId of view.trees) redraw.add(treeId)
	// A tree whose nodes require another tree's draws those arrows too, so it redraws with that tree.
	if (redraw.size) {
		const graph = treeGraph(boardTrees(editor))
		for (const e of graph.prerequisites) {
			const from = graph.nodes.get(e.from)?.treeId
			const to = graph.nodes.get(e.to)?.treeId
			if (from && to && from !== to && redraw.has(from)) redraw.add(to)
		}
	}
	// A node is as big as its kind: the Mastery node, the middle of it all, large; every other the same.
	const resizes = [...byTree.values()].flat().flatMap((s) => {
		const kind = updates.find((u) => u.shape.id === s.id)?.def.kind ?? s.props.kind
		const size = sizeOfKind(kind)
		const b = editor.getShapePageBounds(s.id)
		if (!b || (Math.abs(b.w - size) < 0.5 && Math.abs(b.h - size) < 0.5)) return []
		return [{ id: s.id, type: SKILL_TYPE, x: s.x + (b.w - size) / 2, y: s.y + (b.h - size) / 2, props: { w: size, h: size } }]
	})
	if (!removals.length && !updates.length && !headerUpdates.length && !resizes.length && planIsEmpty(view)) return refreshStale(editor)

	let laidOutNew: ViewContents[] = []
	syncing = true
	try {
		editor.run(
			() => {
				if (removals.length) editor.deleteShapes(removals.map((s) => s.id))
				editor.updateShapes([
					...updates.map(({ shape, def }) => {
						// The draft mark lives in the vault only; the shape reads it from there.
						const { nodeId, draft, ...props } = def
						void nodeId
						void draft
						return { id: shape.id, type: SKILL_TYPE, props }
					}),
					...headerUpdates,
					...resizes,
				] as never)
				laidOutNew = applyViews(editor, view)
				for (const treeId of redraw) drawPrerequisites(editor, treeId)
				const mounts = view.createSkills.length || view.remove.length || view.mountsStale
				if (mounts) drawMounts(editor)
				// The tree's arrows are drawn after the views laid out and tidied their lines: bent now.
				if (redraw.size || mounts || laidOutNew.length) curveSkillArrows(editor)
			},
			{ history: 'ignore' }
		)
	} finally {
		syncing = false
	}
	refreshStale(editor)
	styleArrows(editor)
	// Coming into an arrangement, or a tree new to the board, brings the camera to it.
	const switched = view.views.find((v) => v.from !== null)?.view ?? laidOutNew[0]
	if (switched) frameView(editor, switched)
}

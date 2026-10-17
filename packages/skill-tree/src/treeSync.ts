import { react, type Editor, type TLShape } from '@lifeboard/canvas'
import { isDraft, isSkill, isTree, SKILL_TYPE, TREE_TYPE, type SkillShape, type TreeShape } from './board'
import { drawPrerequisites } from './tree/ops'
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
		// A header for a tree the vault knows takes the vault's name; a new one names its tree.
		else if (liveHeader(shape) && !getTreeDef(shape.props.treeId)) updateTreeMeta(shape.props.treeId, metaOf(shape))
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
		} else if (liveHeader(next) && liveHeader(prev) && HEADER_FIELDS.some((f) => prev.props[f] !== next.props[f])) {
			updateTreeMeta(next.props.treeId, metaOf(next))
		}
	})
	editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		// Deleting a node on a board deletes it from its tree; undo writes it back.
		if (!syncing && live(shape)) removeNodeDef(shape.props.treeId, shape.props.nodeId)
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
	if (!removals.length && !updates.length && !headerUpdates.length) return

	syncing = true
	try {
		editor.run(
			() => {
				if (removals.length) editor.deleteShapes(removals.map((s) => s.id))
				editor.updateShapes([
					...updates.map(({ shape, def }) => {
						const { nodeId, ...props } = def
						void nodeId
						return { id: shape.id, type: SKILL_TYPE, props }
					}),
					...headerUpdates,
				] as never)
				for (const treeId of redraw) drawPrerequisites(editor, treeId)
			},
			{ history: 'ignore' }
		)
	} finally {
		syncing = false
	}
}

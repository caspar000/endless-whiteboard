import { createShapeId, type Editor, type TLShape } from '@lifeboard/canvas'
import { parse as parseYaml } from 'yaml'
import { isDraft, isSkill, isTree, TREE_TYPE } from './board'
import { confirmTreeDrafts, discardTreeDrafts, getTreeDef, hasTreeDrafts, updateTreeMeta, upsertNodeDefs } from './treeDefs'
import { getTreePrefs } from './treePrefs'
import type { DocTree } from './treeYaml'
import { draftTreeMeta } from './views'

/**
 * Trees in and out of a board (docs/skill-tree-plan.md, "Drafts"), for an extension whose documents
 * carry trees (the syllabus's YAML). Call inside the caller's `editor.run` and `whileImporting`.
 *
 * Trees go into the vault, a new tree and new nodes as this board's draft. The board gets a header
 * to view each (one mounted on a node of another tree in the same document shows inside that tree's
 * view instead); the view puts the nodes on and lays them out (treeSync.ts).
 */
export function importTrees(editor: Editor, trees: readonly DocTree[], at: { x: number; y: number }, board: string): { created: number; updated: number } {
	let created = 0
	let updated = 0
	const inDoc = new Set(trees.flatMap((t) => t.nodes.map((n) => n.nodeId)))
	let headerY = at.y
	for (const tree of trees) {
		const had = getTreeDef(tree.treeId)
		const known = new Set(had?.nodes.map((n) => n.nodeId))
		upsertNodeDefs(
			tree.treeId,
			tree.nodes.map(({ nodeId, name, kind, icon, sector, ring, requires }) => ({ nodeId, name, kind, icon, sector, ring, requires, ...(known.has(nodeId) ? {} : { draft: board }) }))
		)
		updated += tree.nodes.filter((n) => known.has(n.nodeId)).length
		created += tree.nodes.filter((n) => !known.has(n.nodeId)).length
		updateTreeMeta(tree.treeId, {
			name: tree.name,
			goal: tree.goal,
			sectors: tree.sectors.join(', '),
			rings: tree.rings.join(', '),
			// A document that names no mount leaves the tree hanging where it hangs.
			...(tree.mounts.length ? { mounts: tree.mounts } : {}),
			...(had ? {} : { draft: board }),
		})
		if (tree.mounts.some((m) => inDoc.has(m))) continue
		const header = editor.getCurrentPageShapes().find((s) => isTree(s) && s.props.treeId === tree.treeId)
		const props = { name: tree.name, goal: tree.goal, layout: tree.layout, sectors: tree.sectors.join(', '), rings: tree.rings.join(', ') }
		if (header) {
			editor.updateShape({ id: header.id, type: TREE_TYPE, props } as never)
			updated++
		} else {
			editor.createShape({
				id: createShapeId(),
				type: TREE_TYPE,
				parentId: editor.getCurrentPageId(),
				x: at.x,
				y: headerY,
				props: { ...props, treeId: tree.treeId, mode: getTreePrefs().importShows },
			} as never)
			headerY += 2400
		}
	}
	return { created, updated }
}

/**
 * Confirms what imports on this board added to the trees. A tree with no header of its own (mounted
 * on another) carries its name and mount on its draft nodes until now. Returns how much it touched.
 */
export function confirmTrees(editor: Editor, board: string): number {
	for (const shape of editor.getCurrentPageShapes()) {
		if (!isSkill(shape) || !isDraft(shape)) continue
		const meta = draftTreeMeta(shape)
		if (Object.keys(meta).length) updateTreeMeta(shape.props.treeId, meta)
	}
	return confirmTreeDrafts(board)
}

/**
 * Takes back what imports on this board added to the trees, and returns the node shapes to delete
 * with the rest of the draft: the vault forgets those nodes, so nothing on the board may stand for
 * them (the sync would otherwise take a stray shape for a node made offline).
 */
export function discardTrees(editor: Editor, board: string): { shapes: TLShape[]; nodes: number } {
	const gone = new Set(discardTreeDrafts(board))
	return { shapes: editor.getCurrentPageShapes().filter((s) => isSkill(s) && gone.has(s.props.nodeId)), nodes: gone.size }
}

export const boardHasTreeDraft = (board: string): boolean => hasTreeDrafts(board)

/** The goals this board's trees belong to. */
export function treeGoals(editor: Editor): string[] {
	return editor
		.getCurrentPageShapes()
		.filter((s) => !isDraft(s))
		.flatMap((s) => (isTree(s) ? [s.props.goal] : []))
}

/** One goal's first tree on this board, as the `tree:` part of a YAML document: the vault's tree, whole. */
export function treeDoc(editor: Editor, goal: string, anyGoal: boolean): Record<string, unknown> | null {
	const shapes = editor.getCurrentPageShapes().filter((s) => !isDraft(s))
	const tree = shapes.filter(isTree).find((t) => t.props.goal === goal || (!t.props.goal && anyGoal))
	if (!tree) return null
	// The vault's tree, whole: this board may show only a branch of it.
	const def = getTreeDef(tree.props.treeId)
	const nodes = def?.nodes ?? shapes.filter(isSkill).filter((s) => s.props.treeId === tree.props.treeId).map((s) => s.props)
	const tags = (raw: string) => raw.split(',').map((t) => t.trim()).filter(Boolean)
	return {
		id: tree.props.treeId,
		name: def?.name || tree.props.name,
		...(def?.mounts.length === 1 ? { mount: def.mounts[0] } : def?.mounts.length ? { mounts: def.mounts } : {}),
		...(tree.props.sectors ? { sectors: tags(tree.props.sectors) } : {}),
		...(tree.props.rings ? { rings: tags(tree.props.rings) } : {}),
		nodes: nodes.map((n) => ({
			id: n.nodeId,
			name: n.name,
			kind: n.kind,
			...(n.icon ? { icon: n.icon } : {}),
			...(n.sector ? { sector: n.sector } : {}),
			...(n.ring ? { ring: n.ring } : {}),
			...(n.requires ? { requires: parseYaml(n.requires) as unknown } : {}),
		})),
	}
}

/** The id prefix of a goal's first tree on this board, for naming a document. */
export function treePrefix(editor: Editor, goal: string, anyGoal: boolean): string {
	const tree = editor
		.getCurrentPageShapes()
		.filter((s) => !isDraft(s))
		.filter(isTree)
		.find((t) => t.props.goal === goal || (!t.props.goal && anyGoal))
	return tree?.props.treeId ?? ''
}

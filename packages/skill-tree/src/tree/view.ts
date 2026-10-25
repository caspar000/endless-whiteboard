import type { Editor } from '@lifeboard/canvas'
import { isTree, TREE_TYPE, type TreeShape, type ViewMode } from '../board'
import { allItems } from '../sources'
import { boardTrees, treeGraph, viewContents, type ViewContents } from '../views'

/**
 * A tree header's view (docs/skill-tree-layout-plan.md, "Views"): everything, or the skill nodes
 * only. Each switch is one undo step on the header; the board follows it (treeSync.ts), putting nodes
 * back where they were in that view, or laying out what has never been placed.
 */

/** What a header shows right now. */
export function contentsOf(editor: Editor, header: TreeShape): ViewContents {
	return viewContents(treeGraph(boardTrees(editor)), allItems(), header.props)
}

/** The header whose view shows this node or item: its own tree's first, else any that has it. */
export function viewHeaderFor(editor: Editor, id: string): TreeShape | undefined {
	const headers = editor.getCurrentPageShapes().filter(isTree)
	const showing = headers.filter((h) => {
		const view = contentsOf(editor, h)
		return view.skills.has(id) || view.items.has(id)
	})
	const graph = treeGraph(boardTrees(editor))
	const own = graph.nodes.get(id)?.treeId
	return showing.find((h) => h.props.treeId === own) ?? showing[0]
}

/** Switches a header to a view. One undo step. */
export function setView(editor: Editor, header: TreeShape, mode: ViewMode): void {
	if (header.props.mode === mode) return
	editor.run(() => {
		editor.markHistoryStoppingPoint(`show ${mode}`)
		editor.updateShape({ id: header.id, type: TREE_TYPE, props: { mode } } as never)
	})
}

/**
 * Every view on this board to everything, or back to the skill nodes when one already shows
 * everything. One undo step.
 */
export function toggleAllNodes(editor: Editor): void {
	const headers = editor.getCurrentPageShapes().filter(isTree)
	const mode: ViewMode = headers.some((h) => h.props.mode === 'all') ? 'overview' : 'all'
	editor.run(() => {
		editor.markHistoryStoppingPoint(`show ${mode}`)
		editor.updateShapes(headers.map((h) => ({ id: h.id, type: TREE_TYPE, props: { mode } })) as never)
	})
}

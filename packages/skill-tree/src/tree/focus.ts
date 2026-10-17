import type { Editor } from '@lifeboard/canvas'
import { isTree, TREE_TYPE, type TreeShape, type ViewMode } from '../board'
import { getItems } from '../syllabus'
import { getTreePrefs } from '../treePrefs'
import { boardTrees, treeGraph, viewContents, type ViewContents } from '../views'

/**
 * Focus mode and the other arrangements of a tree view (docs/skill-tree-plan.md, "Rebuild"). Each
 * switch is one undo step on the header; the board follows it (treeSync.ts), putting nodes back where
 * they were in that arrangement, or laying out what has never been placed.
 */

/** How far a header's focus reaches: its own override, else the default from Settings. */
export const depthOf = (header: TreeShape): number => (header.props.depth >= 0 ? header.props.depth : getTreePrefs().focusDepth)

/** What a header shows right now. */
export function contentsOf(editor: Editor, header: TreeShape): ViewContents {
	return viewContents(treeGraph(boardTrees(editor)), getItems(), header.props, depthOf(header))
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

/** Switches a header to an arrangement. One undo step. */
export function setView(editor: Editor, header: TreeShape, mode: ViewMode, focus = ''): void {
	if (header.props.mode === mode && header.props.focus === focus) return
	editor.run(() => {
		editor.markHistoryStoppingPoint(mode === 'focus' ? 'focus' : `show ${mode}`)
		editor.updateShape({ id: header.id, type: TREE_TYPE, props: { mode, focus } } as never)
	})
}

/** Focuses the view showing this node or item on it. False when no view on this board shows it. */
export function focusOn(editor: Editor, id: string): boolean {
	const header = viewHeaderFor(editor, id)
	if (!header) return false
	setView(editor, header, 'focus', id)
	return true
}

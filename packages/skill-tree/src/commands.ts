import type { Command } from '@lifeboard/node-kit'
import type { Editor } from '@lifeboard/canvas'
import { isSkill, isTree, MASTERY, type SkillShape } from './board'
import { drawPrerequisites, layoutFrom, layoutTree, selectedTreeId, showMastery, treeHeader } from './tree/ops'
import { recalculate } from './tree/viewSync'
import { contentsOf, toggleAllNodes } from './tree/view'
import { recalculateAll } from './tree/StaleLayout'
import { TUNER_TYPE } from './tree/LayoutTuner'
import { isDevBuild } from './env'

/** The skill tree's verbs for ⌘K. "Add skill node" is generated from the node type. */
const GROUP = 'Skill trees'

/** The one skill node selected, other than a Mastery node (whose branch is the whole board). */
function selectedNode(editor: Editor): SkillShape | null {
	const selected = editor.getSelectedShapes()
	const only = selected.length === 1 ? selected[0] : undefined
	return isSkill(only) && only.props.kind !== MASTERY ? only : null
}

export const skillTreeCommands: readonly Command[] = [
	{
		id: 'skill-tree.draw-prerequisites',
		title: 'Redraw prerequisite lines',
		group: GROUP,
		when: (ctx) => !!ctx.editor && selectedTreeId(ctx.editor) !== null,
		run: ({ editor }) => {
			const treeId = editor && selectedTreeId(editor)
			if (!editor || !treeId) return
			editor.run(() => {
				editor.markHistoryStoppingPoint('redraw prerequisites')
				drawPrerequisites(editor, treeId)
			})
		},
	},
	{
		id: 'skill-tree.layout',
		title: 'Lay out tree',
		group: GROUP,
		when: (ctx) => !!ctx.editor && selectedTreeId(ctx.editor) !== null,
		run: ({ editor }) => {
			const treeId = editor && selectedTreeId(editor)
			if (!editor || !treeId) return
			const header = treeHeader(editor, treeId)
			if (header) recalculate(editor, header)
			else layoutTree(editor, treeId)
		},
	},
	{
		id: 'skill-tree.layout-from-here',
		title: 'Lay out from this node',
		group: GROUP,
		when: (ctx) => !!ctx.editor && selectedNode(ctx.editor) !== null,
		run: ({ editor }) => {
			const node = editor && selectedNode(editor)
			if (editor && node) layoutFrom(editor, node)
		},
	},
	{
		id: 'skill-tree.add-mastery',
		title: 'Add Mastery to this board',
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: ({ editor }) => {
			if (!editor) return
			const header = showMastery(editor)
			// The view fills in after the change (treeSync.ts); then show all of it.
			setTimeout(() => {
				const shown = header ? contentsOf(editor, header).skills : new Set<string>()
				const nodes = editor.getCurrentPageShapes().filter((s) => isSkill(s) && shown.has(s.props.nodeId))
				if (!nodes.length) return
				editor.setSelectedShapes(nodes.map((n) => n.id))
				const bounds = editor.getSelectionPageBounds()
				editor.selectNone()
				if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 250 } })
			}, 0)
		},
	},
	{
		id: 'skill-tree.layout-tuner',
		title: 'Add the layout tuner (dev)',
		group: GROUP,
		// For working on the layout: every setting of it on a card, laying the board out again live.
		when: (ctx) => ctx.editor !== null && isDevBuild,
		run: ({ editor }) => {
			if (!editor) return
			const c = editor.getViewportPageBounds()
			editor.createShape({ type: TUNER_TYPE, x: c.minX + 40, y: c.minY + 40 } as never)
		},
	},
	{
		id: 'skill-tree.recalculate',
		title: 'Re-calculate the tree layout',
		group: GROUP,
		when: (ctx) => !!ctx.editor && ctx.editor.getCurrentPageShapes().some(isTree),
		run: ({ editor }) => {
			if (editor) recalculateAll(editor)
		},
	},
	{
		id: 'skill-tree.toggle-all',
		title: 'Show all nodes or only skill nodes',
		group: GROUP,
		kbd: 'shift+e',
		when: (ctx) => !!ctx.editor && ctx.editor.getCurrentPageShapes().some(isTree),
		run: ({ editor }) => {
			if (editor) toggleAllNodes(editor)
		},
	},
]

import type { Command } from '@lifeboard/node-kit'
import type { Editor } from '@lifeboard/canvas'
import { isSkill, isTree, MASTERY, type SkillShape } from './board'
import { drawPrerequisites, gatherAroundMastery, layoutFrom, layoutTree, selectedTreeId, treeHeader } from './tree/ops'
import { recalculate } from './tree/viewSync'
import { toggleAllNodes } from './tree/view'
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
			// The Mastery node's tree is every tree on the board.
			if (treeId === MASTERY) gatherAroundMastery(editor)
			else {
				const header = treeHeader(editor, treeId)
				if (header) recalculate(editor, header)
				else layoutTree(editor, treeId)
			}
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
		id: 'skill-tree.gather-mastery',
		title: 'Gather every tree around a Mastery node',
		group: GROUP,
		when: (ctx) => !!ctx.editor && ctx.editor.getCurrentPageShapes().some((s) => isSkill(s) && s.props.kind !== MASTERY),
		run: ({ editor }) => {
			if (editor) gatherAroundMastery(editor)
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

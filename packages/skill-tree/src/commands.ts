import type { Command } from '@lifeboard/node-kit'
import type { Editor } from '@lifeboard/canvas'
import { isItem, isSkill, isTree, MASTERY, type SkillShape } from './board'
import { tick } from './ops'
import { getItem } from './syllabus'
import { drawPrerequisites, gatherAroundMastery, layoutFrom, layoutTree, selectedTreeId, treeHeader } from './tree/ops'
import { recalculate } from './tree/viewSync'
import { insertMasteryDemo } from './tree/masteryDemo'
import { toggleAllNodes } from './tree/view'
import { recalculateAll } from './tree/StaleLayout'
import { TUNER_TYPE } from './tree/LayoutTuner'
import { insertWholeLifeTest, isAutomated, isDevBuild } from './tree/wholeLifeTest'
import { insertAdlerTree } from './tree/sample'

/**
 * The syllabus verbs for ⌘K. "Add syllabus item" and "Add track" are generated from the node types.
 *
 * No default `kbd` yet: the plan's ⌘↵ for "Complete item" waits until it is checked against
 * tldraw's own bindings, and a clash would not warn, it would just make the key do something else.
 */
const GROUP = 'Syllabus'

/** The vault items behind the selected cards. */
const selectedCards = (editor: Editor): string[] => editor.getSelectedShapes().filter(isItem).map((card) => card.props.itemId)

/** The one skill node selected, other than a Mastery node (whose branch is the whole board). */
function selectedNode(editor: Editor): SkillShape | null {
	const selected = editor.getSelectedShapes()
	const only = selected.length === 1 ? selected[0] : undefined
	return isSkill(only) && only.props.kind !== MASTERY ? only : null
}

export const skillTreeCommands: readonly Command[] = [
	{
		id: 'skill-tree.complete',
		title: 'Complete or reopen item',
		group: GROUP,
		when: (ctx) => !!ctx.editor && selectedCards(ctx.editor).some((id) => getItem(id)?.children.length === 0),
		run: ({ editor }) => {
			if (!editor) return
			for (const card of editor.getSelectedShapes().filter(isItem)) {
				const item = getItem(card.props.itemId)
				if (item && !item.children.length) tick(editor, item.itemId, !item.done, card.id)
			}
		},
	},
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
		id: 'skill-tree.insert-mastery-demo',
		title: 'Insert the Mastery demo (five pillars)',
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: ({ editor }) => {
			if (!editor) return
			const bounds = editor.getCurrentPageBounds()
			insertMasteryDemo(editor, bounds ? { x: bounds.maxX + 400, y: bounds.minY } : editor.getViewportPageBounds().center)
			const all = editor.getCurrentPageShapes().filter((s) => isSkill(s)).map((s) => s.id)
			editor.setSelectedShapes(all)
			const b = editor.getSelectionPageBounds()
			editor.selectNone()
			if (b) editor.zoomToBounds(b, { animation: { duration: 250 } })
		},
	},
	{
		id: 'skill-tree.whole-life-test',
		title: 'Insert the whole-life test board (dev)',
		group: GROUP,
		// For working on the layout, and for the e2e checks of the renderer (a browser under automation
		// runs the production build); not something to ship to anyone.
		when: (ctx) => ctx.editor !== null && (isDevBuild || isAutomated()),
		run: async ({ editor }) => {
			if (!editor) return
			const bounds = editor.getCurrentPageBounds()
			await insertWholeLifeTest(editor, bounds ? { x: bounds.maxX + 400, y: bounds.minY } : editor.getViewportPageBounds().center)
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
	{
		id: 'skill-tree.insert-adler-tree',
		title: "Insert Adler's skill tree (sample)",
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: ({ editor }) => {
			if (!editor) return
			const { center } = editor.getViewportPageBounds()
			const id = insertAdlerTree(editor, { x: center.x, y: center.y })
			editor.setSelectedShapes([id])
		},
	},
]

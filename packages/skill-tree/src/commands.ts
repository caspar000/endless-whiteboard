import type { Command, CommandContext } from '@lifeboard/node-kit'
import type { Editor } from '@lifeboard/canvas'
import { childrenOf, isItem, isSkill, isTrack, MASTERY, type ItemShape, type SkillShape } from './board'
import { addSelectionToTrack, arrangeChildren, setCollapsed, toggleItemDone, trackFromSelection } from './ops'
import { insertAdlerSample } from './sample'
import { drawPrerequisites, gatherAroundMastery, layoutFrom, layoutTree, selectedTreeId } from './tree/ops'
import { insertAdlerTree } from './tree/sample'

/**
 * The syllabus verbs for ⌘K. "Add syllabus item" and "Add track" are generated from the node types.
 *
 * No default `kbd` yet: the plan's ⌘↵ for "Complete item" waits until it is checked against
 * tldraw's own bindings, and a clash would not warn, it would just make the key do something else.
 */
const GROUP = 'Syllabus'

const selectedItems = (editor: Editor): ItemShape[] => editor.getSelectedShapes().filter(isItem)
const oneItem = (ctx: CommandContext): ItemShape | null => {
	if (!ctx.editor) return null
	const items = selectedItems(ctx.editor)
	return items.length === 1 && ctx.editor.getSelectedShapeIds().length === 1 ? (items[0] ?? null) : null
}
const hasChildren = (ctx: CommandContext) => {
	const item = oneItem(ctx)
	return !!item && !!ctx.editor && childrenOf(ctx.editor, item.id).length > 0
}

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
		when: (ctx) =>
			!!ctx.editor && selectedItems(ctx.editor).some((item) => childrenOf(ctx.editor!, item.id).length === 0),
		run: ({ editor }) => {
			if (!editor) return
			for (const item of selectedItems(editor)) toggleItemDone(editor, item.id)
		},
	},
	{
		id: 'skill-tree.toggle-children',
		title: 'Collapse or expand children',
		group: GROUP,
		when: hasChildren,
		run: (ctx) => {
			const item = oneItem(ctx)
			if (item && ctx.editor) setCollapsed(ctx.editor, item.id, !item.props.collapsed)
		},
	},
	{
		id: 'skill-tree.arrange-children',
		title: 'Arrange children',
		group: GROUP,
		when: hasChildren,
		run: (ctx) => {
			const item = oneItem(ctx)
			if (item && ctx.editor) arrangeChildren(ctx.editor, item.id)
		},
	},
	{
		id: 'skill-tree.track-from-selection',
		title: 'Make a track from selected items',
		group: GROUP,
		when: (ctx) => !!ctx.editor && selectedItems(ctx.editor).some((item) => !item.props.parentId),
		run: ({ editor }) => {
			if (editor) trackFromSelection(editor)
		},
	},
	{
		id: 'skill-tree.add-to-track',
		title: 'Add selection to track',
		group: GROUP,
		when: (ctx) =>
			!!ctx.editor &&
			ctx.editor.getSelectedShapes().filter(isTrack).length === 1 &&
			selectedItems(ctx.editor).some((item) => !item.props.parentId),
		run: ({ editor }) => {
			if (editor) addSelectionToTrack(editor)
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
		id: 'skill-tree.gather-mastery',
		title: 'Gather every tree around a Mastery node',
		group: GROUP,
		when: (ctx) => !!ctx.editor && ctx.editor.getCurrentPageShapes().some((s) => isSkill(s) && s.props.kind !== MASTERY),
		run: ({ editor }) => {
			if (editor) gatherAroundMastery(editor)
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
	{
		id: 'skill-tree.insert-adler-sample',
		title: "Insert Adler's reading list (sample)",
		group: GROUP,
		when: (ctx) => ctx.editor !== null,
		run: ({ editor }) => {
			if (!editor) return
			const { center } = editor.getViewportPageBounds()
			const id = insertAdlerSample(editor, { x: center.x - 400, y: center.y - 300 })
			editor.setSelectedShapes([id])
		},
	},
]

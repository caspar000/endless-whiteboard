import { defineOperation, fail, ok, type RegisteredOperation } from '@lifeboard/node-kit'
import { createShapeId } from '@lifeboard/canvas'
import { isSkill, type SkillShape } from './board'
import { gatherAroundMastery, layoutFrom, layoutTree, treeHeader } from './tree/ops'
import { getTreeDef, getTreeDefs, updateTreeMeta } from './treeDefs'
import { treeGraph } from './views'

/** The skill tree for the agent: laying a tree out, showing one on a board, hanging one from a node. */

const NO_BOARD = 'No board is open. Open a board and try again.'

export const treeOperations: readonly RegisteredOperation[] = [
	defineOperation({
		id: 'skill.tree.layout',
		title: 'Lay out a skill tree',
		description:
			'Places a skill tree on the open board so no nodes overlap and no line runs through a node: the tree from its root, one node and everything depending on it, or every tree around a Mastery node. One undo step.',
		params: {
			treeId: { type: 'string', description: 'The tree to lay out, e.g. "adler". Leave empty with mastery set.' },
			from: { type: 'string', description: 'A node id: lay out only it and what depends on it, around where it stands.' },
			mastery: { type: 'boolean', description: 'True to gather every tree on the board around a Mastery node (made if missing).' },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			if (args.mastery) return ok({ moved: gatherAroundMastery(editor) })
			if (args.from) {
				const node = editor.getCurrentPageShapes().find((s): s is SkillShape => isSkill(s) && s.props.nodeId === args.from)
				return node ? ok({ moved: layoutFrom(editor, node) }) : fail(`No node "${args.from}" on this board.`)
			}
			if (!args.treeId) return fail('Name a treeId, a from node, or set mastery.')
			const moved = layoutTree(editor, args.treeId)
			return moved ? ok({ moved }) : fail(`No tree "${args.treeId}" on this board.`)
		},
	}),
	defineOperation({
		id: 'skill.tree.show',
		title: 'Show a skill tree on this board',
		description:
			'Puts a view of a skill tree from the vault on the open board: a header and the nodes it reaches from its root (or from the node given), laid out, trees mounted on them included. The same tree can be shown on any number of boards, each from its own root; edits on any of them change the one tree.',
		params: {
			tree: { type: 'string', description: 'The tree id.', required: true, liveChoices: () => Object.keys(getTreeDefs()).sort() },
			root: { type: 'string', description: 'A node id to show the tree from (that node and what grows from it). Optional.' },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			const def = getTreeDef(args.tree)
			if (!def) return fail(`No tree "${args.tree}". Trees: ${Object.keys(getTreeDefs()).join(', ') || 'none yet'}.`)
			if (args.root && !treeGraph(getTreeDefs()).nodes.has(args.root)) return fail(`No node "${args.root}" in the vault.`)
			if (treeHeader(editor, args.tree)) return fail(`This board already shows "${def.name || args.tree}". Change its root in the header's editor instead.`)
			const c = editor.getViewportPageBounds().center
			editor.run(() => {
				editor.markHistoryStoppingPoint('show skill tree')
				editor.createShape({
					id: createShapeId(),
					type: 'node.skillTree',
					x: c.x - 140,
					y: c.y - 300,
					props: { treeId: def.treeId, name: def.name, goal: def.goal, sectors: def.sectors, rings: def.rings, root: args.root ?? '' },
				} as never)
			})
			// The board fills the view in after the change (treeSync.ts); give it that turn.
			await new Promise((resolve) => setTimeout(resolve, 0))
			return ok({ shown: def.treeId, nodes: editor.getCurrentPageShapes().filter((s) => isSkill(s)).length })
		},
	}),
	defineOperation({
		id: 'skill.tree.mount',
		title: 'Hang a skill tree from a node',
		description:
			'Mounts a tree on a node of another tree (a pillar, Mastery), so any view of that node shows the tree as its branch. Empty "on" takes the mount away. Vault data: it changes every board.',
		params: {
			tree: { type: 'string', description: 'The tree to hang.', required: true, liveChoices: () => Object.keys(getTreeDefs()).sort() },
			on: { type: 'string', description: 'The node id to hang it from, e.g. "mastery/mental". Empty to unmount.' },
		},
		run: async (_ctx, args) => {
			if (!getTreeDef(args.tree)) return fail(`No tree "${args.tree}".`)
			const graph = treeGraph(getTreeDefs())
			const on = args.on ?? ''
			if (on && !graph.nodes.has(on)) return fail(`No node "${on}" in the vault.`)
			if (on && graph.nodes.get(on)!.treeId === args.tree) return fail('A tree cannot hang from one of its own nodes.')
			updateTreeMeta(args.tree, { mount: on })
			return ok({ tree: args.tree, mount: on })
		},
	}),
]

import { defineOperation, fail, ok, type RegisteredOperation } from '@lifeboard/node-kit'
import { createShapeId } from '@lifeboard/canvas'
import { isSkill, MASTERY, type SkillShape } from './board'
import { layoutFrom, layoutTree, treeHeader } from './tree/ops'
import { getTreeDefs, updateTreeMeta } from './treeDefs'
import { getTreePrefs } from './treePrefs'
import { deleteTree, EMPTY_TREE, findMaker, findTree, makerLabels, makeTrees, treeLabels } from './treeMaking'
import { treeGraph } from './views'

/**
 * The skill tree for the agent, and through ⌘K for a person: making and deleting a tree, laying one
 * out, showing one on a board, hanging one from a node.
 */

const treeChoices = () => treeLabels().map((t) => t.label)
const noTree = (asked: string) => `No tree "${asked}". Trees: ${treeChoices().join(', ') || 'none yet'}.`

const NO_BOARD = 'No board is open. Open a board and try again.'

export const treeOperations: readonly RegisteredOperation[] = [
	defineOperation({
		id: 'skill.tree.layout',
		title: 'Lay out a skill tree',
		description:
			'Places a skill tree on the open board so no nodes overlap and no line runs through a node: the tree from its root, or one node and everything depending on it. One undo step.',
		params: {
			treeId: { type: 'string', description: 'The tree to lay out, e.g. "adler". Leave empty with from set.' },
			from: { type: 'string', description: 'A node id: lay out only it and what depends on it, around where it stands.' },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			if (args.from) {
				const node = editor.getCurrentPageShapes().find((s): s is SkillShape => isSkill(s) && s.props.nodeId === args.from)
				return node ? ok({ moved: layoutFrom(editor, node) }) : fail(`No node "${args.from}" on this board.`)
			}
			if (!args.treeId) return fail('Name a treeId or a from node.')
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
			tree: { type: 'string', description: 'The tree, by name or id.', required: true, liveChoices: treeChoices },
			root: { type: 'string', description: 'A node id to show the tree from (that node and what grows from it). Optional.' },
		},
		run: async (ctx, args) => {
			const editor = ctx.editor
			if (!editor) return fail(NO_BOARD)
			const def = findTree(args.tree)
			if (!def) return fail(noTree(args.tree))
			if (args.root && !treeGraph(getTreeDefs()).nodes.has(args.root)) return fail(`No node "${args.root}" in the vault.`)
			if (treeHeader(editor, def.treeId)) return fail(`This board already shows "${def.name || def.treeId}". Change its root in the header's editor instead.`)
			// Right of what is on the board, as Mastery goes, so it never lands on a list or a card.
			const bounds = editor.getCurrentPageBounds()
			const at = bounds ? { x: bounds.maxX + 400, y: bounds.minY } : editor.getViewportPageBounds().center
			editor.run(() => {
				editor.markHistoryStoppingPoint('show skill tree')
				editor.createShape({
					id: createShapeId(),
					type: 'node.skillTree',
					x: at.x,
					y: at.y,
					props: { treeId: def.treeId, name: def.name, goal: def.goal, sectors: def.sectors, rings: def.rings, root: args.root ?? '', mode: getTreePrefs().importShows },
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
			'Hangs a tree from nodes of other trees (usually pillars of Mastery, "mastery/mental"), so any view of those nodes shows the tree as their branch. A tree can hang from several nodes; it is drawn once. "on" replaces where it hangs; empty takes it down. Vault data: it changes every board.',
		params: {
			tree: { type: 'string', description: 'The tree to hang, by name or id.', required: true, liveChoices: treeChoices },
			on: { type: 'string', description: 'The node ids to hang it from, comma-separated, e.g. "mastery/mental, mastery/practical". Empty to take it down.' },
		},
		run: async (_ctx, args) => {
			const def = findTree(args.tree)
			if (!def) return fail(noTree(args.tree))
			const graph = treeGraph(getTreeDefs())
			const on = [...new Set((args.on ?? '').split(',').map((id) => id.trim()).filter(Boolean))]
			const missing = on.find((id) => !graph.nodes.has(id))
			if (missing) return fail(`No node "${missing}" in the vault.`)
			if (on.some((id) => graph.nodes.get(id)!.treeId === def.treeId)) return fail('A tree cannot hang from one of its own nodes.')
			updateTreeMeta(def.treeId, { mounts: on })
			return ok({ tree: def.treeId, mounts: on })
		},
	}),
	defineOperation({
		id: 'skill.tree.make',
		title: 'Make a skill tree',
		description: [
			'Makes a skill tree in the vault from something that offers one (a syllabus, by name or id), or an empty tree.',
			"A syllabus whose file had a tree: block makes that tree; one without makes a path of its entries from a root, each lit when its entry is done, in any order.",
			'Several, separated by ";", make a tree each; with root set, they hang from one new root of that name and go as one.',
			'The tree is on no board and under no pillar until asked: skill.tree.show puts it on a board, skill.tree.mount hangs it.',
		].join(' '),
		params: {
			from: {
				type: 'string',
				description: `What to make it from: a syllabus name or id, several separated by ";", or "${EMPTY_TREE}".`,
				required: true,
				liveChoices: () => [...makerLabels().map((m) => m.label), EMPTY_TREE],
			},
			name: { type: 'string', description: 'For an empty tree, its name. Optional otherwise.' },
			root: { type: 'string', description: 'With several, the name of a shared root to hang them all from. Optional.' },
		},
		run: async (_ctx, args) => {
			const asked = args.from.split(';').map((f) => f.trim()).filter(Boolean)
			const empty = asked.length === 1 && asked[0] === EMPTY_TREE
			const makers = empty ? [] : asked.map((f) => findMaker(f))
			const unknown = asked.filter((_, i) => !empty && !makers[i])
			if (unknown.length) return fail(`Nothing to make a tree from called ${unknown.map((u) => `"${u}"`).join(', ')}. Choices: ${makerLabels().map((m) => m.label).join(', ') || 'none'}.`)
			// ⌘K asks only for what is required: an empty tree it can't name is called "New tree".
			const name = args.root ?? args.name ?? (empty ? 'New tree' : undefined)
			try {
				const result = makeTrees(
					makers.map((m) => m!.id),
					{ name, sharedRoot: !!args.root }
				)
				return ok({ ...result, next: 'Show it with skill.tree.show, or hang it under a Mastery pillar with skill.tree.mount.' })
			} catch (error) {
				return fail(error instanceof Error ? error.message : String(error))
			}
		},
	}),
	defineOperation({
		id: 'skill.tree.delete',
		title: 'Delete a skill tree',
		description:
			'Deletes a skill tree from the vault and from every board that shows it, Mastery included, with the branches made together with it (a shared root\'s). Trees hung from it stay, unhung. Ticks on syllabus items stay; hand ticks on its nodes go. Only when the user asked for it.',
		params: {
			tree: { type: 'string', description: 'The tree, by name or id.', required: true, liveChoices: treeChoices },
		},
		run: async (_ctx, args) => {
			const def = findTree(args.tree)
			if (!def) return fail(noTree(args.tree))
			if (def.treeId === MASTERY) return fail('Mastery is taken apart in Settings › Skill trees, pillar by pillar.')
			return ok({ deleted: deleteTree(def.treeId) })
		},
	}),
]

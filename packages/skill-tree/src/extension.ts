import { defineNode, type Extension } from '@lifeboard/node-kit'
import { Network } from 'lucide-react'
import { SKILL_TYPE, TREE_TYPE, type SkillNodeProps } from './board'
import { skillTreeCommands } from './commands'
import { entryNodeDefinition } from './entry/definition'
import { todayIso } from './ids'
import { asksForTick } from './requirements'
import { skillNodeDefinition } from './skill/definition'
import { MazeGuides } from './tree/MazeGuides'
import { tunerNodeDefinition } from './tree/LayoutTuner'
import { StaleLayout } from './tree/StaleLayout'
import { Working } from './tree/Working'
import { treeNodeDefinition } from './tree/definition'
import { treeOperations } from './treeOperations'
import { getTreeDef, setTicked } from './treeDefs'
import { getTreePrefs } from './treePrefs'
import { TreeSettings } from './TreeSettings'
import { watchTrees } from './treeSync'

export const SKILL_TREE_EXTENSION = 'lifeboard.skill-tree'

/** A skill node that asks to be ticked by hand (`- manual:`), and whether it is. */
function tickable(shape: { type: string; props?: unknown }): { treeId: string; nodeId: string; ticked: boolean } | null {
	if (shape.type !== SKILL_TYPE) return null
	const { treeId, nodeId, requires } = shape.props as SkillNodeProps
	if (!asksForTick(requires)) return null
	return { treeId, nodeId, ticked: !!getTreeDef(treeId)?.ticked[nodeId] }
}

/**
 * Skill trees (docs/skill-tree-plan.md): constellations of nodes that light up as their requirements
 * are met. On its own a tree knows prerequisites and hand ticks; other extensions add kinds of
 * requirement, evidence and items to draw in it (sources.ts), the way the syllabus does.
 */
export const skillTreeExtension: Extension = {
	id: SKILL_TREE_EXTENSION,
	name: 'Skill trees',
	description: 'Constellations of skill nodes that light up as you meet what each one asks for. Trees live in your vault and any board can show a view of one.',
	details: [
		'A skill tree is a constellation of skill nodes. Each node says what it requires: other nodes unlocked first, a tick by hand, or whatever another extension teaches it (the syllabus adds items done and write-ups counted). A node is locked until its prerequisites are, in reach once they are, and lit when its requirement is met; after that, more evidence fills its ring toward Bronze, Silver and Gold.',
		'A tree lives in your vault. A board shows a view of it from any of its nodes, and trees can hang from a node of another tree, so a view of that node shows them as its branches.',
		'The view lays itself out as a maze of hexagons that grows from its start, and with everything shown it draws the items other extensions tag to each node around it.',
		'Turning this off hides its tools and commands. Its shapes on your boards keep rendering, and the trees stay in your vault.',
	],
	icon: Network,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(skillNodeDefinition), defineNode(treeNodeDefinition), defineNode(entryNodeDefinition), defineNode(tunerNodeDefinition)],
	actions: [
		{
			id: 'skill-tree.edit',
			label: 'Edit',
			appliesTo: (shape) => shape.type === SKILL_TYPE,
			run: ({ editor, shape }) => editor.setEditingShape(shape.id as never),
		},
		{
			id: 'skill-tree.tick',
			label: 'Mark as done',
			appliesTo: (shape) => tickable(shape)?.ticked === false,
			run: ({ shape }) => {
				const node = tickable(shape)
				if (node) setTicked(node.treeId, node.nodeId, todayIso())
			},
		},
		{
			id: 'skill-tree.untick',
			label: 'Mark as not done',
			appliesTo: (shape) => tickable(shape)?.ticked === true,
			run: ({ shape }) => {
				const node = tickable(shape)
				if (node) setTicked(node.treeId, node.nodeId, '')
			},
		},
	],
	settings: { title: 'Skill trees', Component: TreeSettings },
	overlays: [
		{ id: 'lifeboard.skill-tree.stale-layout', Component: StaleLayout },
		{ id: 'lifeboard.skill-tree.working', Component: Working },
		{ id: 'lifeboard.skill-tree.maze-guides', Component: MazeGuides },
	],
	// A tree's header is its view, not something to look at (docs/skill-tree-layout-plan.md, "Views"):
	// hidden unless Settings asks for headers.
	shapeVisibility: { types: [TREE_TYPE], isHidden: () => !getTreePrefs().showHeaders },
	commands: skillTreeCommands,
	operations: treeOperations,
	hooks: {
		// Every open board follows the vault's trees, and catches up on what changed elsewhere.
		onBoardOpen: ({ editor }) => watchTrees(editor),
	},
}

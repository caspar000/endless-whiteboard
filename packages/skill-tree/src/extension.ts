import { defineNode, type Extension } from '@lifeboard/node-kit'
import { GraduationCap } from 'lucide-react'
import { isHiddenByCollapse, isItem, ITEM_TYPE } from './board'
import { habitNodeDefinition } from './habit/definition'
import { skillTreeCommands } from './commands'
import { itemNodeDefinition } from './item/definition'
import { skillNodeDefinition } from './skill/definition'
import { watchBoard } from './skillIndex'
import { trackNodeDefinition } from './track/definition'
import { treeNodeDefinition } from './tree/definition'

/**
 * Syllabi you tick through, and skill trees that light up from the evidence the ticks leave
 * (docs/skill-tree-plan.md). Steps 1 and 2: items, tracks, completion and templates; skill nodes,
 * requirements and the vault-wide index.
 */
export const skillTreeExtension: Extension = {
	id: 'lifeboard.skill-tree',
	name: 'Syllabus & skill trees',
	description:
		'Ordered syllabi you tick through. Each finished item files a note from a template beside it, and items can hold children, like Plato and his dialogues.',
	details: [
		'A syllabus item is one thing to do: read a book, watch a film, build an exercise. Tick it and it records the day, and a note appears beside it from a template for its medium: Adler\'s four questions for a book, the film study sheet for a film. A tick whose note you never wrote in shows hollow, done but without evidence.',
		'An item can hold children. A parent is done when its core children are, or all of them, or some number of them, whichever you choose. Collapse a parent to hide its children and tick them from a checklist on the card.',
		'A track is an ordered list of items. The next undone item is highlighted, and ticking a unit\'s row ticks its next step. Order is a guide, not a gate: anything can be ticked at any time.',
		'A skill tree is a constellation of skill nodes. Each node says what it requires: other nodes unlocked first, a particular item done, or some number of written-up items tagged to it. Tag an item with a node id and its evidence counts there, from any board. A node is locked until its prerequisites are, in reach once they are, and lit when its requirement is met; after that, more evidence fills its ring toward Bronze, Silver and Gold.',
		'A habit is a target per day, week or month: tick it by hand, or let it count written-up items that match a filter, such as one film sheet a week. It can wait until a syllabus item is done before it starts. A missed period is just a hollow dot, and a skill node can require a habit: so many in total, in a row, or on target.',
		'Kind, Medium, Done and Done at are ordinary properties, so tables, the kanban and the calendar work on items as they are. A calendar over Done at is your log.',
		'Turning this off hides its tools and commands. Items and tracks already on your boards keep rendering.',
	],
	icon: GraduationCap,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [
		defineNode(itemNodeDefinition),
		defineNode(trackNodeDefinition),
		defineNode(skillNodeDefinition),
		defineNode(treeNodeDefinition),
		defineNode(habitNodeDefinition),
	],
	commands: skillTreeCommands,
	hooks: {
		// Every open board feeds the vault-wide index, and catches it up on what changed elsewhere.
		onBoardOpen: ({ editor, boardId }) => watchBoard(editor, boardId),
	},
	shapeVisibility: {
		types: [ITEM_TYPE],
		isHidden: (shape, editor) => isItem(shape) && isHiddenByCollapse(editor, shape),
	},
}

import { watchTrees } from './treeSync'
import { defineNode, type Extension } from '@lifeboard/node-kit'
import { GraduationCap } from 'lucide-react'
import { habitNodeDefinition } from './habit/definition'
import { upNextNodeDefinition } from './upnext/definition'
import { skillTreeCommands } from './commands'
import { syllabusCommands, syllabusFileImport, syllabusOperations } from './syllabusCommands'
import { itemNodeDefinition } from './item/definition'
import { entryNodeDefinition } from './entry/definition'
import { ENTRY_TYPE, isEntry, isSkill, SKILL_TYPE } from './board'
import { putCard } from './ops'
import { focusOn } from './tree/focus'
import { TreeSettings } from './TreeSettings'
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
		'Syllabi you work through and skill trees that light up from what you finish. One syllabus in your vault, shown as a tree, a list, Up next or cards.',
	details: [
		"A syllabus lives in your vault: its entries (read Homer), their works (the Iliad, the Odyssey), and the tracks that put them in order. Every view of it reads and writes the same thing, so a tick in the list is a tick in the tree and on every board.",
		"Tick a work and it records the day, and a write-up note appears beside what you ticked from, from a template for its medium: Adler's four questions for a book, the film study sheet for a film. A tick whose note you never wrote in shows hollow: done, but not yet evidence.",
		"An entry is done when its core works are, or all of them, or some number of them, whichever you choose.",
		"A list shows a track in reading order. Every entry folds and unfolds to its works and shows its progress, and the next undone entry is lit. Double-click a list to scroll it. The arrow on a row puts a card for that entry on the board.",
		"A skill tree is a constellation of skill nodes. Each node says what it requires: other nodes unlocked first, a particular item done, or some number of written-up items tagged to it. A node is locked until its prerequisites are, in reach once they are, and lit when its requirement is met; after that, more evidence fills its ring toward Bronze, Silver and Gold.",
		"A habit is a target per day, week or month: tick it by hand, or let it count written-up items that match a filter, such as one film sheet a week. A missed period is just a hollow dot, and a skill node can require a habit.",
		"Up next is the card to work from: the next step of every active track, the habits not yet met this period, and twelve weeks of the days you did something.",
		"Turning this off hides its tools and commands. Its shapes on your boards keep rendering, and the syllabus stays in your vault.",
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
		defineNode(upNextNodeDefinition),
		defineNode(entryNodeDefinition),
	],
	actions: [
		{
			id: 'skill-tree.focus',
			label: 'Focus here',
			appliesTo: (shape) => shape.type === SKILL_TYPE || shape.type === ENTRY_TYPE,
			run: ({ editor, shape }) => {
				const s = editor.getShape(shape.id as never)
				if (isSkill(s)) focusOn(editor, s.props.nodeId)
				else if (isEntry(s)) focusOn(editor, s.props.itemId)
			},
		},
		{
			id: 'skill-tree.edit',
			label: 'Edit',
			appliesTo: (shape) => shape.type === SKILL_TYPE,
			run: ({ editor, shape }) => editor.setEditingShape(shape.id as never),
		},
		{
			id: 'skill-tree.card',
			label: 'Put a card on the board',
			appliesTo: (shape) => shape.type === ENTRY_TYPE,
			run: ({ editor, shape }) => {
				const s = editor.getShape(shape.id as never)
				if (isEntry(s)) putCard(editor, s.props.itemId, { beside: s.id })
			},
		},
	],
	settings: { title: 'Skill trees', Component: TreeSettings },
	commands: [...skillTreeCommands, ...syllabusCommands],
	operations: syllabusOperations,
	fileImports: [syllabusFileImport],
	hooks: {
		// Every open board feeds the vault-wide index, and catches it up on what changed elsewhere.
		onBoardOpen: ({ editor, boardId }) => {
			watchBoard(editor, boardId)
			watchTrees(editor)
		},
	},
}

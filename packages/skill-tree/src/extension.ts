import { watchTrees } from './treeSync'
import { defineNode, type Extension } from '@lifeboard/node-kit'
import { GraduationCap } from 'lucide-react'
import { habitNodeDefinition } from './habit/definition'
import { upNextNodeDefinition } from './upnext/definition'
import { skillTreeCommands } from './commands'
import { syllabusCommands, syllabusFileImport, syllabusOperations } from './syllabusCommands'
import { itemNodeDefinition } from './item/definition'
import { entryNodeDefinition } from './entry/definition'
import { ENTRY_TYPE, isEntry, SKILL_TYPE, TREE_TYPE } from './board'
import { putCard, tick } from './ops'
import { getItem, isItemDone } from './syllabus'
import type { TLShapeId } from '@lifeboard/canvas'
import { TreeSettings } from './TreeSettings'
import { StaleLayout } from './tree/StaleLayout'
import { Working } from './tree/Working'
import { BandGuides } from './tree/BandGuides'
import { BubbleGuides } from './tree/BubbleGuides'
import { tunerNodeDefinition } from './tree/LayoutTuner'
import { getTreePrefs } from './treePrefs'
import { skillNodeDefinition } from './skill/definition'
import { watchBoard } from './skillIndex'
import { trackNodeDefinition } from './track/definition'
import { treeNodeDefinition } from './tree/definition'

/** The item behind an entry or work in a tree, when it is a leaf: something that is ticked, not worked out from its works. */
function leafInTree(shape: { type: string; props?: unknown }): { itemId: string; done: boolean } | null {
	if (shape.type !== ENTRY_TYPE) return null
	const item = getItem((shape.props as { itemId?: string } | undefined)?.itemId ?? '')
	return item && !item.children.length ? { itemId: item.itemId, done: isItemDone(item.itemId) } : null
}

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
		defineNode(tunerNodeDefinition),
	],
	actions: [
		{
			id: 'skill-tree.mark-done',
			label: 'Mark as done',
			appliesTo: (shape) => leafInTree(shape)?.done === false,
			run: ({ editor, shape }) => {
				const leaf = leafInTree(shape)
				if (leaf) tick(editor, leaf.itemId, true, shape.id as TLShapeId)
			},
		},
		{
			id: 'skill-tree.mark-not-done',
			label: 'Mark as not done',
			appliesTo: (shape) => leafInTree(shape)?.done === true,
			run: ({ editor, shape }) => {
				const leaf = leafInTree(shape)
				if (leaf) tick(editor, leaf.itemId, false, shape.id as TLShapeId)
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
	overlays: [
		{ id: 'lifeboard.skill-tree.stale-layout', Component: StaleLayout },
		{ id: 'lifeboard.skill-tree.working', Component: Working },
		{ id: 'lifeboard.skill-tree.band-guides', Component: BandGuides },
		{ id: 'lifeboard.skill-tree.bubble-guides', Component: BubbleGuides },
	],
	// A tree's header is its view, not something to look at (docs/skill-tree-layout-plan.md, "Views"):
	// hidden unless Settings asks for headers.
	shapeVisibility: { types: [TREE_TYPE], isHidden: () => !getTreePrefs().showHeaders },
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

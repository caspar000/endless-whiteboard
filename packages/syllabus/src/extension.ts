import { defineNode, type Extension } from '@lifeboard/node-kit'
import { ENTRY_TYPE, isEntry } from '@lifeboard/skill-tree'
import type { TLShapeId } from '@lifeboard/canvas'
import { GraduationCap } from 'lucide-react'
import { itemNodeDefinition } from './item/definition'
import { putCard, tick } from './ops'
import { watchBoard } from './skillIndex'
import { getItem, isItemDone } from './syllabus'
import { syllabusCommands, syllabusFileImport, syllabusOperations } from './syllabusCommands'
import { trackNodeDefinition } from './track/definition'
import { upNextNodeDefinition } from './upnext/definition'
import { exposeWholeLifeTest } from './wholeLifeTest'

/** The item behind an entry or work in a tree, when it is a leaf: something that is ticked, not worked out from its works. */
function leafInTree(shape: { type: string; props?: unknown }): { itemId: string; done: boolean } | null {
	if (shape.type !== ENTRY_TYPE) return null
	const item = getItem((shape.props as { itemId?: string } | undefined)?.itemId ?? '')
	return item && !item.children.length ? { itemId: item.itemId, done: isItemDone(item.itemId) } : null
}

/**
 * Syllabi you tick through (docs/skill-tree-plan.md): entries, their works, and the tracks that put
 * them in order, kept in the vault and shown as lists, Up next and cards. With skill trees on, its
 * entries are drawn in a tree and its write-ups light the nodes they are tagged to (syllabusSource.ts).
 */
export const syllabusExtension: Extension = {
	id: 'lifeboard.syllabus',
	name: 'Syllabus',
	description: 'Syllabi you work through: entries, their works and the tracks that order them, in your vault, shown as a list, Up next or cards.',
	details: [
		"A syllabus lives in your vault: its entries (read Homer), their works (the Iliad, the Odyssey), and the tracks that put them in order. Every view of it reads and writes the same thing, so a tick in the list is a tick in a tree and on every board.",
		"Tick a work and it records the day, and a write-up note appears beside what you ticked from, from a template for its medium: Adler's four questions for a book, the film study sheet for a film. A tick whose note you never wrote in shows hollow: done, but not yet evidence.",
		'An entry is done when its core works are, or all of them, or some number of them, whichever you choose.',
		'A list shows a track in reading order. Every entry folds and unfolds to its works and shows its progress, and the next undone entry is lit. Double-click a list to scroll it. The arrow on a row puts a card for that entry on the board.',
		'Up next is the card to work from: the next step of every active track and twelve weeks of the days you did something.',
		"With Skill trees on, a syllabus's tree comes in with it, its entries and works are drawn around the nodes they are tagged to, and its write-ups light those nodes (a node can ask for an item done, or a number of write-ups).",
		'Turning this off hides its tools and commands. Its shapes on your boards keep rendering, and the syllabus stays in your vault.',
	],
	icon: GraduationCap,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(itemNodeDefinition), defineNode(trackNodeDefinition), defineNode(upNextNodeDefinition)],
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
			id: 'skill-tree.card',
			label: 'Put a card on the board',
			appliesTo: (shape) => shape.type === ENTRY_TYPE && !!getItem(((shape as { props?: { itemId?: string } }).props?.itemId) ?? ''),
			run: ({ editor, shape }) => {
				const s = editor.getShape(shape.id as never)
				if (isEntry(s)) putCard(editor, s.props.itemId, { beside: s.id })
			},
		},
	],
	commands: syllabusCommands,
	operations: syllabusOperations,
	fileImports: [syllabusFileImport],
	hooks: {
		// Every open board feeds the vault-wide index, and catches it up on what changed elsewhere.
		onBoardOpen: ({ editor, boardId }) => {
			watchBoard(editor, boardId)
			exposeWholeLifeTest(editor)
		},
	},
}

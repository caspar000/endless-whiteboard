import type { Command, CommandContext } from '@lifeboard/node-kit'
import { BookOpenText, GitBranchPlus, Layers, LayoutGrid, ListTree, Plus, Route, Share2, SquarePlus } from 'lucide-react'
import { INDEX_ZID, isBox, placeSource } from './box'
import { showTable } from './BoxDock'
import { followChain } from './stack/ChainView'
import { writeNote } from './stack/StackView'
import { setFilling, setGraphOpen, setStackOpen, showCard } from './stack/state'

const GROUP = 'Zettelkasten'

const inBox = (ctx: CommandContext) => ctx.editor !== null && isBox(ctx.editor)

/**
 * The box's verbs, in ⌘K. No default keys: inside the stack N and ⇧N are the stack's own (a
 * full-screen surface binds its own keys, README), and as commands they would collide with the
 * board's letters on every other board.
 */
export const boxCommands: Command[] = [
	{
		id: 'zettelkasten.note.behind',
		title: 'New note behind this one',
		group: GROUP,
		icon: Plus,
		when: inBox,
		run: ({ editor }) => {
			if (editor) writeNote(editor, 'behind')
		},
	},
	{
		id: 'zettelkasten.note.branch',
		title: 'Branch from this note',
		group: GROUP,
		icon: GitBranchPlus,
		when: inBox,
		run: ({ editor }) => {
			if (editor) writeNote(editor, 'branch')
		},
	},
	{
		id: 'zettelkasten.note.train',
		title: 'New train of thought',
		group: GROUP,
		icon: SquarePlus,
		when: inBox,
		run: ({ editor }) => {
			if (editor) writeNote(editor, 'train')
		},
	},
	{
		id: 'zettelkasten.source.new',
		title: 'New source',
		group: GROUP,
		icon: BookOpenText,
		when: inBox,
		run: ({ editor }) => {
			if (!editor) return
			editor.complete()
			const { zid } = placeSource(editor)
			showCard(editor, zid)
			setFilling(editor, zid)
		},
	},
	{
		id: 'zettelkasten.index',
		title: 'Go to the index',
		group: GROUP,
		icon: ListTree,
		when: inBox,
		run: ({ editor }) => {
			if (editor) showCard(editor, INDEX_ZID)
		},
	},
	{
		id: 'zettelkasten.view.chain',
		title: 'Follow the chain of thought from here',
		group: GROUP,
		icon: Route,
		when: inBox,
		run: ({ editor }) => {
			if (editor) followChain(editor)
		},
	},
	{
		id: 'zettelkasten.view.graph',
		title: 'Show the box as a graph',
		group: GROUP,
		icon: Share2,
		when: inBox,
		run: ({ editor }) => {
			if (editor) setGraphOpen(editor, true)
		},
	},
	{
		id: 'zettelkasten.view.stack',
		title: 'Show the box as a stack',
		group: GROUP,
		icon: Layers,
		when: inBox,
		run: ({ editor }) => {
			if (editor) setStackOpen(editor, true)
		},
	},
	{
		id: 'zettelkasten.view.table',
		title: 'Lay the box out on the table',
		group: GROUP,
		icon: LayoutGrid,
		when: inBox,
		run: ({ editor }) => {
			if (editor) showTable(editor)
		},
	},
]

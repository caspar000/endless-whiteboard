import type { Command, CommandContext } from '@lifeboard/node-kit'
import { GitBranchPlus, Layers, LayoutGrid, Plus, SquarePlus } from 'lucide-react'
import { isBox } from './box'
import { showTable } from './BoxDock'
import { writeNote } from './stack/StackView'
import { setStackOpen } from './stack/state'

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

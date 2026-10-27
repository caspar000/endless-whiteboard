import { defineNode, type BoardKind, type Extension } from '@lifeboard/node-kit'
import { Archive } from 'lucide-react'
import { CARD_TYPE, INDEX_TYPE, isBox, makeBox, SOURCE_TYPE } from './box'
import { BoxDock } from './BoxDock'
import { cardDefinition } from './card/definition'
import { linkTextExtensions } from './card/linkSuggest'
import { indexDefinition, sourceDefinition } from './card/otherDefinitions'
import { boxCommands } from './commands'
import { watchBox } from './watch'

/** A Zettelkasten box: a board that holds index cards in Luhmann's order, and nothing else. */
export const boxKind: BoardKind = {
	id: 'zettelkasten.box',
	name: 'Box',
	label: 'New box',
	newName: 'Untitled box',
	boardIcon: 'cards',
	icon: Archive,
	isKind: isBox,
	create: makeBox,
	Dock: BoxDock,
	allowedShapes: [CARD_TYPE, SOURCE_TYPE, INDEX_TYPE],
}

/**
 * A Zettelkasten, kept the way Luhmann kept his: a box of cards in an order you choose as you write.
 * See docs/zettelkasten-plan.md.
 */
export const zettelkastenExtension: Extension = {
	id: 'lifeboard.zettelkasten',
	name: 'Zettelkasten',
	description:
		'A box of index cards in the order you put them. Each note gets its number from where it goes, 25a behind 25, and you read the box by flipping through it.',
	details: [
		'A box is a board of its own: New box on the home screen or in ⌘K. It opens on the stack, the front card with the next ones peeking out behind it. Scroll, swipe or use the arrow keys to flip through.',
		'You don’t file a note under a title. You write it behind the card in front: N continues that card’s line (25a, then 25b), and if the line already goes on, the new note branches off it instead (25a1). ⇧N always branches. New train of thought starts the next number.',
		'Click a card’s text to write in it. The text is the sticky note’s, so bold, lists and headings work; a heading as the first line is the note’s title. Titles are optional.',
		'A note never moves: its number is its place. Deleting one asks first, and its number is never given out again; its branches stay where they were, behind a gap.',
		'Link a note to another by typing [[ and its number, or with the + on its card, which also files it under a keyword in the index and cites a source. A card shows which notes link to it.',
		'The index at the front of the box lists every keyword with the notes filed under it. Sources (c1, c2…) sit at the back, with their author, title and year.',
		'Follow a chain of thought (F, or the chain button): a note and the rest of its train down the middle, the notes each one links to beside it. Click one to turn the path there.',
		'Table lays every card out at once: the index, a column for each top-level note with its line running down it, and the sources.',
		'Turning this off leaves your boxes as ordinary boards with their cards on them. Turn it back on and they are boxes again.',
	],
	icon: Archive,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(cardDefinition), defineNode(sourceDefinition), defineNode(indexDefinition)],
	boardKinds: [boxKind],
	commands: boxCommands,
	textExtensions: linkTextExtensions,
	hooks: {
		onBoardOpen: ({ editor }) => {
			if (isBox(editor)) watchBox(editor)
		},
	},
}

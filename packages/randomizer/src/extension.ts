import { defineNode, type Extension } from '@lifeboard/node-kit'
import { Shuffle } from 'lucide-react'
import { randomizerCommands } from './commands'
import { randomizerNodeDefinition } from './definition'

/**
 * A card that picks something at random from whatever it is given: a list typed into it, or another
 * extension's source (`sources.ts`), such as a feed's videos. One node type and one command.
 */
export const randomizerExtension: Extension = {
	id: 'lifeboard.randomizer',
	name: 'Randomizer',
	description:
		'A card that picks at random from whatever you give it: a list you type, or the videos in one of your feeds. Press Shuffle and the cover flips like a departure board, clacking, until it lands on one.',
	details: [
		'Add one from the dock’s node picker or with “Add randomizer” in ⌘K. It starts empty, waiting for a source: double-click it, or click “Choose a source” at its top.',
		'“A list I type” holds anything: one item per line, Title — Creator — Year. With Feeds on, the same menu lists all your feeds, each category and each channel, and the card shuffles their videos, with each thumbnail as its cover. The button beside the count opens the video on show and marks it watched.',
		'Shuffle flips through the covers, faster and longer the more there are, and slows to a stop on one; then the title and the creator rattle through the letter tiles and settle. A dozen items get about two dozen flips, a backlog of hundreds up to eighty, and it never takes more than about five seconds. With the card selected, ⌘↵ shuffles it (Settings → Keyboard can move that).',
		'The sound is made in the browser, a clack for each flap and a thunk when it lands. The speaker button mutes it, and the card remembers.',
		'Drop an image on the card to make it the cover of the item on show. An item without one gets a cover drawn from its title.',
		'Stamp the item on show from the stamp button: Liked and Disliked take it out of the shuffle, Unsure leaves it in. Stamps pile up on the cover with their dates, newest on top; click them for the history. Shuffling never stamps anything, and a stamp is an ordinary edit, so ⌘Z (or the Undo beside it) takes it back.',
		'Where a shuffle lands is not an edit: undo skips it. The card keeps the last few picks under the button.',
		'Turning this off takes the card out of the node picker and ⌘K. Cards already on your boards keep their lists and keep working.',
	],
	icon: Shuffle,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(randomizerNodeDefinition)],
	commands: randomizerCommands,
}

import { defineNode, type Extension } from '@lifeboard/node-kit'
import { Inbox } from 'lucide-react'
import { backlogNodeDefinition } from './definition'
import { BacklogSettings } from './BacklogSettings'
import { BACKLOG_TYPE, type BacklogProps } from './props'
import { BACKLOG_EXTENSION_ID } from './source'
import { claimBacklog } from './store'

/**
 * Backlog (DARK-11): media you mean to get to, gathered from anywhere into one card, and offered back
 * as a source for a randomizer or a ranking. Needs no other extension: what it collects, and who reads
 * it, meet in the kit's registry.
 */
export const backlogExtension: Extension = {
	id: BACKLOG_EXTENSION_ID,
	name: 'Backlog',
	description: 'One card for everything you mean to get to: typed in, dragged from other cards, or a whole syllabus track dropped on it.',
	details: [
		'Add a Backlog card from the dock’s node picker or with “Add backlog” in ⌘K. Click its name to rename it.',
		'+ adds an item you type (Title — creator; it gets a cover drawn from its title), or a whole collection: anything your other extensions offer, such as a syllabus track, a feed or everything you liked on a randomizer.',
		'Drag a cover onto it from a Ranking Tiers card, a randomizer’s last picks or another backlog, or drop a syllabus track’s card on it: the track goes in as one collection, a square stack the size of an album, and the track’s card goes back where it was. A collection lists what its source holds now, so what is added to the track later is in the backlog too. Click it to see inside.',
		'Hover a tile for × to take it out. Four rows show at first; “Show all” shows the rest.',
		'Each backlog is offered to other cards as a source, everything in it, collections opened out, each thing once: point a randomizer at it to pick what is next, or a Ranking Tiers card to sort it.',
		'Backlogs are kept in your vault, on the board they were made on: a randomizer or a ranking there can take one, and every device shows the same. Below, delete the ones you no longer need.',
		'Turning this off takes the card out of the dock and ⌘K and its backlogs out of other cards’ menus. Cards on your boards keep showing, and your backlogs stay in your vault.',
	],
	icon: Inbox,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(backlogNodeDefinition)],
	settings: { title: 'Your backlogs', Component: BacklogSettings },
	hooks: {
		// A backlog from before DARK-14 belongs to the board whose card shows it, the first time it opens.
		onBoardOpen: ({ editor, boardId }) => {
			for (const shape of editor.getCurrentPageShapes()) {
				if (shape.type === BACKLOG_TYPE) claimBacklog((shape.props as BacklogProps).backlogId, boardId)
			}
		},
	},
}

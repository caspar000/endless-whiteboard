import { defineNode, type Extension } from '@lifeboard/node-kit'
import { ListOrdered } from 'lucide-react'
import { rankingNodeDefinition } from './definition'
import { RANKING_TYPE, type RankingProps } from './props'
import { RankingSettings } from './RankingSettings'
import { RANKING_EXTENSION_ID } from './source'
import { claimRanking } from './store'

/**
 * Ranking Tiers (DARK-11): the items of any source sorted into tiers you name, and, if you want, a
 * weighted list a randomizer draws from. Needs no other extension: its items come from whatever the
 * enabled ones offer in the kit's registry.
 */
export const rankingTiersExtension: Extension = {
	id: RANKING_EXTENSION_ID,
	name: 'Ranking Tiers',
	description: 'Sort anything into tiers you name: the albums you liked into how often to hear them, books from S to F.',
	details: [
		'Add a Ranking Tiers card from the dock’s node picker or with “Add ranking tiers” in ⌘K, and choose what it ranks: whatever your other extensions offer on this board. With Feeds or Syllabus on, a feed or a syllabus track; with Backlog on, each backlog; with the Randomizer on, what you stamped here, a list for each source and stamp (“Liked on /mu/core”). Each source keeps its own tiers, so switching back finds them as you left them.',
		'What you stamp Liked, Unsure or Disliked on a randomizer waits in the card’s rank queue, newest first, until you drag it into a tier. What you never stamped waits in the rail on the left: open it to drag from it, and search it by title or artist. The card’s settings have a switch for each stamp under “Rank queue shows”: switch Unsure and Disliked off and the queue holds only the liked. The switches never move a cover already in a tier.',
		'Drag covers between tiers, and within one to order it; or focus a cover and use the arrow keys, up and down for the tier (above the first is the queue), left and right for its place. A cover keeps the stamp it has: moving it never stamps it again. One nobody stamped is stamped Liked when first ranked, which takes it out of the board’s randomizers’ shuffles, and it is ticked in the syllabus if one has the same work.',
		'Add a tier with +. Its ⋯ menu renames it, gives it a background colour, a border and an icon, moves it, takes everything off it, or removes it. A removed tier’s items go back to the queue or the rail.',
		'Tiers or Shelf, at the card’s top: banded rows, or a wooden bookcase with a shelf for each tier, its nameplate in the tier’s colour, and the queue in a record crate on top. A full shelf folds its last covers into a “+N” stack that opens the shelf.',
		'A randomizer on the same board can draw from any one tier. Weighted shuffle is off until you turn it on in the card’s settings. Then each tier has a die whose pips are its weight (1 to 5; click to change), each tier shows its odds of winning a draw and a bar of its share, and the whole ranking is offered to randomizers too, which draw its items by those weights: a tier weighted 4 comes up four times as often, item for item, as one weighted 1. Unranked items are not in the draw.',
		'The card’s settings also choose its covers’ shape (square, 16:9, 2:3 and others) and whether each stamped cover wears its latest stamp.',
		'A ranking belongs to the board it was made on, kept in your vault so every device shows the same. Below, choose how odds are written and the tiers new cards start with, and delete rankings you no longer need.',
		'Drag a cover onto a Backlog card to add it there.',
		'Turning this off takes the card out of the dock and ⌘K and its rankings out of randomizers’ menus. Cards on your boards keep showing, and your rankings stay in your vault.',
	],
	icon: ListOrdered,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(rankingNodeDefinition)],
	settings: { title: 'Odds, tiers and your rankings', Component: RankingSettings },
	hooks: {
		// A ranking from before DARK-14 belongs to the board whose card shows it, the first time it opens.
		onBoardOpen: ({ editor, boardId }) => {
			for (const shape of editor.getCurrentPageShapes()) {
				if (shape.type === RANKING_TYPE) claimRanking((shape.props as RankingProps).rankingId, boardId)
			}
		},
	},
}

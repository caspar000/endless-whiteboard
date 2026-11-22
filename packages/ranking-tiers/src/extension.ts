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
		'Add a Ranking Tiers card from the dock’s node picker or with “Add ranking tiers” in ⌘K, and choose what it ranks: whatever your other extensions offer. With the Randomizer on, that includes “Everything I liked” and “Everything I disliked”, every item you stamped on any randomizer; with Backlog on, each backlog; with Feeds or Syllabus on, a feed or a syllabus track. Each source keeps its own tiers, so switching back finds them as you left them.',
		'Each tier is a row with its name and how many it holds. Drag covers between tiers, and within one to order it; or focus a cover and use the arrow keys, up and down for the tier, left and right for its place. What isn’t ranked yet waits in the rail on the left: open it to drag from it, and search it by title or artist. Rows grow as they fill, so nothing is ever hidden.',
		'Ranking something counts as liking it: a cover moved from the rail into a tier is stamped Liked, as on a randomizer, which takes it out of every randomizer’s shuffle, and ticked in the syllabus if one has the same work, its write-up note filed beside the ranking.',
		'The card’s settings choose its covers’ shape (square, 16:9, 2:3 and others), whether each stamped cover wears its latest stamp, and, with the Randomizer on, which stamps show: switch Disliked off and those covers leave the ranking, keeping their tier. A ranking of Everything I liked can take Unsure in too.',
		'Add a tier with +, and rename, move or remove one from its ⋯ menu. A removed tier’s items go back to the rail.',
		'Weighted shuffle is off until you turn it on in the card’s settings. Then each tier has a die whose pips are its weight (1 to 5; click to change), each tier shows its odds of winning a draw and a bar of its share, and the ranking is offered to randomizers, which draw its items by those weights: a tier weighted 4 comes up four times as often, item for item, as one weighted 1. Unranked items are not in the draw. With it off, a ranking is a ranking and nothing more.',
		'Rankings are kept in your vault, so a randomizer on another board or device draws from the same one. Below, choose how odds are written and the tiers new cards start with, and delete rankings you no longer need.',
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

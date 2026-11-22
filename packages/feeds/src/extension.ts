import { defineNode, type Extension } from '@lifeboard/node-kit'
import { Rss } from 'lucide-react'
import { feedCommands } from './commands'
import { feedNodeDefinition } from './feed/definition'
import { FEED_TYPE, remapFeedCards } from './board'
import { FeedSettings } from './FeedSettings'
import { claimFeeds } from './store'

/**
 * Feeds (DARK-4): YouTube channels and RSS feeds, filed under categories you make, read into a card on
 * any board. Each platform is a provider (`providers/registry.ts`); YouTube and RSS read today, Reddit
 * and X are listed as coming soon.
 */
export const feedsExtension: Extension = {
	id: 'lifeboard.feeds',
	name: 'Feeds',
	description: 'YouTube channels and RSS feeds in one newest-first card, filtered by categories you make.',
	details: [
		'Add YouTube channels (a link, an @handle or a channel id) and RSS or Atom feeds, and file them under categories you make, like "Electrical Engineering". A source can be in several categories, or none.',
		"A feed card shows the newest posts of every source, or of one category: pick it from the chips across the top. Each board has its own sources, categories and what you've watched, kept in your vault, so every feed card on that board, on any device, shows the same.",
		"Click a video to watch it on YouTube in a new tab; the play button plays it in the card instead. Either marks it watched. The dot beside a post marks it watched or unwatched by hand, and the card's menu marks everything in view as watched. The card shows unwatched posts, or all of them.",
		"Open cards read their sources every quarter of an hour, through the Lifeboard server, since a browser may not read YouTube's feeds itself. Without a server, the card says so. YouTube's feed lists a channel's latest 15 videos, so a new source starts from those.",
		'Reddit and X are coming. Each platform is a provider of its own, so adding one changes nothing else.',
		'Double-click a feed card to add and remove its board’s sources, file them, and make, rename, reorder and delete categories beside it.',
		"Turning this off hides the feed card from the dock and its commands. Cards on your boards keep showing, and your sources stay in your vault.",
	],
	icon: Rss,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(feedNodeDefinition)],
	commands: feedCommands,
	settings: { title: 'Sources and categories', Component: FeedSettings },
	hooks: {
		// A board with a feed card gets its own copy of the feeds from before boards had their own (DARK-14).
		// Its cards set to a category stay on the board's copy of it, with no undo step: nobody changed them.
		onBoardOpen: ({ editor, boardId }) => {
			const shapes = editor.getCurrentPageShapes()
			if (!shapes.some((s) => s.type === FEED_TYPE)) return
			const categoryIds = claimFeeds(boardId)
			const updates = categoryIds ? remapFeedCards(shapes, categoryIds) : []
			if (updates.length) editor.run(() => editor.updateShapes(updates as never), { history: 'ignore' })
		},
	},
}

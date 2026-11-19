import { defineNode, type Extension } from '@lifeboard/node-kit'
import { Rss } from 'lucide-react'
import { feedCommands } from './commands'
import { feedNodeDefinition } from './feed/definition'
import { FeedSettings } from './FeedSettings'

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
		"A feed card shows the newest posts of every source, or of one category: pick it from the chips across the top. Your sources, categories and what you've watched are kept in your vault, so every feed card on every board and device shows the same.",
		"Click a video to watch it on YouTube in a new tab; the play button plays it in the card instead. Either marks it watched. The dot beside a post marks it watched or unwatched by hand, and the card's menu marks everything in view as watched. The card shows unwatched posts, or all of them.",
		"Open cards read their sources every quarter of an hour, through the Lifeboard server, since a browser may not read YouTube's feeds itself. Without a server, the card says so. YouTube's feed lists a channel's latest 15 videos, so a new source starts from those.",
		'Reddit and X are coming. Each platform is a provider of its own, so adding one changes nothing else.',
		'Below, every source and category: add and remove sources, file them, and make, rename, reorder and delete categories. Double-click a feed card to do the same beside it.',
		"Turning this off hides the feed card from the dock and its commands. Cards on your boards keep showing, and your sources stay in your vault.",
	],
	icon: Rss,
	version: '0.1.0',
	author: 'Lifeboard',
	nodes: [defineNode(feedNodeDefinition)],
	commands: feedCommands,
	settings: { title: 'Sources and categories', Component: FeedSettings },
}

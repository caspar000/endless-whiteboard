/**
 * `@lifeboard/feeds`: YouTube channels and RSS feeds, filed under your own categories, in a card on
 * any board (DARK-4).
 *
 * Reaches the host only through `@lifeboard/node-kit`'s public barrel, like every extension.
 */

// Registers the node type with tldraw's type system. Side-effect import, kept above the exports.
import './shape-types'
import { registerFeedProvider } from './providers/registry'
import { rssProvider } from './providers/rss'
import { redditProvider, xProvider } from './providers/soon'
import { youtubeProvider } from './providers/youtube'
import { registerItemSource } from '@lifeboard/node-kit'
import { feedsRandomizerSource } from './randomizerSource'

// The platforms, in the order of the sources panel's tabs.
registerFeedProvider(youtubeProvider)
registerFeedProvider(rssProvider)
registerFeedProvider(redditProvider)
registerFeedProvider(xProvider)

// A randomizer can shuffle a feed's videos (DARK-7), and a ranking or a backlog take them (DARK-11),
// through the kit's registry: none of them needs Feeds, nor Feeds them.
registerItemSource(feedsRandomizerSource)

export { feedsExtension } from './extension'
export { FEED_TYPE, type FeedProps } from './board'
export type { FeedCategory, FeedItem, FeedSource, SourceItems, WatchedEntry } from './model'
export { getFeedProvider, getFeedProviders, registerFeedProvider, type FeedProvider, type ReadText } from './providers/registry'
export {
	addCategory,
	addSource,
	getCategories,
	getSourceItems,
	getSources,
	getWatched,
	replaceCategories,
	replaceSourceItems,
	replaceSources,
	replaceWatched,
	setCategoriesPersistence,
	setSourceItemsPersistence,
	setSourcesPersistence,
	setWatchedPersistence,
} from './store'

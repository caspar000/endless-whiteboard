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

// The platforms, in the order of the sources panel's tabs.
registerFeedProvider(youtubeProvider)
registerFeedProvider(rssProvider)
registerFeedProvider(redditProvider)
registerFeedProvider(xProvider)

export { feedsExtension } from './extension'
export { FEED_TYPE, type FeedProps } from './board'
export type { FeedCategory, FeedItem, FeedSource, SourceItems, WatchedEntry } from './model'
export { getFeedProvider, getFeedProviders, registerFeedProvider, type FeedProvider, type ReadText } from './providers/registry'
export {
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

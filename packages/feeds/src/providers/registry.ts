import type { ExternalText, NodeToolbarIcon } from '@lifeboard/node-kit'
import type { FeedItem, FeedSource } from '../model'

/**
 * A platform the feed can follow: how to turn what a person pastes into a source, and how to read
 * that source's posts. The card, the sources panel and the refresh know nothing of any one platform;
 * a new one (Reddit, X) is a provider registered here, and nothing else changes.
 */
export interface FeedProvider {
	/** Stored on each source, so it never changes: `youtube`, `rss`. */
	id: string
	/** On the sources panel's tab: `YouTube`. */
	name: string
	icon: NodeToolbarIcon
	/** `false`: shown on the panel as coming soon, and nothing can be added with it. */
	available: boolean
	/** The add field's label and example. */
	inputLabel: string
	placeholder: string
	/**
	 * What was pasted, as a source: its feed's address, its page and its name. Reads what it needs to
	 * through `read` (the host's transport); an `error` is shown under the field as it is.
	 */
	resolve(input: string, read: ReadText): Promise<Pick<FeedSource, 'feedUrl' | 'link' | 'title'> | { error: string }>
	/** The posts in what was read at the source's `feedUrl`, or `null` when it isn't such a feed. */
	parse(text: string, source: FeedSource): FeedItem[] | null
	/** A player for one post, to show inside the card, or `null` when the post has none. */
	embedUrl?(item: FeedItem): string | null
}

export type ReadText = (url: string) => Promise<ExternalText>

const providers = new Map<string, FeedProvider>()

/** Registers a provider. Order of registration is the order of the panel's tabs. */
export function registerFeedProvider(provider: FeedProvider): void {
	providers.set(provider.id, provider)
}

export function getFeedProvider(id: string): FeedProvider | undefined {
	return providers.get(id)
}

export function getFeedProviders(): FeedProvider[] {
	return [...providers.values()]
}

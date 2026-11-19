/** The feed card: newest-first posts from the vault's sources, all of them or one category's. */
export const FEED_TYPE = 'node.feed'

export interface FeedProps {
	/** The card's own title: "My feeds". */
	name: string
	/** The chip that is on: a category id, or '' for All. */
	categoryId: string
	/** `all` | `unwatched` */
	show: string
}

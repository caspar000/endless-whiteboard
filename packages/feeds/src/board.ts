/** The feed card: newest-first posts from the vault's sources, all of them or one category's. */
export const FEED_TYPE = 'node.feed'

/**
 * The feed cards whose chosen category was copied to the board (`claimFeeds`), with the copy's id:
 * a card set to "Music" before stays on the board's own Music. Cards on All, or on nothing copied, are
 * left out.
 */
export function remapFeedCards(
	shapes: ReadonlyArray<{ id: string; type: string; props: unknown }>,
	categoryIds: ReadonlyMap<string, string>
): Array<{ id: string; type: string; props: Pick<FeedProps, 'categoryId'> }> {
	return shapes.flatMap((shape) => {
		if (shape.type !== FEED_TYPE) return []
		const to = categoryIds.get((shape.props as FeedProps).categoryId)
		return to ? [{ id: shape.id, type: FEED_TYPE, props: { categoryId: to } }] : []
	})
}

export interface FeedProps {
	/** The card's own title: "My feeds". */
	name: string
	/** The chip that is on: a category id, or '' for All. */
	categoryId: string
	/** `all` | `unwatched` */
	show: string
}

/**
 * What a feed is made of. Sources, categories and watched marks are vault data (`store.ts`), and each
 * belongs to a board (DARK-14): every feed card on that board reads the same ones, and another board has
 * its own. The posts are what the sources last said, kept on this device only, since any device can
 * read them again.
 *
 * Those stored before boards had feeds of their own have no board (`boardId: ''`). Every board with a
 * feed card is given a copy of them as it opens (`claimFeeds`), and they are kept for the randomizers
 * already set to them.
 */

/** Which boards have taken their copy of a source or category from before DARK-14. */
export interface Claimed {
	/** '' for one from before DARK-14, which belongs to no board. */
	boardId: string
	/** On one from before DARK-14: the boards it has been copied to. */
	claimedBy?: string[]
}

/** Something you follow: a YouTube channel, an RSS feed. */
export interface FeedSource extends Claimed {
	sourceId: string
	/** The provider that reads it (`providers/registry.ts`): `youtube`, `rss`. */
	provider: string
	/** The address the provider reads: the channel's feed. */
	feedUrl: string
	/** Where a person goes to see it: the channel's page. */
	link: string
	title: string
	/** The categories it is filed under, by id. Any number of them, none included. */
	categories: string[]
	addedAt: string
}

/** A group of sources you made and named: "Electrical Engineering". */
export interface FeedCategory extends Claimed {
	categoryId: string
	name: string
	/** One of `CATEGORY_COLORS`. */
	color: string
	/** Where its chip sits, left to right. */
	order: number
}

/** A post you have watched or read on a board, by its item id, and when. */
export interface WatchedEntry {
	itemId: string
	at: string
	/** '' for a mark from before DARK-14. */
	boardId: string
}

/** Where a watched mark is kept: by board and item, or by item alone for one from before DARK-14. */
export const watchedKey = (boardId: string, itemId: string) => (boardId ? `${boardId}|${itemId}` : itemId)

/** One video or post. */
export interface FeedItem {
	/** Unique across providers: `yt:<video id>`, or the feed's own id for an RSS item. */
	itemId: string
	sourceId: string
	title: string
	/** Where it opens. */
	url: string
	/** ISO time it was published. */
	published: string
	/** A picture of it, or ''. */
	thumbnail: string
}

/** What one source last said, on this device. */
export interface SourceItems {
	sourceId: string
	/** ISO time of the last read that worked, or '' before the first. */
	fetchedAt: string
	items: FeedItem[]
	/** Why the last read failed, or ''. */
	error: string
}

export const CATEGORY_COLORS = ['blue', 'amber', 'pink', 'green', 'violet', 'teal'] as const

/** The newest posts each source keeps. YouTube's feed lists 15, so a source keeps a few weeks' worth beyond it. */
export const ITEMS_PER_SOURCE = 60

/**
 * A watched mark older than this is dropped: its post has long left every feed (YouTube's lists 15),
 * and the marks are one vault setting, written whole, so they must not grow for ever.
 */
export const WATCHED_KEPT_DAYS = 120

export type Show = 'all' | 'unwatched'

/** An id for a new source or category; not shown anywhere. */
export function makeId(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** The categories in chip order. */
export function orderedCategories(categories: Readonly<Record<string, FeedCategory>>): FeedCategory[] {
	return Object.values(categories).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** The colour a new category gets: the one fewest categories have, the first of those on a tie. */
export function nextColor(categories: Readonly<Record<string, FeedCategory>>): string {
	const counts = new Map<string, number>(CATEGORY_COLORS.map((c) => [c, 0]))
	for (const c of Object.values(categories)) counts.set(c.color, (counts.get(c.color) ?? 0) + 1)
	return CATEGORY_COLORS.reduce((best, c) => ((counts.get(c) ?? 0) < (counts.get(best) ?? 0) ? c : best), CATEGORY_COLORS[0])
}

/** A category's name, tidied, or why it can't be used. */
export function checkCategoryName(name: string, categories: Readonly<Record<string, FeedCategory>>, except = ''): { name: string } | { error: string } {
	const tidy = name.trim().replace(/\s+/g, ' ')
	if (!tidy) return { error: 'Give the category a name.' }
	if (tidy.length > 60) return { error: 'Keep it under 60 characters.' }
	const taken = Object.values(categories).some((c) => c.categoryId !== except && c.name.toLowerCase() === tidy.toLowerCase())
	return taken ? { error: `There is already a category called ${tidy}.` } : { name: tidy }
}

/** Which sources a chip shows: all of them for `''`, else those filed under the category. */
export function sourcesIn(sources: Readonly<Record<string, FeedSource>>, categoryId: string): FeedSource[] {
	const all = Object.values(sources)
	return categoryId ? all.filter((s) => s.categories.includes(categoryId)) : all
}

/**
 * The feed: every post of the sources in a category (or all of them), newest first. `keep` holds posts
 * that stay in an unwatched list after being watched, so a row doesn't vanish under the pointer that
 * just opened it.
 */
export function feedItems(
	sources: Readonly<Record<string, FeedSource>>,
	items: Readonly<Record<string, SourceItems>>,
	watched: Readonly<Record<string, WatchedEntry>>,
	{ categoryId, show, keep }: { categoryId: string; show: Show; keep?: ReadonlySet<string> }
): FeedItem[] {
	const seen = new Set<string>()
	const out: FeedItem[] = []
	for (const source of sourcesIn(sources, categoryId)) {
		for (const item of items[source.sourceId]?.items ?? []) {
			// The same post from two sources (one feed added twice under two addresses) is shown once.
			if (seen.has(item.itemId)) continue
			seen.add(item.itemId)
			if (show === 'unwatched' && watched[item.itemId] && !keep?.has(item.itemId)) continue
			out.push(item)
		}
	}
	return out.sort(newestFirst)
}

export function newestFirst(a: FeedItem, b: FeedItem): number {
	return b.published.localeCompare(a.published) || a.itemId.localeCompare(b.itemId)
}

/** How many posts in a category (or all) are not watched yet. */
export function unwatchedCount(
	sources: Readonly<Record<string, FeedSource>>,
	items: Readonly<Record<string, SourceItems>>,
	watched: Readonly<Record<string, WatchedEntry>>,
	categoryId: string
): number {
	return feedItems(sources, items, watched, { categoryId, show: 'unwatched' }).length
}

/**
 * What a source keeps after a read: the new posts over the old (a title can change), then the old ones
 * the feed no longer lists, newest first, up to `ITEMS_PER_SOURCE`.
 */
export function mergeItems(old: readonly FeedItem[], fresh: readonly FeedItem[]): FeedItem[] {
	const byId = new Map<string, FeedItem>()
	for (const item of old) byId.set(item.itemId, item)
	for (const item of fresh) byId.set(item.itemId, item)
	return [...byId.values()].sort(newestFirst).slice(0, ITEMS_PER_SOURCE)
}

/** The watched marks, without those older than `WATCHED_KEPT_DAYS`. */
export function pruneWatched(watched: Readonly<Record<string, WatchedEntry>>, now = new Date()): Record<string, WatchedEntry> {
	const cutoff = new Date(now.getTime() - WATCHED_KEPT_DAYS * 86_400_000).toISOString()
	return Object.fromEntries(Object.entries(watched).filter(([, w]) => w.at >= cutoff))
}

/** "42m ago", "3h ago", "2d ago", or the date when it was over a month ago. */
export function timeAgo(iso: string, now = Date.now()): string {
	const then = Date.parse(iso)
	if (Number.isNaN(then)) return ''
	const minutes = Math.floor((now - then) / 60_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes}m ago`
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`
	if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}d ago`
	return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

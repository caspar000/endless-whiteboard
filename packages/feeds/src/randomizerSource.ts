import type { RandomizerSource, SourceChoice, SourceEntry, SourceKind } from '@lifeboard/randomizer'
import { Rss } from 'lucide-react'
import { newestFirst, orderedCategories, type FeedCategory, type FeedItem, type FeedSource, type SourceItems } from './model'
import { watchFeeds } from './refresh'
import { getCategories, getSourceItems, getSources, setWatched } from './store'

/**
 * Feeds as something a randomizer can shuffle (DARK-7): every post, a category's, or one channel's.
 * The randomizer knows nothing of feeds; this is the whole of the connection.
 *
 * A choice is `all`, `cat:<category id>` or `src:<source id>`. Every post a source keeps is in the
 * shuffle, watched or not: a randomizer is for "what next" over the whole backlog, and what to leave
 * out is what its stamps are for.
 */

const ALL = 'all'
const CATEGORY = 'cat:'
const SOURCE = 'src:'

/** The sources a choice covers, or `null` when it names a category or a source that is gone. */
export function sourcesOfChoice(sources: Readonly<Record<string, FeedSource>>, categories: Readonly<Record<string, FeedCategory>>, choiceId: string): FeedSource[] | null {
	if (choiceId === ALL) return Object.values(sources)
	if (choiceId.startsWith(CATEGORY)) {
		const categoryId = choiceId.slice(CATEGORY.length)
		return categories[categoryId] ? Object.values(sources).filter((s) => s.categories.includes(categoryId)) : null
	}
	if (choiceId.startsWith(SOURCE)) {
		const source = sources[choiceId.slice(SOURCE.length)]
		return source ? [source] : null
	}
	return null
}

/** What a choice can be: all feeds, then the categories in chip order, then each source by name. */
export function feedChoices(sources: Readonly<Record<string, FeedSource>>, categories: Readonly<Record<string, FeedCategory>>): SourceChoice[] {
	return [
		{ id: ALL, label: 'All feeds', group: '' },
		...orderedCategories(categories).map((c) => ({ id: `${CATEGORY}${c.categoryId}`, label: c.name, group: 'Categories' })),
		...Object.values(sources)
			.sort((a, b) => a.title.localeCompare(b.title))
			.map((s) => ({ id: `${SOURCE}${s.sourceId}`, label: s.title, group: 'Channels and feeds' })),
	]
}

/** "12 Nov 2026": a video's date, where an album has its year. */
function day(iso: string): string {
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A choice's posts as a randomizer's entries, newest first, each post once. */
export function feedEntries(
	sources: Readonly<Record<string, FeedSource>>,
	categories: Readonly<Record<string, FeedCategory>>,
	items: Readonly<Record<string, SourceItems>>,
	choiceId: string
): SourceEntry[] {
	const covered = sourcesOfChoice(sources, categories, choiceId) ?? []
	const seen = new Set<string>()
	const posts: Array<FeedItem & { from: string }> = []
	for (const source of covered) {
		for (const item of items[source.sourceId]?.items ?? []) {
			if (seen.has(item.itemId)) continue
			seen.add(item.itemId)
			posts.push({ ...item, from: source.title })
		}
	}
	return posts.sort(newestFirst).map((post) => ({
		id: post.itemId,
		title: post.title || post.url,
		creator: post.from,
		year: day(post.published),
		cover: post.thumbnail,
		url: post.url,
	}))
}

/** Videos when every source a choice covers is a YouTube channel, posts otherwise. */
export function feedKind(sources: Readonly<Record<string, FeedSource>>, categories: Readonly<Record<string, FeedCategory>>, choiceId: string): SourceKind {
	const covered = sourcesOfChoice(sources, categories, choiceId) ?? []
	const videos = covered.length > 0 && covered.every((s) => s.provider === 'youtube')
	// Thumbnails are wider than tall, so they sit on the mat whole rather than cropped to a square.
	return videos
		? { noun: 'videos', one: 'video', creator: 'Channel', tag: '', shape: 'poster' }
		: { noun: 'posts', one: 'post', creator: 'From', tag: '', shape: 'poster' }
}

export const feedsRandomizerSource: RandomizerSource = {
	id: 'feeds',
	label: 'Feeds',
	icon: Rss,
	extensionId: 'lifeboard.feeds',
	choices: () => feedChoices(getSources(), getCategories()),
	entries: (choiceId) => feedEntries(getSources(), getCategories(), getSourceItems(), choiceId),
	kind: (choiceId) => feedKind(getSources(), getCategories(), choiceId),
	// The same refresh a feed card keeps going while it is open.
	watch: () => watchFeeds(),
	// As a feed card opens a post: in a new tab, and marked watched.
	open: ({ id, url }) => {
		window.open(url, '_blank', 'noopener,noreferrer')
		setWatched([id], true)
	},
}

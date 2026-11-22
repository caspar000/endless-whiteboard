import type { ItemSource, SourceChoice, SourceEntry, SourceKind } from '@lifeboard/node-kit'
import { Rss } from 'lucide-react'
import { newestFirst, orderedCategories, type FeedCategory, type FeedItem, type FeedSource, type SourceItems } from './model'
import { watchFeeds } from './refresh'
import { categoriesOn, getCategories, getSourceItems, getSources, setWatched } from './store'

/**
 * Feeds as something a randomizer can shuffle (DARK-7): every post, or a category's. The randomizer
 * knows nothing of feeds; this is the whole of the connection.
 *
 * A choice is `all:<board id>`, every feed of a board, or `cat:<category id>`, which belongs to a board
 * already (DARK-14: feeds are a board's). One channel alone is not offered (DARK-14): a shuffle is for
 * a mix, and one channel is better browsed on its card. A card set to one before keeps drawing from it,
 * as one set to `all` keeps drawing from the feeds from before boards had their own. Every post a source keeps is in the
 * shuffle, watched or not: a randomizer is for "what next" over the whole backlog, and what to leave
 * out is what its stamps are for.
 */

const ALL = 'all'
const ALL_ON = 'all:'
const CATEGORY = 'cat:'
const SOURCE = 'src:'

/** The sources a choice covers, or `null` when it names a category or a source that is gone. */
export function sourcesOfChoice(sources: Readonly<Record<string, FeedSource>>, categories: Readonly<Record<string, FeedCategory>>, choiceId: string): FeedSource[] | null {
	if (choiceId === ALL) return Object.values(sources).filter((s) => !s.boardId)
	if (choiceId.startsWith(ALL_ON)) {
		const boardId = choiceId.slice(ALL_ON.length)
		return Object.values(sources).filter((s) => s.boardId === boardId)
	}
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

/** What a choice on a board can be: all its feeds, then its categories in chip order. Never one channel alone. */
export function feedChoices(boardId: string, categories: Readonly<Record<string, FeedCategory>>): SourceChoice[] {
	return [
		{ id: `${ALL_ON}${boardId}`, label: 'All feeds', group: '' },
		...orderedCategories(categories).map((c) => ({ id: `${CATEGORY}${c.categoryId}`, label: c.name, group: 'Categories' })),
	]
}

/** One choice by its id, on any board, or `null` when it is gone. */
export function feedChoice(sources: Readonly<Record<string, FeedSource>>, categories: Readonly<Record<string, FeedCategory>>, choiceId: string): SourceChoice | null {
	if (choiceId === ALL || choiceId.startsWith(ALL_ON)) return { id: choiceId, label: 'All feeds', group: '' }
	if (choiceId.startsWith(CATEGORY)) {
		const category = categories[choiceId.slice(CATEGORY.length)]
		return category ? { id: choiceId, label: category.name, group: 'Categories' } : null
	}
	if (choiceId.startsWith(SOURCE)) {
		const source = sources[choiceId.slice(SOURCE.length)]
		return source ? { id: choiceId, label: source.title, group: 'Channels and feeds' } : null
	}
	return null
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

export const feedsRandomizerSource: ItemSource = {
	id: 'feeds',
	label: 'Feeds',
	icon: Rss,
	extensionId: 'lifeboard.feeds',
	choices: (boardId) => feedChoices(boardId, categoriesOn(boardId)),
	choice: (choiceId) => feedChoice(getSources(), getCategories(), choiceId),
	entries: (choiceId) => feedEntries(getSources(), getCategories(), getSourceItems(), choiceId),
	kind: (choiceId) => feedKind(getSources(), getCategories(), choiceId),
	// The same refresh a feed card keeps going while it is open.
	watch: () => watchFeeds(),
	// As a feed card opens a post: in a new tab, and marked watched on the board it was opened from,
	// and no other: another board's feed keeps it unwatched until it is watched there (DARK-14).
	open: ({ id, url }, boardId) => {
		window.open(url, '_blank', 'noopener,noreferrer')
		setWatched(boardId, [id], true)
	},
}

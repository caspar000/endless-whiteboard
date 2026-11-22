import { matchesSearch } from '@lifeboard/node-kit'
import type { ItemDef } from '../syllabus'

/** What a search of a list left showing (DARK-13). */
export interface TrackSearch {
	/** Items whose own title matches. Their works all show, folded as you left them. */
	matched: ReadonlySet<string>
	/** Items with a match somewhere under them: unfolded, to show it. */
	within: ReadonlySet<string>
	/** Everything shown: the matches, and every item a match sits under. */
	shown: ReadonlySet<string>
	/** How many items match. */
	count: number
}

/**
 * A list searched: every entry and work whose title has every word typed, wherever it is in the
 * outline, with the entries it sits under, so a work is found inside its entry rather than on its own.
 */
export function searchTrack(entries: readonly ItemDef[], all: Readonly<Record<string, ItemDef>>, query: string): TrackSearch {
	const matched = new Set<string>()
	const within = new Set<string>()
	const shown = new Set<string>()
	const seen = new Set<string>()
	const walk = (item: ItemDef, depth: number): boolean => {
		if (seen.has(item.itemId) || depth > 16) return false
		seen.add(item.itemId)
		let below = false
		for (const id of item.children) {
			const child = all[id]
			if (child && walk(child, depth + 1)) below = true
		}
		const self = matchesSearch({ title: item.title, creator: '' }, query)
		if (self) matched.add(item.itemId)
		if (below) within.add(item.itemId)
		if (self || below) shown.add(item.itemId)
		return self || below
	}
	for (const entry of entries) walk(entry, 0)
	return { matched, within, shown, count: matched.size }
}

import {
	PLAIN_KIND,
	getItemStamps,
	resolveItemSource,
	sourceEntries,
	sourceKey,
	watchSourceKeys,
	type ItemSource,
	type ItemStamp,
	type SourceChoice,
	type SourceEntry,
} from '@lifeboard/node-kit'
import { ListOrdered } from 'lucide-react'
import { keepsStamped, mergeEntries, placedIds, rankedKeys, ranksStamps, weightedEntries, type Ranking } from './model'
import { rankings } from './store'

export const RANKING_EXTENSION_ID = 'lifeboard.ranking-tiers'
/** The first half of a ranking's source key. A ranking never ranks one of these: it would rank itself. */
export const RANKING_SOURCE_ID = 'ranking'

/** What a ranking is called: its own name, or else what it ranks. */
export function rankingLabel(ranking: Ranking): string {
	if (ranking.name) return ranking.name
	const ranked = resolveItemSource(ranking.source)
	return ranked.type === 'source' ? `${ranked.name}, ranked` : 'A ranking'
}

/**
 * Rankings whose weighted shuffle is on, for a randomizer: each draws its ranked items by their tier's
 * weight. A ranking with it off is a ranking only, and isn't offered.
 */
export function rankingChoices(all: Readonly<Record<string, Ranking>>): SourceChoice[] {
	return Object.values(all)
		.filter((r) => r.weighted && r.source)
		.map((r) => ({ id: r.rankingId, label: rankingLabel(r), group: '' }))
		.sort((a, b) => a.label.localeCompare(b.label))
}

/** A ranking's source keys: its own, and the other stamped lists it shows (`rankedKeys`). */
export function keysOf(ranking: Ranking): string[] {
	const stamps = getItemStamps()
	return rankedKeys(ranking, stamps?.sourceId ?? null, stamps?.kinds.map((k) => k.id) ?? [])
}

/**
 * What a ranking ranks now, read reactively: its source's entries, with the other stamped lists it
 * shows, less the covers whose stamp it hides (DARK-13). With each entry, its latest stamp.
 */
export function rankedEntries(ranking: Ranking): { entries: SourceEntry[]; stamps: Map<string, ItemStamp> } {
	const provider = getItemStamps()
	// A ranking of the stamped lists also reads the lists it doesn't show, for the covers it has put in
	// tiers whose stamp has since changed: ranking one stamps it Liked, and it stays where it was put.
	const keys = provider && ranksStamps(ranking, provider.sourceId) ? provider.kinds.map((k) => `${provider.sourceId}:${k.id}`) : keysOf(ranking)
	const entries = mergeEntries([...new Set([ranking.source, ...keys])].map((key) => sourceEntries(key)))
	const stamps = new Map<string, ItemStamp>()
	if (!provider) return { entries, stamps }
	const placed = placedIds(ranking)
	const shown = entries.filter((entry) => {
		const stamp = provider.stampOf(entry)
		if (!stamp) return true
		stamps.set(entry.id, stamp)
		return keepsStamped(ranking, stamp.kind, provider.sourceId, placed.has(entry.id))
	})
	return { entries: shown, stamps }
}

const ranked = (rankingId: string) => {
	const ranking = rankings.one(rankingId)
	return ranking?.weighted ? ranking : null
}

export const rankingSource: ItemSource = {
	id: RANKING_SOURCE_ID,
	label: 'Rankings',
	icon: ListOrdered,
	extensionId: RANKING_EXTENSION_ID,
	// What it offers is ranked items, to be drawn by their tiers: ranking them is no reason to leave out.
	ranked: true,
	choices: () => rankingChoices(rankings.get()),
	entries: (rankingId) => {
		const ranking = ranked(rankingId)
		return ranking ? weightedEntries(ranking, rankedEntries(ranking).entries) : []
	},
	kind: (rankingId) => {
		const ranking = ranked(rankingId)
		return ranking ? resolveItemSource(ranking.source).kind : PLAIN_KIND
	},
	// An item keeps itself fresh, and opens, as the source it was ranked from would; a ranking pointed
	// at another source while a randomizer draws from it is followed there.
	watch: (rankingId) => {
		const ranking = () => rankings.one(rankingId)
		return watchSourceKeys(sourceKey(RANKING_SOURCE_ID, rankingId), () => {
			const r = ranking()
			return r ? keysOf(r) : []
		})
	},
	open: (entry) => {
		for (const ranking of Object.values(rankings.get())) {
			const from = resolveItemSource(ranking.source)
			if (from.source?.open && sourceEntries(ranking.source).some((e) => e.id === entry.id)) return from.source.open(entry)
		}
		window.open(entry.url, '_blank', 'noopener,noreferrer')
	},
}

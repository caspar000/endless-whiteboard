import { PLAIN_KIND, resolveItemSource, sourceEntries, type ItemSource, type SourceChoice } from '@lifeboard/node-kit'
import { ListOrdered } from 'lucide-react'
import { weightedEntries, type Ranking } from './model'
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

const ranked = (rankingId: string) => {
	const ranking = rankings.one(rankingId)
	return ranking?.weighted ? ranking : null
}

export const rankingSource: ItemSource = {
	id: RANKING_SOURCE_ID,
	label: 'Rankings',
	icon: ListOrdered,
	extensionId: RANKING_EXTENSION_ID,
	choices: () => rankingChoices(rankings.get()),
	entries: (rankingId) => {
		const ranking = ranked(rankingId)
		return ranking ? weightedEntries(ranking, sourceEntries(ranking.source)) : []
	},
	kind: (rankingId) => {
		const ranking = ranked(rankingId)
		return ranking ? resolveItemSource(ranking.source).kind : PLAIN_KIND
	},
	// An item opens, and keeps itself fresh, as the source it was ranked from would.
	watch: (rankingId) => {
		const ranking = ranked(rankingId)
		const from = ranking ? resolveItemSource(ranking.source) : null
		return from?.source?.watch?.(from.choiceId) ?? (() => {})
	},
	open: (entry) => {
		for (const ranking of Object.values(rankings.get())) {
			const from = resolveItemSource(ranking.source)
			if (from.source?.open && sourceEntries(ranking.source).some((e) => e.id === entry.id)) return from.source.open(entry)
		}
		window.open(entry.url, '_blank', 'noopener,noreferrer')
	},
}

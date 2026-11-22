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
import { mergeEntries, rankedKeys, rankingView, weightedEntries, type Ranking } from './model'
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

/** A choice for one tier of a ranking (DARK-14): `<ranking id>#<tier id>`. A bare ranking id is the whole ranking, weighted. */
export function tierChoiceId(rankingId: string, tierId: string): string {
	return `${rankingId}#${tierId}`
}

function parseChoice(choiceId: string): { rankingId: string; tierId: string | null } {
	const hash = choiceId.indexOf('#')
	return hash < 0 ? { rankingId: choiceId, tierId: null } : { rankingId: choiceId.slice(0, hash), tierId: choiceId.slice(hash + 1) }
}

/** One choice by its id, on any board: a weighted ranking whole, or one tier of any ranking. `null` when it is gone. */
export function rankingChoice(all: Readonly<Record<string, Ranking>>, choiceId: string): SourceChoice | null {
	const { rankingId, tierId } = parseChoice(choiceId)
	const ranking = all[rankingId]
	if (!ranking?.source) return null
	const label = rankingLabel(ranking)
	if (tierId === null) return ranking.weighted ? { id: choiceId, label, group: label } : null
	const tier = ranking.tiers.find((t) => t.id === tierId)
	return tier ? { id: choiceId, label: `${label}: ${tier.name}`, group: label } : null
}

/**
 * What a randomizer on a board can draw from its rankings (DARK-14): each tier of each, and a ranking
 * with weighted shuffle on whole, by its tiers' weights. Another board's rankings are not offered.
 */
export function rankingChoices(all: Readonly<Record<string, Ranking>>, boardId: string): SourceChoice[] {
	return Object.values(all)
		.filter((r) => r.source && r.boardId === boardId)
		.sort((a, b) => rankingLabel(a).localeCompare(rankingLabel(b)))
		.flatMap((r) => [...(r.weighted ? [r.rankingId] : []), ...r.tiers.map((t) => tierChoiceId(r.rankingId, t.id))])
		.map((id) => rankingChoice(all, id)!)
}

/** A ranking's source keys: its own, and the same stamped list's other kinds (`rankedKeys`). */
export function keysOf(ranking: Ranking): string[] {
	const stamps = getItemStamps()
	return rankedKeys(ranking, stamps?.sourceId ?? null, stamps?.kinds.map((k) => k.id) ?? [])
}

/**
 * What a ranking ranks now, read reactively: its source's entries (on a ranking of a stamped list, every
 * kind of it, so a cover whose stamp changed is still found), each with its latest stamp on the
 * ranking's board. Which of them wait in the queue is the card's to work out (`splitUnranked`).
 */
export function rankedEntries(ranking: Ranking): { entries: SourceEntry[]; stamps: Map<string, ItemStamp> } {
	const provider = getItemStamps()
	const entries = mergeEntries(keysOf(ranking).map((key) => sourceEntries(key)))
	const stamps = new Map<string, ItemStamp>()
	if (provider) {
		for (const entry of entries) {
			const stamp = provider.stampOf(entry, ranking.boardId)
			if (stamp) stamps.set(entry.id, stamp)
		}
	}
	return { entries, stamps }
}

/** What one choice draws: a weighted ranking's ranked items with their weights, or one tier's, evenly. */
function choiceEntries(choiceId: string): SourceEntry[] {
	const { rankingId, tierId } = parseChoice(choiceId)
	const ranking = rankings.one(rankingId)
	if (!ranking) return []
	if (tierId === null) return ranking.weighted ? weightedEntries(ranking, rankedEntries(ranking).entries) : []
	return rankingView(ranking, rankedEntries(ranking).entries).bands.find((b) => b.tier.id === tierId)?.items ?? []
}

export const rankingSource: ItemSource = {
	id: RANKING_SOURCE_ID,
	label: 'Rankings',
	icon: ListOrdered,
	extensionId: RANKING_EXTENSION_ID,
	// What it offers is ranked items, to be drawn by their tiers: ranking them is no reason to leave out.
	ranked: true,
	choices: (boardId) => rankingChoices(rankings.get(), boardId),
	choice: (choiceId) => rankingChoice(rankings.get(), choiceId),
	entries: choiceEntries,
	kind: (choiceId) => {
		const ranking = rankings.one(parseChoice(choiceId).rankingId)
		return ranking ? resolveItemSource(ranking.source).kind : PLAIN_KIND
	},
	// An item keeps itself fresh, and opens, as the source it was ranked from would; a ranking pointed
	// at another source while a randomizer draws from it is followed there.
	watch: (choiceId) => {
		const { rankingId } = parseChoice(choiceId)
		return watchSourceKeys(sourceKey(RANKING_SOURCE_ID, choiceId), () => {
			const r = rankings.one(rankingId)
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

import { keyedStore } from '@lifeboard/node-kit'
import { newRanking, readRanking, type Ranking } from './model'
import { getPrefs } from './prefs'

/**
 * Every ranking, kept in the vault (the app saves it beside the feeds), so a randomizer on any board,
 * or another device, draws from the same one. A card holds only its ranking's id.
 */
export const rankings = keyedStore<Ranking>('lifeboard:rankings', readRanking, (r) => r.rankingId)

/** A ranking as a card shows it: the stored one, or a new one, with the tiers Settings gives new cards, until it is first changed. */
export function rankingOrNew(rankingId: string): Ranking {
	return rankings.one(rankingId) ?? newRanking(rankingId, getPrefs().tiers)
}

/** Changes a ranking, making it first if this is its first change. */
export function updateRanking(rankingId: string, change: (ranking: Ranking) => Ranking | null): void {
	const next = change(rankingOrNew(rankingId))
	if (next) rankings.put(rankingId, next)
}

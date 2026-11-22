import { keyedStore } from '@lifeboard/node-kit'
import { newRanking, readRanking, type Ranking } from './model'
import { getPrefs } from './prefs'

/**
 * Every ranking, kept in the vault (the app saves it beside the feeds), so a randomizer on its board,
 * on any device, draws from the same one. A card holds only its ranking's id. Each ranking belongs to
 * the board it was made on (DARK-14): only a randomizer there is offered it.
 */
export const rankings = keyedStore<Ranking>('lifeboard:rankings', readRanking, (r) => r.rankingId)

/** A ranking as a card shows it: the stored one, or a new one, with the tiers Settings gives new cards, until it is first changed. */
export function rankingOrNew(rankingId: string, boardId = ''): Ranking {
	return rankings.one(rankingId) ?? newRanking(rankingId, getPrefs().tiers, boardId)
}

/**
 * Changes a ranking, making it first if this is its first change: on `boardId`, the board of the card
 * that changed it. One stored before rankings had boards takes that board too.
 */
export function updateRanking(rankingId: string, change: (ranking: Ranking) => Ranking | null, boardId = ''): void {
	const next = change(rankingOrNew(rankingId, boardId))
	if (next) rankings.put(rankingId, next.boardId || !boardId ? next : { ...next, boardId })
}

/** A ranking from before DARK-14 belongs to the first board that opens showing it. */
export function claimRanking(rankingId: string, boardId: string): void {
	const ranking = rankings.one(rankingId)
	if (ranking && !ranking.boardId && boardId) rankings.put(rankingId, { ...ranking, boardId })
}

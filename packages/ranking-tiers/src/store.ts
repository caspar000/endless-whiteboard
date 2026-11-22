import { getItemStamps, keyedStore } from '@lifeboard/node-kit'
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

/**
 * A ranking from before DARK-14 belongs to the first board that opens showing it. One set to a stamped
 * list from before then (everything liked anywhere) is moved onto its board's own, its tiers with it,
 * so another board's stamps never reach it.
 */
export function claimRanking(rankingId: string, boardId: string): void {
	const ranking = rankings.one(rankingId)
	if (!ranking || !boardId) return
	const board = ranking.boardId || boardId
	const to = getItemStamps()?.scopeToBoard?.(ranking.source, board) ?? null
	if (ranking.boardId && !to) return
	const { [ranking.source]: placed, ...rest } = ranking.placed
	rankings.put(rankingId, { ...ranking, boardId: board, ...(to ? { source: to, placed: placed ? { ...rest, [to]: placed } : rest } : {}) })
}

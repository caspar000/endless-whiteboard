import { atom } from '@lifeboard/canvas'
import { getItemStamps, keyedStore } from '@lifeboard/node-kit'
import { collectionKey, newBacklog, readBacklog, type Backlog } from './model'

/**
 * Every backlog, kept in the vault (the app saves it beside the feeds), so a randomizer or a ranking on
 * its board, on any device, reads the same one. A card holds only its backlog's id. Each belongs to the
 * board it was made on (DARK-14): only cards there are offered it.
 */
export const backlogs = keyedStore<Backlog>('lifeboard:backlogs', readBacklog, (b) => b.backlogId)

/** A backlog as a card shows it: the stored one, or an empty one until something is added. */
export function backlogOrNew(backlogId: string, boardId = ''): Backlog {
	return backlogs.one(backlogId) ?? newBacklog(backlogId, boardId)
}

/**
 * Changes a backlog, making it first if this is its first change: on `boardId`, the board of the card
 * that changed it. One stored before backlogs had boards takes that board too.
 */
export function updateBacklog(backlogId: string, change: (backlog: Backlog) => Backlog | null, boardId = ''): void {
	const next = change(backlogOrNew(backlogId, boardId))
	if (next) backlogs.put(backlogId, next.boardId || !boardId ? next : { ...next, boardId })
}

/**
 * A backlog from before DARK-14 belongs to the first board that opens showing it. A collection of a
 * stamped list from before then (everything liked anywhere) reads its board's own list from then on, so
 * another board's stamps never reach it. It keeps its id, so its items keep theirs, and whatever
 * ranked or picked them still finds them.
 */
export function claimBacklog(backlogId: string, boardId: string): void {
	const backlog = backlogs.one(backlogId)
	if (!backlog || !boardId) return
	const board = backlog.boardId || boardId
	const scope = getItemStamps()?.scopeToBoard
	let moved = false
	const entries = backlog.entries.map((e) => {
		const to = e.kind === 'collection' ? (scope?.(collectionKey(e), board) ?? null) : null
		if (!to) return e
		moved = true
		return { ...e, key: to }
	})
	if (backlog.boardId && !moved) return
	backlogs.put(backlogId, { ...backlog, boardId: board, entries })
}

/**
 * The backlog card a card is being dragged over, and what it would add: feedback only, never stored,
 * as a kanban's lit lane is.
 */
export const shapeDropHint = atom<{ shapeId: string; label: string } | null>('lifeboard:backlog-drop-hint', null)

import { atom } from '@lifeboard/canvas'
import { keyedStore } from '@lifeboard/node-kit'
import { newBacklog, readBacklog, type Backlog } from './model'

/**
 * Every backlog, kept in the vault (the app saves it beside the feeds), so a randomizer or a ranking on
 * any board, or another device, reads the same one. A card holds only its backlog's id.
 */
export const backlogs = keyedStore<Backlog>('lifeboard:backlogs', readBacklog, (b) => b.backlogId)

/** A backlog as a card shows it: the stored one, or an empty one until something is added. */
export function backlogOrNew(backlogId: string): Backlog {
	return backlogs.one(backlogId) ?? newBacklog(backlogId)
}

/** Changes a backlog, making it first if this is its first change. */
export function updateBacklog(backlogId: string, change: (backlog: Backlog) => Backlog | null): void {
	const next = change(backlogOrNew(backlogId))
	if (next) backlogs.put(backlogId, next)
}

/**
 * The backlog card a card is being dragged over, and what it would add: feedback only, never stored,
 * as a kanban's lit lane is.
 */
export const shapeDropHint = atom<{ shapeId: string; label: string } | null>('lifeboard:backlog-drop-hint', null)

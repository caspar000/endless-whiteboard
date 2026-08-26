import { takeHand } from './hand'
import type { DieKind } from './kinds'
import { rollCounts, type RollResult } from './roll'

/**
 * The roll in flight.
 *
 * Its own store rather than component state, because two callers put a roll here and only one of them
 * has a pointer: releasing dice on the board, and `dice.roll` from the palette or an agent. The
 * overlay is a *view* of whatever was thrown, which is what keeps those two paths from growing two
 * different ideas of what a roll is.
 *
 * In this phase the roll resolves instantly and the overlay simply reads it out. The 3D throw
 * replaces `phase` with a real settle — the shape of what is stored here is already what it needs.
 */
/**
 * Where the dice came to rest, in page coordinates — so the readout can sit *above* the pile instead of
 * on top of it.
 *
 * Reported by the 3D stage once the tumble finishes. Before Phase 2 the readout appeared instantly at
 * the release point, which is exactly where the dice now land: the card covered the thing it was
 * describing.
 */
export interface RollSettlement {
	/** The top of the settled dice, so the card can be placed just clear of them. */
	top: number
	/** The middle of the pile, so the card is centred on the dice rather than on the click. */
	centreX: number
}

export interface ActiveRoll {
	/**
	 * Increments per throw. Rolling the same dice to the same numbers twice must still read as two
	 * rolls, and a `key` that didn't change would leave the first readout sitting there.
	 */
	seq: number
	/** Where it was thrown, in **page** coordinates — so the readout stays put through a pan or zoom. */
	point: { x: number; y: number }
	result: RollResult
	/**
	 * `null` until the dice stop. The readout waits for it, which is what keeps the card from being
	 * drawn over a throw that is still in the air.
	 */
	settlement: RollSettlement | null
}

let active: ActiveRoll | null = null
let seq = 0
const listeners = new Set<() => void>()

export function getActiveRoll(): ActiveRoll | null {
	return active
}

export function subscribeToRolls(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function publish(next: ActiveRoll | null): void {
	active = next
	for (const listener of listeners) listener()
}

/**
 * Throws whatever is in hand at a page point, emptying it.
 *
 * Returns `null` for an empty hand rather than throwing — the release layer only exists while
 * something is held, but a keyboard shortcut can always arrive a frame after the hand was cleared.
 */
export function throwHand(point: { x: number; y: number }): ActiveRoll | null {
	const hand = takeHand()
	if (hand.total === 0) return null
	return throwCounts(point, hand.counts)
}

/**
 * The same throw, from a hand nobody was holding — `dice.roll` with a notation argument, or `> roll`
 * typed into the palette. `modifier` is the flat bonus, which the tray has no way to express and
 * notation does.
 */
export function throwCounts(
	point: { x: number; y: number },
	counts: ReadonlyMap<DieKind, number>,
	modifier = 0
): ActiveRoll {
	const roll: ActiveRoll = {
		seq: ++seq,
		point,
		result: rollCounts(counts, modifier),
		settlement: null,
	}
	publish(roll)
	scheduleFallback(roll)
	return roll
}

/**
 * How long to wait for the 3D stage before showing the result anyway.
 *
 * The readout is gated on the dice settling, and the thing reporting that is a lazily-imported WebGL
 * scene — which may be slow to arrive, or may never arrive at all on a machine with no working GL. The
 * number is not decoration, so it is never allowed to depend on the animation succeeding.
 */
const SETTLE_FALLBACK_MS = 4_000

function scheduleFallback(roll: ActiveRoll): void {
	setTimeout(() => {
		// Only if this is still the roll on screen and nothing has reported a real resting place.
		if (active?.seq !== roll.seq || active.settlement) return
		markRollSettled(roll.seq, { top: roll.point.y, centreX: roll.point.x })
	}, SETTLE_FALLBACK_MS)
}

/**
 * The dice have stopped, and this is where they are.
 *
 * Idempotent per roll, and ignores a report for a roll that has already been replaced — a throw made
 * while the previous one is still settling must not move the new one's card.
 */
export function markRollSettled(seq: number, settlement: RollSettlement): void {
	if (active?.seq !== seq || active.settlement) return
	publish({ ...active, settlement })
}

/**
 * Drops the roll — when its readout has finished fading, and when the board goes away.
 *
 * The second case is the one worth stating: this is module-scope state, so a roll left here would be
 * read out over the *next* board, at a page point that means nothing on it. Unlike the app's tracing
 * lens, nothing outside this package has to remember to call it — the overlay clears on unmount, and
 * the overlay unmounts with the board that renders it.
 */
export function clearRolls(): void {
	if (active === null) return
	publish(null)
}

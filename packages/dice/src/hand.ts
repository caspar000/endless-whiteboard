import { MAX_DICE_IN_HAND, type DieKind } from './kinds'
import { formatNotation } from './notation'

/**
 * What you are holding.
 *
 * Module-scope state with a listener set, read through `useSyncExternalStore` — deliberately **not** a
 * tldraw atom. node-kit's registry documents why (`registry.tsx`): under Vite's dev prebundling the
 * SDK and the app can end up holding two copies of tldraw's signal library, and dependency tracking
 * never crosses that boundary. A package that is meant to be the model for third-party extensions is
 * the last place to bet on that resolving to one copy.
 *
 * It is emphatically not board data. Nothing here reaches the store, so holding dice spends no undo
 * entry, writes no record, and cannot wake the facts pipeline — which is the constraint that lets the
 * tray exist at all without touching the zero-recompute guarantee `e2e/perf.spec.ts` pins down.
 */
export interface Hand {
	/** Only kinds actually held; a kind unloaded to zero is removed rather than left at 0. */
	counts: ReadonlyMap<DieKind, number>
	total: number
	/** `2d6 + 1d12`, or `''` for an empty hand. Precomputed: the cursor reads it on every move. */
	notation: string
}

const EMPTY: Hand = { counts: new Map(), total: 0, notation: '' }

let hand: Hand = EMPTY
const listeners = new Set<() => void>()

/**
 * A stable snapshot between changes — the same contract `getVisibleCommands` keeps, and for the same
 * reason: a fresh object per call makes `useSyncExternalStore` re-render without end.
 */
export function getHand(): Hand {
	return hand
}

export function subscribeToHand(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function commit(counts: Map<DieKind, number>): void {
	let total = 0
	for (const count of counts.values()) total += count
	hand = total === 0 ? EMPTY : { counts, total, notation: formatNotation(counts) }
	for (const listener of listeners) listener()
}

/**
 * Loads one more of a kind. At the cap this does nothing at all — silently, and on purpose: a toast
 * for "you have loaded forty dice" would be scolding someone for holding down a button.
 */
export function loadDie(kind: DieKind): void {
	if (hand.total >= MAX_DICE_IN_HAND) return
	const counts = new Map(hand.counts)
	counts.set(kind, (counts.get(kind) ?? 0) + 1)
	commit(counts)
}

/** Puts one back. Removes the kind entirely at zero, so `counts` never carries a 0. */
export function unloadDie(kind: DieKind): void {
	const held = hand.counts.get(kind) ?? 0
	if (held === 0) return
	const counts = new Map(hand.counts)
	if (held === 1) counts.delete(kind)
	else counts.set(kind, held - 1)
	commit(counts)
}

/** Guarded, so Escape on an empty hand notifies nobody. */
export function clearHand(): void {
	if (hand.total === 0) return
	hand = EMPTY
	for (const listener of listeners) listener()
}

/** Empties the hand *and* returns what was in it, so a throw is one step rather than a read and a clear. */
export function takeHand(): Hand {
	const taken = hand
	clearHand()
	return taken
}

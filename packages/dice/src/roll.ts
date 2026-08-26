import { facesOf, type DieKind } from './kinds'
import { formatNotation } from './notation'

export interface RolledDie {
	kind: DieKind
	/** `1..facesOf(kind)`. A d100 is 1..100, not 00..90 — the markings are the die's, not the value's. */
	value: number
}

export interface RollResult {
	dice: readonly RolledDie[]
	/** The flat bonus or penalty, already included in `total`. `0` when there is none. */
	modifier: number
	/** The faces **plus the modifier** — the number you actually read off a roll. */
	total: number
	/** What was rolled, as written: `2d6 + 1d12`, `2d20 + 10`. Kept so a readout needs no second look. */
	notation: string
}

/** How random numbers arrive. A parameter so the rejection branch below can be tested at all. */
export type RandomBytes = (out: Uint8Array) => void

const cryptoBytes: RandomBytes = (out) => {
	crypto.getRandomValues(out)
}

/**
 * One face, uniformly.
 *
 * The rejection sampling is the whole point of this function existing. `getRandomValues(byte) % 20`
 * is the obvious version and it is **biased**: 256 is not a multiple of 20, so the twelve values
 * 240–255 fold back onto faces 1–16, which come up 13/256 of the time against 12/256 for faces
 * 17–20. On a d20 that is a ~7% thumb on the scale against rolling well, which is precisely the
 * number anyone using this cares about. Discarding the short tail instead makes every face exactly
 * equally likely.
 *
 * The loop is unbounded because a bounded one would have to return *something* on giving up, and any
 * such fallback is the bias again. It terminates with probability 1, and for our widest die (d100,
 * where 56 of 256 bytes are discarded) the expected number of draws is about 1.3.
 */
export function randomFace(faces: number, bytes: RandomBytes = cryptoBytes): number {
	if (!Number.isInteger(faces) || faces < 1 || faces > 256) {
		throw new Error(`randomFace: ${faces} faces is out of range`)
	}
	// The largest multiple of `faces` that fits in a byte. Draws at or above it are thrown away.
	const limit = Math.floor(256 / faces) * faces
	const out = new Uint8Array(1)
	for (;;) {
		bytes(out)
		const draw = out[0] ?? 0
		if (draw < limit) return (draw % faces) + 1
	}
}

/**
 * Rolls a hand.
 *
 * Dice are returned in `DIE_KINDS` order, which is the order the tray shows them and therefore the
 * order the notation reads in — a result whose dice were listed in whatever order they were clicked
 * would not line up with the string above it.
 */
export function rollCounts(
	counts: ReadonlyMap<DieKind, number>,
	modifier = 0,
	bytes: RandomBytes = cryptoBytes
): RollResult {
	const dice: RolledDie[] = []
	for (const [kind, count] of orderedCounts(counts)) {
		for (let i = 0; i < count; i++) dice.push({ kind, value: randomFace(facesOf(kind), bytes) })
	}
	return {
		dice,
		modifier,
		total: dice.reduce((sum, die) => sum + die.value, 0) + modifier,
		notation: formatNotation(counts, modifier),
	}
}

/** `counts` in tray order, skipping kinds that are absent or zero. */
function orderedCounts(counts: ReadonlyMap<DieKind, number>): [DieKind, number][] {
	return [...counts].filter(([, count]) => count > 0).sort(byTrayOrder)
}

function byTrayOrder(a: [DieKind, number], b: [DieKind, number]): number {
	return facesOf(a[0]) - facesOf(b[0])
}

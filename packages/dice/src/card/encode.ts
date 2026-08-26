import { DIE_KINDS, isDieKind } from '../kinds'
import type { RolledDie } from '../roll'

/**
 * The dice of a roll, as one string.
 *
 * A card's props have to be JSON scalars (§7, and the same constraint that makes a quote encode its
 * highlight rectangles into one field), so the list of dice is written `d20:14,d6:3` and read back.
 * Order is preserved, because a roll's dice are shown in the order they were rolled and the card has
 * to agree with the readout it replaced.
 *
 * Round-tripping is what the test asserts; nothing else in the package touches the format.
 */
export function encodeDice(dice: readonly RolledDie[]): string {
	return dice.map((die) => `${die.kind}:${die.value}`).join(',')
}

/**
 * Reads it back, skipping anything it cannot make sense of.
 *
 * Lenient on purpose: this parses a *stored* string, which may have been written by an older build or
 * hand-edited by someone poking at a backup. A card that renders the dice it can understand is better
 * than one that refuses to render at all.
 */
export function decodeDice(encoded: string): RolledDie[] {
	const dice: RolledDie[] = []
	for (const part of encoded.split(',')) {
		const [kind, raw] = part.trim().split(':')
		if (!kind || !isDieKind(kind)) continue
		const value = Number(raw)
		if (!Number.isInteger(value) || value < 1) continue
		dice.push({ kind, value })
	}
	return dice
}

/** Every kind, so a test can iterate without importing two modules. */
export const ENCODABLE_KINDS = DIE_KINDS

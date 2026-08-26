/**
 * The dice, and how many faces each has.
 *
 * One table, ordered as the tray draws them — smallest to largest, with the percentile die last
 * because it is a d10 read differently rather than a bigger polyhedron. Everything else in this
 * package derives from this: the tray's buttons, the notation parser's vocabulary, and (in a later
 * phase) which geometry gets built.
 */
export const DIE_KINDS = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const

export type DieKind = (typeof DIE_KINDS)[number]

const FACES: Record<DieKind, number> = {
	d4: 4,
	d6: 6,
	d8: 8,
	d10: 10,
	d12: 12,
	d20: 20,
	d100: 100,
}

export function facesOf(kind: DieKind): number {
	return FACES[kind]
}

export function isDieKind(value: string): value is DieKind {
	return Object.hasOwn(FACES, value)
}

/**
 * How many dice one hand may hold.
 *
 * A limit rather than none, for two reasons that arrive at the same number. A readout of two hundred
 * faces is not something anyone reads, and the 3D roll this becomes is a rigid-body simulation whose
 * cost is quadratic in the contact count — a hand nobody meant to load would drop the frame rate on
 * the whole board. Forty is far past any real roll (a fireball is 8d6) and nowhere near either problem.
 *
 * Enforced in two places for two different callers: the tray stops loading, and the notation parser
 * refuses, because an agent asking for `500d20` deserves a sentence rather than a hung tab.
 */
export const MAX_DICE_IN_HAND = 40

import type { CSSProperties } from 'react'

/**
 * Where each card of the stack sits, by its slot: 0 in front, 1 and on behind it, -1 flipped away.
 *
 * The cards behind climb up out of the pile by a bounded exponential: card k's top edge is
 * `RISE · (1 − STEP^k)` of a card's height above the front card's. The first card behind shows a
 * good strip, each next one a smaller part of what is left, so the pile shows depth without ever
 * reaching further than RISE. Each card is a little narrower and a little more in shade the same way.
 */

/** How many cards behind the front one can be seen. Past that the strips are thinner than a line. */
export const PILE_DEPTH = 8
/** The most the pile climbs above the front card, as a part of a card's height. */
export const RISE = 0.4
/** What each next strip is of the one before. */
const STEP = 0.68
/** The most a card behind is narrowed, and shaded. */
const NARROW = 0.16
const SHADE = 0.16
/** A strip shows its card's number only if it is at least this much of a card's height (the number's room). */
const ID_ROOM = 0.075

/**
 * The flip: a card swings away round a pivot just right of the card at its top edge, up and over to
 * the right, fading as it goes; going back plays the swing in reverse. The pivot is written
 * from the card's top middle (the transform's origin), in parts of its own width and height.
 */
const PIVOT_X = '62%'
const PIVOT_Y = '6%'
const FLIP_TURN = 115

/** Slots beyond these are held at them (StackView): -1 flipped away, PILE_DEPTH + 1 gone into the back. */
export const FIRST_SLOT = -1
export const LAST_SLOT = PILE_DEPTH + 1

/** How far up card `k` behind the front one sits, as a part of a card's height. */
export function riseOf(k: number): number {
	return k <= 0 ? 0 : RISE * (1 - STEP ** k)
}

function transform(rise: number, scale: number, turn: number): string {
	// One list of functions in every slot, so a move between two slots interpolates each in turn: the
	// rise and the narrowing in a line, the turn round the pivot as an arc.
	return (
		`translateY(${(-rise * 100).toFixed(3)}%) scale(${scale.toFixed(4)}) ` +
		`translate(${PIVOT_X}, ${PIVOT_Y}) rotate(${turn}deg) translate(-${PIVOT_X}, -${PIVOT_Y})`
	)
}

/** A card's place and look in `slot`, as inline style for `.lb-zstack__card`. */
export function slotStyle(slot: number): CSSProperties {
	const s = Math.max(FIRST_SLOT, Math.min(LAST_SLOT, slot))
	if (s < 0) {
		return {
			transform: transform(0, 1, FLIP_TURN),
			opacity: 0,
			zIndex: LAST_SLOT + 2,
			pointerEvents: 'none',
			'--zs-shade': 0,
			'--zs-id': 1,
		} as CSSProperties
	}
	const reach = RISE ? riseOf(s) / RISE : 0
	const strip = riseOf(s) - riseOf(s - 1)
	return {
		transform: transform(riseOf(s), 1 - NARROW * reach, 0),
		opacity: s > PILE_DEPTH ? 0 : 1,
		zIndex: LAST_SLOT + 1 - s,
		'--zs-shade': (SHADE * reach).toFixed(3),
		'--zs-id': s === 0 || strip >= ID_ROOM ? 1 : 0,
	} as CSSProperties
}

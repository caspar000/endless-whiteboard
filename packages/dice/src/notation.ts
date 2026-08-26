import { DIE_KINDS, MAX_DICE_IN_HAND, facesOf, isDieKind, type DieKind } from './kinds'

/**
 * Dice notation: the string the cursor shows while you are holding dice, and the argument an agent
 * sends to roll some.
 *
 * Formatting and parsing live together because they are one grammar, and a package where the two
 * drifted apart would round-trip its own output wrongly — which is exactly what the test asserts.
 */

/**
 * `2d6 + 1d12`.
 *
 * The count is written even when it is one. Standard notation drops it (`d20`), and dropping it here
 * would be worse in the one place this string is always read: beside a cursor, mid-gesture, telling
 * you what you are about to throw. `1d12` is a count you can check at a glance; `d12` is a thing you
 * have to know the convention to read.
 */
export function formatNotation(counts: ReadonlyMap<DieKind, number>, modifier = 0): string {
	const dice = DIE_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map(
		(kind) => `${counts.get(kind)}${kind}`
	)
	const written = dice.join(' + ')
	if (modifier === 0) return written
	// A modifier with no dice reads as the bare number it is; otherwise it trails the dice, signed.
	const signed = `${modifier < 0 ? '−' : '+'} ${Math.abs(modifier)}`
	return written ? `${written} ${signed}` : String(modifier)
}

export type ParseResult =
	| {
			ok: true
			counts: Map<DieKind, number>
			/** The flat bonus or penalty added to the total. `0` when there is none. */
			modifier: number
	  }
	/** A sentence for the caller to show or return — see the note on readable failures below. */
	| { ok: false; error: string }

/**
 * Reads `2d6+1d12`, `3d8`, `d20`, `2D6 + D4`.
 *
 * Also reads a flat **modifier**: `2d20 + 10`, `1d6 + 2d4 + 1d20 + 4`, `2d6 - 1`. Several of them add
 * up, so `d20 + 2 + 3` is `d20 + 5`.
 *
 * Tolerant about the things that carry no meaning — case, whitespace, a missing count, the order of
 * the terms, the same die named twice (`d6+d6` is `2d6`) — and strict about everything else.
 *
 * Every failure is a **sentence naming the alternatives** rather than a code, because the caller that
 * matters most here is an agent: this parser sits behind the `dice.roll` operation, and "there is no
 * d7" plus the list of dice that do exist is a correction it can act on, where a validation error is
 * a dead end (see `operations.ts` in node-kit on why operations refuse in prose).
 */
export function parseNotation(input: string): ParseResult {
	const trimmed = input.trim()
	if (!trimmed) return { ok: false, error: `Nothing to roll. Try “2d6 + 1d12”.` }

	/*
	 * Split into signed terms.
	 *
	 * Written as a scan rather than `split('+')` because of the modifier: `2d20 - 1` is a term and a
	 * *signed* term, and a bare `split` on one operator cannot see the other. The leading sign is
	 * optional so the first term needs no `+`.
	 */
	const terms = trimmed.match(/[+-]?[^+-]+/g)
	if (!terms) return { ok: false, error: `“${trimmed}” is not dice notation. Try “2d6 + 1d12”.` }

	/*
	 * Nothing may be silently dropped.
	 *
	 * The scan produces no term for a *dangling* operator — `2d6 +` yields just `2d6` — so without this
	 * check a half-typed expression would roll as though the tail had never been written. Comparing what
	 * was matched against what was given catches that, and any other gap, without a second grammar.
	 */
	const bare = (text: string) => text.replace(/\s+/g, '')
	if (bare(terms.join('')) !== bare(trimmed)) {
		return { ok: false, error: `“${trimmed}” has an operator with nothing after it.` }
	}

	const counts = new Map<DieKind, number>()
	let dice = 0
	let modifier = 0

	for (const raw of terms) {
		const term = raw.trim().toLowerCase()
		const sign = term.startsWith('-') ? -1 : 1
		const body = term.replace(/^[+-]\s*/, '').trim()
		if (!body) return { ok: false, error: `“${trimmed}” has an operator with nothing after it.` }

		/*
		 * A term is either dice or a flat number. The flat number is the modifier — the `+ 10` in
		 * `2d20 + 10` — and several of them simply add up, so `d20 + 2 + 3` is `d20 + 5`.
		 */
		const flat = /^\d+$/.exec(body)
		if (flat) {
			modifier += sign * Number(flat[0])
			continue
		}

		const match = /^(\d*)d(\d+)$/.exec(body)
		if (!match) {
			return {
				ok: false,
				error: `Could not read “${raw.trim()}”. A term looks like “2d6”, “d20”, or a number such as “+3”.`,
			}
		}
		if (sign < 0) {
			// `2d6 - 1d4` is a real notation elsewhere and is not one this can roll: the dice it throws are
			// physical objects, and there is no such thing as a negative die on the board.
			return { ok: false, error: `Dice cannot be subtracted. Take “${body}” off the total instead.` }
		}

		// An absent count means one; an explicit zero does not, because `0d6` is someone meaning
		// something this cannot express rather than someone meaning nothing.
		const count = match[1] === '' ? 1 : Number(match[1])
		if (count < 1) return { ok: false, error: `“${raw.trim()}” asks for no dice.` }

		const kind = `d${Number(match[2])}`
		if (!isDieKind(kind)) {
			return { ok: false, error: `There is no ${kind}. The dice are ${DIE_KINDS.join(', ')}.` }
		}

		dice += count
		if (dice > MAX_DICE_IN_HAND) {
			return {
				ok: false,
				error: `That is more than ${MAX_DICE_IN_HAND} dice, which is as many as one roll holds.`,
			}
		}
		counts.set(kind, (counts.get(kind) ?? 0) + count)
	}

	if (dice === 0) {
		return { ok: false, error: `“${trimmed}” has no dice in it — a roll needs at least one.` }
	}

	return { ok: true, counts: sortedByFaces(counts), modifier }
}

/**
 * The map, rebuilt in tray order.
 *
 * Insertion order is a `Map`'s iteration order, so a hand parsed from `d20 + d4` would otherwise roll
 * and read back to front. Ordering it here means no consumer has to remember to.
 */
function sortedByFaces(counts: Map<DieKind, number>): Map<DieKind, number> {
	return new Map([...counts].sort(([a], [b]) => facesOf(a) - facesOf(b)))
}

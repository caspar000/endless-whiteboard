import { describe, expect, it } from 'vitest'
import { DIE_KINDS, facesOf } from '../kinds'
import { rollCounts } from '../roll'
import { decodeDice, encodeDice } from './encode'

describe('encoding a roll onto a card', () => {
	it('round-trips every kind at every face', () => {
		// Props are JSON scalars, so the dice live in one string. Nothing else may depend on its shape —
		// this is the only test that knows the format, which is the point.
		for (const kind of DIE_KINDS) {
			for (let value = 1; value <= facesOf(kind); value++) {
				expect(decodeDice(encodeDice([{ kind, value }]))).toEqual([{ kind, value }])
			}
		}
	})

	it('keeps the order the dice were rolled in', () => {
		// The card has to agree with the readout it replaced, which lists them in roll order.
		const dice = rollCounts(new Map([['d4', 1], ['d6', 2], ['d20', 1]])).dice
		expect(decodeDice(encodeDice(dice))).toEqual([...dice])
	})

	it('is empty for an empty roll rather than producing a stray entry', () => {
		expect(encodeDice([])).toBe('')
		expect(decodeDice('')).toEqual([])
	})

	it('skips what it cannot read instead of refusing the whole card', () => {
		// This parses *stored* text, which may come from an older build or a hand-edited backup. A card
		// that renders the dice it understands beats one that renders nothing.
		expect(decodeDice('d20:14,nonsense,d6:3')).toEqual([
			{ kind: 'd20', value: 14 },
			{ kind: 'd6', value: 3 },
		])
		expect(decodeDice('d7:4')).toEqual([])
		expect(decodeDice('d20:0')).toEqual([])
		expect(decodeDice('d20:abc')).toEqual([])
		expect(decodeDice('d20')).toEqual([])
	})

	it('tolerates the whitespace a hand-edit would leave', () => {
		expect(decodeDice(' d20:14 , d6:3 ')).toEqual([
			{ kind: 'd20', value: 14 },
			{ kind: 'd6', value: 3 },
		])
	})
})

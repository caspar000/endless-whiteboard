import { describe, expect, it } from 'vitest'
import { DIE_KINDS, facesOf } from '../kinds'
import {
	PERCENTILE_TENS,
	PERCENTILE_UNITS,
	bodyCount,
	bodySolids,
	bodySolidsForRoll,
	physicalDiceFor,
} from './physical'

describe('physicalDiceFor', () => {
	it('is one die showing its value, for every ordinary kind', () => {
		for (const kind of DIE_KINDS) {
			if (kind === 'd100') continue
			for (let value = 1; value <= facesOf(kind); value++) {
				const [die, ...rest] = physicalDiceFor({ kind, value }, [0])
				expect(rest, kind).toHaveLength(0)
				expect(die!.solid).toBe(kind)
				// The face the simulation settled on is the one carrying the result.
				expect(die!.labels[die!.wantedFace], `${kind} ${value}`).toBe(String(value))
				expect(die!.labels).toHaveLength(facesOf(kind))
			}
		}
	})

	it('throws a percentile die as two ten-siders, in tens and units', () => {
		const [tens, units] = physicalDiceFor({ kind: 'd100', value: 37 }, [0, 0])
		expect(tens!.solid).toBe('d10')
		expect(units!.solid).toBe('d10')
		expect(tens!.labels[tens!.wantedFace]).toBe('30')
		expect(units!.labels[units!.wantedFace]).toBe('7')
	})

	it('reads a hundred as "00" and "0", the way a real pair does', () => {
		// The convention that makes the tens die's high roll its low face. Getting this wrong turns a
		// perfect roll into a 0.
		const [tens, units] = physicalDiceFor({ kind: 'd100', value: 100 }, [4, 6])
		expect(tens!.labels[tens!.wantedFace]).toBe('00')
		expect(units!.labels[units!.wantedFace]).toBe('0')
	})

	it('covers all hundred results with the two dice it has', () => {
		for (let value = 1; value <= 100; value++) {
			const [tens, units] = physicalDiceFor({ kind: 'd100', value }, [3, 8])
			const shown = tens!.labels[tens!.wantedFace]!
			const unit = units!.labels[units!.wantedFace]!
			// Reading the pair back has to give the number that was rolled.
			const read = (shown === '00' ? 0 : Number(shown)) + Number(unit)
			expect(read === 0 ? 100 : read, `value ${value}`).toBe(value)
			expect(PERCENTILE_TENS).toContain(shown)
			expect(PERCENTILE_UNITS).toContain(unit)
		}
	})

	it('respects the face each body actually settled on', () => {
		const [tens, units] = physicalDiceFor({ kind: 'd100', value: 42 }, [2, 9])
		expect(tens!.wantedFace).toBe(2)
		expect(units!.wantedFace).toBe(9)
		expect(tens!.labels[2]).toBe('40')
		expect(units!.labels[9]).toBe('2')
	})
})

describe('how many bodies a roll needs', () => {
	it('is one per die, except the percentile pair', () => {
		for (const kind of DIE_KINDS) expect(bodyCount(kind), kind).toBe(kind === 'd100' ? 2 : 1)
		expect(bodySolids('d100')).toEqual(['d10', 'd10'])
		expect(bodySolids('d20')).toEqual(['d20'])
	})

	it('flattens a whole roll into the solids to build', () => {
		const solids = bodySolidsForRoll([
			{ kind: 'd6', value: 3 },
			{ kind: 'd100', value: 55 },
			{ kind: 'd20', value: 20 },
		])
		expect(solids).toEqual(['d6', 'd10', 'd10', 'd20'])
	})
})

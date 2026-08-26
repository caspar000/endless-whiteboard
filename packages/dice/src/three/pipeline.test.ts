import { describe, expect, it } from 'vitest'
import { DIE_KINDS, facesOf, type DieKind } from '../kinds'
import { rollCounts } from '../roll'
import { upFace } from './faces'
import { bodyCount, bodySolidsForRoll, physicalDiceFor } from './physical'
import { simulateThrow } from './simulate'

/**
 * End to end, without a renderer: does the number on the face that ends up on top equal the number
 * that was rolled?
 *
 * Every stage of this is already tested in isolation and the *seam between them* is where a mismatch
 * would live — which is exactly the bug this file was written for: a 3d20 that reported 20, 18, 7 and
 * showed 20, 9, 2.
 */

function seeded(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * What the top of each die would read, by walking exactly the path `stage.ts` walks: simulate, hand each
 * rolled die the faces its bodies settled on, relabel, then look at the face pointing up.
 */
function whatTheDiceShow(dice: readonly { kind: DieKind; value: number }[], seed: number): string[] {
	const solids = bodySolidsForRoll(dice)
	const thrown = simulateThrow(solids, seeded(seed))
	const last = thrown.frames.at(-1)!

	const shown: string[] = []
	let body = 0
	for (const die of dice) {
		const bodies = bodyCount(die.kind)
		const settled = thrown.settled.slice(body, body + bodies)
		for (const physical of physicalDiceFor(die, settled)) {
			const [x, y, z, w] = last[body]!.orientation
			// The face the *renderer* will present to the camera, read from the pose it will be drawn in.
			const up = upFace(physical.solid, { x, y, z, w })
			shown.push(physical.labels[up.index]!)
			body += 1
		}
	}
	return shown
}

describe('the number on top is the number that was rolled', () => {
	it('holds for a single die of every kind', () => {
		for (const kind of DIE_KINDS) {
			for (let seed = 1; seed <= 8; seed++) {
				const roll = rollCounts(new Map([[kind, 1]]), 0, seeded(seed * 31))
				const die = roll.dice[0]!
				const shown = whatTheDiceShow([die], seed)
				if (kind === 'd100') {
					// Two dice, read as tens and units — `00` and `0` being the hundred.
					const read = (shown[0] === '00' ? 0 : Number(shown[0])) + Number(shown[1])
					expect(read === 0 ? 100 : read, `${kind} seed ${seed}`).toBe(die.value)
				} else {
					expect(shown[0], `${kind} seed ${seed} (rolled ${die.value})`).toBe(String(die.value))
				}
			}
		}
	})

	it('holds for several dice thrown together', () => {
		// The case the mismatch was reported for. Throwing a hand is where a per-body indexing slip shows.
		for (let seed = 1; seed <= 10; seed++) {
			const roll = rollCounts(new Map([['d20', 3]]), 0, seeded(seed * 17))
			const shown = whatTheDiceShow(roll.dice, seed)
			expect(shown, `seed ${seed}`).toEqual(roll.dice.map((d) => String(d.value)))
		}
	})

	it('holds for a mixed hand, including the percentile pair', () => {
		for (let seed = 1; seed <= 6; seed++) {
			const roll = rollCounts(
				new Map([
					['d4', 1],
					['d6', 2],
					['d20', 1],
				]),
				0,
				seeded(seed * 13)
			)
			const shown = whatTheDiceShow(roll.dice, seed)
			expect(shown, `seed ${seed}`).toEqual(roll.dice.map((d) => String(d.value)))
		}
	})

	it('never shows a value the die does not have', () => {
		for (const kind of DIE_KINDS) {
			const roll = rollCounts(new Map([[kind, 2]]), 0, seeded(5))
			for (const shown of whatTheDiceShow(roll.dice, 3)) {
				const value = shown === '00' ? 0 : Number(shown)
				expect(Number.isFinite(value), `${kind} showed "${shown}"`).toBe(true)
				expect(value, `${kind} showed "${shown}"`).toBeLessThanOrEqual(facesOf(kind))
			}
		}
	})
})

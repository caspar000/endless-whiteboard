import { describe, expect, it } from 'vitest'
import { DIE_KINDS, MAX_DICE_IN_HAND, type DieKind } from '../kinds'
import { isCocked, upFace } from './faces'
import { THROW_SCALE, THROW_STEP, arenaFor, simulateThrow } from './simulate'

/**
 * The simulation, held to the four things a viewer would notice.
 *
 * Runs the real physics engine — this is not a unit test of arithmetic, it is the check that the tuned
 * constants in `simulate.ts` actually produce a roll worth watching. Which makes it the place the
 * tuning is *pinned*: change the gravity or the damping and the "watchable window" test says whether
 * the result is still a roll or has become a drop.
 */

/** A repeatable throw, so a failure can be reproduced. mulberry32. */
function seeded(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const SOLIDS: DieKind[] = DIE_KINDS.filter((k) => k !== 'd100')

/** `MAX_TICKS` in `simulate.ts`. Mirrored rather than exported: a test asserting it settled *before* the
 * cap should say the number out loud, or it is only asserting that the loop terminated. */
const MAX_TICKS_FOR_TEST = 240

describe('simulateThrow', () => {
	it('settles every kind of die, cleanly', () => {
		for (const kind of SOLIDS) {
			const result = simulateThrow([kind], seeded(1))
			expect(result.frames.length, kind).toBeGreaterThan(0)
			expect(result.settled, kind).toHaveLength(1)
			expect(result.settled[0], kind).toBeGreaterThanOrEqual(0)
		}
	})

	it('lands with a face properly up, not on an edge', () => {
		for (const kind of SOLIDS) {
			for (let seed = 1; seed <= 12; seed++) {
				const result = simulateThrow([kind], seeded(seed))
				const last = result.frames.at(-1)![0]!
				const [x, y, z, w] = last.orientation
				const face = upFace(kind, { x, y, z, w })
				expect(isCocked(face), `${kind} seed ${seed} (rejected ${result.rejected})`).toBe(false)
				// And the face it reports is the one actually up.
				expect(result.settled[0], `${kind} seed ${seed}`).toBe(face.index)
			}
		}
	})

	it('settles within a window worth watching', () => {
		// The tuning constraint. Too short and the dice are dropped rather than rolled; too long and
		// nobody waits for the number. Both ends have been wrong during development.
		for (let seed = 1; seed <= 10; seed++) {
			const result = simulateThrow(['d20', 'd6', 'd6'], seeded(seed))
			expect(result.duration, `seed ${seed}`).toBeGreaterThan(0.5)
			expect(result.duration, `seed ${seed}`).toBeLessThan(3.5)
		}
	})

	it('leaves every die resting on the paper, inside the arena', () => {
		const hand: DieKind[] = ['d20', 'd12', 'd10', 'd8', 'd6', 'd4']
		const arena = arenaFor(hand)
		const result = simulateThrow(hand, seeded(7))
		for (const [index, body] of result.frames.at(-1)!.entries()) {
			const [x, y, z] = body.position
			// Above the paper and not through it. The ceiling allows a die to come to rest *on another
			// die*, which happens on a crowded throw and is not a fault — what would be a fault is a die
			// still up near the drop height, i.e. one that never fell.
			expect(z, `body ${index} height`).toBeGreaterThan(0)
			expect(z, `body ${index} height`).toBeLessThan(THROW_SCALE.radius * 4)
			// And inside the walls, so nothing has tunnelled out of shot.
			expect(Math.abs(x), `body ${index} x`).toBeLessThan(arena)
			expect(Math.abs(y), `body ${index} y`).toBeLessThan(arena)
		}
	})

	it('records one frame per body per tick, at a fixed step', () => {
		const result = simulateThrow(['d6', 'd20'], seeded(3))
		for (const frame of result.frames) expect(frame).toHaveLength(2)
		expect(result.duration).toBeCloseTo(result.frames.length * THROW_STEP, 10)
	})

	it('handles a full hand', () => {
		/*
		 * The cap exists partly for this: the simulation is the one synchronous cost of a roll, and it
		 * happens on the click.
		 *
		 * A hand of forty is far past any real roll — a fireball is 8d6 — and it does cost a
		 * noticeable beat: measured at a bit over two seconds on a loaded machine, up from under one
		 * before the dice were sized to match each other, because bigger dice make more contacts. Worth
		 * knowing rather than worth fixing at this cap; if it ever needs to be cheaper, the simulation is
		 * already a pure function of its inputs and could move to a worker without anything else changing.
		 *
		 * Asserted as *work* rather than wall-clock for the reason the previous test gives: a millisecond
		 * budget in a parallel test run is a coin flip, and this one duly flaked.
		 */
		const hand = Array.from({ length: MAX_DICE_IN_HAND }, (): DieKind => 'd6')
		// It needs a bigger floor than a handful does, and gets one — see `arenaFor`.
		expect(arenaFor(hand)).toBeGreaterThan(arenaFor(['d6']))
		const result = simulateThrow(hand, seeded(5))
		expect(result.settled).toHaveLength(MAX_DICE_IN_HAND)
		// It settles rather than running to the tick cap, which is the thing that was actually broken.
		expect(result.frames.length, `${result.frames.length} ticks`).toBeLessThan(MAX_TICKS_FOR_TEST)

		/*
		 * Retries are *not* asserted here, unlike for a plausible hand.
		 *
		 * Forty dice land in a pile, and a pile genuinely contains a die resting against a neighbour at an
		 * angle — no number of re-throws changes that, and this exhausts all eight. That is what the
		 * "accept whatever came up" fallback is for, and it costs nothing that matters: the *numbers* were
		 * drawn before any of this ran, so a slightly leaning die still shows the right value.
		 */
		expect(result.settled.every((face) => face >= 0)).toBe(true)
	})

	it('is repeatable for a given source of randomness', () => {
		// What makes a failure here reproducible, and what would let a roll be replayed later.
		const a = simulateThrow(['d20', 'd6'], seeded(42))
		const b = simulateThrow(['d20', 'd6'], seeded(42))
		expect(b.settled).toEqual(a.settled)
		expect(b.frames.length).toBe(a.frames.length)
		expect(b.frames.at(-1)).toEqual(a.frames.at(-1))
	})

	it('is empty for an empty hand rather than throwing', () => {
		const result = simulateThrow([], seeded(1))
		expect(result.frames).toEqual([])
		expect(result.settled).toEqual([])
		expect(result.duration).toBe(0)
	})
})

describe('a hand of dice settles as cleanly as a single one', () => {
	it('does not need retry after retry to find a flat landing', () => {
		/*
		 * The regression test for the shared-hull bug (see `hullFor`).
		 *
		 * With one `ConvexPolyhedron` shared between bodies, cannon-es tested each die against world-space
		 * geometry cached for a different one. Dice interpenetrated, settled in poses that were not resting
		 * on anything, and almost every throw was rejected as cocked — so a hand of four burned all eight
		 * attempts, blocked the main thread for seconds, and finally accepted a tilted result whose upward
		 * face was not the one a person would read off it.
		 *
		 * Rejections are therefore the signal, not the timing: a throw that lands cleanly first or second
		 * time is a throw whose physics is actually working.
		 */
		for (let seed = 1; seed <= 6; seed++) {
			const hand: DieKind[] = ['d20', 'd20', 'd20', 'd20']
			const result = simulateThrow(hand, seeded(seed))
			expect(result.rejected, `seed ${seed} needed ${result.rejected} retries`).toBeLessThan(3)
		}
	})

	it('stays cheap enough to run on the click', () => {
		/*
		 * The simulation is synchronous — it happens on the pointer-down — so "slow" here is a freeze.
		 *
		 * Measured as **work** rather than wall-clock, because a millisecond budget inside a parallel
		 * multi-package test run is a coin flip: this asserted `< 900ms` and duly flaked once on a loaded
		 * machine while passing every time in isolation. Ticks and retries are deterministic for a given
		 * seed, and they are what actually decides the cost. The time ceiling is kept, an order of
		 * magnitude looser, so a genuine blow-up still trips something.
		 */
		const hand: DieKind[] = Array.from({ length: 8 }, () => 'd20')
		const started = performance.now()
		const result = simulateThrow(hand, seeded(3))
		const elapsed = performance.now() - started

		expect(result.settled).toHaveLength(8)
		// One clean throw, or nearly — the cost is retries, and retries mean the physics is misbehaving.
		expect(result.rejected, `${result.rejected} retries`).toBeLessThan(3)
		// And it settled rather than running to the tick cap, which is the other way this gets expensive.
		expect(result.frames.length, `${result.frames.length} ticks`).toBeLessThan(200)
		expect(elapsed, `${Math.round(elapsed)}ms for 8d20`).toBeLessThan(8000)
	})

	it('lands every die of a mixed hand flat', () => {
		const hand: DieKind[] = ['d20', 'd12', 'd10', 'd8', 'd6', 'd20', 'd20']
		const result = simulateThrow(hand, seeded(11))
		const last = result.frames.at(-1)!
		last.forEach((body, index) => {
			const [x, y, z, w] = body.orientation
			expect(isCocked(upFace(hand[index]!, { x, y, z, w })), `${hand[index]} #${index}`).toBe(false)
		})
	})
})

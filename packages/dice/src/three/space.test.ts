import { describe, expect, it } from 'vitest'
import { flipY, toPage, toWorld } from './space'

/**
 * The coordinate convention, pinned.
 *
 * Worth its own test file for its size because it is the thing that broke twice: once as dice rendering
 * mirrored (a die seen from under the board), and once as the readout card landing in the wrong place.
 * Both were one sign.
 */
describe('page and world', () => {
	it('round-trips a page point through the world', () => {
		const origin = { x: 120, y: -80 }
		expect(toPage(origin, [0, 0, 0])).toEqual(origin)
		// Compared numerically: flipping zero twice gives `-0`, which `toEqual` distinguishes from `0`
		// and nothing else in the world does.
		const zero = toPage({ x: 0, y: 0 }, [0, 0, 0])
		expect(zero.x).toBeCloseTo(0, 12)
		expect(zero.y).toBeCloseTo(0, 12)
	})

	it('puts a die further along world y further *up* the page', () => {
		// The whole point of the flip: down the screen is +y on the page and −y in the world. A die that
		// the simulation moved in +y has to end up above the throw, not below it.
		const origin = { x: 0, y: 500 }
		const up = toPage(origin, [0, 60, 0])
		const down = toPage(origin, [0, -60, 0])
		expect(up.y).toBeLessThan(origin.y)
		expect(down.y).toBeGreaterThan(origin.y)
	})

	it('leaves x and height alone', () => {
		const world = toWorld({ x: 10, y: 20 }, [3, 4, 5])
		expect(world[0]).toBe(13)
		expect(world[2]).toBe(5)
	})

	it('flips y exactly once between page and world', () => {
		const origin = { x: 0, y: 250 }
		expect(toWorld(origin, [0, 0, 0])[1]).toBe(-250)
		// And back again — a double flip would put the dice on the wrong half of the board.
		expect(toPage(origin, [0, 0, 0]).y).toBe(250)
		expect(flipY(flipY(7))).toBe(7)
	})
})

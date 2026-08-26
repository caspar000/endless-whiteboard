import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHand, getHand, loadDie } from './hand'
import { clearRolls, getActiveRoll, subscribeToRolls, throwCounts, throwHand } from './rolls'

beforeEach(() => {
	clearHand()
	clearRolls()
})

const AT = { x: 100, y: 200 }

describe('throwing', () => {
	it('rolls what is held, and empties the hand', () => {
		loadDie('d6')
		loadDie('d6')
		const roll = throwHand(AT)
		expect(roll).not.toBeNull()
		expect(roll!.result.dice).toHaveLength(2)
		expect(roll!.result.notation).toBe('2d6')
		expect(roll!.point).toEqual(AT)
		// The hand is spent by the throw: releasing dice puts them on the board, it does not copy them.
		expect(getHand().total).toBe(0)
	})

	it('does nothing with an empty hand', () => {
		expect(throwHand(AT)).toBeNull()
		expect(getActiveRoll()).toBeNull()
	})

	it('publishes the roll for the overlay to read', () => {
		const listener = vi.fn()
		subscribeToRolls(listener)
		throwCounts(AT, new Map([['d20', 1]]))
		expect(listener).toHaveBeenCalledTimes(1)
		expect(getActiveRoll()?.result.notation).toBe('1d20')
	})

	it('gives every throw a new seq, even an identical one', () => {
		const first = throwCounts(AT, new Map([['d20', 1]]))
		const second = throwCounts(AT, new Map([['d20', 1]]))
		// Rolling the same dice to the same numbers twice is still two rolls, and the readout has to
		// restart rather than sit there looking unchanged.
		expect(second.seq).toBeGreaterThan(first.seq)
	})

	it('clears, and only notifies when there was something to clear', () => {
		throwCounts(AT, new Map([['d4', 1]]))
		const listener = vi.fn()
		subscribeToRolls(listener)
		clearRolls()
		expect(getActiveRoll()).toBeNull()
		expect(listener).toHaveBeenCalledTimes(1)
		clearRolls()
		expect(listener).toHaveBeenCalledTimes(1)
	})
})

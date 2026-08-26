import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHand, getHand, loadDie, subscribeToHand, takeHand, unloadDie } from './hand'
import { MAX_DICE_IN_HAND } from './kinds'

beforeEach(() => clearHand())

describe('the hand', () => {
	it('starts empty', () => {
		expect(getHand().total).toBe(0)
		expect(getHand().notation).toBe('')
	})

	it('loads the same die repeatedly', () => {
		loadDie('d6')
		loadDie('d6')
		loadDie('d12')
		expect(getHand().total).toBe(3)
		expect(getHand().notation).toBe('2d6 + 1d12')
	})

	it('unloads one at a time and drops the kind at zero', () => {
		loadDie('d6')
		loadDie('d6')
		unloadDie('d6')
		expect(getHand().counts.get('d6')).toBe(1)
		unloadDie('d6')
		// Removed rather than left at 0, so no consumer has to filter zeroes out.
		expect(getHand().counts.has('d6')).toBe(false)
		expect(getHand().total).toBe(0)
	})

	it('ignores unloading something it is not holding', () => {
		const listener = vi.fn()
		subscribeToHand(listener)
		unloadDie('d20')
		expect(listener).not.toHaveBeenCalled()
	})

	it('stops loading at the cap', () => {
		for (let i = 0; i < MAX_DICE_IN_HAND + 5; i++) loadDie('d6')
		expect(getHand().total).toBe(MAX_DICE_IN_HAND)
	})

	it('returns the identical snapshot between changes', () => {
		// The contract useSyncExternalStore depends on: a fresh object per call would re-render forever.
		const before = getHand()
		expect(getHand()).toBe(before)
		loadDie('d4')
		expect(getHand()).not.toBe(before)
	})

	it('notifies on a change and not on a no-op clear', () => {
		const listener = vi.fn()
		const stop = subscribeToHand(listener)
		loadDie('d8')
		expect(listener).toHaveBeenCalledTimes(1)
		clearHand()
		expect(listener).toHaveBeenCalledTimes(2)
		clearHand()
		expect(listener).toHaveBeenCalledTimes(2)
		stop()
		loadDie('d8')
		expect(listener).toHaveBeenCalledTimes(2)
	})

	it('takeHand empties it and hands back what was there', () => {
		loadDie('d6')
		loadDie('d20')
		const taken = takeHand()
		expect(taken.notation).toBe('1d6 + 1d20')
		expect(taken.total).toBe(2)
		expect(getHand().total).toBe(0)
	})
})

import { describe, expect, it } from 'vitest'
import { CROWDED_PERCENT, describeContext, formatPercent, formatTokens, snapshot } from './context'

/**
 * The ring's arithmetic.
 *
 * A meter that reads 40% when the truth is 90% is worse than no meter, so the fractions are pinned
 * rather than eyeballed — particularly the two states that are not a simple division: an unknown
 * window size, and a turn that overshot the one it had.
 */

describe('the snapshot', () => {
	it('divides used by max', () => {
		expect(snapshot({ used: 50_000, max: 200_000 }).percent).toBe(25)
	})

	it('has no percentage without a window size', () => {
		// `null`, not zero: a ring at 0% claims an empty context, and the honest answer is "unknown".
		const snap = snapshot({ used: 50_000, max: null })
		expect(snap.percent).toBeNull()
		expect(snap.crowded).toBe(false)
	})

	it('treats a zero or negative window as unknown', () => {
		expect(snapshot({ used: 10, max: 0 }).percent).toBeNull()
		expect(snapshot({ used: 10, max: -5 }).percent).toBeNull()
	})

	it('clamps an overshoot to full rather than showing over 100%', () => {
		// Compaction lands *after* the turn that overflowed, so a moment of >100% is real and should
		// read as "full" rather than as an impossible number.
		expect(snapshot({ used: 260_000, max: 200_000 }).percent).toBe(100)
	})

	it('never reports negative use', () => {
		expect(snapshot({ used: -1, max: 200_000 }).used).toBe(0)
	})

	it('turns crowded only past the threshold', () => {
		// Strictly past: exactly at the threshold is still the informational state.
		expect(snapshot({ used: 180_000, max: 200_000 }).crowded).toBe(false)
		expect(snapshot({ used: 182_000, max: 200_000 }).crowded).toBe(true)
		// Pinned against the constant so moving one moves both.
		expect(snapshot({ used: CROWDED_PERCENT, max: 100 }).crowded).toBe(false)
		expect(snapshot({ used: CROWDED_PERCENT + 1, max: 100 }).crowded).toBe(true)
	})
})

describe('formatting', () => {
	it('reads token counts the way a person would', () => {
		expect(formatTokens(0)).toBe('0')
		expect(formatTokens(945)).toBe('945')
		// One decimal below 10k, where the difference between 1.2k and 1k still means something.
		expect(formatTokens(1_240)).toBe('1.2k')
		expect(formatTokens(2_000)).toBe('2k')
		expect(formatTokens(48_500)).toBe('49k')
		expect(formatTokens(1_250_000)).toBe('1.3m')
		expect(formatTokens(null)).toBe('0')
	})

	it('keeps a decimal only where a whole number would round to nothing', () => {
		expect(formatPercent(0.4)).toBe('0.4%')
		expect(formatPercent(4)).toBe('4%')
		expect(formatPercent(42.6)).toBe('43%')
		expect(formatPercent(null)).toBeNull()
	})

	it('describes both the known and the unknown case', () => {
		expect(describeContext(snapshot({ used: 50_000, max: 200_000 }))).toBe(
			'Context: 25% used — 50k of 200k tokens'
		)
		expect(describeContext(snapshot({ used: 50_000, max: null }))).toBe(
			'Context: 50k tokens used'
		)
	})
})

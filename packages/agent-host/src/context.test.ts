import { describe, expect, it } from 'vitest'
import { contextUsageFrom } from './session.js'

/**
 * Reading the context window off a turn's result.
 *
 * The hazard this pins is a field mix-up rather than arithmetic: `usage` is per-turn and `modelUsage`
 * is cumulative, so taking tokens from the wrong one produces a ring that climbs forever and never
 * comes back down after a compaction.
 */

const usage = {
	input_tokens: 1_000,
	cache_read_input_tokens: 40_000,
	cache_creation_input_tokens: 2_000,
	output_tokens: 500,
}

describe('context usage from a result', () => {
	it('counts everything that occupies the window, cache included', () => {
		// A cached prefix is still in front of the model, so leaving cache reads out would under-report
		// the window by most of its contents on any conversation past the first turn.
		const read = contextUsageFrom(usage, { 'claude-sonnet-5': { contextWindow: 200_000 } }, 'claude-sonnet-5')
		expect(read).toEqual({ used: 43_500, max: 200_000 })
	})

	it('takes the window of the model that answered, not the largest on offer', () => {
		// `modelUsage` also carries subagents and internal calls (compaction, titles). Taking the
		// largest would report a 1M window for a conversation running on a 200k model.
		const read = contextUsageFrom(
			usage,
			{ 'claude-haiku-4-5': { contextWindow: 200_000 }, 'claude-opus-5': { contextWindow: 1_000_000 } },
			'claude-haiku-4-5'
		)
		expect(read?.max).toBe(200_000)
	})

	it('matches a key the SDK suffixed', () => {
		// The SDK keys by the id it actually called, which may carry a variant suffix.
		const read = contextUsageFrom(usage, { 'claude-opus-5[1m]': { contextWindow: 1_000_000 } }, 'claude-opus-5')
		expect(read?.max).toBe(1_000_000)
	})

	it('reports an unknown window rather than guessing one', () => {
		// The panel shows a token count and an empty ring for this, which is honest. A default of 200k
		// would be a number nobody measured.
		expect(contextUsageFrom(usage, {}, 'claude-sonnet-5')?.max).toBeNull()
		expect(contextUsageFrom(usage, undefined, undefined)?.max).toBeNull()
		expect(contextUsageFrom(usage, { 'claude-sonnet-5': {} }, 'claude-sonnet-5')?.max).toBeNull()
	})

	it('treats missing token fields as zero, not as NaN', () => {
		// A `NaN` would reach the panel and render the ring as `NaN%`.
		expect(contextUsageFrom({}, undefined, undefined)).toEqual({ used: 0, max: null })
	})

	it('has nothing to say when the result carried no usage at all', () => {
		expect(contextUsageFrom(undefined, undefined, undefined)).toBeNull()
	})
})

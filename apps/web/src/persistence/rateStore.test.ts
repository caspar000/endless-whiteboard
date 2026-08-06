import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformAdapter, RawExchangeRates } from '../platform/PlatformAdapter'
import { getRates, resetRateRequests, setAutoFetchEnabled } from './rateStore'

const DAY = 86_400_000
const NOW = 1_754_000_000_000

function payload(over: Partial<RawExchangeRates> = {}): RawExchangeRates {
	return {
		base: 'USD',
		rates: { GEL: 2.62, EUR: 0.87 },
		asOf: NOW,
		nextUpdate: NOW + DAY,
		...over,
	}
}

/** Just enough adapter: a KV map and a fetch we can count and fail on demand. */
function harness(fetchImpl: () => Promise<RawExchangeRates | null>) {
	const store = new Map<string, unknown>()
	const fetchExchangeRates = vi.fn(fetchImpl)
	const platform = {
		kv: {
			async get<T>(key: string) {
				return store.get(key) as T | undefined
			},
			async set<T>(key: string, value: T) {
				store.set(key, value)
			},
			async delete(key: string) {
				store.delete(key)
			},
			async keys() {
				return [...store.keys()]
			},
		},
		fetchExchangeRates,
	} as unknown as PlatformAdapter
	return { platform, fetchExchangeRates, store }
}

/**
 * These run in node, where there is no `localStorage` — and the flag deliberately lives there rather
 * than in the KV store because it is read on a path that must not await. A two-method stub is cheaper
 * than a DOM environment for one boolean.
 */
const storage = new Map<string, string>()
beforeEach(() => {
	resetRateRequests()
	storage.clear()
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => void storage.set(k, v),
		removeItem: (k: string) => void storage.delete(k),
		clear: () => storage.clear(),
	})
})

describe('getRates', () => {
	it('fetches and caches when there is nothing stored', async () => {
		const { platform, fetchExchangeRates, store } = harness(async () => payload())

		const table = await getRates(platform, 'USD', NOW)
		expect(table?.rates.GEL).toBe(2.62)
		expect(table?.stale).toBe(false)
		expect(fetchExchangeRates).toHaveBeenCalledTimes(1)
		expect(store.has('rates:USD')).toBe(true)
	})

	it('serves the cache without a request until the provider says it changed', async () => {
		const { platform, fetchExchangeRates } = harness(async () => payload())
		await getRates(platform, 'USD', NOW)

		// A minute before the provider's own next-update time.
		await getRates(platform, 'USD', NOW + DAY - 60_000)
		expect(fetchExchangeRates).toHaveBeenCalledTimes(1)

		// A minute after, and only then.
		await getRates(platform, 'USD', NOW + DAY + 60_000)
		expect(fetchExchangeRates).toHaveBeenCalledTimes(2)
	})

	/**
	 * The behaviour this module exists for: a total must not fail because the network is down. An old
	 * table beats no table, and `stale` is what lets the UI admit it rather than imply it is current.
	 */
	it('keeps using an expired table when the fetch fails', async () => {
		let online = true
		const { platform } = harness(async () => (online ? payload() : null))

		await getRates(platform, 'USD', NOW)
		online = false

		const table = await getRates(platform, 'USD', NOW + 5 * DAY)
		expect(table?.rates.GEL).toBe(2.62)
		expect(table?.stale).toBe(true)
		expect(table?.asOf).toBe(NOW)
	})

	it('is null when there is nothing cached and nothing reachable', async () => {
		const { platform } = harness(async () => null)
		expect(await getRates(platform, 'USD', NOW)).toBeNull()
	})

	it('makes no request at all when auto-fetch is switched off', async () => {
		const { platform, fetchExchangeRates } = harness(async () => payload())
		setAutoFetchEnabled(false)

		expect(await getRates(platform, 'USD', NOW)).toBeNull()
		expect(fetchExchangeRates).not.toHaveBeenCalled()
	})

	it('still serves a cached table with auto-fetch off, so manual use keeps working', async () => {
		const { platform, fetchExchangeRates } = harness(async () => payload())
		await getRates(platform, 'USD', NOW)
		setAutoFetchEnabled(false)

		const table = await getRates(platform, 'USD', NOW + 5 * DAY)
		expect(table?.rates.GEL).toBe(2.62)
		expect(table?.stale).toBe(true)
		expect(fetchExchangeRates).toHaveBeenCalledTimes(1)
	})

	it('coalesces simultaneous callers into one request', async () => {
		// Several tables can ask in the same frame; each opening its own connection would be waste.
		const { platform, fetchExchangeRates } = harness(
			() => new Promise((resolve) => setTimeout(() => resolve(payload()), 10))
		)
		const [a, b, c] = await Promise.all([
			getRates(platform, 'USD', NOW),
			getRates(platform, 'USD', NOW),
			getRates(platform, 'USD', NOW),
		])
		expect(fetchExchangeRates).toHaveBeenCalledTimes(1)
		expect(a?.rates.GEL).toBe(2.62)
		expect(b?.rates.GEL).toBe(2.62)
		expect(c?.rates.GEL).toBe(2.62)
	})

	it('ignores a blank base rather than requesting nonsense', async () => {
		const { platform, fetchExchangeRates } = harness(async () => payload())
		expect(await getRates(platform, '   ', NOW)).toBeNull()
		expect(fetchExchangeRates).not.toHaveBeenCalled()
	})
})

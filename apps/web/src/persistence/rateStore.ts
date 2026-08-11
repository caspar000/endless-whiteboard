import type { RateTable } from '@lifeboard/node-kit'
import type { PlatformAdapter, RawExchangeRates } from '../platform/PlatformAdapter'

/**
 * Cached currency rates.
 *
 * Three things this exists to guarantee, in order of how badly they bite:
 *
 *  1. **Offline never fails a total.** The last good payload is kept indefinitely and used past its
 *     expiry, marked `stale`. A local-first app whose sums stop working on a plane is broken.
 *  2. **The cache expires when the provider says, not on a clock of ours.** `open.er-api.com` returns
 *     `time_next_update_unix`; honouring it means no stale-for-24-hours window and no pointless refetch.
 *  3. **No network call unless a board actually needs one.** A whiteboard with no money on it makes
 *     zero requests, which is what keeps "local-first" an honest claim rather than a slogan.
 */
const CACHE_PREFIX = 'rates:'
const ENABLED_KEY = 'lifeboard:autoFetchRates'

interface CachedRates extends RawExchangeRates {
	/** When we stored it. Only for diagnostics — expiry comes from the provider's own `nextUpdate`. */
	fetchedAt: number
}

/**
 * Whether we're allowed to reach the network at all.
 *
 * `localStorage` rather than the KV store because it is read synchronously on a path that must not
 * await anything, and it matches how the theme and canvas preferences are stored.
 */
export function isAutoFetchEnabled(): boolean {
	try {
		return localStorage.getItem(ENABLED_KEY) !== 'false'
	} catch {
		return true
	}
}

export function setAutoFetchEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(ENABLED_KEY, String(enabled))
	} catch {
		// Private-mode Safari can throw on write; the default (on) is the safe fallback.
	}
}

/**
 * One request per base in flight at a time.
 *
 * Several tables can ask for rates in the same frame, and without this each would open its own
 * connection to say the same thing.
 */
const inFlight = new Map<string, Promise<RateTable | null>>()

function toTable(cached: RawExchangeRates, now: number): RateTable {
	return {
		base: cached.base,
		rates: cached.rates,
		asOf: cached.asOf,
		stale: now >= cached.nextUpdate,
	}
}

/**
 * The rates to use for `base`, from cache when it's fresh and from the network when it isn't.
 *
 * Returns whatever it has rather than throwing: a stale table beats no table, and `stale` on the result
 * is what lets the UI say so instead of quietly implying the number is current.
 */
export async function getRates(
	platform: PlatformAdapter,
	base: string,
	now = Date.now()
): Promise<RateTable | null> {
	const code = base.trim().toUpperCase()
	if (!code) return null

	const key = `${CACHE_PREFIX}${code}`
	const cached = await platform.kv.get<CachedRates>(key)
	const usable = cached && typeof cached === 'object' && cached.rates ? cached : null

	if (usable && now < usable.nextUpdate) return toTable(usable, now)
	// Past its refresh time, or nothing cached at all — but if the network is off-limits, the old table
	// is still the best answer available.
	if (!isAutoFetchEnabled()) return usable ? toTable(usable, now) : null

	const existing = inFlight.get(code)
	if (existing) return existing

	const request = (async (): Promise<RateTable | null> => {
		const fresh = await platform.fetchExchangeRates(code)
		if (!fresh) {
			// The fetch failed. Keeping the expired table — and saying it is stale — is the whole point.
			return usable ? toTable(usable, now) : null
		}
		await platform.kv.set<CachedRates>(key, { ...fresh, fetchedAt: now })
		return toTable(fresh, now)
	})().finally(() => {
		inFlight.delete(code)
	})

	inFlight.set(code, request)
	return request
}

/** Test seam: forgets any in-flight request so one test cannot leak into the next. */
export function resetRateRequests(): void {
	inFlight.clear()
}

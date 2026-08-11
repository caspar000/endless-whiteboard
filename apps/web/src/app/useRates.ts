import { setCurrentRates } from '@lifeboard/node-kit'
import { useEffect } from 'react'
import { getRates, isAutoFetchEnabled } from '../persistence/rateStore'
import { usePlatform } from '../platform/PlatformContext'

/**
 * Keeps the rate table that aggregations read topped up.
 *
 * Deliberately fire-and-forget: nothing waits on it, and a board renders its totals unconverted until
 * rates land, at which point the atom updates and the affected tables recompute once. That is the whole
 * reason rates are an atom rather than something awaited inside the query.
 *
 * `DEFAULT_CURRENCY` is the base we ask for. The provider returns every currency relative to it, and
 * cross-rates fall out of two hops, so one request covers every pair a board could need.
 */
const BASE = 'GEL'

export function useRates(): void {
	const platform = usePlatform()
	useEffect(() => {
		if (!isAutoFetchEnabled()) return
		let cancelled = false
		void getRates(platform, BASE).then((table) => {
			if (!cancelled && table) setCurrentRates(table)
		})
		return () => {
			cancelled = true
		}
	}, [platform])
}

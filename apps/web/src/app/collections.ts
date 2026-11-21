import { backlogs } from '@lifeboard/backlog'
import { getStamped, replaceStamped, setStampedPersistence } from '@lifeboard/randomizer'
import { rankings } from '@lifeboard/ranking-tiers'
import { vaultCache, type VaultStore } from './vaultCache'

/**
 * What DARK-11's cards gather, kept as the feeds are (`vaultCache.ts`): every ranking, every backlog,
 * and the list of everything stamped on a randomizer. Each is the only copy there is, and each belongs
 * to the vault, so a randomizer on one board draws from a ranking made on another, on any device.
 */
const VAULT = vaultCache('collections', [
	{ key: 'rankings', cacheKey: 'lifeboard:rankings', get: rankings.get, replace: rankings.replace, listen: rankings.setPersistence },
	{ key: 'backlogs', cacheKey: 'lifeboard:backlogs', get: backlogs.get, replace: backlogs.replace, listen: backlogs.setPersistence },
	{ key: 'randomizerStamped', cacheKey: 'lifeboard:randomizerStamped', get: getStamped, replace: replaceStamped, listen: setStampedPersistence },
] as VaultStore[])

export const loadCollections = VAULT.load
/** On logging out, and when another vault answers than the one the cache is of. */
export const forgetCollections = VAULT.forget
export const applyRemoteCollections = VAULT.applyRemote

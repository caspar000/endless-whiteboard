import { getDisabledExtensionIds, setDisabledExtensionIds } from '@lifeboard/node-kit'
import { persistDisabledExtensions } from '../extensions'
import { getVaultSettings, pushVaultSetting } from '../server/serverVault'
import { replaceSavedQueries, savedQueries } from './savedQueries'

/**
 * Saved queries and switched-off extensions follow the vault, not the device: they are part of how you
 * work with your boards, so a new phone should not start from scratch.
 *
 * localStorage stays the cache, which is what lets the first render be right without waiting for the
 * network. Once the server answers, its copy wins. A setting it has never seen is seeded from this
 * device, so the first device to connect brings what it had.
 */
export async function syncVaultSettings(): Promise<void> {
	const remote = await getVaultSettings()

	if (remote.disabledExtensions === undefined) {
		pushVaultSetting('disabledExtensions', getDisabledExtensionIds())
	} else if (Array.isArray(remote.disabledExtensions)) {
		const next = remote.disabledExtensions.filter((id): id is string => typeof id === 'string')
		// This runs on every window focus; an unchanged set must not re-render every toolbar.
		if ([...next].sort().join() !== getDisabledExtensionIds().sort().join()) {
			setDisabledExtensionIds(next)
			persistDisabledExtensions({ push: false })
		}
	}

	if (remote.savedQueries === undefined) pushVaultSetting('savedQueries', savedQueries())
	else replaceSavedQueries(remote.savedQueries)
}

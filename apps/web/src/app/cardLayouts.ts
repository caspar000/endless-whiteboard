import { getLayoutLibrary, replaceLayoutLibrary, setLayoutLibraryPersistence } from '@lifeboard/node-kit'
import { pushVaultSetting } from '../server/serverVault'

/**
 * The saved card layouts, kept like saved queries (`savedQueries.ts`): localStorage as the cache that
 * makes the first render right, the server vault as the truth once it answers.
 */
const LAYOUTS_KEY = 'lifeboard:cardLayouts'

/** Loads the cached library and starts persisting changes. Called from the composition root. */
export function loadCardLayouts(): void {
	try {
		const raw = localStorage.getItem(LAYOUTS_KEY)
		if (raw) replaceLayoutLibrary(JSON.parse(raw))
	} catch {
		// A malformed cache, or no DOM (vitest imports the composition root): start empty.
	}
	setLayoutLibraryPersistence((list) => {
		cache(list)
		pushVaultSetting('cardLayouts', list)
	})
}

function cache(list: unknown): void {
	try {
		localStorage.setItem(LAYOUTS_KEY, JSON.stringify(list))
	} catch {
		// Private-mode Safari can throw on write; losing the cache across reloads is fine.
	}
}

/** The server vault's list wins; this device's is what seeds a vault that has none. */
export function applyRemoteCardLayouts(remote: unknown): void {
	if (remote === undefined) {
		pushVaultSetting('cardLayouts', getLayoutLibrary())
		return
	}
	replaceLayoutLibrary(remote)
	cache(getLayoutLibrary())
}

import {
	getHabitIndex,
	getSkillIndex,
	getTrackIndex,
	getTreeDefs,
	replaceHabitIndex,
	replaceSkillIndex,
	replaceTrackIndex,
	replaceTreeDefs,
	setHabitIndexPersistence,
	setSkillIndexPersistence,
	setTrackIndexPersistence,
	setTreeDefsPersistence,
} from '@lifeboard/skill-tree'
import { pushVaultSetting } from '../server/serverVault'

/**
 * The syllabus index (docs/skill-tree-plan.md, "The index"), kept like saved card layouts:
 * localStorage as the cache that makes the first render right, the server vault as the truth once it
 * answers.
 *
 * Throttled, unlike the layouts: the index changes with every keystroke in an evidence note, and each
 * write is the whole index. A second of delay costs nothing, since every open board keeps its own
 * part of the index current and rescans when it opens.
 */
const WAIT_MS = 1000

/**
 * The three indexes (items, habits, tracks) and the tree definitions, persisted the same way under
 * their own keys. The indexes are copies of boards; the trees are the only copy, so they are what
 * a server backup must not lose.
 */
const STORES = [
	{ key: 'skillIndex', cacheKey: 'lifeboard:skillIndex', get: getSkillIndex, replace: replaceSkillIndex, listen: setSkillIndexPersistence },
	{ key: 'skillHabits', cacheKey: 'lifeboard:skillHabits', get: getHabitIndex, replace: replaceHabitIndex, listen: setHabitIndexPersistence },
	{ key: 'skillTracks', cacheKey: 'lifeboard:skillTracks', get: getTrackIndex, replace: replaceTrackIndex, listen: setTrackIndexPersistence },
	{ key: 'skillTrees', cacheKey: 'lifeboard:skillTrees', get: getTreeDefs, replace: replaceTreeDefs, listen: setTreeDefsPersistence },
] as const

export function loadSkillIndex(): void {
	for (const store of STORES) {
		try {
			const raw = localStorage.getItem(store.cacheKey)
			if (raw) store.replace(JSON.parse(raw))
		} catch {
			// A malformed cache, or no DOM (vitest imports the composition root): start empty.
		}
		let timer: ReturnType<typeof setTimeout> | null = null
		store.listen(() => {
			if (timer) return
			timer = setTimeout(() => {
				timer = null
				const value = store.get()
				cache(store.cacheKey, value)
				pushVaultSetting(store.key, value)
			}, WAIT_MS)
		})
	}
}

function cache(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value))
	} catch {
		// Private-mode Safari can throw on write; the next board open rebuilds what it holds.
	}
}

/** The server vault's indexes win; this device's are what seed a vault that has none. */
export function applyRemoteSkillIndex(remote: { skillIndex?: unknown; skillHabits?: unknown; skillTracks?: unknown; skillTrees?: unknown }): void {
	for (const store of STORES) {
		const value = remote[store.key]
		if (value === undefined) {
			pushVaultSetting(store.key, store.get())
			continue
		}
		store.replace(value)
		cache(store.cacheKey, store.get())
	}
}

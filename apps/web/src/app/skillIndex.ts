import { getTreeDefs, replaceTreeDefs, setTreeDefsPersistence } from '@lifeboard/skill-tree'
import {
	getEvidence,
	getItems,
	getTracks,
	getTreePlans,
	replaceEvidence,
	replaceItems,
	replaceTracks,
	replaceTreePlans,
	setEvidencePersistence,
	setItemsPersistence,
	setTracksPersistence,
	setTreePlansPersistence,
} from '@lifeboard/syllabus'
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
 * The syllabus's vault data, persisted the same way under their own keys: the items and tracks, the
 * trees their files came with and the tree definitions are the only copy (a server backup must keep
 * them); the write-up copies are rebuilt by any board that opens.
 */
const STORES = [
	{ key: 'syllabusItems', cacheKey: 'lifeboard:syllabusItems', get: getItems, replace: replaceItems, listen: setItemsPersistence },
	{ key: 'syllabusTracks', cacheKey: 'lifeboard:syllabusTracks', get: getTracks, replace: replaceTracks, listen: setTracksPersistence },
	{ key: 'syllabusEvidence', cacheKey: 'lifeboard:syllabusEvidence', get: getEvidence, replace: replaceEvidence, listen: setEvidencePersistence },
	// The tree each syllabus file came with, kept unused until a tree is made from the syllabus.
	{ key: 'syllabusTreePlans', cacheKey: 'lifeboard:syllabusTreePlans', get: getTreePlans, replace: replaceTreePlans, listen: setTreePlansPersistence },
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
export function applyRemoteSkillIndex(remote: Partial<Record<(typeof STORES)[number]['key'], unknown>>): void {
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

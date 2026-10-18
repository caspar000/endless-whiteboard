import { atom } from '@lifeboard/canvas'

/**
 * How skill trees behave by default (docs/skill-tree-plan.md, "Rebuild"): what an import shows,
 * whether physics runs live, whether tree headers are drawn. A tree overrides live physics in its
 * header's editor; these are the defaults it falls back to.
 *
 * localStorage with a try/catch on both sides, as the dice prefs do it: private-mode Safari throws on
 * write, and losing a default across reloads is not worth a failure. Per device, like the canvas prefs.
 */
export interface TreePrefs {
	/** What an import's tree view opens on: skill nodes only, or everything. */
	importShows: 'overview' | 'all'
	/**
	 * Whether tree header cards are drawn. Off by default (docs/skill-tree-layout-plan.md, "Views"):
	 * the header is still the view, switched from ⌘K; drawn, it can be selected and edited.
	 */
	showHeaders: boolean
	/** Whether trees keep simulating, Obsidian-style, instead of settling after a drag. */
	live: boolean
}

const KEY = 'lifeboard:skill-tree-prefs'
export const DEFAULT_TREE_PREFS: TreePrefs = { importShows: 'all', showHeaders: false, live: false }

// An atom, so what reads it in a render or a shape's visibility follows a change at once.
const current = atom<TreePrefs>('lifeboard:skill-tree-prefs', read())
const listeners = new Set<() => void>()

function read(): TreePrefs {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TreePrefs>
		return {
			importShows: raw.importShows === 'overview' ? 'overview' : 'all',
			showHeaders: raw.showHeaders === true,
			live: raw.live === true,
		}
	} catch {
		return { ...DEFAULT_TREE_PREFS }
	}
}

export const getTreePrefs = (): TreePrefs => current.get()

export function setTreePrefs(patch: Partial<TreePrefs>): void {
	current.set({ ...current.get(), ...patch })
	try {
		localStorage.setItem(KEY, JSON.stringify(current.get()))
	} catch {
		// Kept for this session only.
	}
	for (const listener of listeners) listener()
}

export function subscribeToTreePrefs(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

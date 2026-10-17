/**
 * How skill trees behave by default (docs/skill-tree-plan.md, "Rebuild"): what an import shows, how
 * far focus mode reaches, whether physics runs live. A tree overrides any of them in its header's
 * editor; these are the defaults it falls back to.
 *
 * localStorage with a try/catch on both sides, as the dice prefs do it: private-mode Safari throws on
 * write, and losing a default across reloads is not worth a failure. Per device, like the canvas prefs.
 */
export interface TreePrefs {
	/** What an import's tree view opens on: skill nodes only, or everything. */
	importShows: 'overview' | 'all'
	/** How many steps out from a focused node its folded neighbours reach. */
	focusDepth: number
	/** Whether trees keep simulating, Obsidian-style, instead of settling after a drag. */
	live: boolean
}

const KEY = 'lifeboard:skill-tree-prefs'
export const DEFAULT_TREE_PREFS: TreePrefs = { importShows: 'overview', focusDepth: 1, live: false }

let current: TreePrefs = read()
const listeners = new Set<() => void>()

function read(): TreePrefs {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TreePrefs>
		return {
			importShows: raw.importShows === 'all' ? 'all' : 'overview',
			focusDepth: typeof raw.focusDepth === 'number' && raw.focusDepth >= 0 ? Math.min(4, Math.round(raw.focusDepth)) : DEFAULT_TREE_PREFS.focusDepth,
			live: raw.live === true,
		}
	} catch {
		return { ...DEFAULT_TREE_PREFS }
	}
}

export const getTreePrefs = (): TreePrefs => current

export function setTreePrefs(patch: Partial<TreePrefs>): void {
	current = { ...current, ...patch }
	try {
		localStorage.setItem(KEY, JSON.stringify(current))
	} catch {
		// Kept for this session only.
	}
	for (const listener of listeners) listener()
}

export function subscribeToTreePrefs(listener: () => void): () => void {
	listeners.add(listener)
	return () => listeners.delete(listener)
}

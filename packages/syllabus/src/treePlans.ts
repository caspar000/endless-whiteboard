import { atom } from '@lifeboard/canvas'
import type { DocTree } from '@lifeboard/skill-tree'

/**
 * The tree a syllabus file came with (its `tree:` or `trees:`), kept unused until someone makes a
 * skill tree from the syllabus (syllabusTrees.ts). An import never puts a tree in the skill tree's
 * vault or on a board; this is where it waits. Vault data, persisted as `syllabusTreePlans`, keyed by
 * tree id.
 */
export interface TreePlan {
	treeId: string
	/** The tracks of the file it came in, which feed it: a tree made from it goes with the last of them. */
	tracks: string[]
	tree: DocTree
	/** The board whose import brought it and has not confirmed it; '' once confirmed. */
	draft: string
}

type Plans = Readonly<Record<string, TreePlan>>

const plans = atom<Plans>('lifeboard:syllabus-tree-plans', {})
let persist: ((value: Plans) => void) | null = null

export const getTreePlans = (): Plans => plans.get()

export function setTreePlansPersistence(listener: ((value: Plans) => void) | null): void {
	persist = listener
}

function commit(next: Plans): void {
	if (JSON.stringify(next) === JSON.stringify(plans.get())) return
	plans.set(next)
	persist?.(next)
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function parsePlan(raw: unknown): TreePlan | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	const tree = r.tree as Partial<DocTree> | undefined
	if (!str(r.treeId) || !tree || typeof tree !== 'object' || !Array.isArray(tree.nodes)) return null
	return {
		treeId: str(r.treeId),
		tracks: strs(r.tracks),
		tree: {
			treeId: str(tree.treeId) || str(r.treeId),
			name: str(tree.name),
			goal: str(tree.goal),
			layout: str(tree.layout) || 'sectors',
			sectors: strs(tree.sectors),
			rings: strs(tree.rings),
			mounts: strs(tree.mounts),
			nodes: tree.nodes.filter((n) => !!n && typeof n === 'object' && !!str(n.nodeId)).map((n) => ({ ...n, after: str(n.after), item: str(n.item) })),
		},
		draft: str(r.draft),
	}
}

/** Loads the vault's copy; drops what it can't read. Not persisted back. */
export function replaceTreePlans(raw: unknown): void {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
	const next: Record<string, TreePlan> = {}
	for (const value of Object.values(raw as Record<string, unknown>)) {
		const plan = parsePlan(value)
		if (plan) next[plan.treeId] = plan
	}
	plans.set(next)
}

/**
 * A file's trees, kept for its tracks. A tree already kept is brought up to date and stays confirmed
 * (as re-importing an edited file updates its items); a new one is this board's draft.
 */
export function keepTreePlans(trees: readonly DocTree[], tracks: readonly string[], board: string): void {
	if (!trees.length) return
	const next = { ...plans.get() }
	for (const tree of trees) {
		const had = next[tree.treeId]
		next[tree.treeId] = { treeId: tree.treeId, tracks: [...new Set([...(had?.tracks ?? []), ...tracks])], tree, draft: had ? had.draft : board }
	}
	commit(next)
}

/** The kept trees a track feeds, confirmed, in the order they were kept. */
export const plansOf = (trackId: string, all: Plans = plans.get()): TreePlan[] => Object.values(all).filter((p) => !p.draft && p.tracks.includes(trackId))

/** A track has gone: it feeds no kept tree, and a kept tree nothing feeds goes. */
export function dropTrackFromPlans(trackId: string): void {
	const next: Record<string, TreePlan> = {}
	for (const plan of Object.values(plans.get())) {
		const tracks = plan.tracks.filter((t) => t !== trackId)
		if (tracks.length) next[plan.treeId] = { ...plan, tracks }
	}
	commit(next)
}

export function confirmTreePlans(board: string): number {
	const mine = Object.values(plans.get()).filter((p) => p.draft === board)
	if (mine.length) commit({ ...plans.get(), ...Object.fromEntries(mine.map((p) => [p.treeId, { ...p, draft: '' }])) })
	return mine.length
}

export function discardTreePlans(board: string): number {
	const mine = Object.values(plans.get()).filter((p) => p.draft === board)
	if (mine.length) commit(Object.fromEntries(Object.values(plans.get()).filter((p) => p.draft !== board).map((p) => [p.treeId, p])))
	return mine.length
}

/** For tests. */
export function resetTreePlans(): void {
	plans.set({})
}

import { react } from '@lifeboard/canvas'
import { getTreeDefs, updateTreeMeta, type TreeDefs } from '@lifeboard/skill-tree'
import { getTracks, updateTrack, type TrackDef } from './syllabus'

/**
 * A syllabus and its tree go by one name. A tree made from exactly one syllabus (syllabusTrees.ts),
 * or one an old import left under the goal's id (`adler`, fed by `adler/canon`) that exactly one
 * confirmed track feeds, is the same thing seen twice: in Settings › Syllabi and in a tree, Mastery
 * included. So renaming either renames the other. A tree several syllabi feed (Film's six, a shared
 * root) keeps its own name, as no one syllabus speaks for it.
 */

/** Each tree with exactly one confirmed syllabus feeding it. */
export function namePairs(tracks: Readonly<Record<string, TrackDef>>, trees: TreeDefs): { track: TrackDef; treeId: string; treeName: string }[] {
	const out: { track: TrackDef; treeId: string; treeName: string }[] = []
	const byPrefix = new Map<string, TrackDef[]>()
	for (const track of Object.values(tracks)) {
		const at = track.trackId.indexOf('/')
		if (track.draft || at < 1) continue
		const prefix = track.trackId.slice(0, at)
		byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), track])
	}
	for (const tree of Object.values(trees)) {
		if (tree.draft || tree.deleted) continue
		if (tree.madeFrom.length) {
			const only = tree.madeFrom.length === 1 ? tracks[tree.madeFrom[0]!.replace(/^syllabus:/, '')] : undefined
			if (only && !only.draft && tree.madeFrom[0]!.startsWith('syllabus:')) out.push({ track: only, treeId: tree.treeId, treeName: tree.name })
			continue
		}
		const list = byPrefix.get(tree.treeId)
		if (list?.length === 1) out.push({ track: list[0]!, treeId: tree.treeId, treeName: tree.name })
	}
	return out
}

export interface NameChanges {
	tracks: { trackId: string; name: string }[]
	trees: { treeId: string; name: string }[]
}

/**
 * What to rename so every pair agrees. `agreed` holds the name each pair last shared, and is kept up
 * to date: a tree that moved off it was renamed (on a board, or by the agent), so its syllabus
 * follows; otherwise the syllabus was renamed, or the two are new to each other, and its name is the
 * one, as Settings › Syllabi is where syllabi are named. A name cleared to nothing waits for the
 * next one typed.
 */
export function planNames(tracks: Readonly<Record<string, TrackDef>>, trees: TreeDefs, agreed: Map<string, string>): NameChanges {
	const out: NameChanges = { tracks: [], trees: [] }
	for (const { track, treeId, treeName } of namePairs(tracks, trees)) {
		if (track.name === treeName) {
			agreed.set(treeId, treeName)
			continue
		}
		const was = agreed.get(treeId)
		if (was !== undefined && track.name === was) {
			if (treeName.trim()) out.tracks.push({ trackId: track.trackId, name: treeName })
		} else if (track.name.trim()) out.trees.push({ treeId, name: track.name })
	}
	return out
}

let stop: (() => void) | null = null

/** Keeps every pair's names together from now on. Idempotent. */
export function watchTreeNames(): void {
	if (stop) return
	const agreed = new Map<string, string>()
	let pending = false
	stop = react('lifeboard:syllabus-tree-names', () => {
		getTracks()
		getTreeDefs()
		// Written after the change that woke this, not inside it.
		if (pending) return
		pending = true
		queueMicrotask(() => {
			pending = false
			const changes = planNames(getTracks(), getTreeDefs(), agreed)
			for (const t of changes.tracks) updateTrack(t.trackId, { name: t.name })
			for (const t of changes.trees) updateTreeMeta(t.treeId, { name: t.name })
		})
	})
}

/** For tests. */
export function stopTreeNames(): void {
	stop?.()
	stop = null
}
